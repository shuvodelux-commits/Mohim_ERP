'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const roundMoney = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const isDeleted = row => row && (row['Is Deleted'] === true || String(row['Is Deleted'] || '').toUpperCase() === 'TRUE');

function runtime(initialSheets) {
  const sheets = Object.fromEntries(Object.entries(initialSheets).map(([k, rows]) => [k, rows.map((r, i) => ({ ...r, _rowIndex: r._rowIndex || i + 2 }))]));
  const ctx = {
    console,
    roundMoney_: roundMoney,
    sanitizeInput_: v => String(v == null ? '' : v).trim(),
    safeDateOnly_: v => String(v == null ? '' : v).slice(0, 10),
    formatDate_: () => '2026-09-08',
    isDeleted_: isDeleted,
    isValidNonNegativeNumber_: v => v !== '' && v != null && Number.isFinite(Number(v)) && Number(v) >= 0,
    getAllRows_: key => (sheets[key] || []).map(r => ({ ...r })),
    activeRows_: key => (sheets[key] || []).filter(r => !isDeleted(r)).map(r => ({ ...r })),
    activeSalesReturnItems_: () => (sheets.SALES_RETURN_ITEMS || []).filter(r => !isDeleted(r)).map(r => ({ ...r })),
    activePurchaseReturnItems_: () => (sheets.PURCHASE_RETURN_ITEMS || []).filter(r => !isDeleted(r)).map(r => ({ ...r })),
    findFirstRow_: (key, col, value) => (sheets[key] || []).find(r => String(r[col]) === String(value)) || null,
    findUniqueSalesRow_: invoiceId => (sheets.SALES || []).find(r => String(r['Invoice ID']) === String(invoiceId)) || null,
    assertUniqueSalesInvoiceIds_: rows => {
      const seen = new Set();
      rows.forEach(r => { if (seen.has(r['Invoice ID'])) throw new Error('Duplicate invoice'); seen.add(r['Invoice ID']); });
    },
    economicReturnLineAmount_: (row, subtotal, grandTotal) => {
      const line = row['Line Total'] !== '' && row['Line Total'] != null
        ? Number(row['Line Total']) || 0
        : (Number(row['Return Quantity']) || 0) * (Number(row['Unit Price']) || 0);
      return Number(subtotal) > 0 ? roundMoney(line * Number(grandTotal) / Number(subtotal)) : 0;
    },
    reportRange_: undefined,
    inRange_: (date, range) => date >= range.from && date <= range.to,
    sortedByDesc_: (map, field) => Object.values(map).sort((a, b) => Number(b[field]) - Number(a[field])),
    computeSettlementDiscountProfit_: () => ({ customerDiscountGiven: 0, supplierDiscountReceived: 0, netProfitImpact: 0 }),
    requirePermission_: () => ({ 'Full Name': 'Tester' }),
    ok_: data => ({ success: true, data }),
    fail_: message => ({ success: false, message: String(message) }),
    logError_: () => {},
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) }
  };
  vm.createContext(ctx);
  for (const file of ['SettlementDiscount.gs', 'CustomerSettlement.gs', 'SupplierSettlement.gs', 'Reports.gs']) {
    vm.runInContext(read(file), ctx, { filename: file });
  }
  return { ctx, sheets };
}

function customerLedger(overrides = {}) {
  return {
    _rowIndex: 2, 'Ledger ID': 'CL-1', Date: '2026-09-08', 'Customer ID': 'C1',
    Type: 'Sale', Reference: 'INV-1', Debit: 100, Credit: '', 'Payment Method': '', 'Is Deleted': '', ...overrides
  };
}
function supplierLedger(overrides = {}) {
  return {
    _rowIndex: 2, 'Ledger ID': 'SL-1', Date: '2026-09-08', 'Supplier ID': 'S1',
    Type: 'Purchase', Reference: 'PUR-1', Debit: 100, Credit: '', 'Payment Method': '', 'Is Deleted': '', ...overrides
  };
}

test('sales report Collected excludes sales-return credit that only reduces receivable', () => {
  const { ctx } = runtime({
    SALES: [{
      'Invoice ID': 'INV-1', Date: '2026-09-08', 'Customer ID': 'C1', 'Customer Name': 'Buyer',
      Subtotal: 100, 'Grand Total': 100, Discount: 0, 'Paid Amount': 0, 'Due Amount': 100,
      'Payment Type': 'Due', 'Payment Method': '', 'Payment Status': 'Due', 'Is Deleted': ''
    }],
    CUSTOMER_LEDGER: [
      customerLedger(),
      customerLedger({ _rowIndex: 3, 'Ledger ID': 'RET-CREDIT', Type: 'Sales Return Credit', Reference: 'RET-1', Debit: '', Credit: 40 })
    ],
    SALES_RETURN: [{ 'Return ID': 'RET-1', 'Invoice ID': 'INV-1', 'Refund Method': 'Store Credit', 'Is Deleted': '' }],
    SALES_RETURN_ITEMS: [{ 'Return ID': 'RET-1', 'Invoice ID': 'INV-1', 'Return Quantity': 1, 'Unit Price': 40, 'Line Total': 40, 'Is Deleted': '' }],
    PURCHASES: [], PURCHASE_RETURN: [], PURCHASE_RETURN_ITEMS: [], SUPPLIER_LEDGER: []
  });

  const result = ctx.getSalesReport('T', { from: '2026-09-08', to: '2026-09-08' });
  assert.equal(result.success, true);
  assert.equal(result.data.totals.returned, 40);
  assert.equal(result.data.totals.netSales, 60);
  assert.equal(result.data.totals.paid, 0, 'store credit is settlement, not money collected');
  assert.equal(result.data.totals.due, 60);
});

