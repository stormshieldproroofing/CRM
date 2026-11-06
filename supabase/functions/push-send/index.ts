// push-send — delivers a CRM notification to the recipient's phones / computers as a
// lock-screen (Web Push) alert.
//   POST { id }  with header x-push-token: <push_hook_token from Vault>
// Called by the database (pg_net) right after a row is added to public.notifications.
// It looks up the recipient's saved push subscriptions and sends to each one; dead
// subscriptions (phone removed the app, permission turned off) are deleted.
//
// Keys live in Supabase Vault (push_vapid_public, push_vapid_private, push_hook_token) and are
// read through public.push_config(), which only the service role may call — nothing to paste
// into the dashboard. Deploy with verify_jwt = false (the hook token is the check).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { sendPush } from "./webpush.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
let cfg: { publicKey: string; privateKey: string; token: string } | null = null;
async function config() {
  if (cfg) return cfg;
  const { data, error } = await admin.rpc("push_config");
  if (error || !data) throw new Error("push_config unavailable");
  cfg = { publicKey: data.vapid_public, privateKey: data.vapid_private, token: data.hook_token };
  return cfg;
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let c;
  try { c = await config(); } catch { return json({ error: "push not configured" }, 500); }
  if (!c.token || req.headers.get("x-push-token") !== c.token) return json({ error: "unauthorized" }, 401);
  const VAPID = { publicKey: c.publicKey, privateKey: c.privateKey, subject: "mailto:office@stormshieldproroofing.com" };

  let id = "";
  try { id = String((await req.json()).id || ""); } catch { /* bad body */ }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "bad id" }, 400);

  const { data: n, error } = await admin.from("notifications").select("*").eq("id", id).maybeSingle();
  if (error || !n) return json({ error: "not found" }, 404);
  if (n.read_at) return json({ skipped: "already read" });

  const { data: subs } = await admin.from("push_subscriptions").select("id,endpoint,p256dh,auth").eq("auth_id", n.recipient);
  if (!subs || !subs.length) return json({ sent: 0, note: "no devices" });

  const unread = await admin.from("notifications").select("id", { count: "exact", head: true }).eq("recipient", n.recipient).is("read_at", null);
  const open = n.kind === "packet_viewed" || n.kind === "packet_signed" ? "packet" : n.kind === "supplement_approved" ? "job" : "notes";
  const payload = {
    title: n.title,
    body: (n.job_label ? n.job_label + " · " : "") + (n.body || ""),
    tag: n.id,
    url: n.job_id ? `./?job=${n.job_id}&open=${open}&nid=${n.id}` : `./?nid=${n.id}`,
    badge: unread.count ?? undefined,
  };

  let sent = 0, removed = 0, failed = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      const status = await sendPush(s, payload, VAPID);
      if (status === 404 || status === 410) { await admin.from("push_subscriptions").delete().eq("id", s.id); removed++; }
      else if (status >= 200 && status < 300) { sent++; await admin.from("push_subscriptions").update({ last_ok_at: new Date().toISOString() }).eq("id", s.id); }
      else { failed++; console.warn("push failed", status, new URL(s.endpoint).host); }
    } catch (e) { failed++; console.warn("push error", String(e)); }
  }));
  return json({ sent, removed, failed });
});
