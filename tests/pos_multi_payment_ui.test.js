'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const pos = read('pos.html');
const bootstrap = read('Sales.gs');
const accounts = [
  {id:'B1',name:'DBBL',type:'Bank'},
  {id:'B2',name:'IBBL',type:'Bank'},
  {id:'M1',name:'bKash Merchant',type:'Mobile Banking'}
];
const row = (id,method,amount,accountId='') => ({id,method,amount,accountId});
function pureFunctions() {
  const start=pos.indexOf('  function posMultiPaymentMoneyPaisa_(');
  const stop=pos.indexOf('  function posRenderMultiPaymentRows_(',start);
  assert.ok(start>=0 && stop>start, 'POS multi-payment calculation must be a standalone testable function');
  const context=vm.createContext({});
  vm.runInContext(pos.slice(start,stop),context,{filename:'pos.html payment model'});
  return context;
}
const plain=v=>JSON.parse(JSON.stringify(v));

test('frontend split payment calculation matches the posted amount, due and only-Cash change',()=>{
  const c=pureFunctions();
  const terms=plain(c.posMultiPaymentTerms_('100.00',[
    row('cash','Cash','80'),row('dbbl','Bank','30','B1'),row('bkash','Mobile Banking','10','M1')
  ],accounts));
  assert.equal(terms.paidAmount,100);
  assert.equal(terms.dueAmount,0);
  assert.equal(terms.change,20);
  assert.equal(terms.paymentType,'Cash'); // existing enum means fully settled
  assert.deepEqual(terms.payments,[
    {id:'cash',method:'Cash',amount:'80',accountId:''},
    {id:'dbbl',method:'Bank',amount:'30',accountId:'B1'},
    {id:'bkash',method:'Mobile Banking',amount:'10',accountId:'M1'}
  ]);
});

test('split checkout shows remaining due, exact fractional amounts and an empty-cash full-due sale',()=>{
  const c=pureFunctions();
  const terms=plain(c.posMultiPaymentTerms_('0.30',[
    row('c','Cash','0.10'),row('b','Bank','0.05','B1')
  ],accounts));
  assert.equal(terms.paidAmount,0.15);
  assert.equal(terms.dueAmount,0.15);
  assert.equal(terms.change,0);
  assert.equal(terms.paymentType,'Partial');
  assert.equal(c.posMultiPaymentTerms_('90',[row('c','Cash','')],accounts).dueAmount,90);
  assert.equal(c.posMultiPaymentTerms_('90',[row('c','Cash','0')],accounts).paidAmount,0);
});

test('Remaining only fills the chosen row without changing other payment amounts',()=>{
  const c=pureFunctions();
  const rows=[row('cash','Cash','20'),row('bank','Bank','40','B1'),row('mobile','Mobile Banking','','M1')];
  const amount=c.posMultiPaymentRemaining_('100',rows,'mobile');
  assert.equal(amount,'40.00');
  assert.equal(rows[0].amount,'20');
  assert.equal(rows[1].amount,'40');
  assert.equal(rows[2].amount,'');
  assert.equal(c.posMultiPaymentRemaining_('100',[row('cash','Cash','80'),row('bank','Bank','40','B1')],'cash'),'60.00');
});

test('strict input validation rejects invalid money and accounts before showing confirmation',()=>{
  const c=pureFunctions();
  for(const bad of ['-1','1.234','1e2','8junk','Infinity','NaN']) {
    assert.throws(()=>c.posMultiPaymentTerms_('100',[row('cash','Cash',bad)],accounts),undefined,bad);
  }
  assert.throws(()=>c.posMultiPaymentTerms_('100',[row('bank','Bank','40','')],accounts),/account/i);
  assert.throws(()=>c.posMultiPaymentTerms_('100',[row('bad','Mobile Banking','30','B1')],accounts),/account|type/i);
  assert.throws(()=>c.posMultiPaymentTerms_('100',[row('bank','Bank','110','B1')],accounts),/exceed|overpay/i);
  assert.throws(()=>c.posMultiPaymentTerms_('100',[row('c','Cash','20'),row('c2','Cash','20')],accounts),/one cash/i);
  assert.throws(()=>c.posMultiPaymentTerms_('100',[row('b','Bank','10','B1'),row('b','Bank','10','B2')],accounts),/duplicate/i);
});

test('confirmation identifies each payment/account plus change, total paid and due',()=>{
  const c=pureFunctions();
  const terms=c.posMultiPaymentTerms_('100',[
    row('c','Cash','60'),row('b','Bank','30','B1'),row('m','Mobile Banking','20','M1')
  ],accounts);
  const details=plain(c.posMultiPaymentConfirmationDetails_(terms,accounts));
  assert.ok(details.some(x=>x.label==='Cash' && /60/.test(x.value)));
  assert.ok(details.some(x=>/DBBL/.test(x.label) && /30/.test(x.value)));
  assert.ok(details.some(x=>/bKash Merchant/.test(x.label) && /20/.test(x.value)));
  assert.ok(details.some(x=>/Change/.test(x.label) && /10/.test(x.value)));
  assert.ok(details.some(x=>/Total Received|Paid Now/.test(x.label) && /100/.test(x.value)));
  assert.ok(details.some(x=>x.label==='Due' && /0/.test(x.value)));
});

test('markup and bootstrap keep existing single-payment fields and gate the new UI',()=>{
  assert.match(pos,/id="posAmountReceived"/);
  assert.match(pos,/id="posPaymentMethod"/);
  assert.match(pos,/id="posBankAccount"/);
  assert.match(pos,/id="posMultiPaymentFields"[^>]*hidden/);
  assert.match(pos,/id="posMultiPaymentRows"/);
  assert.match(pos,/id="posAddPaymentRowBtn"/);
  assert.match(pos,/id="posMultiPaidAmount"/);
  assert.match(pos,/id="posMultiDueAmount"/);
  assert.match(pos,/posState\.multiPaymentEnabled\s*=\s*!!data\.multiPaymentEnabled/);
  assert.match(bootstrap,/multiPaymentEnabled:\s*String\(settings\['POS Multi Payment Enabled'\]/);
  assert.match(read('Config.gs'),/"POS Multi Payment Enabled": "false"/);
});

test('new-sale payload has stable operation ID; legacy/draft/update paths cannot silently become split-payments',()=>{
  assert.match(pos,/payload\.payments\s*=\s*posMultiPaymentPayloadRows_\(/);
  assert.match(pos,/payload\.operationId\s*=\s*posMultiPaymentOperationId_\(/);
  assert.match(pos,/posMultiPaymentEnabledForSale_\(/);
  assert.match(pos,/posMultiPaymentConfirmDetails|posMultiPaymentConfirmationDetails_\(/);
  assert.match(pos,/posState\.paymentOperationId/);
  assert.match(pos,/if \(posMultiPaymentEnabledForSale_\(\)\)\s*\{/);
  assert.match(pos,/isUpdate\s*\?\s*serverCall\('updateSale'/);
});
