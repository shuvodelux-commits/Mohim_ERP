'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// Execute the actual native services. Only Apps Script and repository/money
// persistence boundaries are replaced with an isolated in-memory workbook.
function workbook(seed = {}) {
  const tables = structuredClone(seed);
  const writes = [];
  let locked = false, serial = 0;
  const rows = key => tables[key] || (tables[key] = []);
  const ctx = vm.createContext({ console, Date, Math, JSON, CONFIG: { LOCK_TIMEOUT_MS: 1000 } });
  for (const name of ['Utils.gs', 'Customer.gs', 'DeleteEngine.gs', 'StockLots.gs', 'Sales.gs', 'SalesManagement.gs', 'SalesReturn.gs']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', name), 'utf8'), ctx, { filename: name });
  }
  const mutate = (key, action) => { assert.equal(locked, true, 'transaction write must hold ScriptLock'); writes.push(key); return action(); };
  Object.assign(ctx, {
    LockService: { getScriptLock: () => ({ waitLock: () => { assert.equal(locked, false); locked = true; }, releaseLock: () => { locked = false; } }) },
    Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: { formatDate: (date, zone, format) => format === 'HH:mm:ss' ? '12:00:00' : new Date(date).toISOString().slice(0, 10) },
    requirePermission_: () => ({ 'Full Name': 'Audit User' }),
    requireDeletePermission_: () => ({ 'Full Name': 'Audit User' }),
    actorName_: user => user['Full Name'],
    logDeletion_: () => {},
    requireActiveCashSession_: () => ({ id: 'CS1' }),
    getAllRows_: key => rows(key).map((row, i) => ({ ...row, _rowIndex: i + 2 })),
    findRows_: (key, col, value) => ctx.getAllRows_(key).filter(row => row[col] === value),
    findRowIndex_: (key, col, value) => { const i = rows(key).findIndex(row => row[col] === value); return i < 0 ? -1 : i + 2; },
    appendRow_: (key, row) => mutate(key, () => { rows(key).push({ ...row }); return rows(key).length + 1; }),
    appendRows_: (key, values) => values.forEach(row => ctx.appendRow_(key, row)),
    updateRowFields_: (key, index, fields) => mutate(key, () => { assert.ok(rows(key)[index - 2], `${key} row ${index}`); Object.assign(rows(key)[index - 2], fields); }),
    deleteRow_: (key, index) => mutate(key, () => rows(key).splice(index - 2, 1)),
    generateId_: key => `${key}-${++serial}`,
    logError_: () => {},
    resolveTransactionDate_: () => ({ dateStr: '2026-09-05', isBackdated: false, backdatedDays: 0, reason: '' }),
    computeBackdateInfo_: () => ({ isBackdated: false, backdatedDays: 0 }),
    findSessionForTimestamp_: sessions => sessions[0],
    resolveBankAccount_: (method, id) => {
      if (method === 'Bank' && id !== 'B1') throw new Error('Bank account not found');
      return { id: method === 'Bank' ? id : '', name: method === 'Bank' ? 'Audit Bank' : '' };
    },
    buildInvoicePayload_: id => ({ invoiceId: id }),
    addCashBookEntry_: entry => ctx.appendRow_('CASH_BOOK', entry),
    addBankBookEntry_: (id, entry) => ctx.appendRow_('BANK_BOOK', { ...entry, 'Bank Account ID': id }),
    postVendorLedgerEntry_: entry => { ctx.appendRow_('VENDOR_LEDGER', entry); const index = ctx.findRowIndex_('VENDORS', 'Vendor ID', entry.vendorId); const old = rows('VENDORS')[index - 2]; ctx.updateRowFields_('VENDORS', index, { 'Current Due': Number(old['Current Due'] || 0) + entry.debit }); }
  });
  return { ctx, tables, writes, rows, withLock: fn => { locked = true; try { return fn(); } finally { locked = false; } } };
}

