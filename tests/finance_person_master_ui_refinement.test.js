'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const config = fs.readFileSync('Config.gs','utf8');
const finance = fs.readFileSync('finance.html','utf8');
const ledger = fs.readFileSync('financeLedger.html','utf8');

function hasId(src, id) { assert.match(src, new RegExp(`id=["']${id}["']`), id); }

test('FINANCE_PERSONS has additive Description master-data column', () => {
  assert.match(config, /FINANCE_PERSONS:\s*\[[\s\S]*?"Phone",\s*"Description",\s*"Notes"/);
});

test('Finance Person create and edit UI captures phone description and roles', () => {
  ['finManageNewName','finManageNewPhone','finManageNewDescription','finManageRoleOwner','finManageRoleLender','finManageRoleBorrower'].forEach(id => hasId(finance,id));
  ['finEditPersonName','finEditPersonPhone','finEditPersonDescription','finEditRoleOwner','finEditRoleLender','finEditRoleBorrower','finEditPersonSaveBtn'].forEach(id => hasId(finance,id));
  assert.match(finance, /serverCall\(['"]updateFinancePerson['"]/);
  assert.match(finance, /<th>Phone<\/th>/);
  assert.match(finance, /<th>Description<\/th>/);
});

test('quick-add Finance Person supports optional phone and description', () => {
  hasId(finance, 'finQuickPersonPhone');
  hasId(finance, 'finQuickPersonDescription');
  assert.match(finance, /phone:\s*document\.getElementById\(['"]finQuickPersonPhone['"]\)/);
  assert.match(finance, /description:\s*document\.getElementById\(['"]finQuickPersonDescription['"]\)/);
});

test('Finance Ledger opens the complete Finance Person master list rather than a 20-person cap', () => {
  assert.match(ledger, /getItems:\s*function\s*\(\)\s*\{\s*return finLedState\.persons \|\| \[\];\s*\}/);
  assert.match(ledger, /limit:\s*Math\.max\(1,\s*finLedState\.persons\.length\)/);
  assert.match(ledger, /finLedState\.persons\s*=\s*d\.personsAll\s*\|\|\s*\[\]/);
});

test('transaction type selector is compact and opening types have Bangla descriptions', () => {
  assert.match(finance, /Opening Owner Capital['"]:\s*['"]প্রারম্ভিক মালিক মূলধন/);
  assert.match(finance, /Opening Loan['"]:\s*['"]প্রারম্ভিক ঋণ/);
  assert.match(finance, /Opening Borrower Loan['"]:\s*['"]প্রারম্ভিক ঋণগ্রহীতা ঋণ/);
  assert.match(finance, /fin-type-group-header/);
  assert.match(finance, /#finType\s+option/);
  assert.match(finance, /padding:\s*2px\s+8px/);
});
