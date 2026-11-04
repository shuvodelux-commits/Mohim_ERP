'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const test=require('node:test');
const root=path.join(__dirname,'..');
const css=fs.readFileSync(path.join(root,'style.html'),'utf8');
const sales=fs.readFileSync(path.join(root,'sales.html'),'utf8');

test('sales list preserves scroll wrapper, 11 labeled columns and existing horizontal scroll sync',()=>{
  assert.match(sales,/id="smTableScroll"/);
  assert.match(sales,/id="smTopScroll"/);
  for(const heading of ['Invoice','Date','Customer','Phone','Total','Paid','Due','Returned','Profit','Status']){
    assert.match(sales,new RegExp('<th[^>]*>\\s*'+heading+'\\s*<\\/th>'));
  }
  assert.match(sales,/smTopScrollSyncing_/);
  assert.match(sales,/<th class="erp-sticky-action-col"[^>]*>[\s\S]*?Actions<\/th>/);
});

test('all scroll-wrapped table heading cells stick to the bounded scroll container',()=>{
  assert.match(css,/\.table-scroll\s*\{\s*overflow-x:\s*auto/);
  assert.match(css,/\.table-scroll\s*>\s*table\s*>\s*thead\s*>\s*tr\s*>\s*th\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;/s);
  assert.match(css,/@media\s+screen\s+and\s*\(min-width:\s*541px\)\s*\{\s*\.table-scroll\s*\{[^}]*max-height:\s*clamp\([^;]*\);[^}]*overflow-y:\s*auto;/s);
  assert.match(css,/background:\s*var\(--color-surface\)/);
});

test('mobile card tables avoid nested vertical scrolling and keep their field labels',()=>{
  assert.match(css,/@media\s+screen\s+and\s*\(max-width:\s*540px\)[\s\S]*\.table-scroll:has\(>\s*table:not\(\.mobile-card-table\)\)/);
  assert.match(css,/\.mobile-card-table thead\s*\{\s*display:\s*none/);
  assert.match(css,/\.mobile-card-table tbody td::before\s*\{[^}]*attr\(data-label\)/);
});

test('print flows are unclipped and header cells reset to normal table layout',()=>{
  assert.match(css,/@media print\s*\{\s*\.table-scroll\s*\{\s*max-height:\s*none\s*!important;\s*overflow:\s*visible\s*!important/);
  assert.match(css,/@media print[\s\S]*\.table-scroll\s*>\s*table\s*>\s*thead\s*>\s*tr\s*>\s*th\s*\{\s*position:\s*static;/);
});
