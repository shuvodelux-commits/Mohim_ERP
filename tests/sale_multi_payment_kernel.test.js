'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = () => fs.readFileSync(path.join(__dirname, '..', 'SalePayments.gs'), 'utf8');
const accounts = [
  {'Bank Account ID':'B1','Account Name':'DBBL','Account Type':'Bank','Status':'Active'},
  {'Bank Account ID':'B2','Account Name':'IBBL','Account Type':'Bank','Status':'Active'},
  {'Bank Account ID':'M1','Account Name':'bKash Merchant','Account Type':'Mobile Banking','Status':'Active'},
  {'Bank Account ID':'INACTIVE','Account Name':'Old Account','Account Type':'Bank','Status':'Inactive'}
];
const row=(id,method,amount,accountId='')=>({id,method,amount,accountId});
const plain=value=>JSON.parse(JSON.stringify(value));
function load() {
  const context=vm.createContext({});
  vm.runInContext(source(), context, {filename:'SalePayments.gs'});
  return context;
}
function allocate(total,rows,bankAccounts=accounts) {
  return plain(load().normalizeSalePayments_(total,rows,bankAccounts));
}

test('split Cash + Bank + Mobile pays one invoice without duplicating customer due',()=>{
  const result=allocate(10000,[row('a','Cash','4000'),row('b','Bank','3500','B1'),row('c','Mobile Banking','500','M1')]);
  assert.equal(result.paidAmount,8000);
  assert.equal(result.dueAmount,2000);
  assert.equal(result.changeAmount,0);
  assert.equal(result.paymentType,'Partial');
  assert.equal(result.paymentStatus,'Partial');
  assert.equal(result.paymentMethod,'Multiple');
  assert.equal(result.bankAccountId,'');
  assert.deepEqual(result.payments.map(p=>({method:p.method,account:p.bankAccountId,applied:p.applied})),[
    {method:'Cash',account:'',applied:4000},
    {method:'Bank',account:'B1',applied:3500},
    {method:'Mobile Banking',account:'M1',applied:500}
  ]);
});

test('cash change is tender minus applied, bank is never converted into change',()=>{
  const result=allocate(10000,[row('a','Cash','8000'),row('b','Bank','5000','B1')]);
  assert.equal(result.paidAmount,10000);
  assert.equal(result.dueAmount,0);
  assert.equal(result.changeAmount,3000);
  assert.equal(result.paymentStatus,'Paid');
  assert.deepEqual(result.payments.map(p=>({applied:p.applied,tendered:p.tendered,change:p.change})),[
    {applied:5000,tendered:8000,change:3000},
    {applied:5000,tendered:5000,change:0}
  ]);
  assert.throws(()=>allocate(10000,[row('a','Bank','10000.01','B1')]),/exceeds|overpay|total/i);
});

test('legacy payment-type semantics and full-due sales remain intact',()=>{
  const paid=allocate(100,[row('a','Mobile Banking','100','M1')]);
  assert.equal(paid.paymentType,'Cash'); // Legacy enum = fully paid, NOT cash tender.
  assert.equal(paid.paymentMethod,'Mobile Banking');
  assert.equal(paid.bankAccountId,'M1');
  const due=allocate(100,[row('a','Cash','0')]);
  assert.deepEqual(due.payments,[]);
  assert.equal(due.paymentStatus,'Due');
  assert.equal(due.dueAmount,100);
  assert.equal(due.paymentMethod,'');
  const free=allocate(0,[row('a','Cash','')]);
  assert.deepEqual(free.payments,[]);
  assert.equal(free.paymentStatus,'Paid');
  assert.equal(free.paidAmount,0);
});

test('paisa arithmetic stays exact for small amounts and Remaining payments',()=>{
  const result=allocate('0.30',[row('a','Cash','0.10'),row('b','Bank','0.20','B1')]);
  assert.equal(result.paidAmount,0.3);
  assert.equal(result.dueAmount,0);
  assert.deepEqual(result.payments.map(p=>p.applied),[0.1,0.2]);
  assert.equal(result.changeAmount,0);
});

test('bad money and unsupported methods must be rejected before any posting',()=>{
  for(const invalid of ['-1','1.234','1e2','1junk','NaN','Infinity','..2']) {
    assert.throws(()=>allocate(100,[row('a','Cash',invalid)]),undefined,'invalid amount '+invalid);
  }
  for(const invalid of [NaN,Infinity,-1,'NaN','1.001']) {
    assert.throws(()=>allocate(invalid,[]),undefined,'invalid invoice total '+String(invalid));
  }
  assert.throws(()=>allocate(100,[row('a','Card','10')]),/method/i);
  assert.throws(()=>allocate(100,[row('a','Bank','20','')]),/account/i);
  assert.throws(()=>allocate(100,[row('a','Cash','10','B1')]),/account/i);
  assert.throws(()=>allocate(100,[row('a','Bank','20','M1')]),/account|type/i);
  assert.throws(()=>allocate(100,[row('a','Mobile Banking','20','B1')]),/account|type/i);
  assert.throws(()=>allocate(100,[row('a','Bank','20','INACTIVE')]),/active|account/i);
  assert.throws(()=>allocate(100,[row('a','Cash','10'),row('a','Bank','10','B1')]),/duplicate/i);
  assert.throws(()=>allocate(100,[row('a','Cash','10'),row('b','Cash','10')]),/one cash|cash.*row/i);
});

