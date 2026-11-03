'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const plain=x=>JSON.parse(JSON.stringify(x));
function paymentKernel(){const ctx=vm.createContext({});vm.runInContext(read('SalePayments.gs'),ctx);return ctx;}
const p=(method,applied,bankAccountId='',change=0)=>({method,applied,bankAccountId,tendered:applied+change,change});
test('Phase 5: pure per-account deltas reconcile Cash, bank and mobile without counting change',()=>{
 const c=paymentKernel();
 const old=[p('Cash',50,'',30),p('Bank',30,'B1'),p('Mobile Banking',20,'M1')];
 const next=[p('Cash',20),p('Bank',50,'B1'),p('Bank',5,'B2'),p('Mobile Banking',0,'M1')];
 const delta=plain(c.salePaymentAccountDeltas_(old,next));
 assert.deepEqual(delta,[
  {method:'Bank',accountId:'B1',amount:20},
  {method:'Bank',accountId:'B2',amount:5},
  {method:'Cash',accountId:'',amount:-30},
  {method:'Mobile Banking',accountId:'M1',amount:-20}
 ]);
 assert.equal(delta.reduce((sum,x)=>sum+Math.round(x.amount*100),0),-2500);
});
test('Phase 5: exact-paisa deltas never drift and zero changes are omitted',()=>{
 const c=paymentKernel();
 const d=plain(c.salePaymentAccountDeltas_([p('Cash',0.1),p('Bank',0.2,'B1')],[p('Cash',0.2),p('Bank',0.1,'B1')]));
 assert.deepEqual(d,[{method:'Bank',accountId:'B1',amount:-0.1},{method:'Cash',accountId:'',amount:0.1}]);
 assert.deepEqual(plain(c.salePaymentAccountDeltas_([p('Cash',0)],[p('Cash',0)])),[]);
});
test('Phase 5: payment evidence checks all sale/Sale Update book movements against original applied rows',()=>{
 const c=paymentKernel(),invoice='INV-1';
 const payments=[p('Cash',40,'',20),p('Bank',50,'B1'),p('Mobile Banking',10,'M1')];
 const cash=[{Reference:invoice,Type:'Sale',Credit:30},{Reference:invoice,Type:'Sale Update',Credit:10}];
 const bank=[{Reference:invoice,Type:'Sale','Bank Account ID':'B1',Credit:60,Status:'Active'},
   {Reference:invoice,Type:'Sale Update','Bank Account ID':'B1',Debit:10,Status:'Active'},
   {Reference:invoice,Type:'Sale','Bank Account ID':'M1',Credit:10,Status:'Active'}];
 assert.doesNotThrow(()=>c.assertSalePaymentBookEvidence_(invoice,payments,cash,bank));
 assert.throws(()=>c.assertSalePaymentBookEvidence_(invoice,payments,cash,bank.slice(1)),/mismatch|integrity/i);
 assert.throws(()=>c.assertSalePaymentBookEvidence_(invoice,payments,cash.map(x=>({...x,Credit:100})),bank),/mismatch|integrity/i);
 assert.doesNotThrow(()=>c.assertSalePaymentBookEvidence_(invoice,payments,[...cash,{Reference:invoice,Type:'Sale',Credit:50,'Is Deleted':'TRUE'}],
 [...bank,{Reference:invoice,Type:'Sale',Credit:99,'Bank Account ID':'B1',Status:'Reversed'}]));
});
test('Phase 5: split-customer cash-backed provenance uses applied totals, not header Multiple or tender/change',()=>{
 const s=read('CustomerSettlement.gs');
 assert.match(s,/function customerSaleCheckoutCashCollected_/);
 assert.match(s,/readSalePaymentBreakdown_/);
 assert.match(s,/function customerInvoiceCashCollected_[\s\S]*?customerSaleCheckoutCashCollected_/);
 assert.match(s,/cashCollected:[\s\S]*?customerSaleCheckoutCashCollected_/);
});
test('Phase 5: deleting and editing a split invoice must not flatten payments into one account',()=>{
 const edit=read('SalesManagement.gs'),del=read('DeleteEngine.gs');
 assert.match(edit,/salePaymentAccountDeltas_/);
 assert.match(edit,/SALE_PAYMENTS/);
 assert.match(del,/assertSalePaymentBookEvidence_/);
 assert.match(del,/SALE_PAYMENTS/);
});
