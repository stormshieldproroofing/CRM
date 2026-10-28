// packet-sign — the homeowner's side of a remote Claim Packet signing link.
//   GET  ?t=<token>          -> packet answers + link status (marks the link "viewed")
//   POST { t, result }       -> builds the signed PDF, saves it to the job, returns a copy
// The token is never stored; links are looked up by its SHA-256 hash. Runs with the
// service role, so every check on the link happens here. Deployed with verify_jwt off
// because homeowners have no CRM login — the token is the credential.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

// The packet code (crm-packet.js — the same file the CRM and sign.html use) and the PDF
// template are loaded from the GitHub repo at a fixed commit and checked against SHA-256
// pins, so the server always runs exactly the reviewed code. Run ./pin.sh <commit> to update.
const ASSETS_REF = "b8c5dfb4f36eb0b744175b7ac90e545d09bfcf13";
const PACKET_JS_SHA256 = "08a8bf164fbee53a520efe9b913c8c0b3d1b798cb3e9c54e4c5368f133b20247";
const TEMPLATE_SHA256 = "1cb199af66fa5d65b3db7b2889b66654dcbbd831d43516b81a43c45766f06f37";
const ASSET_BASE = `https://raw.githubusercontent.com/stormshieldproroofing/CRM/${ASSETS_REF}/`;

