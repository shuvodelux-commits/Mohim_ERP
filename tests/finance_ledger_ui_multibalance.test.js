'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const src = fs.readFileSync('financeLedger.html','utf8');

const cardIds = [
  'finLedCapital','finLedOwnerAdvance','finLedLoan','finLedLenderCredit',
  'finLedBorrowerReceivable','finLedBorrowerCredit'
];

test('Finance Ledger uses shared searchable person combobox instead of plain select', () => {
  assert.match(src, /id=["']finLedPersonSearch["']/);
  assert.match(src, /id=["']finLedPersonResults["']/);
  assert.match(src, /createPartySearchCombobox_/);
  assert.match(src, /data-search-clear=["']on["']/);
  assert.doesNotMatch(src, /<select[^>]+id=["']finLedPersonFilter["']/);
});

test('Finance Ledger shows all six current relationship balances', () => {
  cardIds.forEach(id => assert.match(src, new RegExp(`id=["']${id}["']`), id));
  assert.match(src, /d\.summary/);
});

test('edit form is role-aware and opening-aware from transaction metadata', () => {
  assert.match(src, /\.role\b/);
  assert.match(src, /\.cashDirection\b/);
  assert.match(src, /cashDirection\s*===\s*['"]none['"]/);
  assert.match(src, /paymentMethod:\s*hasMoneyMovement\s*\?[^:]+:\s*['"]['"]/s);
  assert.match(src, /bankAccountId:\s*hasMoneyMovement\s*\?[^:]+:\s*['"]['"]/s);
  assert.doesNotMatch(src, /transactionType\.indexOf\(['"]Loan['"]\)/);
});

test('ledger table and view expose relationship account semantics', () => {
  assert.match(src, /Account/);
  assert.match(src, /accountLabel/);
  assert.match(src, /Balance After/);
});

test('print and CSV include selected person identity and all six summary values', () => {
  ['Owner Capital','Owner Advance','Outstanding Loan','Lender Credit','Borrower Receivable','Borrower Credit'].forEach(label => {
    assert.match(src, new RegExp(label.replace(' ','\\s+')));
  });
  assert.match(src, /selectedPerson/);
  assert.match(src, /finLedCsvRows_/);
  assert.match(src, /exportRowsToCsv/);
});
