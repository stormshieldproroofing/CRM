// Minimal Web Push sender (RFC 8291 aes128gcm payload encryption + RFC 8292 VAPID),
// using only WebCrypto so it runs in Supabase Edge Functions (Deno) and in Node 20+.

const te = new TextEncoder();

export function b64uToBytes(s: string): Uint8Array {
  const b = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function bytesToB64u(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

export type Subscription = { endpoint: string; p256dh: string; auth: string };
export type Vapid = { publicKey: string; privateKey: string; subject: string };

/** Encrypt a payload for one browser subscription (aes128gcm, single record). */
export async function encrypt(sub: Subscription, payload: Uint8Array, salt?: Uint8Array, asKeys?: CryptoKeyPair) {
  const uaPublic = b64uToBytes(sub.p256dh);
  const authSecret = b64uToBytes(sub.auth);
  salt = salt || crypto.getRandomValues(new Uint8Array(16));
  const as = asKeys || (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));

  const prkKey = await hmac(authSecret, shared);
  const keyInfo = concat(te.encode("WebPush: info\0"), uaPublic, asPublic, new Uint8Array([1]));
  const ikm = await hmac(prkKey, keyInfo);
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(te.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(te.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);

  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const plain = concat(payload, new Uint8Array([2]));            // last (only) record delimiter
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, plain));

  const rs = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ct);
}

/** VAPID Authorization header value for an endpoint. */
export async function vapidAuth(endpoint: string, v: Vapid, now = Math.floor(Date.now() / 1000)) {
  const pub = b64uToBytes(v.publicKey);
  const jwk = { kty: "EC", crv: "P-256", x: bytesToB64u(pub.slice(1, 33)), y: bytesToB64u(pub.slice(33, 65)), d: v.privateKey, ext: true };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = bytesToB64u(te.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = bytesToB64u(te.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: now + 12 * 3600, sub: v.subject })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, te.encode(head + "." + body)));
  return `vapid t=${head}.${body}.${bytesToB64u(sig)}, k=${v.publicKey}`;
}

/** Send one push. Returns the push service's HTTP status. */
export async function sendPush(sub: Subscription, data: unknown, v: Vapid, opts: { ttl?: number; urgency?: string; topic?: string } = {}) {
  const body = await encrypt(sub, te.encode(JSON.stringify(data)));
  const headers: Record<string, string> = {
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    TTL: String(opts.ttl ?? 86400),
    Urgency: opts.urgency || "high",
    Authorization: await vapidAuth(sub.endpoint, v),
  };
  if (opts.topic) headers.Topic = opts.topic;
  const res = await fetch(sub.endpoint, { method: "POST", headers, body });
  return res.status;
}
