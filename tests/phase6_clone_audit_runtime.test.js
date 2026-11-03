'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const sid='disposableTestScriptId1234567890',did='disposableTestSheetId1234567890';
const S={
 SALES:'SALES',SALE_PAYMENTS:'SALE_PAYMENTS',SALE_POSTING_JOURNAL:'SALE_POSTING_JOURNAL',
 CASH_BOOK:'CASH_BOOK',BANK_BOOK:'BANK_BOOK',SALES_RETURN:'SALES_RETURN'
};
function cloneFixture(){
 const data={
  SALES:[{'Invoice ID':'INV-1','Payment Detail Version':1,'Paid Amount':100,'Due Amount':0,'Grand Total':100}],
  SALE_PAYMENTS:[
   {'Invoice ID':'INV-1','Payment ID':'C1','Row Order':1,Revision:1,Method:'Cash',
    'Tendered Amount':60,'Applied Amount':40,'Change Amount':20,Status:'Active'},
   {'Invoice ID':'INV-1','Payment ID':'B1','Row Order':2,Revision:1,Method:'Bank','Bank Account ID':'BANK1',
    'Bank Account Name':'QA Bank','Tendered Amount':60,'Applied Amount':60,'Change Amount':0,Status:'Active'}
  ],
  SALE_POSTING_JOURNAL:[{'Operation ID':'OP-1','Operation Type':'Create','Invoice ID':'INV-1',State:'Committed'}],
  CASH_BOOK:[{Reference:'INV-1',Type:'Sale',Debit:'',Credit:40}],
  BANK_BOOK:[{Reference:'INV-1',Type:'Sale','Bank Account ID':'BANK1',Debit:'',Credit:60,Status:'Active'}],
  SALES_RETURN:[]
 };
 let reads=0;
 const spreadsheet={
  getId:()=>did,
  getSheetByName:key=>{
   reads++;
   if(!Object.hasOwn(data,key))return null;
   const rows=data[key],keys=new Set();
   rows.forEach(row=>Object.keys(row).forEach(k=>keys.add(k)));
   // Even empty sheets have declared header row and no data.
   const header=Array.from(keys.size?keys:['ID']);
   return {
    getLastRow:()=>rows.length+1,
    getLastColumn:()=>header.length,
    getRange:(r,c,n,w)=>({
     getValues:()=>r===1?[header]:
      rows.slice(r-2,r-2+n).map(row=>header.map(h=>row[h]===undefined?'':row[h]))
    })
   };
  }
 };
 return {data,spreadsheet,getReads:()=>reads};
}
function runtime(fixture,scriptId=sid){
 const log=[];
 const ctx=vm.createContext({
  CONFIG:{SHEETS:S},SpreadsheetApp:{getActiveSpreadsheet:()=>fixture.spreadsheet},
  ScriptApp:{getScriptId:()=>scriptId},Logger:{log:x=>log.push(x)},
  Date,Set
 });
 vm.runInContext(read('SalePayments.gs'),ctx);
 vm.runInContext(read('tests/phase6_clone_audit.gs'),ctx);
 ctx.PHASE6_CLONE_EXPECTED_.spreadsheetId=did;
 ctx.PHASE6_CLONE_EXPECTED_.scriptId=sid;
 return {ctx,log};
}
test('Phase 6 clone audit uses read-only Sheet ranges, validates genuine versioned checkout money and reports PASS',()=>{
 const fixture=cloneFixture(),h=runtime(fixture);
 const result=h.ctx.phase6CloneAudit_();
 assert.equal(result.status,'PASS',JSON.stringify(result.issues));
 assert.equal(result.issueCount,0);
 assert.equal(result.splitInvoices,1);
 assert.equal(result.activeSplitInvoicesChecked,1);
 assert.equal(result.mode,'READ_ONLY_ISOLATED_CLONE');
 assert.ok(fixture.getReads()>=6);
 assert.equal(h.log.length,1);
});
test('Phase 6 clone audit detects independent Cash/Bank book drift, orphan payment and interrupted journal',()=>{
 const fixture=cloneFixture(),h=runtime(fixture);
 fixture.data.BANK_BOOK[0].Credit=59;
 fixture.data.SALE_PAYMENTS.push({...fixture.data.SALE_PAYMENTS[1],
  'Payment ID':'ORPHAN','Invoice ID':'MISSING','Row Order':3});
 fixture.data.SALE_POSTING_JOURNAL[0].State='Needs Review';
 const result=h.ctx.phase6CloneAudit_();
 assert.equal(result.status,'FAIL');
 assert.ok(result.issues.some(i=>/book integrity mismatch/i.test(i.problem)));
 assert.ok(result.issues.some(i=>/orphan active/i.test(i.problem)));
 assert.ok(result.issues.some(i=>/journal not committed/i.test(i.problem)));
});
test('Phase 6 clone audit refuses wrong script identity before reading any business sheets',()=>{
 const fixture=cloneFixture(),h=runtime(fixture,'unauthorized-script');
 assert.throws(()=>h.ctx.phase6CloneAudit_(),/identity mismatch/);
 assert.equal(fixture.getReads(),0);
});
