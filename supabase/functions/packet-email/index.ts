// packet-email — emails a signed Claim Packet PDF through the company's Zoho Mail.
//   POST { job_id, path, to, cancelBy? }
// Called by the CRM after in-person signing (with the signed-in user's token) and by
// packet-sign after a remote signing (with the service-role key). The PDF must be a
// `packet` file already saved on that job; the server reads it from storage itself.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_DC — already set for Zoho Books (same Self Client)
//   ZOHO_MAIL_REFRESH_TOKEN — refresh token with scopes ZohoMail.messages.CREATE,ZohoMail.accounts.READ
//   ZOHO_MAIL_FROM (optional) — send-as address; defaults to the Zoho mailbox's primary address
//   ZOHO_MAIL_BCC  (optional) — extra copy, e.g. office@stormshieldproroofing.com
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

function fmtDay(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(+d)) return "";
  return d.toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "2-digit", day: "2-digit", year: "numeric" });
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
    const path = String(body.path || "");
    const to = String(body.to || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(jobId) || !path) return json({ error: "job_id and path required" }, 400);
    if (!EMAIL_RE.test(to) || to.length > 200) return json({ error: "That email address doesn't look right" }, 400);
    if (!(await allowed(req, jobId))) return json({ error: "Not allowed" }, 403);

    const { data: file } = await admin.from("job_files").select("id,name").eq("job_id", jobId).eq("kind", "packet").eq("storage_path", path).maybeSingle();
    if (!file) return json({ error: "Signed packet not found on this job" }, 404);
    const { data: job } = await admin.from("jobs").select("name,contract,assigned_to").eq("id", jobId).maybeSingle();
    let repEmail = "";
    if (job && job.assigned_to) {
      const { data: rep } = await admin.from("team_members").select("email").eq("id", job.assigned_to).maybeSingle();
      if (rep && EMAIL_RE.test(String(rep.email || "").trim())) repEmail = String(rep.email).trim();
    }
    const f = (job && job.contract && job.contract.__packet && job.contract.__packet.fields) || {};
    const { data: blob, error: dlErr } = await admin.storage.from("job-files").download(path);
    if (dlErr || !blob) return json({ error: "Could not read the signed PDF" }, 500);
    const bytes = new Uint8Array(await blob.arrayBuffer());

    const token = await zohoToken();
    const { id: accountId, from } = await mailAccount(token);
    const fileName = (file.name || "StormShield Claim Packet (signed).pdf").replace(/[\\/:*?"<>|]+/g, "");
    const up = await zmail(token, `/accounts/${accountId}/messages/attachments?fileName=${encodeURIComponent(fileName)}`, {
      method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: bytes,
    });
    const att = Array.isArray(up.data) ? up.data[0] : up.data;
    if (!att || !att.storeName) throw new Error("Zoho Mail attachment upload returned no file");

    const first = String(f.name || job?.name || "").trim().split(/\s+/)[0] || "there";
    const street = f.street || "";
    const cancel = fmtDay(body.cancelBy);
    const content = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#141A26">
      <p>Hi ${esc(first)},</p>
      <p>Attached is your signed Contingency Agreement and Third-Party Authorization with StormShield Pro Roofing${street ? " for " + esc(street) : ""}. Please keep it for your records.</p>
      ${cancel ? `<p><b>Your right to cancel:</b> you may cancel this agreement at any time before midnight on <b>${esc(cancel)}</b>, as explained in the Notice of Right to Cancel on page 1.</p>` : ""}
      <p>Questions? Reply to this email or call 832-910-7735.</p>
      <p>Thank you,<br>StormShield Pro Roofing<br>12111 Forest Sage Ln, Pearland, TX 77584<br>832-910-7735 · stormshieldproroofing.com</p>
    </div>`;
    // BCC: the job's salesperson, plus the optional office address — never the homeowner or sender twice.
    const seen = new Set([to.toLowerCase(), String(from).toLowerCase()]);
    const bcc = [repEmail, ...(Deno.env.get("ZOHO_MAIL_BCC") || "").split(",")].map((x) => x.trim())
      .filter((x) => EMAIL_RE.test(x) && !seen.has(x.toLowerCase()) && (seen.add(x.toLowerCase()), true)).join(",");
    await zmail(token, `/accounts/${accountId}/messages`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromAddress: from, toAddress: to, ...(bcc ? { bccAddress: bcc } : {}),
        subject: `Your signed claim paperwork${street ? " — " + street : ""}`,
        content, mailFormat: "html",
        attachments: [{ storeName: att.storeName, attachmentPath: att.attachmentPath, attachmentName: att.attachmentName || fileName }],
      }),
    });
    return json({ ok: true, to, from, bcc });
  } catch (e) {
    console.error("packet-email", e);
    return json({ ok: false, error: String((e as Error)?.message || e).slice(0, 300) }, 502);
  }
});
