'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),src=fs.readFileSync(path.join(root,'OversoldSaleReturnSettlement.gs'),'utf8');
const plain=x=>JSON.parse(JSON.stringify(x));
function engine(){
 const c={Date,Math,JSON,Number,Object,BigInt,console};vm.createContext(c);
 vm.runInContext(src,c,{filename:'OversoldSaleReturnSettlement.gs'});
 return c;
}
const t=(qty)=>Math.round(qty*1e6);
const minor=(money)=>Math.round(money*100);
const event=(id,qty,cost,purchaseId,lotId,invoiceId='INV-1',oldId='OV-1')=>({
 'Settlement ID':id,'Operation ID':'OP-'+purchaseId,'Purchase ID':purchaseId,
 'Product ID':'P1','Purchase Lot ID':lotId,'Oversold Lot ID':oldId,
 'Source Invoice ID':invoiceId,'Source Sale Product ID':'P1',
 'Quantity Ticks':t(qty),'Quantity Scale':1e6,
 'Provisional Unit Cost Minor':6800,'Actual Unit Cost Minor':minor(cost),
 'Provisional COGS Minor':minor(68*qty),'Actual COGS Minor':minor(cost*qty),
 'Favorable Variance Minor':minor((68-cost)*qty),State:'Committed'
});
const journal=(purchaseId)=>({
 'Operation ID':'OP-'+purchaseId,'Purchase ID':purchaseId,State:'Committed',
 'Last Completed Stage':'Committed','Result Receipt':purchaseId
});
function base(){
 return {
  invoiceId:'INV-1',productId:'P1',sourceSaleProductId:'P1',
  operationId:'RETURN-OP-20261120-0001',returnId:'SRT-000001',
  returnQty:5,quantityScale:1e6,
  products:[{'Product ID':'P1','Current Stock':9}],
  saleItemLots:[{'Invoice ID':'INV-1','Product ID':'P1','Source Sale Product ID':'P1','Lot ID':'OV-1',
    Quantity:229,'Unit Cost':68,_rowIndex:3}],
  stockLots:[
   {'Lot ID':'OV-1','Product ID':'P1','Purchase ID':'OVERSOLD','Purchase Price':68,
    'Original Quantity':229,'Remaining Quantity':0,Status:'Consumed',_rowIndex:4},
   {'Lot ID':'NEW-1','Product ID':'P1','Purchase ID':'PUR-1','Purchase Price':64.75,
    'Original Quantity':240,'Remaining Quantity':9,Status:'Active',_rowIndex:5}
  ],
  settlements:[event('STL-1',229,64.75,'PUR-1','NEW-1')],
  purchaseJournals:[journal('PUR-1')],
  purchases:[{'Purchase ID':'PUR-1',Discount:0}],
  reversals:[],returnJournals:[],returnReceipts:[]
 };
}
function plan(x){return plain(engine().planFundedOversoldSaleReturn_(x));}
function reject(x,pattern){
 const r=plan(x);assert.equal(r.status,'NEEDS_REVIEW');assert.equal(r.postable,false);
 assert.deepEqual(r.debtUpdates,[]);assert.deepEqual(r.purchaseLotUpdates,[]);
 assert.deepEqual(r.reversalEvents,[]);assert.match(r.issues.join(' '),new RegExp(pattern,'i'));
}
test('fully funded return restores exact same actual purchase lot, not an unrelated fallback',()=>{
 const x=base(),before=structuredClone(x),raw=engine().planFundedOversoldSaleReturn_(x),r=plain(raw);
 assert.equal(r.status,'READY');assert.equal(r.postable,false);
 assert.equal(r.saleItemQtyAfterTicks,t(224));
 assert.equal(r.productStockAfterTicks,t(14));
 assert.deepEqual(r.debtUpdates,[]);
 assert.deepEqual(r.purchaseLotUpdates.map(u=>[u.lotId,u.beforeTicks,u.afterTicks]),[['NEW-1',t(9),t(14)]]);
 assert.deepEqual(r.reversalEvents.map(e=>[e.settlementId,e.quantityTicks,e.actualUnitCostMinor,e.sourceInvoiceId]),
   [['STL-1',t(5),6475,'INV-1']]);
 assert.equal(r.extraProductStockDeltaTicks,0);
 assert.equal(Object.isFrozen(raw),true);assert.equal(Object.isFrozen(raw.reversalEvents),true);
 assert.deepEqual(x,before);
});
test('old debt is restored before reversing partially funded purchase allocation',()=>{
 const x=base();x.stockLots[0]['Remaining Quantity']=-100;x.stockLots[0].Status='Oversold';
 x.stockLots[1]['Original Quantity']=129;x.stockLots[1]['Remaining Quantity']=0;x.stockLots[1].Status='Consumed';
 x.products[0]['Current Stock']=-100;
 x.settlements[0]=event('STL-1',129,64.75,'PUR-1','NEW-1');
 x.returnQty=105;
 const r=plan(x);assert.equal(r.status,'READY');
 assert.deepEqual(r.debtUpdates.map(u=>[u.lotId,u.beforeTicks,u.afterTicks]),[['OV-1',-t(100),0]]);
 assert.deepEqual(r.purchaseLotUpdates.map(u=>[u.lotId,u.afterTicks]),[['NEW-1',t(5)]]);
 assert.deepEqual(r.reversalEvents.map(e=>e.quantityTicks),[t(5)]);
 assert.equal(r.productStockAfterTicks,t(5));
});
test('returning only unfunded part must not reverse real purchase allocations',()=>{
 const x=base();x.stockLots[0]['Remaining Quantity']=-100;x.stockLots[0].Status='Oversold';
 x.stockLots[1]['Original Quantity']=129;x.stockLots[1]['Remaining Quantity']=0;x.stockLots[1].Status='Consumed';
 x.products[0]['Current Stock']=-100;x.settlements[0]=event('STL-1',129,64.75,'PUR-1','NEW-1');x.returnQty=50;
 const r=plan(x);assert.equal(r.status,'READY');assert.deepEqual(r.reversalEvents,[]);
 assert.equal(r.debtUpdates[0].afterTicks,-t(50));assert.equal(r.productStockAfterTicks,-t(50));
});
test('two purchase batches use latest committed settlement first, each at its own actual price',()=>{
 const x=base();x.stockLots[1]['Original Quantity']=100;x.stockLots[1]['Remaining Quantity']=0;x.stockLots[1].Status='Consumed';
 x.stockLots.push({'Lot ID':'NEW-2','Product ID':'P1','Purchase ID':'PUR-2',
    'Purchase Price':66,'Original Quantity':140,'Remaining Quantity':9,Status:'Active',_rowIndex:6});
 x.settlements=[event('STL-1',100,64.75,'PUR-1','NEW-1'),
    event('STL-2',129,66,'PUR-2','NEW-2')];
 x.purchaseJournals=[journal('PUR-1'),journal('PUR-2')];
 x.purchases.push({'Purchase ID':'PUR-2',Discount:0});
 x.returnQty=134;
 const r=plan(x);assert.equal(r.status,'READY');
 assert.deepEqual(r.reversalEvents.map(e=>[e.settlementId,e.quantityTicks,e.actualUnitCostMinor]),
  [['STL-2',t(129),6600],['STL-1',t(5),6475]]);
 assert.deepEqual(r.purchaseLotUpdates.map(u=>[u.lotId,u.afterTicks]),[['NEW-2',t(138)],['NEW-1',t(5)]]);
 assert.equal(r.productStockAfterTicks,t(143));
});
test('old debt 0 and missing required settlement evidence fail closed',()=>{
 const x=base();x.settlements=[];reject(x,'missing|settlement|funding');
 const y=base();y.purchaseJournals=[];reject(y,'journal');
 const z=base();z.settlements[0].State='Writing';reject(z,'pending|settlement|committed');
});
test('duplicate lot IDs and duplicate committed event IDs must fail before return writes',()=>{
 const x=base();x.stockLots.push({...x.stockLots[1]});reject(x,'duplicate|lot');
 const y=base();y.settlements.push({...y.settlements[0]});reject(y,'duplicate|settlement');
});
test('original invoice and source sale item must match the funded settlement exactly',()=>{
 const x=base();x.settlements[0]['Source Invoice ID']='OTHER';reject(x,'invoice|source');
 const y=base();y.saleItemLots=[];reject(y,'sale|source');
 const z=base();z.saleItemLots.push({...z.saleItemLots[0]});reject(z,'duplicate|sale');
});
test('cost evidence, quantity precision, stock cache and unit scales must reconcile',()=>{
 const x=base();x.stockLots[1]['Purchase Price']=65;reject(x,'cost');
 const y=base();y.stockLots[0]['Remaining Quantity']=-1;reject(y,'debt|quantity|cache');
 const z=base();z.returnQty=5.0000005;reject(z,'precision|quantity');
 const a=base();a.settlements[0]['Quantity Scale']=100;reject(a,'scale|unit');
 const b=base();b.products[0]['Current Stock']=10;reject(b,'stock|cache');
});
test('no return can exceed the net outstanding original sale quantity',()=>{
 const x=base();x.returnQty=230;reject(x,'quantity|exceed|available');
 const y=base();y.returnQty=0;reject(y,'quantity');
});
test('previous committed reversal reduces un-reversed allocation and is never replayed',()=>{
 const x=base();x.saleItemLots[0].Quantity=219;
 x.stockLots[1]['Remaining Quantity']=19;x.products[0]['Current Stock']=19;
 x.reversals=[{'Reversal ID':'REV-1','Return Operation ID':'RETURN-OP-PREVIOUS','Return ID':'SRT-PREV',
   'Settlement ID':'STL-1','Source Invoice ID':'INV-1','Source Sale Product ID':'P1',
   'Quantity Ticks':t(10),'Quantity Scale':1e6,'State':'Committed'}];
 x.returnReceipts=[{'Return ID':'SRT-PREV','Invoice ID':'INV-1'}];
 const r=plan(x);assert.equal(r.status,'READY');assert.equal(r.reversalEvents[0].quantityTicks,t(5));
 assert.equal(r.purchaseLotUpdates[0].afterTicks,t(24));
});
test('prior reversal already at full funded qty cannot be reversed twice',()=>{
 const x=base();x.saleItemLots[0].Quantity=0;x.stockLots[1]['Remaining Quantity']=238;
 x.products[0]['Current Stock']=238;
 x.reversals=[{'Reversal ID':'REV-1','Return Operation ID':'RETURN-OP-PREVIOUS','Return ID':'SRT-PREV',
   'Settlement ID':'STL-1','Source Invoice ID':'INV-1','Source Sale Product ID':'P1',
   'Quantity Ticks':t(229),'Quantity Scale':1e6,'State':'Committed'}];
 x.returnReceipts=[{'Return ID':'SRT-PREV','Invoice ID':'INV-1'}];x.returnQty=1;
 reject(x,'exceed|quantity|return');
});
test('interrupted prior reversal and operation-id reuse block the next action',()=>{
 const x=base();x.reversals=[{'Reversal ID':'REV-1','Return Operation ID':'RETURN-OP-PREV','Return ID':'SRT-PREV',
    'Settlement ID':'STL-1','Quantity Ticks':t(2),'Quantity Scale':1e6,'State':'Writing'}];
 reject(x,'pending|writing|reversal');
 const y=base();y.returnJournals=[{'Operation ID':y.operationId,'State':'Committed','Return ID':'SRT-OLD'}];
 reject(y,'operation|replay|conflict');
 const z=base();z.returnJournals=[{'Operation ID':'ANOTHER-PENDING','State':'Needs Review','Invoice ID':'INV-1'}];
 reject(z,'pending|journal|review');
});
test('source-funded return with purchase-wide discount requires approved cost policy',()=>{
 const x=base();x.purchases[0].Discount=15;reject(x,'discount|policy');
});
test('a return plan with no allocated positive purchase cost never silently invents a master cost',()=>{
 const x=base();x.stockLots[1]['Purchase Price']='';reject(x,'cost');
});
test('proposed stock delta equals returned qty exactly once, with disjoint debit and credit quantities',()=>{
 const x=base(),r=plan(x);
 assert.equal(r.stockQtyDeltaTicks,t(5));
 assert.equal(r.newLotsRestoredTicks,t(5));assert.equal(r.negativeDebtRestoredTicks,0);
 assert.equal(r.newLotsRestoredTicks+r.negativeDebtRestoredTicks,r.stockQtyDeltaTicks);
});

