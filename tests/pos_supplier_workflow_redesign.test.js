'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('supplier Debit/receivable overrides remain green, including actual balance card and detail', () => {
  const css = read('style.html');
  const pattern = /#page-supplierLedger \.ledger-tone--advance,\s*#page-suppliers \.ledger-tone--advance\s*\{[^}]*\}/g;
  const scoped = [...css.matchAll(pattern)].map(m => m[0]);
  assert.ok(scoped.length, 'supplier scoped override exists');
  assert.match(scoped.at(-1), /color\s*:\s*var\(--color-success\)/);
  assert.doesNotMatch(scoped.at(-1), /var\(--color-danger\)/);

  const card = css.match(/#page-supplierLedger \.party-ledger-balance-box\.ledger-tone--advance\s*\{[^}]*\}/g);
  assert.ok(card?.length);
  assert.match(card.at(-1), /background\s*:\s*var\(--color-success-light\)/);
  assert.match(card.at(-1), /border-color\s*:\s*var\(--color-success\)/);

  const caption = css.match(/#page-supplierLedger \.party-ledger-balance-box\.ledger-tone--advance \.party-ledger-balance-note\s*\{[^}]*\}/g);
  assert.ok(caption?.length);
  assert.match(caption.at(-1), /color\s*:\s*var\(--color-success\)/);
});

test('supplier debit detail is green, credit payable red, vendor semantics remain independent', () => {
  const js = read('javascript.html');
  const before = js.indexOf('  var ERP_SEMANTIC_DETAILS_');
  const after = js.indexOf('  function erpSemanticUpdate_', before);
  assert.ok(before >= 0 && after > before);
  const ctx = vm.createContext({});
  vm.runInContext(js.slice(before, after), ctx);
  const supplier = ctx.ERP_SEMANTIC_DETAILS_.supDetailDue;
  assert.equal(ctx.erpSemanticTone_(supplier, 'Debit ৳200'), 'positive');
  assert.equal(ctx.erpSemanticLabel_(supplier, 'positive'), 'To Receive');
  assert.equal(ctx.erpSemanticTone_(supplier, 'Credit ৳200'), 'negative');
  assert.equal(ctx.erpSemanticLabel_(supplier, 'negative'), 'To Pay');
  assert.equal(ctx.erpSemanticTone_(supplier, '৳0'), 'neutral');
  const vendor = ctx.ERP_SEMANTIC_DETAILS_.vlDetailDue;
  assert.equal(ctx.erpSemanticTone_(vendor, 'Credit ৳200'), 'positive');
});

test('POS sale confirmation includes subtotal and discount rather than only grand total', () => {
  const src = read('pos.html');
  const start = src.indexOf('    var saleConfirmDetails = [');
  const end = src.indexOf('    runConfirmedAction({', start);
  assert.ok(start > 0 && end > start);
  const details = src.slice(start, end);
  assert.match(details, /label:\s*'Subtotal'/);
  assert.match(details, /label:\s*'Discount'/);
  assert.match(details, /label:\s*'Grand Total'/);
  assert.match(details, /formatMoney\(discount\)/);
  assert.ok(details.indexOf("'Discount'") < details.indexOf("'Grand Total'"), 'discount must appear before grand total');
});
