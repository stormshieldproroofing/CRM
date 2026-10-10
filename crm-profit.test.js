const assert = require('assert');
const fs = require('fs');
const path = require('path');
const profit = require('./crm-profit.js');

function cents(n) {
  return Math.round(n * 100);
}

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok', name);
}

const bettyExpenses = [{ cat: 'Materials', amount: '15999.27' }];

test('Betty Hoffmann net profit includes approved supplements on top of the contract', () => {
  const amount = profit.jobNetProfitAmount(31386.74, 1761.18, bettyExpenses);
  assert.strictEqual(cents(amount), 1714865); // $17,148.65
  // The old card was contract − expenses and showed this instead.
  const withoutSupplements = profit.jobNetProfitAmount(31386.74, 0, bettyExpenses);
  assert.strictEqual(cents(withoutSupplements), 1538747); // $15,387.47
});

test('returns reduce net expenses', () => {
  const expenses = [
    { cat: 'Materials', amount: '100.00' },
    { cat: 'Returns', amount: '12.50' },
    { cat: 'Roofing Labor', amount: '40.00' },
  ];
  assert.strictEqual(cents(profit.netExpenses(expenses)), 12750);
  // The approved total is chosen by the app. A denied supplement contributes 0.
  const amount = profit.jobNetProfitAmount('1000.00', 0, expenses);
  assert.strictEqual(cents(amount), 87250); // 1000 − 127.50
  const withApproved = profit.jobNetProfitAmount(1000, 50, expenses);
  assert.strictEqual(cents(withApproved), 92250);
});

test('the job panel net profit card uses the shared calculation', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const start = html.indexOf('Profit card');
  assert.ok(start > 0);
  const card = html.slice(start, start + 500);
  assert.ok(card.includes('jobNetProfit(j2)'));
  assert.ok(!/contractPrice\s*-\s*netTotal/.test(card));
  const marker = html.indexOf('id="profitNet"');
  const placeholder = html.slice(marker - 120, marker + 260);
  assert.ok(placeholder.includes('jobNetProfit(j)'));
  assert.ok(!placeholder.includes('j.potVal'));
});

console.log(passed + ' tests passed');
