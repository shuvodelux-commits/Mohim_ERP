'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','FundedReturnJournal.gs'),'utf8');
function runtime(){
 const c={console,Date,Number,Object,Math,JSON,BigInt,
  Utilities:{DigestAlgorithm:{SHA_256:'SHA_256'},computeDigest:(algo,text)=>{
   return [...crypto.createHash('sha256').update(text).digest()].map(b=>b>127?b-256:b);
  }}};
 vm.createContext(c);vm.runInContext(src,c);return c;
}
const intent=()=>({
 operationId:'FUNDED-RETURN-20261120-0001',actor:'USR-1',
 invoiceId:'INV-1',customerId:'CUS-1',date:'2026-11-20',
 backdatedReason:'',refundMethod:'Cash',refundAmount:500,
 reason:'Customer returned',notes:'checked',
 lines:[{productId:'P1',sourceSaleProductId:'P1',
   quantity:5,quantityScale:1000000,returnUnitPrice:100}]
});
test('canonical source-bound SHA-256 identifies the entire authorized refund',()=>{
 const c=runtime(),i=intent(),hash=c.buildFundedReturnIntentHash_(i);
 assert.match(hash,/^sha256:[a-f0-9]{64}$/);
 assert.equal(c.buildFundedReturnIntentHash_(structuredClone(i)),hash);
});
test('changed customer, actor, original invoice, date, refund method/amount, and return price require a new intent',()=>{
 const c=runtime(),base=intent(),first=c.buildFundedReturnIntentHash_(base);
 for(const [key,val] of [['actor','USR-2'],['invoiceId','INV-2'],['customerId','CUS-2'],
   ['operationId','FUNDED-RETURN-20261120-0002'],['date','2026-11-21'],
   ['refundMethod','Store Credit'],['refundAmount',501],['notes','other'],
   ['reason','quality']]){
   const i=structuredClone(base);i[key]=val;
   assert.notEqual(c.buildFundedReturnIntentHash_(i),first,key);
 }
 for(const [key,val] of [['productId','P2'],['sourceSaleProductId','BUNDLE-1'],
   ['quantity',4],['returnUnitPrice',99]]){
   const i=structuredClone(base);i.lines[0][key]=val;
   assert.notEqual(c.buildFundedReturnIntentHash_(i),first,key);
 }
});
test('source verified quantity precision and refund paisa cannot be rounded into a new intent silently',()=>{
 const c=runtime(),i=intent();
 i.refundAmount=500.001;assert.throws(()=>c.buildFundedReturnIntentHash_(i),/precision|paisa|money/i);
 i.refundAmount=500;i.lines[0].quantity=5.0000001;
 assert.throws(()=>c.buildFundedReturnIntentHash_(i),/quantity|precision/i);
 i.lines[0].quantity=5;i.lines[0].returnUnitPrice=100.009;
 assert.throws(()=>c.buildFundedReturnIntentHash_(i),/precision|price|money/i);
});
test('duplicate product lines, missing source and invalid bank-like refund method are never accepted',()=>{
 const c=runtime(),i=intent();i.lines.push({...i.lines[0]});
 assert.throws(()=>c.buildFundedReturnIntentHash_(i),/duplicate|single/i);
 i.lines=[i.lines[0]];i.lines[0].sourceSaleProductId='';
 assert.throws(()=>c.buildFundedReturnIntentHash_(i),/source/i);
 i.lines[0].sourceSaleProductId='P1';i.refundMethod='Bank';
 assert.throws(()=>c.buildFundedReturnIntentHash_(i),/method/i);
});
