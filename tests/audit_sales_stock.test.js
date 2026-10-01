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
  for (const name of ['Utils.gs', 'Customer.gs', 'DeleteEngine.gs', 'StockLots.gs', 'SettlementDiscount.gs', 'CustomerSettlement.gs', 'Sales.gs', 'SalesManagement.gs', 'SalesReturn.gs']) {
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
    activeRows_: key => ctx.getAllRows_(key).filter(row => !ctx.isDeleted_(row)),
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
    adjustVendorDue_: (vendorId, delta) => { const index = ctx.findRowIndex_('VENDORS', 'Vendor ID', vendorId); if (index === -1) return null; const old = rows('VENDORS')[index - 2]; const next = Number(old['Current Due'] || 0) + Number(delta || 0); ctx.updateRowFields_('VENDORS', index, { 'Current Due': next }); return next; },
    postVendorLedgerEntry_: entry => { const next = ctx.adjustVendorDue_(entry.vendorId, (Number(entry.debit) || 0) - (Number(entry.credit) || 0)); ctx.appendRow_('VENDOR_LEDGER', { ...entry, Balance: next }); }
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


test('same-quantity edit from vendor sourcing to negative stock reverses vendor and posts oversold stock effect', () => {
  const w = workbook({
    SALES: [sale({ Subtotal: 200, 'Grand Total': 200, 'Paid Amount': 200, 'Due Amount': 0 })],
    SALE_ITEMS: [item(2)], PRODUCTS: [product(0)], CASH_SESSIONS: [{ Status: 'Open' }],
    STOCK_LOTS: [lot('L1', 0)],
    SALE_ITEM_LOTS: [{ 'Invoice ID':'INV1','Product ID':'P1','Lot ID':'L1',Quantity:1,'Unit Cost':40 }],
    VENDORS: [{ 'Vendor ID':'V1','Vendor Name':'Jewel Hardware','Current Due':400,Status:'Active' }],
    VENDOR_SOURCING: [{ 'Sourcing ID':'VS1','Date':'2026-09-05','Invoice ID':'INV1','Product ID':'P1','Product Name':'Widget','Vendor ID':'V1','Vendor Name':'Jewel Hardware',Quantity:1,'Unit Cost':400,'Total Cost':400,'Created At':'2026-09-05T12:00:00' }],
    VENDOR_LEDGER: [{ 'Ledger ID':'VL1','Date':'2026-09-05','Vendor ID':'V1','Vendor Name':'Jewel Hardware',Type:'Sourcing',Reference:'VS1',Debit:400,Credit:'',Balance:400,'Created At':'2026-09-05T12:00:00' }]
  });
  const p = payload(2);
  p.items[0].shortageResolution = 'negative';
  const result = w.ctx.updateSale('token','INV1',p);
  assert.equal(result.success, true, result.message);
  assert.equal(w.rows('VENDORS')[0]['Current Due'], 0);
  assert.equal(w.rows('VENDOR_SOURCING')[0]['Is Deleted'], 'TRUE');
  assert.equal(w.rows('VENDOR_LEDGER')[0]['Is Deleted'], 'TRUE');
  assert.equal(w.rows('PRODUCTS')[0]['Current Stock'], -1);
  const oversold = w.rows('STOCK_LOTS').filter(r => r['Purchase ID'] === 'OVERSOLD');
  assert.equal(oversold.length, 1);
  assert.equal(oversold[0]['Remaining Quantity'], -1);
});

test('same-quantity edit from negative stock to vendor restores oversold effect and creates vendor payable', () => {
  const w = workbook({
    SALES: [sale({ Subtotal: 200, 'Grand Total': 200, 'Paid Amount': 200, 'Due Amount': 0 })],
    SALE_ITEMS: [item(2)], PRODUCTS: [product(-1)], CASH_SESSIONS: [{ Status: 'Open' }],
    STOCK_LOTS: [lot('L1', 0), lot('OV1', 1, '2026-09-05', { 'Purchase ID':'OVERSOLD','Remaining Quantity':-1,'Status':'Oversold' })],
    SALE_ITEM_LOTS: [
      { 'Invoice ID':'INV1','Product ID':'P1','Lot ID':'L1',Quantity:1,'Unit Cost':40 },
      { 'Invoice ID':'INV1','Product ID':'P1','Lot ID':'OV1',Quantity:1,'Unit Cost':40 }
    ],
    VENDORS: [{ 'Vendor ID':'V1','Vendor Name':'Jewel Hardware','Current Due':0,Status:'Active' }],
    VENDOR_SOURCING: [], VENDOR_LEDGER: []
  });
  const p = payload(2);
  p.items[0].shortageResolution = 'vendor';
  p.items[0].vendorId = 'V1';
  p.items[0].vendorUnitCost = 400;
  const result = w.ctx.updateSale('token','INV1',p);
  assert.equal(result.success, true, result.message);
  assert.equal(w.rows('PRODUCTS')[0]['Current Stock'], 0);
  assert.equal(w.rows('STOCK_LOTS').find(r => r['Lot ID'] === 'OV1')['Remaining Quantity'], 0);
  assert.equal(w.rows('VENDORS')[0]['Current Due'], 400);
  const sourcing = w.rows('VENDOR_SOURCING').filter(r => !r['Is Deleted']);
  assert.equal(sourcing.length, 1);
  assert.equal(sourcing[0]['Vendor ID'], 'V1');
  assert.equal(sourcing[0].Quantity, 1);
  assert.equal(sourcing[0]['Total Cost'], 400);
});

test('same-quantity vendor reassignment reverses old vendor and creates replacement without changing stock', () => {
  const w = workbook({
    SALES: [sale({ Subtotal: 200, 'Grand Total': 200, 'Paid Amount': 200, 'Due Amount': 0 })],
    SALE_ITEMS: [item(2)], PRODUCTS: [product(0)], CASH_SESSIONS: [{ Status: 'Open' }],
    STOCK_LOTS: [lot('L1', 0)],
    SALE_ITEM_LOTS: [{ 'Invoice ID':'INV1','Product ID':'P1','Lot ID':'L1',Quantity:1,'Unit Cost':40 }],
    VENDORS: [
      { 'Vendor ID':'V1','Vendor Name':'Jewel Hardware','Current Due':400,Status:'Active' },
      { 'Vendor ID':'V2','Vendor Name':'Other Vendor','Current Due':0,Status:'Active' }
    ],
    VENDOR_SOURCING: [{ 'Sourcing ID':'VS1','Date':'2026-09-05','Invoice ID':'INV1','Product ID':'P1','Product Name':'Widget','Vendor ID':'V1','Vendor Name':'Jewel Hardware',Quantity:1,'Unit Cost':400,'Total Cost':400,'Created At':'2026-09-05T12:00:00' }],
    VENDOR_LEDGER: [{ 'Ledger ID':'VL1','Date':'2026-09-05','Vendor ID':'V1','Vendor Name':'Jewel Hardware',Type:'Sourcing',Reference:'VS1',Debit:400,Credit:'',Balance:400,'Created At':'2026-09-05T12:00:00' }]
  });
  const p = payload(2);
  p.items[0].shortageResolution = 'vendor';
  p.items[0].vendorId = 'V2';
  p.items[0].vendorUnitCost = 420;
  const result = w.ctx.updateSale('token','INV1',p);
  assert.equal(result.success, true, result.message);
  assert.equal(w.rows('PRODUCTS')[0]['Current Stock'], 0);
  assert.equal(w.rows('VENDORS')[0]['Current Due'], 0);
  assert.equal(w.rows('VENDORS')[1]['Current Due'], 420);
  assert.equal(w.rows('VENDOR_SOURCING')[0]['Is Deleted'], 'TRUE');
  const replacement = w.rows('VENDOR_SOURCING').filter(r => !r['Is Deleted'])[0];
  assert.equal(replacement['Vendor ID'], 'V2');
  assert.equal(replacement.Quantity, 1);
  assert.equal(replacement['Unit Cost'], 420);
});

test('same-quantity vendor cost correction updates payable without changing stock', () => {
  const w = workbook({
    SALES: [sale({ Subtotal: 200, 'Grand Total': 200, 'Paid Amount': 200, 'Due Amount': 0 })],
    SALE_ITEMS: [item(2)], PRODUCTS: [product(0)], CASH_SESSIONS: [{ Status: 'Open' }],
    STOCK_LOTS: [lot('L1', 0)],
    SALE_ITEM_LOTS: [{ 'Invoice ID':'INV1','Product ID':'P1','Lot ID':'L1',Quantity:1,'Unit Cost':40 }],
    VENDORS: [{ 'Vendor ID':'V1','Vendor Name':'Jewel Hardware','Current Due':400,Status:'Active' }],
    VENDOR_SOURCING: [{ 'Sourcing ID':'VS1','Date':'2026-09-05','Invoice ID':'INV1','Product ID':'P1','Product Name':'Widget','Vendor ID':'V1','Vendor Name':'Jewel Hardware',Quantity:1,'Unit Cost':400,'Total Cost':400,'Created At':'2026-09-05T12:00:00' }],
    VENDOR_LEDGER: [{ 'Ledger ID':'VL1','Date':'2026-09-05','Vendor ID':'V1','Vendor Name':'Jewel Hardware',Type:'Sourcing',Reference:'VS1',Debit:400,Credit:'',Balance:400,'Created At':'2026-09-05T12:00:00' }]
  });
  const p = payload(2);
  p.items[0].shortageResolution = 'vendor';
  p.items[0].vendorId = 'V1';
  p.items[0].vendorUnitCost = 450;
  const result = w.ctx.updateSale('token','INV1',p);
  assert.equal(result.success, true, result.message);
  assert.equal(w.rows('PRODUCTS')[0]['Current Stock'], 0);
  assert.equal(w.rows('VENDORS')[0]['Current Due'], 450);
  assert.equal(w.rows('VENDOR_SOURCING')[0]['Is Deleted'], 'TRUE');
  const replacement = w.rows('VENDOR_SOURCING').filter(r => !r['Is Deleted'])[0];
  assert.equal(replacement['Unit Cost'], 450);
  assert.equal(replacement.Quantity, 1);
});

test('same-quantity unchanged vendor sourcing remains intact', () => {
  const w = workbook({
    SALES: [sale({ Subtotal: 200, 'Grand Total': 200, 'Paid Amount': 200, 'Due Amount': 0 })],
    SALE_ITEMS: [item(2)], PRODUCTS: [product(0)], CASH_SESSIONS: [{ Status: 'Open' }],
    STOCK_LOTS: [lot('L1', 0)],
    SALE_ITEM_LOTS: [{ 'Invoice ID':'INV1','Product ID':'P1','Lot ID':'L1',Quantity:1,'Unit Cost':40 }],
    VENDORS: [{ 'Vendor ID':'V1','Vendor Name':'Jewel Hardware','Current Due':400,Status:'Active' }],
    VENDOR_SOURCING: [{ 'Sourcing ID':'VS1','Date':'2026-09-05','Invoice ID':'INV1','Product ID':'P1','Product Name':'Widget','Vendor ID':'V1','Vendor Name':'Jewel Hardware',Quantity:1,'Unit Cost':400,'Total Cost':400,'Created At':'2026-09-05T12:00:00' }],
    VENDOR_LEDGER: [{ 'Ledger ID':'VL1','Date':'2026-09-05','Vendor ID':'V1','Vendor Name':'Jewel Hardware',Type:'Sourcing',Reference:'VS1',Debit:400,Credit:'',Balance:400,'Created At':'2026-09-05T12:00:00' }]
  });
  const p = payload(2);
  p.items[0].shortageResolution = 'vendor';
  p.items[0].vendorId = 'V1';
  p.items[0].vendorUnitCost = 400;
  const result = w.ctx.updateSale('token','INV1',p);
  assert.equal(result.success, true, result.message);
  assert.equal(w.rows('PRODUCTS')[0]['Current Stock'], 0);
  assert.equal(w.rows('VENDORS')[0]['Current Due'], 400);
  assert.equal(w.rows('VENDOR_SOURCING').length, 1);
  assert.notEqual(w.rows('VENDOR_SOURCING')[0]['Is Deleted'], 'TRUE');
});

test('same-quantity source change is blocked after linked vendor return', () => {
  const w = workbook({
    SALES: [sale({ Subtotal: 200, 'Grand Total': 200, 'Paid Amount': 200, 'Due Amount': 0 })],
    SALE_ITEMS: [item(2)], PRODUCTS: [product(0)], CASH_SESSIONS: [{ Status: 'Open' }],
    STOCK_LOTS: [lot('L1', 0)],
    SALE_ITEM_LOTS: [{ 'Invoice ID':'INV1','Product ID':'P1','Lot ID':'L1',Quantity:1,'Unit Cost':40 }],
    VENDORS: [{ 'Vendor ID':'V1','Vendor Name':'Jewel Hardware','Current Due':200,Status:'Active' }],
    VENDOR_SOURCING: [{ 'Sourcing ID':'VS1','Date':'2026-09-05','Invoice ID':'INV1','Product ID':'P1','Product Name':'Widget','Vendor ID':'V1','Vendor Name':'Jewel Hardware',Quantity:1,'Unit Cost':400,'Total Cost':400,'Created At':'2026-09-05T12:00:00' }],
    VENDOR_LEDGER: [{ 'Ledger ID':'VL1','Date':'2026-09-05','Vendor ID':'V1','Vendor Name':'Jewel Hardware',Type:'Sourcing',Reference:'VS1',Debit:400,Credit:'',Balance:400,'Created At':'2026-09-05T12:00:00' }],
    VENDOR_RETURNS: [{ 'Return ID':'VR1','Vendor ID':'V1','Sourcing ID':'VS1',Quantity:0.5,'Unit Cost':400,'Total Value':200 }]
  });
  const p = payload(2);
  p.items[0].shortageResolution = 'negative';
  const result = w.ctx.updateSale('token','INV1',p);
  assert.equal(result.success, false);
  assert.match(result.message, /vendor.*return|sourcing.*settled|reverse.*return/i);
  assert.deepEqual(w.writes, []);
});

test('same-quantity source change is blocked when vendor payable is already below sourcing value', () => {
  const w = workbook({
    SALES: [sale({ Subtotal: 200, 'Grand Total': 200, 'Paid Amount': 200, 'Due Amount': 0 })],
    SALE_ITEMS: [item(2)], PRODUCTS: [product(0)], CASH_SESSIONS: [{ Status: 'Open' }],
    STOCK_LOTS: [lot('L1', 0)],
    SALE_ITEM_LOTS: [{ 'Invoice ID':'INV1','Product ID':'P1','Lot ID':'L1',Quantity:1,'Unit Cost':40 }],
    VENDORS: [{ 'Vendor ID':'V1','Vendor Name':'Jewel Hardware','Current Due':0,Status:'Active' }],
    VENDOR_SOURCING: [{ 'Sourcing ID':'VS1','Date':'2026-09-05','Invoice ID':'INV1','Product ID':'P1','Product Name':'Widget','Vendor ID':'V1','Vendor Name':'Jewel Hardware',Quantity:1,'Unit Cost':400,'Total Cost':400,'Created At':'2026-09-05T12:00:00' }],
    VENDOR_LEDGER: [{ 'Ledger ID':'VL1','Date':'2026-09-05','Vendor ID':'V1','Vendor Name':'Jewel Hardware',Type:'Sourcing',Reference:'VS1',Debit:400,Credit:'',Balance:400,'Created At':'2026-09-05T12:00:00' }]
  });
  const p = payload(2);
  p.items[0].shortageResolution = 'negative';
  const result = w.ctx.updateSale('token','INV1',p);
  assert.equal(result.success, false);
  assert.match(result.message, /vendor.*payable|settled|payment/i);
  assert.deepEqual(w.writes, []);
});


test('delete after vendor-to-negative edit restores sale stock and does not recreate vendor payable', () => {
  const w = workbook({
    SALES: [sale({ 'Customer ID':'', Subtotal:200, 'Grand Total':200, 'Paid Amount':0, 'Due Amount':0 })],
    SALE_ITEMS: [item(2)], PRODUCTS: [product(0)], CASH_SESSIONS: [{ Status:'Open' }],
    STOCK_LOTS: [lot('L1',0)],
    SALE_ITEM_LOTS: [{ 'Invoice ID':'INV1','Product ID':'P1','Lot ID':'L1',Quantity:1,'Unit Cost':40 }],
    VENDORS: [{ 'Vendor ID':'V1','Vendor Name':'Jewel Hardware','Current Due':400,Status:'Active' }],
    VENDOR_SOURCING: [{ 'Sourcing ID':'VS1','Date':'2026-09-05','Invoice ID':'INV1','Product ID':'P1','Product Name':'Widget','Vendor ID':'V1','Vendor Name':'Jewel Hardware',Quantity:1,'Unit Cost':400,'Total Cost':400,'Created At':'2026-09-05T12:00:00' }],
    VENDOR_LEDGER: [{ 'Ledger ID':'VL1','Date':'2026-09-05','Vendor ID':'V1','Vendor Name':'Jewel Hardware',Type:'Sourcing',Reference:'VS1',Debit:400,Credit:'',Balance:400,'Created At':'2026-09-05T12:00:00' }]
  });
  const p = payload(2); p.items[0].shortageResolution='negative';
  assert.equal(w.ctx.updateSale('token','INV1',p).success,true);
  assert.equal(w.rows('PRODUCTS')[0]['Current Stock'],-1);
  assert.equal(w.ctx.deleteSalesInvoice('token','INV1','Void after correction').success,true);
  assert.equal(w.rows('PRODUCTS')[0]['Current Stock'],1);
  assert.equal(w.rows('VENDORS')[0]['Current Due'],0);
});

test('delete after negative-to-vendor edit reverses replacement vendor payable exactly once', () => {
  const w = workbook({
    SALES: [sale({ 'Customer ID':'', Subtotal:200, 'Grand Total':200, 'Paid Amount':0, 'Due Amount':0 })],
    SALE_ITEMS: [item(2)], PRODUCTS: [product(-1)], CASH_SESSIONS: [{ Status:'Open' }],
    STOCK_LOTS: [lot('L1',0), lot('OV1',1,'2026-09-05',{ 'Purchase ID':'OVERSOLD','Remaining Quantity':-1,'Status':'Oversold' })],
    SALE_ITEM_LOTS: [
      { 'Invoice ID':'INV1','Product ID':'P1','Lot ID':'L1',Quantity:1,'Unit Cost':40 },
      { 'Invoice ID':'INV1','Product ID':'P1','Lot ID':'OV1',Quantity:1,'Unit Cost':40 }
    ],
    VENDORS: [{ 'Vendor ID':'V1','Vendor Name':'Jewel Hardware','Current Due':0,Status:'Active' }],
    VENDOR_SOURCING: [], VENDOR_LEDGER: []
  });
  const p = payload(2); p.items[0].shortageResolution='vendor';p.items[0].vendorId='V1';p.items[0].vendorUnitCost=400;
  assert.equal(w.ctx.updateSale('token','INV1',p).success,true);
  assert.equal(w.rows('PRODUCTS')[0]['Current Stock'],0);
  assert.equal(w.rows('VENDORS')[0]['Current Due'],400);
  assert.equal(w.ctx.deleteSalesInvoice('token','INV1','Void after correction').success,true);
  assert.equal(w.rows('PRODUCTS')[0]['Current Stock'],1);
  assert.equal(w.rows('VENDORS')[0]['Current Due'],0);
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


test('cash sales return rejects direct Other-method sale because no refundable cash provenance exists', () => {
  const w = workbook({
    SALES: [sale({ Subtotal: 100, 'Grand Total': 100, 'Paid Amount': 100, 'Due Amount': 0, 'Payment Method': 'Other' })],
    SALE_ITEMS: [item(1)],
    PRODUCTS: [product(0)],
    STOCK_LOTS: [lot('L1', 0)],
    SALE_ITEM_LOTS: [{ 'Invoice ID': 'INV1', 'Product ID': 'P1', 'Lot ID': 'L1', Quantity: 1, 'Unit Cost': 40 }],
    CUSTOMER_LEDGER: [], SALES_RETURN: [], SALES_RETURN_ITEMS: [], CASH_BOOK: []
  });
  const before = w.writes.length;
  const result = w.ctx.completeReturn('token', returnPayload(1));
  assert.equal(result.success, false);
  assert.match(result.message, /Cash refund is limited to 0/);
  assert.equal(w.writes.length, before, 'invalid cash refund must be rejected before stock or money writes');
});

test('vendor sourcing reversal falls back to quantity times unit cost when legacy Total Cost is blank', () => {
  const w = workbook({
    SALES: [sale({ Subtotal:200, 'Grand Total':200, 'Paid Amount':200, 'Due Amount':0 })],
    SALE_ITEMS: [item(2)], PRODUCTS: [product(0)], CASH_SESSIONS: [{ Status:'Open' }],
    STOCK_LOTS: [lot('L1',0)],
    SALE_ITEM_LOTS: [{ 'Invoice ID':'INV1','Product ID':'P1','Lot ID':'L1',Quantity:1,'Unit Cost':40 }],
    VENDORS: [{ 'Vendor ID':'V1','Vendor Name':'Jewel Hardware','Current Due':400,Status:'Active' }],
    VENDOR_SOURCING: [{ 'Sourcing ID':'VS1','Date':'2026-09-05','Invoice ID':'INV1','Product ID':'P1','Product Name':'Widget','Vendor ID':'V1','Vendor Name':'Jewel Hardware',Quantity:1,'Unit Cost':400,'Total Cost':'','Created At':'2026-09-05T12:00:00' }],
    VENDOR_LEDGER: [{ 'Ledger ID':'VL1','Date':'2026-09-05','Vendor ID':'V1','Vendor Name':'Jewel Hardware',Type:'Sourcing',Reference:'VS1',Debit:400,Credit:'',Balance:400,'Created At':'2026-09-05T12:00:00' }]
  });
  const p = payload(2); p.items[0].shortageResolution='negative';
  const result = w.ctx.updateSale('token','INV1',p);
  assert.equal(result.success,true,result.message);
  assert.equal(w.rows('VENDORS')[0]['Current Due'],0);
});

test('vendor-sourced quantity increase replaces payable with the full new shortage and leaves stock unchanged', () => {
  const w = workbook({
    SALES: [sale({ Subtotal:200, 'Grand Total':200, 'Paid Amount':200, 'Due Amount':0 })],
    SALE_ITEMS: [item(2)], PRODUCTS: [product(0)], CASH_SESSIONS: [{ Status:'Open' }],
    STOCK_LOTS: [lot('L1',0)],
    SALE_ITEM_LOTS: [{ 'Invoice ID':'INV1','Product ID':'P1','Lot ID':'L1',Quantity:1,'Unit Cost':40 }],
    VENDORS: [{ 'Vendor ID':'V1','Vendor Name':'Jewel Hardware','Current Due':400,Status:'Active' }],
    VENDOR_SOURCING: [{ 'Sourcing ID':'VS1','Date':'2026-09-05','Invoice ID':'INV1','Product ID':'P1','Product Name':'Widget','Vendor ID':'V1','Vendor Name':'Jewel Hardware',Quantity:1,'Unit Cost':400,'Total Cost':400,'Created At':'2026-09-05T12:00:00' }],
    VENDOR_LEDGER: [{ 'Ledger ID':'VL1','Date':'2026-09-05','Vendor ID':'V1','Vendor Name':'Jewel Hardware',Type:'Sourcing',Reference:'VS1',Debit:400,Credit:'',Balance:400,'Created At':'2026-09-05T12:00:00' }]
  });
  const p = payload(3); p.items[0].shortageResolution='vendor';p.items[0].vendorId='V1';p.items[0].vendorUnitCost=400;
  const result = w.ctx.updateSale('token','INV1',p);
  assert.equal(result.success,true,result.message);
  assert.equal(w.rows('PRODUCTS')[0]['Current Stock'],0);
  assert.equal(w.rows('VENDORS')[0]['Current Due'],800);
  const active=w.rows('VENDOR_SOURCING').filter(r=>!r['Is Deleted']);
  assert.equal(active.length,1);assert.equal(active[0].Quantity,2);assert.equal(active[0]['Total Cost'],800);
});

test('vendor-sourced quantity decrease to existing own-stock quantity removes vendor payable without moving stock', () => {
  const w = workbook({
    SALES: [sale({ Subtotal:200, 'Grand Total':200, 'Paid Amount':200, 'Due Amount':0 })],
    SALE_ITEMS: [item(2)], PRODUCTS: [product(0)], CASH_SESSIONS: [{ Status:'Open' }],
    STOCK_LOTS: [lot('L1',0)],
    SALE_ITEM_LOTS: [{ 'Invoice ID':'INV1','Product ID':'P1','Lot ID':'L1',Quantity:1,'Unit Cost':40 }],
    VENDORS: [{ 'Vendor ID':'V1','Vendor Name':'Jewel Hardware','Current Due':400,Status:'Active' }],
    VENDOR_SOURCING: [{ 'Sourcing ID':'VS1','Date':'2026-09-05','Invoice ID':'INV1','Product ID':'P1','Product Name':'Widget','Vendor ID':'V1','Vendor Name':'Jewel Hardware',Quantity:1,'Unit Cost':400,'Total Cost':400,'Created At':'2026-09-05T12:00:00' }],
    VENDOR_LEDGER: [{ 'Ledger ID':'VL1','Date':'2026-09-05','Vendor ID':'V1','Vendor Name':'Jewel Hardware',Type:'Sourcing',Reference:'VS1',Debit:400,Credit:'',Balance:400,'Created At':'2026-09-05T12:00:00' }]
  });
  const p = payload(1); p.items[0].shortageResolution='vendor';
  const result = w.ctx.updateSale('token','INV1',p);
  assert.equal(result.success,true,result.message);
  assert.equal(w.rows('PRODUCTS')[0]['Current Stock'],0);
  assert.equal(w.rows('VENDORS')[0]['Current Due'],0);
  assert.equal(w.rows('VENDOR_SOURCING').filter(r=>!r['Is Deleted']).length,0);
});

test('vendor sale uses net Current Stock when positive lots are offset by unresolved OVERSOLD debt', () => {
  const w = workbook({
    PRODUCTS: [product(1)],
    STOCK_LOTS: [
      lot('ADJ1', 1, '2026-09-08', { 'Purchase ID':'ADJUSTMENT', 'Remaining Quantity':1 }),
      lot('OV1', 2, '2026-09-09', { 'Purchase ID':'OVERSOLD', 'Remaining Quantity':-2, 'Status':'Oversold' }),
      lot('SRT1', 2, '2026-09-09', { 'Purchase ID':'SRT-000001', 'Remaining Quantity':2 })
    ],
    VENDORS: [{ 'Vendor ID':'V1','Vendor Name':'Jewel Hardware','Current Due':0,Status:'Active' }],
    VENDOR_SOURCING: [], VENDOR_LEDGER: []
  });
  const p = payload(3);
  p.items[0].vendorId = 'V1';
  p.items[0].vendorUnitCost = 440;
  p.items[0].shortageResolution = 'vendor';

  const result = w.ctx.completeSale('token', p);
  assert.equal(result.success, true, result.message);
  assert.equal(w.rows('PRODUCTS')[0]['Current Stock'], 0, 'only one owned unit should leave Current Stock');
  assert.equal(w.rows('VENDORS')[0]['Current Due'], 880, 'two-unit shortage should be sourced from vendor');
  const sourcing = w.rows('VENDOR_SOURCING').filter(r => !r['Is Deleted']);
  assert.equal(sourcing.length, 1);
  assert.equal(sourcing[0].Quantity, 2);
  assert.equal(sourcing[0]['Total Cost'], 880);
  assert.equal(w.rows('SALE_ITEM_LOTS').reduce((sum, row) => sum + Number(row.Quantity || 0), 0), 1,
    'sale should consume only the single net-owned unit from stock lots');
  assert.equal(w.rows('STOCK_LOTS').reduce((sum, row) => sum + Number(row['Remaining Quantity'] || 0), 0), 0,
    'stock-lot balance must reconcile to Current Stock after vendor sourcing');
});

test('invoice quantity increase with vendor sourcing also uses net Current Stock under unresolved OVERSOLD debt', () => {
  const w = workbook({
    SALES: [sale({ Subtotal:100, 'Grand Total':100, 'Paid Amount':100, 'Due Amount':0 })],
    SALE_ITEMS: [item(1)],
    PRODUCTS: [product(1)],
    CASH_SESSIONS: [{ Status:'Open' }],
    STOCK_LOTS: [
      lot('OLD1', 0, '2026-09-01', { 'Remaining Quantity':0, 'Status':'Consumed' }),
      lot('ADJ1', 1, '2026-09-08', { 'Purchase ID':'ADJUSTMENT', 'Remaining Quantity':1 }),
      lot('OV1', 2, '2026-09-09', { 'Purchase ID':'OVERSOLD', 'Remaining Quantity':-2, 'Status':'Oversold' }),
      lot('SRT1', 2, '2026-09-09', { 'Purchase ID':'SRT-000001', 'Remaining Quantity':2 })
    ],
    SALE_ITEM_LOTS: [{ 'Invoice ID':'INV1','Product ID':'P1','Lot ID':'OLD1',Quantity:1,'Unit Cost':40 }],
    VENDORS: [{ 'Vendor ID':'V1','Vendor Name':'Jewel Hardware','Current Due':0,Status:'Active' }],
    VENDOR_SOURCING: [], VENDOR_LEDGER: []
  });
  const p = payload(3);
  p.items[0].shortageResolution = 'vendor';
  p.items[0].vendorId = 'V1';
  p.items[0].vendorUnitCost = 440;

  const result = w.ctx.updateSale('token', 'INV1', p);
  assert.equal(result.success, true, result.message);
  assert.equal(w.rows('PRODUCTS')[0]['Current Stock'], 0, 'edit should consume only one additional net-owned unit');
  assert.equal(w.rows('VENDORS')[0]['Current Due'], 440, 'only the remaining one-unit edit shortage belongs to vendor');
  const sourcing = w.rows('VENDOR_SOURCING').filter(r => !r['Is Deleted']);
  assert.equal(sourcing.length, 1);
  assert.equal(sourcing[0].Quantity, 1);
  assert.equal(sourcing[0]['Total Cost'], 440);
});