(globalThis as any).PDFLib = { PDFDocument, StandardFonts, rgb };
let _pk: Promise<any> | null = null;
async function fetchPinned(name: string, sha: string) {
  const r = await fetch(ASSET_BASE + name);
  if (!r.ok) throw new Error(`asset ${name}: HTTP ${r.status}`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  const h = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map((b) => b.toString(16).padStart(2, "0")).join("");
  if (h !== sha) throw new Error(`asset ${name}: hash mismatch`);
  return bytes;
}
function packet() {
  if (!_pk) {
    _pk = (async () => {
      const [js, pdf] = await Promise.all([fetchPinned("crm-packet.js", PACKET_JS_SHA256), fetchPinned("StormShield_Claim_Packet.pdf", TEMPLATE_SHA256)]);
      new Function("module", new TextDecoder().decode(js))(undefined); // defines globalThis.crmPacket
      const pk = (globalThis as any).crmPacket;
      pk.setTemplateBytes(pdf);
      return pk;
    })().catch((e) => { _pk = null; throw e; });
  }
  return _pk;
}

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const fail = (msg: string, status = 400) => json({ error: msg }, status);

async function sha256(text: string) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
const isPng = (v: unknown, max = 400_000) =>
  typeof v === "string" && v.startsWith("data:image/png;base64,") && v.length < max;
const str = (v: unknown, max = 120) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const iso = (v: unknown) => {
  const d = new Date(typeof v === "string" ? v : NaN);
  return isNaN(+d) ? new Date().toISOString() : d.toISOString();
};

async function findLink(token: unknown) {
  if (typeof token !== "string" || token.length < 30 || token.length > 100) return null;
  const { data } = await sb.from("packet_links").select("*").eq("token_hash", await sha256(token)).maybeSingle();
  return data;
}
function linkState(l: any) {
  if (!l) return "missing";
  if (l.status === "void") return "void";
  if (l.status === "signed") return "signed";
  if (new Date(l.expires_at) < new Date()) return "expired";
  return "open";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (req.method === "GET") {
      const t = new URL(req.url).searchParams.get("t");
      const l = await findLink(t);
      const state = linkState(l);
      if (state === "missing") return fail("This signing link isn't valid.", 404);
      if (state !== "open") return json({ state, signed_at: l.signed_at || null });
      if (!l.viewed_at) {
        await sb.from("packet_links").update({ status: "viewed", viewed_at: new Date().toISOString() }).eq("id", l.id).eq("status", "sent");
      }
      return json({ state, fields: l.fields, rep_name: l.rep_name, expires_at: l.expires_at });
    }

    if (req.method !== "POST") return fail("Method not allowed", 405);
    const raw = await req.text();
    if (raw.length > 2_000_000) return fail("Request too large", 413);
    const body = JSON.parse(raw);
    const l = await findLink(body.t);
    const state = linkState(l);
    if (state === "missing") return fail("This signing link isn't valid.", 404);
    if (state !== "open") return fail(state === "signed" ? "This packet was already signed." : "This signing link is no longer active.", 409);

    // Validate what the homeowner did on their phone.
    const r = body.result || {};
    const initialed = r.initialed || {};
    const allInitialed = [0, 1, 2, 3, 4].every((i) => initialed[i] === true || initialed[String(i)] === true) && initialed.ded === true;
    const coowner = r.coowner === true;
    const sig = r.sig || {};
    const tpa = r.tpaApplied || {};
    if (!r.consentAt) return fail("Please agree to sign electronically.");
    if (!allInitialed || !isPng(r.initials)) return fail("Please initial every key term.");
    if (!str(r.homeownerName) || !isPng(sig.homeowner)) return fail("Please sign the agreement.");
    if (coowner && (!str(r.coownerName) || !isPng(sig.coowner))) return fail("The co-owner still needs to sign.");
    if (tpa.homeowner !== true || (coowner && tpa.coowner !== true)) return fail("Please sign the authorization.");

    const pk = await packet();
    const at = r.at || {};
    const clean = {
      consentAt: iso(r.consentAt),
      homeownerName: str(r.homeownerName), coowner, coownerName: coowner ? str(r.coownerName) : "",
      initials: r.initials, initialed,
      sig: { homeowner: sig.homeowner, coowner: coowner ? sig.coowner : undefined }, // rep signature comes from the link only
      tpaApplied: { homeowner: true, coowner },
      at: { homeowner: iso(at.homeowner), coowner: coowner ? iso(at.coowner) : undefined, sspr: l.rep_signed_at || l.created_at },
      repName: l.rep_name || "",
    };

    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
    const ua = str(req.headers.get("user-agent"), 300) || "unknown";
    const signedAt = new Date();
    const fields = l.fields || {};
    const out = await pk.finalizeSigned(fields, clean, {
      signedAt, repSig: l.rep_sig, repName: l.rep_name, repSignedAt: l.rep_signed_at,
      how: "Remotely, on the signer's own device, through a private one-time link sent by " +
        (l.rep_name || "a StormShield representative") + (l.sent_to ? " to " + l.sent_to : "") +
        ". Each signer agreed to sign electronically, initialed each key term, and drew their own signature.",
      details: [
        "Link created " + pk.fmtDateTime(l.created_at) + (l.viewed_at ? " · first opened " + pk.fmtDateTime(l.viewed_at) : ""),
        "Representative signed " + pk.fmtDateTime(l.rep_signed_at || l.created_at) + " when creating the link",
        "Signer IP address: " + ip,
      ],
      device: ua,
    });

    const safe = (s: string) => String(s || "").replace(/[\\/:*?"<>|]+/g, "").trim();
    const name = `${safe(fields.name) || "Homeowner"} - ${safe(fields.street) || "Property"} - Claim Packet (signed) - ${pk.fmtDate(signedAt).replace(/(\d+)\/(\d+)\/(\d+)/, "$3-$1-$2")}.pdf`;
    const path = `${l.job_id}/packet/${Date.now()}-${name.replace(/[^\w.\-]+/g, "_")}`;

    // Claim the link first so a double-tap can't produce two signed copies.
    const { data: claimed } = await sb.from("packet_links").update({ status: "signed", signed_at: signedAt.toISOString() })
      .eq("id", l.id).in("status", ["sent", "viewed"]).select("id");
    if (!claimed || !claimed.length) return fail("This packet was already signed.", 409);

    const up = await sb.storage.from("job-files").upload(path, out.finalBytes, { contentType: "application/pdf" });
    if (up.error) {
      await sb.from("packet_links").update({ status: l.viewed_at ? "viewed" : "sent", signed_at: null }).eq("id", l.id);
      console.error("upload failed", up.error);
      return fail("Could not save the signed packet. Please try again.", 500);
    }
    await sb.from("job_files").insert({ job_id: l.job_id, kind: "packet", name, storage_path: path });

    const summary = {
      method: "remote", at: signedAt.toISOString(), cancelBy: out.cancelBy.toISOString(), sha256: out.hash,
      homeowner: { name: clean.homeownerName }, coowner: coowner ? { name: clean.coownerName } : null,
      rep: { name: l.rep_name, user: l.created_by }, consentAt: clean.consentAt, file: { name, path }, linkId: l.id,
    };
    await sb.from("packet_links").update({
      signed_path: path, signed_summary: summary,
      audit: { ip, userAgent: ua, at: clean.at, consentAt: clean.consentAt, sha256: out.hash },
      rep_sig: null, // no longer needed once it is in the PDF
    }).eq("id", l.id);

    // Best effort: mark the packet signed on the job too (the CRM also reconciles from packet_links).
    const { data: job } = await sb.from("jobs").select("contract").eq("id", l.job_id).maybeSingle();
    if (job) {
      const c = job.contract || {};
      const prev = c.__packet || {};
      c.__packet = { ...prev, fields: prev.fields || fields, status: "signed", signed: summary, updatedAt: signedAt.toISOString() };
      await sb.from("jobs").update({ contract: c }).eq("id", l.job_id);
    }

    let b64 = "";
    const bytes = out.finalBytes as Uint8Array;
    for (let i = 0; i < bytes.length; i += 0x8000) b64 += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return json({ ok: true, cancelBy: out.cancelBy.toISOString(), fileName: name, pdf: btoa(b64) });
  } catch (e) {
    console.error("packet-sign error", e);
    return fail("Something went wrong. Please try again or call 832-910-7735.", 500);
  }
});
