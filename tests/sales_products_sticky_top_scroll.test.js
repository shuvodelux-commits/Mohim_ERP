'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const sales = read('sales.html');
const products = read('products.html');
const css = read('style.html');

test('Sales reuses its one local top scroll track and pins it above the mirrored heading', () => {
  assert.match(sales, /id="smTopScroll"/);
  assert.match(sales, /id="smTopScrollInner"/);
  assert.equal((sales.match(/id="smTopScroll"/g) || []).length, 1);
  assert.match(sales, /function smSyncTopScrollbar_\(\)/);
  assert.match(sales, /var railHeight = smTopScrollHeight_\(\)/);
  assert.match(sales, /pinned\.style\.top\s*=\s*Math\.round\(contentRect\.top \+ railHeight\) \+ 'px'/);
  assert.match(sales, /tableScroll\.scrollLeft\s*=\s*top\.scrollLeft/);
  assert.match(sales, /top\.scrollLeft\s*=\s*tableScroll\.scrollLeft/);
});

test('Products exposes one matching top track and keeps it synchronized in both directions', () => {
  assert.equal((products.match(/id="prodTopScroll"/g) || []).length, 1);
  assert.equal((products.match(/id="prodTopScrollInner"/g) || []).length, 1);
  assert.match(products, /function prodSyncTopScrollbar_\(\)/);
  assert.match(products, /tableScroll\.scrollWidth - tableScroll\.clientWidth > 1/);
  assert.match(products, /top\.style\.display\s*=\s*hasOverflow\s*\?\s*["']block["']\s*:\s*["']none["']/);
  assert.match(products, /tableScroll\.scrollLeft\s*=\s*top\.scrollLeft/);
  assert.match(products, /top\.scrollLeft\s*=\s*tableScroll\.scrollLeft/);
  assert.match(products, /prodSyncTopScrollbar_\(\)/);
  assert.match(products, /prodWirePinnedHeader_\(\)/);
});

test('Products cloned heading stays directly below the visible top rail', () => {
  assert.match(products, /var railHeight = prodTopScrollHeight_\(\)/);
  assert.match(products, /pinned\.style\.top\s*=\s*Math\.round\(contentRect\.top \+ railHeight\) \+ 'px'/);
  assert.match(products, /function prodSyncPinnedHeader_\(refreshColumns\)/);
  assert.match(products, /pinned\.scrollLeft = tableScroll\.scrollLeft/);
});

test('Sales and Products share a thin native teal scrollbar that stays sticky inside their card', () => {
  assert.match(css, /#page-sales #smTopScroll,\s*#page-products #prodTopScroll\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;/s);
  assert.match(css, /#smTopScroll,\s*#prodTopScroll\s*\{[^}]*scrollbar-color:\s*#[a-fA-F0-9]{6}/s);
  assert.match(css, /#smTopScroll::-webkit-scrollbar-thumb,\s*#prodTopScroll::-webkit-scrollbar-thumb\s*\{[^}]*background:\s*#[a-fA-F0-9]{6}/s);
  assert.match(css, /#page-sales #smTableScroll\s*\{[^}]*overflow-x:\s*auto;/s);
  assert.match(css, /#page-products #prodTableScroll\s*\{[^}]*overflow-x:\s*auto;/s);
});

test('Top scrollbar is suppressed on phones and print; floating bottom scrollbar unchanged', () => {
  assert.match(css, /@media[^{]*max-width:\s*540px[\s\S]*?#smTopScroll,[\s\S]*?#prodTopScroll\s*\{[^}]*display:\s*none\s*!important;/s);
  assert.match(css, /@media print\s*\{\s*#smTopScroll,[\s\S]*?#prodTopScroll\s*\{[^}]*display:\s*none\s*!important;/s);
  assert.match(css, /\.floating-hscroll\s*\{/);
  assert.match(sales, /class="mobile-card-table erp-action-table"/);
  assert.match(products, /class="mobile-card-table erp-action-table"/);
});
