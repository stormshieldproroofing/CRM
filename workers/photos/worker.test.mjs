// Runs the worker's fetch handler against a fake R2 bucket and a fake Supabase.
import assert from "node:assert";
import worker from "./src/index.js";

const JOB = "3f2c1a9e-1234-4abc-9def-0123456789ab";
const OTHER = "11111111-2222-4333-8444-555555555555";
const SUPA = "https://example.supabase.co";

const store = new Map();
const PHOTOS = {
  async put(k, body, meta) { store.set(k, { bytes: new Uint8Array(await new Response(body).arrayBuffer()), meta }); },
  async get(k) {
    const o = store.get(k); if (!o) return null;
    return { body: o.bytes, httpEtag: '"e"', writeHttpMetadata(h) { h.set("Content-Type", o.meta.httpMetadata.contentType); } };
  },
  async delete(keys) { [].concat(keys).forEach((k) => store.delete(k)); },
};
const env = { PHOTOS, SUPABASE_URL: SUPA, SUPABASE_ANON_KEY: "anon", URL_SIGNING_SECRET: "test-secret", ALLOWED_ORIGINS: "https://stormshieldproroofing.github.io" };

// Fake Supabase: token "good" is a user who can open JOB only.
globalThis.fetch = async (url, init = {}) => {
  const auth = (init.headers && init.headers.Authorization) || "";
  if (url === `${SUPA}/auth/v1/user`) return auth === "Bearer good" ? Response.json({ id: "u1", email: "crew@x.com" }) : new Response("no", { status: 401 });
  if (url === `${SUPA}/rest/v1/rpc/can_access_job`) return Response.json(JSON.parse(init.body).jid === JOB);
  throw new Error("unexpected fetch " + url);
};

const W = "https://photos.example.workers.dev";
const call = (path, init) => worker.fetch(new Request(W + path, init), env);
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("ok", name); }

function form() {
  const fd = new FormData();
  fd.append("photo", new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }), "p.jpg");
  fd.append("thumb", new Blob([new Uint8Array([9])], { type: "image/jpeg" }), "t.jpg");
  return fd;
}

let uploaded;
await test("upload needs a login", async () => {
  const r = await call(`/upload?job=${JOB}&section=before`, { method: "POST", body: form() });
  assert.strictEqual(r.status, 401);
});
await test("upload is refused for a job the user can't open", async () => {
  const r = await call(`/upload?job=${OTHER}&section=before`, { method: "POST", headers: { Authorization: "Bearer good" }, body: form() });
  assert.strictEqual(r.status, 403);
});
await test("upload rejects a bad section", async () => {
  const r = await call(`/upload?job=${JOB}&section=roof`, { method: "POST", headers: { Authorization: "Bearer good" }, body: form() });
  assert.strictEqual(r.status, 400);
});
await test("upload stores photo + thumbnail under the job", async () => {
  const r = await call(`/upload?job=${JOB}&section=after`, { method: "POST", headers: { Authorization: "Bearer good" }, body: form() });
  assert.strictEqual(r.status, 200);
  uploaded = await r.json();
  assert.ok(uploaded.path.startsWith(`jobs/${JOB}/after/`));
  assert.ok(uploaded.thumb_path.startsWith(`jobs/${JOB}/after/thumbs/`));
  assert.ok(store.has(uploaded.path) && store.has(uploaded.thumb_path));
});
let link;
await test("sign returns links only for jobs the user can open", async () => {
  const r = await call("/sign", { method: "POST", headers: { Authorization: "Bearer good", "Content-Type": "application/json" },
    body: JSON.stringify({ paths: [uploaded.path, `jobs/${OTHER}/after/x.jpg`, "../etc"] }) });
  const { urls } = await r.json();
  assert.deepStrictEqual(Object.keys(urls), [uploaded.path]);
  link = urls[uploaded.path];
});
await test("a signed link serves the image; a tampered one doesn't", async () => {
  const ok = await worker.fetch(new Request(link), env);
  assert.strictEqual(ok.status, 200);
  assert.deepStrictEqual([...new Uint8Array(await ok.arrayBuffer())], [1, 2, 3]);
  assert.strictEqual(ok.headers.get("Access-Control-Allow-Origin"), "*");
  const bad = await worker.fetch(new Request(link.replace(/s=./, "s=0")), env);
  assert.strictEqual(bad.status, 403);
  const unsigned = await call("/f/" + uploaded.path);
  assert.strictEqual(unsigned.status, 403);
});
await test("delete removes only the user's job files", async () => {
  store.set(`jobs/${OTHER}/after/x.jpg`, { bytes: new Uint8Array([0]), meta: { httpMetadata: {} } });
  const r = await call("/delete", { method: "POST", headers: { Authorization: "Bearer good", "Content-Type": "application/json" },
    body: JSON.stringify({ paths: [uploaded.path, uploaded.thumb_path, `jobs/${OTHER}/after/x.jpg`] }) });
  assert.deepStrictEqual(await r.json(), { deleted: 2 });
  assert.ok(!store.has(uploaded.path) && store.has(`jobs/${OTHER}/after/x.jpg`));
});
await test("CORS preflight answers the CRM's origin", async () => {
  const r = await call("/upload", { method: "OPTIONS", headers: { Origin: "https://stormshieldproroofing.github.io" } });
  assert.strictEqual(r.status, 204);
  assert.strictEqual(r.headers.get("Access-Control-Allow-Origin"), "https://stormshieldproroofing.github.io");
});

console.log(`\n${passed} passed`);
