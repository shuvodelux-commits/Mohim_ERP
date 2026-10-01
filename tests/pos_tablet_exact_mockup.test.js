'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..');
const pos=fs.readFileSync(path.join(root,'pos.html'),'utf8');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'style.html'),'utf8');
let pass=0,fail=0;
function test(n,fn){try{fn();pass++;console.log('PASS',n)}catch(e){fail++;console.error('FAIL',n);console.error(e.stack||e)}}
function mediaBlock(source,query){const start=source.indexOf('@media '+query+' {');assert.notStrictEqual(start,-1,'missing '+query);let i=source.indexOf('{',start),d=0;for(;i<source.length;i++){if(source[i]==='{')d++;else if(source[i]==='}'&&--d===0)return source.slice(start,i+1)}throw new Error('unclosed '+query)}
const tablet=mediaBlock(css,'(min-width: 500px) and (max-width: 1023px)');

test('tablet POS uses the current adaptive product/sale layout',()=>{
  assert.match(tablet,/#page-pos\s+\.pos-layout\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*420px\),\s*1fr\)\)/);
  assert.match(tablet,/#page-pos\.pos-is-stacked\s+\.pos-layout\s*\{\s*grid-template-columns:\s*1fr/);
});
test('cash-session status stays in the global tablet topbar instead of occupying a POS row',()=>{
  assert.match(index,/id="cashSessionToggleBtn"/);
  assert.match(index,/id="cashSessionTopbarStatus"/);
  assert.match(css,/#cashSessionToggleBtn\s*\{[^}]*display:\s*inline-flex/);
  assert.doesNotMatch(pos,/pos-session-compact-row|posSessionCompactBtn/);
  assert.doesNotMatch(tablet,/#page-pos\s+#posSessionBanner\s*\{[^}]*grid-template-columns/);
});
test('recent drafts stay integrated with product search',()=>{
  assert.match(css,/#page-pos\s+\.pos-search-drafts-row\s*\{[^}]*border:\s*1px solid var\(--color-border\)/);
  assert.match(css,/#page-pos\s+\.pos-search-drafts-row\s+\.pos-product-search-box\s+\.search-input\s*\{[^}]*border:\s*0/);
  assert.match(css,/#page-pos\s+\.pos-recent-drafts\s*\{[^}]*border-left:\s*1px solid/);
});
test('customer controls remain compact and bilingual',()=>{
  assert.match(pos,/id="posCustomerName"[^>]*placeholder="Enter customer name — কাস্টমারের নাম"[^>]*aria-label="Customer Name — কাস্টমারের নাম"/);
  assert.match(pos,/id="posCustomerPhone"[^>]*placeholder="Enter phone number — ফোন নম্বর"[^>]*aria-label="Phone Number — ফোন নম্বর"/);
  assert.match(css,/#page-pos\s+\.pos-customer-section\s*>\s*label\s*\{\s*display:\s*none/);
  assert.match(css,/#page-pos\s+\.pos-customer-actions\s+\.btn\s*\{[^}]*min-height:\s*34px/);
});
test('cart exposes product qty unit price total remove columns',()=>{
  assert.match(pos,/class="pos-cart-columns"[^>]*>[\s\S]*Product[\s\S]*Qty[\s\S]*Unit[\s\S]*Price \(৳\)[\s\S]*Total \(৳\)/);
  assert.match(css,/#page-pos\s+\.pos-cart-columns,\s*#page-pos\s+\.cart-row\s*\{[^}]*grid-template-columns:\s*minmax\(140px,\s*1fr\)\s+54px\s+minmax\(42px,\s*max-content\)\s+72px\s+82px\s+28px/);
  assert.match(css,/#page-pos\s+\.cart-row\s+\.c-name-title\s*\{[^}]*overflow-wrap:\s*anywhere/);
});
test('product and cart renderers stay text-only with no thumbnails',()=>{
  const p=pos.slice(pos.indexOf('function posRenderProductGrid_'),pos.indexOf('function posComputeAutoPricing_'));
  const c=pos.slice(pos.indexOf('function posRenderCart_'),pos.indexOf('function posSyncShortagePanel_'));
  assert.doesNotMatch(p,/<img\b/i);assert.doesNotMatch(c,/<img\b/i);
});
console.log(`\n${pass}/${pass+fail} passed`);if(fail)process.exit(1);
