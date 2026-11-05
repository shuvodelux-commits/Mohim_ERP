'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const code=fs.readFileSync(path.resolve(__dirname,'..','SalesReturn.gs'),'utf8');
function fixture(mode='Cash'){
 const tables={
  SALES_RETURN:[{'Return ID':'R1','Invoice ID':'INV1','Customer ID':'C1','Refund Method':mode,'Total Return Amount':100,'Date':'2026-11-02','Created At':'2026-11-02T10:00:00','Edit Version':0,'Batch ID':'B1'}],
  SALES_RETURN_ITEMS:[{'Return ID':'R1','Invoice ID':'INV1','Product ID':'P1','Return Quantity':1,'Return Price':100,'Line Total':100}],
  CASH_BOOK:mode==='Cash'?[{'Entry ID':'CB1','Type':'Sales Return','Reference':'R1','Debit':100}]:[],
  CUSTOMER_LEDGER:mode==='Store Credit'?[{'Ledger ID':'CL1','Type':'Sales Return Credit','Reference':'R1','Credit':100}]:[],
  CUSTOMERS:[{'Customer ID':'C1','Current Due':-100,'Customer Name':'Buyer'}],
  SALE_POSTING_JOURNAL:[],INVOICE_EDIT_LOG:[]
 };
 let lock=false,writes=0, failAt=Infinity;const ctx=vm.createContext({Date,Math,JSON,console,CONFIG:{LOCK_TIMEOUT_MS:1000}});
 vm.runInContext(code,ctx);
 const rows=k=>tables[k]||(tables[k]=[]);
 Object.assign(ctx,{
  LockService:{getScriptLock:()=>({waitLock:()=>{assert.equal(lock,false);lock=true;},releaseLock:()=>{lock=false;}})},
  getAllRows_:k=>rows(k).map((r,i)=>({...r,_rowIndex:i+2})),
  activeRows_:k=>ctx.getAllRows_(k).filter(r=>r['Is Deleted']!=='TRUE'),
  isDeleted_:r=>String(r&&r['Is Deleted']||'')==='TRUE',
  sanitizeInput_:v=>String(v==null?'':v).trim(),
  actorName_:()=> 'Operator',roundMoney_:n=>Math.round(n*100)/100,
  salePostingPayloadHash_:p=>JSON.stringify(p),
  salePostingJournalDecision_:(row,hash)=>{if(row['Payload Hash']!==hash)throw Error('Hash conflict');return row.State==='Committed'?'replay':'review';},
  requirePermission_:()=>({'User ID':'U1','Full Name':'Operator'}),
  logError_:()=>{},ok_:d=>({success:true,data:d}),fail_:m=>({success:false,message:m}),
  findRowIndex_:(k,c,v)=>rows(k).findIndex(r=>r[c]===v)+2,
  generateId_:k=>k+'-'+(rows(k).length+1),
  appendRow_:(k,r)=>{if(++writes===failAt)throw Error('Injected Sheets failure');rows(k).push({...r});},
  appendRows_:(k,vals)=>vals.forEach(v=>ctx.appendRow_(k,v)),
  updateRowFields_:(k,i,fields)=>{if(++writes===failAt)throw Error('Injected Sheets failure');Object.assign(rows(k)[i-2],fields);},
  markMatchingDeleted_:(k,pred,actor,reason,when)=>{let count=0;ctx.getAllRows_(k).filter(r=>!r['Is Deleted']&&pred(r)).forEach(r=>{ctx.updateRowFields_(k,r._rowIndex,{'Is Deleted':'TRUE','Delete Reason':reason});count++;});return count;},
  addCashBookEntry_:r=>ctx.appendRow_('CASH_BOOK',r),
  applySalesReturnStockUndo_:()=>{throw Error('price-only edit should not move stock');},
  prepareSalesReturnChange_:()=>({
    original:{...rows('SALES_RETURN')[0],_rowIndex:2},invoiceId:'INV1',version:0,needsStockChange:false,
    moneyUndo:mode==='Cash'?{kind:'Cash',amount:100,rowIndex:2}:{kind:'Store Credit',amount:100,rowIndex:2,customerId:'C1',customer:{...rows('CUSTOMERS')[0],_rowIndex:2}},
    replacement:{totalReturnAmount:80,refundMethod:mode,dateStr:'2026-11-02',reason:'adjust',notes:'memo',
      validatedItems:[{productId:'P1',name:'Widget',qty:1,price:80,lineTotal:80,productType:'Standard'}],
      stockChanges:[],restorationPlans:[],customerId:'C1',creditCustomer:{...rows('CUSTOMERS')[0],_rowIndex:2}},
    reason:'Correction',actingUser:{'User ID':'U1','Full Name':'Operator'},newDate:'2026-11-02'
  })
 });
 return {ctx,tables,rows,get writes(){return writes;},setFail:n=>{failAt=n;}};
}
const payload={returnId:'R1',expectedVersion:0,operationId:'correction-operation-12345',editReason:'Correction',
  refundMethod:'Cash',items:[{productId:'P1',qty:1,price:80}],reason:'adjust',notes:'memo'};
