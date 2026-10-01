'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function runtime(rows = []) {
  const context = {
    console,
    roundMoney_: roundMoney,
    activeRows_: key => key === 'FINANCE_TRANSACTIONS' ? rows : []
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'FinanceModule.gs'), 'utf8'), context, { filename: 'FinanceModule.gs' });
  return context;
}

const expectedTypes = {
  'Owner Investment':        { label:'Owner Credit',           account: 'owner',              balanceEffect:  1, cashDirection: 'in',   role: 'Owner',    isOpening: false },
  'Owner Withdrawal':        { label:'Owner Debit',            account: 'owner',              balanceEffect: -1, cashDirection: 'out',  role: 'Owner',    isOpening: false },
  'Loan Received':           { label:'Lender Credit',          account: 'loanPayable',        balanceEffect:  1, cashDirection: 'in',   role: 'Lender',   isOpening: false },
  'Loan Repayment':          { label:'Lender Debit',           account: 'loanPayable',        balanceEffect: -1, cashDirection: 'out',  role: 'Lender',   isOpening: false },
  'Borrower Loan':           { label:'Borrower Debit',         account: 'borrowerReceivable', balanceEffect:  1, cashDirection: 'out',  role: 'Borrower', isOpening: false },
  'Borrower Repayment':      { label:'Borrower Credit',        account: 'borrowerReceivable', balanceEffect: -1, cashDirection: 'in',   role: 'Borrower', isOpening: false },
  'Opening Owner Capital':   { label:'Opening Owner Capital',  account: 'owner',              balanceEffect:  1, cashDirection: 'none', role: 'Owner',    isOpening: true },
  'Opening Loan':            { label:'Opening Loan',           account: 'loanPayable',        balanceEffect:  1, cashDirection: 'none', role: 'Lender',   isOpening: true },
  'Opening Borrower Loan':   { label:'Opening Borrower Loan',  account: 'borrowerReceivable', balanceEffect:  1, cashDirection: 'none', role: 'Borrower', isOpening: true }
};

test('all nine finance transaction types expose explicit account, balance, cash, role and opening metadata', () => {
  const context = runtime();
  for (const [key, expected] of Object.entries(expectedTypes)) {
    const actual = context.financeTransactionType_(key);
    assert.ok(actual, `${key} missing`);
    for (const [field, value] of Object.entries(expected)) assert.equal(actual[field], value, `${key}.${field}`);
  }
  assert.equal(context.financeTransactionType_('Not A Type'), null);
});

test('business summary buckets signed balances per person before summing and never cross-nets relationship accounts', () => {
  const rows = [
    { 'Person ID': 'A', Person: 'Alpha', 'Transaction Type': 'Owner Investment', Amount: 100 },
    { 'Person ID': 'A', Person: 'Alpha', 'Transaction Type': 'Owner Withdrawal', Amount: 150 },
    { 'Person ID': 'B', Person: 'Beta', 'Transaction Type': 'Opening Owner Capital', Amount: 30 },
    { 'Person ID': 'A', Person: 'Alpha', 'Transaction Type': 'Loan Received', Amount: 100 },
    { 'Person ID': 'A', Person: 'Alpha', 'Transaction Type': 'Loan Repayment', Amount: 120 },
    { 'Person ID': 'B', Person: 'Beta', 'Transaction Type': 'Opening Loan', Amount: 40 },
    { 'Person ID': 'A', Person: 'Alpha', 'Transaction Type': 'Borrower Loan', Amount: 70 },
    { 'Person ID': 'A', Person: 'Alpha', 'Transaction Type': 'Borrower Repayment', Amount: 20 },
    { 'Person ID': 'B', Person: 'Beta', 'Transaction Type': 'Opening Borrower Loan', Amount: 25 }
  ];
  const context = runtime(rows);
  const summary = context.financeBalanceSummary_(rows);

  assert.deepEqual(JSON.parse(JSON.stringify(summary)), {
    ownerCapital: 30,
    ownerAdvance: 50,
    outstandingLoan: 40,
    lenderCredit: 20,
    borrowerReceivable: 75,
    borrowerCredit: 0
  });
});

test('selected-person summary keeps lender and borrower balances independent for the same person', () => {
  const rows = [
    { 'Person ID': 'A', Person: 'Alpha', 'Transaction Type': 'Loan Received', Amount: 200 },
    { 'Person ID': 'A', Person: 'Alpha', 'Transaction Type': 'Loan Repayment', Amount: 50 },
    { 'Person ID': 'A', Person: 'Alpha', 'Transaction Type': 'Borrower Loan', Amount: 90 },
    { 'Person ID': 'A', Person: 'Alpha', 'Transaction Type': 'Borrower Repayment', Amount: 120 },
    { 'Person ID': 'B', Person: 'Beta', 'Transaction Type': 'Loan Received', Amount: 999 }
  ];
  const context = runtime(rows);
  const summary = context.financeBalanceSummary_(rows, 'A');

  assert.equal(summary.outstandingLoan, 150);
  assert.equal(summary.lenderCredit, 0);
  assert.equal(summary.borrowerReceivable, 0);
  assert.equal(summary.borrowerCredit, 30);
});

test('legacy rows with blank Person ID stay grouped by normalized person name', () => {
  const rows = [
    { 'Person ID': '', Person: ' Legacy Lender ', 'Transaction Type': 'Loan Received', Amount: 100 },
    { 'Person ID': '', Person: 'legacy lender', 'Transaction Type': 'Loan Repayment', Amount: 30 },
    { 'Person ID': '', Person: 'Other Lender', 'Transaction Type': 'Loan Repayment', Amount: 10 }
  ];
  const context = runtime(rows);
  const signed = context.financeSignedBalances_(rows);

  assert.equal(signed['name:legacy lender'].loanPayable, 70);
  assert.equal(signed['name:other lender'].loanPayable, -10);
  const summary = context.financeBalanceSummary_(rows);
  assert.equal(summary.outstandingLoan, 70);
  assert.equal(summary.lenderCredit, 10);
});

test('legacy compatibility wrappers expose positive owner capital and outstanding lender loan only', () => {
  const rows = [
    { 'Person ID': 'A', Person: 'Alpha', 'Transaction Type': 'Owner Withdrawal', Amount: 20 },
    { 'Person ID': 'B', Person: 'Beta', 'Transaction Type': 'Owner Investment', Amount: 50 },
    { 'Person ID': 'A', Person: 'Alpha', 'Transaction Type': 'Loan Repayment', Amount: 15 },
    { 'Person ID': 'B', Person: 'Beta', 'Transaction Type': 'Loan Received', Amount: 100 }
  ];
  const context = runtime(rows);

  assert.equal(context.getOwnerCapital_(), 50);
  assert.equal(context.getOutstandingLoan_(), 100);
});
