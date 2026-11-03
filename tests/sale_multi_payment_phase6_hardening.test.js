'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = filename => fs.readFileSync(path.join(__dirname,'..',filename),'utf8');
const sale = (paid, invoiceId='QA-INV-01') => ({
  'Invoice ID':invoiceId,'Paid Amount':paid,'Payment Detail Version':1
});
const row = (id,method,tender,applied,change,accountId='',order=1) => ({
  'Invoice ID':'QA-INV-01','Payment ID':id,'Revision':1,'Row Order':order,
  Method:method,'Bank Account ID':accountId,'Bank Account Name':accountId,
  'Tendered Amount':tender,'Applied Amount':applied,'Change Amount':change,Status:'Active'
});
function kernel(){
  const c=vm.createContext({});
  vm.runInContext(read('SalePayments.gs'),c);
  return c;
}
const valid = () => [
  row('PAY-1','Cash',65,40,25,'',1),
  row('PAY-2','Bank',30,30,0,'B1',2),
  row('PAY-3','Mobile Banking',30,30,0,'M1',3)
];

test('Phase 6 payment proof: unchanged original Cash/Bank/Mobile breakdown is accepted',()=>{
  const k=kernel();
  const got=k.readSalePaymentBreakdown_(sale(100),valid());
  assert.equal(got.reduce((n,p)=>n+p.applied,0),100);
  assert.equal(got[0].change,25);
});

const tamper = [
  ['Cash tendered does not equal applied plus change',rows=>{rows[0]['Tendered Amount']=64;}],
  ['Cash row incorrectly assigned a bank account',rows=>{rows[0]['Bank Account ID']='B1';}],
  ['Bank tender and applied mismatch',rows=>{rows[1]['Tendered Amount']=31;}],
  ['Bank row contains customer change',rows=>{rows[1]['Change Amount']=1;}],
  ['Bank account ID missing',rows=>{rows[1]['Bank Account ID']='';}],
  ['Unsupported method',rows=>{rows[1].Method='Gift';}],
  ['Duplicate payment ID',rows=>{rows[1]['Payment ID']='PAY-1';}],
  ['Duplicate row ordering',rows=>{rows[1]['Row Order']=1;}],
  ['Two Cash tenders',rows=>{rows[1].Method='Cash';rows[1]['Bank Account ID']='';}],
  ['Row order must be positive integer',rows=>{rows[1]['Row Order']='1.5';}],
  ['Revision must be a positive integer',rows=>{rows[1].Revision='-1';}],
  ['Unreasonably large row count',rows=>{for(let i=0;i<20;i++)rows.push(row('EXTRA-'+i,'Bank',1,1,0,'B'+i,i+4));}]
];

for(const [name,change] of tamper){
 test('Phase 6: fail closed on '+name,()=>{
   const k=kernel(),rows=valid();
   change(rows);
   assert.throws(()=>k.readSalePaymentBreakdown_(sale(100),rows),/integrity|payment|invalid|duplicate|row|method|account/i);
 });
}

test('Phase 6: zero-applied cash returned entirely as change does not create cash income',()=>{
  const k=kernel();
  const rows=[
    row('PAY-1','Cash',30,0,30,'',1),
    row('PAY-2','Bank',100,100,0,'B1',2)
  ];
  const result=k.readSalePaymentBreakdown_(sale(100),rows);
  assert.equal(result[0].applied,0);
  assert.equal(result[0].change,30);
  assert.doesNotThrow(()=>k.assertSalePaymentBookEvidence_(
    'QA-INV-01',result,[],[{'Reference':'QA-INV-01',Type:'Sale','Bank Account ID':'B1',Credit:100,Status:'Active'}]));
});

test('Phase 6: clone verification source is excluded from production clasp pushes and explicitly rejects production',()=>{
  const ignore=read('.claspignore');
  const qa=read('tests/phase6_clone_audit.gs');
  assert.match(ignore,/tests\/\*\*/);
  assert.match(qa,/function phase6CloneAudit_/);
  assert.match(qa,/SpreadsheetApp\.getActiveSpreadsheet\(\)/);
  assert.match(qa,/ScriptApp\.getScriptId\(\)/);
  assert.match(qa,/assertPhase6CloneIdentity_/);
  assert.match(qa,/assertSalePaymentBookEvidence_/);
  assert.match(qa,/readSalePaymentBreakdown_/);
  assert.doesNotMatch(qa,/appendRow_|appendRows_|updateRowFields_|deleteRow_|clearContents|setValues|setValue\(/);
});
