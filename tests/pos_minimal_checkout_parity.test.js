'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const pos=read('pos.html'),css=read('posv2.html');
const after=css.split('/* Approved minimal POS checkout design — UI-only */')[1]||'';

test('approved minimum customer card design is scoped to POS V2 with white flat panel and 40px inputs',()=>{
  assert.ok(after.length>500,'approved checkout CSS block must be present');
  assert.match(after,/body\.pos-v2-active #page-pos \.pos-customer-section\s*\{[^}]*background:\s*#fff;/s);
  assert.match(after,/body\.pos-v2-active #page-pos \.pos-section-head h3\s*\{[^}]*font-size:\s*16px;/s);
  assert.match(after,/body\.pos-v2-active #page-pos \.pos-customer-input-wrap input\s*\{[^}]*height:\s*40px;[^}]*font-size:\s*13px;/s);
  assert.match(after,/body\.pos-v2-active #page-pos \.pos-customer-actions \.btn\s*\{[^}]*background:\s*transparent;[^}]*border:\s*0;/s);
});
test('discount, payment title, and add control match the approved minimal CSS design',()=>{
  assert.match(after,/#page-pos #posDiscount\s*\{[^}]*width:\s*122px;[^}]*height:\s*36px;/s);
  assert.match(pos,/class="pos-multi-title"[^>]*>Payments/);
  assert.match(pos,/class="pos-multi-subtitle">পেমেন্ট/);
  assert.match(after,/#page-pos #posAddPaymentRowBtn\s*\{[^}]*background:\s*transparent;[^}]*border:\s*0;/s);
});
test('split payment rows are flat 1px divider rows with approved five-field desktop geometry',()=>{
  assert.match(after,/#page-pos \.pos-multi-payment-rows\s*\{[^}]*border-top:\s*1px solid/s);
  assert.match(after,/#page-pos \.pos-multi-payment-row\s*\{[^}]*grid-template-columns:\s*104px minmax\(0,\s*1fr\) 98px 62px 27px;[^}]*background:\s*transparent;[^}]*border-bottom:\s*1px solid/s);
  assert.match(after,/#page-pos \.pos-multi-payment-row \.pos-multi-remaining\s*\{[^}]*background:\s*transparent;[^}]*border:\s*0;/s);
  assert.match(after,/#page-pos \.pos-multi-payment-row \.pos-multi-remove\s*\{[^}]*background:\s*transparent;[^}]*border:\s*0;/s);
  assert.match(after,/body\.pos-v2-active #page-pos \.pos-multi-payment-row select,[\s\S]*?font-size:\s*12\.5px;/);
});
test('container-width media wraps narrow checkout panel at desktop, tablet and phone viewport sizes',()=>{
  assert.match(after,/#page-pos #posMultiPaymentFields\s*\{[^}]*container-type:\s*inline-size;/s);
  assert.match(after,/@container pos-payment \(max-width:\s*510px\)/);
  assert.match(after,/\.pos-multi-payment-row \.pos-multi-amount\s*\{\s*grid-column:\s*1\s*\/\s*3;/);
  assert.match(after,/#page-pos \.pos-checkout-summary\s*\{\s*display:\s*block\s*!important;/);
});
test('subdued summary retains full actual POS state and simple action buttons',()=>{
  assert.match(after,/#page-pos \.pos-checkout-totals\s*\{[^}]*border-top:\s*1px solid/s);
  assert.match(after,/#page-pos \.pos-checkout-totals \.totals-row\.grand\s*\{[^}]*font-size:\s*18px;[^}]*color:\s*var\(--pos-v2-primary\);/s);
  assert.match(after,/#page-pos \.pos-checkout-actions\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1\.85fr\);/s);
  assert.match(after,/#page-pos \.pos-checkout-actions \.btn\s*\{[^}]*height:\s*43px;/s);
  assert.match(pos,/id="posSubtotal"/);
  assert.match(pos,/id="posMultiDueAmount"/);
  assert.match(pos,/id="posCompleteBtn"/);
  assert.match(read('Config.gs'),/"POS Multi Payment Enabled": "false"/);
  assert.match(read('SalePayments.gs'),/function /);
});
