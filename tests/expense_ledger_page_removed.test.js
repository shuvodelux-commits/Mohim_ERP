const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

test('removed Expense Ledger page has no template or loader references', () => {
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'javascript.html'), 'utf8');
  assert.equal(fs.existsSync(path.join(root, 'expenseLedger.html')), false, 'expenseLedger.html should be removed');
  assert.doesNotMatch(index, /include\(['\"]expenseLedger['\"]\)/);
  assert.doesNotMatch(index, /page-expenseLedger|data-page=["']expenseLedger["']/);
  assert.doesNotMatch(js, /expenseLedger\s*:\s*['\"]expLedLoad['\"]/);
});

test('Expense History keeps ledger-backed server API', () => {
  const history = fs.readFileSync(path.join(root, 'expenseList.html'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'Expense.gs'), 'utf8');
  assert.match(history, /getExpenseLedger/);
  assert.match(server, /function\s+getExpenseLedger\s*\(/);
});
