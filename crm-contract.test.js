const assert = require('assert');
const ct = require('./crm-contract.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok', name);
}

test('every checkbox key is unique and every qty key is reachable from a checkbox', () => {
  assert.strictEqual(new Set(ct.CHECK_KEYS).size, ct.CHECK_KEYS.length);
  const owned = [].concat(...Object.values(ct.GROUPS)).map(x => x[2]).filter(Boolean);
  ct.QTY_KEYS.forEach(k => assert.ok(owned.includes(k), k + ' has a checkbox'));
});

test('ensureContract fills in the parts of an old-style contract', () => {
  const j = { contract: { customer: 'Huy Nguyen', checks: { shingles_tamko_3: true } } };
  const c = ct.ensureContract(j);
  assert.strictEqual(c.sign.status, 'draft');
  assert.strictEqual(c.addl.length, 8);
  assert.strictEqual(c.addl[0], 'Project manager on site');
  assert.deepStrictEqual(c.qty, {});
  assert.deepStrictEqual(j.signedContractFiles, []);
  // a contract already marked signed stays signed
  const k = { contract: { sign: { signed: { at: 'x' } } } };
  assert.strictEqual(ct.ensureContract(k).sign.status, 'signed');
});

test('prefillFromJob fills only the blanks, from the job', () => {
  const j = { name: 'Huy Hoang Nguyen', address: '10439 Acacia Forest Trl, Houston, TX 77089', phone: '832-903-4796', email: '',
    rcv: '$14213.93', deductible: '2850', recoverableDep: '0', netClaim: '', buildDate: '2026-10-15T00:00:00', contract: { cell: '713-000-0000' } };
  const filled = ct.prefillFromJob(j);
  const c = j.contract;
  assert.strictEqual(c.customer, 'Huy Hoang Nguyen');
  assert.strictEqual(c.street, '10439 Acacia Forest Trl');
  assert.strictEqual(c.citystatezip, 'Houston, TX 77089');
  assert.strictEqual(c.cell, '713-000-0000', 'existing answer kept');
  assert.strictEqual(c.rcv, '14213.93');
  assert.strictEqual(c.deductible, '2850');
  assert.strictEqual(c.depreciation, undefined, 'a zero is not an answer');
  assert.strictEqual(c.buildDate, '2026-10-15');
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(c.contractDate));
  assert.ok(filled.includes('customer') && !filled.includes('cell'));
  // never touches a signed contract
  const s = { name: 'New Name', contract: { customer: '', sign: { status: 'signed' } } };
  assert.deepStrictEqual(ct.prefillFromJob(s), []);
  assert.strictEqual(s.contract.customer, '');
});

test('contractFields maps the form to the PDF field names', () => {
  const f = ct.contractFields({
    customer: ' Huy Nguyen ', street: '10439 Acacia Forest Trl', contractDate: '2026-09-26', buildDate: '',
    rcv: '14,213.93', netClaim: '', addl: ['Project manager on site', '', '', '', '', '', '', '', 'ninth'],
    checks: { shingles_tamko_3: true, colors_10: true, warranty_lifetime: false, not_a_field: true },
    qty: { vent_ridge_lf: '42', shingles_other: '' }
  });
  assert.strictEqual(f.customer, 'Huy Nguyen');
  assert.strictEqual(f.contract_date, '09/26/2026');
  assert.strictEqual(f.build_date, undefined);
  assert.strictEqual(f.rcv, '14,213.93');
  assert.strictEqual(f.net_claim, undefined);
  assert.strictEqual(f.addl_1, 'Project manager on site');
  assert.strictEqual(f.addl_9, undefined);
  assert.strictEqual(f.shingles_tamko_3, true);
  assert.strictEqual(f.colors_10, true);
  assert.strictEqual(f.warranty_lifetime, undefined);
  assert.strictEqual(f.not_a_field, undefined);
  assert.strictEqual(f.vent_ridge_lf, '42');
  assert.strictEqual(f.shingles_other, undefined);
});

test('missingForSigning only blocks on the customer and the street', () => {
  assert.deepStrictEqual(ct.missingForSigning({}), ['Customer name', 'Street address']);
  assert.deepStrictEqual(ct.missingForSigning({ customer: 'A', street: '1 Main' }), []);
});

test('sectionMissing badges', () => {
  const m = ct.sectionMissing({ customer: 'A', street: '1 Main', citystatezip: '', cell: '', rcv: '',
    checks: { shingles_tamko_6: true, colors_10: true, warranty_lifetime: true }, qty: {} });
  assert.deepStrictEqual(m.customer, ['citystatezip', 'cell']);
  assert.deepStrictEqual(m.specs, ['shingles_other']);
  assert.deepStrictEqual(m.payment, ['rcv']);
  const ok = ct.sectionMissing({ customer: 'A', street: 'S', citystatezip: 'C', cell: '1', rcv: '5', checks: { shingles_tamko_3: true, colors_1: true, warranty_standard: true } });
  assert.deepStrictEqual(ok, { customer: [], specs: [], payment: [] });
});

test('specSummary reads the chosen shingle and color', () => {
  assert.strictEqual(ct.specSummary({ checks: { shingles_tamko_1: true, shingles_tamko_3: true, colors_10: true } }), 'Tamko Titan XT · Weathered Wood');
  assert.strictEqual(ct.specSummary({ checks: { shingles_certainteed_2: true, colors_11: true }, qty: { color_other: 'Driftwood' } }), 'CertainTeed Landmark · Driftwood');
  assert.strictEqual(ct.specSummary({}), '');
});

test('splitAddress', () => {
  assert.deepStrictEqual(ct.splitAddress('10439 Acacia Forest Trl, Houston, TX 77089, USA'), { street: '10439 Acacia Forest Trl', cityStateZip: 'Houston, TX 77089' });
  assert.deepStrictEqual(ct.splitAddress('—'), { street: '', cityStateZip: '' });
});

console.log(passed + ' passed');
