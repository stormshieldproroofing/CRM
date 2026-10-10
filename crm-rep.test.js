const assert = require('assert');
const fs = require('fs');
const path = require('path');
const rep = require('./crm-rep.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok', name);
}

const team = [
  { id: 'jd', name: 'Jane Doe', color: '#1557A8' },
  { id: 'no-color', name: 'Sam', color: '' },
];

function cardBits(u) {
  // The expressions that threw when the lookup missed: color, name, id.toUpperCase().
  return u.color + '|' + u.name + '|' + u.id.toUpperCase();
}

test('a job with no assignee does not throw and reads as Unassigned', () => {
  for (const job of [{ user: null }, { user: '' }, { user: undefined }, {}]) {
    const u = rep.jobAssignee(team, job);
    assert.strictEqual(u.known, false);
    assert.strictEqual(u.name, 'Unassigned');
    assert.ok(u.color);
    assert.strictEqual(cardBits(u), '#64748B|Unassigned|—');
  }
  assert.strictEqual(rep.jobAssignee(team, null).name, 'Unassigned');
});

test('an assignee id that is not on the team is Unassigned, not a crash', () => {
  const u = rep.jobAssignee(team, { id: '86cf0b76-8128-4db4-8e64-9468d7520459', user: 'former-rep' });
  assert.strictEqual(u.known, false);
  assert.strictEqual(u.name, 'Unassigned');
  assert.doesNotThrow(() => cardBits(u));
});

test('a known rep keeps their name, color, and id', () => {
  const u = rep.jobAssignee(team, { user: 'jd' });
  assert.strictEqual(u.known, true);
  assert.strictEqual(u.name, 'Jane Doe');
  assert.strictEqual(u.color, '#1557A8');
  assert.strictEqual(u.id.toUpperCase(), 'JD');
  const blankColor = rep.jobAssignee(team, 'no-color');
  assert.strictEqual(blankColor.known, true);
  assert.strictEqual(blankColor.name, 'Sam');
  assert.strictEqual(blankColor.color, '#64748B');
});

test('the board card and job detail look up the rep through jobRep', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const card = html.slice(html.indexOf('function renderCard'), html.indexOf('function canEnterContractStage'));
  assert.ok(card.includes('jobRep(j)'));
  assert.ok(!card.includes('USERS.find'));
  const panel = html.slice(html.indexOf('function renderDetailPanel'), html.indexOf('function jobDocCounts'));
  assert.ok(panel.includes('jobRep(j)'));
  const tab = html.slice(html.indexOf('function renderDetailTab'), html.indexOf('function renderDetailTab') + 400);
  assert.ok(tab.includes('jobRep(j)'));
});

console.log(passed + ' tests passed');
