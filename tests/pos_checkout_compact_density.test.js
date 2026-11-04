'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const css = read('posv2.html');
const pos = read('pos.html');
const compact = css.split('/* Approved minimal POS checkout design — UI-only */')[1]?.split('/* POS customer optional fields: always visible, cart stable */')[0] || '';
const optional = css.split('/* POS customer optional fields: always visible, cart stable */')[1] || '';
function has(selector,property,value) {
  const at = compact.lastIndexOf('\n  ' + selector + ' {');
  assert.ok(at !== -1, 'Missing style '+selector);
  const end = compact.indexOf('}',at);
  const body = compact.slice(at,end);
  assert.ok(body.includes(property+':'+value+';'), 'Missing '+property+':'+value+' in '+selector);
}
test('compact customer panel, section title and 36px name/phone fields',()=>{
  has('body.pos-v2-active #page-pos .pos-customer-section','padding','14px 16px 12px');
  has('body.pos-v2-active #page-pos .pos-section-head h3','font-size','15px');
  has('body.pos-v2-active #page-pos .pos-customer-section > .pos-section-head','margin-bottom','9px');
  has('body.pos-v2-active #page-pos .pos-customer-input-wrap','margin-bottom','6px');
  has('body.pos-v2-active #page-pos .pos-customer-input-wrap input','height','36px');
  has('body.pos-v2-active #page-pos .pos-customer-input-wrap input','min-height','36px');
});
test('outstanding due/history and optional fields remain visible in denser layout',()=>{
  has('body.pos-v2-active #page-pos .pos-outstanding-due','margin','8px 0 7px');
  assert.match(optional,/\.pos-customer-more-fields\s*\{[^}]*gap:8px;/);
  assert.match(optional,/\.pos-customer-extra-field label\s*\{[^}]*margin-bottom:3px;/);
  assert.match(optional,/\.pos-customer-more-fields input\s*\{[^}]*height:36px;/);
  assert.doesNotMatch(pos,/id="posCustomerMoreToggle"/);
  assert.match(pos,/id="posCustomerFatherName"/);
  assert.match(pos,/id="posCustomerAddress"/);
});
test('36px discount and payment fields with less vertical spacing',()=>{
  has('body.pos-v2-active #page-pos .pos-checkout-fields > .totals-row:first-child','margin-bottom','10px');
  has('body.pos-v2-active #page-pos #posDiscount','height','36px');
  has('body.pos-v2-active #page-pos .pos-multi-heading','margin','0 0 6px');
  has('body.pos-v2-active #page-pos .pos-multi-title','font-size','14px');
  has('body.pos-v2-active #page-pos #posAddPaymentRowBtn','height','28px');
  has('body.pos-v2-active #page-pos .pos-multi-payment-row','padding','5px 0');
  assert.match(compact,/@container pos-payment \(max-width:510px\)[\s\S]*?padding:6px 0;/);
});
test('compact summary and 40px primary action retain original content',()=>{
  has('body.pos-v2-active #page-pos .pos-multi-totals','gap','6px');
  has('body.pos-v2-active #page-pos .pos-multi-totals','margin-top','7px');
  has('body.pos-v2-active #page-pos .pos-checkout-totals','padding-top','8px');
  has('body.pos-v2-active #page-pos .pos-checkout-totals .totals-row.grand','padding','10px 0 8px');
  has('body.pos-v2-active #page-pos .pos-checkout-totals .totals-row.grand','font-size','18px');
  has('body.pos-v2-active #page-pos .pos-checkout-actions','margin-top','9px');
  has('body.pos-v2-active #page-pos .pos-checkout-actions .btn','height','40px');
  assert.match(pos,/id="posCompleteBtn"/);
  assert.match(pos,/id="posSaveDraftBtn"/);
  assert.match(pos,/id="posMultiDueAmount"/);
});
test('phone padding is compact; POS accounting flag and cart safety remain',()=>{
  assert.match(compact,/@media \(max-width:540px\)\s*\{[^}]*\.pos-customer-section\s*\{[^}]*padding:12px 12px 10px !important;/);
  assert.match(optional,/@media \(min-width:1024px\)\s*\{[\s\S]*?grid-template-rows:max-content minmax\(0, 1fr\);/);
  assert.match(read('Config.gs'),/"POS Multi Payment Enabled": "false"/);
  assert.match(pos,/function posMultiPaymentTerms_\(/);
});
