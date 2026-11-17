const assert = require('assert');
const fu = require('./crm-followups.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok', name);
}

const TODAY = '2026-11-17'; // a Tuesday
const at = (key, h) => new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)), h || 9).toISOString();

test('dayKey and addDays use local dates and cross month ends', () => {
  assert.strictEqual(fu.dayKey(new Date(2026, 10, 3, 23, 30)), '2026-11-03');
  assert.strictEqual(fu.addDays('2026-11-17', 1), '2026-11-18');
  assert.strictEqual(fu.addDays('2026-11-28', 7), '2026-12-05');
  assert.strictEqual(fu.addDays('2026-12-31', 1), '2027-01-01');
  assert.strictEqual(fu.daysBetween('2026-11-17', '2026-11-12'), -5);
});

test('validKey rejects junk and impossible dates', () => {
  assert.strictEqual(fu.validKey('2026-11-17'), true);
  assert.strictEqual(fu.validKey('2026-02-30'), false);
  assert.strictEqual(fu.validKey('11/17/2026'), false);
  assert.strictEqual(fu.validKey(undefined), false);
});

test('badge shows the weekday near today and the month further out', () => {
  assert.deepStrictEqual(fu.badge(TODAY, TODAY), { top: 'Tue', day: 17, late: false, lateDays: 0, today: true });
  const late = fu.badge('2026-11-12', TODAY);
  assert.strictEqual(late.top, 'Thu');
  assert.strictEqual(late.late, true);
  assert.strictEqual(late.lateDays, 5);
  const old = fu.badge('2026-07-25', TODAY);
  assert.strictEqual(old.top, 'Jul');
  assert.strictEqual(old.day, 25);
  assert.strictEqual(fu.badge('2026-12-20', TODAY).top, 'Dec');
});

test('build lists only jobs with a follow-up date — nothing automatic', () => {
  const jobs = [
    { id: 'a', name: 'No date, never contacted, 158 days old', created: 'Jun 12, 2026' },
    { id: 'b', name: 'Bravo', nextFollowUp: TODAY },
    { id: 'c', name: 'Charlie', nextFollowUp: '2026-11-12' },
    { id: 'd', name: 'Delta', nextFollowUp: '2026-11-20' },
    { id: 'e', name: 'Bad date', nextFollowUp: 'soon' },
  ];
  const r = fu.build(jobs, { today: TODAY });
  assert.deepStrictEqual(r.todo.map(x => x.job.id), ['c', 'b']); // most overdue first
  assert.deepStrictEqual(r.upcoming.map(x => x.job.id), ['d']);
  assert.strictEqual(r.done.length, 0);
});

test('build leaves out jobs in closed stages', () => {
  const jobs = [{ id: 'a', nextFollowUp: TODAY, col: 'completed' }, { id: 'b', nextFollowUp: TODAY, col: 'approved' }];
  const r = fu.build(jobs, { today: TODAY, isClosed: j => j.col === 'completed' });
  assert.deepStrictEqual(r.todo.map(x => x.job.id), ['b']);
});

test('setFollowUp stores the date, the need and the note', () => {
  const job = { id: 'a' };
  assert.strictEqual(fu.setFollowUp(job, { date: '2026-11-18', need: ' Adjuster:  supplement ', note: 'Sent Monday', by: 'Office', now: at(TODAY) }), true);
  assert.strictEqual(job.nextFollowUp, '2026-11-18');
  assert.strictEqual(job.followUp.need, 'Adjuster: supplement');
  assert.strictEqual(job.followUp.note, 'Sent Monday');
  assert.strictEqual(job.followUp.noteBy, 'Office');
  assert.strictEqual(fu.setFollowUp(job, { date: 'nope', need: 'x' }), false);
  assert.strictEqual(job.nextFollowUp, '2026-11-18');
});

