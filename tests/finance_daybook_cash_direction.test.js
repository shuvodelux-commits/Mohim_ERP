'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const financeSource = fs.readFileSync(path.join(root, 'FinanceModule.gs'), 'utf8');
const dayBookSource = fs.readFileSync(path.join(root, 'DayBook.gs'), 'utf8');

function runtime(financeRows) {
  const sheets = { FINANCE_TRANSACTIONS: financeRows };
  const isDeleted = row => String(row && row['Is Deleted'] || '').toUpperCase() === 'TRUE';
  const context = {
    console,
    roundMoney_: value => Math.round((Number(value) + Number.EPSILON) * 100) / 100,
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) },
    getAllRows_: key => (sheets[key] || []).map(row => ({ ...row })),
    activeRows_: key => (sheets[key] || []).filter(row => !isDeleted(row)).map(row => ({ ...row })),
    isDeleted_: isDeleted,
    requirePermission_: () => ({ Role: 'Administrator' }),
    getSettingsMap_: () => ({}),
    sanitizeInput_: value => String(value == null ? '' : value).trim(),
    safeDateOnly_: value => String(value == null ? '' : value).slice(0, 10),
    safeTimeOnly_: value => String(value == null ? '' : value).slice(0, 8),
    isBankLikePaymentMethod_: method => method === 'Bank' || method === 'Mobile Banking',
    settlementPaymentAmount_: row => Number(row['Payment Amount']) || Number(row.Credit) || 0,
    settlementDiscountAmount_: row => Number(row['Discount Amount']) || 0,
    assertUniqueSalesInvoiceIds_: () => {},
    ok_: data => ({ success: true, data }),
    fail_: message => ({ success: false, message: String(message) }),
    logError_: () => {}
  };
  vm.createContext(context);
  vm.runInContext(financeSource, context, { filename: 'FinanceModule.gs' });
  vm.runInContext(dayBookSource, context, { filename: 'DayBook.gs' });
  return context;
}

function financeRow(id, type, method, amount) {
  return {
    'Finance ID': id, Date: '2026-09-15', 'Created At': `2026-09-15T10:00:0${id.slice(-1)}`,
    'Transaction Type': type, 'Person ID': id, Person: id,
    'Payment Method': method, Amount: amount, 'Created By': 'Tester'
  };
}

test('Day Book follows finance cashDirection for borrower money in/out', () => {
  const context = runtime([
    financeRow('F1', 'Borrower Loan', 'Cash', 100),
    financeRow('F2', 'Borrower Repayment', 'Bank', 40)
  ]);
  const result = context.getDayBookTransactions('T', {});
  assert.equal(result.success, true, result.message);
  const byId = Object.fromEntries(result.data.rows.map(row => [row.referenceNo, row]));
  assert.equal(byId.F1.cashOut, 100);
  assert.equal(byId.F1.cashIn, 0);
  assert.equal(byId.F2.bankIn, 40);
  assert.equal(byId.F2.bankOut, 0);
});

test('all opening finance rows stay visible but contribute zero cash and bank movement even with forged legacy methods', () => {
  const context = runtime([
    financeRow('F1', 'Opening Owner Capital', 'Cash', 1000),
    financeRow('F2', 'Opening Loan', 'Bank', 500),
    financeRow('F3', 'Opening Borrower Loan', 'Mobile Banking', 300)
  ]);
  const result = context.getDayBookTransactions('T', {});
  assert.equal(result.success, true, result.message);
  const financeRows = result.data.rows.filter(row => row.module === 'Finance');
  assert.equal(financeRows.length, 3);
  financeRows.forEach(row => {
    assert.equal(row.cashIn, 0);
    assert.equal(row.cashOut, 0);
    assert.equal(row.bankIn, 0);
    assert.equal(row.bankOut, 0);
    assert.equal(row.paymentMethod, '');
  });
  assert.equal(result.data.totals.cashIn, 0);
  assert.equal(result.data.totals.cashOut, 0);
  assert.equal(result.data.totals.bankIn, 0);
  assert.equal(result.data.totals.bankOut, 0);
});
