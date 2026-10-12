'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync('financeLedger.html', 'utf8');
const helper = source.match(/  function finLedMoneyCell_\(row, column\) \{[\s\S]*?\n  \}/);
assert.ok(helper, 'Money indicator renderer exists');

const types = [
  { key: 'Owner Investment', account: 'owner', cashDirection: 'in', isOpening: false },
  { key: 'Loan Repayment', account: 'loanPayable', cashDirection: 'out', isOpening: false },
  { key: 'Opening Owner Capital', account: 'owner', cashDirection: 'none', isOpening: true },
  { key: 'Opening Loan', account: 'loanPayable', cashDirection: 'none', isOpening: true },
  { key: 'Opening Borrower Loan', account: 'borrowerReceivable', cashDirection: 'none', isOpening: true }
];
const ctx = {
  finLedType_: key => types.find(t => t.key === key) || null,
  finLedMoney_: value => '৳' + Number(value).toLocaleString('en-US'),
  escapeHtml: value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
};
vm.createContext(ctx);
vm.runInContext(helper[0], ctx);
const render = (row, column) => ctx.finLedMoneyCell_(row, column);

test('money in appears in Credit only, with green icon and text', () => {
  const r = { transactionType: 'Owner Investment', amount: 15000, debit: 0, credit: 15000 };
  assert.equal(render(r, 'debit'), '');
  assert.match(render(r, 'credit'), /৳15,000/);
  assert.match(render(r, 'credit'), /is-in.*Money In/);
  assert.match(render(r, 'credit'), /<svg/);
});

test('money out appears in Debit only, with red icon and text', () => {
  const r = { transactionType: 'Loan Repayment', amount: 3000, debit: 3000, credit: 0 };
  assert.equal(render(r, 'credit'), '');
  assert.match(render(r, 'debit'), /৳3,000/);
  assert.match(render(r, 'debit'), /is-out.*Money Out/);
});

test('opening balances are neutral display-only values in matching column', () => {
  const owner = { transactionType: 'Opening Owner Capital', amount: 8000, debit: 0, credit: 0 };
  const lender = { transactionType: 'Opening Loan', amount: 5000, debit: 0, credit: 0 };
  const borrower = { transactionType: 'Opening Borrower Loan', amount: 4000, debit: 0, credit: 0 };
  assert.equal(render(owner, 'debit'), '');
  assert.match(render(owner, 'credit'), /৳8,000[\s\S]*Opening/);
  assert.match(render(lender, 'credit'), /৳5,000[\s\S]*Opening/);
  assert.match(render(borrower, 'debit'), /৳4,000[\s\S]*Opening/);
  assert.equal(render(borrower, 'credit'), '');
  assert.match(render(owner, 'credit'), /no cash or bank movement/);
  assert.equal(owner.debit, 0);
  assert.equal(owner.credit, 0);
});

test('unknown historical types retain their displayed amount without false labels', () => {
  const html = render({ transactionType: 'Legacy', debit: 42, credit: 0 }, 'debit');
  assert.match(html, /৳42/);
  assert.doesNotMatch(html, /Money In|Money Out|Opening/);
});

test('existing table structure, entry actions and print/export remain intact', () => {
  const header = source.match(/<thead>[\s\S]*?<\/thead>/)[0];
  assert.equal((header.match(/<th\b/g) || []).length, 11);
  ['Date', 'Finance ID', 'Type', 'Account', 'Party', 'Method', 'Debit', 'Credit', 'Balance', 'By']
    .forEach(name => assert.ok(header.includes(name), name));
  assert.match(source, /data-act="menuTxn"/);
  assert.match(source, /finLedMoneyCell_\(r, 'debit'\)/);
  assert.match(source, /finLedMoneyCell_\(r, 'credit'\)/);
  assert.match(source, /columns:FIN_LED_COLUMNS, rows:finLedState\.rows/);
  assert.match(source, /exportRowsToCsv/);
  assert.doesNotMatch(source, /finLedDirectionTabs/);
});
