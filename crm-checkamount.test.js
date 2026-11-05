const assert = require('assert');
const ca = require('./crm-checkamount.js');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok', name); }
const amt = t => ca.parse(t).amount;

// The check that misread: handwritten $18500.⁰⁰, memo "17023 Great Glen", address 15306.
const HANH = (box) => `Hanh Nguyen
15306 Foster Springs Ln
Houston, TX 77095
328
32-2/1110
10/31/2026
PAY TO THE
ORDER OF Stormshield Pro Rooling
${box}
Eighteen thousand and five hundred dollars
DOLLARS
Security Features Details on Back.
Bank of America
FOR 17023 Great Glen
⑆111000025⑆ 488104987706⑈0328
MONARCH`;

test('the 18,500 check, every way Vision might read the raised cents', () => {
  for (const box of ['$ 18500.00', '$ 18500.', '$ 18500.⁰⁰', '$ 18500.°°', '$ 18500,00', '$ 18500 00', '$18500.oo', '$ 18 500.00', '$ 18500']) {
    assert.strictEqual(amt(HANH(box)), 18500, box);
  }
});

test('the 18,500 check: "$" and the amount on separate lines', () => {
  assert.strictEqual(amt(HANH('$\n18500.00')), 18500);
  assert.strictEqual(amt(HANH('$\n18500.')), 18500);
});

test('the 18,500 check: even with the $-box unreadable, never the memo, address, date or bank numbers', () => {
  const r = amt(HANH('$'));
  assert.ok(![17023, 15306, 77095, 2026, 328, 1110].includes(r), `got ${r}`);
});

test('check number', () => {
  assert.strictEqual(ca.parse(HANH('$ 18500.00')).checkNum, '328');
  assert.strictEqual(ca.checkNumber('ALLSTATE\nCheck No. 778812'), '778812');
});

test('printed insurance checks still read right', () => {
  const SF = `STATE FARM FIRE AND CASUALTY COMPANY\n4521\nDATE 10/28/2026\nPAY TO THE ORDER OF JOHN SMITH AND STORMSHIELD PRO ROOFING\nEight Thousand Four Hundred Thirty-Two and 10/100 DOLLARS $ ****8,432.10\nCLAIM NO 53-12X4-567`;
  assert.strictEqual(amt(SF), 8432.10);
  assert.strictEqual(amt(`STATE FARM\n1001234567\nDATE 10/28/2026\nPAY Eight Thousand Four Hundred Thirty-Two and 10/100 DOLLARS\n$********8,432.10\nCLAIM NO 53-12X4-567`), 8432.10);
  assert.strictEqual(amt(`JANE DOE\n123 MAIN ST HOUSTON TX 77001\n4521\nDate 11/02/2026\nPay to the order of StormShield $ 2,500.00\nTwo thousand five hundred and 00/100 Dollars`), 2500);
  assert.strictEqual(amt(`ALLSTATE\nCheck No. 778812\nPAY $15,000 EXACTLY\nFifteen thousand dollars`), 15000);
  assert.strictEqual(amt(`DATE 11/01/2026\nPAY TO STORMSHIELD $30,000\nThirty thousand dollars`), 30000);
  assert.strictEqual(amt(`USAA\nDATE 10/09/2026\n$ 30,147.92\nThirty thousand one hundred forty-seven and 92/100`), 30147.92);
});

test('money(): the shapes an amount can take', () => {
  assert.strictEqual(ca.money('8,432.10'), 8432.10);
  assert.strictEqual(ca.money('****8,432.10'), 8432.10);
  assert.strictEqual(ca.money('18500.00'), 18500);
  assert.strictEqual(ca.money('18500,25'), 18500.25);
  assert.strictEqual(ca.money('18500.'), 18500);
  assert.strictEqual(ca.money('15,000'), 15000);
  assert.strictEqual(ca.money('abc'), null);
});

// Word boxes as Vision returns them: the $ box on the right, the memo lower left.
const W = (t, x0, y0, x1, y1) => ({ t, x0, y0, x1, y1 });
const words = [
  W('15306', 118, 108, 160, 120), W('Foster', 164, 108, 205, 120),
  W('328', 965, 80, 1012, 104),
  W('Stormshield', 250, 205, 420, 240), W('$', 835, 210, 855, 236), W('18500', 878, 210, 965, 238), W('.', 966, 226, 970, 236), W('00', 972, 202, 1000, 218),
  W('FOR', 105, 412, 140, 426), W('17023', 168, 402, 235, 426), W('Great', 265, 402, 325, 426),
];

test('with word positions: reads what follows the $ (raised cents and all)', () => {
  assert.strictEqual(ca.amountFromWords(words), 18500);
  assert.strictEqual(ca.parse('FOR 17023 Great Glen\n15306 Foster', words).amount, 18500);
});

test('with word positions: cents raised above the line still count', () => {
  const w2 = words.map(w => w.t === '00' ? Object.assign({}, w, { t: '25' }) : w);
  assert.strictEqual(ca.amountFromWords(w2), 18500.25);
});

test('with word positions but no $ found → falls back to the text', () => {
  const noDollar = words.filter(w => w.t !== '$');
  assert.strictEqual(ca.parse(HANH('$ 18500.00'), noDollar).amount, 18500);
});

test('visionWords: turns Vision\'s annotation into word boxes', () => {
  const ann = { pages: [{ blocks: [{ paragraphs: [{ words: [
    { symbols: [{ text: '$' }], boundingBox: { vertices: [{ x: 835, y: 210 }, { x: 855, y: 210 }, { x: 855, y: 236 }, { x: 835, y: 236 }] } },
    { symbols: [{ text: '1' }, { text: '8' }, { text: '5' }, { text: '0' }, { text: '0' }], boundingBox: { vertices: [{ x: 878, y: 210 }, { x: 965, y: 210 }, { x: 965, y: 238 }, { x: 878, y: 238 }] } },
  ] }] }] }] };
  const ws = ca.visionWords(ann);
  assert.deepStrictEqual(ws.map(w => w.t), ['$', '18500']);
  assert.strictEqual(ca.amountFromWords(ws), 18500);
});

console.log(`\n${passed} passed`);
