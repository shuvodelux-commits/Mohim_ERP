'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function load(){
  const ctx={Date,Math,JSON,console,safeDateOnly_:x=>String(x||'').slice(0,10),
    isValidNonNegativeNumber_:x=>x!==''&&x!==null&&x!==undefined&&Number.isFinite(Number(x))&&Number(x)>=0};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','StockLots.gs'),'utf8'),ctx);
  return ctx.planOversoldPurchaseSettlement_;
}
const lot=(id,remaining,cost=68,more={})=>({'Lot ID':id,'Product ID':'PIPE','Purchase ID':'OVERSOLD','Purchase Date':'2026-11-01','Original Quantity':Math.abs(remaining),'Remaining Quantity':remaining,'Purchase Price':cost,'Status':'Oversold',...more});
const sale=(id,day='2026-11-01',more={})=>({'Invoice ID':id,'Date':day,...more});
const source=(id,invoice,qty,cost=68,more={})=>({'Invoice ID':invoice,'Product ID':'PIPE','Lot ID':id,Quantity:qty,'Unit Cost':cost,'Source Sale Product ID':'PIPE',...more});
const base=()=>({
 productId:'PIPE',product:{'Product ID':'PIPE','Current Stock':-231},
 purchase:{operationId:'PURCHASE-OP-123456',purchaseId:'PUR-082',date:'2026-11-20',quantity:240,unitCost:64.75,quantityScale:1},
 stockLots:[lot('LOT-N1',-229),lot('LOT-N2',-2)],
 sales:[sale('INV-001','2026-11-01'),sale('INV-002','2026-11-02')],
 saleItemLots:[source('LOT-N1','INV-001',229),source('LOT-N2','INV-002',2)],
 operationJournal:[],settlementHistory:[]
});
const plain=v=>JSON.parse(JSON.stringify(v));
const plan=ctx=>plain(load()(ctx));
const codes=result=>result.issues.map(x=>x.code);
const assertReview=(r,code)=>{assert.equal(r.status,'NEEDS_REVIEW');assert.equal(r.postable,false);assert.ok(codes(r).includes(code),JSON.stringify(r));assert.deepEqual(r.allocations,[]);};

