'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const read=x=>fs.readFileSync(path.join(__dirname,'..',x),'utf8');
const plain=x=>JSON.parse(JSON.stringify(x));
const sale={'Invoice ID':'INV-1',Date:'2026-11-03','Paid Amount':100,'Due Amount':0,'Payment Detail Version':1,'Customer ID':''};
const children=[
 {'Invoice ID':'INV-1','Payment ID':'P1','Row Order':1,Revision:1,Method:'Cash','Applied Amount':40,'Tendered Amount':60,'Change Amount':20,Status:'Active'},
 {'Invoice ID':'INV-1','Payment ID':'P2','Row Order':2,Revision:1,Method:'Bank','Bank Account ID':'B1','Bank Account Name':'DBBL','Applied Amount':60,'Tendered Amount':60,'Change Amount':0,Status:'Active'}
];
function deletionHarness(failAt=''){
 const db={
  SALES:[{...sale}],SALE_ITEMS:[{'Invoice ID':'INV-1','Product ID':'P1','Product Name':'Widget',Quantity:1}],
  SALE_PAYMENTS:children.map(c=>({...c})),
  SALE_POSTING_JOURNAL:[],BANK_ACCOUNTS:[{'Bank Account ID':'B1','Account Name':'DBBL','Current Balance':60}],
  BANK_BOOK:[{Reference:'INV-1',Type:'Sale','Bank Account ID':'B1',Credit:60,Debit:'',Status:'Active'}],
  CASH_BOOK:[{Reference:'INV-1',Type:'Sale',Credit:40,Debit:''}],
  SALES_RETURN:[],PRODUCTS:[],VENDOR_SOURCING:[],CUSTOMER_LEDGER:[],SALE_ITEM_LOTS:[]
 };
 let failOnce=false, writes=[];
 const rows=key=>(db[key]||[]).map((r,i)=>({...r,_rowIndex:i+2}));
 const ctx=vm.createContext({
  CONFIG:{LOCK_TIMEOUT_MS:1000},
  LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
  requireDeletePermission_:()=>({'User ID':'U1','Full Name':'Owner'}),
  requireActiveCashSession_:()=>true,
  getAllRows_:rows,findUniqueSalesRow_:()=>rows('SALES')[0],
  findRowIndex_:(key,col,value)=>rows(key).find(r=>r[col]===value)?._rowIndex||-1,
  appendRow_:(key,row)=>{writes.push(key);db[key]||=[];db[key].push({...row});},
  updateRowFields_:(key,index,fields)=>{
   writes.push(key);
   if(!failOnce&&key===failAt){failOnce=true;throw new Error('Injected '+key+' failure');}
   Object.assign(db[key][index-2],fields);
  },
  sanitizeInput_:v=>String(v==null?'':v).trim(),logError_:()=>{},logDeletion_:()=>{},
  outstandingSaleOwnStockByProduct_:()=>({}),adjustCustomerDue_:()=>{},
  salePostingPayloadHash_:()=> 'HASH',roundMoney_:n=>Math.round(Number(n)*100)/100,
  ok_:data=>({success:true,data}),fail_:m=>({success:false,message:String(m)})
 });
 vm.runInContext(read('SalePayments.gs'),ctx);
 vm.runInContext(read('DeleteEngine.gs'),ctx);
 return {ctx,db,writes,rows};
}
test('Phase 5: split invoice deletion reverses bank balance, cash source, payment children and header exactly once',()=>{
 const h=deletionHarness();
 const result=h.ctx.deleteSalesInvoice('token','INV-1','');
 assert.equal(result.success,true,result.message);
 assert.equal(h.db.BANK_ACCOUNTS[0]['Current Balance'],0);
 assert.equal(h.db.BANK_BOOK[0].Status,'Reversed');
 assert.equal(h.db.CASH_BOOK[0]['Is Deleted'],'TRUE');
 assert.equal(h.db.SALES[0]['Is Deleted'],'TRUE');
 assert.deepEqual(h.db.SALE_PAYMENTS.map(r=>r.Status),['Reversed','Reversed']);
 assert.equal(h.db.SALE_POSTING_JOURNAL[0].State,'Committed');
 const again=h.ctx.deleteSalesInvoice('token','INV-1','');
 assert.equal(again.success,false);
 assert.equal(h.db.SALE_POSTING_JOURNAL.length,1);
});
test('Phase 5: inconsistent payment books reject invoice deletion before all writes',()=>{
 const h=deletionHarness();
 h.db.BANK_BOOK[0].Credit=59;
 const result=h.ctx.deleteSalesInvoice('token','INV-1','');
 assert.equal(result.success,false);
 assert.match(result.message,/integrity|mismatch/i);
 assert.deepEqual(h.writes,[]);
});
test('Phase 5: interrupted deletion is Needs Review and can never post a second reversal',()=>{
 const h=deletionHarness('BANK_BOOK');
 const first=h.ctx.deleteSalesInvoice('token','INV-1','correction');
 assert.equal(first.success,false);
 assert.equal(h.db.SALE_POSTING_JOURNAL[0].State,'Needs Review');
 const writes=h.writes.length;
 const again=h.ctx.deleteSalesInvoice('token','INV-1','correction');
 assert.equal(again.success,false);
 assert.match(again.message,/review/i);
 assert.equal(h.writes.length,writes);
});
test('Phase 5: refund cash provenance is original APPLIED split amount, not Cash tender',()=>{
 const source=read('CustomerSettlement.gs');
 const ctx=vm.createContext({roundMoney_:n=>Math.round(Number(n)*100)/100,
  isDeleted_:()=>false,
  getAllRows_:key=>key==='SALE_PAYMENTS'?children:[],
  customerSettlementIsCashBackedMethod_:()=>false});
 vm.runInContext(read('SalePayments.gs'),ctx);
 const begin=source.indexOf('function customerSaleCheckoutCashCollected_(');
 const end=source.indexOf('function customerInvoiceCashCollected_(',begin);
 assert.ok(begin>=0&&end>begin);
 vm.runInContext(source.slice(begin,end),ctx);
 assert.equal(ctx.customerSaleCheckoutCashCollected_(sale),100);
 const overCash={...sale,'Paid Amount':40};
 assert.throws(()=>ctx.customerSaleCheckoutCashCollected_(overCash),/mismatch|integrity/);
});
test('Phase 5: single split return journal replay decision occurs before return quantity preparation',()=>{
 const s=read('SalesReturn.gs'),start=s.indexOf('function completeReturn(token, payload) {');
 const after=s.slice(start,s.indexOf('function deriveSalesReturnBatchId_',start));
 const replay=after.indexOf("salePostingJournalDecision_(journal,paymentHash)");
 const prepared=after.indexOf('prepareSalesReturn_(payload');
 assert.ok(replay>=0&&prepared>replay,'check replay before returnable quantity');
 assert.match(s,/Return Operation ID/);
 assert.match(read('returns.html'),/payloadSingle\.operationId\s*=\s*rtReturnOperationId_\(\)/);
});
