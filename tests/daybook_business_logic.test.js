'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'DayBook.gs'), 'utf8');

function runtime(initialSheets = {}) {
  const sheets = Object.fromEntries(
    Object.entries(initialSheets).map(([key, rows]) => [key, rows.map(row => ({ ...row }))])
  );
  const reads = {};
  const cache = new Map();
  const isDeleted = row => row && (row['Is Deleted'] === true || String(row['Is Deleted'] || '').toUpperCase() === 'TRUE');
  const read = (key, activeOnly) => {
    reads[key] = (reads[key] || 0) + 1;
    const rows = sheets[key] || [];
    return activeOnly ? rows.filter(row => !isDeleted(row)) : rows;
  };
  let currentRole = 'Staff';
  const context = {
    console,
    roundMoney_: value => Math.round((Number(value) + Number.EPSILON) * 100) / 100,
    CacheService: {
      getScriptCache: () => ({
        get: key => cache.has(key) ? cache.get(key) : null,
        put: (key, value) => cache.set(key, value)
      })
    },
    getAllRows_: key => read(key, false),
    activeRows_: key => read(key, true),
    isDeleted_: isDeleted,
    requirePermission_: () => ({ Role: currentRole }),
    getSettingsMap_: () => ({}),
    sanitizeInput_: value => String(value == null ? '' : value).trim(),
    safeDateOnly_: value => String(value == null ? '' : value).slice(0, 10),
    safeTimeOnly_: value => String(value == null ? '' : value).slice(0, 8),
    isBankLikePaymentMethod_: method => method === 'Bank' || method === 'Mobile Banking',
    settlementPaymentAmount_: row => row['Payment Amount'] === '' || row['Payment Amount'] == null
      ? Number(row.Credit) || 0
      : Number(row['Payment Amount']) || 0,
    settlementDiscountAmount_: row => Number(row['Discount Amount']) || 0,
    financeTransactionType_: key => ({
      'Owner Investment': { label: 'Owner Investment', direction: 'in' },
      'Owner Withdrawal': { label: 'Owner Withdrawal', direction: 'out' },
      'Loan Received': { label: 'Loan Received', direction: 'in' },
      'Loan Repayment': { label: 'Loan Repayment', direction: 'out' }
    })[key] || null,
    assertUniqueSalesInvoiceIds_: rows => {
      const ids = new Set();
      rows.forEach(row => {
        if (ids.has(row['Invoice ID'])) throw new Error(`Duplicate invoice ID: ${row['Invoice ID']}`);
        ids.add(row['Invoice ID']);
      });
    },
    ok_: data => ({ success: true, data }),
    fail_: message => ({ success: false, message: String(message) }),
    logError_: () => {}
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'DayBook.gs' });
  return { context, reads, setRole: role => { currentRole = role; } };
}

test('bank-paid sale appears once and its linked bank-book row is suppressed', () => {
  const { context } = runtime({
    SALES: [{
      'Invoice ID': 'INV-1', Date: '2026-09-08', Time: '10:00:00',
      'Created At': '2026-09-08T10:00:00', 'Grand Total': 100,
      'Paid Amount': 100, 'Payment Method': 'Bank', 'Payment Type': 'Cash',
      'Customer Name': 'Buyer', 'Payment Status': 'Paid'
    }],
    BANK_BOOK: [{
      'Entry ID': 'BB-1', Date: '2026-09-08T10:00:00', Reference: 'INV-1',
      Credit: 100, Debit: '', Status: 'Active'
    }]
  });

  const result = context.getDayBookTransactions('TOKEN', {});

  assert.equal(result.success, true);
  assert.equal(result.data.rows.length, 1);
  assert.equal(result.data.rows[0].module, 'Sales');
  assert.equal(result.data.totals.bankIn, 100);
});

test('bank transfer appears once and suppresses both linked bank-book movements', () => {
  const { context } = runtime({
    BANK_TRANSFERS: [{
      'Transfer ID': 'BT-1', Date: '2026-09-08T10:00:00',
      'From Account Name': 'Bank One', 'To Account Name': 'Bank Two', Amount: 50
    }],
    BANK_BOOK: [
      { 'Entry ID': 'BB-1', Date: '2026-09-08T10:00:00', Reference: 'BT-1', Debit: 50, Credit: '', Status: 'Active' },
      { 'Entry ID': 'BB-2', Date: '2026-09-08T10:00:00', Reference: 'BT-1', Debit: '', Credit: 50, Status: 'Active' }
    ]
  });

  const result = context.getDayBookTransactions('TOKEN', {});

  assert.equal(result.success, true);
  assert.equal(result.data.rows.length, 1);
  assert.equal(result.data.rows[0].module, 'Bank Transfer');
});

