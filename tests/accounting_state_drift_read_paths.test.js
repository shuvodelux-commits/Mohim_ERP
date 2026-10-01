'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const roundMoney = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const isDeleted = row => row && String(row['Is Deleted'] || '').toUpperCase() === 'TRUE';

function baseContext(sheets) {
  const ctx = {
    console,
    roundMoney_: roundMoney,
    sanitizeInput_: v => String(v == null ? '' : v).trim(),
    safeDateOnly_: v => String(v == null ? '' : v).slice(0, 10),
    formatDate_: () => '2026-09-08',
    isDeleted_: isDeleted,
    isValidNonNegativeNumber_: v => Number.isFinite(Number(v)) && Number(v) >= 0,
    getAllRows_: key => (sheets[key] || []).map((r, i) => ({ ...r, _rowIndex: r._rowIndex || i + 2 })),
    activeRows_: key => (sheets[key] || []).filter(r => !isDeleted(r)).map((r, i) => ({ ...r, _rowIndex: r._rowIndex || i + 2 })),
    findFirstRow_: (key, col, value) => (sheets[key] || []).find(r => String(r[col]) === String(value)) || null,
    findUniqueSalesRow_: invoiceId => (sheets.SALES || []).find(r => r['Invoice ID'] === invoiceId) || null,
    duplicateSalesInvoiceIdMap_: () => ({}),
    phoneMatchesSearch_: (phone, q) => String(phone || '').toLowerCase().includes(String(q || '').toLowerCase()),
    activeSalesReturnItems_: () => sheets.SALES_RETURN_ITEMS || [],
    activePurchaseReturnItems_: () => sheets.PURCHASE_RETURN_ITEMS || [],
    outstandingSaleOwnStockByProduct_: () => ({ P1: 1 }),
    grossSaleItemLineTotal_: row => Number(row['Line Total']) || (Number(row.Quantity) || 0) * (Number(row['Unit Price']) || 0),
    effectiveTransactionUnitPrice_: value => Number(value) || 0,
    economicReturnLineAmount_: row => Number(row['Line Total']) || 0,
    requirePermission_: () => ({ 'Full Name': 'Tester' }),
    ok_: data => ({ success: true, data }),
    fail_: message => ({ success: false, message: String(message) }),
    logError_: () => {},
    reportRange_: undefined,
    inRange_: (date, range) => date >= range.from && date <= range.to,
    sortedByDesc_: (map, field) => Object.values(map).sort((a, b) => Number(b[field]) - Number(a[field])),
    assertUniqueSalesInvoiceIds_: () => {},
    computeSettlementDiscountProfit_: () => ({ customerDiscountGiven: 0, supplierDiscountReceived: 0, netProfitImpact: 0 }),
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) }
  };
  return ctx;
}

test('Sales Return search/detail use live customer settlement paid due and status', () => {
  const sheets = {
    SALES: [{
      'Invoice ID': 'INV-1', Date: '2026-09-08', 'Customer ID': 'C1', 'Customer Name': 'Buyer', 'Customer Phone': '017',
      'Customer Address': '', Subtotal: 100, 'Grand Total': 100, 'Paid Amount': 0, 'Due Amount': 100,
      'Payment Status': 'Due', 'Created At': '2026-09-08T10:00:00', 'Is Deleted': ''
    }],
    SALE_ITEMS: [{ 'Invoice ID': 'INV-1', 'Product ID': 'P1', 'Product Name': 'Widget', Quantity: 1, 'Unit Price': 100, 'Line Total': 100 }],
    SALES_RETURN_ITEMS: []
  };
  const ctx = baseContext(sheets);
  ctx.customerSettlementState_ = () => ({ marker: 'customer' });
  ctx.customerInvoiceSettlementSnapshotFromState_ = () => ({ paidAmount: 100, dueAmount: 0, paymentStatus: 'Paid' });
  ctx.customerInvoiceSettlementSnapshot_ = () => ({ paidAmount: 100, dueAmount: 0, paymentStatus: 'Paid' });
  ctx.customerInvoiceCashCollected_ = () => 100;
  vm.createContext(ctx);
  vm.runInContext(read('SalesReturn.gs'), ctx, { filename: 'SalesReturn.gs' });

  const search = ctx.searchInvoicesForReturn('T', 'INV-1');
  assert.equal(search.success, true);
  assert.equal(search.data[0].paymentStatus, 'Paid');
  const detail = ctx.getInvoiceForReturn('T', 'INV-1');
  assert.equal(detail.success, true);
  assert.equal(detail.data.paidAmount, 100);
  assert.equal(detail.data.dueAmount, 0);
});

