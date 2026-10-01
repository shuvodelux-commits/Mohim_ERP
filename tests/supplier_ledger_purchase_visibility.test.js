'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'PartyLedger.gs'), 'utf8');

let pass = 0;
let fail = 0;

function test(name, fn) {
  try {
    fn();
    pass++;
    console.log('PASS', name);
  } catch (err) {
    fail++;
    console.error('FAIL', name);
    console.error(err.stack || err);
  }
}

function runtime(options) {
  const opts = options || {};
  const purchases = (opts.purchases || []).map(function (row, i) {
    return Object.assign({
      _rowIndex: i + 2,
      'Purchase ID': 'PUR-' + (i + 1),
      Date: '2026-09-24',
      'Supplier ID': 'S1',
      'Supplier Name': 'Supplier One',
      'Grand Total': 0,
      'Paid Amount': 0,
      'Due Amount': 0,
      'Payment Status': 'Due',
      'Created At': '2026-09-24T10:00:00',
      'Is Deleted': ''
    }, row);
  });
  const rawBySupplier = opts.rawBySupplier || {};

  const ctx = {
    console,
    roundMoney_: value => Math.round((Number(value) || 0) * 100) / 100,
    isDeleted_: row => String(row && row['Is Deleted'] || '').toUpperCase() === 'TRUE',
    safeDateOnly_: value => String(value || '').slice(0, 10),
    sanitizeInput_: value => String(value == null ? '' : value).trim(),
    activeRows_: key => key === 'PURCHASES' ? purchases.filter(row => !ctx.isDeleted_(row)) : [],
    Utilities: {
      Charset: { UTF_8: 'UTF-8' },
      base64EncodeWebSafe: value => Buffer.from(String(value)).toString('base64url'),
      base64DecodeWebSafe: value => Array.from(Buffer.from(String(value), 'base64url')),
      newBlob: bytes => ({ getDataAsString: () => Buffer.from(bytes).toString() })
    }
  };

  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'PartyLedger.gs' });

  ctx.partyLedgerBuildAscendingIndex_ = function (kind, partyId) {
    return (rawBySupplier[String(partyId)] || []).map(row => Object.assign({}, row));
  };
  ctx.partyLedgerSourceDateMap_ = function () { return {}; };
  ctx.partyLedgerSupplierPurchaseIndex_ = function (partyId) {
    return purchases.filter(row => String(row['Supplier ID'] || '') === String(partyId || ''));
  };
  return ctx;
}

function ledgerRow(index, type, ref, debit, credit, supplierId) {
  return {
    _rowIndex: index,
    'Ledger ID': 'SL-' + index,
    Date: '2026-09-24',
    'Supplier ID': supplierId || 'S1',
    'Supplier Name': supplierId === 'S2' ? 'Supplier Two' : 'Supplier One',
    Type: type,
    Reference: ref,
    Debit: debit || '',
    Credit: credit || '',
    'Created At': '2026-09-24T10:00:00',
    'Is Deleted': ''
  };
}

test('supplier clean ledger shows every purchase including fully paid, partial and due invoices', () => {
  const ctx = runtime({
    purchases: [
      { _rowIndex: 2, 'Purchase ID': 'PUR-PAID', Date: '2026-09-21', 'Grand Total': 1000, 'Paid Amount': 1000, 'Due Amount': 0, 'Payment Status': 'Paid' },
      { _rowIndex: 3, 'Purchase ID': 'PUR-PARTIAL', Date: '2026-09-22', 'Grand Total': 1000, 'Paid Amount': 400, 'Due Amount': 600, 'Payment Status': 'Partial' },
      { _rowIndex: 4, 'Purchase ID': 'PUR-DUE', Date: '2026-09-23', 'Grand Total': 1000, 'Paid Amount': 0, 'Due Amount': 1000, 'Payment Status': 'Due' }
    ],
    rawBySupplier: {
      S1: [
        ledgerRow(10, 'Purchase', 'PUR-PARTIAL', 600, 0),
        ledgerRow(11, 'Purchase', 'PUR-DUE', 1000, 0)
      ]
    }
  });

  const rows = ctx.partyLedgerBuildDisplayIndex_('supplier', 'S1', false);
  assert.deepEqual(rows.map(r => r.Reference), ['PUR-PAID', 'PUR-PARTIAL', 'PUR-DUE']);
  assert.deepEqual(rows.map(r => [Number(r.Debit) || 0, Number(r.Credit) || 0]), [
    [1000, 1000],
    [1000, 400],
    [1000, 0]
  ]);
  assert.deepEqual(rows.map(r => r._displayBalance), [0, 600, 1600]);
});

