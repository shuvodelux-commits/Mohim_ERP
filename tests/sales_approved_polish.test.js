'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const css=read('style.html'),sales=read('sales.html');
const shell=css.slice(css.indexOf('/* ---------------- Desktop/tablet application shell'),css.indexOf('/* Floating horizontal scrollbar'));
const action=css.slice(css.indexOf('.erp-sticky-action-col {'),css.indexOf('.erp-row-action-trigger {'));
test('desktop and tablet top bar is sticky in normal flow instead of fixed with duplicate top offset',()=>{
  assert.match(shell,/\.topbar\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;/s);
  assert.match(shell,/\.content\s*\{[^}]*margin-top:\s*0;[^}]*overflow-y:\s*auto;/s);
  assert.doesNotMatch(shell,/\.topbar\s*\{[^}]*position:\s*fixed;/s);
});
test('rightmost Actions header has a visible text label instead of extra dots',()=>{
  for(const file of ['sales.html','customerLedger.html','supplierLedger.html','daybook.html']){
    const html=read(file);
    assert.match(html,/<th class="erp-sticky-action-col"[^>]*>Actions<\/th>/,file);
    assert.doesNotMatch(html,/<span class="erp-action-header-dots"/,file);
  }
});
test('pinned actions remain opaque and right-aligned without a shadow or edge divider',()=>{
  assert.match(action,/\.erp-sticky-action-col\s*\{[^}]*right:\s*0;/s);
  assert.match(action,/background:\s*var\(--color-surface\)/);
  assert.match(action,/border-left:\s*0;/);
  assert.match(action,/box-shadow:\s*none;/);
  assert.doesNotMatch(action,/box-shadow:\s*-3px/);
});
test('Sales filters use compact grid instead of flex wrapping at common desktop widths',()=>{
  assert.match(css,/#page-sales\s*>\s*\.toolbar\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:/s);
  assert.match(css,/#page-sales\s*>\s*\.toolbar[^}]*gap:\s*8px/s);
  assert.match(css,/#page-sales[^}]*#smTableScroll\s*\{[^}]*max-height:\s*none/s);
});
test('Sales top horizontal scrollbar is compact and not divided from the header by a second rule',()=>{
  assert.match(sales,/id="smTopScroll"/);
  assert.match(sales,/height:1[02]px/);
  assert.doesNotMatch(sales,/id="smTopScroll"[\s\S]{0,210}border-bottom:1px/);
  assert.match(sales,/function smWireTopScrollbar_\(/);
});
