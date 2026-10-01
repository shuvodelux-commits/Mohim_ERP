'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'Dashboard.gs'), 'utf8');

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function runtime(initialSheets = {}) {
  const sheets = Object.fromEntries(
    Object.entries(initialSheets).map(([key, rows]) => [key, rows.map(row => ({ ...row }))])
  );
  const reads = {};
  const isDeleted = row => row && (row['Is Deleted'] === true || String(row['Is Deleted'] || '').toUpperCase() === 'TRUE');
  const read = (key, activeOnly) => {
    reads[key] = (reads[key] || 0) + 1;
    const rows = sheets[key] || [];
    return activeOnly ? rows.filter(row => !isDeleted(row)) : rows;
  };
  const context = {
    console,
    roundMoney_: roundMoney,
    safeDateOnly_: value => String(value == null ? '' : value).slice(0, 10),
    formatDate_: () => '2026-09-08',
    activeRows_: key => read(key, true),
    getAllRows_: key => read(key, false),
    activeSalesReturnItems_: () => read('SALES_RETURN_ITEMS', true),
    economicReturnLineAmount_: (row, subtotal, grandTotal) => {
      const gross = Number(row['Line Total']) || (Number(row['Return Quantity']) || 0) * (Number(row['Unit Price']) || 0);
      return subtotal > 0 ? roundMoney(gross * Number(grandTotal) / Number(subtotal)) : 0;
    },
    assertUniqueSalesInvoiceIds_: () => {},
    requirePermission_: () => ({ 'Full Name': 'Tester' }),
    getSettingsMap_: () => ({ 'Currency Symbol': 'Tk' }),
    getCashBalance_: () => 750,
    financeBalanceSummary_: rows => ({
      borrowerReceivable: rows.reduce((sum, row) => sum + (Number(row.__borrowerReceivable) || 0), 0),
      outstandingLoan: rows.reduce((sum, row) => sum + (Number(row.__outstandingLoan) || 0), 0)
    }),
    ok_: data => ({ success: true, data }),
    fail_: message => ({ success: false, message: String(message) }),
    logError_: () => {}
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'Dashboard.gs' });
  return { context, reads };
}

test('today sales subtracts discounted return value from gross invoices', () => {
  const { context } = runtime({
    SALES_RETURN_ITEMS: [
      { 'Invoice ID': 'INV-1', 'Return Quantity': 1, 'Unit Price': 100, 'Line Total': 100 },
      { 'Invoice ID': 'OLD-INVOICE', 'Return Quantity': 1, 'Unit Price': 500, 'Line Total': 500 }
    ]
  });
  const sales = [
    { 'Invoice ID': 'INV-1', Subtotal: 1000, 'Grand Total': 900 },
    { 'Invoice ID': 'INV-2', Subtotal: 250, 'Grand Total': 250 }
  ];

  assert.equal(context.dashboardTodayNetSales_(sales), 1060);
});

test('today collection counts money received and excludes settlement discount', () => {
  const { context } = runtime();
  const sales = [{ 'Paid Amount': 100 }, { 'Paid Amount': -20 }, { 'Paid Amount': 25.5 }];
  const ledger = [
    { Date: '2026-09-08', Type: 'Payment', Credit: 100, 'Payment Amount': 90, 'Discount Amount': 10 },
    { Date: '2026-09-08', Type: 'Payment', Credit: 60, 'Payment Amount': '', 'Discount Amount': 5 },
    { Date: '2026-09-07', Type: 'Payment', Credit: 500, 'Payment Amount': 500 },
    { Date: '2026-09-08', Type: 'Sale', Credit: 300 }
  ];

  assert.equal(context.dashboardTodayCollection_(sales, ledger, '2026-09-08'), 270.5);
});

test('expense and purchase totals include only the selected business date', () => {
  const { context } = runtime();
  assert.equal(context.dashboardTodayExpense_([
    { Date: '2026-09-08T10:00:00Z', Amount: 10.25 },
    { Date: '2026-09-08', Amount: 4.75 },
    { Date: '2026-09-07', Amount: 99 }
  ], '2026-09-08'), 15);
  assert.equal(context.dashboardTodayPurchase_([
    { Date: '2026-09-08', 'Grand Total': 80.1 },
    { Date: '2026-09-08', 'Grand Total': 19.9 },
    { Date: '2026-09-09', 'Grand Total': 500 }
  ], '2026-09-08'), 100);
});

test('today expense excludes cancelled transactions', () => {
  const { context } = runtime();
  assert.equal(context.dashboardTodayExpense_([
    { Date: '2026-09-08', Amount: 100, Status: 'Active' },
    { Date: '2026-09-08', Amount: 250, Status: 'Cancelled' }
  ], '2026-09-08'), 100);
});

test('dashboard excludes soft-deleted customer and supplier balances', () => {
  const { context } = runtime({
    SALES: [],
    SALES_RETURN_ITEMS: [],
    CUSTOMER_LEDGER: [],
    EXPENSES: [],
    PURCHASES: [],
    CUSTOMERS: [
      { 'Customer ID': 'C1', 'Current Due': 100 },
      { 'Customer ID': 'C2', 'Current Due': 900, 'Is Deleted': 'TRUE' }
    ],
    SUPPLIERS: [
      { 'Supplier ID': 'S1', 'Current Due': 200 },
      { 'Supplier ID': 'S2', 'Current Due': 800, 'Is Deleted': true }
    ],
    PRODUCTS: []
  });

  const result = context.getDashboardStats('TOKEN');

  assert.equal(result.success, true);
  assert.equal(result.data.dueReceivable, 100);
  assert.equal(result.data.supplierPayable, 200);
});

test('dashboard exposes borrower receivable and outstanding loan from active finance rows', () => {
  const { context } = runtime({
    SALES: [], SALES_RETURN_ITEMS: [], CUSTOMER_LEDGER: [], EXPENSES: [], PURCHASES: [],
    CUSTOMERS: [], SUPPLIERS: [], PRODUCTS: [],
    FINANCE_TRANSACTIONS: [
      { __borrowerReceivable: 350, __outstandingLoan: 0 },
      { __borrowerReceivable: 0, __outstandingLoan: 800 },
      { __borrowerReceivable: 999, __outstandingLoan: 999, 'Is Deleted': true }
    ]
  });

  const result = context.getDashboardStats('TOKEN');

  assert.equal(result.success, true);
  assert.equal(result.data.borrowerReceivable, 350);
  assert.equal(result.data.outstandingLoan, 800);
});

test('dashboard reads each source sheet once regardless of row count', () => {
  const many = Array.from({ length: 500 }, (_, index) => ({
    'Customer ID': `C${index}`,
    'Current Due': index % 10
  }));
  const { context, reads } = runtime({
    SALES: [], SALES_RETURN_ITEMS: [], CUSTOMER_LEDGER: [], EXPENSES: [], PURCHASES: [],
    CUSTOMERS: many,
    SUPPLIERS: many.map((row, index) => ({ 'Supplier ID': `S${index}`, 'Current Due': row['Current Due'] })),
    PRODUCTS: many.map((row, index) => ({ 'Product ID': `P${index}`, 'Current Stock': 5, 'Minimum Stock': 2 }))
  });

  const result = context.getDashboardStats('TOKEN');

  assert.equal(result.success, true);
  assert.deepEqual(reads, {
    SALES: 1,
    CUSTOMER_LEDGER: 1,
    EXPENSES: 1,
    PURCHASES: 1,
    CUSTOMERS: 1,
    SUPPLIERS: 1,
    PRODUCTS: 1,
    FINANCE_TRANSACTIONS: 1
  });
});
