'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'Reports.gs'), 'utf8');

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
  const cache = new Map();
  const context = {
    console,
    CONFIG: { APP_NAME: 'SherERP' },
    CacheService: {
      getScriptCache: () => ({
        get: key => cache.has(key) ? cache.get(key) : null,
        put: (key, value) => cache.set(key, value)
      })
    },
    getAllRows_: key => read(key, false),
    activeRows_: key => read(key, true),
    activeSalesReturnItems_: () => read('SALES_RETURN_ITEMS', true),
    activePurchaseReturnItems_: () => read('PURCHASE_RETURN_ITEMS', true),
    isDeleted_: isDeleted,
    safeDateOnly_: value => String(value == null ? '' : value).slice(0, 10),
    sanitizeInput_: value => String(value == null ? '' : value).trim(),
    formatDate_: () => '2026-09-08',
    roundMoney_: roundMoney,
    isValidNonNegativeNumber_: value => value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) >= 0,
    economicReturnLineAmount_: (row, subtotal, grandTotal) => {
      const line = row['Line Total'] !== '' && row['Line Total'] != null
        ? Number(row['Line Total']) || 0
        : (Number(row['Return Quantity']) || 0) * (Number(row['Unit Price']) || 0);
      return subtotal > 0 ? roundMoney(line * Number(grandTotal) / Number(subtotal)) : 0;
    },
    assertUniqueSalesInvoiceIds_: rows => {
      const ids = new Set();
      rows.forEach(row => {
        if (ids.has(row['Invoice ID'])) throw new Error(`Duplicate invoice ID: ${row['Invoice ID']}`);
        ids.add(row['Invoice ID']);
      });
    },
    computeSettlementDiscountProfit_: () => ({
      customerDiscountGiven: 0,
      supplierDiscountReceived: 0,
      netProfitImpact: 0
    }),
    requirePermission_: () => ({ 'Full Name': 'Tester' }),
    ok_: data => ({ success: true, data }),
    fail_: message => ({ success: false, message: String(message) }),
    logError_: () => {}
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'Reports.gs' });
  return { context, reads, sheets };
}

function sale(overrides = {}) {
  return {
    'Invoice ID': 'INV-1',
    Date: '2026-09-08',
    Subtotal: 100,
    'Grand Total': 100,
    Discount: 0,
    'Paid Amount': 100,
    'Due Amount': 0,
    'Payment Type': 'Cash',
    'Customer Name': 'Buyer',
    'Is Deleted': '',
    ...overrides
  };
}

test('report range defaults invalid values and swaps a reversed valid range', () => {
  const { context } = runtime();
  assert.deepEqual(JSON.parse(JSON.stringify(context.reportRange_({}))), {
    from: '2026-09-01', to: '2026-09-08'
  });
  assert.deepEqual(JSON.parse(JSON.stringify(context.reportRange_({ from: '2026-09-08', to: '2026-09-02' }))), {
    from: '2026-09-02', to: '2026-09-08'
  });
});

test('sales report subtracts returns and excludes deleted or out-of-range invoices', () => {
  const { context } = runtime({
    SALES: [
      sale(),
      sale({ 'Invoice ID': 'INV-2', 'Grand Total': 900, 'Is Deleted': 'TRUE' }),
      sale({ 'Invoice ID': 'INV-3', Date: '2026-08-31', 'Grand Total': 500 })
    ],
    SALES_RETURN_ITEMS: [
      { 'Invoice ID': 'INV-1', 'Product ID': 'P1', 'Return Quantity': 1, 'Unit Price': 25, 'Line Total': 25 }
    ]
  });

  const result = context.getSalesReport('TOKEN', { from: '2026-09-01', to: '2026-09-08' });

  assert.equal(result.success, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.data.totals)), {
    invoices: 1,
    grossSales: 100,
    discount: 0,
    returned: 25,
    netSales: 75,
    paid: 100,
    due: 0
  });
});

test('sales report returns all monetary totals rounded to two decimals', () => {
  const { context } = runtime({
    SALES: [
      sale({ 'Invoice ID': 'INV-1', Subtotal: 0.1, 'Grand Total': 0.1, 'Paid Amount': 0.1 }),
      sale({ 'Invoice ID': 'INV-2', Subtotal: 0.2, 'Grand Total': 0.2, 'Paid Amount': 0.2 })
    ],
    SALES_RETURN_ITEMS: []
  });

  const result = context.getSalesReport('TOKEN', { from: '2026-09-08', to: '2026-09-08' });

  assert.equal(result.success, true);
  assert.equal(result.data.totals.grossSales, 0.3);
  assert.equal(result.data.totals.netSales, 0.3);
  assert.equal(result.data.totals.paid, 0.3);
});

