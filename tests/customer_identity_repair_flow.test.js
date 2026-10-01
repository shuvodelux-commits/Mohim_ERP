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
  for (const name of ['Utils.gs', 'Customer.gs', 'DeleteEngine.gs', 'StockLots.gs', 'Sales.gs', 'SalesManagement.gs', 'SalesReturn.gs']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', name), 'utf8'), ctx, { filename: name });
  }
  const mutate = (key, action) => { assert.equal(locked, true, 'transaction write must hold ScriptLock'); writes.push(key); return action(); };
  Object.assign(ctx, {
    LockService: { getScriptLock: () => ({ waitLock: () => { assert.equal(locked, false); locked = true; }, releaseLock: () => { locked = false; } }) },
    Session: { getScriptTimeZone: () => 'UTC' },
    Utilities: { formatDate: (date, zone, format) => format === 'HH:mm:ss' ? '12:00:00' : new Date(date).toISOString().slice(0, 10) },
    requirePermission_: () => ({ 'Full Name': 'Audit User' }),
    actorName_: user => user['Full Name'],
    requireActiveCashSession_: () => ({ id: 'CS1' }),
    getAllRows_: key => rows(key).map((row, i) => ({ ...row, _rowIndex: i + 2 })),
    activeRows_: key => ctx.getAllRows_(key).filter(row => !ctx.isDeleted_(row)),
    findRows_: (key, col, value) => ctx.getAllRows_(key).filter(row => String(row[col]) === String(value)),
    findRowIndex_: (key, col, value) => { const i = rows(key).findIndex(row => String(row[col]) === String(value)); return i < 0 ? -1 : i + 2; },
    appendRow_: (key, row) => mutate(key, () => { rows(key).push({ ...row }); return rows(key).length + 1; }),
    appendRows_: (key, values) => values.forEach(row => ctx.appendRow_(key, row)),
    updateRowFields_: (key, index, fields) => mutate(key, () => { assert.ok(rows(key)[index - 2], `${key} row ${index}`); Object.assign(rows(key)[index - 2], fields); }),
    deleteRow_: (key, index) => mutate(key, () => rows(key).splice(index - 2, 1)),
    generateId_: key => `${key}-${++serial}`,
    logError_: () => {},
    resolveTransactionDate_: () => ({ dateStr: '2026-09-08', isBackdated: false, backdatedDays: 0, reason: '' }),
    computeBackdateInfo_: () => ({ isBackdated: false, backdatedDays: 0 }),
    findSessionForTimestamp_: sessions => sessions[0],
    resolveBankAccount_: () => ({ id: '', name: '' }),
    buildInvoicePayload_: id => ({ invoiceId: id }),
    addCashBookEntry_: entry => ctx.appendRow_('CASH_BOOK', entry),
    addBankBookEntry_: (id, entry) => ctx.appendRow_('BANK_BOOK', { ...entry, 'Bank Account ID': id }),
    postVendorLedgerEntry_: () => {},
    markRowDeleted_: () => {}, markMatchingDeleted_: () => {}, adjustVendorDue_: () => {}
  });
  return { ctx, rows, writes };
}

test('editing a due invoice can move it from the wrong duplicate customer to the selected canonical customer without changing money', () => {
  const w = workbook({
    CUSTOMERS: [
      { 'Customer ID': 'CUS-KEEP', 'Customer Name': 'Ripon Sarkar', Phone: '01754551449', 'Current Due': 11660, Status: 'Active' },
      { 'Customer ID': 'CUS-WRONG', 'Customer Name': 'Ripon Sarkar', Phone: '01754551449', 'Current Due': 7730, Status: 'Active' }
    ],
    SALES: [{
      'Invoice ID': 'INV-000029', Date: '2026-09-08', 'Created At': '2026-09-08T12:00:00Z',
      'Customer ID': 'CUS-WRONG', 'Customer Name': 'Ripon Sarkar', 'Customer Phone': '01754551449',
      Subtotal: 7730, Discount: 0, 'Grand Total': 7730, 'Paid Amount': 0, 'Due Amount': 7730,
      'Payment Type': 'Due', 'Payment Status': 'Due', 'Payment Method': ''
    }],
    SALE_ITEMS: [{ 'Invoice ID': 'INV-000029', 'Product ID': 'P1', 'Product Name': 'Product', Quantity: 1, 'Unit Price': 7730, 'Line Total': 7730 }],
    PRODUCTS: [{ 'Product ID': 'P1', 'Product Name': 'Product', 'Current Stock': 9, 'Purchase Price': 5000, 'Selling Price': 7730, Status: 'Active' }],
    STOCK_LOTS: [{ 'Lot ID': 'L1', 'Product ID': 'P1', 'Purchase ID': 'PUR1', 'Purchase Date': '2026-09-01', 'Original Quantity': 10, 'Remaining Quantity': 9, 'Purchase Price': 5000, 'Sell Price': 7730, Status: 'Active' }],
    SALE_ITEM_LOTS: [{ 'Invoice ID': 'INV-000029', 'Product ID': 'P1', 'Lot ID': 'L1', Quantity: 1, 'Unit Cost': 5000, 'Unit Sell Price': 7730 }],
    CASH_SESSIONS: [{ Status: 'Open' }]
  });

  const result = w.ctx.updateSale('token', 'INV-000029', {
    customerId: 'CUS-KEEP', customerName: 'Ripon Sarkar', customerPhone: '01754551449', customerAddress: 'Sripur',
    items: [{ productId: 'P1', name: 'Product', qty: 1, unitPrice: 7730 }],
    discount: 0, paymentType: 'Due', paidAmount: 0, paymentMethod: 'Cash', reason: 'Move invoice to correct duplicate customer account'
  });

  assert.equal(result.success, true, result.message);
  assert.equal(w.rows('SALES')[0]['Customer ID'], 'CUS-KEEP');
  assert.equal(w.rows('CUSTOMERS')[0]['Current Due'], 19390);
  assert.equal(w.rows('CUSTOMERS')[1]['Current Due'], 0);
  const ledger = w.rows('CUSTOMER_LEDGER');
  assert.equal(ledger.length, 2);
  assert.equal(ledger[0]['Customer ID'], 'CUS-WRONG');
  assert.equal(ledger[0].Type, 'Sale Update Credit');
  assert.equal(ledger[0].Credit, 7730);
  assert.equal(ledger[1]['Customer ID'], 'CUS-KEEP');
  assert.equal(ledger[1].Type, 'Sale Update Debit');
  assert.equal(ledger[1].Debit, 7730);
  assert.equal(w.rows('CASH_BOOK').length, 0);
  assert.equal(w.rows('BANK_BOOK').length, 0);
});
