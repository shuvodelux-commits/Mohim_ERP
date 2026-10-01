'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

function workbook(seed = {}) {
  const tables = structuredClone(seed);
  const writes = [];
  let locked = false;
  let serial = 0;
  const rows = key => tables[key] || (tables[key] = []);
  const ctx = vm.createContext({ console, Date, Math, JSON, CONFIG: { LOCK_TIMEOUT_MS: 1000 } });

  for (const name of ['Utils.gs', 'CustomerSettlement.gs', 'StockLots.gs', 'SalesReturn.gs']) {
    vm.runInContext(read(name), ctx, { filename: name });
  }

  const mutate = (key, action) => {
    if (!locked && key !== 'SALE_ITEM_LOTS') {
      // Maintenance repair is allowed outside a transaction lock; normal
      // transaction paths are still checked by their business tests.
    }
    writes.push(key);
    return action();
  };

  Object.assign(ctx, {
    LockService: { getScriptLock: () => ({ waitLock: () => { assert.equal(locked, false); locked = true; }, releaseLock: () => { locked = false; } }) },
    Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: {
      formatDate: (date, zone, format) => format === 'HH:mm:ss' ? '12:00:00' : new Date(date).toISOString().slice(0, 10)
    },
    requirePermission_: () => ({ 'Full Name': 'Audit User' }),
    actorName_: user => user['Full Name'],
    requireActiveCashSession_: () => ({ id: 'CS1' }),
    logError_: () => {},
    sanitizeInput_: value => String(value == null ? '' : value).trim(),
    isDeleted_: row => String(row && row['Is Deleted'] || '').toUpperCase() === 'TRUE',
    getAllRows_: key => rows(key).map((row, i) => ({ ...row, _rowIndex: i + 2 })),
    activeRows_: key => ctx.getAllRows_(key).filter(row => !ctx.isDeleted_(row)),
    findRows_: (key, col, value) => ctx.getAllRows_(key).filter(row => String(row[col]) === String(value)),
    findRowIndex_: (key, col, value) => {
      const i = rows(key).findIndex(row => String(row[col]) === String(value));
      return i < 0 ? -1 : i + 2;
    },
    appendRow_: (key, row) => mutate(key, () => { rows(key).push({ ...row }); return rows(key).length + 1; }),
    appendRows_: (key, values) => values.forEach(row => ctx.appendRow_(key, row)),
    updateRowFields_: (key, index, fields) => mutate(key, () => {
      assert.ok(rows(key)[index - 2], `${key} row ${index}`);
      Object.assign(rows(key)[index - 2], fields);
    }),
    generateId_: key => {
      serial++;
      const prefix = key === 'SALES_RETURN' ? 'SRT' : key === 'STOCK_MOVEMENT' ? 'SM' : key === 'STOCK_LOTS' ? 'LOT' : key;
      return `${prefix}-${String(serial).padStart(6, '0')}`;
    },
    resolveTransactionDate_: (_token, _module, date) => ({
      dateStr: date || '2026-09-21', isBackdated: false, backdatedDays: 0, reason: ''
    }),
    addCashBookEntry_: entry => ctx.appendRow_('CASH_BOOK', entry),
    resolveOrCreateCustomer_: () => { throw new Error('unexpected customer creation'); }
  });

  return { ctx, tables, rows, writes, setLocked: v => { locked = v; } };
}

function sale(id, customerId = 'C1', extra = {}) {
  return {
    'Invoice ID': id,
    Date: '2026-09-10',
    'Created At': '2026-09-10T10:00:00',
    'Customer ID': customerId,
    'Customer Name': 'Buyer',
    'Customer Phone': '01700000000',
    'Customer Address': 'Address',
    Subtotal: 500,
    'Grand Total': 500,
    'Paid Amount': 500,
    'Due Amount': 0,
    'Payment Method': 'Cash',
    'Payment Status': 'Paid',
    ...extra
  };
}

function item(invoiceId, productId = 'P1', qty = 5, unitPrice = 100, extra = {}) {
  return {
    'Invoice ID': invoiceId,
    'Product ID': productId,
    'Product Name': extra.name || 'Widget',
    Quantity: qty,
    'Unit Price': unitPrice,
    'Line Total': qty * unitPrice,
    ...extra
  };
}

function product(productId = 'P1', stock = 20, extra = {}) {
  return {
    'Product ID': productId,
    'Product Name': extra.name || 'Widget',
    'Current Stock': stock,
    'Purchase Price': 40,
    Status: 'Active',
    ...extra
  };
}

