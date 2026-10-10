'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const roundMoney = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function runtime(seed = {}) {
  const sheets = { CASH_BOOK: [], CASH_SESSIONS: [], ...seed };
  let counter = 0;
  const writes = [];
  const ctx = vm.createContext({
    console,
    CONFIG: { LOCK_TIMEOUT_MS: 1000 },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    getAllRows_: sheet => (sheets[sheet] || []).map(x => ({ ...x })),
    activeRows_: sheet => (sheets[sheet] || []).filter(x => !x['Is Deleted']).map(x => ({ ...x })),
    isDeleted_: row => !!row['Is Deleted'],
    getSheetHeaders_: () => ['Debit', 'Credit', 'Balance'],
    getSheet_: () => ({ getRange: () => ({ getValues: () => [], setValues: () => {} }) }),
    invalidateSheetCache_: () => {},
    requirePermission_: () => ({ 'Full Name': 'Administrator' }),
    generateId_: sheet => sheet + '-' + (++counter),
    appendRow_: (sheet, row) => {
      const copy = { _rowIndex: (sheets[sheet] || []).length + 2, ...row };
      (sheets[sheet] ||= []).push(copy);
      writes.push({ type: 'append', sheet, row: copy });
      return copy._rowIndex;
    },
    markRowDeleted_: (sheet, rowIndex) => {
      const row = (sheets[sheet] || []).find(r => r._rowIndex === rowIndex);
      if (!row) throw new Error('Missing row ' + sheet + '/' + rowIndex);
      row['Is Deleted'] = true;
      writes.push({ type: 'delete', sheet, row });
    },
    updateRowFields_: (sheet, index, fields) => {
      const row = (sheets[sheet] || []).find(r => r._rowIndex === index);
      if (!row) throw new Error('Missing updated row');
      Object.assign(row, fields);
    },
    roundMoney_: roundMoney,
    sanitizeInput_: v => String(v == null ? '' : v).trim(),
    actorName_: () => 'Administrator',
    ok_: data => ({ success: true, data }),
    fail_: message => ({ success: false, message: String(message) }),
    logError_: () => {},
    formatDate_: value => new Date(value).toISOString().slice(0, 10),
    isValidNonNegativeNumber_: v => Number.isFinite(Number(v)) && Number(v) >= 0 && v !== '',
    getSettingsMap_: () => ({})
  });
  vm.runInContext(read('CashBook.gs'), ctx);
  vm.runInContext(read('OpeningBalance.gs'), ctx);
  vm.runInContext(read('CashSession.gs'), ctx);
  return { ctx, sheets, writes };
}

test('all five pre-ERP opening types affect ERP cash balance in relationship direction', () => {
  const { ctx, sheets } = runtime();
  const entries = [
    ['Customer', 'CUS-1', 5000, -5000],
    ['Supplier', 'SUP-1', 2000, 2000],
    ['Borrower', 'FIN-1', 750, -750],
    ['Lender', 'FIN-2', 1500, 1500],
    ['Owner', 'FIN-3', 10000, 10000],
    ['Customer', 'CUS-2', -300, 300],
    ['Supplier', 'SUP-2', -200, -200]
  ];
  for (const [entityType, id, amount, expected] of entries) {
    const before = ctx.getCashBalance_();
    ctx.postHistoricalOpeningCash_(entityType, id, amount, 'Old balance', '2026-09-01');
    assert.equal(ctx.getCashBalance_() - before, expected);
  }
  assert.equal(sheets.CASH_BOOK.length, entries.length);
  assert.equal(ctx.getCashBalance_(), 7850);
  assert.ok(sheets.CASH_BOOK.every(r => r.Type === 'Historical Opening'));
  assert.ok(sheets.CASH_BOOK.every(r => /^OPEN:/.test(r.Reference)));
});

test('opening rejects duplicate posting and correction replaces only its own source', () => {
  const { ctx, sheets } = runtime();
  ctx.postHistoricalOpeningCash_('Customer', 'CUS-1', 100, 'A');
  ctx.postHistoricalOpeningCash_('Customer', 'CUS-2', 50, 'B');
  assert.throws(() => ctx.postHistoricalOpeningCash_('Customer', 'CUS-1', 100, 'A'), /already exists/);
  ctx.replaceHistoricalOpeningCash_('Customer', 'CUS-1', 125, 'A', new Date(), {}, 'Fixed');
  assert.equal(ctx.getCashBalance_(), -175);
  assert.equal(sheets.CASH_BOOK.filter(r => r.Reference === 'OPEN:Customer:CUS-1' && !r['Is Deleted']).length, 1);
  assert.equal(sheets.CASH_BOOK.filter(r => r.Reference === 'OPEN:Customer:CUS-2' && !r['Is Deleted']).length, 1);
  ctx.replaceHistoricalOpeningCash_('Customer', 'CUS-1', 0, 'A', new Date(), {}, 'Cleared');
  assert.equal(ctx.getCashBalance_(), -50);
  ctx.reverseHistoricalOpeningCash_('Customer', 'CUS-2', {}, 'Deleted');
  assert.equal(ctx.getCashBalance_(), 0);
});

test('first cash session does not overwrite a pre-existing ERP cash baseline', () => {
  const { ctx, sheets } = runtime();
  ctx.postHistoricalOpeningCash_('Owner', 'FIN-1', 500, 'Owner');
  const result = ctx.startCashSession('T', 200, 'Actual till');
  assert.equal(result.success, true, result.message);
  const marker = sheets.CASH_BOOK.find(r => r.Type === 'Session Open');
  assert.ok(marker);
  assert.equal(Number(marker.Credit) || 0, 0);
  assert.equal(Number(marker.Debit) || 0, 0);
  assert.equal(ctx.getCashBalance_(), 500);
  const summary = ctx.getCashSessionSummary('T');
  assert.equal(summary.data.openingCash, 200);
  assert.equal(summary.data.cashIn, 0);
  assert.equal(summary.data.cashOut, 0);
  assert.equal(summary.data.expectedCash, 200);
});

test('opening posted during active session changes book but not cash in/out', () => {
  const { ctx } = runtime();
  const opened = ctx.startCashSession('T', 100, 'Start');
  assert.equal(opened.success, true);
  ctx.postHistoricalOpeningCash_('Supplier', 'SUP-1', 40, 'Supplier');
  ctx.postHistoricalOpeningCash_('Borrower', 'FIN-1', 20, 'Borrower');
  const summary = ctx.getCashSessionSummary('T');
  assert.equal(ctx.getCashBalance_(), 120);
  assert.equal(summary.data.cashIn, 0);
  assert.equal(summary.data.cashOut, 0);
  assert.equal(summary.data.expectedCash, 100);
});

test('historical creation paths do not enforce a current session', () => {
  for (const file of ['Customer.gs', 'Suppliers.gs', 'BankAccounts.gs']) {
    assert.doesNotMatch(read(file), /if \(opening > 0\) requireActiveCashSession_\(\)/);
  }
  assert.match(read('Customer.gs'), /postHistoricalOpeningCash_\('Customer'/);
  assert.match(read('Suppliers.gs'), /postHistoricalOpeningCash_\('Supplier'/);
  assert.match(read('FinanceModule.gs'), /postHistoricalOpeningCash_\(type.role/);
});
