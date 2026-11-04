'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const css=fs.readFileSync(path.join(__dirname,'..','style.html'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'..','sales.html'),'utf8');
test('Sales alone abandons the nested viewport-height vertical table scroll',()=>{
  assert.match(css,/#page-sales\s+#smTableScroll\s*\{[^}]*max-height:\s*none\s*!important;[^}]*overflow-y:\s*hidden;/s);
  assert.doesNotMatch(css,/#page-sales\s+#smTableScroll\s*\{[^}]*max-height:\s*clamp\(/s);
  assert.match(css,/#page-sales\s+#smTableScroll\s*\{[^}]*overflow-x:\s*auto;/s);
});
test('Sales header is pinned only after normal-flow header scrolls under topbar',()=>{
  assert.match(html,/function smSyncPinnedHeader_\(refreshColumns\)/);
  assert.match(html,/originalHeader\.getBoundingClientRect\(\)/);
  assert.match(html,/tableRect\.bottom\s*>\s*contentRect\.top/);
  assert.match(html,/pinned\.hidden\s*=\s*!shouldPin/);
  assert.match(html,/aria-hidden/);
});
test('pinned header tracks horizontal scrolling without duplicating live IDs',()=>{
  assert.match(html,/pinned\.scrollLeft\s*=\s*tableScroll\.scrollLeft/);
  assert.match(html,/cloneNode\(true\)/);
  assert.match(html,/removeAttribute\('id'\)/);
  assert.match(css,/\.sm-pinned-sales-header\s*\{[^}]*position:\s*fixed;/s);
  assert.match(css,/\.sm-pinned-sales-header[^}]*overflow-x:\s*auto;/s);
});
test("Sales header does not obscure mobile cards, printed tables, or other modules",()=>{
  assert.match(css,/@media[^\{]*max-width:\s*540px[^\{]*\{[^}]*\.sm-pinned-sales-header\s*\{[^}]*display:\s*none\s*!important;/s);
  assert.match(css,/@media print\s*\{[^}]*\.sm-pinned-sales-header\s*\{[^}]*display:\s*none\s*!important;/s);
  assert.match(html,/salesPage\.hidden/);
});
