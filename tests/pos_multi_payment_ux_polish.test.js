'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const pos=read('pos.html'),css=read('posv2.html');

test('Cash/Bank/Mobile account HTML has a dedicated reusable row renderer',()=>{
  assert.match(pos,/function posMultiPaymentAccountHtml_\s*\(\s*row\s*,\s*label\s*\)/);
  assert.match(pos,/posMultiPaymentAccountHtml_\(r,\s*label\)/);
  assert.match(pos,/posMultiPaymentAccountHtml_\(row,\s*label\)/);
  assert.match(pos,/Cash drawer/);
  assert.match(pos,/Select account\.\.\./);
});
test('method changes preserve other payment rows instead of rerendering the whole list',()=>{
  const h=pos.match(/document\.getElementById\('posMultiPaymentRows'\)\.addEventListener\('change', function \(event\) \{([\s\S]*?)\n  \}\);/);
  assert.ok(h,'Product payment-change event handler must exist');
  assert.match(h[1],/accountHost\.innerHTML\s*=\s*posMultiPaymentAccountHtml_/);
  assert.doesNotMatch(h[1],/posRenderMultiPaymentRows_\(/);
  assert.match(h[1],/posFocusMultiPaymentField_\(/);
  assert.match(h[1],/posRecalcTotals_\(\)/);
});
test('new payment row and Fill Due preserve correct keyboard focus',()=>{
  assert.match(pos,/posFocusMultiPaymentField_\(id,\s*'method'\)/);
  assert.match(pos,/posFocusMultiPaymentField_\(row\.id,\s*'amount'/);
  assert.match(pos,/function posFocusMultiPaymentField_\(/);
  assert.match(pos,/data-payment-action="remaining"[^>]*>Fill Due<\/button>/);
});
test('remove has real visible SVG icon without removing its accessible name or disabled last row',()=>{
  assert.match(pos,/class="[^"]*pos-multi-remove[^"]*"[^>]*aria-label="Remove /);
  assert.match(pos,/pos-multi-remove[^>]*>[\s\S]*?<svg[\s\S]*?<\/svg><\/button>/);
  assert.match(pos,/posState\.paymentRows\.length < 2 \? ' disabled' : ''/);
});
test('summary identifies applied amount, not ambiguous gross cash tender',()=>{
  assert.match(pos,/<span>Paid Now[^<]*<span class="bn-hint">/);
  assert.match(pos,/id="posMultiPaidAmount"/);
  assert.match(pos,/id="posMultiChangeAmount"/);
  assert.match(pos,/id="posMultiDueAmount"/);
});
test('row heights and typography remain consistent with compact POS inputs and mobile wrapping',()=>{
  assert.match(css,/\.pos-multi-payment-row select,[\s\S]*?\.pos-multi-payment-row input\s*\{[^}]*height:36px;min-height:36px;[^}]*font-size:13px;/);
  assert.match(css,/\.pos-multi-payment-row \.btn\s*\{[^}]*min-height:36px;height:36px;/);
  assert.match(css,/\.pos-multi-payment-row \.pos-multi-remove\s*\{[^}]*color:var\(--pos-v2-danger\);/);
  assert.match(css,/@media \(max-width: 700px\)/);
});
test('feature flag and strict accounting engine still exist unchanged',()=>{
  assert.match(pos,/function posMultiPaymentTerms_\(/);
  assert.match(pos,/function posMultiPaymentOperationId_\(/);
  assert.match(pos,/multiPaymentEnabled:\s*false/);
  assert.match(read('Config.gs'),/"POS Multi Payment Enabled": "false"/);
});
