'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=x=>fs.readFileSync(path.resolve(__dirname,'..',x),'utf8');
function stockFixture(change={}) {
 const tables={
  PRODUCTS:[{'Product ID':'P1','Product Name':'Widget','Current Stock':10}],
  STOCK_LOTS:[{'Lot ID':'L1','Product ID':'P1','Purchase ID':'PO1','Remaining Quantity':6,'Original Quantity':10}],
  SALE_ITEM_LOTS:[{'Invoice ID':'INV1','Product ID':'P1','Lot ID':'L1','Quantity':3,'Source Sale Product ID':'P1','Return Consumption Link ID':'CL1','Supplier ID':''}],
  STOCK_MOVEMENT:[{'Movement ID':'M1','Type':'Sales Return','Reference':'R1','Product ID':'P1','Quantity In':2,'Lot ID':'L1','Source Sale Product ID':'P1','Source Consumption Link ID':'CL1'}],
  SALES_RETURN:[{'Return ID':'R1','Invoice ID':'INV1'}],
  SALES_RETURN_ITEMS:[{'Return ID':'R1','Invoice ID':'INV1','Product ID':'P1','Return Quantity':2,'Sold Product Type':'Standard'}]
 };
 Object.keys(change).forEach(k=>tables[k]=change[k]);
 const writes=[],ctx=vm.createContext({Date,Math,JSON,console});
 vm.runInContext(read('StockLots.gs'),ctx);
 Object.assign(ctx,{
  getAllRows_:key=>(tables[key]||[]).map((r,i)=>({...r,_rowIndex:i+2})),
  activeRows_:key=>ctx.getAllRows_(key).filter(r=>!r['Is Deleted']),
  updateRowFields_:(key,i,patch)=>{writes.push([key,i,patch]);Object.assign(tables[key][i-2],patch);},
  appendRow_:(key,row)=>{writes.push([key,'append',row]);(tables[key]||(tables[key]=[])).push(row);},
  generateId_:key=>key+'-X',
  roundMoney_:n=>Math.round(n*100)/100,
  isDeleted_:row=>!!row['Is Deleted'],
  getSaleBundleSnapshot_:()=>({}),
  sanitizeInput_:x=>String(x==null?'':x).trim()
 });
 return {tables,writes,ctx};
}
test('stock undo plans exact lot, product, and original consumption without writes',()=>{
 const w=stockFixture();
 assert.equal(typeof w.ctx.planSalesReturnStockUndo_,'function');
 const plan=w.ctx.planSalesReturnStockUndo_('R1',{});
 assert.equal(plan.productDeltas[0].newStock,8);
 assert.equal(plan.lotDeltas[0].newRemaining,4);
 assert.equal(plan.saleConsumptionDeltas[0].newQuantity,5);
 assert.equal(w.writes.length,0);
});
test('stock undo refuses sold-on returned inventory before writes',()=>{
 const w=stockFixture({STOCK_LOTS:[{'Lot ID':'L1','Product ID':'P1','Purchase ID':'PO1','Remaining Quantity':1}]});
 assert.throws(()=>w.ctx.planSalesReturnStockUndo_('R1',{}),/stock|lot|consum/i);
 assert.equal(w.writes.length,0);
});
test('stock undo refuses ambiguous legacy consumption matches',()=>{
 const w=stockFixture({SALE_ITEM_LOTS:[
  {'Invoice ID':'INV1','Product ID':'P1','Lot ID':'L1','Quantity':3,'Source Sale Product ID':'P1'},
  {'Invoice ID':'INV1','Product ID':'P1','Lot ID':'L1','Quantity':1,'Source Sale Product ID':'P1'}
 ],STOCK_MOVEMENT:[{'Movement ID':'M1','Type':'Sales Return','Reference':'R1','Product ID':'P1','Quantity In':2,'Lot ID':'L1','Source Sale Product ID':'P1'}]});
 assert.throws(()=>w.ctx.planSalesReturnStockUndo_('R1',{}),/ambiguous|source|evidence/i);
 assert.equal(w.writes.length,0);
});
test('stock undo rejects duplicate or orphan return movements',()=>{
 const w=stockFixture({STOCK_MOVEMENT:[{'Movement ID':'M1','Type':'Sales Return','Reference':'R1','Product ID':'P1','Quantity In':1,'Lot ID':'L1','Source Sale Product ID':'P1','Source Consumption Link ID':'CL1'}]});
 assert.throws(()=>w.ctx.planSalesReturnStockUndo_('R1',{}),/mismatch|quantity|movement/i);
});
test('stock undo applies exactly once and retains reversal evidence',()=>{
 const w=stockFixture();const plan=w.ctx.planSalesReturnStockUndo_('R1',{});
 w.ctx.applySalesReturnStockUndo_(plan,'change-R1','Delete');
 assert.equal(w.tables.PRODUCTS[0]['Current Stock'],8);
 assert.equal(w.tables.STOCK_LOTS[0]['Remaining Quantity'],4);
 assert.equal(w.tables.SALE_ITEM_LOTS[0]['Quantity'],5);
 assert.equal(w.tables.STOCK_MOVEMENT[0]['Reversed By'],'change-R1');
 assert.ok(w.tables.STOCK_MOVEMENT.some(x=>x.Type==='Sales Return Delete Reversal'&&x['Quantity Out']===2));
});
test('return creation carries durable source consumption identity into movement and schema',()=>{
 const lots=read('StockLots.gs'),returns=read('SalesReturn.gs'),cfg=read('Config.gs');
 assert.match(lots,/Source Consumption Link ID|sourceConsumptionLinkId/);
 assert.match(returns,/Source Consumption Link ID/);
 assert.match(cfg,/"Return Consumption Link ID"/);
 assert.match(cfg,/"Source Consumption Link ID"/);
 assert.match(cfg,/"Reversed By"/);
});
