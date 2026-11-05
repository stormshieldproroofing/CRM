import assert from "node:assert";
import { isPhotoKey, jobIdFromPath, newPhotoKeys, signPath, verifySignature } from "./src/sign.js";

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("ok", name); }

const JOB = "3f2c1a9e-1234-4abc-9def-0123456789ab";

await test("new keys sit under the job and section, with a thumbs copy", () => {
  const k = newPhotoKeys(JOB, "before", new Date(Date.UTC(2026, 10, 4, 21, 5, 9)), "abcd1234-0000-0000-0000-000000000000");
  assert.strictEqual(k.path, `jobs/${JOB}/before/20261104-210509-abcd1234.jpg`);
  assert.strictEqual(k.thumbPath, `jobs/${JOB}/before/thumbs/20261104-210509-abcd1234.jpg`);
  assert.ok(isPhotoKey(k.path) && isPhotoKey(k.thumbPath));
});

await test("job id is read from the key; bad keys are refused", () => {
  assert.strictEqual(jobIdFromPath(`jobs/${JOB}/after/x.jpg`), JOB);
  assert.strictEqual(jobIdFromPath(`jobs/${JOB}/roof/x.jpg`), null);
  assert.strictEqual(jobIdFromPath(`jobs/${JOB}/after/../../x.jpg`), null);
  assert.strictEqual(jobIdFromPath(`other/${JOB}/after/x.jpg`), null);
  assert.strictEqual(jobIdFromPath(null), null);
});

await test("signed links verify, and expire", async () => {
  const p = `jobs/${JOB}/during/20261104-210509-abcd1234.jpg`;
  const exp = 2_000_000_000;
  const url = new URL(await signPath("https://w.example", "s3cret", p, exp));
  assert.strictEqual(decodeURIComponent(url.pathname.slice(3)), p);
  const s = url.searchParams.get("s");
  assert.ok(await verifySignature("s3cret", p, exp, s, 1_900_000_000));
  assert.ok(!(await verifySignature("s3cret", p, exp, s, 2_000_000_001)), "expired");
  assert.ok(!(await verifySignature("other", p, exp, s, 1_900_000_000)), "wrong secret");
  assert.ok(!(await verifySignature("s3cret", p.replace("during", "after"), exp, s, 1_900_000_000)), "other path");
  assert.ok(!(await verifySignature("s3cret", p, exp + 1, s, 1_900_000_000)), "changed expiry");
});

console.log(`\n${passed} passed`);
