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
 for(const file of ['Utils.gs','CashBook.gs','CustomerSettlement.gs','StockLots.gs','Bundles.gs','SalesReturn.gs']){
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


test('real Store Credit return edit/delete preserves exact customer due and active ledger',()=>{
 const w=workbook();
 const create=w.ctx.completeReturn('t',{invoiceId:'INV1',
   items:[{productId:'P1',qty:2,price:100}],refundMethod:'Store Credit',date:'2026-09-21'});
 assert.equal(create.success,true,create.message);
 const id=create.data.returnId;
 assert.equal(w.rows('CUSTOMERS')[0]['Current Due'],-200);
 const edit=w.ctx.updateSalesReturn('t',{
   returnId:id,expectedVersion:0,operationId:'return-credit-edit-integration-123',
   items:[{productId:'P1',qty:1,price:100}],refundMethod:'Store Credit',
   reason:'Incorrect count',notes:'Reviewed',date:'2026-09-21',editReason:'Correction'
 });
 assert.equal(edit.success,true,edit.message);
 assert.equal(w.rows('CUSTOMERS')[0]['Current Due'],-100);
 assert.equal(w.rows('CUSTOMER_LEDGER').filter(r=>!r['Is Deleted']).reduce((sum,r)=>sum+Number(r.Credit||0),0),100);
 const del=w.ctx.deleteSalesReturn('t',id,'Wrong transaction','return-credit-delete-integration-123',1);
 assert.equal(del.success,true,del.message);
 assert.equal(w.rows('CUSTOMERS')[0]['Current Due'],0);
 assert.equal(w.rows('CUSTOMER_LEDGER').filter(r=>!r['Is Deleted']).length,0);
 assert.equal(w.rows('PRODUCTS')[0]['Current Stock'],5);
});
test('fallback returned lot with a unique source link can be edited and deleted',()=>{
 const w=workbook();
 w.rows('STOCK_LOTS')[0]['Purchase ID']='OVERSOLD';
 const create=w.ctx.completeReturn('t',{invoiceId:'INV1',
   items:[{productId:'P1',qty:2,price:100}],refundMethod:'Cash',date:'2026-09-21'});
 assert.equal(create.success,true,create.message);
 const id=create.data.returnId;
 const movements=w.rows('STOCK_MOVEMENT').filter(x=>x.Type==='Sales Return'&&x.Reference===id);
 assert.equal(movements.length,1);
 assert.ok(movements[0]['Source Consumption Link ID']);
 assert.notEqual(movements[0]['Lot ID'],'L1');
 const change=w.ctx.updateSalesReturn('t',{
   returnId:id,expectedVersion:0,operationId:'return-fallback-edit-integration-123',
   items:[{productId:'P1',qty:1,price:100}],refundMethod:'Cash',
   reason:'Incorrect count',notes:'Reviewed',date:'2026-09-21',editReason:'Correction'
 });
 assert.equal(change.success,true,change.message);
 assert.equal(w.rows('PRODUCTS')[0]['Current Stock'],6);
 const del=w.ctx.deleteSalesReturn('t',id,'Wrong transaction','return-fallback-delete-integration-123',1);
 assert.equal(del.success,true,del.message);
 assert.equal(w.rows('PRODUCTS')[0]['Current Stock'],5);
});


test('real Cash to Store Credit to Cash method changes never double-post refunds',()=>{
 const w=workbook();
 const create=w.ctx.completeReturn('t',{invoiceId:'INV1',
   items:[{productId:'P1',qty:2,price:100}],refundMethod:'Cash',date:'2026-09-21'});
 assert.equal(create.success,true,create.message);
 const id=create.data.returnId;
 const toCredit=w.ctx.updateSalesReturn('t',{
   returnId:id,expectedVersion:0,operationId:'return-cash-credit-switch-123',
   items:[{productId:'P1',qty:1,price:100}],refundMethod:'Store Credit',
   reason:'Changed refund arrangement',notes:'Credit accepted',date:'2026-09-21',editReason:'Refund method changed'
 });
 assert.equal(toCredit.success,true,toCredit.message);
 assert.equal(w.rows('CUSTOMERS')[0]['Current Due'],-100);
 assert.equal(w.rows('CASH_BOOK').filter(r=>!r['Is Deleted']).length,0);
 assert.equal(w.rows('CUSTOMER_LEDGER').filter(r=>!r['Is Deleted']).length,1);
 const toCash=w.ctx.updateSalesReturn('t',{
   returnId:id,expectedVersion:1,operationId:'return-credit-cash-switch-123',
   items:[{productId:'P1',qty:1,price:100}],refundMethod:'Cash',
   reason:'Changed again',notes:'Cash received',date:'2026-09-21',editReason:'Refund method corrected'
 });
 assert.equal(toCash.success,true,toCash.message);
 assert.equal(w.rows('CUSTOMERS')[0]['Current Due'],0);
 assert.equal(w.rows('CASH_BOOK').filter(r=>!r['Is Deleted']).reduce((sum,r)=>sum+Number(r.Debit||0),0),100);
 assert.equal(w.rows('CUSTOMER_LEDGER').filter(r=>!r['Is Deleted']).length,0);
 const done=w.ctx.deleteSalesReturn('t',id,'Return voided','return-switch-delete-123',2);
 assert.equal(done.success,true,done.message);
 assert.equal(w.rows('PRODUCTS')[0]['Current Stock'],5);
 assert.equal(w.rows('STOCK_LOTS')[0]['Remaining Quantity'],0);
 assert.equal(w.rows('CASH_BOOK').filter(r=>!r['Is Deleted']).length,0);
 assert.equal(w.rows('CUSTOMERS')[0]['Current Due'],0);
});


// End-to-end correction scenarios use the real SalesReturn/StockLots/CashBook
// production functions, with Sheets represented only by the workbook adapter.
function nonDeleted(w,key) {
 return w.rows(key).filter(row=>!w.ctx.isDeleted_(row));
}
function cashRefundTotal(w) {
 return nonDeleted(w,'CASH_BOOK').filter(row=>row.Type==='Sales Return')
   .reduce((s,row)=>s+Number(row.Debit||0),0);
}
function customerCreditTotal(w) {
 return nonDeleted(w,'CUSTOMER_LEDGER').filter(row=>row.Type==='Sales Return Credit')
   .reduce((s,row)=>s+Number(row.Credit||0),0);
}
function createReturnScenario(w,method,quantity,price=100) {
 const x=w.ctx.completeReturn('t',{
  invoiceId:'INV1',items:[{productId:'P1',qty:quantity,price:price}],
  refundMethod:method,date:'2026-09-21',reason:'Original return'
 });
 assert.equal(x.success,true,x.message);
 return x.data.returnId;
}
function editReturnScenario(w,id,version,method,quantity,price,operationId) {
 return w.ctx.updateSalesReturn('t',{
   returnId:id,expectedVersion:version,operationId:operationId,
   items:[{productId:'P1',qty:quantity,price:price}],
   refundMethod:method,date:'2026-09-21',
   reason:'Corrected return',notes:'Audited by operator',
   editReason:'Verified correction'
 });
}
function assertAccounting(w,{refund,credit,due,stock,qty,version,id}) {
 assert.equal(cashRefundTotal(w),refund,'active Cash Book cash refund');
 assert.equal(w.ctx.getCashBalance_(),refund === 0 ? 0 : -refund,'live physical cash balance from CashBook.gs');
 assert.equal(customerCreditTotal(w),credit,'customer ledger credit amount');
 assert.equal(w.rows('CUSTOMERS')[0]['Current Due'],due,'customer current due / available credit');
 assert.equal(w.rows('PRODUCTS')[0]['Current Stock'],stock,'physical product stock');
 assert.equal(w.rows('STOCK_LOTS')[0]['Remaining Quantity'],stock-5,'physical original lot');
 assert.equal(w.rows('SALE_ITEM_LOTS')[0].Quantity,10-stock,'original sale consumption');
 if(id) {
  const header=nonDeleted(w,'SALES_RETURN').find(row=>row['Return ID']===id);
  assert.ok(header,'active Sales Return header');
  assert.equal(Number(header['Edit Version']||0),version,'edit version');
  const lines=nonDeleted(w,'SALES_RETURN_ITEMS').filter(row=>row['Return ID']===id);
  assert.equal(lines.length,1,'only one active corrected return line');
  assert.equal(Number(lines[0]['Return Quantity']),qty,'corrected return quantity');
 }
}
test('Cash → Customer Credit: original cash outflow is reversed, customer balance gains the SAME value, stock unchanged',()=>{
 const w=workbook(),id=createReturnScenario(w,'Cash',2,100);
 assertAccounting(w,{refund:200,credit:0,due:0,stock:7,qty:2,version:0,id});
 const movements=w.rows('STOCK_MOVEMENT').length;
 const beforeCashEntries=w.rows('CASH_BOOK').length;
 const x=editReturnScenario(w,id,0,'Store Credit',2,100,'cash-to-credit-unchanged-qty');
 assert.equal(x.success,true,x.message);
 assertAccounting(w,{refund:0,credit:200,due:-200,stock:7,qty:2,version:1,id});
 assert.equal(w.rows('STOCK_MOVEMENT').length,movements,'method change does not move stock');
 assert.equal(w.rows('CASH_BOOK').length,beforeCashEntries,'no new cash outgoing row');
 assert.equal(w.rows('CASH_BOOK')[0]['Is Deleted'],'TRUE','old refund retains audit trace');
 assert.equal(nonDeleted(w,'CUSTOMER_LEDGER')[0]['Reference'],id);
 assert.equal(nonDeleted(w,'CUSTOMER_LEDGER')[0]['Type'],'Sales Return Credit');
 assert.equal(nonDeleted(w,'CUSTOMER_LEDGER')[0]['Credit'],200);
});
test('Cash → Customer Credit with lower price: cash returns entirely, credit is the new amount (not old amount)',()=>{
 const w=workbook(),id=createReturnScenario(w,'Cash',2,100);
 const x=editReturnScenario(w,id,0,'Store Credit',2,65,'cash-to-credit-price-reduction');
 assert.equal(x.success,true,x.message);
 assertAccounting(w,{refund:0,credit:130,due:-130,stock:7,qty:2,version:1,id});
 assert.equal(w.rows('SALES_RETURN')[0]['Total Return Amount'],130);
});
test('Cash → Customer Credit adjusts an already owed customer balance instead of creating imaginary cash',()=>{
 const w=workbook();w.rows('CUSTOMERS')[0]['Current Due']=250;
 const id=createReturnScenario(w,'Cash',2,100);
 assert.equal(w.rows('CUSTOMERS')[0]['Current Due'],250);
 const x=editReturnScenario(w,id,0,'Store Credit',2,75,'cash-to-credit-offsets-existing-due');
 assert.equal(x.success,true,x.message);
 assertAccounting(w,{refund:0,credit:150,due:100,stock:7,qty:2,version:1,id});
});
test('Cash → Customer Credit with increased returned quantity reverses cash and restores correct net stock',()=>{
 const w=workbook(),id=createReturnScenario(w,'Cash',1,100);
 const x=editReturnScenario(w,id,0,'Store Credit',3,100,'cash-to-credit-quantity-increase');
 assert.equal(x.success,true,x.message);
 assertAccounting(w,{refund:0,credit:300,due:-300,stock:8,qty:3,version:1,id});
});
test('Customer Credit → Cash: removes credit, restores customer due and pays out exact cash',()=>{
 const w=workbook(),id=createReturnScenario(w,'Store Credit',2,100);
 assertAccounting(w,{refund:0,credit:200,due:-200,stock:7,qty:2,version:0,id});
 const x=editReturnScenario(w,id,0,'Cash',2,100,'credit-to-cash-unchanged-qty');
 assert.equal(x.success,true,x.message);
 assertAccounting(w,{refund:200,credit:0,due:0,stock:7,qty:2,version:1,id});
 assert.equal(nonDeleted(w,'CUSTOMER_LEDGER').length,0,'previous customer credit no longer active');
});
test('Customer Credit → Cash at reduced price restores the old credit and creates only the new cash refund',()=>{
 const w=workbook(),id=createReturnScenario(w,'Store Credit',2,100);
 const x=editReturnScenario(w,id,0,'Cash',2,75,'credit-to-cash-price-reduction');
 assert.equal(x.success,true,x.message);
 assertAccounting(w,{refund:150,credit:0,due:0,stock:7,qty:2,version:1,id});
});
test('Customer Credit quantity/price edit does not post Cash; due equals amended credit',()=>{
 const w=workbook(),id=createReturnScenario(w,'Store Credit',2,100);
 const x=editReturnScenario(w,id,0,'Store Credit',1,60,'credit-price-and-quantity-update');
 assert.equal(x.success,true,x.message);
 assertAccounting(w,{refund:0,credit:60,due:-60,stock:6,qty:1,version:1,id});
});
test('Cash price-only edit does not change stock or sale lot consumption and refunds exactly revised amount',()=>{
 const w=workbook(),id=createReturnScenario(w,'Cash',2,100);
 const lots=w.rows('STOCK_LOTS')[0]['Remaining Quantity'];
 const moves=w.rows('STOCK_MOVEMENT').length;
 const x=editReturnScenario(w,id,0,'Cash',2,35,'cash-price-only-correction');
 assert.equal(x.success,true,x.message);
 assertAccounting(w,{refund:70,credit:0,due:0,stock:7,qty:2,version:1,id});
 assert.equal(w.rows('STOCK_LOTS')[0]['Remaining Quantity'],lots);
 assert.equal(w.rows('STOCK_MOVEMENT').length,moves);
});
test('Delete after Cash → Customer Credit removes credit, restores due and reverses entire returned stock exactly once',()=>{
 const w=workbook(),id=createReturnScenario(w,'Cash',2,100);
 assert.equal(editReturnScenario(w,id,0,'Store Credit',2,100,'cash-to-credit-before-delete').success,true);
 const out=w.ctx.deleteSalesReturn('t',id,'Wrong return','delete-credit-after-cash-123',1);
 assert.equal(out.success,true,out.message);
 assertAccounting(w,{refund:0,credit:0,due:0,stock:5});
 assert.equal(nonDeleted(w,'SALES_RETURN').length,0);
 assert.equal(nonDeleted(w,'SALES_RETURN_ITEMS').length,0);
 assert.equal(w.rows('DELETE_LOG').length,1);
 const previousWrites=w.writes.length;
 const replay=w.ctx.deleteSalesReturn('t',id,'Wrong return','delete-credit-after-cash-123',1);
 assert.equal(replay.success,true,replay.message);
 assert.equal(w.writes.length,previousWrites,'delete replay does not mutate Sheets');
});
test('Delete after Customer Credit → Cash reverses Cash refund and all returned stock',()=>{
 const w=workbook(),id=createReturnScenario(w,'Store Credit',2,100);
 assert.equal(editReturnScenario(w,id,0,'Cash',2,80,'credit-to-cash-before-delete').success,true);
 const out=w.ctx.deleteSalesReturn('t',id,'Wrong return','delete-cash-after-credit-123',1);
 assert.equal(out.success,true,out.message);
 assertAccounting(w,{refund:0,credit:0,due:0,stock:5});
 assert.equal(nonDeleted(w,'CASH_BOOK').length,0);
 assert.equal(nonDeleted(w,'CUSTOMER_LEDGER').length,0);
});
test('Delete of original Cash refund without edit restores cash and inventory',()=>{
 const w=workbook(),id=createReturnScenario(w,'Cash',2,100);
 const out=w.ctx.deleteSalesReturn('t',id,'Duplicate return','delete-unedited-cash-123',0);
 assert.equal(out.success,true,out.message);
 assertAccounting(w,{refund:0,credit:0,due:0,stock:5});
 assert.equal(w.rows('STOCK_MOVEMENT').filter(x=>x['Reversed By']).length,1);
});
test('Delete of original Customer Credit refund restores the customer due and inventory',()=>{
 const w=workbook(),id=createReturnScenario(w,'Store Credit',2,100);
 const out=w.ctx.deleteSalesReturn('t',id,'Duplicate return','delete-unedited-credit-123',0);
 assert.equal(out.success,true,out.message);
 assertAccounting(w,{refund:0,credit:0,due:0,stock:5});
 assert.equal(w.rows('DELETE_LOG').length,1);
});
test('Repeated method corrections never accumulate inactive Cash/Customer Credit as live balance',()=>{
 const w=workbook(),id=createReturnScenario(w,'Cash',2,100);
 const methods=['Store Credit','Cash','Store Credit','Cash','Store Credit'];
 methods.forEach((method,i)=>{
  const result=editReturnScenario(w,id,i,method,2,90,'repeat-method-change-'+(i+1)+'-2026');
  assert.equal(result.success,true,result.message);
  assertAccounting(w,{
   refund:method==='Cash'?180:0,credit:method==='Store Credit'?180:0,
   due:method==='Store Credit'?-180:0,stock:7,qty:2,version:i+1,id
  });
 });
 assert.equal(w.rows('INVOICE_EDIT_LOG').length,5,'audit log retained for every edit');
 assert.equal(nonDeleted(w,'SALES_RETURN_ITEMS').length,1);
 assert.equal(nonDeleted(w,'CASH_BOOK').length,0);
 assert.equal(nonDeleted(w,'CUSTOMER_LEDGER').length,1);
});
test('Second active return on same invoice survives edit/deletion of the first and cash totals never duplicate',()=>{
 const w=workbook(),first=createReturnScenario(w,'Cash',1,100),second=createReturnScenario(w,'Cash',1,100);
 const priorSecond=JSON.stringify(nonDeleted(w,'SALES_RETURN').filter(x=>x['Return ID']===second));
 const move=editReturnScenario(w,first,0,'Store Credit',2,100,'edit-first-of-two-returns-123');
 assert.equal(move.success,true,move.message);
 assert.equal(cashRefundTotal(w),100,'only second Cash return remains');
 assert.equal(w.ctx.getCashBalance_(),-100);
 assert.equal(customerCreditTotal(w),200,'edited first return becomes credit');
 assert.equal(w.rows('CUSTOMERS')[0]['Current Due'],-200);
 assert.equal(w.rows('PRODUCTS')[0]['Current Stock'],8,'two plus one units returned');
 assert.equal(JSON.stringify(nonDeleted(w,'SALES_RETURN').filter(x=>x['Return ID']===second)),priorSecond);
 const del=w.ctx.deleteSalesReturn('t',first,'Reversal','delete-first-of-two-returns-123',1);
 assert.equal(del.success,true,del.message);
 assert.equal(cashRefundTotal(w),100);
 assert.equal(customerCreditTotal(w),0);
 assert.equal(w.rows('CUSTOMERS')[0]['Current Due'],0);
 assert.equal(w.rows('PRODUCTS')[0]['Current Stock'],6,'second return inventory remains');
 assert.equal(nonDeleted(w,'SALES_RETURN').length,1);
 assert.equal(nonDeleted(w,'SALES_RETURN')[0]['Return ID'],second);
});
test('editing credit to cash is allowed even if collected cash is less than return value',()=>{
 const w=workbook(),id=createReturnScenario(w,'Store Credit',2,100);
 w.ctx.customerInvoiceCashCollected_=()=>0;
 const edit=editReturnScenario(w,id,0,'Cash',2,100,'over-refund-with-approval-123');
 assert.equal(edit.success,true,edit.message);
 assertAccounting(w,{refund:200,credit:0,due:0,stock:7,qty:2,version:1,id});
});
test('Orphan or deleted original Cash Book evidence blocks refund reclassification before writes',()=>{
 const w=workbook(),id=createReturnScenario(w,'Cash',2,100);
 w.rows('CASH_BOOK')[0]['Is Deleted']='TRUE';
 const writes=w.writes.length;
 const edit=editReturnScenario(w,id,0,'Store Credit',2,100,'missing-cash-source-123');
 assert.equal(edit.success,false);
 assert.match(edit.message,/cash|evidence/i);
 assert.equal(w.writes.length,writes);
 assert.equal(customerCreditTotal(w),0);
 assert.equal(w.rows('SALES_RETURN')[0]['Refund Method'],'Cash');
});
test('Downstream customer payment forbids editing spent Store Credit before any mutation',()=>{
 const w=workbook(),id=createReturnScenario(w,'Store Credit',2,100);
 w.rows('CUSTOMER_LEDGER').push({'Ledger ID':'PM2','Customer ID':'C1','Type':'Payment','Reference':'PM2','Credit':20});
 const writes=w.writes.length;
 const edit=editReturnScenario(w,id,0,'Cash',2,100,'spent-credit-no-reversal-123');
 assert.equal(edit.success,false);
 assert.match(edit.message,/later|settlement|reconcil/i);
 assert.equal(w.writes.length,writes);
 assert.equal(w.rows('CUSTOMERS')[0]['Current Due'],-200);
 assert.equal(cashRefundTotal(w),0);
});
test('Stale version and changed operation payload both reject repeated edits without any second debit/credit',()=>{
 const w=workbook(),id=createReturnScenario(w,'Cash',2,100);
 const op='same-operation-id-12345678';
 assert.equal(editReturnScenario(w,id,0,'Store Credit',2,100,op).success,true);
 const writes=w.writes.length;
 const stale=editReturnScenario(w,id,0,'Cash',2,100,'second-stale-version-123');
 assert.equal(stale.success,false);
 assert.match(stale.message,/version|changed|reload/i);
 const changed=editReturnScenario(w,id,0,'Store Credit',2,80,op);
 assert.equal(changed.success,false);
 assert.match(changed.message,/conflict|review|hash|payload/i);
 assert.equal(w.writes.length,writes);
 assertAccounting(w,{refund:0,credit:200,due:-200,stock:7,qty:2,version:1,id});
});


const correctionMatrix = [
 {quantity:1,price:50,total:50,stock:6},
 {quantity:1,price:100,total:100,stock:6},
 {quantity:2,price:50,total:100,stock:7},
 {quantity:2,price:100,total:200,stock:7},
 {quantity:3,price:50,total:150,stock:8},
 {quantity:3,price:100,total:300,stock:8}
];
for (const originalMethod of ['Cash','Store Credit']) {
 for (const correctedMethod of ['Cash','Store Credit']) {
  for (const v of correctionMatrix) {
   test('refund method/quantity/price/delete matrix: '+originalMethod+' → '+correctedMethod+
     ', '+v.quantity+' pcs at '+v.price,()=>{
    const w=workbook(),id=createReturnScenario(w,originalMethod,2,100);
    const operationId='matrix-'+(originalMethod==='Cash'?'cash':'credit')+'-'+
      (correctedMethod==='Cash'?'cash':'credit')+'-'+v.quantity+'-'+v.price+'-2026';
    const result=editReturnScenario(w,id,0,correctedMethod,v.quantity,v.price,operationId);
    assert.equal(result.success,true,result.message);
    assertAccounting(w,{
      refund:correctedMethod==='Cash'?v.total:0,
      credit:correctedMethod==='Store Credit'?v.total:0,
      due:correctedMethod==='Store Credit'?-v.total:0,
      stock:v.stock,qty:v.quantity,version:1,id
    });
    const audit=w.rows('INVOICE_EDIT_LOG');
    assert.equal(audit.length,1,'exactly one edit-audit row');
    assert.equal(audit[0]['Before Return Amount'],200);
    assert.equal(audit[0]['After Return Amount'],v.total);
    const removed=w.ctx.deleteSalesReturn('t',id,'Cancel incorrect return',
      'matrix-delete-'+operationId,1);
    assert.equal(removed.success,true,removed.message);
    assertAccounting(w,{refund:0,credit:0,due:0,stock:5});
    assert.equal(nonDeleted(w,'SALES_RETURN').length,0,'return deleted in effective history');
    assert.equal(nonDeleted(w,'SALES_RETURN_ITEMS').length,0,'return children deleted from active totals');
    assert.equal(w.rows('INVOICE_EDIT_LOG').length,1,'pre-delete edit audit remains');
    assert.equal(w.rows('DELETE_LOG').length,1,'delete audit logged');
   });
  }
 }
}

function seedSecondInvoice(w) {
 w.rows('SALES').push({
  'Invoice ID':'INV2','Date':'2026-09-10','Created At':'2026-09-10T11:00:00',
  'Customer ID':'C1','Customer Name':'Buyer','Customer Phone':'01700000000',
  Subtotal:200,'Grand Total':200,'Paid Amount':200,'Due Amount':0,'Payment Method':'Cash',
  'Payment Status':'Paid'
 });
 w.rows('SALE_ITEMS').push({
  'Invoice ID':'INV2','Product ID':'P1','Product Name':'Widget',
  Quantity:2,'Unit Price':100,'Line Total':200
 });
 w.rows('STOCK_LOTS').push({
  'Lot ID':'L2','Product ID':'P1','Product Name':'Widget','Purchase ID':'PO2',
  'Purchase Price':40,'Original Quantity':2,'Remaining Quantity':0,
  Status:'Active','Created At':'2026-09-01T09:00:00'
 });
 w.rows('SALE_ITEM_LOTS').push({
  'Invoice ID':'INV2','Product ID':'P1','Lot ID':'L2',
  Quantity:2,'Source Sale Product ID':'P1','Supplier ID':''
 });
}
test('multi-invoice Cash batch: one child can be deleted without affecting sibling refund, stock or batch total',()=>{
 const w=workbook();seedSecondInvoice(w);
 const result=w.ctx.completeReturnBatch('t',{
   invoiceReturns:[
    {invoiceId:'INV1',items:[{productId:'P1',qty:1,price:100}]},
    {invoiceId:'INV2',items:[{productId:'P1',qty:1,price:100}]}
   ],
   refundMethod:'Cash',date:'2026-09-21',reason:'Batch customer return'
 });
 assert.equal(result.success,true,result.message);
 assert.equal(result.data.returnIds.length,2);
 const [first,second]=result.data.returnIds;
 assert.equal(w.ctx.getCashBalance_(),-200);
 assert.equal(w.rows('PRODUCTS')[0]['Current Stock'],7);
 assert.equal(w.rows('STOCK_LOTS')[0]['Remaining Quantity'],1);
 assert.equal(w.rows('STOCK_LOTS')[1]['Remaining Quantity'],1);
 const batchId=result.data.batchId;
 const initial=w.ctx.getReturnBatchDetail('t',batchId);
 assert.equal(initial.success,true,initial.message);
 assert.equal(initial.data.children.length,2);
 assert.equal(initial.data.batchTotal,200);
 const del=w.ctx.deleteSalesReturn('t',first,'Delete one mistaken batch child','delete-batch-first-child-123',0);
 assert.equal(del.success,true,del.message);
 assert.equal(w.ctx.getCashBalance_(),-100);
 assert.equal(w.rows('PRODUCTS')[0]['Current Stock'],6);
 assert.equal(w.rows('STOCK_LOTS')[0]['Remaining Quantity'],0);
 assert.equal(w.rows('STOCK_LOTS')[1]['Remaining Quantity'],1);
 assert.equal(nonDeleted(w,'SALES_RETURN').length,1);
 assert.equal(nonDeleted(w,'SALES_RETURN')[0]['Return ID'],second);
 const after=w.ctx.getReturnBatchDetail('t',batchId);
 assert.equal(after.success,true,after.message);
 assert.equal(after.data.children.length,1);
 assert.equal(after.data.batchTotal,100);
 assert.equal(after.data.children[0].header['Return ID'],second);
});
test('multi-invoice Cash batch must not silently become mixed-method when one child is edited to credit',()=>{
 const w=workbook();seedSecondInvoice(w);
 const batch=w.ctx.completeReturnBatch('t',{
   invoiceReturns:[
    {invoiceId:'INV1',items:[{productId:'P1',qty:1,price:100}]},
    {invoiceId:'INV2',items:[{productId:'P1',qty:1,price:100}]}
   ],
   refundMethod:'Cash',date:'2026-09-21',reason:'Batch test'
 });
 assert.equal(batch.success,true,batch.message);
 const id=batch.data.returnIds[0],before=w.writes.length;
 const attempt=w.ctx.updateSalesReturn('t',{
  returnId:id,expectedVersion:0,operationId:'batch-child-cash-to-credit-123',
  items:[{productId:'P1',qty:1,price:100}],refundMethod:'Store Credit',
  date:'2026-09-21',editReason:'Refund method revision'
 });
 assert.equal(attempt.success,false,'mixed-method batch requires explicit support or rejection');
 assert.match(attempt.message,/batch|mixed|refund method/i);
 assert.equal(w.writes.length,before,'fail before any stock/cash/customer writes');
 assert.equal(w.ctx.getCashBalance_(),-200);
 assert.equal(customerCreditTotal(w),0);
});
test('editing original quantity after return lot has been sold is rejected, but price-only correction is safe',()=>{
 const w=workbook(),id=createReturnScenario(w,'Cash',2,100);
 w.rows('PRODUCTS')[0]['Current Stock']=5;
 w.rows('STOCK_LOTS')[0]['Remaining Quantity']=0;
 const writes=w.writes.length;
 const reject=editReturnScenario(w,id,0,'Store Credit',1,80,'stock-consumed-qty-change-123');
 assert.equal(reject.success,false);
 assert.match(reject.message,/stock|lot|consum/i);
 assert.equal(w.writes.length,writes);
 const priceOnly=editReturnScenario(w,id,0,'Store Credit',2,80,'stock-consumed-price-only-123');
 assert.equal(priceOnly.success,true,priceOnly.message);
 assert.equal(w.rows('PRODUCTS')[0]['Current Stock'],5);
 assert.equal(w.rows('STOCK_LOTS')[0]['Remaining Quantity'],0);
 assert.equal(w.ctx.getCashBalance_(),0);
 assert.equal(w.rows('CUSTOMERS')[0]['Current Due'],-160);
 const deleteResult=w.ctx.deleteSalesReturn('t',id,'Cannot reverse consumed stock','delete-after-stock-resold-123',1);
 assert.equal(deleteResult.success,false);
 assert.match(deleteResult.message,/stock|lot|consum/i);
});
test('Cash Book opening asset is restored on Cash → Customer Credit, not just a zero-balance artifact',()=>{
 const w=workbook();
 w.rows('CASH_BOOK').push({
  'Entry ID':'OPEN1','Type':'Historical Opening','Reference':'BASE',
  'Credit':1500,'Debit':'','Balance':1500
 });
 assert.equal(w.ctx.getCashBalance_(),1500);
 const id=createReturnScenario(w,'Cash',2,100);
 assert.equal(w.ctx.getCashBalance_(),1300);
 const edit=editReturnScenario(w,id,0,'Store Credit',2,75,'opening-cash-to-credit-reversal');
 assert.equal(edit.success,true,edit.message);
 assert.equal(w.ctx.getCashBalance_(),1500,'cash asset fully restored');
 assert.equal(w.rows('CUSTOMERS')[0]['Current Due'],-150,'customer now has 150 store credit');
 assert.equal(customerCreditTotal(w),150);
 assert.equal(cashRefundTotal(w),0);
 const removed=w.ctx.deleteSalesReturn('t',id,'Void return','delete-opening-cash-return-123',1);
 assert.equal(removed.success,true,removed.message);
 assert.equal(w.ctx.getCashBalance_(),1500);
 assert.equal(w.rows('CUSTOMERS')[0]['Current Due'],0);
 assert.equal(w.rows('PRODUCTS')[0]['Current Stock'],5);
});
test('closed historical Cash Session denies return edit/delete before writing any business row',()=>{
 const w=workbook(),id=createReturnScenario(w,'Cash',2,100);
 vm.runInContext(source('CashSession.gs'),w.ctx,{filename:'CashSession.gs'});
 w.ctx.requireActiveCashSession_=()=>true; // exercise the historical-session gate specifically
 w.rows('CASH_SESSIONS').push({
  'Session ID':'CS1','Opened At':'2026-09-01T00:00:00',
  'Status':'Closed','Closed At':'2026-10-01T00:00:00'
 });
 const previous=w.writes.length;
 const edit=editReturnScenario(w,id,0,'Store Credit',2,100,'closed-session-edit-123');
 assert.equal(edit.success,false);
 assert.match(edit.message,/closed|session|reconciliation/i);
 const deletion=w.ctx.deleteSalesReturn('t',id,'Correction','closed-session-delete-123',0);
 assert.equal(deletion.success,false);
 assert.match(deletion.message,/closed|session|reconciliation/i);
 assert.equal(w.writes.length,previous);
 assert.equal(w.ctx.getCashBalance_(),-200);
});
test('operator cannot edit above original sold effective price or return beyond original quantity',()=>{
 const w=workbook(),id=createReturnScenario(w,'Cash',2,100);
 const previous=w.writes.length;
 const overPrice=editReturnScenario(w,id,0,'Store Credit',2,110,'over-original-sale-price-123');
 assert.equal(overPrice.success,false);
 assert.match(overPrice.message,/price|sold|invoice/i);
 const overQty=editReturnScenario(w,id,0,'Store Credit',6,100,'over-original-sale-quantity-123');
 assert.equal(overQty.success,false);
 assert.match(overQty.message,/available|quantity|sold/i);
 assert.equal(w.writes.length,previous);
 assert.equal(w.ctx.getCashBalance_(),-200);
});
test('delete permission expiry and edit permission denial are validated before business writes',()=>{
 const w=workbook(),id=createReturnScenario(w,'Cash',2,100);
 let edited=false,deleted=false;
 w.ctx.requirePermission_=(_token,_module,action)=>{
   if(action==='edit'){edited=true;throw new Error('Permission denied for edit');}
   return {'User ID':'U1','Full Name':'Operator'};
 };
 w.ctx.requireDeletePermission_=()=>{deleted=true;throw new Error('Delete outside allowed window');};
 const writes=w.writes.length;
 const attempt=editReturnScenario(w,id,0,'Store Credit',2,100,'unauthorized-credit-edit-123');
 assert.equal(attempt.success,false);
 assert.match(attempt.message,/permission/i);
 const remove=w.ctx.deleteSalesReturn('t',id,'Incorrect','unauthorized-delete-return-123',0);
 assert.equal(remove.success,false);
 assert.match(remove.message,/delete|window/i);
 assert.equal(edited,true);
 assert.equal(deleted,true);
 assert.equal(w.writes.length,writes);
});


test('real Cash Session summary restores original drawer cash after Cash → Customer Credit',()=>{
 const w=workbook();
 w.rows('CASH_SESSIONS').push({
   'Session ID':'CS1','Date':'2026-09-20','Opened At':'2026-09-20T00:00:00',
   'Opening Cash':1500,'Status':'Open','Counted Cash':'','Notes':'Open test drawer'
 });
 w.rows('CASH_BOOK').push({
   'Entry ID':'CB-SESSION-OPEN','Type':'Session Open','Reference':'CS1',
   'Credit':1500,'Debit':'','Balance':1500,'Date':'2026-09-20',
   'Created At':'2026-09-20T00:00:00'
 });
 const id=createReturnScenario(w,'Cash',2,100);
 vm.runInContext(source('CashSession.gs'),w.ctx,{filename:'CashSession.gs'});
 w.ctx.requireActiveCashSession_=()=>true; // leave normal transaction guard mocked; session summary is real
 const before=w.ctx.getCashSessionSummary('t');
 assert.equal(before.success,true,before.message);
 assert.equal(before.data.cashOut,200,'original refund is in this drawer outflow');
 assert.equal(before.data.expectedCash,1300,'1500 less 200 original refund');
 assert.equal(w.ctx.getCashBalance_(),1300);
 const conversion=editReturnScenario(w,id,0,'Store Credit',2,100,'session-cash-to-credit-123');
 assert.equal(conversion.success,true,conversion.message);
 const after=w.ctx.getCashSessionSummary('t');
 assert.equal(after.success,true,after.message);
 assert.equal(after.data.cashOut,0,'voided cash refund is not counted as session cash out');
 assert.equal(after.data.expectedCash,1500,'whole cash refund is restored to session');
 assert.equal(w.ctx.getCashBalance_(),1500);
 assert.equal(w.rows('CUSTOMERS')[0]['Current Due'],-200);
 assert.equal(customerCreditTotal(w),200);
 const done=w.ctx.deleteSalesReturn('t',id,'Cancel refund','session-credit-delete-123',1);
 assert.equal(done.success,true,done.message);
 const afterDelete=w.ctx.getCashSessionSummary('t');
 assert.equal(afterDelete.success,true,afterDelete.message);
 assert.equal(afterDelete.data.expectedCash,1500);
 assert.equal(w.rows('CUSTOMERS')[0]['Current Due'],0);
 assert.equal(w.rows('PRODUCTS')[0]['Current Stock'],5);
});
test('partial-write fault during Cash → Credit is journaled Needs Review and cannot double-post on retry',()=>{
 const w=workbook(),id=createReturnScenario(w,'Cash',2,100);
 const origUpdate=w.ctx.updateRowFields_;
 let injected=false;
 w.ctx.updateRowFields_=(k,index,fields)=>{
   if(k==='CUSTOMERS' && !injected){injected=true;throw new Error('Injected Sheets customer update failure');}
   return origUpdate(k,index,fields);
 };
 const op='injected-cash-to-credit-123';
 const first=editReturnScenario(w,id,0,'Store Credit',2,100,op);
 assert.equal(first.success,false);
 assert.equal(injected,true);
 assert.equal(w.rows('SALE_POSTING_JOURNAL').length,1,'journal reservation persists');
 assert.equal(w.rows('SALE_POSTING_JOURNAL')[0].State,'Needs Review');
 assert.equal(w.ctx.getCashBalance_(),0,'old Cash refund may already be reversed at interrupted stage');
 assert.equal(customerCreditTotal(w),0,'failed Customer Credit has not been posted');
 w.ctx.updateRowFields_=origUpdate;
 const writes=w.writes.length;
 const retry=editReturnScenario(w,id,0,'Store Credit',2,100,op);
 assert.equal(retry.success,false,'retry refuses uncertain partly written state');
 assert.match(retry.message,/review|interrupted/i);
 assert.equal(w.writes.length,writes,'retry never repeats refund or customer ledger write');
 const other=editReturnScenario(w,id,0,'Store Credit',2,100,'different-op-after-uncertain-123');
 assert.equal(other.success,false);
 assert.match(other.message,/review|interrupted/i);
 assert.equal(w.writes.length,writes);
});
test('partial-write fault during Return Delete is journaled Needs Review and never double-reverses stock',()=>{
 const w=workbook(),id=createReturnScenario(w,'Cash',2,100);
 const origDelete=w.ctx.markMatchingDeleted_;
 let injected=false;
 w.ctx.markMatchingDeleted_=(k,predicate,operator,reason,now)=>{
   if(k==='CASH_BOOK' && !injected){injected=true;throw new Error('Injected Sheets refund reversal failure');}
   return origDelete(k,predicate,operator,reason,now);
 };
 const op='delete-fault-stock-reversed-123';
 const first=w.ctx.deleteSalesReturn('t',id,'Wrong return',op,0);
 assert.equal(first.success,false);
 assert.equal(injected,true);
 assert.equal(w.rows('SALE_POSTING_JOURNAL').length,1);
 assert.equal(w.rows('SALE_POSTING_JOURNAL')[0].State,'Needs Review');
 const postFaultStock=w.rows('PRODUCTS')[0]['Current Stock'];
 assert.equal(postFaultStock,5,'the stock leg may have posted before the refund failure');
 assert.equal(w.ctx.getCashBalance_(),-200,'Cash refund leg has not posted yet');
 w.ctx.markMatchingDeleted_=origDelete;
 const writes=w.writes.length;
 const retry=w.ctx.deleteSalesReturn('t',id,'Wrong return',op,0);
 assert.equal(retry.success,false);
 assert.match(retry.message,/review|interrupted/i);
 assert.equal(w.writes.length,writes,'no duplicate stock reversal');
 const another=w.ctx.deleteSalesReturn('t',id,'Wrong return','another-delete-after-fault-123',0);
 assert.equal(another.success,false);
 assert.match(another.message,/review|interrupted/i);
 assert.equal(w.writes.length,writes);
});
