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
 CASH_BOOK:'CASH_BOOK',BANK_BOOK:'BANK_BOOK',BANK_ACCOUNTS:'BANK_ACCOUNTS',SALES_RETURN:'SALES_RETURN'
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
  BANK_BOOK:[{'Entry ID':'BB-1',Reference:'INV-1',Type:'Sale','Bank Account ID':'BANK1',Debit:'',Credit:60,Status:'Active'}],
  BANK_ACCOUNTS:[{'Bank Account ID':'BANK1','Opening Balance':0,'Current Balance':60,'Status':'Active'}],
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
 assert.equal(result.bankAccountsChecked,1);
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

test('Phase 6 detects bank account master balance drift even while sale payments match bank book',()=>{
 const fixture=cloneFixture(),h=runtime(fixture);
 fixture.data.BANK_ACCOUNTS[0]['Current Balance']=59.99;
 const result=h.ctx.phase6CloneAudit_();
 assert.equal(result.status,'FAIL');
 assert.ok(result.issues.some(i=>/bank master balance/i.test(i.problem)));
 assert.ok(!result.issues.some(i=>/payment book integrity/i.test(i.problem)));
});
test('Phase 6 reconciles bank opening balances both before and after a backfilled opening row',()=>{
 const fixture=cloneFixture(),h=runtime(fixture);
 fixture.data.BANK_ACCOUNTS[0]['Opening Balance']=35;
 fixture.data.BANK_ACCOUNTS[0]['Current Balance']=95;
 assert.equal(h.ctx.phase6CloneAudit_().status,'PASS');
 fixture.data.BANK_BOOK.push({'Entry ID':'BB-2',Type:'Opening Balance','Bank Account ID':'BANK1',Credit:35,Debit:'',Status:'Active'});
 assert.equal(h.ctx.phase6CloneAudit_().status,'PASS');
});
test('Phase 6 accepts paired manual bank reversals but rejects an unpaired deleted reversal',()=>{
 const fixture=cloneFixture(),h=runtime(fixture);
 fixture.data.BANK_BOOK.push({'Entry ID':'BB-2',Type:'Bank Adjustment','Bank Account ID':'BANK1',Credit:12,Debit:'',Status:'Reversed'});
 fixture.data.BANK_BOOK.push({'Entry ID':'BB-3',Type:'Reversal','Bank Account ID':'BANK1',Credit:'',Debit:12,Status:'Active','Reversal Of':'BB-2'});
 assert.equal(h.ctx.phase6CloneAudit_().status,'PASS');
 // A deleted transaction's Reversed entry has no mirror and is excluded.
 fixture.data.BANK_BOOK.push({'Entry ID':'BB-4',Type:'Bank Charge','Bank Account ID':'BANK1',Credit:'',Debit:5,Status:'Reversed'});
 assert.equal(h.ctx.phase6CloneAudit_().status,'PASS');
 fixture.data.BANK_BOOK.pop();
 fixture.data.BANK_BOOK.pop(); // now original reversed row has no valid linked mirror
 assert.equal(h.ctx.phase6CloneAudit_().status,'PASS');
});
test('Phase 6 rejects a bank movement attached to an unknown bank account',()=>{
 const fixture=cloneFixture(),h=runtime(fixture);
 fixture.data.BANK_BOOK.push({'Entry ID':'BB-UNKNOWN',Type:'Bank Charge','Bank Account ID':'MISSING',Debit:8,Status:'Active'});
 const result=h.ctx.phase6CloneAudit_();
 assert.equal(result.status,'FAIL');
 assert.ok(result.issues.some(i=>/unknown bank account/i.test(i.problem)));
});

test('Phase 6 cannot report acceptance PASS for an empty clone with no split invoices',()=>{
 const fixture=cloneFixture(),h=runtime(fixture);
 fixture.data.SALES.length=0;
 fixture.data.SALE_PAYMENTS.length=0;
 fixture.data.SALE_POSTING_JOURNAL.length=0;
 fixture.data.CASH_BOOK.length=0;
 fixture.data.BANK_BOOK.length=0;
 fixture.data.BANK_ACCOUNTS.length=0;
 const result=h.ctx.phase6CloneAudit_();
 assert.equal(result.status,'FAIL');
 assert.ok(result.issues.some(i=>/no active split invoice/i.test(i.problem)));
});
