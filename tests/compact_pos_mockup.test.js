'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const pos = read('pos.html');
const index = read('index.html');
const css = read('style.html');
let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('PASS', name); }
  catch (err) { fail++; console.error('FAIL', name); console.error(err.stack || err); }
}

test('POS keeps compact customer, product and cart sections after Cash Session moves global', () => {
  for (const hook of ['pos-customer-section','pos-product-card','pos-cart-section']) {
    assert.match(pos, new RegExp(hook), 'missing ' + hook);
  }
  assert.doesNotMatch(pos, /pos-session-compact-row|posSessionCompactBtn/);
  assert.match(pos, /id="posClearCustomerBtn"/);
  assert.match(pos, /id="posCartCount"/);
  assert.match(pos, /id="posClearCartBtn"/);
});

test('mobile Add Product is search-first with category and brand filters', () => {
  assert.match(pos, /id="posCategoryFilter"/);
  assert.match(pos, /id="posBrandFilter"/);
  assert.match(pos, /function\s+posFillProductFilters_\s*\(/);
  assert.match(pos, /posCategoryFilter/);
  assert.match(pos, /posBrandFilter/);
  assert.match(pos, /mobile-search-idle/);
  assert.match(css, /#page-pos[\s\S]*\.product-grid\.mobile-search-idle[\s\S]*display:\s*none/);
});

test('mobile POS reorders customer then Add Product then cart and uses compact controls', () => {
  assert.match(css, /@media\s*\(max-width:\s*540px\)[\s\S]*\.pos-sale-card\s*\{\s*display:\s*contents/);
  assert.match(css, /\.pos-customer-section[\s\S]*order:\s*1/);
  assert.match(css, /\.pos-product-card[\s\S]*order:\s*2/);
  assert.match(css, /\.pos-cart-section[\s\S]*order:\s*3/);
  assert.match(css, /\.pos-customer-input-wrap input[\s\S]*min-height:\s*44px/);
  assert.match(css, /\.cart-row[\s\S]*padding:\s*10px/);
  assert.match(css, /\.cart-row \.c-qty-wrap input,[\s\S]*min-height:\s*42px/);
});

test('cash session uses a global topbar trigger and keeps details inside a shared modal', () => {
  assert.match(index, /id="cashSessionToggleBtn"/);
  assert.match(index, /id="cashSessionTopbarStatus"/);
  assert.match(index, /id="posSessionModal"/);
  assert.match(index, /id="posSessionBanner"/);
  assert.match(index, /id="posNoSessionCard"/);
  assert.match(index, /id="posCloseSessionBtn"/);
  assert.doesNotMatch(pos, /posSessionCompactBtn|pos-session-compact-row/);
  assert.match(css, /#cashSessionToggleBtn[\s\S]*display:\s*inline-flex/);
  assert.match(css, /#posSessionModal[\s\S]*\.session-mobile-metrics[\s\S]*grid-template-columns:\s*repeat\(2/);
});

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