test('setFollowUp without a need keeps the current one (date-only chips in notes)', () => {
  const job = { id: 'a', nextFollowUp: TODAY, followUp: { need: 'Collect deductible' } };
  fu.setFollowUp(job, { date: '2026-11-24' });
  assert.strictEqual(job.followUp.need, 'Collect deductible');
  const fresh = { id: 'b' };
  fu.setFollowUp(fresh, { date: '2026-11-24' });
  assert.strictEqual(fu.needOf(fresh), 'Follow up');
});

test('an old follow-up date with no need still reads as "Follow up"', () => {
  assert.strictEqual(fu.needOf({ nextFollowUp: '2026-07-25' }), 'Follow up');
});

test('reschedule moves the date and keeps the need', () => {
  const job = { id: 'a', nextFollowUp: TODAY, followUp: { need: 'Submit final invoice' } };
  fu.reschedule(job, '2026-11-24');
  assert.strictEqual(job.nextFollowUp, '2026-11-24');
  assert.strictEqual(job.followUp.need, 'Submit final invoice');
  assert.strictEqual(fu.reschedule(job, ''), false);
  assert.strictEqual(job.nextFollowUp, '2026-11-24');
});

test('complete takes the job off the list and shows it under done today', () => {
  const job = { id: 'a', name: 'Alpha', nextFollowUp: TODAY, followUp: { need: 'Carrier: depreciation release' } };
  const entry = fu.complete(job, { note: 'Check mails Friday', by: 'Office', now: at(TODAY, 10) });
  assert.strictEqual(entry.need, 'Carrier: depreciation release');
  assert.strictEqual(job.nextFollowUp, undefined);
  assert.strictEqual(job.followUp.need, undefined);
  const r = fu.build([job], { today: TODAY });
  assert.strictEqual(r.todo.length, 0);
  assert.strictEqual(r.done.length, 1);
  assert.strictEqual(r.done[0].entry.note, 'Check mails Friday');
  // yesterday's done items don't show today
  assert.strictEqual(fu.build([job], { today: '2026-11-18' }).done.length, 0);
});

test('done history is capped', () => {
  const job = { id: 'a' };
  for (let i = 0; i < 40; i++) { job.nextFollowUp = TODAY; fu.complete(job, { now: at(TODAY, 1) }); }
  assert.strictEqual(job.followUp.done.length, 30);
});

test('reopen puts a done follow-up back on today with the same need', () => {
  const job = { id: 'a', nextFollowUp: TODAY, followUp: { need: 'Schedule build' } };
  const entry = fu.complete(job, { now: at(TODAY, 11) });
  assert.strictEqual(fu.reopen(job, entry.at, TODAY), true);
  assert.strictEqual(job.nextFollowUp, TODAY);
  assert.strictEqual(job.followUp.need, 'Schedule build');
  assert.strictEqual(job.followUp.done.length, 0);
  assert.strictEqual(fu.reopen(job, 'missing', TODAY), false);
});

test('lastUpdate picks the newest note from the follow-up or the contact log', () => {
  assert.strictEqual(fu.lastUpdate({}), null);
  const job = {
    followUp: { note: 'Asked for the loss statement', noteAt: at('2026-11-10'), noteBy: 'Rep' },
    contactLog: [
      { at: at('2026-11-06'), note: 'Left a voicemail', by: 'Office' },
      { at: at('2026-11-12'), note: 'Adjuster says this week', by: 'Office' },
      { at: at('2026-11-13'), note: '', by: 'Office' },
    ],
  };
  assert.strictEqual(fu.lastUpdate(job).text, 'Adjuster says this week');
  job.followUp.noteAt = at('2026-11-14');
  assert.strictEqual(fu.lastUpdate(job).text, 'Asked for the loss statement');
});

test('niceDay reads naturally', () => {
  assert.strictEqual(fu.niceDay(TODAY, TODAY), 'today');
  assert.strictEqual(fu.niceDay('2026-11-18', TODAY), 'tomorrow');
  assert.strictEqual(fu.niceDay('2026-11-24', TODAY), 'Tue, Nov 24');
});

console.log(passed + ' passed');
