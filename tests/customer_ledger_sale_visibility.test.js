'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'..','PartyLedger.gs'),'utf8');
function fixture(options={}){
 const sales=(options.sales||[]).map((r,i)=>Object.assign({
  _rowIndex:i+2,'Invoice ID':'INV-'+(i+1),Date:'2026-11-04',
  'Customer ID':'C1','Customer Name':'Customer One',
  'Grand Total':0,'Paid Amount':0,'Due Amount':0,'Payment Status':'Paid',
  'Created At':'2026-11-04T08:00:00','Is Deleted':''
 },r));
 const raw=options.raw||[];
 const ctx={
  console,
  roundMoney_:v=>Math.round((Number(v)||0)*100)/100,
  safeDateOnly_:v=>String(v||'').slice(0,10),
  isDeleted_:r=>String(r&&r['Is Deleted']||'').toUpperCase()==='TRUE',
  serializeCellValue_:v=>v,
  sanitizeInput_:v=>String(v||'').trim(),
  Utilities:{Charset:{UTF_8:'UTF-8'},base64EncodeWebSafe:v=>Buffer.from(String(v)).toString('base64url'),
   base64DecodeWebSafe:v=>Array.from(Buffer.from(String(v),'base64url')),
   newBlob:bytes=>({getDataAsString:()=>Buffer.from(bytes).toString()})}
 };
 vm.createContext(ctx);
 vm.runInContext(src,ctx,{filename:'PartyLedger.gs'});
 ctx.partyLedgerBuildAscendingIndex_=(kind,party)=>raw.filter(r=>String(r['Customer ID'])===String(party)).map(r=>Object.assign({},r));
 ctx.partyLedgerSourceDateMap_=()=>({});
 ctx._realCustomerSaleIndex_=ctx.partyLedgerCustomerSaleIndex_;
 ctx.partyLedgerCustomerSaleIndex_=party=>sales.filter(r=>String(r['Customer ID'])===String(party)&&!ctx.isDeleted_(r));
 return {ctx,sales,raw};
}
function ledger(index,type,ref,debit,credit,customer='C1',date='2026-11-04'){
 return {_rowIndex:index,'Ledger ID':'CL-'+index,Date:date,'Customer ID':customer,
  'Customer Name':'Customer One',Type:type,Reference:ref,
  Debit:debit||'',Credit:credit||'','Created At':date+'T10:00:00','Is Deleted':''};
}
test('linked fully paid Cash sale appears once with invoice amount and paid amount; no due',()=>{
 const f=fixture({sales:[{'Invoice ID':'INV-PAID','Grand Total':100,'Paid Amount':100,'Due Amount':0,'Payment Status':'Paid'}]});
 const x=f.ctx.partyLedgerBuildDisplayIndex_('customer','C1',false);
 assert.equal(x.length,1);
 assert.equal(x[0].Reference,'INV-PAID');
 assert.equal(x[0].Type,'Sale');
 assert.deepEqual([Number(x[0].Debit),Number(x[0].Credit),x[0]._displayBalance],[100,100,0]);
 assert.equal(x[0]._synthetic,true);
 f.ctx.partyLedgerAttachSourceMetadata_('customer',x[0]);
 assert.equal(x[0].sourceId,'INV-PAID');
 assert.equal(x[0].sourceModule,'sales');
});
test('linked multi-payment checkout shows full paid and due amounts without duplicating ledger',()=>{
 const f=fixture({sales:[{'Invoice ID':'INV-SPLIT','Grand Total':300,'Paid Amount':180,'Due Amount':120,'Payment Detail Version':1}],
   raw:[ledger(5,'Sale','INV-SPLIT',120,0)]});
 const x=f.ctx.partyLedgerBuildDisplayIndex_('customer','C1',false);
 assert.equal(x.length,1);assert.deepEqual([x[0].Debit,x[0].Credit,x[0]._displayBalance],[300,180,120]);
});
test('fully due invoice appears, preserving exact receivable amount',()=>{
 const f=fixture({sales:[{'Invoice ID':'INV-DUE','Grand Total':70,'Paid Amount':0,'Due Amount':70}],
  raw:[ledger(5,'Sale','INV-DUE',70,0)]});
 const x=f.ctx.partyLedgerBuildDisplayIndex_('customer','C1',false);
 assert.equal(x.length,1);assert.equal(x[0].Debit,70);
 assert.equal(x[0].Credit,'');assert.equal(x[0]._displayBalance,70);
});
test('later customer payment and sales return remain separate with same ending balance',()=>{
 const f=fixture({sales:[{'Invoice ID':'INV-LATER','Grand Total':1000,'Paid Amount':200,'Due Amount':800}],
  raw:[ledger(4,'Sale','INV-LATER',800,0),ledger(5,'Payment','PAY-1',0,300),
       ledger(6,'Sales Return Credit','RET-1',0,100)]});
 const x=f.ctx.partyLedgerBuildDisplayIndex_('customer','C1',false);
 assert.deepEqual(Array.from(x.map(r=>r.Type)),['Sale','Payment','Sales Return Credit']);
 assert.deepEqual(Array.from(x.map(r=>r._displayBalance)),[800,500,400]);
 assert.equal(x[0].Debit,1000);assert.equal(x[0].Credit,200);
});
test('anonymous full-paid sale and deleted sale never leak to a customer ledger',()=>{
 const f=fixture({sales:[
  {'Invoice ID':'INV-ANON','Customer ID':'','Grand Total':100,'Paid Amount':100,'Due Amount':0},
  {'Invoice ID':'INV-DELETED','Is Deleted':'TRUE','Grand Total':200,'Paid Amount':200,'Due Amount':0},
  {'Invoice ID':'INV-OTHER','Customer ID':'C2','Grand Total':300,'Paid Amount':300,'Due Amount':0}
 ]});
 assert.equal(f.ctx.partyLedgerBuildDisplayIndex_('customer','C1',false).length,0);
});
test('customer reassignment shows invoice only under current linked customer',()=>{
 const f=fixture({sales:[{'Invoice ID':'INV-MOVED','Customer ID':'C2','Grand Total':900,'Paid Amount':200,'Due Amount':700}],
  raw:[ledger(3,'Sale','INV-MOVED',700,0),ledger(4,'Sale Update Credit','INV-MOVED',0,700),
       ledger(5,'Sale Update Debit','INV-MOVED',700,0,'C2')]});
 assert.equal(f.ctx.partyLedgerBuildDisplayIndex_('customer','C1',false).length,0);
 const x=f.ctx.partyLedgerBuildDisplayIndex_('customer','C2',false);
 assert.equal(x.length,1);assert.equal(x[0].Debit,900);assert.equal(x[0].Credit,200);
 assert.equal(x[0]._displayBalance,700);
});
test('modified invoice projects latest amounts without double counting edit chain',()=>{
 const f=fixture({sales:[{'Invoice ID':'INV-EDIT','Grand Total':900,'Paid Amount':400,'Due Amount':500}],
 raw:[ledger(3,'Sale','INV-EDIT',600,0),
      ledger(4,'Sale Update Credit','INV-EDIT',0,600),
      ledger(5,'Sale Update Debit','INV-EDIT',500,0)]});
 const x=f.ctx.partyLedgerBuildDisplayIndex_('customer','C1',false);
 assert.equal(x.length,1);assert.equal(x[0].Debit,900);assert.equal(x[0].Credit,400);
 assert.equal(x[0]._displayBalance,500);
});
test('corrupt invoice paid/due mismatch fails closed without hiding raw due evidence',()=>{
 const f=fixture({sales:[{'Invoice ID':'INV-BAD','Grand Total':900,'Paid Amount':300,'Due Amount':600}],
 raw:[ledger(5,'Sale','INV-BAD',700,0)]});
 const x=f.ctx.partyLedgerBuildDisplayIndex_('customer','C1',false);
 assert.equal(x.length,1);
 assert.equal(x[0].Debit,700);assert.equal(x[0]._displayBalance,700);
});
test('no invented unpaid invoice without accounting ledger source',()=>{
 const f=fixture({sales:[{'Invoice ID':'INV-MISSING','Grand Total':600,'Paid Amount':0,'Due Amount':600}],raw:[]});
 assert.equal(f.ctx.partyLedgerBuildDisplayIndex_('customer','C1',false).length,0);
});
test('duplicate Sale correction entries are not replaced with a synthetic single row',()=>{
 const f=fixture({sales:[{'Invoice ID':'INV-DUP','Grand Total':300,'Paid Amount':0,'Due Amount':300}],
 raw:[ledger(3,'Sale','INV-DUP',100,0),ledger(4,'Sale','INV-DUP',200,0)]});
 const x=f.ctx.partyLedgerBuildDisplayIndex_('customer','C1',false);
 assert.equal(x.length,2);assert.equal(x[1]._displayBalance,300);
});
test('zero-due invoice with no customer-ledger rows still appears alongside opening balance',()=>{
 const f=fixture({sales:[{'Invoice ID':'INV-PAID','Grand Total':50,'Paid Amount':50,'Due Amount':0}],
 raw:[ledger(2,'Opening Balance','C1',300,0,'C1','2026-11-01')]});
 const x=f.ctx.partyLedgerBuildDisplayIndex_('customer','C1',false);
 assert.equal(x.length,2);assert.equal(x[0]._displayBalance,300);assert.equal(x[1]._displayBalance,300);
});
test('narrow linked sale index ignores other IDs and deleted rows, not by name/phone',()=>{
 const f=fixture({sales:[
 {'Invoice ID':'INV-C1','Grand Total':20,'Paid Amount':20},
 {'Invoice ID':'INV-C2','Customer ID':'C2','Grand Total':20,'Paid Amount':20},
 {'Invoice ID':'INV-DEL','Is Deleted':'TRUE','Grand Total':20,'Paid Amount':20}
 ]});
 const ctx=f.ctx;
 ctx.partyLedgerCustomerSaleIndex_=ctx._realCustomerSaleIndex_;
 const cols=['Invoice ID','Date','Customer ID','Customer Name','Grand Total','Paid Amount','Due Amount','Payment Status','Created At','Is Deleted'];
 ctx.getSheetHeaders_=()=>cols;
 const data=f.sales.map(row=>cols.map(k=>row[k]??''));
 ctx.getSheet_=()=>({
  getLastRow:()=>data.length+1,
  getRangeList:a1s=>({getRanges:()=>{
   return a1s.map(a1=>{
    const match=/^([A-Z]+)2:/.exec(a1);let n=0;
    for(const c of match[1])n=n*26+c.charCodeAt(0)-64;
    return {getValues:()=>data.map(row=>[row[n-1]])};
   });
  }})
 });
 const x=ctx.partyLedgerCustomerSaleIndex_('C1');
 assert.equal(x.length,1);assert.equal(x[0]['Invoice ID'],'INV-C1');
});
