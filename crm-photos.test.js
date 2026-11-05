const assert = require('assert');
const photos = require('./crm-photos.js');

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('ok', name); }

(async () => {
  await test('fitSize shrinks the long side and never enlarges', () => {
    assert.deepStrictEqual(photos.fitSize(4032, 3024, 1600), { w: 1600, h: 1200 });
    assert.deepStrictEqual(photos.fitSize(3024, 4032, 1600), { w: 1200, h: 1600 });
    assert.deepStrictEqual(photos.fitSize(800, 600, 1600), { w: 800, h: 600 });
    assert.deepStrictEqual(photos.fitSize(0, 0, 360), { w: 1, h: 1 });
  });

  await test('stamp shows date, time and street only', () => {
    const t = photos.stampText(new Date(2026, 10, 4, 21, 7), '123 Main St, Pearland, TX 77584');
    assert.strictEqual(t, 'Nov 4, 2026 9:07 PM · 123 Main St');
    assert.strictEqual(photos.stampText(new Date(2026, 0, 1, 0, 5), '—'), 'Jan 1, 2026 12:05 AM');
  });

  await test('file names describe the job, section and time', () => {
    const job = { name: 'Jane Doe', address: '123 Main St, Pearland, TX' };
    assert.strictEqual(photos.photoFileName(job, 'after', new Date(2026, 10, 4, 9, 3), 7),
      'Jane Doe - 123 Main St - After Photo - 2026-11-04 - 0903-07.jpg');
    assert.strictEqual(photos.photoFileName({ name: '—', address: 'A/B "x"' }, 'nope', new Date(2026, 0, 2, 3, 4), 1),
      'AB x - Before Photo - 2026-01-02 - 0304-01.jpg');
  });

  await test('share tokens are long, url-safe and unique', () => {
    const a = photos.makeToken(), b = photos.makeToken();
    assert.ok(/^[A-Za-z0-9_-]{43}$/.test(a), a);
    assert.notStrictEqual(a, b);
  });

  await test('share token hash is hex SHA-256 (matches the edge function)', async () => {
    assert.strictEqual(await photos.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  await test('share link points at photos.html next to the CRM', () => {
    const loc = { origin: 'https://stormshieldproroofing.github.io', pathname: '/CRM/index.html' };
    assert.strictEqual(photos.shareUrl('tok_1', loc), 'https://stormshieldproroofing.github.io/CRM/photos.html?t=tok_1');
    assert.strictEqual(photos.shareUrl('x', { origin: 'https://a.b', pathname: '/CRM/' }), 'https://a.b/CRM/photos.html?t=x');
  });

  await test('link expiry choices', () => {
    const now = Date.UTC(2026, 10, 4);
    assert.strictEqual(photos.expiresAt('7', now), new Date(now + 7 * 864e5).toISOString());
    assert.strictEqual(photos.expiresAt('30', now), new Date(now + 30 * 864e5).toISOString());
    assert.strictEqual(photos.expiresAt('never', now), null);
  });

  await test('missing-column errors are recognised (migration not applied yet)', () => {
    assert.ok(photos.isMissingColumn({ code: 'PGRST204', message: "Could not find the 'thumb_path' column of 'job_files'" }));
    assert.ok(photos.isMissingColumn({ code: '42703', message: 'column "storage" does not exist' }));
    assert.ok(!photos.isMissingColumn({ code: '42501', message: 'permission denied' }));
    assert.ok(!photos.isMissingColumn(null));
  });

  await test('job_files row carries storage, thumbnail and location', () => {
    const r = photos.jobRow({ jobId: 'j1', section: 'during', name: 'n.jpg', path: 'p', storage: 'r2', thumbPath: 't', takenAt: 'x', lat: 29.5, lng: -95.2, takenBy: 'a@b.c' });
    assert.deepStrictEqual(r, { job_id: 'j1', kind: 'photo', section: 'during', name: 'n.jpg', storage_path: 'p', storage: 'r2', thumb_path: 't', taken_at: 'x', lat: 29.5, lng: -95.2, taken_by: 'a@b.c' });
  });

  await test('R2 is off until the worker URL is set', () => {
    assert.strictEqual(photos.usesR2(), false);
    globalThis.PHOTO_WORKER_URL = 'https://stormshield-photos.example.workers.dev/';
    assert.strictEqual(photos.usesR2(), true);
    assert.strictEqual(photos.workerUrl(), 'https://stormshield-photos.example.workers.dev');
    delete globalThis.PHOTO_WORKER_URL;
  });

  await test('esc escapes html', () => {
    assert.strictEqual(photos.esc(`<a href="x">'&`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  });

  console.log(`\n${passed} passed`);
})().catch(e => { console.error(e); process.exit(1); });
