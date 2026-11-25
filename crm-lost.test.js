const assert = require('assert');
const lost = require('./crm-lost.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok', name);
}

test('lost stage: found by name or id, whatever the pipeline calls the others', () => {
  assert.strictEqual(lost.isLostStage({ id: 'lost-lead-1782793913331', name: 'Lost Lead' }), true);
  assert.strictEqual(lost.isLostStage({ id: 'x-123', name: 'LOST LEAD' }), true);
  assert.strictEqual(lost.isLostStage({ id: 'lost_lead', name: 'Dead' }), true);
  assert.strictEqual(lost.isLostStage({ id: 'lead', name: 'Lead' }), false);
  assert.strictEqual(lost.isLostStage({ id: 'closed-denied', name: 'Closed – Denied' }), false);
  assert.strictEqual(lost.isLostStage(null), false);
  assert.strictEqual(lost.lostStageOf([{ id: 'lead', name: 'Lead' }, { id: 'q', name: 'Lost Lead' }]).id, 'q');
  assert.strictEqual(lost.lostStageOf([{ id: 'lead', name: 'Lead' }]), null);
});

test('try again: never, 3 and 6 calendar months, or the date picked', () => {
  const nov24 = new Date(2026, 10, 24);
  assert.strictEqual(lost.tryAgainDate('never', nov24), null);
  assert.strictEqual(lost.tryAgainDate('', nov24), null);
  assert.strictEqual(lost.tryAgainDate('3m', nov24), '2027-02-24');
  assert.strictEqual(lost.tryAgainDate('6m', nov24), '2027-05-24');
  assert.strictEqual(lost.tryAgainDate('2027-01-15', nov24), '2027-01-15');
  // the 31st of a short month lands on its last day, not in the month after
  assert.strictEqual(lost.tryAgainDate('3m', new Date(2026, 10, 30)), '2027-02-28');
  assert.strictEqual(lost.tryAgainDate('6m', new Date(2026, 7, 31)), '2027-02-28');
});

test('dates read the way the CRM shows them', () => {
  assert.strictEqual(lost.niceDate('2027-05-24'), 'May 24, 2027');
  assert.strictEqual(lost.niceDate('2027-05-04', true), 'May 4');
  assert.strictEqual(lost.niceDate(''), '');
});

test('record: keeps the stage it was lost from; supplement answer only for a low check', () => {
  const r = lost.makeRecord({ reason: 'check-low', note: '  not enough to do the roof ', from: 'approved', fromName: 'Approved', by: 'Office', supplementTried: true, tryAgain: '2027-05-24', at: '2026-11-24T22:00:00.000Z' });
  assert.deepStrictEqual(r, { reason: 'check-low', note: 'not enough to do the roof', from: 'approved', fromName: 'Approved', at: '2026-11-24T22:00:00.000Z', by: 'Office', supplementTried: true, tryAgain: '2027-05-24' });
  assert.strictEqual(lost.makeRecord({ reason: 'deductible', supplementTried: true }).supplementTried, null);
  assert.strictEqual(lost.makeRecord({ reason: 'check-low' }).supplementTried, null);   // not answered
  assert.strictEqual(lost.makeRecord({ reason: 'made-up' }).reason, 'other');
  assert.strictEqual(lost.makeRecord({ reason: 'other' }).tryAgain, null);
});

test('list: soonest try-again first, then no date (newest lost first)', () => {
  const j = (id, tryAgain, at) => ({ id, lost: { reason: 'other', tryAgain, at } });
  const out = lost.sortLost([j('none-old', null, '2026-09-01'), j('may', '2027-05-24', '2026-11-24'), j('none-new', null, '2026-11-03'), j('dec', '2026-12-02', '2026-09-02'), { id: 'bare' }]);
  assert.deepStrictEqual(out.map(x => x.id), ['dec', 'may', 'none-new', 'none-old', 'bare']);
});

test('counts: per reason in list order; jobs lost before this existed count as "No reason"', () => {
  const j = reason => ({ lost: reason ? { reason } : null });
  const c = lost.countReasons([j('deductible'), j('check-low'), j('check-low'), j(null), j('no-response'), j('deductible'), j('check-low')]);
  assert.deepStrictEqual(c, [
    { id: 'check-low', short: 'Check too low', n: 3 },
    { id: 'deductible', short: 'Deductible too high', n: 2 },
    { id: 'no-response', short: 'Stopped responding', n: 1 },
    { id: 'none', short: 'No reason', n: 1 },
  ]);
  assert.deepStrictEqual(lost.countReasons([]), []);
});

test('reasons: six, each with a short name for the list', () => {
  assert.strictEqual(lost.REASONS.length, 6);
  assert.ok(lost.REASONS.every(r => r.id && r.label && r.short));
  assert.strictEqual(lost.reasonLabel('deductible'), 'Deductible too high');
  assert.strictEqual(lost.reasonLabel('nope'), 'No reason given');
});

console.log(`\n${passed} passed`);