function lot(lotId, productId = 'P1', remaining = 0, extra = {}) {
  return {
    'Lot ID': lotId,
    'Product ID': productId,
    'Product Name': extra.name || 'Widget',
    'Purchase ID': extra.purchaseId || 'PUR-1',
    'Purchase Date': extra.purchaseDate || '2026-09-01',
    'Purchase Price': extra.purchasePrice == null ? 40 : extra.purchasePrice,
    'Sell Price': 100,
    'Original Quantity': extra.originalQuantity == null ? 5 : extra.originalQuantity,
    'Remaining Quantity': remaining,
    Status: 'Active',
    'Supplier ID': extra.supplierId || '',
    'Supplier Name': extra.supplierName || '',
    'Created At': '2026-09-01T09:00:00'
  };
}

test('SALE_ITEM_LOTS declares Supplier ID so Sales.gs writes persist', () => {
  const config = read('Config.gs');
  const block = config.match(/SALE_ITEM_LOTS:\s*\[([\s\S]*?)\n\s*\],\n\s*SETTINGS:/);
  assert.ok(block, 'SALE_ITEM_LOTS header block not found');
  assert.match(block[1], /["']Supplier ID["']/);
});

test('repairSaleItemLotSupplierIds_ fills only blank values from matching STOCK_LOTS Lot ID', () => {
  const w = workbook({
    STOCK_LOTS: [
      lot('L1', 'P1', 0, { supplierId: 'S1' }),
      lot('L2', 'P1', 0, { supplierId: 'S2' })
    ],
    SALE_ITEM_LOTS: [
      { 'Invoice ID': 'INV1', 'Product ID': 'P1', 'Lot ID': 'L1', Quantity: 1, 'Supplier ID': '' },
      { 'Invoice ID': 'INV2', 'Product ID': 'P1', 'Lot ID': 'L2', Quantity: 1, 'Supplier ID': 'S9' },
      { 'Invoice ID': 'INV3', 'Product ID': 'P1', 'Lot ID': 'MISSING', Quantity: 1, 'Supplier ID': '' }
    ]
  });

  assert.equal(typeof w.ctx.repairSaleItemLotSupplierIds_, 'function');
  const result = w.ctx.repairSaleItemLotSupplierIds_();
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { scanned: 3, repaired: 1, unresolved: 1 });
  assert.equal(w.rows('SALE_ITEM_LOTS')[0]['Supplier ID'], 'S1');
  assert.equal(w.rows('SALE_ITEM_LOTS')[1]['Supplier ID'], 'S9');
  assert.equal(w.rows('SALE_ITEM_LOTS')[2]['Supplier ID'], '');
  const second = w.ctx.repairSaleItemLotSupplierIds_();
  assert.deepEqual(JSON.parse(JSON.stringify(second)), { scanned: 3, repaired: 0, unresolved: 1 });
});

test('single return rejects a return date before the source invoice date before writes', () => {
  const w = workbook({
    SALES: [sale('INV1')],
    SALE_ITEMS: [item('INV1')],
    PRODUCTS: [product('P1', 20)],
    STOCK_LOTS: [lot('L1', 'P1', 0)],
    SALE_ITEM_LOTS: [{ 'Invoice ID': 'INV1', 'Product ID': 'P1', 'Lot ID': 'L1', Quantity: 5, 'Unit Cost': 40, 'Supplier ID': '' }],
    SALES_RETURN: [], SALES_RETURN_ITEMS: [], CUSTOMER_LEDGER: [], VENDOR_SOURCING: []
  });
  const result = w.ctx.completeReturn('token', {
    invoiceId: 'INV1',
    date: '2026-09-09',
    items: [{ productId: 'P1', qty: 1 }],
    refundMethod: 'Cash'
  });
  assert.equal(result.success, false);
  assert.match(result.message, /cannot be before.*invoice/i);
  assert.equal(w.writes.length, 0);
});

test('prepareSalesReturn_ validates and calculates a return without writes', () => {
  const w = workbook({
    SALES: [sale('INV1')],
    SALE_ITEMS: [item('INV1')],
    PRODUCTS: [product('P1', 20)],
    STOCK_LOTS: [lot('L1', 'P1', 0)],
    SALE_ITEM_LOTS: [{ 'Invoice ID': 'INV1', 'Product ID': 'P1', 'Lot ID': 'L1', Quantity: 5, 'Unit Cost': 40, 'Supplier ID': '' }],
    SALES_RETURN: [], SALES_RETURN_ITEMS: [], CUSTOMER_LEDGER: [], VENDOR_SOURCING: []
  });
  assert.equal(typeof w.ctx.prepareSalesReturn_, 'function');
  const prepared = w.ctx.prepareSalesReturn_({
    invoiceId: 'INV1', items: [{ productId: 'P1', qty: 2 }], refundMethod: 'Cash'
  }, {
    txDate: { dateStr: '2026-09-21', isBackdated: false, backdatedDays: 0, reason: '' }
  });
  assert.equal(prepared.invoiceId, 'INV1');
  assert.equal(prepared.totalReturnAmount, 200);
  assert.equal(prepared.validatedItems[0].qty, 2);
  assert.equal(prepared.stockChanges[0].newStock, 22);
  assert.equal(w.writes.length, 0);
});

test('planSaleReturnRestoration_ reserves most recently consumed evidence without writes', () => {
  const w = workbook({
    PRODUCTS: [product('P1', 20)],
    STOCK_LOTS: [lot('L1', 'P1', 0), lot('L2', 'P1', 0)],
    SALE_ITEM_LOTS: [
      { 'Invoice ID': 'INV1', 'Product ID': 'P1', 'Lot ID': 'L1', Quantity: 1, 'Supplier ID': 'S1' },
      { 'Invoice ID': 'INV1', 'Product ID': 'P1', 'Lot ID': 'L2', Quantity: 1, 'Supplier ID': 'S2' }
    ]
  });
  assert.equal(typeof w.ctx.planSaleReturnRestoration_, 'function');
  const plan = w.ctx.planSaleReturnRestoration_('INV1', 'P1', 'Widget', 2, {});
  assert.deepEqual(Array.from(plan.draws, d => [d.lotId, d.qty]), [['L2', 1], ['L1', 1]]);
  assert.equal(plan.fallbackQty, 0);
  assert.equal(w.writes.length, 0);
});

test('planSaleReturnRestoration_ shares virtual reservations across prepared returns', () => {
  const w = workbook({
    PRODUCTS: [product('P1', 20)],
    STOCK_LOTS: [lot('L1', 'P1', 0), lot('L2', 'P1', 0)],
    SALE_ITEM_LOTS: [
      { 'Invoice ID': 'INV1', 'Product ID': 'P1', 'Lot ID': 'L1', Quantity: 2, 'Supplier ID': 'S1' },
      { 'Invoice ID': 'INV1', 'Product ID': 'P1', 'Lot ID': 'L2', Quantity: 2, 'Supplier ID': 'S2' }
    ]
  });
  const virtualState = {};
  const first = w.ctx.planSaleReturnRestoration_('INV1', 'P1', 'Widget', 3, { virtualState });
  const second = w.ctx.planSaleReturnRestoration_('INV1', 'P1', 'Widget', 1, { virtualState });
  assert.deepEqual(Array.from(first.draws, d => [d.lotId, d.qty]), [['L2', 2], ['L1', 1]]);
  assert.deepEqual(Array.from(second.draws, d => [d.lotId, d.qty]), [['L1', 1]]);
  assert.equal(w.writes.length, 0);
});

function twoInvoiceOwnedSeed(overrides = {}) {
  return {
    SALES: [
      sale('INV1', 'C1', overrides.sale1 || {}),
      sale('INV2', 'C1', overrides.sale2 || {})
    ],
    SALE_ITEMS: [
      item('INV1', 'P1', 5, 100),
      item('INV2', 'P1', 5, 100)
    ],
    PRODUCTS: [product('P1', 20)],
    STOCK_LOTS: [lot('L1', 'P1', 0, { originalQuantity: 10, supplierId: 'S1' })],
    SALE_ITEM_LOTS: [
      { 'Invoice ID': 'INV1', 'Product ID': 'P1', 'Lot ID': 'L1', Quantity: 5, 'Unit Cost': 40, 'Supplier ID': 'S1' },
      { 'Invoice ID': 'INV2', 'Product ID': 'P1', 'Lot ID': 'L1', Quantity: 5, 'Unit Cost': 40, 'Supplier ID': 'S1' }
    ],
    SALES_RETURN: [], SALES_RETURN_ITEMS: [], CUSTOMER_LEDGER: [], VENDOR_SOURCING: [], CASH_BOOK: [],
    CUSTOMERS: [{ 'Customer ID': 'C1', 'Customer Name': 'Buyer', Phone: '01700000000', 'Current Due': 0, Status: 'Active' }]
  };
}

function batchPayload(extra = {}) {
  return {
    invoiceReturns: [
      { invoiceId: 'INV1', items: [{ productId: 'P1', qty: 2 }] },
      { invoiceId: 'INV2', items: [{ productId: 'P1', qty: 3 }] }
    ],
    refundMethod: 'Cash',
    reason: 'Customer return',
    notes: 'Batch return',
    date: '2026-09-21',
    ...extra
  };
}

test('SALES_RETURN declares Batch ID as additive grouping metadata', () => {
  const config = read('Config.gs');
  const block = config.match(/SALES_RETURN:\s*\[([\s\S]*?)\n\s*\],\n\s*SALES_RETURN_ITEMS:/);
  assert.ok(block, 'SALES_RETURN header block not found');
  assert.match(block[1], /["']Batch ID["']/);
});

test('batch requires 2-20 unique invoices, <=100 lines, and one non-empty Customer ID', () => {
  assert.equal(typeof workbook().ctx.completeReturnBatch, 'function');

  const diffCustomer = twoInvoiceOwnedSeed();
  diffCustomer.SALES[1]['Customer ID'] = 'C2';
  const w1 = workbook(diffCustomer);
  const r1 = w1.ctx.completeReturnBatch('token', batchPayload());
  assert.equal(r1.success, false);
  assert.match(r1.message, /same customer/i);
  assert.equal(w1.writes.length, 0);

  const blankCustomer = twoInvoiceOwnedSeed();
  blankCustomer.SALES.forEach(row => { row['Customer ID'] = ''; });
  const w2 = workbook(blankCustomer);
  const r2 = w2.ctx.completeReturnBatch('token', batchPayload());
  assert.equal(r2.success, false);
  assert.match(r2.message, /customer account|walk-in|customer id/i);
  assert.equal(w2.writes.length, 0);

  const w3 = workbook(twoInvoiceOwnedSeed());
  const duplicate = batchPayload({ invoiceReturns: [
    { invoiceId: 'INV1', items: [{ productId: 'P1', qty: 1 }] },
    { invoiceId: 'INV1', items: [{ productId: 'P1', qty: 1 }] }
  ]});
  const r3 = w3.ctx.completeReturnBatch('token', duplicate);
  assert.equal(r3.success, false);
  assert.match(r3.message, /duplicate invoice/i);
  assert.equal(w3.writes.length, 0);

  const tooManyInvoices = Array.from({ length: 21 }, (_, i) => ({
    invoiceId: 'INV-' + String(i + 1), items: [{ productId: 'P1', qty: 1 }]
  }));
  const w4 = workbook();
  const r4 = w4.ctx.completeReturnBatch('token', batchPayload({ invoiceReturns: tooManyInvoices }));
  assert.equal(r4.success, false);
  assert.match(r4.message, /20 invoices/i);
  assert.equal(w4.writes.length, 0);

  const tooManyLines = [
    { invoiceId: 'INV1', items: Array.from({ length: 51 }, (_, i) => ({ productId: 'A' + i, qty: 1 })) },
    { invoiceId: 'INV2', items: Array.from({ length: 50 }, (_, i) => ({ productId: 'B' + i, qty: 1 })) }
  ];
  const w5 = workbook();
  const r5 = w5.ctx.completeReturnBatch('token', batchPayload({ invoiceReturns: tooManyLines }));
  assert.equal(r5.success, false);
  assert.match(r5.message, /100.*lines/i);
  assert.equal(w5.writes.length, 0);
});

test('cash batch validates refund provenance independently for each source invoice', () => {
  const seed = twoInvoiceOwnedSeed({ sale2: { 'Paid Amount': 0, 'Due Amount': 500, 'Payment Status': 'Due' } });
  seed.CUSTOMER_LEDGER.push({
    'Ledger ID': 'LED-DUE', Date: '2026-09-10', 'Customer ID': 'C1', 'Customer Name': 'Buyer',
    Type: 'Sale', Reference: 'INV2', Debit: 500, Credit: '', Balance: 500, 'Created At': '2026-09-10T10:00:00'
  });
  const w = workbook(seed);
  const result = w.ctx.completeReturnBatch('token', batchPayload({
    invoiceReturns: [
      { invoiceId: 'INV1', items: [{ productId: 'P1', qty: 1 }] },
      { invoiceId: 'INV2', items: [{ productId: 'P1', qty: 1 }] }
    ]
  }));
  assert.equal(result.success, false);
  assert.match(result.message, /INV2|cash refund is limited to 0/i);
  assert.equal(w.writes.length, 0, 'no child may write when another invoice fails cash provenance');
});

test('cash batch accumulates same-product stock and shared lot restoration across invoices', () => {
  const w = workbook(twoInvoiceOwnedSeed());
  const result = w.ctx.completeReturnBatch('token', batchPayload());
  assert.equal(result.success, true, result.message);
  assert.equal(result.data.batchId, 'SRB-000001');
  assert.equal(result.data.returnIds.length, 2);
  assert.equal(result.data.totalReturnAmount, 500);
  assert.equal(w.rows('PRODUCTS')[0]['Current Stock'], 25);
  assert.equal(w.rows('STOCK_LOTS')[0]['Remaining Quantity'], 5);
  assert.equal(w.rows('SALE_ITEM_LOTS')[0].Quantity, 3);
  assert.equal(w.rows('SALE_ITEM_LOTS')[1].Quantity, 2);
  assert.equal(w.rows('SALES_RETURN').length, 2);
  assert.equal(w.rows('SALES_RETURN')[0]['Batch ID'], 'SRB-000001');
  assert.equal(w.rows('SALES_RETURN')[1]['Batch ID'], 'SRB-000001');
  assert.deepEqual(w.rows('SALES_RETURN').map(r => r['Invoice ID']), ['INV1', 'INV2']);
  assert.equal(w.rows('CASH_BOOK').length, 2);
  assert.deepEqual(w.rows('CASH_BOOK').map(r => r.Reference), result.data.returnIds);
});

test('Store Credit batch posts one child credit per invoice with sequential customer balances', () => {
  const seed = {
    SALES: [
      sale('INV1', 'C1', { Subtotal: 500, 'Grand Total': 500, 'Paid Amount': 0, 'Due Amount': 500, 'Payment Status': 'Due' }),
      sale('INV2', 'C1', { Subtotal: 1250, 'Grand Total': 1250, 'Paid Amount': 0, 'Due Amount': 500, 'Payment Status': 'Due' })
    ],
    SALE_ITEMS: [item('INV1', 'P1', 5, 100), item('INV2', 'P2', 5, 250, { name: 'Gadget' })],
    PRODUCTS: [product('P1', 0), product('P2', 0, { name: 'Gadget' })],
    STOCK_LOTS: [lot('L1', 'P1', 0), lot('L2', 'P2', 0, { name: 'Gadget' })],
    SALE_ITEM_LOTS: [
      { 'Invoice ID': 'INV1', 'Product ID': 'P1', 'Lot ID': 'L1', Quantity: 5, 'Unit Cost': 40, 'Supplier ID': '' },
      { 'Invoice ID': 'INV2', 'Product ID': 'P2', 'Lot ID': 'L2', Quantity: 5, 'Unit Cost': 80, 'Supplier ID': '' }
    ],
    SALES_RETURN: [], SALES_RETURN_ITEMS: [], VENDOR_SOURCING: [], CASH_BOOK: [],
    CUSTOMERS: [{ 'Customer ID': 'C1', 'Customer Name': 'Buyer', Phone: '01700000000', 'Current Due': 1000, Status: 'Active' }],
    CUSTOMER_LEDGER: [
      { 'Ledger ID': 'S1', Date: '2026-09-10', 'Customer ID': 'C1', 'Customer Name': 'Buyer', Type: 'Sale', Reference: 'INV1', Debit: 500, Credit: '', Balance: 500, 'Created At': '2026-09-10T10:00:00' },
      { 'Ledger ID': 'S2', Date: '2026-09-10', 'Customer ID': 'C1', 'Customer Name': 'Buyer', Type: 'Sale', Reference: 'INV2', Debit: 500, Credit: '', Balance: 1000, 'Created At': '2026-09-10T10:01:00' }
    ]
  };
  const w = workbook(seed);
  const result = w.ctx.completeReturnBatch('token', {
    invoiceReturns: [
      { invoiceId: 'INV1', items: [{ productId: 'P1', qty: 1 }] },
      { invoiceId: 'INV2', items: [{ productId: 'P2', qty: 1 }] }
    ],
    refundMethod: 'Store Credit', reason: 'Return', notes: '', date: '2026-09-21'
  });
  assert.equal(result.success, true, result.message);
  const credits = w.rows('CUSTOMER_LEDGER').filter(r => r.Type === 'Sales Return Credit');
  assert.equal(credits.length, 2);
  assert.deepEqual(credits.map(r => r.Balance), [900, 650]);
  assert.deepEqual(credits.map(r => r.Reference), result.data.returnIds);
  assert.equal(w.rows('CUSTOMERS')[0]['Current Due'], 650);

  const state = w.ctx.customerSettlementState_('C1');
  assert.equal(state.nonCashCreditByInvoice.INV1, 100);
  assert.equal(state.nonCashCreditByInvoice.INV2, 250);
  assert.equal(state.computedNetDue, 650);
});

test('invalid final child aborts the entire batch before any business write', () => {
  const w = workbook(twoInvoiceOwnedSeed());
  const result = w.ctx.completeReturnBatch('token', batchPayload({
    invoiceReturns: [
      { invoiceId: 'INV1', items: [{ productId: 'P1', qty: 1 }] },
      { invoiceId: 'INV2', items: [{ productId: 'P1', qty: 6 }] }
    ]
  }));
  assert.equal(result.success, false);
  assert.match(result.message, /only 5 available/i);
  assert.equal(w.writes.length, 0);
});

test('return search keeps single-invoice lookup and routes multi-select through one selected customer', () => {
  const source = read('SalesReturn.gs');
  const ui = read('returns.html');
  assert.match(source, /customerId:\s*customerId/);
  assert.match(ui, /id="rtBatchSelectionBar"/);
  assert.match(ui, /id="rtSelectedCount"/);
  assert.match(ui, /id="rtOpenSelectedBtn"/);
  assert.match(ui, /data-customer-invoice-select-id/);
  assert.match(ui, /selectedReturnCustomer/);
  assert.match(ui, /getCustomerInvoicesForReturn/);
  assert.match(ui, /serverCall\('completeReturnBatch'/);
  assert.match(ui, /serverCall\('completeReturn'/, 'single-invoice RPC must remain available');
});

test('batch return cart keeps same Product ID separate by invoice and shows per-invoice cash warning context', () => {
  const ui = read('returns.html');
  assert.match(ui, /data-bi=/);
  assert.match(ui, /batchInvoices/);
  assert.match(ui, /cashRefundAvailable/);
  assert.match(ui, /invoiceId/);
  assert.match(ui, /rtBatchInvoiceTotal_/);
});

test('getReturnBatchDetail groups child returns without replacing child accounting IDs', () => {
  const w = workbook({
    SALES_RETURN: [
      { 'Return ID': 'SRT-1', 'Batch ID': 'SRB-1', 'Invoice ID': 'INV1', 'Customer ID': 'C1', 'Customer Name': 'Buyer', 'Customer Phone': '017', Date: '2026-09-21', 'Refund Method': 'Cash', 'Total Return Amount': 100, 'Created At': '2026-09-21T10:00:00' },
      { 'Return ID': 'SRT-2', 'Batch ID': 'SRB-1', 'Invoice ID': 'INV2', 'Customer ID': 'C1', 'Customer Name': 'Buyer', 'Customer Phone': '017', Date: '2026-09-21', 'Refund Method': 'Cash', 'Total Return Amount': 250, 'Created At': '2026-09-21T10:00:01' }
    ],
    SALES_RETURN_ITEMS: [
      { 'Return ID': 'SRT-1', 'Invoice ID': 'INV1', 'Product ID': 'P1', 'Product Name': 'Widget', 'Return Quantity': 1, 'Return Price': 100, 'Line Total': 100 },
      { 'Return ID': 'SRT-2', 'Invoice ID': 'INV2', 'Product ID': 'P2', 'Product Name': 'Gadget', 'Return Quantity': 1, 'Return Price': 250, 'Line Total': 250 }
    ]
  });
  const result = w.ctx.getReturnBatchDetail('token', 'SRB-1');
  assert.equal(result.success, true, result.message);
  assert.equal(result.data.batchTotal, 350);
  assert.deepEqual(result.data.children.map(c => [c.header['Return ID'], c.header['Invoice ID']]), [['SRT-1', 'INV1'], ['SRT-2', 'INV2']]);
});

test('return history keeps Return ID primary and exposes Batch ID grouped detail', () => {
  const ui = read('returnHistory.html');
  assert.match(ui, /<th>Batch<\/th>/);
  assert.match(ui, /\['Batch ID'\]/);
  assert.match(ui, /View Batch/);
  assert.match(ui, /getReturnBatchDetail/);
  assert.match(ui, /rhBatchDetailModal/);
  assert.match(ui, /Return ID/);
  assert.match(ui, /Invoice/);
});

test('Sales Return Items do not persist a client-authored supplier ID', () => {
  const w = workbook({
    SALES: [sale('INV1')],
    SALE_ITEMS: [item('INV1')],
    PRODUCTS: [product('P1', 20)],
    STOCK_LOTS: [lot('L1', 'P1', 0, { supplierId: 'REAL-SUP' })],
    SALE_ITEM_LOTS: [{ 'Invoice ID': 'INV1', 'Product ID': 'P1', 'Lot ID': 'L1', Quantity: 5, 'Unit Cost': 40, 'Supplier ID': 'REAL-SUP' }],
    SALES_RETURN: [], SALES_RETURN_ITEMS: [], CUSTOMER_LEDGER: [], VENDOR_SOURCING: [], CASH_BOOK: []
  });
  const result = w.ctx.completeReturn('token', {
    invoiceId: 'INV1', date: '2026-09-21', refundMethod: 'Cash',
    items: [{ productId: 'P1', qty: 1, supplierId: 'FAKE-SUP' }]
  });
  assert.equal(result.success, true, result.message);
  assert.equal(w.rows('SALES_RETURN_ITEMS')[0]['Supplier ID'] || '', '');
  assert.equal(w.rows('STOCK_LOTS')[0]['Remaining Quantity'], 1);
});

test('batch rejects a common return date earlier than any selected source invoice before writes', () => {
  const seed = twoInvoiceOwnedSeed({ sale2: { Date: '2026-09-20' } });
  const w = workbook(seed);
  const result = w.ctx.completeReturnBatch('token', batchPayload({ date: '2026-09-19' }));
  assert.equal(result.success, false);
  assert.match(result.message, /cannot be before invoice date 2026-09-20/i);
  assert.equal(w.writes.length, 0);
});

test('batch calculates each invoice return using that invoice discount independently', () => {
  const seed = {
    SALES: [
      sale('INV1', 'C1', { Subtotal: 100, 'Grand Total': 80, 'Paid Amount': 80 }),
      sale('INV2', 'C1', { Subtotal: 100, 'Grand Total': 90, 'Paid Amount': 90 })
    ],
    SALE_ITEMS: [item('INV1', 'P1', 10, 10), item('INV2', 'P2', 10, 10, { name: 'Gadget' })],
    PRODUCTS: [product('P1', 0), product('P2', 0, { name: 'Gadget' })],
    STOCK_LOTS: [lot('L1', 'P1', 0), lot('L2', 'P2', 0, { name: 'Gadget' })],
    SALE_ITEM_LOTS: [
      { 'Invoice ID': 'INV1', 'Product ID': 'P1', 'Lot ID': 'L1', Quantity: 10, 'Unit Cost': 4, 'Supplier ID': '' },
      { 'Invoice ID': 'INV2', 'Product ID': 'P2', 'Lot ID': 'L2', Quantity: 10, 'Unit Cost': 4, 'Supplier ID': '' }
    ],
    SALES_RETURN: [], SALES_RETURN_ITEMS: [], CUSTOMER_LEDGER: [], VENDOR_SOURCING: [], CASH_BOOK: [],
    CUSTOMERS: [{ 'Customer ID': 'C1', 'Customer Name': 'Buyer', 'Current Due': 0, Status: 'Active' }]
  };
  const w = workbook(seed);
  const result = w.ctx.completeReturnBatch('token', {
    invoiceReturns: [
      { invoiceId: 'INV1', items: [{ productId: 'P1', qty: 1 }] },
      { invoiceId: 'INV2', items: [{ productId: 'P2', qty: 2 }] }
    ],
    refundMethod: 'Cash', date: '2026-09-21'
  });
  assert.equal(result.success, true, result.message);
  assert.deepEqual(JSON.parse(JSON.stringify(result.data.childReturns.map(r => r.totalReturnAmount))), [8, 18]);
  assert.equal(result.data.totalReturnAmount, 26);
});

test('batch rejects deleted or historically duplicated invoice IDs before writes', () => {
  const duplicateSeed = twoInvoiceOwnedSeed();
  duplicateSeed.SALES.push({ ...duplicateSeed.SALES[0], 'Is Deleted': 'TRUE' });
  const w1 = workbook(duplicateSeed);
  const r1 = w1.ctx.completeReturnBatch('token', batchPayload());
  assert.equal(r1.success, false);
  assert.match(r1.message, /duplicate invoice id/i);
  assert.equal(w1.writes.length, 0);

  const deletedSeed = twoInvoiceOwnedSeed();
  deletedSeed.SALES[1]['Is Deleted'] = 'TRUE';
  const w2 = workbook(deletedSeed);
  const r2 = w2.ctx.completeReturnBatch('token', batchPayload());
  assert.equal(r2.success, false);
  assert.match(r2.message, /deleted/i);
  assert.equal(w2.writes.length, 0);
});

test('customer-first return search finds customer then lists only that customer invoices in sales-style order', () => {
  const w = workbook({
    CUSTOMERS: [
      { 'Customer ID': 'C1', 'Customer Name': 'Rahim Traders', Phone: '01711111111', Address: 'Belkuchi', 'Current Due': 250, Status: 'Active' },
      { 'Customer ID': 'C2', 'Customer Name': 'Karim Store', Phone: '01822222222', Address: 'Sirajganj', 'Current Due': 0, Status: 'Active' }
    ],
    SALES: [
      sale('INV1', 'C1', { Date: '2026-09-10', 'Created At': '2026-09-10T10:00:00', 'Grand Total': 500, 'Paid Amount': 300, 'Due Amount': 200, 'Payment Status': 'Partial' }),
      sale('INV2', 'C1', { Date: '2026-09-20', 'Created At': '2026-09-20T10:00:00', 'Grand Total': 700, 'Paid Amount': 700, 'Due Amount': 0, 'Payment Status': 'Paid' }),
      sale('INV3', 'C2', { Date: '2026-09-21', 'Created At': '2026-09-21T10:00:00' })
    ],
    SALE_ITEMS: [item('INV1'), item('INV2'), item('INV3')],
    SALES_RETURN: [], SALES_RETURN_ITEMS: [], CUSTOMER_LEDGER: []
  });

  assert.equal(typeof w.ctx.searchCustomersForReturn, 'function');
  assert.equal(typeof w.ctx.getCustomerInvoicesForReturn, 'function');

  const customers = w.ctx.searchCustomersForReturn('token', 'rahim');
  assert.equal(customers.success, true, customers.message);
  assert.deepEqual(customers.data.map(c => c.customerId), ['C1']);
  assert.equal(customers.data[0].currentDue, 250);

  const invoices = w.ctx.getCustomerInvoicesForReturn('token', 'C1');
  assert.equal(invoices.success, true, invoices.message);
  assert.deepEqual(invoices.data.customer.customerId, 'C1');
  assert.deepEqual(invoices.data.invoices.map(i => i.invoiceId), ['INV2', 'INV1']);
  assert.equal(invoices.data.invoices[0].customerId, 'C1');
  assert.equal(invoices.data.invoices.some(i => i.invoiceId === 'INV3'), false);
});

test('return UI provides dedicated customer-search invoice picker for multi-invoice returns', () => {
  const ui = read('returns.html');
  assert.match(ui, /id="rtInvoiceSearchModeBtn"/);
  assert.match(ui, /id="rtCustomerSearchModeBtn"/);
  assert.match(ui, /id="rtCustomerSearchInput"/);
  assert.match(ui, /searchCustomersForReturn/);
  assert.match(ui, /getCustomerInvoicesForReturn/);
  assert.match(ui, /id="rtCustomerInvoiceList"/);
  assert.match(ui, /data-return-customer-id/);
  assert.match(ui, /data-customer-invoice-select-id/);
  assert.match(ui, /Open Selected Invoice/);
  assert.match(ui, /Open Selected Invoices/);
});

test('editable return price is accepted below effective invoice price and stored as the return economics', () => {
  const w = workbook({
    SALES: [sale('INV1')],
    SALE_ITEMS: [item('INV1')],
    PRODUCTS: [product('P1', 20)],
    STOCK_LOTS: [lot('L1', 'P1', 0)],
    SALE_ITEM_LOTS: [{ 'Invoice ID': 'INV1', 'Product ID': 'P1', 'Lot ID': 'L1', Quantity: 5, 'Unit Cost': 40, 'Supplier ID': '' }],
    SALES_RETURN: [], SALES_RETURN_ITEMS: [], CUSTOMER_LEDGER: [], VENDOR_SOURCING: [], CASH_BOOK: []
  });
  const result = w.ctx.completeReturn('token', {
    invoiceId: 'INV1', date: '2026-09-21', refundMethod: 'Cash',
    items: [{ productId: 'P1', qty: 2, price: 80 }]
  });
  assert.equal(result.success, true, result.message);
  assert.equal(result.data.totalReturnAmount, 160);
  assert.equal(w.rows('SALES_RETURN_ITEMS')[0]['Return Price'], 80);
  assert.equal(w.rows('SALES_RETURN_ITEMS')[0]['Line Total'], 160);
});

test('editable return price cannot exceed effective post-discount sale price and rejects before writes', () => {
  const w = workbook({
    SALES: [sale('INV1', 'C1', { Subtotal: 500, 'Grand Total': 400, 'Paid Amount': 400 })],
    SALE_ITEMS: [item('INV1', 'P1', 5, 100)],
    PRODUCTS: [product('P1', 20)],
    STOCK_LOTS: [lot('L1', 'P1', 0)],
    SALE_ITEM_LOTS: [{ 'Invoice ID': 'INV1', 'Product ID': 'P1', 'Lot ID': 'L1', Quantity: 5, 'Unit Cost': 40, 'Supplier ID': '' }],
    SALES_RETURN: [], SALES_RETURN_ITEMS: [], CUSTOMER_LEDGER: [], VENDOR_SOURCING: [], CASH_BOOK: []
  });
  const result = w.ctx.completeReturn('token', {
    invoiceId: 'INV1', date: '2026-09-21', refundMethod: 'Cash',
    items: [{ productId: 'P1', qty: 1, price: 81 }]
  });
  assert.equal(result.success, false);
  assert.match(result.message, /cannot exceed original sale price of 80/i);
  assert.equal(w.writes.length, 0);
});

test('batch return keeps editable price independent per source invoice', () => {
  const w = workbook(twoInvoiceOwnedSeed());
  const result = w.ctx.completeReturnBatch('token', batchPayload({
    invoiceReturns: [
      { invoiceId: 'INV1', items: [{ productId: 'P1', qty: 1, price: 80 }] },
      { invoiceId: 'INV2', items: [{ productId: 'P1', qty: 1, price: 70 }] }
    ]
  }));
  assert.equal(result.success, true, result.message);
  assert.deepEqual(w.rows('SALES_RETURN_ITEMS').map(r => r['Return Price']), [80, 70]);
  assert.equal(result.data.totalReturnAmount, 150);
});

test('return UI renders editable bounded price inputs and submits requested price for single and batch flows', () => {
  const ui = read('returns.html');
  assert.match(ui, /data-f="price"/);
  assert.match(ui, /max="' \+.*unitPrice/);
  assert.match(ui, /_returnPrice/);
  assert.match(ui, /price:\s*Number\(item\._returnPrice\)/);
  assert.match(ui, /Return Price/);
});