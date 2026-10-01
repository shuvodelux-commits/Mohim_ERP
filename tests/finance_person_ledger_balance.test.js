'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'FinanceModule.gs'), 'utf8');
function roundMoney(value) { return Math.round((Number(value) + Number.EPSILON) * 100) / 100; }

function runtime(financeRows, persons = []) {
  const sheets = { FINANCE_TRANSACTIONS: financeRows, FINANCE_PERSONS: persons };
  const context = {
    console,
    requirePermission_: () => ({}),
    activeRows_: key => (sheets[key] || []).filter(row => String(row['Is Deleted'] || '').toUpperCase() !== 'TRUE').map(row => ({ ...row })),
    getAllRows_: key => (sheets[key] || []).map((row, i) => ({ _rowIndex: i + 2, ...row })),
    getSettingsMap_: () => ({ 'Currency Symbol': '৳' }),
    sanitizeInput_: value => String(value == null ? '' : value).trim(),
    safeDateOnly_: value => String(value == null ? '' : value).slice(0, 10),
    roundMoney_: roundMoney,
    ok_: data => ({ success: true, data }),
    fail_: message => ({ success: false, message: String(message) }),
    logError_: () => {}
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'FinanceModule.gs' });
  return context;
}

const lenders = [
  { 'Person ID': 'L1', 'Person Name': 'BRAC', 'Person Type': 'Lender', Roles: 'Lender', Status: 'Active', Phone: '0171' },
  { 'Person ID': 'L2', 'Person Name': 'Other Bank', 'Person Type': 'Lender', Roles: 'Lender', Status: 'Active', Phone: '0181' },
  { 'Person ID': 'M1', 'Person Name': 'Multi', 'Person Type': 'Lender', Roles: 'Lender,Borrower', Status: 'Active', Phone: '0191' }
];

function loanRows() {
  return [
    { 'Finance ID': 'F1', Date: '2026-09-01', 'Transaction Type': 'Loan Received', 'Person ID': 'L1', Person: 'BRAC', Amount: 100, 'Payment Method': 'Cash' },
    { 'Finance ID': 'F2', Date: '2026-09-02', 'Transaction Type': 'Loan Received', 'Person ID': 'L2', Person: 'Other Bank', Amount: 500, 'Payment Method': 'Cash' },
    { 'Finance ID': 'F3', Date: '2026-09-03', 'Transaction Type': 'Loan Repayment', 'Person ID': 'L1', Person: 'BRAC', Amount: 30, 'Payment Method': 'Cash' },
    { 'Finance ID': 'F4', Date: '2026-09-04', 'Transaction Type': 'Loan Repayment', 'Person ID': 'L2', Person: 'Other Bank', Amount: 200, 'Payment Method': 'Cash' }
  ];
}

function data(result) {
  assert.equal(result.success, true, result.message);
  return result.data;
}

test('selected lender rows carry only that lender own running payable balance', () => {
  const context = runtime(loanRows(), lenders);
  const d = data(context.getFinanceLedger('T', { personId: 'L1' }));
  assert.deepEqual(d.rows.map(row => row.financeId), ['F3', 'F1']);
  assert.deepEqual(d.rows.map(row => row.balance), [70, 100]);
  assert.equal(d.summary.outstandingLoan, 70);
  assert.equal(d.summary.lenderCredit, 0);
  assert.equal(d.selectedPerson.id, 'L1');
  assert.equal(d.selectedPerson.name, 'BRAC');
});

test('date and query filters change displayed rows but never current selected-person summary or historical running balance', () => {
  const context = runtime(loanRows(), lenders);
  const d = data(context.getFinanceLedger('T', {
    personId: 'L1', dateFrom: '2026-09-03', query: 'repayment'
  }));
  assert.equal(d.rows.length, 1);
  assert.equal(d.rows[0].financeId, 'F3');
  assert.equal(d.rows[0].balance, 70);
  assert.equal(d.summary.outstandingLoan, 70);
});

test('same person lender and borrower accounts have independent running balances', () => {
  const rows = [
    { 'Finance ID': 'M1', Date: '2026-09-01', 'Transaction Type': 'Loan Received', 'Person ID': 'M1', Person: 'Multi', Amount: 100 },
    { 'Finance ID': 'M2', Date: '2026-09-02', 'Transaction Type': 'Borrower Loan', 'Person ID': 'M1', Person: 'Multi', Amount: 40 },
    { 'Finance ID': 'M3', Date: '2026-09-03', 'Transaction Type': 'Borrower Repayment', 'Person ID': 'M1', Person: 'Multi', Amount: 10 },
    { 'Finance ID': 'M4', Date: '2026-09-04', 'Transaction Type': 'Loan Repayment', 'Person ID': 'M1', Person: 'Multi', Amount: 20 }
  ];
  const context = runtime(rows, lenders);
  const d = data(context.getFinanceLedger('T', { personId: 'M1' }));
  const byId = Object.fromEntries(d.rows.map(row => [row.financeId, row]));
  assert.equal(byId.M1.balance, 100);
  assert.equal(byId.M2.balance, 40);
  assert.equal(byId.M3.balance, 30);
  assert.equal(byId.M4.balance, 80);
  assert.equal(byId.M4.account, 'loanPayable');
  assert.equal(byId.M3.account, 'borrowerReceivable');
  assert.equal(d.summary.outstandingLoan, 80);
  assert.equal(d.summary.borrowerReceivable, 30);
});

test('business-wide summary buckets each lender before totals rather than cross-netting lender credit', () => {
  const rows = [
    { 'Finance ID': 'A1', Date: '2026-09-01', 'Transaction Type': 'Loan Received', 'Person ID': 'L1', Person: 'BRAC', Amount: 50 },
    { 'Finance ID': 'A2', Date: '2026-09-02', 'Transaction Type': 'Loan Repayment', 'Person ID': 'L1', Person: 'BRAC', Amount: 80 },
    { 'Finance ID': 'B1', Date: '2026-09-03', 'Transaction Type': 'Loan Received', 'Person ID': 'L2', Person: 'Other Bank', Amount: 100 }
  ];
  const d = data(runtime(rows, lenders).getFinanceLedger('T', {}));
  assert.equal(d.summary.outstandingLoan, 100);
  assert.equal(d.summary.lenderCredit, 30);
});

test('legacy blank-person-id rows retain a stable name-scoped running balance', () => {
  const rows = [
    { 'Finance ID': 'X1', Date: '2026-09-01', 'Transaction Type': 'Loan Received', 'Person ID': '', Person: 'Legacy Lender', Amount: 100 },
    { 'Finance ID': 'X2', Date: '2026-09-02', 'Transaction Type': 'Loan Repayment', 'Person ID': '', Person: ' legacy lender ', Amount: 25 }
  ];
  const d = data(runtime(rows, []).getFinanceLedger('T', {}));
  assert.deepEqual(d.rows.map(row => row.balance), [75, 100]);
  assert.equal(d.summary.outstandingLoan, 75);
});