test('240 new feet at 64.75 settles 229+2 historic oversold feet, leaves 9 and +750.75 variance',()=>{
 const ctx=base(),original=structuredClone(ctx);const immutable=load()(ctx),r=plain(immutable);
 assert.equal(r.status,'READY');assert.equal(r.postable,false);assert.equal(r.currentStockBeforeTicks,-231);assert.equal(r.currentStockAfterTicks,9);
 assert.equal(r.purchaseQtyTicks,240);assert.equal(r.settledQtyTicks,231);assert.equal(r.newLotRemainingQtyTicks,9);
 assert.deepEqual(r.allocations.map(x=>[x.oversoldLotId,x.settledQtyTicks,x.remainingDebtAfterTicks,x.favorableVarianceMinor]),[
 ['LOT-N1',229,0,74425],['LOT-N2',2,0,650]]);
 assert.equal(r.favorableVarianceMinor,75075);
 assert.deepEqual(ctx,original);assert.ok(Object.isFrozen(immutable));assert.ok(Object.isFrozen(immutable.allocations));
 assert.equal('rowIndex' in r.allocations[0],false);assert.equal('write' in r,false);
});
test('partial purchase settles oldest debt only; unfunded sale keeps provisional cost',()=>{
 const ctx=base();ctx.purchase.quantity=100;
 const r=plan(ctx);assert.equal(r.status,'READY');assert.equal(r.settledQtyTicks,100);
 assert.equal(r.newLotRemainingQtyTicks,0);assert.equal(r.currentStockAfterTicks,-131);
 assert.deepEqual(r.allocations.map(x=>[x.sourceInvoiceId,x.settledQtyTicks,x.remainingDebtAfterTicks]),[['INV-001',100,129]]);
 assert.equal(r.favorableVarianceMinor,32500);
});
test('fully settled stock with no negative lots returns NO_DEBT and leaves purchase untouched',()=>{
 const ctx=base();ctx.product['Current Stock']=4;ctx.stockLots=[{'Lot ID':'PUR-OLD','Product ID':'PIPE','Purchase ID':'PUR-OLD','Purchase Date':'2026-11-01','Remaining Quantity':4,'Purchase Price':68,Status:'Active'}];
 ctx.saleItemLots=[];ctx.sales=[];
 const r=plan(ctx);assert.equal(r.status,'NO_DEBT');assert.equal(r.settledQtyTicks,0);
 assert.equal(r.newLotRemainingQtyTicks,240);assert.equal(r.currentStockAfterTicks,244);
});
test('sale business date, not OVERSOLD lot creation time, determines order',()=>{
 const ctx=base();
 ctx.stockLots[0]['Purchase Date']='2026-11-15';ctx.stockLots[1]['Purchase Date']='2026-11-03';
 ctx.sales[0].Date='2026-11-01';ctx.sales[1].Date='2026-11-02';
 assert.deepEqual(plan(ctx).allocations.map(x=>x.sourceInvoiceId),['INV-001','INV-002']);
});
test('split restock costs preserve separate effective valuation and partial allocations',()=>{
 const ctx=base();ctx.purchase.quantity=0.5;ctx.purchase.quantityScale=10;
 const r=plan(ctx);assert.equal(r.status,'READY');
 assert.equal(r.settledQtyTicks,5);assert.equal(r.newLotRemainingQtyTicks,0);
 assert.equal(r.allocations[0].settledQtyTicks,5);
 // BDT 34.00 provisional minus BDT 32.38 rounded actual cost = BDT 1.62.
 assert.equal(r.allocations[0].favorableVarianceMinor,162);
});
test('never invent a missing -2 Foot lot if product cache says -231 but lots sum -229',()=>{
 const ctx=base();ctx.stockLots.pop();ctx.saleItemLots.pop();ctx.sales.pop();
 assertReview(plan(ctx),'STOCK_CACHE_MISMATCH');
});
test('positive lot alongside unresolved historic debt needs source reconciliation first',()=>{
 const ctx=base();ctx.stockLots.push({'Lot ID':'POS','Product ID':'PIPE','Purchase ID':'PUR-OLD','Purchase Date':'2026-11-10','Remaining Quantity':4,'Purchase Price':68,Status:'Active'});
 ctx.product['Current Stock']=-227;
 assertReview(plan(ctx),'EXISTING_POSITIVE_WITH_DEBT');
});
test('missing, duplicate and mismatched SALE_ITEM_LOTS source links block settlement',()=>{
 const x=base();x.saleItemLots.pop();assertReview(plan(x),'MISSING_SALE_ITEM_LINK');
 const y=base();y.saleItemLots.push({...y.saleItemLots[0]});assertReview(plan(y),'DUPLICATE_SALE_ITEM_LINK');
 const z=base();z.saleItemLots[0].Quantity=228;assertReview(plan(z),'SALE_ITEM_QTY_MISMATCH');
 const a=base();a.saleItemLots[0]['Unit Cost']=70;assertReview(plan(a),'PROVISIONAL_COST_MISMATCH');
});
test('missing/duplicate sale invoice or sale dated after backdated purchase blocks settlement',()=>{
 const x=base();x.sales.pop();assertReview(plan(x),'MISSING_SOURCE_SALE');
 const y=base();y.sales.push({...y.sales[0]});assertReview(plan(y),'DUPLICATE_SOURCE_SALE');
 const z=base();z.purchase.date='2026-10-30';assertReview(plan(z),'PURCHASE_BEFORE_OVERSOLD_SALE');
});
test('exact committed purchase replay returns receipt without recomputing or writing',()=>{
 const ctx=base();ctx.operationJournal=[{operationId:'PURCHASE-OP-123456',productId:'PIPE',state:'COMMITTED',
   intentFingerprint:'PIPE|PUR-082|2026-11-20|240|6475|1',receiptRef:'RECEIPT-1'}];
 const r=plan(ctx);assert.equal(r.status,'REPLAY');assert.equal(r.existingReceiptRef,'RECEIPT-1');
 assert.deepEqual(r.allocations,[]);assert.equal(r.postable,false);
});
test('operation ID reused with different intent, or interrupted operation, blocks duplicate stock writes',()=>{
 const ctx=base();ctx.operationJournal=[{operationId:'PURCHASE-OP-123456',productId:'PIPE',state:'COMMITTED',
   intentFingerprint:'DIFFERENT',receiptRef:'RECEIPT-1'}];
 assertReview(plan(ctx),'OPERATION_CONFLICT');
 const x=base();x.operationJournal=[{operationId:'OTHER-OP',productId:'PIPE',state:'WRITING',intentFingerprint:'any'}];
 assertReview(plan(x),'UNRESOLVED_WRITE');
});
test('fractional quantities require explicit exact canonical tick scale',()=>{
 const ctx=base();ctx.purchase.quantity=1.234;ctx.purchase.quantityScale=100;
 assertReview(plan(ctx),'INVALID_QUANTITY_PRECISION');
});
test('money unit costs cannot round away sub-paisa source differences',()=>{
 const ctx=base();ctx.purchase.unitCost=64.755;
 assertReview(plan(ctx),'INVALID_PURCHASE_COST_PRECISION');
});
test('deleted, positive, or manually edited fake negative lot is rejected',()=>{
 const ctx=base();ctx.stockLots[0].Status='Deleted';assertReview(plan(ctx),'INVALID_NEGATIVE_LOT');
 const x=base();x.stockLots[0]['Purchase ID']='ADJUSTMENT';assertReview(plan(x),'INVALID_NEGATIVE_LOT');
});
test('successful plan is pure and does not imply financial journal, Cash Book or live Sheet writes',()=>{
 const ctx=base();const r=plan(ctx);
 assert.equal(r.postable,false);assert.equal('journal' in r,false);assert.equal('cashBook' in r,false);
 assert.equal('supplierDue' in r,false);assert.equal('writeOperations' in r,false);
});

