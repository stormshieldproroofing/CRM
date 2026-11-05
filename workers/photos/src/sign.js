// Signed, expiring photo links. The photo-share edge function
// (supabase/functions/photo-share/index.ts) builds links the same way —
// keep the two in step: HMAC-SHA256(secret, `${path}\n${exp}`) as hex.

export const SECTIONS = ["before", "during", "after"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^jobs\/[0-9a-f-]{36}\/(before|during|after)\/(thumbs\/)?[\w.-]+\.(jpg|jpeg|png|webp)$/i;

export function isPhotoKey(path) {
  return typeof path === "string" && path.length < 300 && KEY.test(path) && !path.includes("..");
}

export function jobIdFromPath(path) {
  if (!isPhotoKey(path)) return null;
  const id = path.split("/")[1];
  return UUID.test(id) ? id.toLowerCase() : null;
}

// jobs/<job>/<section>/<YYYYMMDD-HHMMSS>-<8 hex>.jpg  (+ thumbs/ copy)
export function newPhotoKeys(jobId, section, date, uuid) {
  const p = (n) => String(n).padStart(2, "0");
  const d = date || new Date();
  const stamp = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
  const file = `${stamp}-${String(uuid).replace(/-/g, "").slice(0, 8)}.jpg`;
  const base = `jobs/${String(jobId).toLowerCase()}/${section}`;
  return { path: `${base}/${file}`, thumbPath: `${base}/thumbs/${file}` };
}

async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signPath(base, secret, path, exp) {
  if (!secret) throw new Error("URL_SIGNING_SECRET is not set");
  const s = await hmacHex(secret, `${path}\n${exp}`);
  const enc = path.split("/").map(encodeURIComponent).join("/");
  return `${base}/f/${enc}?e=${exp}&s=${s}`;
}

export async function verifySignature(secret, path, exp, sig, nowSec = Math.floor(Date.now() / 1000)) {
  if (!secret || !isPhotoKey(path) || !Number.isFinite(exp) || exp < nowSec) return false;
  if (typeof sig !== "string" || !/^[0-9a-f]{64}$/.test(sig)) return false;
  const want = await hmacHex(secret, `${path}\n${exp}`);
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}