test('purchase report Paid excludes purchase-return credit that only reduces supplier payable', () => {
  const { ctx } = runtime({
    SALES: [], SALES_RETURN: [], SALES_RETURN_ITEMS: [], CUSTOMER_LEDGER: [],
    PURCHASES: [{
      'Purchase ID': 'PUR-1', Date: '2026-09-08', 'Supplier ID': 'S1', 'Supplier Name': 'Supplier',
      Subtotal: 100, 'Grand Total': 100, Discount: 0, 'Paid Amount': 0, 'Due Amount': 100,
      'Payment Method': '', 'Payment Status': 'Due', 'Is Deleted': ''
    }],
    SUPPLIER_LEDGER: [
      supplierLedger(),
      supplierLedger({ _rowIndex: 3, 'Ledger ID': 'RET-CREDIT', Type: 'Purchase Return Credit', Reference: 'PRET-1', Debit: '', Credit: 40 })
    ],
    PURCHASE_RETURN: [{ 'Return ID': 'PRET-1', 'Purchase ID': 'PUR-1', 'Is Deleted': '' }],
    PURCHASE_RETURN_ITEMS: [{ 'Return ID': 'PRET-1', 'Purchase ID': 'PUR-1', 'Return Quantity': 1, 'Unit Price': 40, 'Line Total': 40, 'Is Deleted': '' }]
  });

  const result = ctx.getPurchaseReport('T', { from: '2026-09-08', to: '2026-09-08' });
  assert.equal(result.success, true);
  assert.equal(result.data.totals.returned, 40);
  assert.equal(result.data.totals.netPurchases, 60);
  assert.equal(result.data.totals.paid, 0, 'supplier credit is settlement, not money paid');
  assert.equal(result.data.totals.due, 60);
  assert.equal(result.data.topSuppliers[0].due, 60);
});

test('later real customer and supplier payments are counted while settlement credit is not', () => {
  const { ctx } = runtime({
    SALES: [{
      'Invoice ID': 'INV-1', Date: '2026-09-08', 'Customer ID': 'C1', 'Customer Name': 'Buyer',
      Subtotal: 100, 'Grand Total': 100, Discount: 0, 'Paid Amount': 0, 'Due Amount': 100,
      'Payment Type': 'Due', 'Payment Method': '', 'Payment Status': 'Due', 'Is Deleted': ''
    }],
    CUSTOMER_LEDGER: [
      customerLedger(),
      customerLedger({ _rowIndex: 3, 'Ledger ID': 'PAY-1', Type: 'Payment', Reference: 'PAYMENT', Debit: '', Credit: 60, 'Payment Amount': 60, 'Payment Method': 'Cash' }),
      customerLedger({ _rowIndex: 4, 'Ledger ID': 'RET-CREDIT', Type: 'Sales Return Credit', Reference: 'RET-1', Debit: '', Credit: 40 })
    ],
    SALES_RETURN: [{ 'Return ID': 'RET-1', 'Invoice ID': 'INV-1', 'Refund Method': 'Store Credit', 'Is Deleted': '' }],
    SALES_RETURN_ITEMS: [{ 'Return ID': 'RET-1', 'Invoice ID': 'INV-1', 'Return Quantity': 1, 'Unit Price': 40, 'Line Total': 40, 'Is Deleted': '' }],
    PURCHASES: [{
      'Purchase ID': 'PUR-1', Date: '2026-09-08', 'Supplier ID': 'S1', 'Supplier Name': 'Supplier',
      Subtotal: 100, 'Grand Total': 100, Discount: 0, 'Paid Amount': 0, 'Due Amount': 100,
      'Payment Method': '', 'Payment Status': 'Due', 'Is Deleted': ''
    }],
    SUPPLIER_LEDGER: [
      supplierLedger(),
      supplierLedger({ _rowIndex: 3, 'Ledger ID': 'PAY-1', Type: 'Payment', Reference: 'PAYMENT', Debit: '', Credit: 60, 'Payment Amount': 60, 'Payment Method': 'Cash' }),
      supplierLedger({ _rowIndex: 4, 'Ledger ID': 'RET-CREDIT', Type: 'Purchase Return Credit', Reference: 'PRET-1', Debit: '', Credit: 40 })
    ],
    PURCHASE_RETURN: [{ 'Return ID': 'PRET-1', 'Purchase ID': 'PUR-1', 'Is Deleted': '' }],
    PURCHASE_RETURN_ITEMS: [{ 'Return ID': 'PRET-1', 'Purchase ID': 'PUR-1', 'Return Quantity': 1, 'Unit Price': 40, 'Line Total': 40, 'Is Deleted': '' }]
  });

  const sales = ctx.getSalesReport('T', { from: '2026-09-08', to: '2026-09-08' });
  const purchases = ctx.getPurchaseReport('T', { from: '2026-09-08', to: '2026-09-08' });
  assert.equal(sales.success, true);
  assert.equal(purchases.success, true);
  assert.equal(sales.data.totals.paid, 60);
  assert.equal(sales.data.totals.due, 0);
  assert.equal(purchases.data.totals.paid, 60);
  assert.equal(purchases.data.totals.due, 0);
});