test('manual bank reversal pair has zero net movement and remains visible for audit', () => {
  const { context } = runtime({
    BANK_BOOK: [
      { 'Entry ID': 'BB-1', Date: '2026-09-08T10:00:00', Credit: 100, Debit: '', Status: 'Reversed' },
      { 'Entry ID': 'BB-2', Date: '2026-09-08T11:00:00', Credit: '', Debit: 100, Status: 'Active', 'Reversal Of': 'BB-1' }
    ]
  });

  const result = context.getDayBookTransactions('TOKEN', {});

  assert.equal(result.success, true);
  assert.equal(result.data.rows.length, 2);
  assert.equal(result.data.totals.bankIn, 100);
  assert.equal(result.data.totals.bankOut, 100);
  assert.equal(result.data.totals.netBank, 0);
});

test('day-book cache keeps administrator and staff response identity separate', () => {
  const { context, setRole } = runtime({});
  setRole('Administrator');
  const adminResult = context.getDayBookTransactions('TOKEN-A', {});
  setRole('Staff');
  const staffResult = context.getDayBookTransactions('TOKEN-B', {});

  assert.equal(adminResult.success, true);
  assert.equal(staffResult.success, true);
  assert.equal(adminResult.data.isAdmin, true);
  assert.equal(staffResult.data.isAdmin, false);
});

test('cash-session reconciliation entries do not appear in Day Book rows or totals', () => {
  const { context } = runtime({
    SALES: [{
      'Invoice ID': 'INV-1', Date: '2026-09-08', Time: '10:00:00',
      'Created At': '2026-09-08T10:00:00', 'Grand Total': 50,
      'Paid Amount': 50, 'Payment Method': 'Cash', 'Payment Type': 'Cash',
      'Customer Name': 'Buyer', 'Payment Status': 'Paid'
    }],
    CASH_BOOK: [
      {
        'Entry ID': 'CB-OPEN', Date: '2026-09-08T08:00:00', Type: 'Session Open',
        Reference: 'CS-1', Description: 'Opening cash for the day',
        Debit: '', Credit: 100, Balance: 100, 'Payment Method': 'Cash'
      },
      {
        'Entry ID': 'CB-SALE', Date: '2026-09-08T10:00:00', Type: 'Sale',
        Reference: 'INV-1', Debit: '', Credit: 50, Balance: 150, 'Payment Method': 'Cash'
      },
      {
        'Entry ID': 'CB-CLOSE', Date: '2026-09-08T20:00:00', Type: 'Day Close Adjustment',
        Reference: 'CS-1', Description: 'Cash counted was lower than expected',
        Debit: 10, Credit: '', Balance: 140, 'Payment Method': 'Cash'
      }
    ]
  });

  const result = context.getDayBookTransactions('TOKEN', {});

  assert.equal(result.success, true);
  assert.equal(result.data.rows.length, 1);
  assert.equal(result.data.rows[0].module, 'Sales');
  assert.equal(result.data.rows[0].cashIn, 50);
  assert.equal(result.data.totals.cashIn, 50);
  assert.equal(result.data.totals.cashOut, 0);
  // Running balance may still reflect reconciliation because it is the real
  // drawer balance, but the reconciliation itself is not a Day Book transaction.
  assert.equal(result.data.rows[0].runningCashBalance, 150);
});

test('day-book running cash balance excludes an earlier soft-deleted cash row', () => {
  const { context } = runtime({
    SALES: [{
      'Invoice ID': 'INV-1', Date: '2026-09-08', Time: '11:30:00',
      'Created At': '2026-09-08T11:30:00', 'Grand Total': 0,
      'Paid Amount': 0, 'Payment Method': 'Cash', 'Payment Type': 'Due',
      'Customer Name': 'Buyer', 'Payment Status': 'Due'
    }],
    CASH_BOOK: [
      { 'Entry ID': 'CB-1', Date: '2026-09-08T10:00:00', Credit: 100, Debit: '', Balance: 100, 'Is Deleted': 'TRUE' },
      { 'Entry ID': 'CB-2', Date: '2026-09-08T11:00:00', Credit: 50, Debit: '', Balance: 150 }
    ]
  });

  const result = context.getDayBookTransactions('TOKEN', {});

  assert.equal(result.success, true);
  assert.equal(result.data.rows[0].runningCashBalance, 50);
});


