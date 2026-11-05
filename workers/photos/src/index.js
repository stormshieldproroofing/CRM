// StormShield photo worker — stores job photos in Cloudflare R2.
//
//   POST   /upload?job=<uuid>&section=<before|during|after>   (multipart: photo, thumb)
//          -> { path, thumb_path, size }
//   POST   /sign      { paths: [...] }      -> { urls: { path: signedUrl } }
//   POST   /delete    { paths: [...] }      -> { deleted: n }
//   GET    /f/<path>?e=<unix>&s=<hmac>       -> the image (signed, expiring link)
//
// Every POST needs the CRM user's Supabase login token (Authorization: Bearer ...).
// The worker asks Supabase who the user is and whether they can open that job
// (public.can_access_job), so the same job permissions apply as in the CRM.
// The R2 bucket itself stays private; images are only reachable through /f/
// links signed with URL_SIGNING_SECRET. The photo-share edge function signs
// links the same way for public share pages.
//
// Bindings / settings (see wrangler.toml and README.md):
//   PHOTOS                     R2 bucket binding
//   SUPABASE_URL               https://<ref>.supabase.co
//   SUPABASE_ANON_KEY          public anon key (same one the CRM uses)
//   URL_SIGNING_SECRET         secret  (wrangler secret put URL_SIGNING_SECRET)
//   ALLOWED_ORIGINS            comma list, e.g. https://stormshieldproroofing.github.io

import { signPath, verifySignature, jobIdFromPath, newPhotoKeys, SECTIONS } from "./sign.js";

const MAX_PHOTO = 15 * 1024 * 1024;
const MAX_THUMB = 1 * 1024 * 1024;
const LINK_TTL = 60 * 60 * 24 * 7; // signed links last 7 days, like the CRM's Supabase links
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function corsHeaders(req, env) {
  const origin = req.headers.get("Origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes("*") || allowed.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin || "*" : allowed[0] || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
const json = (req, env, body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req, env), "Content-Type": "application/json" },
  });

// --- Supabase checks -------------------------------------------------------
async function currentUser(req, env) {
  const auth = req.headers.get("Authorization") || "";
  if (!/^Bearer\s+\S+/.test(auth)) return null;
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: auth },
  });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null);
  return u && u.id ? { id: u.id, email: u.email, auth } : null;
}

