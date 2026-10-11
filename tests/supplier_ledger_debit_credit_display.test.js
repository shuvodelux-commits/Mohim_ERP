'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function fixture() {
  const context = vm.createContext({
    console,
    roundMoney_: value => Math.round((Number(value) + Number.EPSILON) * 100) / 100,
    safeDateOnly_: value => String(value || '').slice(0, 10),
    sanitizeInput_: value => String(value || '').trim(),
    requirePermission_: () => ({ Role: 'Administrator' }),
    getSettingsMap_: () => ({}),
    CONFIG: { APP_NAME: 'Test ERP' },
    formatDateTime_: () => '2026-10-11 12:00',
    Session: { getScriptTimeZone: () => 'Asia/Dhaka' }
  });
  vm.runInContext(read('PartyLedger.gs'), context, { filename: 'PartyLedger.gs' });
  return context;
}

function row(i, type, date, debit, credit, balance, options = {}) {
  return {
    _synthetic: true,
    _rowIndex: i + 2,
    'Ledger ID': 'SL' + i,
    'Date': date,
    'Created At': date + 'T10:00:00',
    'Supplier ID': 'S1',
    'Supplier Name': 'Example Supplier',
    'Type': type,
    'Reference': 'REF-' + i,
    'Debit': debit || '',
    'Credit': credit || '',
    '_displayBalance': balance,
    ...options
  };
}

test('supplier opening payable is Credit, advance is Debit; underlying row is never mutated', () => {
  const c = fixture();
  const payable = row(1, 'Opening Balance', '2026-09-01', 5000, 0, 5000);
  const advance = row(2, 'Opening Balance', '2026-09-01', 0, 200, -200);
  const presentedPayable = c.partyLedgerPresentAmounts_('supplier', payable);
  const presentedAdvance = c.partyLedgerPresentAmounts_('supplier', advance);
  assert.equal(presentedPayable.Debit, '');
  assert.equal(presentedPayable.Credit, 5000);
  assert.equal(presentedAdvance.Debit, 200);
  assert.equal(presentedAdvance.Credit, '');
  assert.equal(payable.Debit, 5000, 'stored opening must remain unchanged');
  assert.equal(advance.Credit, 200, 'stored advance must remain unchanged');
  assert.equal(c.partyLedgerPresentAmounts_('customer', payable).Debit, 5000);
});

test('purchase credits payable; direct purchase settlement, payment, and return debit it', () => {
  const c = fixture();
  const internalRows = [
    row(1, 'Opening Balance', '2026-09-01', 5000, 0, 5000),
    row(2, 'Purchase', '2026-09-04', 3000, 1000, 7000, { _synthetic: true }),
    row(3, 'Payment', '2026-09-05', 0, 1000, 6000),
    row(4, 'Purchase Return Credit', '2026-09-06', 0, 500, 5500)
  ];
  const rows = c.partyLedgerNormalizeFullRows_('supplier', internalRows);
  assert.deepEqual(rows.map(r => [Number(r.Debit) || 0, Number(r.Credit) || 0]), [
    [0, 5000], [1000, 3000], [1000, 0], [500, 0]
  ]);
  assert.deepEqual(rows.map(r => r.Balance), [5000, 7000, 6000, 5500]);
  assert.equal(rows.at(-1).Balance,
    rows.reduce((bal, r) => bal + (Number(r.Credit) || 0) - (Number(r.Debit) || 0), 0));
  assert.equal(internalRows[1].Debit, 3000, 'purchase writer convention must stay unchanged');
});

test('supplier statement uses credit-normal columns and preserves period closing due', () => {
  const c = fixture();
  const raw = [
    row(1, 'Opening Balance', '2026-08-31', 5000, 0, 5000),
    row(2, 'Purchase', '2026-09-04', 3000, 1000, 7000),
    row(3, 'Payment', '2026-09-05', 0, 1000, 6000),
    row(4, 'Purchase Return Credit', '2026-09-06', 0, 500, 5500)
  ];
  c.partyLedgerBuildDisplayIndex_ = () => raw;
  c.partyLedgerSelectedParty_ = () => ({ id: 'S1', name: 'Example Supplier', balance: 5500 });
  c.partyLedgerValidateStatementDates_ = () => ({ from: '2026-09-01', to: '2026-09-30' });
  const statement = c.getPartyLedgerStatement_('supplier', 'T', 'S1', '2026-09-01', '2026-09-30');
  assert.equal(statement.openingBalance, 5000);
  assert.equal(statement.periodCredit, 3000);
  assert.equal(statement.periodDebit, 2500);
  assert.equal(statement.closingBalance, 5500);
  assert.deepEqual(statement.rows.map(r => [Number(r.Debit) || 0, Number(r.Credit) || 0]),
    [[1000, 3000], [1000, 0], [500, 0]]);
  assert.equal(statement.rows.at(-1).Balance, 5500);
});

test('supplier pages and print view use the same displayed Debit/Credit convention', () => {
  const workspace = read('supplierLedger.html');
  const embedded = read('suppliers.html');
  const print = read('javascript.html');
  const backend = read('Suppliers.gs');
  assert.match(workspace, /var debit = row\['Debit'\]/);
  assert.match(workspace, /Payment Amount'.*?Number\(row\['Debit'\]\)/);
  assert.match(embedded, /var debitHtml = l\['Debit'\]/);
  assert.match(embedded, /Payment Amount'.*?Number\(l\['Debit'\]\)/);
  assert.match(backend, /partyLedgerPresentAmounts_\('supplier', row\)/);
  assert.match(print, /partyLedgerStatementBalance_\(/);
  assert.match(print, /value > 0 \? ' Cr'/);
});
