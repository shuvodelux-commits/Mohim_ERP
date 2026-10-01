'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('PASS', name); }
  catch (err) { fail++; console.error('FAIL', name); console.error(err.stack || err); }
}

const customers = read('customers.html');
const pos = read('pos.html');
const returnsHtml = read('returns.html');
const css = read('style.html');

test('customer directory uses mobile-safe customer card hooks for long addresses', () => {
  assert.match(customers, /customer-directory-table/);
  assert.match(customers, /customer-name-cell/);
  assert.match(customers, /customer-phone-cell/);
  assert.match(customers, /customer-address-cell/);
  assert.match(customers, /customer-due-cell/);
  assert.match(css, /customer-directory-table[\s\S]*customer-address-cell[\s\S]*word-break:\s*break-word/);
});

test('POS can resolve customers by either name or phone and clears stale due data', () => {
  assert.match(pos, /id="posCustomerPhone"[^>]*list="posCustomerPhoneList"/);
  assert.match(pos, /id="posCustomerPhoneList"/);
  assert.match(pos, /function\s+posResolveCustomerSelection_\s*\(/);
  assert.match(pos, /function\s+posApplyCustomerSelection_\s*\(/);
  assert.match(pos, /function\s+posResetSelectedCustomer_\s*\(/);
  assert.match(pos, /posCustomerName'\)\.addEventListener\('input'/);
  assert.match(pos, /posCustomerPhone'\)\.addEventListener\('input'/);
  assert.match(pos, /if \(changedField === 'name'\) phoneEl\.value = '';/);
  assert.match(pos, /if \(changedField === 'phone'\) nameEl\.value = '';/);
});

test('POS sales history uses one Actions menu button instead of four inline buttons', () => {
  assert.match(pos, /class="mobile-card-table pos-history-table"/);
  assert.match(pos, /data-act="historyMenu"/);
  assert.match(pos, /openRowActionMenu_\(btn, \[/);
  assert.match(pos, /label: 'View'/);
  assert.match(pos, /label: 'Print'/);
  assert.match(pos, /label: 'Update'/);
  assert.match(pos, /label: 'Sales Return'/);
});

test('sales return page renders mobile card rows with touch-friendly quantity inputs', () => {
  assert.match(returnsHtml, /mobile-return-cart-table/);
  assert.match(returnsHtml, /return-invoice-summary/);
  assert.match(returnsHtml, /return-product-cell/);
  assert.match(returnsHtml, /return-qty-cell/);
  assert.match(returnsHtml, /return-line-total/);
  assert.match(css, /mobile-return-cart-table[\s\S]*return-qty-cell input[\s\S]*width:\s*100%/);
  assert.match(css, /return-invoice-summary[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
});

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
