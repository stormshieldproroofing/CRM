const assert = require('assert');
const certs = require('./crm-certs.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok', name);
}

const thien = {
  id: '358bc858-f4e8-447a-a39d-9fd721f8ca68',
  name: 'Thien Nguyen',
  address: '10011 Clarkbrook Dr, Houston, TX, 77089',
  buildDate: '2026-10-10',
};
const assets = { logoUrl: 'https://example.test/cert-logo.png', signatureUrl: 'data:image/png;base64,AAAA', signerName: 'Matthew Trinh', company: { name: 'StormShield Pro Roofing', phone: '(832) 910-7735' } };

test('cleans the comma before the ZIP code', () => {
  assert.strictEqual(certs.cleanAddress('10011 Clarkbrook Dr, Houston, TX, 77089'), '10011 Clarkbrook Dr, Houston, TX 77089');
  assert.strictEqual(certs.cleanAddress('—'), '');
});

test('warranty defaults come from the job: owner, address, build date', () => {
  const d = certs.warrantyData(thien, '2026-11-09');
  assert.strictEqual(d.owner, 'Thien Nguyen');
  assert.strictEqual(d.addr, '10011 Clarkbrook Dr, Houston, TX 77089');
  assert.strictEqual(d.installDate, 'October 10, 2026');
  assert.strictEqual(d.issuedDate, 'October 10, 2026', 'date issued defaults to the installation date');
  assert.strictEqual(d.certNo, 'SSPR-2026-10011');
  assert.strictEqual(d.signed, true);
});

test('saved warranty choices win over job defaults', () => {
  const job = Object.assign({}, thien, { warranty: { owner: 'Thien & Lan Nguyen', issuedDate: '2026-11-09', certNo: 'X-1', signed: false } });
  const d = certs.warrantyData(job, '2026-11-09');
  assert.strictEqual(d.owner, 'Thien & Lan Nguyen');
  assert.strictEqual(d.issuedDate, 'November 9, 2026');
  assert.strictEqual(d.certNo, 'X-1');
  assert.strictEqual(d.signed, false);
});

test('a job with no build date leaves the install date blank', () => {
  const d = certs.warrantyData({ id: 'abc', name: 'A', address: '' }, '2026-11-09');
  assert.strictEqual(d.installDate, '');
  assert.strictEqual(d.certNo, 'SSPR-2026-0000');
});

test('warranty certificate prints the owner, signature, and no homeowner signature line', () => {
  const html = certs.warrantyHtml(certs.warrantyData(thien, '2026-11-09'), assets);
  assert.ok(html.includes('Lifetime Workmanship<br>Warranty'));
  assert.ok(html.includes('Thien Nguyen'));
  assert.ok(html.includes('SSPR-2026-10011'));
  assert.ok(html.includes(assets.signatureUrl));
  assert.ok(html.includes('Date Issued'));
  assert.ok(!/Homeowner Signature/i.test(html));
  assert.ok(!/complimentary/i.test(html), 'the 3-year checkup section stays out');
});

test('unsigned warranty leaves the signature line empty', () => {
  const job = Object.assign({}, thien, { warranty: { signed: false } });
  const html = certs.warrantyHtml(certs.warrantyData(job, '2026-11-09'), assets);
  assert.ok(!html.includes(assets.signatureUrl));
});

test('names are escaped', () => {
  const job = Object.assign({}, thien, { name: '<b>x</b>' });
  const html = certs.warrantyHtml(certs.warrantyData(job, '2026-11-09'), assets);
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;'));
});

test('certificate of completion uses the same license layout and keeps its details', () => {
  const d = {
    customer: 'Thien Nguyen', addr: thien.address, compISO: '2026-10-10', compDate: 'October 10, 2026',
    certNo: 'SSP-2026-4517', rep: 'Sang Nguyen', warrYears: 5, mfrWarranty: '', material: 'Owens Corning Duration',
    color: 'Driftwood', scope: 'Complete roof replacement.', notes: '', signed: true, claimNum: '123',
    policyNum: '', carrier: 'State Farm', dateOfLoss: '', ci: assets.company,
  };
  const html = certs.completionHtml(d, Object.assign({}, assets, { photos: [{ url: 'https://example.test/p1.jpg' }] }));
  assert.ok(html.includes('<h1>Completion</h1>'));
  assert.ok(html.includes('10011 Clarkbrook Dr, Houston, TX 77089'));
  assert.ok(html.includes('State Farm'));
  assert.ok(html.includes('Owens Corning Duration'));
  assert.ok(html.includes('5 years'));
  assert.ok(html.includes('CERTIFIED COMPLETE'));
  assert.ok(html.includes('Completion Photo 1 of 1'));
  assert.ok(!html.includes('Policy No.'), 'empty fields are left off');
});

console.log(`${passed} certificate tests passed`);