test('purchase report returns all monetary totals rounded to two decimals', () => {
  const { context } = runtime({
    PURCHASES: [
      {
        'Purchase ID': 'PUR-1', Date: '2026-09-08', Subtotal: 0.1,
        'Grand Total': 0.1, Discount: 0, 'Paid Amount': 0.1, 'Due Amount': 0,
        'Supplier Name': 'Supplier'
      },
      {
        'Purchase ID': 'PUR-2', Date: '2026-09-08', Subtotal: 0.2,
        'Grand Total': 0.2, Discount: 0, 'Paid Amount': 0.2, 'Due Amount': 0,
        'Supplier Name': 'Supplier'
      }
    ],
    PURCHASE_RETURN_ITEMS: []
  });

  const result = context.getPurchaseReport('TOKEN', { from: '2026-09-08', to: '2026-09-08' });

  assert.equal(result.success, true);
  assert.equal(result.data.totals.grossPurchases, 0.3);
  assert.equal(result.data.totals.netPurchases, 0.3);
  assert.equal(result.data.totals.paid, 0.3);
});

test('profit product revenue falls back to quantity times unit price for a legacy blank line total', () => {
  const { context } = runtime({
    SALES: [sale()],
    SALE_ITEMS: [{
      'Invoice ID': 'INV-1', 'Product ID': 'P1', 'Product Name': 'Widget',
      Quantity: 2, 'Unit Price': 50, 'Line Total': ''
    }],
    SALES_RETURN_ITEMS: [],
    SALE_ITEM_LOTS: [{ 'Invoice ID': 'INV-1', 'Product ID': 'P1', Quantity: 2, 'Unit Cost': 30 }],
    EXPENSES: []
  });

  const result = context.computeProfit_({ from: '2026-09-08', to: '2026-09-08' });

  assert.equal(result.totals.netRevenue, 100);
  assert.equal(result.byProduct[0].revenue, 100);
  assert.equal(result.byProduct[0].cost, 60);
  assert.equal(result.byProduct[0].profit, 40);
});

test('profit includes vendor-sourced cost and reports full cost coverage', () => {
  const { context } = runtime({
    SALES: [sale()],
    SALE_ITEMS: [{
      'Invoice ID': 'INV-1', 'Product ID': 'P1', 'Product Name': 'Widget',
      Quantity: 2, 'Unit Price': 50, 'Line Total': 100
    }],
    SALES_RETURN_ITEMS: [],
    SALE_ITEM_LOTS: [{ 'Invoice ID': 'INV-1', 'Product ID': 'P1', Quantity: 1, 'Unit Cost': 20 }],
    VENDOR_SOURCING: [{
      'Sourcing ID': 'VS-1', 'Invoice ID': 'INV-1', 'Product ID': 'P1',
      'Product Name': 'Widget', Quantity: 1, 'Unit Cost': 30, 'Total Cost': 30
    }],
    EXPENSES: []
  });

  const result = context.computeProfit_({ from: '2026-09-08', to: '2026-09-08' });

  assert.equal(result.totals.cogs, 50);
  assert.equal(result.totals.grossProfit, 50);
  assert.equal(result.byProduct[0].cost, 50);
  assert.equal(result.coverage.invoicesWithLotData, 1);
  assert.equal(result.coverage.invoicesMissingLotData, 0);
});

test('profit coverage flags an invoice when cost evidence covers only part of a product quantity', () => {
  const { context } = runtime({
    SALES: [sale()],
    SALE_ITEMS: [{
      'Invoice ID': 'INV-1', 'Product ID': 'P1', 'Product Name': 'Widget',
      Quantity: 2, 'Unit Price': 50, 'Line Total': 100
    }],
    SALES_RETURN_ITEMS: [],
    SALE_ITEM_LOTS: [{ 'Invoice ID': 'INV-1', 'Product ID': 'P1', Quantity: 1, 'Unit Cost': 20 }],
    VENDOR_SOURCING: [],
    EXPENSES: []
  });

  const result = context.computeProfit_({ from: '2026-09-08', to: '2026-09-08' });

  assert.equal(result.coverage.invoicesWithLotData, 0);
  assert.equal(result.coverage.invoicesMissingLotData, 1);
});

test('cash report derives chronological opening and closing from live movements', () => {
  const { context } = runtime({
    CASH_BOOK: [
      { 'Entry ID': 'CB-1', Date: '2026-09-08T10:00:00', Type: 'Sale', Credit: 100, Debit: '', Balance: 100 },
      { 'Entry ID': 'CB-2', Date: '2026-09-01T10:00:00', Type: 'Opening', Credit: 50, Debit: '', Balance: 150 }
    ],
    BANK_BOOK: [],
    BANK_ACCOUNTS: []
  });

  const result = context.getCashBankReport('TOKEN', { from: '2026-09-08', to: '2026-09-08' });

  assert.equal(result.success, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.data.cash)), {
    opening: 50,
    inflow: 100,
    outflow: 0,
    closing: 150,
    entries: 1,
    byType: [{ label: 'Sale', entries: 1, inflow: 100, outflow: 0, net: 100 }]
  });
});

