'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const pos=read('pos.html'),css=read('posv2.html');

test('optional Father Name / Address are always visible and have no expand button',()=>{
  assert.match(pos,/id="posCustomerMoreFields" class="pos-customer-more-fields"/);
  assert.doesNotMatch(pos,/id="posCustomerMoreFields"\s+hidden/);
  assert.doesNotMatch(pos,/id="posCustomerMoreToggle"/);
  assert.match(pos,/id="posCustomerFatherName"/);
  assert.match(pos,/id="posCustomerAddress"/);
  assert.match(pos,/id="posHistoryBtn"/);
});

test('restoring draft or editing invoice never collapses optional customer fields',()=>{
  assert.match(pos,/function posSetCustomerMoreExpanded_\(expanded\)\s*\{[\s\S]*?document\.getElementById\('posCustomerMoreFields'\)\.hidden = false;/);
  assert.doesNotMatch(pos,/document\.getElementById\('posCustomerMoreToggle'\)\.addEventListener/);
  assert.match(pos,/customerFatherName: document\.getElementById\('posCustomerFatherName'\)\.value\.trim\(\)/);
  assert.match(pos,/customerAddress: document\.getElementById\('posCustomerAddress'\)\.value\.trim\(\)/);
});

test('compact two-column optional controls and narrow phone stacking follow approved design',()=>{
  const style=css.split('/* POS customer optional fields: always visible, cart stable */')[1]||'';
  assert.ok(style.length>200);
  assert.match(style,/\.pos-customer-more-fields\s*\{[^}]*display:grid;[^}]*grid-template-columns:repeat\(2,\s*minmax\(0,\s*1fr\)\);/s);
  assert.match(style,/\.pos-customer-more-fields input\s*\{[^}]*height:36px;/s);
  assert.match(style,/@media\s*\(max-width:\s*540px\)[\s\S]*?\.pos-customer-more-fields\s*\{[^}]*grid-template-columns:1fr;/);
});

test('desktop grid tracks prevent tall sticky customer from affecting search or cart row',()=>{
  const style=css.split('/* POS customer optional fields: always visible, cart stable */')[1]||'';
  assert.match(style,/body\.pos-v2-active #page-pos \.pos-layout\s*\{[^}]*grid-template-rows:max-content minmax\(0,\s*1fr\);/s);
  assert.match(css,/grid-template-areas:\s*"search customer"\s*"cart customer"/);
});
