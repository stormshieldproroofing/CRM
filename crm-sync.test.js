const assert = require('assert');
const sync = require('./crm-sync.js');

function expenseRow(overrides) {
  return Object.assign({
    id: '11111111-1111-4111-8111-111111111111',
    job_id: '22222222-2222-4222-8222-222222222222',
    category: 'Materials',
    description: 'ASO Roofing Supply',
    amount: '5597.24',
    created_at: '2026-10-06T15:04:00.000Z',
    vendor: null,
    vendor_name: 'ASO Roofing Supply',
    paid: true,
    paid_date: '2026-10-06',
    paid_method: null,
    paid_notes: null,
    breakdown: { __invoiceFile: { id: 'file-1', name: 'invoice.pdf' }, note: 'po' },
    src: null,
    vid: null,
    zoho_id: 'z1',
    zoho_amt: '5597.24',
    zoho_v: 1,
    eid: 'e-aso-big',
    exp_date: '2026-10-06',
    on_account: false,
  }, overrides);
}

function localFrom(row) {
  return sync.expenseFromRow(row);
}

function baselineOf(rows) {
  const locals = rows.map(localFrom);
  return sync.captureBaseline(locals, {
    keyOf: e => e._eid,
    rowIdOf: e => e._rowId,
    fingerprint: sync.expenseFingerprint,
  });
}

function planExpenses(local, server, baseline) {
  return sync.planKeyedSync(Object.assign({
    local, server, baseline: baseline || sync.emptyBaseline(),
  }, sync.expenseSyncSpec()));
}

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok', name);
}

