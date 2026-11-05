'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=x=>fs.readFileSync(path.resolve(__dirname,'..',x),'utf8');
function fixture(overrides={}){
 const tables={
  SALES:[{'Invoice ID':'INV1','Customer ID':'C1','Date':'2026-11-01','Paid Amount':200,'Grand Total':500,'Subtotal':500}],
  SALE_ITEMS:[{'Invoice ID':'INV1','Product ID':'P1','Product Name':'Widget','Quantity':5,'Unit Price':100,'Line Total':500}],
  SALES_RETURN:[{'Return ID':'R1','Invoice ID':'INV1','Customer ID':'C1','Refund Method':'Cash','Total Return Amount':100,'Date':'2026-11-02','Created At':'2026-11-02T10:00:00','Edit Version':0}],
  SALES_RETURN_ITEMS:[{'Return ID':'R1','Invoice ID':'INV1','Product ID':'P1','Product Name':'Widget','Return Quantity':1,'Return Price':100,'Line Total':100}],
  CASH_BOOK:[{'Entry ID':'CB1','Reference':'R1','Type':'Sales Return','Debit':100}],
  CUSTOMER_LEDGER:[],CUSTOMERS:[{'Customer ID':'C1','Customer Name':'Buyer','Current Due':0}],
  CASH_SESSIONS:[], PRODUCTS:[{'Product ID':'P1','Current Stock':10}]
 };
 Object.assign(tables,overrides);const writes=[],ctx=vm.createContext({console,Date,JSON,Math});
 vm.runInContext(read('SalesReturn.gs'),ctx);
 Object.assign(ctx,{
  getAllRows_:key=>(tables[key]||[]).map((r,i)=>({...r,_rowIndex:i+2})),
  activeRows_:key=>ctx.getAllRows_(key).filter(r=>!ctx.isDeleted_(r)),
  activeSalesReturnItems_:()=>ctx.getAllRows_('SALES_RETURN_ITEMS').filter(r=>!ctx.isDeleted_(r)),
  isDeleted_:r=>String(r&&r['Is Deleted']||'').toUpperCase()==='TRUE',
  sanitizeInput_:x=>String(x==null?'':x).trim(),
  safeDateOnly_:x=>String(x||''),
  requirePermission_:()=>({'Full Name':'Operator','User ID':'U1'}),
  requireDeletePermission_:()=>({'Full Name':'Operator','User ID':'U1'}),
  requireActiveCashSession_:()=>true,
  findUniqueSalesRow_:id=>tables.SALES.filter(x=>x['Invoice ID']===id)[0],
  customerInvoiceCashCollected_:()=>200,
  customerInvoiceSettlementSnapshot_:()=>null,
  resolveEditedTransactionDate_:(_tok,_mod,newDate,oldDate)=>newDate||oldDate,
  planSalesReturnStockUndo_:()=>({returnId:'R1',productDeltas:[],lotDeltas:[],saleConsumptionDeltas:[],movements:[]}),
  outstandingSaleOwnStockByProduct_:()=>({P1:4}),
  logError_:()=>{},
  roundMoney_:n=>Math.round(n*100)/100,
  ok_:data=>({success:true,data}),fail_:message=>({success:false,message}),
  updateRowFields_:(key,row,fields)=>{writes.push([key,row]);Object.assign(tables[key][row-2],fields)},
  getSaleBundleSnapshot_:()=>({}),actorName_:()=> 'Operator'
 });
 return {ctx,tables,writes};
}
test('read-only correction planner rejects duplicate return ID before writes',()=>{
 const w=fixture();w.tables.SALES_RETURN.push({...w.tables.SALES_RETURN[0]});
 assert.equal(typeof w.ctx.prepareSalesReturnChange_,'function');
 assert.throws(()=>w.ctx.prepareSalesReturnChange_('t','R1',{reason:'bad','operationId':'op-123456789012'},'Delete'),/duplicate/i);
 assert.equal(w.writes.length,0);
});
test('delete planner validates cash source and stock without writing',()=>{
 const w=fixture();
 const out=w.ctx.prepareSalesReturnChange_('t','R1',{reason:'mistake',operationId:'op-123456789012',expectedVersion:0},'Delete');
 assert.equal(out.original['Return ID'],'R1');
 assert.equal(out.moneyUndo.kind,'Cash');
 assert.equal(out.moneyUndo.amount,100);
 assert.equal(w.writes.length,0);
});
test('planner rejects missing or duplicate cash book evidence',()=>{
 const w=fixture({CASH_BOOK:[]});
 assert.throws(()=>w.ctx.prepareSalesReturnChange_('t','R1',{reason:'mistake',operationId:'op-123456789012'},'Delete'),/cash|evidence/i);
 assert.equal(w.writes.length,0);
});
test('planner protects already-spent store credit by rejecting later customer entries',()=>{
 const w=fixture({
  SALES_RETURN:[{'Return ID':'R1','Invoice ID':'INV1','Customer ID':'C1','Refund Method':'Store Credit','Total Return Amount':100,'Date':'2026-11-02','Edit Version':0}],
  CASH_BOOK:[],
  CUSTOMER_LEDGER:[
   {'Ledger ID':'CL1','Reference':'R1','Customer ID':'C1','Type':'Sales Return Credit','Credit':100},
   {'Ledger ID':'CL2','Reference':'PM1','Customer ID':'C1','Type':'Payment','Credit':20}
  ]
 });
 assert.throws(()=>w.ctx.prepareSalesReturnChange_('t','R1',{reason:'mistake',operationId:'op-123456789012'},'Delete'),/later|settlement|reconcil/i);
 assert.equal(w.writes.length,0);
});
test('delete planner denies stale version and missing reason',()=>{
 const w=fixture();
 assert.throws(()=>w.ctx.prepareSalesReturnChange_('t','R1',{reason:'',operationId:'op-123456789012'},'Delete'),/reason/i);
 assert.throws(()=>w.ctx.prepareSalesReturnChange_('t','R1',{reason:'mistake',expectedVersion:7,operationId:'op-123456789012'},'Delete'),/version|changed/i);
});