const product = (stock = 5) => ({ 'Product ID': 'P1', 'Product Name': 'Widget', 'Current Stock': stock, 'Purchase Price': 40, 'Selling Price': 100, Status: 'Active' });
const lot = (id, qty, date = '2026-09-01', extra = {}) => ({ 'Lot ID': id, 'Product ID': 'P1', 'Product Name': 'Widget', 'Purchase ID': 'PUR1', 'Purchase Date': date, 'Original Quantity': qty, 'Remaining Quantity': qty, 'Purchase Price': 40, 'Sell Price': 100, 'Status': 'Active', ...extra });
const sale = extra => ({ 'Invoice ID': 'INV1', 'Date': '2026-09-05', 'Created At': '2026-09-05T12:00:00', 'Customer ID': 'C1', 'Customer Name': 'Buyer', 'Customer Phone': '01700000000', 'Subtotal': 500, 'Grand Total': 500, 'Paid Amount': 500, 'Due Amount': 0, 'Payment Method': 'Cash', ...extra });
const item = (qty = 5) => ({ 'Invoice ID': 'INV1', 'Product ID': 'P1', 'Product Name': 'Widget', 'Quantity': qty, 'Unit Price': 100, 'Line Total': qty * 100 });
const payload = (qty = 1, extra = {}) => ({ customerId: 'C1', customerName: 'Buyer', customerPhone: '01700000000', items: [{ productId: 'P1', name: 'Widget', qty, unitPrice: 100 }], discount: 0, paymentType: 'Cash', paymentMethod: 'Cash', reason: 'Correction', ...extra });
const returnPayload = (qty, extra = {}) => ({ invoiceId: 'INV1', items: [{ productId: 'P1', qty }], refundMethod: 'Cash', reason: 'Returned', ...extra });

test('FIFO plans all suppliers by purchase date then lot ID and writes nothing', () => {
  const w = workbook({ PRODUCTS: [product()], STOCK_LOTS: [lot('L3', 2, '2026-09-02'), lot('L2', 2, '2026-09-01', { 'Supplier ID': 'S2' }), lot('L1', 1, '2026-09-01', { 'Supplier ID': 'S1' })] });
  const plan = w.ctx.planStockConsumption_('P1', 4);
  assert.deepEqual(Array.from(plan.draws, d => [d.lotId, d.take]), [['L1', 1], ['L2', 2], ['L3', 1]]);
  assert.equal(plan.shortfall, 0);
  assert.deepEqual(w.writes, []);
});

test('negative sale creates OVERSOLD evidence and matches aggregate stock to lot balances', () => {
  const w = workbook({ PRODUCTS: [product(2)], STOCK_LOTS: [lot('L1', 2)] });
  assert.equal(w.ctx.completeSale('token', payload(5)).success, true);
  assert.equal(w.rows('PRODUCTS')[0]['Current Stock'], -3);
  assert.equal(w.rows('STOCK_LOTS').reduce((sum, row) => sum + row['Remaining Quantity'], 0), -3);
  assert.equal(w.rows('STOCK_LOTS')[1]['Purchase ID'], 'OVERSOLD');
  assert.equal(w.rows('SALE_ITEM_LOTS').reduce((sum, row) => sum + row.Quantity, 0), 5);
  assert.equal(w.rows('CASH_BOOK')[0].Credit, 500);
});

test('sale rejects invalid second line, duplicate product, bank and cash-session failure before writes', () => {
  for (const change of [
    p => p.items.push({ productId: 'MISSING', name: 'Missing', qty: 1, unitPrice: 100 }),
    p => p.items.push({ ...p.items[0] }),
    p => { p.paymentMethod = 'Bank'; p.bankAccountId = 'MISSING'; }
  ]) {
    const w = workbook({ PRODUCTS: [product()], STOCK_LOTS: [lot('L1', 5)] });
    const p = payload(); change(p);
    assert.equal(w.ctx.completeSale('token', p).success, false);
    assert.deepEqual(w.writes, []);
  }
  const w = workbook();
  w.ctx.requireActiveCashSession_ = () => { throw new Error('No active cash session'); };
  assert.equal(w.ctx.completeSale('token', payload()).success, false);
  assert.deepEqual(w.writes, []);
});

test('deleted invoice cannot enter update mode or rewrite transaction records', () => {
  const w = workbook({ SALES: [sale({ 'Is Deleted': true })], SALE_ITEMS: [item()], PRODUCTS: [product()], CASH_SESSIONS: [{ Status: 'Open' }] });
  const updateMode = w.ctx.getSaleForUpdate('token', 'INV1');
  const result = w.ctx.updateSale('token', 'INV1', payload(5));
  assert.equal(updateMode.success, false, 'deleted invoice was offered in update mode');
  assert.equal(result.success, false, 'deleted invoice was updated');
  assert.deepEqual(w.writes, []);
});