test('legacy date-only Cash Book rows attach to their own Day Book transactions', () => {
  const { context } = runtime({
    SALES: [
      { 'Invoice ID': 'INV-1', Date: '2026-10-09', Time: '09:00:00',
        'Created At': '2026-10-09T09:00:00', 'Paid Amount': 50,
        'Payment Method': 'Cash', 'Payment Type': 'Cash', 'Payment Status': 'Paid' },
      { 'Invoice ID': 'INV-2', Date: '2026-10-09', Time: '11:00:00',
        'Created At': '2026-10-09T11:00:00', 'Paid Amount': 0,
        'Payment Method': 'Cash', 'Payment Type': 'Due', 'Payment Status': 'Due' }
    ],
    EXPENSES: [
      { 'Expense ID': 'EXP-1', Date: '2026-10-09',
        'Created At': '2026-10-09T10:00:00', Amount: 20,
        'Payment Method': 'Cash', Status: 'Active' }
    ],
    CASH_BOOK: [
      { 'Entry ID': 'CB-START', Date: '2026-10-09', Reference: 'OPEN',
        Credit: 100, Debit: '' },
      { 'Entry ID': 'CB-SALE', Date: '2026-10-09', Reference: 'INV-1',
        Credit: 50, Debit: '' },
      { 'Entry ID': 'CB-EXP', Date: '2026-10-09T00:00:00', Reference: 'EXP-1',
        Debit: 20, Credit: '' }
    ]
  });
  const result = context.getDayBookTransactions('TOKEN', {});
  assert.equal(result.success, true, result.message);
  const byId = Object.fromEntries(result.data.rows.map(row => [row.referenceNo, row]));
  assert.equal(byId['INV-1'].runningCashBalance, 150);
  assert.equal(byId['EXP-1'].runningCashBalance, 130);
  assert.equal(byId['INV-2'].runningCashBalance, 130);
  assert.equal(result.data.totals.netCash, 30);
});

test('two sales at the same second do not receive the same ending balance', () => {
  const { context } = runtime({
    SALES: [
      { 'Invoice ID': 'INV-1', Date: '2026-10-09', 'Created At': '2026-10-09T10:00:00',
        'Paid Amount': 30, 'Payment Method': 'Cash', 'Payment Type': 'Cash' },
      { 'Invoice ID': 'INV-2', Date: '2026-10-09', 'Created At': '2026-10-09T10:00:00',
        'Paid Amount': 70, 'Payment Method': 'Cash', 'Payment Type': 'Cash' }
    ],
    CASH_BOOK: [
      { Date: '2026-10-09', Reference: 'INV-1', Credit: 30 },
      { Date: '2026-10-09', Reference: 'INV-2', Credit: 70 }
    ]
  });
  const result = context.getDayBookTransactions('TOKEN', {});
  assert.equal(result.success, true, result.message);
  const byId = Object.fromEntries(result.data.rows.map(row => [row.referenceNo, row]));
  assert.equal(byId['INV-1'].runningCashBalance, 30);
  assert.equal(byId['INV-2'].runningCashBalance, 100);
});

test('posting timestamps group initial cash movement but not later corrections', () => {
  const { context } = runtime({
    SALES: [
      { 'Invoice ID': 'INV-1', Date: '2026-10-08', 'Created At': '2026-10-09T10:00:59',
        'Paid Amount': 100, 'Payment Method': 'Cash', 'Payment Type': 'Cash' },
      { 'Invoice ID': 'INV-2', Date: '2026-10-09', 'Created At': '2026-10-09T11:00:00',
        'Paid Amount': 0, 'Payment Method': 'Cash', 'Payment Type': 'Due' }
    ],
    CASH_BOOK: [
      { Date: '2026-10-08', 'Created At': '2026-10-09T10:01:00',
        Reference: 'INV-1', Credit: 100 },
      { Date: '2026-10-08', 'Created At': '2026-10-09T10:30:00',
        Reference: 'INV-1', Debit: 30 }
    ]
  });
  const result = context.getDayBookTransactions('TOKEN', {});
  assert.equal(result.success, true, result.message);
  const byId = Object.fromEntries(result.data.rows.map(row => [row.referenceNo, row]));
  assert.equal(byId['INV-1'].runningCashBalance, 100);
  assert.equal(byId['INV-2'].runningCashBalance, 70);
});

test('day-book summary returns two-decimal cash and bank totals', () => {
  const { context } = runtime({
    SALES: [
      {
        'Invoice ID': 'INV-1', Date: '2026-09-08', 'Created At': '2026-09-08T10:00:00',
        'Grand Total': 0.1, 'Paid Amount': 0.1, 'Payment Method': 'Cash',
        'Payment Type': 'Cash', 'Payment Status': 'Paid'
      },
      {
        'Invoice ID': 'INV-2', Date: '2026-09-08', 'Created At': '2026-09-08T11:00:00',
        'Grand Total': 0.2, 'Paid Amount': 0.2, 'Payment Method': 'Cash',
        'Payment Type': 'Cash', 'Payment Status': 'Paid'
      }
    ]
  });

  const result = context.getDayBookTransactions('TOKEN', {});

  assert.equal(result.success, true);
  assert.equal(result.data.totals.cashIn, 0.3);
  assert.equal(result.data.totals.netCash, 0.3);
});

test('day-book scans each source sheet once per uncached request', () => {
  const { context, reads } = runtime({});

  const result = context.getDayBookTransactions('TOKEN', {});

  assert.equal(result.success, true);
  Object.entries(reads).forEach(([sheet, count]) => {
    assert.equal(count, 1, `${sheet} was read ${count} times`);
  });
});
