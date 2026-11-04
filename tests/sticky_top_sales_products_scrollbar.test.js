'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const sales=read('sales.html'),products=read('products.html'),css=read('style.html');

test('Sales puts a focusable fixed scroll track above its pinned heading',()=>{
  assert.match(sales,/function smEnsurePinnedTopScrollbar_\s*\(/);
  assert.match(sales,/pinnedBar\.id\s*=\s*['"]smPinnedTopScroll['"]/);
  assert.match(sales,/pinnedBar\.tabIndex\s*=\s*0/);
  assert.match(sales,/pinnedBar\.addEventListener\(['"]scroll['"]/);
  assert.match(sales,/pinned\.style\.top\s*=\s*Math\.round\(contentRect\.top\s*\+\s*barHeight\)/);
});
test('Sales fixed slider syncs with both table and existing top track',()=>{
  assert.match(sales,/tableScroll\.scrollLeft\s*=\s*pinnedBar\.scrollLeft/);
  assert.match(sales,/pinnedBar\.scrollLeft\s*=\s*tableScroll\.scrollLeft/);
  assert.match(sales,/pinnedBar\.hidden\s*=\s*!\(shouldPin\s*&&\s*hasOverflow\)/);
  assert.match(sales,/top\.scrollLeft\s*=\s*tableScroll\.scrollLeft/);
});
test('Products has normal and fixed sliders, focusable, above fixed heading',()=>{
  assert.match(products,/id="prodTopScroll"/);
  assert.match(products,/id="prodTopScrollInner"/);
  assert.match(products,/function prodSyncTopScrollbar_\s*\(/);
  assert.match(products,/function prodEnsurePinnedTopScrollbar_\s*\(/);
  assert.match(products,/pinnedBar\.id\s*=\s*['"]prodPinnedTopScroll['"]/);
  assert.match(products,/pinnedBar\.tabIndex\s*=\s*0/);
  assert.match(products,/pinned\.style\.top\s*=\s*Math\.round\(contentRect\.top\s*\+\s*barHeight\)/);
});
test('Products fixed, inline and table scrolls synchronize both ways',()=>{
  assert.match(products,/tableScroll\.scrollLeft\s*=\s*pinnedBar\.scrollLeft/);
  assert.match(products,/pinnedBar\.scrollLeft\s*=\s*tableScroll\.scrollLeft/);
  assert.match(products,/wrap\.scrollLeft\s*=\s*top\.scrollLeft/);
  assert.match(products,/top\.scrollLeft\s*=\s*tableScroll\.scrollLeft/);
  assert.match(products,/pinnedBar\.hidden\s*=\s*!\(shouldPin\s*&&\s*hasOverflow\)/);
});
test('Native track is styled and hidden on phones and in print',()=>{
  assert.match(css,/\.erp-pinned-table-scrollbar\s*\{[^}]*position:\s*fixed;[^}]*overflow-x:\s*auto;/s);
  assert.match(css,/\.erp-pinned-table-scrollbar\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
  assert.match(css,/@media screen and \(max-width:\s*540px\)[^{]*\{\s*\.erp-pinned-table-scrollbar\s*\{\s*display:\s*none\s*!important;/s);
  assert.match(css,/@media print\s*\{\s*\.erp-pinned-table-scrollbar\s*\{\s*display:\s*none\s*!important;/s);
});