test('funded return proposal carries source-linked exact COGS reversal in integer paisa',()=>{
 const x=base(),r=plan(x);assert.equal(r.status,'READY');
 assert.deepEqual(r.reversalEvents.map(e=>[
  e.provisionalReturnedCostMinor,e.actualReturnedCostMinor,e.cogsDeltaReversalMinor
 ]),[[34000,32375,1625]]);
 assert.equal(r.totalCogsDeltaReversalMinor,1625);
});
test('repeated fractional partial reversals use cumulative rounding rather than independent line rounding',()=>{
 const x=base();
 x.saleItemLots[0].Quantity=0.03;
 x.stockLots[0]['Original Quantity']=0.03;
 x.stockLots[1]['Original Quantity']=0.03;
 x.stockLots[1]['Remaining Quantity']=0;
 x.stockLots[1].Status='Consumed';
 x.products[0]['Current Stock']=0;
 x.settlements=[event('STL-1',0.03,64.75,'PUR-1','NEW-1')];
 x.returnQty=0.01;
 const one=plan(x);assert.equal(one.status,'READY');assert.equal(one.totalCogsDeltaReversalMinor,3);
 x.saleItemLots[0].Quantity=0.02;
 x.stockLots[1]['Remaining Quantity']=0.01;
 x.stockLots[1].Status='Active';
 x.products[0]['Current Stock']=0.01;
 x.reversals=[{'Reversal ID':'REV-1','Return Operation ID':'RETURN-OP-PREVIOUS','Return ID':'SRT-PREV',
   'Settlement ID':'STL-1','Source Invoice ID':'INV-1','Source Sale Product ID':'P1',
   'Quantity Ticks':t(0.01),'Quantity Scale':1e6,'State':'Committed'}];
 x.returnReceipts=[{'Return ID':'SRT-PREV','Invoice ID':'INV-1'}];
 const two=plan(x);assert.equal(two.status,'READY');
 x.saleItemLots[0].Quantity=0.01;x.stockLots[1]['Remaining Quantity']=0.02;
 x.products[0]['Current Stock']=0.02;
 x.reversals.push({'Reversal ID':'REV-2','Return Operation ID':'RETURN-OP-PREVIOUS-2','Return ID':'SRT-PREV2',
   'Settlement ID':'STL-1','Source Invoice ID':'INV-1','Source Sale Product ID':'P1',
   'Quantity Ticks':t(0.01),'Quantity Scale':1e6,'State':'Committed'});
 x.returnReceipts.push({'Return ID':'SRT-PREV2','Invoice ID':'INV-1'});
 const three=plan(x);assert.equal(three.status,'READY');
 const total=one.totalCogsDeltaReversalMinor+two.totalCogsDeltaReversalMinor+three.totalCogsDeltaReversalMinor;
 assert.equal(total,x.settlements[0]['Favorable Variance Minor']);
});
test('reversal must be linked to exact source purchase cost, source invoice, and settlement event',()=>{
 const x=base();x.returnQty=2;
 const r=plan(x);assert.equal(r.status,'READY');
 const e=r.reversalEvents[0];
 assert.equal(e.purchaseLotId,'NEW-1');assert.equal(e.oversoldLotId,'OV-1');
 assert.equal(e.sourceSaleProductId,'P1');assert.equal(e.sourceInvoiceId,'INV-1');
 assert.equal(e.settlementId,'STL-1');assert.equal(e.operationId,x.operationId);
 assert.equal(e.returnId,x.returnId);
});

