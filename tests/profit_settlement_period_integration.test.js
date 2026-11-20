'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
function engine(withSheets=true){
 const sheets={
  SALES:[{'Invoice ID':'INV-1',Date:'2026-10-12',Subtotal:30000,'Grand Total':30000,Discount:0},
    {'Invoice ID':'INV-2',Date:'2026-11-03',Subtotal:300,'Grand Total':300,Discount:0}],
  SALE_ITEMS:[{'Invoice ID':'INV-1','Product ID':'P1','Product Name':'Pipe',Quantity:229,'Unit Price':30000/229,'Line Total':30000},
    {'Invoice ID':'INV-2','Product ID':'P1','Product Name':'Pipe',Quantity:2,'Unit Price':150,'Line Total':300}],
  SALE_ITEM_LOTS:[
    {'Invoice ID':'INV-1','Product ID':'P1','Source Sale Product ID':'P1','Lot ID':'OV-1',Quantity:229,'Unit Cost':68},
    {'Invoice ID':'INV-2','Product ID':'P1','Source Sale Product ID':'P1','Lot ID':'OV-2',Quantity:2,'Unit Cost':68}],
  STOCK_LOTS:[
    {'Lot ID':'OV-1','Product ID':'P1','Purchase ID':'OVERSOLD','Original Quantity':229,'Remaining Quantity':0,'Purchase Price':68,Status:'Consumed'},
    {'Lot ID':'OV-2','Product ID':'P1','Purchase ID':'OVERSOLD','Original Quantity':2,'Remaining Quantity':0,'Purchase Price':68,Status:'Consumed'},
    {'Lot ID':'PURLOT-1','Product ID':'P1','Purchase ID':'PUR-9','Original Quantity':240,'Remaining Quantity':9,'Purchase Price':64.75,Status:'Active'}],
  PURCHASES:[{'Purchase ID':'PUR-9',Discount:0}],
  PURCHASE_SETTLEMENT_JOURNAL:[{'Operation ID':'OP-9','Purchase ID':'PUR-9',State:'Committed','Last Completed Stage':'Committed','Result Receipt':'PUR-9'}],
  STOCK_LOT_SETTLEMENTS:[
    { 'Settlement ID':'STL-1','Operation ID':'OP-9','Purchase ID':'PUR-9','Purchase Lot ID':'PURLOT-1',
      'Product ID':'P1','Oversold Lot ID':'OV-1','Source Invoice ID':'INV-1','Source Sale Product ID':'P1',
      'Quantity Ticks':229000000,'Quantity Scale':1000000,'Provisional Unit Cost Minor':6800,'Actual Unit Cost Minor':6475,
      'Provisional COGS Minor':1557200,'Actual COGS Minor':1482775,'Favorable Variance Minor':74425,State:'Committed'},
    { 'Settlement ID':'STL-2','Operation ID':'OP-9','Purchase ID':'PUR-9','Purchase Lot ID':'PURLOT-1',
      'Product ID':'P1','Oversold Lot ID':'OV-2','Source Invoice ID':'INV-2','Source Sale Product ID':'P1',
      'Quantity Ticks':2000000,'Quantity Scale':1000000,'Provisional Unit Cost Minor':6800,'Actual Unit Cost Minor':6475,
      'Provisional COGS Minor':13600,'Actual COGS Minor':12950,'Favorable Variance Minor':650,State:'Committed'}
  ]
 };
 const configHeaders={
   STOCK_LOT_SETTLEMENTS:Object.keys(sheets.STOCK_LOT_SETTLEMENTS[0]),
   PURCHASE_SETTLEMENT_JOURNAL:Object.keys(sheets.PURCHASE_SETTLEMENT_JOURNAL[0])
 };
 const setupPresent={STOCK_LOT_SETTLEMENTS:withSheets,PURCHASE_SETTLEMENT_JOURNAL:withSheets};
 const cache=new Map(),readCounts={};let sheetWrites=0;
 const context={
  console,Math,Number,Object,BigInt,Date,
  CONFIG:{SHEETS:{STOCK_LOT_SETTLEMENTS:'Stock Lot Settlements',PURCHASE_SETTLEMENT_JOURNAL:'Purchase Settlement Journal'},
    HEADERS:configHeaders},
  getSpreadsheet_:()=>({getSheetByName:name=>{
    const key=name==='Stock Lot Settlements'?'STOCK_LOT_SETTLEMENTS':'PURCHASE_SETTLEMENT_JOURNAL';
    if(!setupPresent[key])return null;
    const headers=configHeaders[key];
    return {getLastColumn:()=>headers.length,getRange:()=>({getValues:()=>[headers]})};
  }}),
  getAllRows_:key=>{readCounts[key]=(readCounts[key]||0)+1;return sheets[key]||[]},
  activeRows_:key=>sheets[key]||[],
  activeSalesReturnItems_:()=>[],
  isDeleted_:()=>false,
  assertUniqueSalesInvoiceIds_:()=>{},
  safeDateOnly_:x=>String(x||'').slice(0,10),
  formatDate_:()=> '2026-11-20',
  sanitizeInput_:x=>String(x||''),
  roundMoney_:n=>Math.round((n+Number.EPSILON)*100)/100,
  isValidNonNegativeNumber_:x=>Number.isFinite(Number(x))&&Number(x)>=0,
  computeSettlementDiscountProfit_:()=>({customerDiscountGiven:0,supplierDiscountReceived:0,netProfitImpact:0}),
  CacheService:{getScriptCache:()=>({get:k=>cache.get(k)||null,put:(k,v)=>cache.set(k,v)})},
  requirePermission_:()=>{},ok_:x=>({success:true,data:x}),
  fail_:m=>({success:false,message:m}),logError_:()=>{}
 };
 vm.createContext(context);
 vm.runInContext(fs.readFileSync(path.join(root,'ProfitOversoldCosts.gs'),'utf8'),context);
 vm.runInContext(fs.readFileSync(path.join(root,'Reports.gs'),'utf8'),context);
 return {sheets,context,readCounts,setupPresent,configHeaders,writes:()=>sheetWrites,cache};
}
test('earlier sale gets actual new-purchase cost in original October profit period only',()=>{
 const {context}=engine();
 const oct=context.computeProfit_({from:'2026-10-01',to:'2026-10-31'});
 assert.equal(oct.totals.cogs,14827.75);
 assert.equal(oct.totals.grossProfit,15172.25);
 assert.equal(oct.totals.netProfit,15172.25);
 assert.equal(oct.byProduct[0].cost,14827.75);
 assert.equal(oct.costReconciliation.cogsDeltaMinor,-74425);
 const nov=context.computeProfit_({from:'2026-11-01',to:'2026-11-30'});
 assert.equal(nov.totals.cogs,129.5);
 assert.equal(nov.costReconciliation.cogsDeltaMinor,-650);
});
test('incomplete settlement evidence prevents profit response rather than showing provisional COGS as final',()=>{
 const {sheets,context}=engine();
 sheets.STOCK_LOT_SETTLEMENTS[0].State='Writing';
 assert.throws(()=>context.computeProfit_({from:'2026-10-01',to:'2026-10-31'}),/needs review|settlement/i);
 const report=context.getProfitReport('T',{from:'2026-10-01',to:'2026-10-31'});
 assert.equal(report.success,false);assert.match(report.message,/needs review/i);
});
test('missing one of two settlement sheets fails read-only without auto-creating headers',()=>{
 const x=engine();x.setupPresent.STOCK_LOT_SETTLEMENTS=false;
 assert.throws(()=>x.context.computeProfit_({from:'2026-10-01',to:'2026-10-31'}),/needs review|setup/i);
 assert.equal(x.writes(),0);
});
test('legacy workbook missing BOTH settlement sheets keeps original provisional profit unchanged, without creating a sheet',()=>{
 const x=engine(false);
 const result=x.context.computeProfit_({from:'2026-10-01',to:'2026-10-31'});
 assert.equal(result.totals.cogs,15572);
 assert.equal(result.costReconciliation.status,'LEGACY_NO_SETTLEMENT');
 assert.equal(x.readCounts.STOCK_LOT_SETTLEMENTS||0,0);
 assert.equal(x.writes(),0);
});
test('report cache generation must be invalidated by a newly committed settlement journal/event',()=>{
 const source=fs.readFileSync(path.join(root,'Database.gs'),'utf8');
 assert.match(source,/SALE_ITEM_LOTS:true[^\n]*STOCK_LOT_SETTLEMENTS:true/);
 assert.match(source,/STOCK_LOT_SETTLEMENTS:true[^\n]*PURCHASE_SETTLEMENT_JOURNAL:true/);
});

test('new effective COGS implementation uses a versioned profit cache key, not legacy cached provisional profit',()=>{
 const source=fs.readFileSync(path.join(root,'Reports.gs'),'utf8');
 assert.match(source,/db:v3:derived:profit:settlement-v1:/);
});
