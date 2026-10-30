// quote-email — saves the estimate as a DRAFT in the company's Zoho Mail (Drafts folder).
//   POST { job_id, to, template: "estimate"|"followup", note?, pdf_base64, file_name, summary, preview? }
// The CRM builds the estimate PDF in the browser and sends it here with a small summary
// (options, prices, what the homeowner pays, price-lock date). Nothing is sent to the
// homeowner: the rep opens Zoho Mail → Drafts, reviews, and clicks Send.
// preview:true returns { subject, html } without touching Zoho.
// Uses the same Zoho Mail secrets and branded frame as packet-email.
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

let acct: { id: string; from: string; canSendAs: Set<string> } | null = null;
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
  acct = { id: String(a.accountId), from: want || a.primaryEmailAddress || a.mailboxAddress, canSendAs: new Set(addrs(a)) };
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

// Signature built from the CRM Team list: the salesperson assigned to the job, else the company.
const OFFICE = "8329107735";
function fmtPhone(v: unknown) {
  const d = String(v || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? { href: d, text: `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` } : null;
}
function signatureHtml(rep: { name?: string; email?: string; phone?: string } | null) {
  const a = (href: string, text: string) => `<a href="${href}" style="color:#1F2937;text-decoration:none">${esc(text)}</a>`;
  const office = fmtPhone(OFFICE)!;
  const cell = rep ? fmtPhone(rep.phone) : null;
  const phones = `Office ${a("tel:" + office.href, office.text)}` + (cell && cell.href !== office.href ? ` &nbsp;&middot;&nbsp; Cell ${a("tel:" + cell.href, cell.text)}` : "");
  const email = rep && EMAIL_RE.test(String(rep.email || "")) ? a("mailto:" + rep.email, String(rep.email)) + " &nbsp;&middot;&nbsp; " : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="${FONT}font-size:14px;line-height:1.6;color:#1F2937">
    ${rep && rep.name
      ? `<div style="font-size:16px;font-weight:bold;color:#0F1E3A">${esc(rep.name)}</div><div style="color:#4B5563">Claims Specialist &nbsp;&middot;&nbsp; StormShield Pro Roofing</div>`
      : `<div style="font-size:16px;font-weight:bold;color:#0F1E3A">StormShield Pro Roofing</div>`}
    <div style="margin-top:6px">${phones}</div>
    ${email ? `<div>${email.replace(/ &nbsp;&middot;&nbsp; $/, "")}</div>` : ""}
    <div><a href="https://stormshieldproroofing.com" style="color:#1D4ED8;text-decoration:none">stormshieldproroofing.com</a> &nbsp;&middot;&nbsp; <span style="color:#4B5563">Serving Houston + surrounding areas</span></div>
    <div style="margin-top:10px;font-size:12px;line-height:1.5;color:#6B7280">Residential &amp; Commercial Roofing &nbsp;&middot;&nbsp; Storm Damage Restoration &nbsp;&middot;&nbsp; Insurance Claim Assistance &nbsp;&middot;&nbsp; Free Roof Inspections</div>
  </td></tr></table>`;
}

// Pinned to the commit that added the logo, so it shows even before the site updates.
const LOGO_URL = "https://raw.githubusercontent.com/stormshieldproroofing/CRM/3fb29d8517d646ac31ede7674c5a42a916ad5826/email-logo.png";
const FONT = "font-family:Arial,Helvetica,sans-serif;";
const para = (t: string) => `<p style="margin:0 0 16px;${FONT}font-size:15px;line-height:1.6;color:#1F2937">${t}</p>`;
const CALL = 'If you have any questions, just reply to this email or call us at <a href="tel:8329107735" style="color:#1D4ED8;text-decoration:none">832-910-7735</a>.';

// Branded frame shared by every packet email: logo header, body, salesperson signature.
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
  <tr><td style="padding:4px 28px 28px;${FONT}font-size:14px;line-height:1.5;color:#1F2937"><div style="margin-bottom:10px">Thank you,</div>${signatureHtml}</td></tr>
</table>
</td></tr></table>
</div>`;
}

async function allowed(req: Request, jobId: string) {
  const authz = req.headers.get("Authorization") || "";
  const bearer = authz.replace(/^Bearer\s+/i, "");
  if (bearer && bearer === SERVICE_KEY) return true;
  if (!bearer) return false;
  const user = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authz } }, auth: { persistSession: false } });
  const { data: u } = await user.auth.getUser();
  if (!u || !u.user) return false;
  const { data: can } = await user.rpc("can_access_job", { jid: jobId });
  return can === true;
}

