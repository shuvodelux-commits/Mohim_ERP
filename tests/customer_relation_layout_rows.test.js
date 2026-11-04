'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const pos=read('pos.html');
const css=read('posv2.html');
const cust=read('customers.html');

test('POS optional relation and address occupy independent full-width rows',()=>{
  const start=pos.indexOf('<div id="posCustomerMoreFields"');
  const end=pos.indexOf('<div class="pos-customer-actions">',start);
  assert.ok(start>=0 && end>start);
  const markup=pos.slice(start,end);
  assert.match(markup,/<div class="pos-customer-extra-field">[\s\S]*?id="posCustomerRelationType"[\s\S]*?id="posCustomerFatherName"[\s\S]*?<\/div>\s*<\/div>\s*<div class="pos-customer-extra-field">[\s\S]*?id="posCustomerAddress"/);
  const rules=css.match(/\/\* POS customer optional fields: always visible, cart stable \*\/[\s\S]*?<\/style>/)?.[0];
  assert.ok(rules);
  assert.match(rules,/body\.pos-v2-active #page-pos \.pos-customer-more-fields\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s);
});
test('POS Father/Husband selector and name are on one compact row, with space for either option',()=>{
  assert.match(css,/\.pos-customer-relation-entry\s*\{[^}]*grid-template-columns:\s*112px minmax\(0,\s*1fr\);/s);
  assert.match(css,/\.pos-customer-relation-entry select,[\s\S]*?height:\s*36px;/);
  assert.match(pos,/id="posCustomerRelationNameLabel"/);
  assert.match(pos,/id="posCustomerRelationType"/);
  assert.match(pos,/id="posCustomerFatherName"/);
  assert.match(pos,/id="posCustomerAddress"/);
});
test('Add/Edit Customer uses the same full-width two-row relation + address layout',()=>{
  const first=cust.indexOf('id="custRelationNameLabel"');
  const address=cust.indexOf('id="custAddress"');
  const phone=cust.indexOf('id="custPhone"');
  assert.ok(first>0&&address>first&&phone>address,'relation first, address directly underneath, then other customer fields');
  assert.match(cust,/<div class="full">\s*<label for="custFatherName"/);
  assert.match(cust,/<div class="full">\s*<label for="custAddress"/);
  assert.match(cust,/#custModal \.cust-relation-entry select\s*\{[^}]*flex:0 0 112px;/s);
  assert.match(cust,/#custModal \.cust-relation-entry input\s*\{[^}]*flex:1 1 auto;[^}]*min-width:0;/s);
});