test('bank report excludes delete-voided rows but keeps both sides of manual reversal pairs', () => {
  const { context } = runtime({
    CASH_BOOK: [],
    BANK_ACCOUNTS: [{
      'Bank Account ID': 'B1', 'Account Name': 'Bank', Status: 'Active',
      'Opening Balance': 0, 'Current Balance': 50
    }],
    BANK_BOOK: [
      { 'Entry ID': 'BB-VOID', 'Bank Account ID': 'B1', Date: '2026-09-08', Credit: 500, Debit: '', Status: 'Reversed' },
      { 'Entry ID': 'BB-1', 'Bank Account ID': 'B1', Date: '2026-09-08', Credit: 100, Debit: '', Status: 'Reversed' },
      { 'Entry ID': 'BB-2', 'Bank Account ID': 'B1', Date: '2026-09-08', Credit: '', Debit: 100, Status: 'Active', 'Reversal Of': 'BB-1' },
      { 'Entry ID': 'BB-3', 'Bank Account ID': 'B1', Date: '2026-09-08', Credit: 50, Debit: '', Status: 'Active' }
    ]
  });

  const result = context.getCashBankReport('TOKEN', { from: '2026-09-08', to: '2026-09-08' });

  assert.equal(result.success, true);
  assert.equal(result.data.banks[0].entries, 3);
  assert.equal(result.data.banks[0].inflow, 150);
  assert.equal(result.data.banks[0].outflow, 100);
  assert.equal(result.data.banks[0].closing, 50);
});

test('cash and bank report totals are rounded to two-decimal currency', () => {
  const { context } = runtime({
    CASH_BOOK: [
      { 'Entry ID': 'CB-1', Date: '2026-09-08', Type: 'Sale', Credit: 0.1, Debit: '' },
      { 'Entry ID': 'CB-2', Date: '2026-09-08', Type: 'Sale', Credit: 0.2, Debit: '' }
    ],
    BANK_ACCOUNTS: [{
      'Bank Account ID': 'B1', 'Account Name': 'Bank', Status: 'Active',
      'Opening Balance': 0, 'Current Balance': 0.1 + 0.2
    }],
    BANK_BOOK: [
      { 'Entry ID': 'BB-1', 'Bank Account ID': 'B1', Date: '2026-09-08', Credit: 0.1, Debit: '', Status: 'Active' },
      { 'Entry ID': 'BB-2', 'Bank Account ID': 'B1', Date: '2026-09-08', Credit: 0.2, Debit: '', Status: 'Active' }
    ]
  });

  const result = context.getCashBankReport('TOKEN', { from: '2026-09-08', to: '2026-09-08' });

  assert.equal(result.success, true);
  assert.equal(result.data.cash.inflow, 0.3);
  assert.equal(result.data.cash.closing, 0.3);
  assert.equal(result.data.bankTotals.inflow, 0.3);
  assert.equal(result.data.bankTotals.closing, 0.3);
  assert.equal(result.data.banks[0].currentBalance, 0.3);
  assert.equal(result.data.combined.closing, 0.6);
});

test('profit calculation reads each transaction sheet once for any number of lines', () => {
  const saleItems = Array.from({ length: 500 }, (_, index) => ({
    'Invoice ID': 'INV-1', 'Product ID': `P${index}`, 'Product Name': `Product ${index}`,
    Quantity: 1, 'Unit Price': 1, 'Line Total': 1
  }));
  const lots = saleItems.map(item => ({
    'Invoice ID': 'INV-1', 'Product ID': item['Product ID'], Quantity: 1, 'Unit Cost': 0.5
  }));
  const { context, reads } = runtime({
    SALES: [sale({ Subtotal: 500, 'Grand Total': 500 })],
    SALE_ITEMS: saleItems,
    SALES_RETURN_ITEMS: [],
    SALE_ITEM_LOTS: lots,
    EXPENSES: []
  });

  context.computeProfit_({ from: '2026-09-08', to: '2026-09-08' });

  assert.deepEqual(reads, {
    SALES: 1,
    SALE_ITEMS: 1,
    SALES_RETURN_ITEMS: 1,
    SALE_ITEM_LOTS: 1,
    VENDOR_SOURCING: 1,
    EXPENSES: 1
  });
});