async function canAccessJob(env, user, jobId) {
  if (!UUID.test(jobId)) return false;
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/can_access_job`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: user.auth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ jid: jobId }),
  });
  if (!r.ok) return false;
  return (await r.json().catch(() => false)) === true;
}

// Check every distinct job behind a list of paths once.
async function allowedPaths(env, user, paths) {
  const list = (Array.isArray(paths) ? paths : []).filter((p) => typeof p === "string").slice(0, 500);
  const jobs = [...new Set(list.map(jobIdFromPath).filter(Boolean))];
  const ok = new Set();
  await Promise.all(jobs.map(async (j) => { if (await canAccessJob(env, user, j)) ok.add(j); }));
  return list.filter((p) => ok.has(jobIdFromPath(p)));
}

// --- Handlers ----------------------------------------------------------------
async function handleUpload(req, env, url) {
  const user = await currentUser(req, env);
  if (!user) return json(req, env, { error: "Not signed in" }, 401);
  const job = url.searchParams.get("job") || "";
  const section = url.searchParams.get("section") || "";
  if (!SECTIONS.includes(section)) return json(req, env, { error: "Bad section" }, 400);
  if (!(await canAccessJob(env, user, job))) return json(req, env, { error: "No access to this job" }, 403);

  let form;
  try { form = await req.formData(); } catch { return json(req, env, { error: "Expected a photo upload" }, 400); }
  const photo = form.get("photo");
  const thumb = form.get("thumb");
  if (!photo || typeof photo === "string") return json(req, env, { error: "Missing photo" }, 400);
  if (!/^image\/(jpeg|png|webp)$/.test(photo.type || "")) return json(req, env, { error: "Photos must be JPEG, PNG or WebP" }, 400);
  if (photo.size > MAX_PHOTO) return json(req, env, { error: "Photo is too large" }, 413);
  if (thumb && typeof thumb !== "string" && thumb.size > MAX_THUMB) return json(req, env, { error: "Thumbnail is too large" }, 413);

  const { path, thumbPath } = newPhotoKeys(job, section, new Date(), crypto.randomUUID());
  const meta = { httpMetadata: { contentType: photo.type, cacheControl: "private, max-age=31536000, immutable" },
                 customMetadata: { uploadedBy: user.email || user.id } };
  await env.PHOTOS.put(path, photo.stream(), meta);
  let thumb_path = null;
  if (thumb && typeof thumb !== "string" && thumb.size > 0) {
    await env.PHOTOS.put(thumbPath, thumb.stream(), { ...meta, httpMetadata: { ...meta.httpMetadata, contentType: thumb.type || "image/jpeg" } });
    thumb_path = thumbPath;
  }
  return json(req, env, { path, thumb_path, size: photo.size });
}

async function handleSign(req, env) {
  const user = await currentUser(req, env);
  if (!user) return json(req, env, { error: "Not signed in" }, 401);
  const body = await req.json().catch(() => ({}));
  const paths = await allowedPaths(env, user, body.paths);
  const base = new URL(req.url).origin;
  const exp = Math.floor(Date.now() / 1000) + LINK_TTL;
  const urls = {};
  await Promise.all(paths.map(async (p) => { urls[p] = await signPath(base, env.URL_SIGNING_SECRET, p, exp); }));
  return json(req, env, { urls });
}

async function handleDelete(req, env) {
  const user = await currentUser(req, env);
  if (!user) return json(req, env, { error: "Not signed in" }, 401);
  const body = await req.json().catch(() => ({}));
  const paths = await allowedPaths(env, user, body.paths);
  if (paths.length) await env.PHOTOS.delete(paths);
  return json(req, env, { deleted: paths.length });
}

async function handleFile(req, env, url) {
  const path = decodeURIComponent(url.pathname.slice(3)); // strip "/f/"
  const exp = Number(url.searchParams.get("e"));
  const sig = url.searchParams.get("s") || "";
  if (!(await verifySignature(env.URL_SIGNING_SECRET, path, exp, sig))) {
    return new Response("Link expired or invalid", { status: 403, headers: corsHeaders(req, env) });
  }
  const obj = await env.PHOTOS.get(path);
  if (!obj) return new Response("Not found", { status: 404, headers: corsHeaders(req, env) });
  const headers = new Headers(corsHeaders(req, env));
  obj.writeHttpMetadata(headers);
  headers.set("ETag", obj.httpEtag);
  headers.set("Cache-Control", "private, max-age=86400");
  headers.set("Access-Control-Allow-Origin", "*"); // signed links may be opened from share pages
  const name = path.split("/").pop();
  if (url.searchParams.get("dl") === "1") headers.set("Content-Disposition", `attachment; filename="${name}"`);
  return new Response(obj.body, { headers });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    try {
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req, env) });
      if (req.method === "GET" && url.pathname.startsWith("/f/")) return await handleFile(req, env, url);
      if (req.method === "GET" && url.pathname === "/") return json(req, env, { ok: true, service: "stormshield-photos" });
      if (req.method === "POST" && url.pathname === "/upload") return await handleUpload(req, env, url);
      if (req.method === "POST" && url.pathname === "/sign") return await handleSign(req, env);
      if (req.method === "POST" && url.pathname === "/delete") return await handleDelete(req, env);
      return json(req, env, { error: "Not found" }, 404);
    } catch (e) {
      console.error(e);
      return json(req, env, { error: "Server error" }, 500);
    }
  },
};
