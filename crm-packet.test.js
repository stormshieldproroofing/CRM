const assert = require('assert');
const pk = require('./crm-packet.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok', name);
}

test('splitAddress: street, city/state, zip', () => {
  assert.deepStrictEqual(pk.splitAddress('4418 Shadow Creek Dr, Pearland, TX 77584'),
    { street: '4418 Shadow Creek Dr', cityState: 'Pearland, TX', zip: '77584' });
});

test('splitAddress: zip+4 and trailing USA', () => {
  assert.deepStrictEqual(pk.splitAddress('12 Elm St, Houston, TX 77089-1234, USA'),
    { street: '12 Elm St', cityState: 'Houston, TX', zip: '77089' });
});

test('splitAddress: empty or placeholder', () => {
  assert.deepStrictEqual(pk.splitAddress('—'), { street: '', cityState: '', zip: '' });
  assert.deepStrictEqual(pk.splitAddress(''), { street: '', cityState: '', zip: '' });
});

test('addBusinessDays skips weekends', () => {
  // Thu Oct 29 2026 + 3 business days = Tue Nov 3 2026
  const d = pk.addBusinessDays(new Date(2026, 9, 29, 15, 0), 3);
  assert.strictEqual(pk.fmtDate(d), '11/03/2026');
  // Mon + 3 = Thu
  assert.strictEqual(pk.fmtDate(pk.addBusinessDays(new Date(2026, 9, 26), 3)), '10/29/2026');
});

test('prefillFromJob maps job fields', () => {
  const f = pk.prefillFromJob({
    name: 'Maria Gonzales', address: '4418 Shadow Creek Dr, Pearland, TX 77584', phone: '832-555-0148',
    email: 'm@example.com', carrier: 'State Farm', policyNum: 'P1', claimNum: 'C9',
    dateOfLoss: '2026-09-18', deductible: '$2,850', adjName: 'Bob', adjPhone: '555'
  });
  assert.strictEqual(f.name, 'Maria Gonzales');
  assert.strictEqual(f.street, '4418 Shadow Creek Dr');
  assert.strictEqual(f.city_state, 'Pearland, TX');
  assert.strictEqual(f.zip, '77584');
  assert.strictEqual(f.insurance_company, 'State Farm');
  assert.strictEqual(f.date_of_loss, '09/18/2026');
  assert.strictEqual(f.deductible, '2,850');
});

test('pdfValues mirrors answers onto the authorization page', () => {
  const v = pk.pdfValues({ name: 'Maria', street: '1 A St', claim_number: 'C9', insurance_company: 'SF' });
  assert.strictEqual(v.text.tpa_insured_names, 'Maria');
  assert.strictEqual(v.text.tpa_property_address, '1 A St');
  assert.strictEqual(v.text.tpa_claim_number, 'C9');
  assert.strictEqual(v.text.tpa_insurance_company, 'SF');
  assert.ok(!('tpa_zip' in v.text), 'blank answers are not written');
});

test('pdfValues writes checkboxes and yes/no pairs', () => {
  const v = pk.pdfValues({ roof_hail: true, roof_wind: false, wind_slope_north: true, changed_insurance: 'no', prior_claim: 'yes', other_properties: '' });
  assert.ok(v.checks.includes('roof_hail'));
  assert.ok(!v.checks.includes('roof_wind'));
  assert.ok(v.checks.includes('wind_slope_north'));
  assert.ok(v.checks.includes('changed_insurance_no'));
  assert.ok(v.checks.includes('prior_claim_yes'));
  assert.ok(!v.checks.some(c => c.indexOf('other_properties') === 0));
});

test('missingForSigning lists required answers', () => {
  assert.deepStrictEqual(pk.missingForSigning({}), ['Owner name', 'Property street', 'Insurance company']);
  assert.deepStrictEqual(pk.missingForSigning({ name: 'A', street: 'B', insurance_company: 'C' }), []);
});

test('every field the packet writes exists in the PDF template', () => {
  const fs = require('fs');
  const zlib = require('zlib');
  const buf = fs.readFileSync(__dirname + '/StormShield_Claim_Packet.pdf');
  // Field names may sit inside compressed object streams: inflate every stream.
  let text = buf.toString('latin1');
  const sre = /stream\r?\n/g; let sm;
  while ((sm = sre.exec(text))) {
    const start = sm.index + sm[0].length;
    const end = text.indexOf('endstream', start);
    if (end < 0) break;
    try { text += zlib.inflateSync(buf.subarray(start, end)).toString('latin1'); } catch (e) { /* not deflated */ }
  }
  const names = new Set();
  const re = /\/T\s*\(([^)]*)\)/g; let m;
  // PDF literal strings may escape characters as \\ooo (e.g. _ as \\137)
  const unesc = t => t.replace(/\\([0-7]{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8))).replace(/\\(.)/g, '$1');
  while ((m = re.exec(text))) names.add(unesc(m[1]));
  const all = [].concat(pk.TEXT_FIELDS, pk.CHECK_FIELDS, Object.keys(pk.TPA_MIRROR),
    pk.YES_NO.map(q => q + '_yes'), pk.YES_NO.map(q => q + '_no'),
    ['key_initial_1', 'key_initial_2', 'key_initial_3', 'key_initial_4', 'key_initial_5', 'deductible_initials',
     'sig_homeowner', 'sig_coowner', 'sig_sspr', 'tpa_sig_insured1', 'tpa_sig_insured2',
     'homeowner_date', 'coowner_date', 'sspr_date', 'tpa_insured1_date', 'tpa_insured2_date',
     'tpa_insured1_printed_name', 'tpa_insured2_printed_name']);
  const missing = all.filter(n => !names.has(n));
  assert.deepStrictEqual(missing, []);
});

console.log(passed + ' passed');