test('expense payload omits created_at and id', () => {
  const row = expenseToCheck();
  const payload = sync.expenseToRow(sync.expenseFromRow(row));
  assert.strictEqual(Object.prototype.hasOwnProperty.call(payload, 'created_at'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(payload, 'id'), false);
  assert.strictEqual(payload.eid, 'e-aso-big');
  assert.strictEqual(payload.breakdown.__invoiceFile.name, 'invoice.pdf');
  assert.strictEqual(payload.amount, 5597.24);
});

function expenseToCheck() { return expenseRow(); }

test('round-trip fingerprint is stable', () => {
  const row = expenseRow();
  const local = sync.expenseFromRow(row);
  assert.strictEqual(sync.expenseFingerprint(local), sync.expenseSyncSpec().fingerprintServer(row));
  // Key order in breakdown must not look like an edit.
  const shuffled = expenseRow({
    breakdown: { note: 'po', __invoiceFile: { name: 'invoice.pdf', id: 'file-1' } },
  });
  assert.strictEqual(sync.expenseSyncSpec().fingerprintServer(row), sync.expenseSyncSpec().fingerprintServer(shuffled));
});

test('unchanged save writes nothing and deletes nothing', () => {
  const row = expenseRow();
  const local = [localFrom(row)];
  const plan = planExpenses(local, [row], baselineOf([row]));
  assert.deepStrictEqual(plan.writes, []);
  assert.deepStrictEqual(plan.deleteIds, []);
  assert.deepStrictEqual(plan.adopt, []);
  assert.deepStrictEqual(plan.dropKeys, []);
});

test('editing an expense updates that row id and does not insert', () => {
  const row = expenseRow();
  const local = [localFrom(row)];
  local[0].amount = '100.00';
  const plan = planExpenses(local, [row], baselineOf([row]));
  assert.strictEqual(plan.writes.length, 1);
  assert.strictEqual(plan.writes[0].existingId, row.id);
  assert.strictEqual(plan.writes[0].item._eid, 'e-aso-big');
  assert.strictEqual(sync.expenseToRow(plan.writes[0].item).created_at, undefined);
  assert.deepStrictEqual(plan.deleteIds, []);
});

test('stale tab does not resurrect a deleted expense or wipe a new one', () => {
  const oldDup = expenseRow({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', eid: 'e-old-dup', description: 'duplicate', amount: '10.00', created_at: '2026-10-01T00:00:00.000Z' });
  const kept = expenseRow();
  const fresh = expenseRow({
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    eid: 'e-new-receipt',
    description: 'Home Depot',
    amount: '42.15',
    created_at: '2026-10-09T18:00:00.000Z',
    breakdown: { __invoiceFile: { id: 'hd', name: 'hd.pdf' } },
  });
  // Session loaded oldDup + kept, then another session deleted oldDup and added fresh.
  const baseline = baselineOf([oldDup, kept]);
  const staleLocal = [localFrom(oldDup), localFrom(kept)];
  const serverNow = [kept, fresh];
  const plan = planExpenses(staleLocal, serverNow, baseline);
  assert.ok(!plan.writes.some(w => w.item._eid === 'e-old-dup'), 'must not reinsert the deleted eid');
  assert.ok(plan.dropKeys.includes('e-old-dup'));
  assert.ok(!plan.deleteIds.includes(fresh.id), 'must not delete the receipt this tab never loaded');
  assert.ok(plan.adopt.some(e => e._eid === 'e-new-receipt'));
  assert.deepStrictEqual(plan.deleteIds, []);
});

test('user delete removes only that row and keeps a database-inserted row', () => {
  const kept = expenseRow();
  const doomed = expenseRow({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', eid: 'e-doomed', description: 'remove me', amount: '1.00' });
  const inserted = expenseRow({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', eid: 'e-sql', description: 'added in SQL', amount: '9.00', created_at: '2026-10-09T12:00:00.000Z' });
  const baseline = baselineOf([kept, doomed]);
  const local = [localFrom(kept)];
  const plan = planExpenses(local, [kept, doomed, inserted], baseline);
  assert.deepStrictEqual(plan.deleteIds, [doomed.id]);
  assert.deepStrictEqual(plan.deleteKeys, ['e-doomed']);
  assert.ok(plan.adopt.some(e => e._eid === 'e-sql'));
  assert.ok(!plan.dropKeys.includes('e-sql'));
});

test('both sides edited the same eid: server wins, no write', () => {
  const row = expenseRow();
  const baseline = baselineOf([row]);
  const local = [localFrom(row)];
  local[0].amount = '1.00';
  const server = [expenseRow({ amount: '2.00', description: 'server edit' })];
  const plan = planExpenses(local, server, baseline);
  assert.deepStrictEqual(plan.writes, []);
  assert.strictEqual(plan.replace.length, 1);
  assert.strictEqual(plan.replace[0].item.amount, '2.00');
  assert.ok(plan.conflicts.some(c => c.reason === 'both-changed'));
});

test('server edit with no local edit is adopted and not written', () => {
  const row = expenseRow();
  const baseline = baselineOf([row]);
  const local = [localFrom(row)];
  const server = [expenseRow({ amount: '8.00' })];
  const plan = planExpenses(local, server, baseline);
  assert.deepStrictEqual(plan.writes, []);
  assert.strictEqual(plan.replace[0].item.amount, '8.00');
});

test('new local expense is an insert', () => {
  const row = expenseRow();
  const baseline = baselineOf([row]);
  const added = { cat: 'Returns', desc: 'credit', amount: '5.00', paid: true, _eid: 'e-return' };
  const plan = planExpenses([localFrom(row), added], [row], baseline);
  assert.strictEqual(plan.writes.length, 1);
  assert.strictEqual(plan.writes[0].existingId, null);
  assert.strictEqual(plan.writes[0].item._eid, 'e-return');
  assert.strictEqual(sync.expenseToRow(plan.writes[0].item).category, 'Returns');
});

test('duplicate server eids: update the newest and delete the extra', () => {
  const older = expenseRow({ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', created_at: '2026-10-01T00:00:00.000Z', amount: '1.00' });
  const newer = expenseRow({ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', created_at: '2026-10-08T00:00:00.000Z', amount: '5597.24' });
  const local = [localFrom(newer)];
  local[0].desc = 'edited';
  const baseline = baselineOf([newer]);
  const plan = planExpenses(local, [older, newer], baseline);
  assert.strictEqual(plan.writes.length, 1);
  assert.strictEqual(plan.writes[0].existingId, newer.id);
  assert.ok(plan.deleteIds.includes(older.id));
  assert.ok(!plan.deleteIds.includes(newer.id));
});

test('vid dedupe marks the dropped eid for deletion', () => {
  const a = localFrom(expenseRow({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', eid: 'e1', vid: 'v-same', amount: '10.00' }));
  const b = localFrom(expenseRow({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', eid: 'e2', vid: 'v-same', amount: '10.00', created_at: '2026-10-02T00:00:00.000Z' }));
  const baseline = sync.captureBaseline([a, b], {
    keyOf: e => e._eid, rowIdOf: e => e._rowId, fingerprint: sync.expenseFingerprint,
  });
  const deduped = sync.dedupeExpenses([a, b]);
  assert.strictEqual(deduped.kept.length, 1);
  assert.strictEqual(deduped.kept[0]._eid, 'e1');
  sync.noteRemovals(baseline, deduped.removedKeys, deduped.kept, e => e._eid);
  const server = [
    expenseRow({ id: a._rowId, eid: 'e1', vid: 'v-same', amount: '10.00' }),
    expenseRow({ id: b._rowId, eid: 'e2', vid: 'v-same', amount: '10.00', created_at: '2026-10-02T00:00:00.000Z' }),
  ];
  const plan = planExpenses(deduped.kept, server, baseline);
  assert.ok(plan.deleteIds.includes(b._rowId));
  assert.ok(!plan.deleteIds.includes(a._rowId));
  assert.ok(!plan.adopt.some(e => e._eid === 'e2'));
});

test('empty local list does not wipe rows this session never loaded', () => {
  const secret = expenseRow({ eid: 'e-never', id: '99999999-9999-4999-8999-999999999999' });
  const plan = planExpenses([], [secret], sync.emptyBaseline());
  assert.deepStrictEqual(plan.deleteIds, []);
  assert.strictEqual(plan.adopt.length, 1);
  assert.strictEqual(plan.adopt[0]._eid, 'e-never');
});

test('deposits follow the same rules', () => {
  const row = {
    id: 'd1111111-1111-4111-8111-111111111111',
    did: 'd-keep', amount: '500.00', description: 'ACV', pid: 'p1',
    dep_date: 'Oct 1, 2026', zoho_id: null, check_file: { name: 'check.jpg' },
    created_at: '2026-10-01T00:00:00.000Z',
  };
  const other = Object.assign({}, row, { id: 'd2222222-2222-4222-8222-222222222222', did: 'd-other', amount: '20.00', description: 'supp' });
  const local = [sync.depositFromRow(row)];
  const baseline = sync.captureBaseline(local, {
    keyOf: d => d._did, rowIdOf: d => d._rowId, fingerprint: sync.depositFingerprint,
  });
  local[0].amount = '550.00';
  const plan = sync.planKeyedSync(Object.assign({
    local, server: [row, other], baseline,
  }, sync.depositSyncSpec()));
  assert.strictEqual(plan.writes.length, 1);
  assert.strictEqual(plan.writes[0].existingId, row.id);
  assert.ok(!sync.depositToRow(plan.writes[0].item).created_at);
  assert.ok(plan.adopt.some(d => d._did === 'd-other'));
  assert.deepStrictEqual(plan.deleteIds, []);
});

test('checklist uncheck deletes only that item', () => {
  const doneRow = {
    id: 'c1111111-1111-4111-8111-111111111111',
    stage_id: 'contract', item_key: 'signed',
    completed_at: '2026-10-06T15:00:00.000Z',
    agent_id: 'u1', agent_name: 'Ada', agent_role: 'admin',
  };
  const other = Object.assign({}, doneRow, {
    id: 'c2222222-2222-4222-8222-222222222222', item_key: 'other-user',
  });
  const localRec = sync.checklistFromRow(doneRow);
  const baseline = sync.captureBaseline([localRec], {
    keyOf: r => sync.checklistKey(r.stageId, r.itemKey),
    rowIdOf: r => r._rowId,
    fingerprint: sync.checklistFingerprint,
  });
  const plan = sync.planKeyedSync(Object.assign({
    local: [], server: [doneRow, other], baseline,
  }, sync.checklistSyncSpec()));
  assert.deepStrictEqual(plan.deleteIds, [doneRow.id]);
  assert.ok(plan.adopt.some(r => r.itemKey === 'other-user'));
});

test('job deletes only ids this session loaded and the user removed', () => {
  const loaded = ['job-a', 'job-b'];
  const local = ['job-a', 'job-c']; // c is new, not loaded; b was deleted locally
  const remote = ['job-a', 'job-b', 'job-closed', 'job-other-tab'];
  const plan = sync.planIdDeletes(loaded, local, remote);
  assert.deepStrictEqual(plan.deleteIds, ['job-b']);
  assert.deepStrictEqual(plan.dropLocalIds, []);
  const gone = sync.planIdDeletes(loaded, loaded, ['job-a']);
  assert.deepStrictEqual(gone.dropLocalIds, ['job-b']);
  assert.deepStrictEqual(gone.deleteIds, []);
  assert.deepStrictEqual(sync.planIdDeletes(null, [], remote).deleteIds, []);
});

test('labor voucher fields and Returns category survive the payload', () => {
  const local = {
    cat: 'Roofing Labor', desc: 'Sub labor', amount: '800.00', paid: false,
    vendor: 'sub-1', vendorName: 'Crew', _src: 'subvoucher', _vid: 'v123', _eid: 'e-labor',
    breakdown: { squares: 20, pitch: '7' },
  };
  const payload = sync.expenseToRow(local);
  assert.strictEqual(payload.category, 'Roofing Labor');
  assert.strictEqual(payload.src, 'subvoucher');
  assert.strictEqual(payload.vid, 'v123');
  assert.strictEqual(payload.eid, 'e-labor');
  assert.strictEqual(payload.paid, false);
  assert.strictEqual(payload.breakdown.squares, 20);
  const credit = sync.expenseToRow({ cat: 'Returns', desc: 'refund', amount: '12.50', paid: true, _eid: 'e-ret' });
  assert.strictEqual(credit.category, 'Returns');
  assert.strictEqual(credit.amount, 12.5);
});

console.log(passed + ' tests passed');
