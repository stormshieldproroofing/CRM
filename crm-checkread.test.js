const assert = require('assert');
const cr = require('./crm-checkread.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok', name);
}

test('words to number', () => {
  assert.strictEqual(cr.wordsToNumber('eight thousand four hundred thirty two'.split(' ')), 8432);
  assert.strictEqual(cr.wordsToNumber('fifteen thousand'.split(' ')), 15000);
  assert.strictEqual(cr.wordsToNumber('one hundred twenty five thousand three hundred'.split(' ')), 125300);
  assert.strictEqual(cr.wordsToNumber('thousand'.split(' ')), 1000);
});

test('written amount: the common ways checks write it', () => {
  const W = cr.writtenAmount;
  assert.strictEqual(W('Eight Thousand Four Hundred Thirty-Two and 10/100 DOLLARS'), 8432.10);
  assert.strictEqual(W('EIGHT THOUSAND FOUR HUNDRED THIRTY TWO DOLLARS AND 10 CENTS'), 8432.10);
  assert.strictEqual(W('Two thousand five hundred and 00/100 Dollars'), 2500);
  assert.strictEqual(W('Fifteen thousand dollars'), 15000);
  assert.strictEqual(W('Seven thousand seventy-seven and no/100'), 7077);
  assert.strictEqual(W('Thirty Thousand One Hundred Forty Seven and 92 / 100'), 30147.92);
  assert.strictEqual(W('six thousand seven hundred eighty four dollars and thirty cents'), 6784.30);
  assert.strictEqual(W('PAY EXACTLY ****8,432 DOLLARS AND 10 CENTS'), 8432.10);
  assert.strictEqual(W('one hundred and five and 00/100'), 105);
});

test('written amount: split across OCR lines, with other words around it', () => {
  const t = 'STATE FARM FIRE AND CASUALTY COMPANY\nPAY Eight Thousand Four Hundred\nThirty-Two and 10/100 DOLLARS\nONE TIME PAYMENT';
  assert.strictEqual(cr.writtenAmount(t), 8432.10);
});

test('written amount: no amount words → null; a stray "one" is ignored', () => {
  assert.strictEqual(cr.writtenAmount('PAY TO THE ORDER OF JOHN SMITH\nMEMO roof'), null);
  assert.strictEqual(cr.writtenAmount('one time payment'), null);
});

const SF = `STATE FARM FIRE AND CASUALTY COMPANY
4521
DATE 10/28/2026
PAY TO THE ORDER OF JOHN SMITH AND STORMSHIELD PRO ROOFING
Eight Thousand Four Hundred Thirty-Two and 10/100 DOLLARS $ ****8,432.10
CLAIM NO 53-12X4-567`;

test('both agree → match', () => {
  const r = cr.read(SF);
  assert.strictEqual(r.status, 'match');
  assert.strictEqual(r.amount, 8432.10);
});

test('$ box misread (e.g. 8,482.10) → mismatch, prefilled with the written amount, both offered', () => {
  const r = cr.read(SF.replace('8,432.10', '8,482.10'));
  assert.strictEqual(r.status, 'mismatch');
  assert.strictEqual(r.amount, 8432.10);
  assert.strictEqual(r.written, 8432.10);
  assert.strictEqual(r.numeric, 8482.10);
});

test('$-box reader picked the wrong number but the right one is on the check → still a match', () => {
  const r = cr.read(SF, () => 4521);
  assert.strictEqual(r.status, 'match');
  assert.strictEqual(r.amount, 8432.10);
});

test('no written amount → numeric, with other amounts to tap', () => {
  const r = cr.read('PAY $2,500.00\nMEMO deposit $250.00');
  assert.strictEqual(r.status, 'numeric');
  assert.strictEqual(r.amount, 2500);
  assert.deepStrictEqual(r.others, [250]);
});

test('only the written amount readable → written', () => {
  const r = cr.read('Fifteen thousand dollars');
  assert.strictEqual(r.status, 'written');
  assert.strictEqual(r.amount, 15000);
});

test('nothing → none', () => {
  assert.strictEqual(cr.read('').status, 'none');
});

test('dates are not offered as amounts', () => {
  assert.deepStrictEqual(cr.numericCandidates('DATE 10/28/2026\n$ 1,250.00'), [1250]);
});

console.log(`\n${passed} passed`);
