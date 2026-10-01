'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function workbook(seed = {}) {
  const tables = structuredClone(seed);
  const writes = [];
  let locked = false, serial = 0;
  const rows = key => tables[key] || (tables[key] = []);
  const ctx = vm.createContext({ console, Date, Math, JSON, CONFIG: { LOCK_TIMEOUT_MS: 1000 } });
  for (const name of ['Utils.gs', 'Customer.gs', 'DeleteEngine.gs', 'StockLots.gs', 'Sales.gs']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', name), 'utf8'), ctx, { filename: name });
  }
  const mutate = (key, action) => {
    assert.equal(locked, true, 'transaction write must hold ScriptLock');
    writes.push(key);
    return action();
  };
  Object.assign(ctx, {
    LockService: { getScriptLock: () => ({ waitLock: () => { assert.equal(locked, false); locked = true; }, releaseLock: () => { locked = false; } }) },
    Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: { formatDate: (date, zone, format) => format === 'HH:mm:ss' ? '12:00:00' : new Date(date).toISOString().slice(0, 10) },
    requirePermission_: () => ({ 'Full Name': 'Audit User' }),
    actorName_: user => user['Full Name'],
    requireActiveCashSession_: () => ({ id: 'CS1' }),
    getAllRows_: key => rows(key).map((row, i) => ({ ...row, _rowIndex: i + 2 })),
    activeRows_: key => ctx.getAllRows_(key).filter(row => !ctx.isDeleted_(row)),
    findRows_: (key, col, value) => ctx.getAllRows_(key).filter(row => row[col] === value),
    findRowIndex_: (key, col, value) => { const i = rows(key).findIndex(row => String(row[col]) === String(value)); return i < 0 ? -1 : i + 2; },
    appendRow_: (key, row) => mutate(key, () => { rows(key).push({ ...row }); return rows(key).length + 1; }),
    appendRows_: (key, values) => values.forEach(row => ctx.appendRow_(key, row)),
    updateRowFields_: (key, index, fields) => mutate(key, () => { assert.ok(rows(key)[index - 2], `${key} row ${index}`); Object.assign(rows(key)[index - 2], fields); }),
    deleteRow_: (key, index) => mutate(key, () => rows(key).splice(index - 2, 1)),
    generateId_: key => `${key}-${++serial}`,
    logError_: () => {},
    resolveTransactionDate_: () => ({ dateStr: '2026-09-08', isBackdated: false, backdatedDays: 0, reason: '' }),
    resolveBankAccount_: () => ({ id: '', name: '' }),
    buildInvoicePayload_: id => ({ invoiceId: id }),
    addCashBookEntry_: entry => ctx.appendRow_('CASH_BOOK', entry),
    addBankBookEntry_: (id, entry) => ctx.appendRow_('BANK_BOOK', { ...entry, 'Bank Account ID': id }),
    postVendorLedgerEntry_: () => {},
    // Draft-posting boundary. This exercises completeSale's real sourceDraft
    // branch while keeping the test focused on customer identity.
    findPostedInvoiceByDraftId_: () => null,
    prepareSalesDraftForPosting_: () => ({ parsed: { items: [{ productId: 'P1', qty: 1, unitPrice: 100, lineTotal: 100 }] } }),
    fixedDraftLineByProduct_: () => ({ P1: { productId: 'P1', qty: 1, unitPrice: 100, lineTotal: 100 } }),
    removeSalesDraftAfterPost_: () => true
  });
  return { ctx, tables, writes, rows };
}

const product = () => ({ 'Product ID': 'P1', 'Product Name': 'Widget', 'Current Stock': 5, 'Purchase Price': 40, 'Selling Price': 100, Status: 'Active' });
const lot = () => ({ 'Lot ID': 'L1', 'Product ID': 'P1', 'Product Name': 'Widget', 'Purchase ID': 'PUR1', 'Purchase Date': '2026-09-01', 'Original Quantity': 5, 'Remaining Quantity': 5, 'Purchase Price': 40, 'Sell Price': 100, Status: 'Active' });
function draftPayload(extra = {}) {
  return {
    customerId: 'C-DRAFT',
    customerName: 'Ripon Sarkar',
    customerPhone: '01754551449',
    customerAddress: 'Sripur',
    items: [{ productId: 'P1', name: 'Widget', qty: 1, unitPrice: 100, priceMode: 'fixed', lineTotal: 100 }],
    discount: 0,
    paymentType: 'Due',
    paidAmount: 0,
    paymentMethod: 'Cash',
    sourceDraftId: 'DRF-1',
    sourceDraftVersion: 1,
    ...extra
  };
}

test('draft sale posts due to the exact selected customer id even when a duplicate phone row exists', () => {
  const w = workbook({
    CUSTOMERS: [
      { 'Customer ID': 'C-OLD', 'Customer Name': 'Ripon Sarkar', Phone: '01754551449', 'Current Due': 11660, Status: 'Active' },
      { 'Customer ID': 'C-DRAFT', 'Customer Name': 'Ripon Sarkar', Phone: '01754551449', 'Current Due': 0, Status: 'Active' }
    ],
    PRODUCTS: [product()], STOCK_LOTS: [lot()]
  });
  const result = w.ctx.completeSale('token', draftPayload());
  assert.equal(result.success, true, result.message);
  assert.equal(w.rows('SALES')[0]['Customer ID'], 'C-DRAFT');
  assert.equal(w.rows('CUSTOMER_LEDGER')[0]['Customer ID'], 'C-DRAFT');
  assert.equal(w.rows('CUSTOMERS')[0]['Current Due'], 11660);
  assert.equal(w.rows('CUSTOMERS')[1]['Current Due'], 100);
});

test('draft sale with no selected id refuses an ambiguous duplicate-phone customer before any writes', () => {
  const w = workbook({
    CUSTOMERS: [
      { 'Customer ID': 'C-1', 'Customer Name': 'Ripon Sarkar', Phone: '01754551449', 'Current Due': 11660, Status: 'Active' },
      { 'Customer ID': 'C-2', 'Customer Name': 'Ripon Sarkar', Phone: '01754551449', 'Current Due': 0, Status: 'Active' }
    ],
    PRODUCTS: [product()], STOCK_LOTS: [lot()]
  });
  const result = w.ctx.completeSale('token', draftPayload({ customerId: '' }));
  assert.equal(result.success, false);
  assert.match(result.message || result.error || '', /more than one|select the exact customer/i);
  assert.deepEqual(w.writes, []);
});

test('draft sale uses the selected active customer id and canonical master phone when the draft phone is stale', () => {
  const w = workbook({
    CUSTOMERS: [
      { 'Customer ID': 'C-DRAFT', 'Customer Name': 'Ripon Sarkar', Phone: '01800000000', Address: 'Master Address', 'Father Name': 'Master Father', 'Current Due': 0, Status: 'Active' }
    ],
    PRODUCTS: [product()], STOCK_LOTS: [lot()]
  });
  const result = w.ctx.completeSale('token', draftPayload());
  assert.equal(result.success, true, result.message);
  assert.equal(w.rows('SALES')[0]['Customer ID'], 'C-DRAFT');
  assert.equal(w.rows('SALES')[0]['Customer Phone'], '01800000000');
  assert.equal(w.rows('CUSTOMER_LEDGER')[0]['Customer ID'], 'C-DRAFT');
  assert.equal(w.rows('CUSTOMERS')[0]['Current Due'], 100);
});
