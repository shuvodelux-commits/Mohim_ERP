'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const src = fs.readFileSync('finance.html', 'utf8');

const summaryIds = [
  'finCapitalStat', 'finOwnerAdvanceStat', 'finLoanStat',
  'finLenderCreditStat', 'finBorrowerReceivableStat', 'finBorrowerCreditStat'
];

test('Business Finance renders all six relationship balance cards', () => {
  summaryIds.forEach(id => assert.match(src, new RegExp(`id=["']${id}["']`), id));
});

test('transaction picker is grouped and driven by transaction metadata', () => {
  ['Owner', 'Loan', 'Borrower', 'Opening Balance'].forEach(group => {
    assert.match(src, new RegExp(group.replace(' ', '\\s+')));
  });
  assert.match(src, /\.role\b/);
  assert.match(src, /\.cashDirection\b/);
  assert.match(src, /\.isOpening\b/);
  assert.doesNotMatch(src, /typeKey\.indexOf\(['"]Loan['"]\)/);
});

test('opening transactions hide money controls and submit blank money fields', () => {
  assert.match(src, /Opening balance\s*[—-]\s*no Cash\/Bank movement/);
  assert.match(src, /cashDirection\s*===\s*['"]none['"]/);
  assert.match(src, /paymentMethod:\s*hasMoneyMovement\s*\?[^:]+:\s*['"]['"]/s);
  assert.match(src, /bankAccountId:\s*hasMoneyMovement\s*\?[^:]+:\s*['"]['"]/s);
});

test('person management supports Owner Lender Borrower roles and full person edits', () => {
  ['Owner', 'Lender', 'Borrower'].forEach(role => {
    assert.match(src, new RegExp(`data-fin-role=["']${role}["']`));
  });
  assert.match(src, /updateFinancePerson/);
  assert.match(src, /data-act=["']edit["']/);
  assert.doesNotMatch(src, /Manage Owners\s*\/\s*Lenders/);
  assert.doesNotMatch(src, /Person \(Owner\s*\/\s*Lender\)/);
});

test('quick add defaults to the transaction required role and confirmation remains frozen', () => {
  assert.match(src, /requiredRole/);
  assert.match(src, /roles:\s*\[requiredRole\]/);
  assert.match(src, /var\s+payload\s*=\s*\{/);
  assert.match(src, /runConfirmedAction\([\s\S]{0,3200}serverCall\('addFinanceTransaction',\s*authToken,\s*payload\)/);
  assert.match(src, /Opening Balance\s*[—-]\s*no Cash\/Bank movement/);
});