for (const sourcing of [{ Quantity: 1 }, { Quantity: 3, 'Is Deleted': true }]) {
  test(`vendor sourcing ${sourcing['Is Deleted'] ? 'deletion' : 'quantity edit'} cannot create returnable owned stock`, () => {
    const w = workbook({ SALES: [sale()], SALE_ITEMS: [item()], PRODUCTS: [product(0)], STOCK_LOTS: [lot('L1', 0)],
      SALE_ITEM_LOTS: [{ 'Invoice ID': 'INV1', 'Product ID': 'P1', 'Lot ID': 'L1', Quantity: 2, 'Unit Cost': 40 }],
      VENDOR_SOURCING: [{ 'Invoice ID': 'INV1', 'Product ID': 'P1', 'Vendor ID': 'V1', ...sourcing }] });
    const preview = w.ctx.getInvoiceForReturn('token', 'INV1');
    assert.equal(preview.success, true);
    assert.equal(preview.data.items[0].availableQty, 2);
    const result = w.ctx.completeReturn('token', returnPayload(3));
    assert.equal(result.success, false);
    assert.deepEqual(w.writes, []);
  });
}

test('partial owned returns retain exact discounted value and consume restoration evidence once', () => {
  const w = workbook({ SALES: [sale({ Subtotal: 10, 'Grand Total': 8, 'Paid Amount': 8 })],
    SALE_ITEMS: [{ ...item(3), 'Unit Price': 3.33, 'Line Total': 10 }], PRODUCTS: [product(0)], STOCK_LOTS: [lot('L1', 0)],
    SALE_ITEM_LOTS: [{ 'Invoice ID': 'INV1', 'Product ID': 'P1', 'Lot ID': 'L1', Quantity: 3, 'Unit Cost': 40 }] });
  assert.equal(w.ctx.completeReturn('token', returnPayload(1)).data.totalReturnAmount, 2.67);
  assert.equal(w.ctx.completeReturn('token', returnPayload(2)).data.totalReturnAmount, 5.33);
  assert.equal(w.rows('PRODUCTS')[0]['Current Stock'], 3);
  assert.equal(w.rows('STOCK_LOTS')[0]['Remaining Quantity'], 3);
  assert.equal(w.rows('SALE_ITEM_LOTS')[0].Quantity, 0);
  const before = w.writes.length;
  assert.equal(w.ctx.completeReturn('token', returnPayload(1)).success, false);
  assert.equal(w.writes.length, before);
});

test('legacy sale quantity reduction restores only the quantity delta', () => {
  const w = workbook({ SALES: [sale()], SALE_ITEMS: [item()], PRODUCTS: [product(5)], STOCK_LOTS: [lot('L1', 5)], CASH_SESSIONS: [{ Status: 'Open' }] });
  const result = w.ctx.updateSale('token', 'INV1', payload(3));
  assert.equal(result.success, true, result.message);
  assert.equal(w.rows('PRODUCTS')[0]['Current Stock'], 7);
  assert.equal(w.rows('STOCK_LOTS').reduce((sum, row) => sum + row['Remaining Quantity'], 0), 7);
  assert.equal(w.rows('CASH_BOOK')[0].Debit, 200);
});

test('sale delete restores only evidenced own stock when sourcing history changed', () => {
  const w = workbook({ SALES: [sale({ 'Customer ID':'', 'Paid Amount':0, 'Due Amount':0 })], SALE_ITEMS: [item()],
    PRODUCTS: [product(0)], STOCK_LOTS: [lot('L1', 0)],
    SALE_ITEM_LOTS: [{ 'Invoice ID':'INV1', 'Product ID':'P1', 'Lot ID':'L1', Quantity:2, 'Unit Cost':40 }],
    VENDOR_SOURCING: [{ 'Invoice ID':'INV1', 'Product ID':'P1', Quantity:3, 'Is Deleted':true }] });
  const result = w.ctx.deleteSalesInvoice('token','INV1','Duplicate');
  assert.equal(result.success,true,result.message);
  assert.equal(w.rows('PRODUCTS')[0]['Current Stock'],2);
  assert.equal(w.rows('STOCK_LOTS')[0]['Remaining Quantity'],2);
});

test('sale delete validates every product before the first reversal write', () => {
  const w = workbook({ SALES: [sale({ 'Customer ID':'', 'Paid Amount':0, 'Due Amount':0 })],
    SALE_ITEMS: [item(2), {'Invoice ID':'INV1','Product ID':'MISSING','Product Name':'Gone','Quantity':1,'Unit Price':5,'Line Total':5}],
    PRODUCTS: [product(0)], STOCK_LOTS: [lot('L1',0)],
    SALE_ITEM_LOTS: [{ 'Invoice ID':'INV1','Product ID':'P1','Lot ID':'L1',Quantity:2,'Unit Cost':40 }, {'Invoice ID':'INV1','Product ID':'MISSING','Lot ID':'L2',Quantity:1,'Unit Cost':2 }] });
  const result=w.ctx.deleteSalesInvoice('token','INV1','Duplicate');
  assert.equal(result.success,false);
  assert.match(result.message,/product.*no longer exists/i);
  assert.deepEqual(w.writes,[]);
});