test('Purchase Management list/detail use live supplier settlement paid due and status', () => {
  const sheets = {
    PURCHASES: [{
      'Purchase ID': 'PUR-1', Date: '2026-09-08', 'Supplier ID': 'S1', 'Supplier Name': 'Supplier',
      Subtotal: 100, Discount: 0, 'Grand Total': 100, 'Paid Amount': 0, 'Due Amount': 100,
      'Payment Status': 'Due', 'Payment Method': 'Cash', 'Is Deleted': ''
    }],
    PURCHASE_RETURN: [], PURCHASE_ITEMS: [], PRODUCTS: [], STOCK_LOTS: []
  };
  const ctx = baseContext(sheets);
  ctx.supplierSettlementState_ = () => ({ marker: 'supplier' });
  ctx.supplierPurchaseSettlementSnapshotFromState_ = () => ({ paidAmount: 100, dueAmount: 0, supplierCreditUsed: 0, paymentStatus: 'Paid' });
  ctx.supplierPurchaseSettlementSnapshot_ = () => ({ paidAmount: 100, dueAmount: 0, supplierCreditUsed: 0, paymentStatus: 'Paid' });
  vm.createContext(ctx);
  vm.runInContext(read('PurchaseManagement.gs'), ctx, { filename: 'PurchaseManagement.gs' });

  const list = ctx.getPurchaseManagementList('T');
  assert.equal(list.success, true);
  assert.equal(list.data[0].paidAmount, 100);
  assert.equal(list.data[0].dueAmount, 0);
  assert.equal(list.data[0].paymentStatus, 'Paid');
  const detail = ctx.getPurchaseDetail('T', 'PUR-1');
  assert.equal(detail.success, true);
  assert.equal(detail.data.paidAmount, 100);
  assert.equal(detail.data.dueAmount, 0);
  assert.equal(detail.data.paymentStatus, 'Paid');
});

test('Purchase Return search/detail use live supplier settlement state', () => {
  const sheets = {
    PURCHASES: [{
      'Purchase ID': 'PUR-1', Date: '2026-09-08', 'Supplier ID': 'S1', 'Supplier Name': 'Supplier',
      Subtotal: 100, 'Grand Total': 100, 'Paid Amount': 0, 'Due Amount': 100,
      'Payment Status': 'Due', 'Created At': '2026-09-08T10:00:00', 'Is Deleted': ''
    }],
    PURCHASE_ITEMS: [{ 'Purchase ID': 'PUR-1', 'Product ID': 'P1', 'Product Name': 'Widget', Quantity: 1, 'Unit Price': 100 }],
    PURCHASE_RETURN_ITEMS: []
  };
  const ctx = baseContext(sheets);
  ctx.supplierSettlementState_ = () => ({ marker: 'supplier' });
  ctx.supplierPurchaseSettlementSnapshotFromState_ = () => ({ paidAmount: 100, dueAmount: 0, supplierCreditUsed: 0, paymentStatus: 'Paid' });
  ctx.supplierPurchaseSettlementSnapshot_ = () => ({ paidAmount: 100, dueAmount: 0, supplierCreditUsed: 0, paymentStatus: 'Paid' });
  vm.createContext(ctx);
  vm.runInContext(read('PurchaseReturn.gs'), ctx, { filename: 'PurchaseReturn.gs' });

  const search = ctx.searchPurchasesForReturn('T', 'PUR-1');
  assert.equal(search.success, true);
  assert.equal(search.data[0].paymentStatus, 'Paid');
  const detail = ctx.getPurchaseForReturn('T', 'PUR-1');
  assert.equal(detail.success, true);
  assert.equal(detail.data.paidAmount, 100);
  assert.equal(detail.data.dueAmount, 0);
});

