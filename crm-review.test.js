const assert = require('assert');
const rv = require('./crm-review.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok', name);
}

test('text matches the approved wording, with key point and photos', () => {
  const t = rv.buildText({ name: 'Maria', repName: 'Alex Rep', keyPoint: 'how fast we replaced the roof.', photoCount: 3 });
  assert.strictEqual(t,
    'Hi Maria, it’s Alex Rep with StormShield Pro Roofing. Thank you for trusting us with your roof! ' +
    'Would you mind leaving us a quick Google review? It really helps if you can add a couple photos of the new roof, ' +
    'mention my name and your neighborhood, and share a little about your experience, like how fast we replaced the roof. ' +
    'Here’s the link: https://g.page/r/CVR8aQYeseTWEBM/review . I’m sending a few photos of your roof you can use. Thank you!');
});

test('no key point and no photos drops those parts cleanly', () => {
  const t = rv.buildText({ name: 'Maria', repName: 'Alex Rep', keyPoint: '  ', photoCount: 0 });
  assert.ok(t.includes('share a little about your experience. Here’s the link:'));
  assert.ok(!t.includes(', like'));
  assert.ok(!t.includes('I’m sending a few photos'));
  assert.ok(t.endsWith(' Thank you!'));
});

test('missing homeowner or rep name still reads naturally', () => {
  const t = rv.buildText({});
  assert.ok(t.startsWith('Hi there, it’s StormShield Pro Roofing. '));
});

test('build is complete once the build date is reached', () => {
  const now = new Date(2026, 10, 13, 9, 0);
  assert.strictEqual(rv.isBuildComplete({ buildDate: '2026-11-12' }, now), true);
  assert.strictEqual(rv.isBuildComplete({ buildDate: '2026-11-13' }, now), true);
  assert.strictEqual(rv.isBuildComplete({ buildDate: '2026-11-14' }, now), false);
  assert.strictEqual(rv.isBuildComplete({ buildDate: '2026-11-12T00:00:00' }, now), true);
});

test('no build date: only after-build stages count', () => {
  assert.strictEqual(rv.isBuildComplete({ col: 'completed' }), true);
  assert.strictEqual(rv.isBuildComplete({ col: 'invoiced' }), true);
  assert.strictEqual(rv.isBuildComplete({ col: 'contract' }), false);
  assert.strictEqual(rv.isBuildComplete({ col: 'completed', buildDate: '2999-01-01' }), false);
  assert.strictEqual(rv.isBuildComplete(null), false);
});

test('status follows sent / posted', () => {
  assert.strictEqual(rv.statusOf({}), 'none');
  assert.strictEqual(rv.statusOf({ reviewReq: { sentAt: '2026-11-12T22:00:00Z' } }), 'sent');
  assert.strictEqual(rv.statusOf({ reviewReq: { sentAt: '2026-11-12T22:00:00Z', postedAt: '2026-11-13T01:00:00Z' } }), 'posted');
  assert.strictEqual(rv.statusOf({ reviewReq: { sentAt: '2026-11-12T22:00:00Z', postedAt: null } }), 'sent');
});

test('job photos are grouped and skip PDFs and empty records', () => {
  const g = rv.jobPhotos({ photos: { before: [{ url: 'a' }, { isPdf: true, url: 'b' }, null], during: [], after: [{ path: 'c' }, {}] } });
  assert.deepStrictEqual(g.map(x => [x.key, x.items.length]), [['before', 1], ['after', 1]]);
  assert.deepStrictEqual(rv.jobPhotos({}), []);
});

console.log(passed + ' passed');
