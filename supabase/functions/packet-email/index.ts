// packet-email — emails a signed Claim Packet PDF through the company's Zoho Mail.
//   POST { job_id, path, to }                      -> the signed PDF, after signing
//   POST { kind:"link", job_id, token, to, signPage? } -> "please sign" email with the private link
// Called by the CRM after in-person signing (with the signed-in user's token) and by
// packet-sign after a remote signing (with the service-role key). The PDF must be a
// `packet` file already saved on that job; the server reads it from storage itself.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_DC — already set for Zoho Books (same Self Client)
//   ZOHO_MAIL_REFRESH_TOKEN — refresh token with scopes ZohoMail.messages.CREATE,ZohoMail.accounts.READ
//   ZOHO_MAIL_FROM (optional) — send-as address; defaults to the Zoho mailbox's primary address
//   ZOHO_MAIL_BCC  (optional) — extra copy, e.g. office@stormshieldproroofing.com
//   ZOHO_MAIL_SIGNATURE (optional) — name or id of the Zoho Mail signature to use (default: the first one)
// The salesperson assigned to the job (team_members.email) always gets a BCC copy.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const DC = Deno.env.get("ZOHO_DC") || "com";
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

async function sha256(text: string) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function fmtDay(iso: string | null | undefined) {
  const d = new Date(iso || "");
  return isNaN(+d) ? "" : d.toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "long", day: "numeric", year: "numeric" });
}