test('price-only edit keeps same return ID and batch; adjusts Cash once; appends audit',()=>{
 const w=fixture();assert.equal(typeof w.ctx.updateSalesReturn,'function');
 const first=w.ctx.updateSalesReturn('t',payload);
 assert.equal(first.success,true,first.message);
 assert.equal(first.data.returnId,'R1');
 assert.equal(w.rows('SALES_RETURN')[0]['Edit Version'],1);
 assert.equal(w.rows('SALES_RETURN')[0]['Batch ID'],'B1');
 assert.equal(w.rows('SALES_RETURN')[0]['Total Return Amount'],80);
 assert.equal(w.rows('CASH_BOOK').filter(x=>x['Is Deleted']!=='TRUE').reduce((s,x)=>s+(Number(x.Debit)||0),0),80);
 assert.equal(w.rows('INVOICE_EDIT_LOG').length,1);
 assert.equal(w.rows('SALES_RETURN_ITEMS').filter(x=>x['Is Deleted']!=='TRUE').length,1);
});
test('committed same-op replay does not mutate a second time',()=>{
 const w=fixture();assert.equal(w.ctx.updateSalesReturn('t',payload).success,true);
 const prior=w.writes;const replay=w.ctx.updateSalesReturn('t',payload);
 assert.equal(replay.success,true);assert.equal(w.writes,prior);
});
test('injected fault marks journal Needs Review; subsequent retry cannot repost',()=>{
 const w=fixture();w.setFail(3);
 const out=w.ctx.updateSalesReturn('t',payload);
 assert.equal(out.success,false);
 assert.equal(w.rows('SALE_POSTING_JOURNAL')[0].State,'Needs Review');
 const before=w.writes;const retry=w.ctx.updateSalesReturn('t',payload);
 assert.equal(retry.success,false);assert.match(retry.message,/review|interrupted/i);
 assert.equal(w.writes,before);
});
test('a Store Credit price correction changes customer due by old minus new credit',()=>{
 const w=fixture('Store Credit');
 const res=w.ctx.updateSalesReturn('t',{...payload,refundMethod:'Store Credit'});
 assert.equal(res.success,true,res.message);
 assert.equal(w.rows('CUSTOMERS')[0]['Current Due'],-80);
 assert.equal(w.rows('CUSTOMER_LEDGER').filter(x=>x['Is Deleted']!=='TRUE').reduce((a,b)=>a+Number(b.Credit||0),0),80);
});
test('journaled edit RPC and versioned audit fields are declared',()=>{
 const cfg=fs.readFileSync(path.resolve(__dirname,'..','Config.gs'),'utf8');
 for(const name of ['Return ID','Before Return Amount','After Return Amount'])assert.ok(cfg.includes('"'+name+'"'),name);
 assert.match(code,/function updateSalesReturn\(/);
});