test('supplier clean ledger uses current purchase totals after purchase update without exposing correction rows', () => {
  const ctx = runtime({
    purchases: [
      { _rowIndex: 2, 'Purchase ID': 'PUR-EDIT', 'Grand Total': 800, 'Paid Amount': 300, 'Due Amount': 500, 'Payment Status': 'Partial' }
    ],
    rawBySupplier: {
      S1: [
        ledgerRow(10, 'Purchase', 'PUR-EDIT', 600, 0),
        ledgerRow(11, 'Purchase Update', 'PUR-EDIT', 0, 100)
      ]
    }
  });

  const rows = ctx.partyLedgerBuildDisplayIndex_('supplier', 'S1', false);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Type, 'Purchase');
  assert.equal(rows[0].Reference, 'PUR-EDIT');
  assert.equal(Number(rows[0].Debit), 800);
  assert.equal(Number(rows[0].Credit), 300);
  assert.equal(rows[0]._displayBalance, 500);
});

test('supplier clean ledger keeps purchase return credit separate from the full purchase invoice row', () => {
  const ctx = runtime({
    purchases: [
      { _rowIndex: 2, 'Purchase ID': 'PUR-RET', 'Grand Total': 1000, 'Paid Amount': 200, 'Due Amount': 800, 'Payment Status': 'Partial' }
    ],
    rawBySupplier: {
      S1: [
        ledgerRow(10, 'Purchase', 'PUR-RET', 800, 0),
        ledgerRow(11, 'Purchase Return Credit', 'RET-1', 0, 100)
      ]
    }
  });

  const rows = ctx.partyLedgerBuildDisplayIndex_('supplier', 'S1', false);
  assert.deepEqual(rows.map(r => r.Type), ['Purchase', 'Purchase Return Credit']);
  assert.equal(Number(rows[0].Debit), 1000);
  assert.equal(Number(rows[0].Credit), 200);
  assert.equal(Number(rows[1].Credit), 100);
  assert.equal(rows[1]._displayBalance, 700);
});

test('later supplier payment remains a separate credit after the full purchase invoice row', () => {
  const ctx = runtime({
    purchases: [
      { _rowIndex: 2, 'Purchase ID': 'PUR-PAY', 'Grand Total': 1000, 'Paid Amount': 200, 'Due Amount': 800, 'Payment Status': 'Partial' }
    ],
    rawBySupplier: {
      S1: [
        ledgerRow(10, 'Purchase', 'PUR-PAY', 800, 0),
        ledgerRow(11, 'Payment', 'PAYMENT', 0, 300)
      ]
    }
  });

  const rows = ctx.partyLedgerBuildDisplayIndex_('supplier', 'S1', false);
  assert.deepEqual(rows.map(r => r.Type), ['Purchase', 'Payment']);
  assert.equal(Number(rows[0].Debit), 1000);
  assert.equal(Number(rows[0].Credit), 200);
  assert.equal(Number(rows[1].Credit), 300);
  assert.equal(rows[1]._displayBalance, 500);
});

test('supplier reassignment removes purchase from old supplier and shows current invoice on new supplier', () => {
  const ctx = runtime({
    purchases: [
      { _rowIndex: 2, 'Purchase ID': 'PUR-MOVE', 'Supplier ID': 'S2', 'Supplier Name': 'Supplier Two', 'Grand Total': 700, 'Paid Amount': 200, 'Due Amount': 500, 'Payment Status': 'Partial' }
    ],
    rawBySupplier: {
      S1: [
        ledgerRow(10, 'Purchase', 'PUR-MOVE', 500, 0, 'S1'),
        ledgerRow(11, 'Purchase Update', 'PUR-MOVE', 0, 500, 'S1')
      ],
      S2: [
        ledgerRow(12, 'Purchase Update', 'PUR-MOVE', 500, 0, 'S2')
      ]
    }
  });

  const oldRows = ctx.partyLedgerBuildDisplayIndex_('supplier', 'S1', false);
  assert.equal(oldRows.filter(r => r.Reference === 'PUR-MOVE').length, 0);

  const newRows = ctx.partyLedgerBuildDisplayIndex_('supplier', 'S2', false);
  assert.equal(newRows.length, 1);
  assert.equal(newRows[0].Type, 'Purchase');
  assert.equal(newRows[0].Reference, 'PUR-MOVE');
  assert.equal(Number(newRows[0].Debit), 700);
  assert.equal(Number(newRows[0].Credit), 200);
  assert.equal(newRows[0]._displayBalance, 500);
});

console.log('\n' + pass + '/' + (pass + fail) + ' passed');
if (fail) process.exit(1);
