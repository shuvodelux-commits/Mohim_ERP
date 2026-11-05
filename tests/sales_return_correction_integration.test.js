'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),source=f=>fs.readFileSync(path.join(root,f),'utf8');
function workbook(){
 const tables={
  SALES:[{'Invoice ID':'INV1','Date':'2026-09-10','Created At':'2026-09-10T10:00:00','Customer ID':'C1',
   'Customer Name':'Buyer','Customer Phone':'01700000000','Customer Address':'Address',
   Subtotal:500,'Grand Total':500,'Paid Amount':500,'Due Amount':0,'Payment Method':'Cash','Payment Status':'Paid'}],
  SALE_ITEMS:[{'Invoice ID':'INV1','Product ID':'P1','Product Name':'Widget',Quantity:5,'Unit Price':100,'Line Total':500}],
  PRODUCTS:[{'Product ID':'P1','Product Name':'Widget','Current Stock':5,'Purchase Price':40,Status:'Active'}],
  STOCK_LOTS:[{'Lot ID':'L1','Product ID':'P1','Product Name':'Widget','Purchase ID':'PO1','Purchase Price':40,
   'Original Quantity':5,'Remaining Quantity':0,Status:'Active','Created At':'2026-09-01T09:00:00'}],
  SALE_ITEM_LOTS:[{'Invoice ID':'INV1','Product ID':'P1','Lot ID':'L1',Quantity:5,
   'Source Sale Product ID':'P1','Supplier ID':'','Created At':'2026-09-10T10:00:00'}],
  SALES_RETURN:[],SALES_RETURN_ITEMS:[],STOCK_MOVEMENT:[],SALE_POSTING_JOURNAL:[],
  CASH_BOOK:[],CUSTOMER_LEDGER:[],CUSTOMERS:[{'Customer ID':'C1','Customer Name':'Buyer','Current Due':0,Status:'Active'}],
  SALE_BUNDLE_COMPONENTS:[],VENDOR_SOURCING:[],CASH_SESSIONS:[],INVOICE_EDIT_LOG:[],DELETE_LOG:[]
 };
 const writes=[],ctx=vm.createContext({console,Date,JSON,Math,CONFIG:{LOCK_TIMEOUT_MS:1000}});
 for(const file of ['Utils.gs','CustomerSettlement.gs','StockLots.gs','Bundles.gs','SalesReturn.gs']){
   vm.runInContext(source(file),ctx,{filename:file});
 }
 let locked=false;const counters={};
 const rows=k=>tables[k]||(tables[k]=[]);
 Object.assign(ctx,{
  LockService:{getScriptLock:()=>({waitLock:()=>{assert.equal(locked,false);locked=true;},releaseLock:()=>{locked=false;}})},
  Session:{getScriptTimeZone:()=> 'UTC'},
  Utilities:{formatDate:(d,zone,format)=>format==='HH:mm:ss'?'12:00:00':new Date(d).toISOString().slice(0,10)},
  requirePermission_:()=>({'User ID':'U1','Full Name':'Operator'}),
  requireDeletePermission_:()=>({'User ID':'U1','Full Name':'Operator'}),
  actorName_:()=> 'Operator',requireActiveCashSession_:()=> true,
  getAllRows_:k=>rows(k).map((r,i)=>({...r,_rowIndex:i+2})),
  activeRows_:k=>ctx.getAllRows_(k).filter(r=>!ctx.isDeleted_(r)),
  isDeleted_:r=>String(r && r['Is Deleted'] || '').toUpperCase()==='TRUE',
  findRowIndex_:(k,c,v)=>{let i=rows(k).findIndex(x=>String(x[c])===String(v));return i<0?-1:i+2;},
  findRows_:(k,c,v)=>ctx.getAllRows_(k).filter(x=>String(x[c])===String(v)),
  appendRow_:(k,v)=>{writes.push(['append',k]);rows(k).push({...v});return rows(k).length+1;},
  appendRows_:(k,a)=>a.forEach(v=>ctx.appendRow_(k,v)),
  updateRowFields_:(k,i,fields)=>{writes.push(['update',k]);assert.ok(rows(k)[i-2]);Object.assign(rows(k)[i-2],fields)},
  markMatchingDeleted_:(k,pred,user,reason)=>{let n=0;ctx.getAllRows_(k).filter(r=>!ctx.isDeleted_(r)&&pred(r)).forEach(r=>{ctx.updateRowFields_(k,r._rowIndex,{'Is Deleted':'TRUE','Delete Reason':reason});n++;});return n;},
  markRowDeleted_:(k,i,user,reason)=>ctx.updateRowFields_(k,i,{'Is Deleted':'TRUE','Delete Reason':reason}),
  logDeletion_:(mod,id,invoice,reason)=>ctx.appendRow_('DELETE_LOG',{Module:mod,'Record ID':id,'Invoice No':invoice,Reason:reason}),
  generateId_:k=>{counters[k]=(counters[k]||0)+1;return k+'-'+counters[k];},
  addCashBookEntry_:entry=>ctx.appendRow_('CASH_BOOK',entry),
  customerInvoiceCashCollected_:()=>500,
  salePostingPayloadHash_:payload=>JSON.stringify(payload),
  salePostingJournalDecision_:(j,hash)=>{if(j['Payload Hash']!==hash)throw Error('Hash mismatch');return j.State==='Committed'?'replay':'review';},
  resolveTransactionDate_:(_tok,_mod,d)=>({dateStr:d||'2026-09-21',isBackdated:false,backdatedDays:0,reason:''}),
  resolveEditedTransactionDate_:(_tok,_mod,d,prior)=>d||prior,
  resolveOrCreateCustomer_:()=>{throw Error('unexpected customer creation')},
  logError_:()=>{},sanitizeInput_:x=>String(x==null?'':x).trim(),roundMoney_:n=>Math.round(n*100)/100
 });
 return {ctx,tables,rows,writes};
}
test('real create -> quantity edit -> delete restores original exact sale and cash values',()=>{
 const w=workbook();
 const create=w.ctx.completeReturn('t',{invoiceId:'INV1',
   items:[{productId:'P1',qty:2,price:100}],refundMethod:'Cash',date:'2026-09-21'});
 assert.equal(create.success,true,create.message);
 const id=create.data.returnId;
 assert.equal(w.rows('PRODUCTS')[0]['Current Stock'],7);
 assert.equal(w.rows('STOCK_LOTS')[0]['Remaining Quantity'],2);
 assert.equal(w.rows('SALE_ITEM_LOTS')[0].Quantity,3);
 assert.equal(w.rows('CASH_BOOK').filter(r=>!r['Is Deleted']).reduce((t,r)=>t+Number(r.Debit||0),0),200);
 const change=w.ctx.updateSalesReturn('t',{
   returnId:id,expectedVersion:0,operationId:'return-edit-integration-123',
   items:[{productId:'P1',qty:1,price:100}],refundMethod:'Cash',
   reason:'Customer returned 1',notes:'Recheck',date:'2026-09-21',editReason:'Wrong quantity'
 });
 assert.equal(change.success,true,change.message);
 assert.equal(w.rows('PRODUCTS')[0]['Current Stock'],6);
 assert.equal(w.rows('STOCK_LOTS')[0]['Remaining Quantity'],1);
 assert.equal(w.rows('SALE_ITEM_LOTS')[0].Quantity,4);
 assert.equal(w.rows('CASH_BOOK').filter(r=>!r['Is Deleted']).reduce((t,r)=>t+Number(r.Debit||0),0),100);
 assert.equal(w.ctx.activeSalesReturnItems_().filter(i=>i['Return ID']===id).length,1);
 const del=w.ctx.deleteSalesReturn('t',id,'Mistaken refund','return-delete-integration-123',1);
 assert.equal(del.success,true,del.message);
 assert.equal(w.rows('PRODUCTS')[0]['Current Stock'],5);
 assert.equal(w.rows('STOCK_LOTS')[0]['Remaining Quantity'],0);
 assert.equal(w.rows('SALE_ITEM_LOTS')[0].Quantity,5);
 assert.equal(w.rows('CASH_BOOK').filter(r=>!r['Is Deleted']).length,0);
 assert.equal(w.ctx.activeSalesReturnItems_().length,0);
 assert.equal(w.rows('DELETE_LOG').length,1);
 assert.equal(w.rows('SALE_POSTING_JOURNAL').every(x=>x.State==='Committed'),true);
});
