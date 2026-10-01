'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('PASS', name); } catch (e) { fail++; console.error('FAIL', name); console.error(e.stack || e); } }
const pos = read('pos.html');
const purchase = read('purchase.html');
const css = read('style.html');

test('purchase product entry uses the POS V2 inline-cart structure', () => {
  assert.doesNotMatch(purchase, /id="purCategoryFilter"/);
  assert.doesNotMatch(purchase, /id="purBrandFilter"/);
  assert.doesNotMatch(purchase, /id="purAddLineBtn"/);
  assert.match(purchase, /class="purchase-cart-columns"/);
  assert.match(purchase, /id="purCartList"/);
  assert.match(purchase, /id="purCartCount"/);
  assert.match(purchase, /id="purClearCartBtn"/);
});

test('purchase inline search uses the shared smart product search and POS-style metadata', () => {
  assert.match(purchase, /function\s+purRenderCartProductResults_\s*\(/);
  assert.match(purchase, /smartSearchProducts_\s*\(/);
  assert.match(purchase, /purchasePrice/);
  assert.match(purchase, /sellingPrice/);
  assert.match(purchase, /Stock/);
  assert.match(purchase, /category/);
});

test('purchase mobile cart uses the POS V2 product-first line layout', () => {
  assert.match(css, /#page-purchase\s+\.purchase-cart-columns,[\s\S]*#page-purchase\s+\.purchase-cart-row\s*\{[^}]*grid-template-columns:/);
  assert.match(css, /@media\s*\(max-width:\s*540px\)[\s\S]*#page-purchase\s+\.purchase-cart-columns\s*\{[^}]*display:\s*none/);
  assert.match(css, /#page-purchase\s+\.purchase-cart-row\s+\.purchase-product-cell\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/);
});

test('POS cart phone row preserves Qty Unit Price Total Remove order', () => {
  assert.match(css, /@media\s*\(max-width:\s*499px\)[\s\S]*#page-pos\s+\.cart-row\s*\{[^}]*grid-template-columns:\s*minmax\(64px,\s*\.8fr\)\s+minmax\(48px,\s*\.5fr\)\s+minmax\(72px,\s*\.8fr\)\s+minmax\(70px,\s*\.8fr\)\s+42px/);
  assert.match(css, /#page-pos\s+\.cart-row\s+\.c-qty-wrap\s*\{[^}]*grid-column:\s*1/);
  assert.match(css, /#page-pos\s+\.cart-row\s+\.c-unit-wrap\s*\{[^}]*grid-column:\s*2/);
  assert.match(css, /#page-pos\s+\.cart-row\s+\.c-price-wrap\s*\{[^}]*grid-column:\s*3/);
  assert.match(css, /#page-pos\s+\.cart-row\s+\.c-line-total-wrap\s*\{[^}]*grid-column:\s*4/);
  assert.match(css, /#page-pos\s+\.cart-row\s*>\s*\.cart-remove,[\s\S]*#page-pos\s+\.cart-row\s*>\s*\.cart-remove-placeholder\s*\{[^}]*grid-column:\s*5/);
  assert.match(pos, /class="c-mobile-label">Qty</);
  assert.match(pos, /class="c-mobile-label">Unit</);
  assert.match(pos, /class="c-mobile-label">Price</);
  assert.match(pos, /class="c-mobile-label">Total</);
});

test('POS customer controls use compact mockup action row', () => {
  assert.match(pos, /class="pos-customer-actions"/);
  assert.match(pos, /id="posCustomerMoreToggle"/);
  assert.match(pos, /id="posHistoryBtn"/);
  assert.match(css, /\.pos-customer-actions[\s\S]*grid-template-columns:\s*1fr\s+1fr/);
});

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
