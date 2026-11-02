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

test('sectionMissing counts blanks per section and follow-ups only when Yes', () => {
  const empty = pk.sectionMissing({});
  assert.deepStrictEqual(empty.client, ['name', 'street', 'city_state', 'zip', 'cell_phone']);
  assert.strictEqual(empty.project.length, 3);
  assert.deepStrictEqual(empty.loss, ['roof_loss']);
  const f = { name: 'A', street: 'B', city_state: 'C', zip: '1', cell_phone: '2', changed_insurance: 'yes', prior_claim: 'no', other_properties: 'no',
    roof_hail: true, insurance_company: 'SF', policy_number: '9', date_of_loss: '09/18/2026' };
  const m = pk.sectionMissing(f);
  assert.deepStrictEqual(m, { client: [], project: ['prior_insurance'], loss: [], insurance: [] });
  f.prior_insurance = 'Allstate';
  assert.deepStrictEqual(pk.sectionMissing(f).project, []);
});

test('packet ↔ job: only empty fields fill, both ways', () => {
  const j = { name: 'Maria Gonzalez', address: '4318 Briar Hollow Ln, Pearland, TX 77584', carrier: 'Allstate', claimNum: '0412-898',
    dateOfLoss: '2026-05-14', deductible: '1000', policyNum: '', adjName: '', adjPhone: '',
    packet: { status: 'draft', fields: { policy_number: 'A-882-41907', claim_number: '0412-889', adjuster: 'Kevin Park', date_of_loss: '' } } };
  const toPk = pk.fillPacketFromJob(j);
  assert.strictEqual(j.packet.fields.insurance_company, 'Allstate');
  assert.strictEqual(j.packet.fields.date_of_loss, '05/14/2026');
  assert.strictEqual(j.packet.fields.deductible, '1000');
  assert.strictEqual(j.packet.fields.street, '4318 Briar Hollow Ln');
  assert.strictEqual(j.packet.fields.claim_number, '0412-889', 'a filled packet answer is never overwritten');
  assert.ok(toPk.indexOf('claim_number') < 0);
  pk.fillJobFromPacket(j);
  assert.strictEqual(j.policyNum, 'A-882-41907');
  assert.strictEqual(j.adjName, 'Kevin Park');
  assert.strictEqual(j.claimNum, '0412-898', 'a filled job detail is never overwritten');
});

test('packet ↔ job: mismatches ignore formatting, and Keep hides them', () => {
  const j = { phone: '(281) 555-0142', adjPhone: '713-555-0188 x2205', dateOfLoss: '2026-05-14', deductible: '$1,000.00', claimNum: '0412-898', carrier: 'allstate ',
    packet: { status: 'draft', fields: { cell_phone: '281.555.0142', adjuster_phone: '7135550188', date_of_loss: '05/14/2026', deductible: '1000',
      claim_number: '0412-889', insurance_company: 'Allstate' } } };
  const m = pk.syncMismatches(j);
  assert.deepStrictEqual(m.map(x => x.pk), ['claim_number']);
  j.packet.syncKeep = { claim_number: pk.syncNorm('id', '0412-889') + '|' + pk.syncNorm('id', '0412-898') };
  assert.strictEqual(pk.syncMismatches(j).length, 0);
  j.claimNum = '0412-999';   // changes again → note comes back
  assert.strictEqual(pk.syncMismatches(j).length, 1);
});

test('packet ↔ job: a signed packet is never changed, but still fills the job', () => {
  const j = { carrier: 'Allstate', policyNum: '', packet: { status: 'signed', fields: { insurance_company: '', policy_number: 'P-1' } } };
  assert.deepStrictEqual(pk.fillPacketFromJob(j), []);
  assert.strictEqual(j.packet.fields.insurance_company, '');
  pk.fillJobFromPacket(j);
  assert.strictEqual(j.policyNum, 'P-1');
});

console.log(passed + ' passed');