// ---- Zoho Mail access token (shared cache row 'mail' in zoho_token_cache)
let mem: { token: string; expiresAt: number } | null = null;
async function zohoToken(): Promise<string> {
  const skew = 120_000;
  if (mem && Date.now() < mem.expiresAt - skew) return mem.token;
  const { data: row } = await admin.from("zoho_token_cache").select("access_token,expires_at").eq("id", "mail").maybeSingle();
  if (row && row.access_token && Date.now() < Number(row.expires_at) - skew) {
    mem = { token: row.access_token, expiresAt: Number(row.expires_at) };
    return mem.token;
  }
  const res = await fetch(`https://accounts.zoho.${DC}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: Deno.env.get("ZOHO_MAIL_REFRESH_TOKEN") || "",
      client_id: Deno.env.get("ZOHO_CLIENT_ID") || "",
      client_secret: Deno.env.get("ZOHO_CLIENT_SECRET") || "",
      grant_type: "refresh_token",
    }),
  });
  const tok = await res.json();
  if (!tok.access_token) {
    if (row && row.access_token && Date.now() < Number(row.expires_at)) return row.access_token;
    throw new Error("Zoho Mail sign-in failed: " + JSON.stringify(tok).slice(0, 200));
  }
  const expiresAt = Date.now() + (Number(tok.expires_in) || 3600) * 1000;
  mem = { token: tok.access_token, expiresAt };
  await admin.from("zoho_token_cache").upsert({ id: "mail", access_token: tok.access_token, expires_at: expiresAt, updated_at: new Date().toISOString() });
  return tok.access_token;
}

let acct: { id: string; from: string } | null = null;
async function mailAccount(token: string) {
  if (acct) return acct;
  const r = await fetch(`https://mail.zoho.${DC}/api/accounts`, { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
  const out = await r.json();
  const list = Array.isArray(out.data) ? out.data : [];
  if (!list.length) throw new Error("No Zoho Mail account found: " + JSON.stringify(out.status || out).slice(0, 200));
  const want = (Deno.env.get("ZOHO_MAIL_FROM") || "").toLowerCase();
  const addrs = (a: any) => [a.primaryEmailAddress, a.mailboxAddress, a.incomingUserName,
    ...((a.sendMailDetails || []).map((d: any) => d.fromAddress)), ...((a.emailAddress || []).map((e: any) => e.mailId))]
    .filter(Boolean).map((x: string) => x.toLowerCase());
  const a = (want && list.find((x: any) => addrs(x).includes(want))) || list[0];
  acct = { id: String(a.accountId), from: want || a.primaryEmailAddress || a.mailboxAddress };
  return acct;
}

async function zmail(token: string, path: string, init: RequestInit) {
  const r = await fetch(`https://mail.zoho.${DC}/api${path}`, {
    ...init, headers: { Authorization: `Zoho-oauthtoken ${token}`, ...(init.headers || {}) },
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok || (out.status && out.status.code && out.status.code >= 300)) {
    throw new Error(`Zoho Mail ${path.split("?")[0].split("/").pop()} failed (${r.status}): ` + JSON.stringify(out.data || out.status || out).slice(0, 200));
  }
  return out;
}

// The mailbox's own Zoho Mail signature (ZOHO_MAIL_SIGNATURE = its name or id to pick one; else the first).
async function zohoSignature(token: string): Promise<string> {
  try {
    const r = await fetch(`https://mail.zoho.${DC}/api/accounts/signature`, { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
    const out = await r.json();
    const list = Array.isArray(out.data) ? out.data : (out.data ? [out.data] : []);
    if (!list.length) return "";
    const want = (Deno.env.get("ZOHO_MAIL_SIGNATURE") || "").trim().toLowerCase();
    const sig = (want && list.find((x: any) => String(x.id) === want || String(x.name || "").toLowerCase() === want)) || list[0];
    const c = String(sig.content || "").trim();
    if (!c) return "";
    return /<[a-z][\s\S]*>/i.test(c) ? c : esc(c).replace(/\n/g, "<br>");
  } catch (e) {
    console.warn("signature lookup failed", e);
    return "";
  }
}

// Pinned to the commit that added the logo, so it shows even before the site updates.
const LOGO_URL = "https://raw.githubusercontent.com/stormshieldproroofing/CRM/3fb29d8517d646ac31ede7674c5a42a916ad5826/email-logo.png";
const FONT = "font-family:Arial,Helvetica,sans-serif;";
const para = (t: string) => `<p style="margin:0 0 16px;${FONT}font-size:15px;line-height:1.6;color:#1F2937">${t}</p>`;
const CALL = 'If you have any questions, just reply to this email or call us at <a href="tel:8329107735" style="color:#1D4ED8;text-decoration:none">832-910-7735</a>.';

// Branded frame shared by every packet email: logo header, body, the mailbox's Zoho signature.
function shell(title: string, inner: string, signatureHtml: string) {
  return `<div style="margin:0;padding:0;background:#F3F5F8">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F5F8"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFFFFF;border:1px solid #E3E7EE;border-radius:10px;overflow:hidden">
  <tr><td align="center" style="padding:22px 24px 16px;border-bottom:4px solid #0F1E3A">
    <img src="${LOGO_URL}" width="140" alt="StormShield Pro Roofing" style="display:block;width:140px;max-width:140px;height:auto;border:0">
  </td></tr>
  <tr><td style="padding:28px 28px 8px">
    <h1 style="margin:0 0 18px;${FONT}font-size:22px;line-height:1.3;color:#0F1E3A">${title}</h1>
    ${inner}
  </td></tr>
  <tr><td style="padding:4px 28px 28px;${FONT}font-size:14px;line-height:1.5;color:#1F2937">${signatureHtml || "Thank you,<br><b>StormShield Pro Roofing</b>"}</td></tr>
</table>
</td></tr></table>
</div>`;
}

// After signing: the signed PDF is attached.
function signedEmailHtml(o: { first: string; address: string; insurer: string; signatureHtml: string }) {
  return shell("Your signed claim paperwork", `
    ${para("Hi " + esc(o.first) + ",")}
    ${para("Thank you for choosing StormShield Pro Roofing. Your signed claim paperwork" + (o.address ? " for <b>" + esc(o.address) + "</b>" : "") + " is attached for your records.")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;background:#F6F8FB;border:1px solid #E3E7EE;border-radius:8px">
      <tr><td style="padding:14px 16px;${FONT}font-size:14px;line-height:1.6;color:#1F2937">
        <div style="font-weight:bold;color:#0F1E3A;margin-bottom:4px">Attached: your signed Claim Packet (PDF)</div>
        &bull; Page 1 &mdash; Contingency Agreement<br>
        &bull; Page 2 &mdash; Third-Party Authorization${o.insurer ? " for " + esc(o.insurer) : ""}<br>
        &bull; Page 3 &mdash; Electronic signature record
      </td></tr>
    </table>
    ${para("Our team will keep you updated as your claim moves forward. " + CALL)}`, o.signatureHtml);
}

// Before signing: a button to the homeowner's private signing link.
function linkEmailHtml(o: { first: string; address: string; insurer: string; rep: string; url: string; expires: string; signatureHtml: string }) {
  return shell("Your claim paperwork is ready to sign", `
    ${para("Hi " + esc(o.first) + ",")}
    ${para((o.rep ? esc(o.rep) + " with StormShield Pro Roofing has" : "StormShield Pro Roofing has") + " prepared your claim paperwork" + (o.address ? " for <b>" + esc(o.address) + "</b>" : "") + ". You can review and sign it on your phone or computer &mdash; it takes about 3 minutes.")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;background:#F6F8FB;border:1px solid #E3E7EE;border-radius:8px">
      <tr><td style="padding:14px 16px;${FONT}font-size:14px;line-height:1.6;color:#1F2937">
        <div style="font-weight:bold;color:#0F1E3A;margin-bottom:4px">What you&rsquo;ll sign</div>
        &bull; Contingency Agreement<br>
        &bull; Third-Party Authorization${o.insurer ? " for " + esc(o.insurer) : ""}
      </td></tr>
    </table>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 14px"><tr><td align="center" bgcolor="#2563EB" style="border-radius:8px">
      <a href="${esc(o.url)}" style="display:inline-block;padding:14px 28px;${FONT}font-size:16px;font-weight:bold;color:#FFFFFF;text-decoration:none;border-radius:8px">Review &amp; sign</a>
    </td></tr></table>
    <p style="margin:0 0 20px;${FONT}font-size:13px;line-height:1.5;color:#4B5563">This is a private link just for you${o.expires ? " and works until <b>" + esc(o.expires) + "</b>" : ""}. Please don&rsquo;t forward it.</p>
    ${para(CALL)}`, o.signatureHtml);
}

async function allowed(req: Request, jobId: string) {
  const authz = req.headers.get("Authorization") || "";
  const bearer = authz.replace(/^Bearer\s+/i, "");
  if (bearer && bearer === SERVICE_KEY) return true;              // packet-sign
  if (!bearer) return false;
  const user = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authz } }, auth: { persistSession: false } });
  const { data: u } = await user.auth.getUser();
  if (!u || !u.user) return false;
  const { data: can } = await user.rpc("can_access_job", { jid: jobId });
  return can === true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    if (!Deno.env.get("ZOHO_MAIL_REFRESH_TOKEN")) return json({ ok: false, notConfigured: true, error: "Email isn't set up yet" }, 200);
    const body = await req.json().catch(() => ({}));
    const jobId = String(body.job_id || "");
    const kind = body.kind === "link" ? "link" : "signed";
    const path = String(body.path || "");
    const to = String(body.to || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(jobId)) return json({ error: "job_id required" }, 400);
    if (kind === "signed" && !path) return json({ error: "path required" }, 400);
    if (!EMAIL_RE.test(to) || to.length > 200) return json({ error: "That email address doesn't look right" }, 400);
    if (!(await allowed(req, jobId))) return json({ error: "Not allowed" }, 403);

    const { data: job } = await admin.from("jobs").select("name,contract,assigned_to").eq("id", jobId).maybeSingle();
    if (!job) return json({ error: "Job not found" }, 404);
    let repEmail = "";
    if (job.assigned_to) {
      const { data: rep } = await admin.from("team_members").select("email").eq("id", job.assigned_to).maybeSingle();
      if (rep && EMAIL_RE.test(String(rep.email || "").trim())) repEmail = String(rep.email).trim();
    }
    const packetFields = (job.contract && job.contract.__packet && job.contract.__packet.fields) || {};

    const token = await zohoToken();
    const { id: accountId, from } = await mailAccount(token);
    const signatureHtml = await zohoSignature(token);
    const nameOf = (f: any) => String(f.name || job.name || "").trim().split(/\s+/)[0] || "there";
    const addressOf = (f: any) => [f.street, [f.city_state, f.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");

    let subject = "", content = "", attachments: unknown[] = [];
    if (kind === "link") {
      // The raw link token must match an open signing link on this job.
      const linkToken = String(body.token || "");
      if (linkToken.length < 30 || linkToken.length > 100) return json({ error: "Missing signing link" }, 400);
      const { data: link } = await admin.from("packet_links").select("id,job_id,status,expires_at,fields,rep_name")
        .eq("token_hash", await sha256(linkToken)).maybeSingle();
      if (!link || link.job_id !== jobId) return json({ error: "Signing link not found on this job" }, 404);
      if (!["sent", "viewed"].includes(link.status) || new Date(link.expires_at) < new Date()) return json({ error: "This signing link is no longer active" }, 409);
      const page = typeof body.signPage === "string" && /^https:\/\/[^\s/?#]+\/(?:[^\s?#]*\/)?sign\.html$/.test(body.signPage)
        ? body.signPage : (Deno.env.get("SIGN_PAGE_URL") || "https://stormshieldproroofing.github.io/CRM/sign.html");
      const f = link.fields || {};
      subject = `Please sign: your StormShield claim paperwork${f.street ? " — " + f.street : ""}`;
      content = linkEmailHtml({
        first: nameOf(f), address: addressOf(f), insurer: f.insurance_company || "", rep: link.rep_name || "",
        url: page + "?t=" + encodeURIComponent(linkToken), expires: fmtDay(link.expires_at), signatureHtml,
      });
    } else {
      const { data: file } = await admin.from("job_files").select("id,name").eq("job_id", jobId).eq("kind", "packet").eq("storage_path", path).maybeSingle();
      if (!file) return json({ error: "Signed packet not found on this job" }, 404);
      const { data: blob, error: dlErr } = await admin.storage.from("job-files").download(path);
      if (dlErr || !blob) return json({ error: "Could not read the signed PDF" }, 500);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const fileName = (file.name || "StormShield Claim Packet (signed).pdf").replace(/[\\/:*?"<>|]+/g, "");
      const up = await zmail(token, `/accounts/${accountId}/messages/attachments?fileName=${encodeURIComponent(fileName)}`, {
        method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: bytes,
      });
      const att = Array.isArray(up.data) ? up.data[0] : up.data;
      if (!att || !att.storeName) throw new Error("Zoho Mail attachment upload returned no file");
      attachments = [{ storeName: att.storeName, attachmentPath: att.attachmentPath, attachmentName: att.attachmentName || fileName }];
      const f = packetFields;
      subject = `Your signed claim paperwork${f.street ? " — " + f.street : ""}`;
      content = signedEmailHtml({ first: nameOf(f), address: addressOf(f), insurer: f.insurance_company || "", signatureHtml });
    }

    // BCC: the job's salesperson, plus the optional office address — never the homeowner or sender twice.
    const seen = new Set([to.toLowerCase(), String(from).toLowerCase()]);
    const bcc = [repEmail, ...(Deno.env.get("ZOHO_MAIL_BCC") || "").split(",")].map((x) => x.trim())
      .filter((x) => EMAIL_RE.test(x) && !seen.has(x.toLowerCase()) && (seen.add(x.toLowerCase()), true)).join(",");
    await zmail(token, `/accounts/${accountId}/messages`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromAddress: from, toAddress: to, ...(bcc ? { bccAddress: bcc } : {}),
        subject, content, mailFormat: "html", ...(attachments.length ? { attachments } : {}),
      }),
    });
    return json({ ok: true, to, from, bcc });
  } catch (e) {
    console.error("packet-email", e);
    return json({ ok: false, error: String((e as Error)?.message || e).slice(0, 300) }, 502);
  }
});
