'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=x=>fs.readFileSync(path.resolve(__dirname,'..',x),'utf8');
function fixture(method='Cash'){
 const tables={
  SALES_RETURN:[{'Return ID':'R1','Invoice ID':'INV1','Customer ID':'C1','Refund Method':method,'Date':'2026-11-02','Total Return Amount':100,'Edit Version':0}],
  SALES_RETURN_ITEMS:[{'Return ID':'R1','Invoice ID':'INV1','Product ID':'P1','Return Quantity':1}],
  CASH_BOOK:method==='Cash'?[{'Reference':'R1','Type':'Sales Return','Debit':100}]:[],
  CUSTOMER_LEDGER:method==='Store Credit'?[{'Reference':'R1','Type':'Sales Return Credit','Credit':100}]:[],
  CUSTOMERS:[{'Customer ID':'C1','Current Due':0}],
  SALE_POSTING_JOURNAL:[],DELETE_LOG:[]
 };
 let writes=0,locked=false;const ctx=vm.createContext({Date,Math,JSON,console,CONFIG:{LOCK_TIMEOUT_MS:1000}});
 vm.runInContext(read('SalesReturn.gs'),ctx);
 const rows=k=>tables[k]||(tables[k]=[]);
 Object.assign(ctx,{
  LockService:{getScriptLock:()=>({waitLock:()=>{locked=true},releaseLock:()=>{locked=false}})},
  getAllRows_:k=>rows(k).map((r,i)=>({...r,_rowIndex:i+2})),
  activeRows_:k=>ctx.getAllRows_(k).filter(r=>!r['Is Deleted']),
  sanitizeInput_:x=>String(x==null?'':x).trim(),
  isDeleted_:r=>!!r['Is Deleted'],roundMoney_:n=>Math.round(n*100)/100,
  actorName_:()=> 'Operator',requirePermission_:()=>({'User ID':'U1','Full Name':'Operator'}),
  logError_:()=>{},ok_:d=>({success:true,data:d}),fail_:m=>({success:false,message:m}),
  salePostingPayloadHash_:x=>JSON.stringify(x),
  salePostingJournalDecision_:(x,hash)=>{if(x['Payload Hash']!==hash)throw Error('Conflict');return x.State==='Committed'?'replay':'review';},
  findRowIndex_:(k,col,val)=>rows(k).findIndex(r=>r[col]===val)+2,
  generateId_:k=>k+'-'+(rows(k).length+1),
  appendRow_:(k,r)=>{writes++;rows(k).push({...r})},
  updateRowFields_:(k,i,fields)=>{writes++;Object.assign(rows(k)[i-2],fields)},
  markMatchingDeleted_:(k,pred)=>ctx.getAllRows_(k).filter(r=>!r['Is Deleted']&&pred(r)).forEach(r=>ctx.updateRowFields_(k,r._rowIndex,{'Is Deleted':'TRUE'})),
  markRowDeleted_:(k,i,actor,reason)=>ctx.updateRowFields_(k,i,{'Is Deleted':'TRUE','Delete Reason':reason}),
  logDeletion_:(k,id,invoice,reason)=>ctx.appendRow_('DELETE_LOG',{Module:k,'Record ID':id,Reason:reason}),
  applySalesReturnStockUndo_:()=>{writes++;},
  prepareSalesReturnChange_:(_token,id,req,mode)=>{
   if(mode!=='Delete')throw Error('Expected delete');
   if(!req.reason)throw Error('Delete reason required');
   if(req.expectedVersion!==undefined&&req.expectedVersion!==0)throw Error('Stale version');
   return {original:{...rows('SALES_RETURN')[0],_rowIndex:2},invoiceId:'INV1',version:0,reason:req.reason,
     actingUser:{'User ID':'U1','Full Name':'Operator'},
     stockUndo:{movements:[]},
     moneyUndo:method==='Cash'?{kind:'Cash',amount:100,rowIndex:2}:{kind:'Store Credit',amount:100,rowIndex:2,customer:{...rows('CUSTOMERS')[0],_rowIndex:2}}
   };
  }
 });
 return {ctx,rows,tables,get writes(){return writes}};
}
test('Cash return delete reverses stock/refund once, retains audit and unlocks active-return filter',()=>{
 const w=fixture();assert.equal(typeof w.ctx.deleteSalesReturn,'function');
 const first=w.ctx.deleteSalesReturn('t','R1','Mistaken return','return-delete-R1',0);
 assert.equal(first.success,true,first.message);
 assert.equal(w.rows('SALES_RETURN')[0]['Is Deleted'],'TRUE');
 assert.equal(w.rows('CASH_BOOK')[0]['Is Deleted'],'TRUE');
 assert.equal(w.rows('DELETE_LOG').length,1);
 assert.equal(w.rows('SALE_POSTING_JOURNAL')[0].State,'Committed');
 const prior=w.writes;
 assert.equal(w.ctx.deleteSalesReturn('t','R1','Mistaken return','return-delete-R1',0).success,true);
 assert.equal(w.writes,prior);
});
test('Store Credit delete reverses customer due exactly once',()=>{
 const w=fixture('Store Credit');
 const result=w.ctx.deleteSalesReturn('t','R1','Mistaken return','return-delete-R1',0);
 assert.equal(result.success,true,result.message);
 assert.equal(w.rows('CUSTOMERS')[0]['Current Due'],100);
 assert.equal(w.rows('CUSTOMER_LEDGER')[0]['Is Deleted'],'TRUE');
});
test('delete refuses changed version or missing reason without a business write',()=>{
 const w=fixture();
 assert.equal(w.ctx.deleteSalesReturn('t','R1','',undefined,0).success,false);
 assert.equal(w.ctx.deleteSalesReturn('t','R1','Mistake',undefined,7).success,false);
 assert.equal(w.writes,0);
});
test('Day Book deletion delegates to the native Sales Return handler',()=>{
 assert.match(read('DeleteEngine.gs'),/case 'sales return':\s*return deleteSalesReturn\(/);
 const daybook=read('DayBook.gs');
 assert.match(daybook,/'Sales Return': 'sales return'/);
});