test('second replenishment reconciles immutable original sale quantity against prior committed funding',()=>{
 const ctx=base();
 ctx.product['Current Stock']=-131;
 ctx.stockLots[0]['Remaining Quantity']=-129;
 ctx.purchase.quantity=129;
 ctx.purchase.date='2026-11-21';
 ctx.settlementHistory=[{
   settlementId:'STL-001',productId:'PIPE',oversoldLotId:'LOT-N1',
   sourceInvoiceId:'INV-001',sourceSaleProductId:'PIPE',
   purchaseLotId:'LOT-PREVIOUS',settledQtyTicks:100,
   actualUnitCostMinor:6475,operationId:'PRIOR-OP',state:'COMMITTED'
 }];
 const r=plan(ctx);
 assert.equal(r.status,'READY');assert.equal(r.settledQtyTicks,129);
 assert.equal(r.allocations[0].remainingDebtAfterTicks,0);
 assert.equal(r.allocations[0].settledQtyTicks,129);
 assert.equal(r.newLotRemainingQtyTicks,0);
 assert.equal(r.currentStockAfterTicks,-2);
});
test('uncommitted or inconsistent older settlement events block the next purchase',()=>{
 const ctx=base();
 ctx.settlementHistory=[{settlementId:'STL-1',productId:'PIPE',oversoldLotId:'LOT-N1',
   sourceInvoiceId:'INV-001',sourceSaleProductId:'PIPE',purchaseLotId:'PUR-PRIOR',
   settledQtyTicks:100,actualUnitCostMinor:6400,operationId:'OLD',state:'WRITING'}];
 assertReview(plan(ctx),'UNRESOLVED_SETTLEMENT_HISTORY');
 const y=base();y.settlementHistory=[{settlementId:'STL-1',productId:'PIPE',oversoldLotId:'UNKNOWN',
   sourceInvoiceId:'INV-001',sourceSaleProductId:'PIPE',purchaseLotId:'PUR-PRIOR',
   settledQtyTicks:100,actualUnitCostMinor:6400,operationId:'OLD',state:'COMMITTED'}];
 assertReview(plan(y),'UNKNOWN_SETTLEMENT_LINK');
});
test('interrupted allocation evidence blocks even a purchase with no currently negative lots',()=>{
 const ctx=base();ctx.product['Current Stock']=0;ctx.stockLots=[];ctx.sales=[];ctx.saleItemLots=[];
 ctx.settlementHistory=[{settlementId:'STL-UNFINISHED',state:'WRITING'}];
 assertReview(plan(ctx),'UNRESOLVED_SETTLEMENT_HISTORY');
});
test('reusing a Purchase ID under another operation cannot post a second purchase',()=>{
 const ctx=base();
 ctx.operationJournal=[{operationId:'PRIOR-OP',productId:'PIPE',purchaseId:'PUR-082',state:'COMMITTED',
   intentFingerprint:'PRIOR-DIFFERENT',receiptRef:'RECEIPT-OLD'}];
 assertReview(plan(ctx),'DUPLICATE_PURCHASE_ID');
});
test('numeric overflow in aggregate positive stock fails review',()=>{
 const ctx=base();
 const max=Number.MAX_SAFE_INTEGER;
 ctx.product['Current Stock']=max;
 ctx.stockLots=[{'Lot ID':'A','Product ID':'PIPE','Remaining Quantity':max,'Purchase ID':'PUR-1',
   Status:'Active','Purchase Price':1},{'Lot ID':'B','Product ID':'PIPE',
   'Remaining Quantity':1,'Purchase ID':'PUR-2',Status:'Active','Purchase Price':1}];
 ctx.sales=[];ctx.saleItemLots=[];
 assertReview(plan(ctx),'INVALID_LOT_QUANTITY');
});