test('Sales and Purchase reports use live settlement snapshots for paid and due', () => {
  const sheets = {
    SALES: [{
      'Invoice ID': 'INV-1', Date: '2026-09-08', 'Customer ID': 'C1', 'Customer Name': 'Buyer', Subtotal: 100,
      'Grand Total': 100, Discount: 0, 'Paid Amount': 0, 'Due Amount': 100, 'Payment Type': 'Due', 'Is Deleted': ''
    }],
    SALES_RETURN_ITEMS: [], SALES_RETURN: [], CUSTOMER_LEDGER: [],
    PURCHASES: [{
      'Purchase ID': 'PUR-1', Date: '2026-09-08', 'Supplier ID': 'S1', 'Supplier Name': 'Supplier', Subtotal: 100,
      'Grand Total': 100, Discount: 0, 'Paid Amount': 0, 'Due Amount': 100, 'Payment Status': 'Due', 'Is Deleted': ''
    }],
    PURCHASE_RETURN_ITEMS: [], PURCHASE_RETURN: [], SUPPLIER_LEDGER: []
  };
  const ctx = baseContext(sheets);
  ctx.customerSettlementState_ = () => ({ paymentByInvoice: { 'INV-1': 100 } });
  ctx.customerInvoiceSettlementSnapshotFromState_ = () => ({ paidAmount: 100, dueAmount: 0, paymentStatus: 'Paid' });
  ctx.supplierSettlementState_ = () => ({ paymentByPurchase: { 'PUR-1': 100 } });
  ctx.supplierPurchaseSettlementSnapshotFromState_ = () => ({ paidAmount: 100, dueAmount: 0, paymentStatus: 'Paid' });
  vm.createContext(ctx);
  vm.runInContext(read('Reports.gs'), ctx, { filename: 'Reports.gs' });

  const sales = ctx.getSalesReport('T', { from: '2026-09-08', to: '2026-09-08' });
  assert.equal(sales.success, true);
  assert.equal(sales.data.totals.paid, 100);
  assert.equal(sales.data.totals.due, 0);

  const purchases = ctx.getPurchaseReport('T', { from: '2026-09-08', to: '2026-09-08' });
  assert.equal(purchases.success, true);
  assert.equal(purchases.data.totals.paid, 100);
  assert.equal(purchases.data.totals.due, 0);
  assert.equal(purchases.data.topSuppliers[0].due, 0);
});

test('POS phone sales history uses live customer settlement payment status', () => {
  const sheets = {
    SALES: [{
      'Invoice ID': 'INV-PHONE', Date: '2026-09-08', Time: '10:00:00',
      'Customer ID': 'C1', 'Customer Name': 'Buyer', 'Customer Phone': '01700000000',
      'Grand Total': 100, 'Paid Amount': 0, 'Due Amount': 100,
      'Payment Status': 'Due', 'Created At': '2026-09-08T10:00:00', 'Is Deleted': ''
    }],
    CUSTOMER_LEDGER: [], SALES_RETURN: []
  };
  const ctx = baseContext(sheets);
  ctx.normalizePhoneDisplay_ = value => String(value || '').trim();
  ctx.phoneNumbersEqual_ = (a, b) => String(a || '') === String(b || '');
  ctx.safeTimeOnly_ = value => String(value || '').slice(0, 8);
  ctx.customerSettlementState_ = () => ({ marker: 'customer' });
  ctx.customerInvoiceSettlementSnapshotFromState_ = () => ({ paidAmount: 100, dueAmount: 0, paymentStatus: 'Paid' });
  vm.createContext(ctx);
  vm.runInContext(read('Invoice.gs'), ctx, { filename: 'Invoice.gs' });

  const result = ctx.findSalesByPhone('T', '01700000000', 'C1');
  assert.equal(result.success, true);
  assert.equal(result.data[0].paymentStatus, 'Paid');
});