test('no payments are created for blank/zero rows; account selection is required only for positive bank payment',()=>{
  const result=allocate(75,[row('a','Cash',''),row('b','Bank','0',''),row('c','Mobile Banking','25','M1')]);
  assert.deepEqual(result.payments.map(p=>p.rowId),['c']);
  assert.equal(result.paidAmount,25);
  assert.equal(result.dueAmount,50);
});

test('readback converts old one-method rows but never hides missing new-format children',()=>{
  const ctx=load();
  const legacy={'Invoice ID':'INV-1','Paid Amount':250,'Payment Method':'','Bank Account ID':'','Payment Detail Version':''};
  const old=plain(ctx.readSalePaymentBreakdown_(legacy,[]));
  assert.equal(old.length,1);
  assert.equal(old[0].method,'Cash');
  assert.equal(old[0].applied,250);
  assert.equal(old[0].legacy,true);
  const oldDue=plain(ctx.readSalePaymentBreakdown_({...legacy,'Paid Amount':0},[]));
  assert.deepEqual(oldDue,[]);
  const modern={...legacy,'Paid Amount':90,'Payment Detail Version':1,'Invoice ID':'INV-2'};
  assert.throws(()=>ctx.readSalePaymentBreakdown_(modern,[]),/missing|integrity/i);
  const rows=[
    {'Invoice ID':'INV-2','Payment ID':'P1','Row Order':1,'Method':'Cash','Applied Amount':40,'Tendered Amount':40,'Status':'Active'},
    {'Invoice ID':'INV-2','Payment ID':'P2','Row Order':2,'Method':'Bank','Bank Account ID':'B1','Applied Amount':50,'Tendered Amount':50,'Status':'Active'},
    {'Invoice ID':'INV-2','Payment ID':'P0','Row Order':1,'Method':'Cash','Applied Amount':10,'Status':'Reversed'}
  ];
  assert.deepEqual(plain(ctx.readSalePaymentBreakdown_(modern,rows)).map(x=>x.applied),[40,50]);
  assert.throws(()=>ctx.readSalePaymentBreakdown_({...modern,'Paid Amount':91},rows),/mismatch|integrity/i);
  assert.deepEqual(plain(ctx.readSalePaymentBreakdown_({...modern,'Paid Amount':0},[])),[]);
});

test('an existing operation cannot be replayed with different payload or during ambiguous writes',()=>{
  const ctx=load();
  assert.equal(ctx.salePostingJournalDecision_(null,'HASH'),'new');
  assert.equal(ctx.salePostingJournalDecision_({'State':'Committed','Payload Hash':'HASH'},'HASH'),'replay');
  assert.equal(ctx.salePostingJournalDecision_({'State':'Writing','Payload Hash':'HASH'},'HASH'),'review');
  assert.equal(ctx.salePostingJournalDecision_({'State':'Needs Review','Payload Hash':'HASH'},'HASH'),'review');
  assert.throws(()=>ctx.salePostingJournalDecision_({'State':'Committed','Payload Hash':'OTHER'},'HASH'),/different|mismatch/i);
});

test('schema is additive and distinguishes new-format fully-Due invoices from legacy records',()=>{
  const cfg=fs.readFileSync(path.join(__dirname,'..','Config.gs'),'utf8');
  assert.match(cfg,/SALE_PAYMENTS:\s*"Sale Payments"/);
  assert.match(cfg,/SALE_POSTING_JOURNAL:\s*"Sale Posting Journal"/);
  assert.match(cfg,/SALE_PAYMENTS:\s*\[[\s\S]*?"Payment ID"[\s\S]*?"Invoice ID"[\s\S]*?"Applied Amount"[\s\S]*?"Status"/);
  assert.match(cfg,/SALE_POSTING_JOURNAL:\s*\[[\s\S]*?"Operation ID"[\s\S]*?"Payload Hash"[\s\S]*?"State"/);
  assert.match(cfg,/SALES:\s*\[[\s\S]*?"Payment Detail Version"/);
});

test('Cash tender refunded entirely after a bank pays the whole invoice remains receipt metadata only',()=>{
  const result=allocate(100,[row('cash','Cash','40'),row('bank','Bank','100','B1')]);
  assert.equal(result.paidAmount,100);
  assert.equal(result.changeAmount,40);
  assert.deepEqual(result.payments.map(p=>({method:p.method,applied:p.applied,tendered:p.tendered,change:p.change})),[
    {method:'Cash',applied:0,tendered:40,change:40},
    {method:'Bank',applied:100,tendered:100,change:0}
  ]);
});

test('readback ignores unrelated invoices but detects mixed active revision corruption',()=>{
  const ctx=load();
  const sale={'Invoice ID':'INV-22','Paid Amount':40,'Payment Detail Version':1};
  const expected={'Invoice ID':'INV-22','Payment ID':'P1','Row Order':1,'Revision':1,'Method':'Cash',
    'Applied Amount':40,'Tendered Amount':50,'Change Amount':10,'Status':'Active'};
  const unrelated={...expected,'Invoice ID':'INV-99','Payment ID':'P99','Applied Amount':100};
  assert.deepEqual(plain(ctx.readSalePaymentBreakdown_(sale,[unrelated,expected])).map(r=>r.applied),[40]);
  assert.throws(()=>ctx.readSalePaymentBreakdown_(sale,[expected,{...expected,'Payment ID':'P2','Revision':2,'Applied Amount':0,'Tendered Amount':25,'Change Amount':25}]),/revision|integrity/i);
});

test('special JavaScript object-key row IDs cannot bypass duplicate row detection',()=>{
  assert.throws(()=>allocate(100,[row('__proto__','Cash','25'),row('__proto__','Bank','25','B1')]),/duplicate/i);
});