const money = (n: unknown) => { const v = Number(n); return isFinite(v) && v > 0 ? "$" + Math.round(v).toLocaleString("en-US") : "—"; };
const box = (inner: string) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;background:#F6F8FB;border:1px solid #E3E7EE;border-radius:8px"><tr><td style="padding:14px 16px;${FONT}font-size:14px;line-height:1.6;color:#1F2937">${inner}</td></tr></table>`;

type Opt = { tier?: string; name?: string; price?: number; pay?: number; up?: number };
type Summary = { mode?: string; first?: string; address?: string; carrier?: string; options?: Opt[];
  single?: { name?: string; price?: number; pay?: number; deposit?: number }; validUntil?: string; rep?: string };

function optionsTable(s: Summary) {
  const cash = s.mode === "cash";
  const th = `style="text-align:left;padding:8px 10px;${FONT}font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#4B5563;border-bottom:2px solid #0F1E3A"`;
  const td = `style="padding:9px 10px;${FONT}font-size:14px;line-height:1.4;color:#1F2937;border-bottom:1px solid #E3E7EE;vertical-align:top"`;
  const rows = (s.options || []).slice(0, 4).map((o) => `<tr>
      <td ${td}><b style="color:#0F1E3A">${esc(o.tier)}</b><br><span style="color:#4B5563">${esc(o.name)}</span></td>
      <td ${td} align="right">${money(o.price)}${o.up && o.up > 0 ? `<br><span style="font-size:12px;color:#7A5A26">+${money(o.up)} upgrade</span>` : ""}</td>
      ${cash ? "" : `<td ${td} align="right"><b>${money(o.pay)}</b></td>`}
    </tr>`).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;border-collapse:collapse">
    <tr><th ${th}>Option</th><th ${th} align="right" style="text-align:right;padding:8px 10px;${FONT}font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#4B5563;border-bottom:2px solid #0F1E3A">Price</th>${cash ? "" : `<th ${th} align="right" style="text-align:right;padding:8px 10px;${FONT}font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#4B5563;border-bottom:2px solid #0F1E3A">You pay</th>`}</tr>
    ${rows}</table>`;
}

function build(template: string, s: Summary, note: string, signature: string) {
  const first = esc(s.first || "there");
  const at = s.address ? ` for <b>${esc(s.address)}</b>` : "";
  const cash = s.mode === "cash";
  const multi = (s.options || []).length > 1;
  const noteHtml = note ? para(esc(note).replace(/\n/g, "<br>")) : "";
  const lock = s.validUntil ? `Your prices are locked until <b>${esc(s.validUntil)}</b>.` : "";
  const claim = !cash && s.carrier ? `Your claim with <b>${esc(s.carrier)}</b> covers the approved scope &mdash; you pay your deductible${multi ? ", plus the upgrade for any option above the first" : ""}.` : "";
  const single = s.single || {};
  const singleBox = box(`<div style="font-weight:bold;color:#0F1E3A;margin-bottom:4px">${esc(single.name || "Your roof replacement")}</div>
      Total: <b>${money(single.price)}</b>${!cash && s.carrier ? `<br>You pay: <b>${money(single.pay)}</b> (your deductible)` : ""}${cash && single.deposit ? `<br>Deposit at signing: <b>${money(single.deposit)}</b> &middot; balance on completion` : ""}`);
  const compare = multi ? optionsTable(s) : singleBox;
  const nextStep = multi
    ? "To move forward, just reply with the option you&rsquo;d like and we&rsquo;ll get you scheduled."
    : "To move forward, just reply to this email and we&rsquo;ll get you scheduled.";
  const attached = `<p style="margin:0 0 16px;${FONT}font-size:13px;line-height:1.5;color:#4B5563">&#128206; Your full estimate is attached as a PDF.</p>`;

  if (template === "followup") {
    return {
      subject: `Following up on your roofing estimate${s.address ? " — " + s.address.split(",")[0] : ""}`,
      html: shell("Checking in on your estimate", `
        ${para("Hi " + first + ",")}
        ${noteHtml}
        ${para("I wanted to follow up on the roofing estimate we put together" + at + ". I&rsquo;ve attached it again so it&rsquo;s easy to find.")}
        ${compare}
        ${lock || claim ? para([claim, lock].filter(Boolean).join(" ")) : ""}
        ${attached}
        ${para("Happy to walk through the options or answer any questions about your " + (cash ? "project" : "claim") + ". " + nextStep)}
        ${para(CALL)}`, signature),
    };
  }
  return {
    subject: `Your roofing estimate${s.address ? " — " + s.address.split(",")[0] : ""}`,
    html: shell("Your roofing estimate", `
      ${para("Hi " + first + ",")}
      ${noteHtml}
      ${para("Thank you for choosing StormShield Pro Roofing. Your estimate" + at + " is attached." + (multi ? ` We&rsquo;ve included ${(s.options || []).length} options so you can compare them side by side:` : ""))}
      ${compare}
      ${claim ? para(claim) : ""}
      ${para('Feel free to reply or call us at <a href="tel:8329107735" style="color:#1D4ED8;text-decoration:none">832-910-7735</a> with any questions or concerns.')}`, signature),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const jobId = String(body.job_id || "");
    const to = String(body.to || "").trim();
    const template = body.template === "followup" ? "followup" : "estimate";
    const note = String(body.note || "").slice(0, 2000).trim();
    const summary: Summary = (body.summary && typeof body.summary === "object") ? body.summary : {};
    if (!/^[0-9a-f-]{36}$/i.test(jobId)) return json({ error: "Save this job to the CRM first (it isn't synced yet)" }, 400);
    if (!(await allowed(req, jobId))) return json({ error: "Not allowed" }, 403);

    const { data: job } = await admin.from("jobs").select("name,assigned_to").eq("id", jobId).maybeSingle();
    if (!job) return json({ error: "Job not found" }, 404);
    let rep: { name?: string; email?: string; phone?: string } | null = null;
    if (job.assigned_to) {
      const { data } = await admin.from("team_members").select("name,email,phone").eq("id", job.assigned_to).maybeSingle();
      if (data && data.name) rep = { name: data.name, email: String(data.email || "").trim(), phone: data.phone || "" };
    }
    if (!summary.first) summary.first = String(job.name || "").trim().split(/\s+/)[0] || "there";
    const { subject, html } = build(template, summary, note, signatureHtml(rep));
    if (body.preview) return json({ ok: true, subject, html });

    if (!EMAIL_RE.test(to) || to.length > 200) return json({ error: "That email address doesn't look right" }, 400);
    if (!Deno.env.get("ZOHO_MAIL_REFRESH_TOKEN")) return json({ ok: false, notConfigured: true, error: "Email isn't set up yet" }, 200);
    const b64 = String(body.pdf_base64 || "");
    if (!b64 || b64.length > 12_000_000) return json({ error: "The estimate PDF is missing or too large" }, 400);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") return json({ error: "The attachment isn't a PDF" }, 400);
    const fileName = (String(body.file_name || "Roofing Estimate.pdf").replace(/[\\/:*?"<>|]+/g, "").slice(0, 120) || "Roofing Estimate.pdf").replace(/(\.pdf)?$/i, ".pdf");

    const token = await zohoToken();
    const account = await mailAccount(token);
    const repEmail = rep && EMAIL_RE.test(rep.email || "") ? rep.email! : "";
    const from = repEmail && account.canSendAs.has(repEmail.toLowerCase()) ? repEmail : account.from;
    const up = await zmail(token, `/accounts/${account.id}/messages/attachments?fileName=${encodeURIComponent(fileName)}`, {
      method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: bytes,
    });
    const att = Array.isArray(up.data) ? up.data[0] : up.data;
    if (!att || !att.storeName) throw new Error("Zoho Mail attachment upload returned no file");
    const seen = new Set([to.toLowerCase()]);
    const bcc = [repEmail, ...(Deno.env.get("ZOHO_MAIL_BCC") || "").split(",")].map((x) => x.trim())
      .filter((x) => EMAIL_RE.test(x) && !seen.has(x.toLowerCase()) && (seen.add(x.toLowerCase()), true)).join(",");
    await zmail(token, `/accounts/${account.id}/messages`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "draft", fromAddress: from, toAddress: to, ...(bcc ? { bccAddress: bcc } : {}),
        subject, content: html, mailFormat: "html",
        attachments: [{ storeName: att.storeName, attachmentPath: att.attachmentPath, attachmentName: att.attachmentName || fileName }],
      }),
    });
    return json({ ok: true, draft: true, to, from, subject, draftsUrl: `https://mail.zoho.${DC}/zm/#mail/folder/drafts` });
  } catch (e) {
    console.error("quote-email", e);
    return json({ ok: false, error: String((e as Error)?.message || e).slice(0, 300) }, 502);
  }
});