test('duplicate return ID or operation already present in reversal receipt is never a fresh return',()=>{
 const x=base();x.returnReceipts=[{'Return ID':x.returnId,'Invoice ID':'INV-1'}];
 reject(x,'duplicate|return|receipt');
 const y=base();y.reversals=[{'Reversal ID':'REV-OLD','Return Operation ID':y.operationId,
  'Return ID':'SRT-OLDER','Settlement ID':'STL-1',
  'Source Invoice ID':'INV-1','Source Sale Product ID':'P1','Quantity Ticks':t(1),
  'Quantity Scale':1e6,State:'Committed'}];
 reject(y,'duplicate|return|operation');
});
test('previous source reversal with mismatched receipt or exceedance fails closed',()=>{
 const x=base();x.reversals=[{'Reversal ID':'REV-1','Return Operation ID':'RETURN-OP-OLDER',
  'Return ID':'SRT-PREV','Settlement ID':'STL-1','Source Invoice ID':'INV-OTHER',
  'Source Sale Product ID':'P1','Quantity Ticks':t(1),'Quantity Scale':1e6,State:'Committed'}];
 x.returnReceipts=[{'Return ID':'SRT-PREV','Invoice ID':'INV-1'}];
 reject(x,'receipt|source|reversal');
});
test('this pure planner is not connected to the existing physical return writer while reconciliation is incomplete',()=>{
 const source=fs.readFileSync(path.join(root,'StockLots.gs'),'utf8');
 assert.match(source,/linked return reversal is required\. Needs Review/);
 assert.doesNotMatch(source,/applyFundedOversoldSaleReturn_/);
});

test('duplicate lot identity in another product cannot silently impersonate the source purchased lot',()=>{
 const x=base();x.stockLots.push({...x.stockLots[1], 'Product ID':'P2'});
 reject(x,'duplicate|lot');
});
