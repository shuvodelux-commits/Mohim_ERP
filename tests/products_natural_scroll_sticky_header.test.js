'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const html=read('products.html'),css=read('style.html');
test('Products list uses outer page scrolling with no height-limited inner row viewport',()=>{
  assert.match(html,/class="table-scroll" id="prodTableScroll"/);
  assert.match(css,/#page-products #prodTableScroll\s*\{[^}]*max-height:\s*none\s*!important;[^}]*overflow-y:\s*hidden;[^}]*overflow-x:\s*auto;/s);
  assert.match(html,/id="prodTable" class="mobile-card-table erp-action-table"/);
});
test('Products heading pins below topbar only after the original has scrolled away',()=>{
  assert.match(html,/function prodSyncPinnedHeader_\(refreshColumns\)/);
  assert.match(html,/originalHeader\.getBoundingClientRect\(\)/);
  assert.match(html,/tableRect\.bottom\s*>\s*contentRect\.top/);
  assert.match(html,/pinned\.hidden\s*=\s*!shouldPin/);
  assert.match(html,/prodPage\.hidden/);
});
test('Products cloned heading keeps sort affordances and matches horizontal scrolling',()=>{
  assert.match(html,/clonedHead\s*=\s*originalHeader\.cloneNode\(true\)/);
  assert.match(html,/removeAttribute\('id'\)/);
  assert.match(html,/pinned\.scrollLeft\s*=\s*tableScroll\.scrollLeft/);
  assert.match(html,/pinned\.addEventListener\('click'/);
  assert.match(html,/prodSortKey_\(sortButton\.dataset\.sortKey\)/);
});
test('Products Actions is rightmost, pinned and a compact accessible three-dot trigger',()=>{
  assert.match(html,/<th class="erp-sticky-action-col" scope="col">Actions<\/th>/);
  assert.match(html,/rowActionTriggerHtml_\(/);
  assert.match(html,/data-act="menu"/);
  assert.doesNotMatch(html,/Actions &#9662;/);
  assert.match(css,/#page-products #prodTable th\.erp-sticky-action-col,[\s\S]*#page-products #prodTable td\.erp-sticky-action-col/);
});
test('Products pinned heading not shown on phones, prints or other pages',()=>{
  assert.match(css,/\.prod-pinned-header\s*\{[^}]*position:\s*fixed;/s);
  assert.match(css,/@media screen and \(max-width:\s*540px\)[^{]*\{\s*\.prod-pinned-header\s*\{\s*display:\s*none\s*!important;/s);
  assert.match(css,/@media print\s*\{\s*\.prod-pinned-header\s*\{\s*display:\s*none\s*!important;/s);
});
