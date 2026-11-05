// photo-share — the public side of a "Share Photos" link (photos.html?t=<token>).
//   GET ?t=<token>  -> { job: { address }, sections, photos: [{ section, name, url, thumb, taken_at }] }
// The token is never stored; shares are looked up by its SHA-256 hash. Runs with the
// service role, so every check on the share happens here. Deployed with verify_jwt off
// because homeowners and adjusters have no CRM login — the token is the credential.
//
// Photos may live in the Supabase "job-files" bucket (older photos) or in Cloudflare R2
// (storage = 'r2'). R2 links are signed exactly like workers/photos/src/sign.js, using the
// same secret: set PHOTO_URL_SECRET (= the worker's URL_SIGNING_SECRET) and
// PHOTO_WORKER_URL (the worker's https URL) as edge function secrets.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const WORKER = (Deno.env.get("PHOTO_WORKER_URL") || "").replace(/\/+$/, "");
const SECRET = Deno.env.get("PHOTO_URL_SECRET") || "";
const TTL = 60 * 60 * 24; // links on the share page last a day; the page re-fetches on each visit

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
async function sha256(text: string) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}
async function signR2(path: string, exp: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${path}\n${exp}`)));
  return `${WORKER}/f/${path.split("/").map(encodeURIComponent).join("/")}?e=${exp}&s=${s}`;
}

// Street + city only: enough for the viewer to know which property this is.
function shortAddress(a: unknown) {
  const parts = String(a || "").split(",").map((s) => s.trim()).filter(Boolean);
  return parts.slice(0, 2).join(", ");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const t = new URL(req.url).searchParams.get("t") || "";
  if (t.length < 30 || t.length > 100) return json({ state: "missing" }, 404);

  const { data: share } = await sb.from("photo_shares").select("*").eq("token_hash", await sha256(t)).maybeSingle();
  if (!share) return json({ state: "missing" }, 404);
  if (share.revoked_at) return json({ state: "revoked" }, 410);
  if (share.expires_at && new Date(share.expires_at) < new Date()) return json({ state: "expired" }, 410);

  const [{ data: job }, { data: files }] = await Promise.all([
    sb.from("jobs").select("address").eq("id", share.job_id).maybeSingle(),
    sb.from("job_files").select("*").eq("job_id", share.job_id).eq("kind", "photo")
      .in("section", share.sections).order("created_at", { ascending: true }),
  ]);

  const exp = Math.floor(Date.now() / 1000) + TTL;
  const rows = files || [];
  const sbPaths = rows.filter((f) => f.storage !== "r2").flatMap((f) => [f.storage_path, f.thumb_path]).filter(Boolean);
  const sbUrls: Record<string, string> = {};
  if (sbPaths.length) {
    const { data: signed } = await sb.storage.from("job-files").createSignedUrls(sbPaths, TTL);
    (signed || []).forEach((s: any) => { if (s?.path && s?.signedUrl) sbUrls[s.path] = s.signedUrl; });
  }
  const urlFor = async (f: any, p: string | null) => {
    if (!p) return null;
    if (f.storage === "r2") return WORKER && SECRET ? await signR2(p, exp) : null;
    return sbUrls[p] || null;
  };

  const photos = [];
  for (const f of rows) {
    const url = await urlFor(f, f.storage_path);
    if (!url) continue;
    photos.push({
      section: f.section || "before",
      name: f.name || "Photo",
      url,
      thumb: (await urlFor(f, f.thumb_path)) || url,
      taken_at: f.taken_at || f.created_at,
    });
  }

  await sb.from("photo_shares")
    .update({ view_count: (share.view_count || 0) + 1, last_viewed_at: new Date().toISOString() })
    .eq("id", share.id);

  return json({
    state: "open",
    job: { address: shortAddress(job?.address) },
    label: share.label || null,
    sections: share.sections,
    expires_at: share.expires_at,
    photos,
  });
});
