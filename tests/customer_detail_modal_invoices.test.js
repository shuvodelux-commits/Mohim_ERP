'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const partySrc=fs.readFileSync(path.join(root,'PartyLedger.gs'),'utf8');
const customerSrc=fs.readFileSync(path.join(root,'Customer.gs'),'utf8');
const html=fs.readFileSync(path.join(root,'customers.html'),'utf8');
const salesHtml=fs.readFileSync(path.join(root,'sales.html'),'utf8');
function sale(id,grand,paid,due,extra={}) {
  return Object.assign({'Invoice ID':id,'Date':'2026-11-04','Customer ID':'C1',
    'Customer Name':'রুবরুল আহমেদ','Grand Total':grand,'Paid Amount':paid,'Due Amount':due,
    'Payment Status':due?'Partial':'Paid','Created At':'2026-11-04T08:00:00','Is Deleted':''},extra);
}
function row(index,type,reference,debit,credit,extra={}) {
  return Object.assign({_rowIndex:index,'Ledger ID':'CL-'+index,'Date':'2026-11-04',
    'Customer ID':'C1','Customer Name':'রুবরুল আহমেদ','Type':type,'Reference':reference,
    'Debit':debit||'','Credit':credit||'','Created At':'2026-11-04T09:00:00','Is Deleted':''},extra);
}
function fixture({sales=[],ledger=[],currentDue=0,canView=true}={}) {
  const reads=[],writes=[];
  const context={
    console,roundMoney_:value=>Math.round((Number(value)||0)*100)/100,
    safeDateOnly_:value=>String(value||'').slice(0,10),
    isDeleted_:r=>String(r&&r['Is Deleted']||'').toUpperCase()==='TRUE',
    sanitizeInput_:v=>String(v||'').trim(),
    serializeCellValue_:v=>v,
    requirePermission_:(_,section,action)=>{if(!canView)throw Error('Permission denied');assert.equal(section,'customers');assert.equal(action,'view');},
    assertCustomerSalesIntegrity_:()=>{},
    ok_:data=>({success:true,data}),fail_:message=>({success:false,message}),
    logError_:(...args)=>writes.push(args),
    // Original modal endpoint calls the raw ledger balance read model; provide
    // that legacy dependency so the RED test fails for missing invoices, not
    // a missing mock function.
    recalculateLedgerBalancesForDisplay_:(rows)=>rows.slice().reverse().map(r=>Object.assign({Balance:0},r))
  };
  const customer={'Customer ID':'C1','Customer Name':'রুবরুল আহমেদ','Phone':'01346065305','Current Due':currentDue};
  context.getAllRows_=sheet=>{
    reads.push(sheet);
    if(sheet==='CUSTOMERS')return [customer];
    if(sheet==='CUSTOMER_LEDGER')return ledger;
    throw Error('Unexpected full sheet read '+sheet);
  };
  vm.createContext(context);
  vm.runInContext(partySrc,context,{filename:'PartyLedger.gs'});
  vm.runInContext(customerSrc,context,{filename:'Customer.gs'});
  context.partyLedgerBuildAscendingIndex_=(kind,cid)=>ledger.filter(r=>r['Customer ID']===cid && !context.isDeleted_(r)).map(r=>Object.assign({},r));
  context.partyLedgerSourceDateMap_=()=>({});
  context.partyLedgerCustomerSaleIndex_=cid=>sales.filter(s=>s['Customer ID']===cid&&!context.isDeleted_(s));
  return {context,reads,writes,customer};
}
test('linked fully paid invoice is visible once inside Customer detail modal without creating due',()=>{
  const f=fixture({sales:[sale('INV-000128',3640,3640,0)]});
  const x=f.context.getCustomerDetail('token','C1');
  assert.equal(x.success,true);assert.equal(x.data.customer['Current Due'],0);
  const ledger=x.data.ledger;
  assert.equal(ledger.length,1);assert.equal(ledger[0].Reference,'INV-000128');
  assert.equal(ledger[0].Type,'Sale');assert.equal(ledger[0].Debit,3640);
  assert.equal(ledger[0].Credit,3640);assert.equal(ledger[0].Balance,0);
  assert.equal(ledger[0]._invoiceProjection,true);
  assert.deepEqual(Array.from(f.writes),[]);
});
test('partial multi-payment invoice shows full debit and checkout credit, followed by payment and return',()=>{
  const f=fixture({currentDue:100,
    sales:[sale('INV-000127',6000,3000,3000)],
    ledger:[
      row(2,'Sale','INV-000127',3000,0),
      row(3,'Payment','PAYMENT',0,2700,{'Payment Amount':2500,'Discount Amount':200}),
      row(4,'Sales Return Credit','SRT-000006',0,200)
    ]});
  const x=f.context.getCustomerDetail('token','C1');
  assert.equal(x.success,true);
  assert.deepEqual(Array.from(x.data.ledger.map(r=>r.Type)),['Sales Return Credit','Payment','Sale']);
  assert.deepEqual(Array.from(x.data.ledger.map(r=>r.Balance)),[100,300,3000]);
  const projected=x.data.ledger[2];
  assert.deepEqual([projected.Debit,projected.Credit,projected._invoiceProjection],[6000,3000,true]);
  const payment=x.data.ledger[1];
  assert.equal(payment['Ledger ID'],'CL-3');
  assert.equal(payment['Payment Amount'],2500);
  assert.equal(payment['Discount Amount'],200);
});
test('corrected sale shows one updated invoice and preserves later genuine settlement',()=>{
  const f=fixture({currentDue:250,
    sales:[sale('INV-EDIT',900,400,500)],
    ledger:[row(2,'Sale','INV-EDIT',600,0),row(3,'Sale Update Credit','INV-EDIT',0,600),
      row(4,'Sale Update Debit','INV-EDIT',500,0),row(5,'Payment','PAYMENT',0,250)]});
  const x=f.context.getCustomerDetail('token','C1');
  assert.equal(x.success,true);
  assert.deepEqual(Array.from(x.data.ledger.map(r=>r.Type)),['Payment','Sale']);
  assert.deepEqual(Array.from(x.data.ledger.map(r=>r.Balance)),[250,500]);
  assert.equal(x.data.ledger[1].Debit,900);
  assert.equal(x.data.ledger[1].Credit,400);
});
test('anonymous, deleted and other-customer sales are not imported by customer name or phone',()=>{
  const f=fixture({sales:[
    sale('INV-ANON',100,100,0,{'Customer ID':''}),
    sale('INV-DELETE',100,100,0,{'Is Deleted':'TRUE'}),
    sale('INV-OTHER',100,100,0,{'Customer ID':'C2'})
  ]});
  const x=f.context.getCustomerDetail('token','C1');
  assert.equal(x.success,true);assert.equal(x.data.ledger.length,0);
});
test('unreconciled due invoice stays absent, no ghost receivable is fabricated',()=>{
  const f=fixture({sales:[sale('INV-NO-LEDGER',500,0,500)]});
  const x=f.context.getCustomerDetail('token','C1');
  assert.equal(x.success,true);assert.equal(x.data.ledger.length,0);
});
test('customer detail permission remains required and denied calls reveal no ledger',()=>{
  const f=fixture({sales:[sale('INV-PAID',100,100,0)],canView:false});
  const x=f.context.getCustomerDetail('token','C1');
  assert.equal(x.success,false);assert.equal(f.reads.length,0);
});
test('Sales name opens this modal; projected invoice labels distinguish checkout payment from later settlement',()=>{
  assert.match(salesHtml,/button\[data-customer-profile-id\][\s\S]*?custOpenDetail_\(customerId\)/);
  assert.match(html,/serverCall\('getCustomerDetail', authToken, id\)/);
  assert.match(html,/l\._invoiceProjection[\s\S]*?Paid at Checkout/);
  assert.match(html,/l\._invoiceProjection[\s\S]*?Invoice Total/);
  assert.match(html,/var isPayment = l\['Type'\] === 'Payment'/);
});
