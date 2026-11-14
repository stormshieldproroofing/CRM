const assert = require('assert');
const wc = require('./crm-weekcal.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok', name);
}

test('dayKey uses the local date, zero padded', () => {
  assert.strictEqual(wc.dayKey(new Date(2026, 10, 3)), '2026-11-03');
});

test('shiftMonth crosses year boundaries both ways', () => {
  assert.strictEqual(wc.shiftMonth('2026-12', 1), '2027-01');
  assert.strictEqual(wc.shiftMonth('2026-01', -1), '2025-12');
  assert.strictEqual(wc.shiftMonth('2026-11', 0), '2026-11');
});

test('monthCells returns whole weeks starting on Sunday', () => {
  const nov = wc.monthCells(2026, 11); // Nov 1 2026 is a Sunday
  assert.strictEqual(nov.length, 35);
  assert.strictEqual(nov[0].key, '2026-11-01');
  assert.strictEqual(nov[29].key, '2026-11-30');
  assert.strictEqual(nov[30].inMonth, false);
  assert.strictEqual(nov[30].key, '2026-12-01');
  const aug = wc.monthCells(2026, 8); // Aug 1 2026 is a Saturday, needs 6 weeks
  assert.strictEqual(aug.length, 42);
  assert.strictEqual(aug[0].key, '2026-07-26');
  assert.strictEqual(aug[6].key, '2026-08-01');
  assert.ok(aug.every((c, i) => new Date(c.key + 'T12:00:00').getDay() === i % 7));
});

test('eventsByDay collects builds and booked appointments, builds first then by time', () => {
  const kinds = {
    inspection: { label: 'Adjuster inspection', color: '#FB923C' },
    closing: { label: 'Closing', color: '#A78BFA' },
  };
  const apptGet = (j, kind) => (j.appts && j.appts[kind]) || {};
  const jobs = [
    { id: 'a', buildDate: '2026-11-12T00:00:00', appts: { closing: { date: '2026-11-12', time: '17:30' } } },
    { id: 'b', appts: { inspection: { date: '2026-11-12', time: '09:00' }, closing: { date: '' } } },
    { id: 'c' },
    null,
  ];
  const by = wc.eventsByDay(jobs, kinds, apptGet);
  assert.deepStrictEqual(Object.keys(by), ['2026-11-12']);
  assert.deepStrictEqual(by['2026-11-12'].map(e => e.kind + ':' + e.j.id), ['build:a', 'inspection:b', 'closing:a']);
  assert.strictEqual(by['2026-11-12'][0].color, wc.BUILD_COLOR);
});

test('eventsByDay tolerates missing inputs', () => {
  assert.deepStrictEqual(wc.eventsByDay(null, null, null), {});
  assert.deepStrictEqual(wc.eventsByDay([{ buildDate: '2026-11-01' }], {}, undefined)['2026-11-01'].length, 1);
});

test('dayDots gives distinct colors, capped', () => {
  const evs = [{ color: 'a' }, { color: 'a' }, { color: 'b' }, { color: 'c' }, { color: 'd' }];
  assert.deepStrictEqual(wc.dayDots(evs, 3), ['a', 'b', 'c']);
  assert.deepStrictEqual(wc.dayDots([], 3), []);
});

console.log(passed + ' passed');
