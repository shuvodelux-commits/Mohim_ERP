'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),crypto=require('node:crypto');
const root=path.join(__dirname,'..');
const plain=x=>JSON.parse(JSON.stringify(x));
function ctx(){
 const c={console,Date,Math,JSON,BigInt,Number,Object,
    safeDateOnly_:x=>String(x||'').slice(0,10),getAllRows_:()=>{throw Error('Read-only batch unexpectedly read Sheets');},
    Utilities:{DigestAlgorithm:{SHA_256:'SHA_256'},
      computeDigest:(algo,raw)=>Array.from(crypto.createHash('sha256').update(raw,'utf8').digest(), b=>b>127?b-256:b)}};
 vm.createContext(c);
 vm.runInContext(fs.readFileSync(path.join(root,'StockLots.gs'),'utf8'),c);
 vm.runInContext(fs.readFileSync(path.join(root,'PurchaseSettlement.gs'),'utf8'),c);
 return c;
}
const lot=(id,qty,cost=68,pid='P1')=>({'Lot ID':id,'Product ID':pid,'Purchase ID':'OVERSOLD','Purchase Date':'2026-10-01','Original Quantity':Math.abs(qty),'Remaining Quantity':qty,'Purchase Price':cost,'Status':'Oversold',_rowIndex:pid==='P1'?3:5});
const line=(id,qty,cost,scale=1)=>({productId:id,quantity:qty,unitCost:cost,quantityScale:scale,sellingPrice:cost+5});
const base=()=>({
 operationId:'OP-RESTOCK-20261120-001',purchaseId:'PUR-000082',date:'2026-11-20',actor:'USER-1',supplierId:'SUP-1',
 lines:[line('P1',240,64.75),line('P2',5,25)],
 products:[{'Product ID':'P1','Current Stock':-231,_rowIndex:2},{'Product ID':'P2','Current Stock':0,_rowIndex:3}],
 stockLots:[lot('NEG1',-229),lot('NEG2',-2)],
 saleItemLots:[
 {'Invoice ID':'INV-1','Lot ID':'NEG1','Product ID':'P1','Source Sale Product ID':'P1','Quantity':229,'Unit Cost':68},
 {'Invoice ID':'INV-2','Lot ID':'NEG2','Product ID':'P1','Source Sale Product ID':'P1','Quantity':2,'Unit Cost':68}],
 sales:[{'Invoice ID':'INV-1',Date:'2026-10-01'},{'Invoice ID':'INV-2',Date:'2026-10-02'}],
 settlementHistory:[],operationJournal:[]
});
const run=x=>plain(ctx().prepareOversoldPurchaseBatch_(x));
const expectReview=(x,issue)=>{
 const r=run(x);assert.equal(r.status,'NEEDS_REVIEW');assert.equal(r.postable,false);
 assert.deepEqual(r.allocations,[]);assert.match(r.issues.join(' '),new RegExp(issue,'i'));
};
test('multi-product purchase plans -231 against 240 while keeping other five units unallocated',()=>{
 const input=base(),before=structuredClone(input);
 const raw=ctx().prepareOversoldPurchaseBatch_(input),r=plain(raw);
 assert.equal(r.status,'READY');assert.equal(r.postable,false);
 assert.equal(r.operationId,input.operationId);assert.equal(r.purchaseId,input.purchaseId);
 assert.deepEqual(r.lines.map(x=>[x.productId,x.quantityTicks,x.settledTicks,x.newLotAvailableTicks]),[
 ['P1',240,231,9],['P2',5,0,5]]);
 assert.deepEqual(r.allocations.map(x=>[x.oversoldLotId,x.purchaseProductId,x.settledQtyTicks,x.favorableVarianceMinor]),[
 ['NEG1','P1',229,74425],['NEG2','P1',2,650]]);
 assert.equal(r.totalFavorableVarianceMinor,75075);
 assert.equal(Object.isFrozen(raw),true);assert.equal(Object.isFrozen(raw.allocations),true);
 assert.deepEqual(input,before);
});
test('later invalid product makes whole batch review-only; no partial allocations',()=>{
 const x=base();x.products.pop();expectReview(x,'missing_product');
 const y=base();y.lines[1].unitCost=25.005;expectReview(y,'invalid.*cost');
 const z=base();z.lines.push(line('P1',3,10));expectReview(z,'duplicate_product');
});
test('never infer missing historical sale item lot or a missing -2 debt lot',()=>{
 const x=base();x.saleItemLots.pop();expectReview(x,'missing_sale_item_link');
 const y=base();y.stockLots.pop();expectReview(y,'stock_cache_mismatch');
});
test('backdated new purchase cannot fund an older sale that happens after purchase',()=>{
 const x=base();x.date='2026-09-01';expectReview(x,'purchase_before_oversold_sale');
});
test('positive lot plus unresolved negative debt must be reviewed rather than guessed',()=>{
 const x=base();x.stockLots.push({'Lot ID':'PUR-OLDER','Product ID':'P1','Purchase ID':'PUR-7',
 'Remaining Quantity':4,'Purchase Price':60,Status:'Active'});
 x.products[0]['Current Stock']=-227;
 expectReview(x,'existing_positive_with_debt');
});
test('real committed settlement history can fund a prior partial purchase without repricing it',()=>{
 const x=base();x.products[0]['Current Stock']=-131;x.stockLots[0]['Remaining Quantity']=-129;
 x.lines[0].quantity=129;x.lines[1].quantity=2;
 x.settlementHistory=[{'Settlement ID':'STL-1','Operation ID':'OP-OLD','Product ID':'P1',
 'Oversold Lot ID':'NEG1','Source Invoice ID':'INV-1','Source Sale Product ID':'P1',
 'Purchase Lot ID':'LOT-OLD','Quantity Ticks':100,'Quantity Scale':1,'Actual Unit Cost Minor':6475,'State':'Committed'}];
 const r=run(x);
 assert.equal(r.status,'READY');assert.deepEqual(r.allocations.map(a=>[a.oversoldLotId,a.settledQtyTicks]),[['NEG1',129]]);
 assert.equal(r.lines[0].newLotAvailableTicks,0);
});
test('any interrupted prior writer blocks all new purchase planning',()=>{
 const x=base();x.operationJournal=[{'Operation ID':'PREV-1','Product ID':'P1','Purchase ID':'PUR-OLD',
 'State':'Writing','Intent Fingerprint':'original'}];
 expectReview(x,'unresolved_write');
});
test('a reused purchase ID with different operation is rejected',()=>{
 const x=base();x.operationJournal=[{'Operation ID':'OP-OLD','Product ID':'P1','Purchase ID':'PUR-000082',
 'State':'Committed','Intent Fingerprint':'other','Result Receipt':'PUR-000082'}];
 expectReview(x,'duplicate_purchase_id');
});
test('even a committed matching operation ID requires full-cart receipt review',()=>{
 const x=base();x.operationJournal=[{'Operation ID':x.operationId,'Purchase ID':x.purchaseId,'State':'Committed',
 'Intent Fingerprint':'not-the-current-full-cart','Result Receipt':x.purchaseId}];
 expectReview(x,'operation_conflict');
});
test('positive and negative status source mismatch fails before mutation planning',()=>{
 const x=base();x.stockLots[0]['Purchase ID']='ADJUSTMENT';
 expectReview(x,'invalid_negative_lot');
});
test('batch can construct deterministic source-linked lot offsets without sheets or finance writers',()=>{
 const x=base();const r=run(x);
 const mutation=plain(ctx().buildOversoldPurchaseOffsetSet_(r,{'P1':'LOT-NEW-1','P2':'LOT-NEW-2'},x.stockLots));
 assert.equal(mutation.status,'READY');assert.equal(mutation.postable,false);
 assert.deepEqual(mutation.newPurchaseLots.map(x=>[x.productId,x.lotId,x.originalQtyTicks,x.availableQtyTicks]),[
 ['P1','LOT-NEW-1',240,9],['P2','LOT-NEW-2',5,5]]);
 assert.deepEqual(mutation.oldDebtUpdates.map(x=>[x.lotId,x.beforeTicks,x.afterTicks,x.statusAfter]),[
 ['NEG1',-229,0,'Consumed'],['NEG2',-2,0,'Consumed']]);
 assert.equal(mutation.settlementEvents.length,2);
 assert.equal(mutation.settlementEvents[0].sourceInvoiceId,'INV-1');
 assert.equal(mutation.settlementEvents[0].newPurchaseLotId,'LOT-NEW-1');
 assert.equal(mutation.settlementEvents[0].actualUnitCostMinor,6475);
 assert.equal(mutation.projectedProductStockChanges.length,2);
 assert.deepEqual(mutation.projectedProductStockChanges.map(x=>[x.productId,x.deltaTicks]),[['P1',240],['P2',5]]);
 assert.equal('writeRow' in mutation,false);
});
test('missing new purchase lot ID blocks every offset; duplicate new ID blocks too',()=>{
 const x=base(),r=run(x),c=ctx();
 const miss=plain(c.buildOversoldPurchaseOffsetSet_(r,{'P1':'L1'},x.stockLots));
 assert.equal(miss.status,'NEEDS_REVIEW');assert.deepEqual(miss.oldDebtUpdates,[]);
 const duplicate=plain(c.buildOversoldPurchaseOffsetSet_(r,{'P1':'L1','P2':'L1'},x.stockLots));
 assert.equal(duplicate.status,'NEEDS_REVIEW');assert.deepEqual(duplicate.settlementEvents,[]);
});
test('mutation offsets are immutable and cannot create extra product-stock increments',()=>{
 const x=base(),r=run(x),raw=ctx().buildOversoldPurchaseOffsetSet_(r,{'P1':'LOT-NEW-1','P2':'LOT-NEW-2'},x.stockLots);
 assert.equal(Object.isFrozen(raw),true);assert.equal(Object.isFrozen(raw.oldDebtUpdates),true);
 assert.equal(raw.extraProductStockDeltaTicks,0);
});

test('historic settlement scale mismatch blocks a second replenishment instead of silently reuniting ticks',()=>{
 const x=base();x.products[0]['Current Stock']=-131;x.stockLots[0]['Remaining Quantity']=-129;x.lines[0].quantity=129;
 x.settlementHistory=[{'Settlement ID':'STL-OLD','Operation ID':'OP-OLD','Product ID':'P1',
  'Oversold Lot ID':'NEG1','Source Invoice ID':'INV-1','Source Sale Product ID':'P1',
  'Purchase Lot ID':'LOT-OLD','Quantity Ticks':100,'Quantity Scale':100,
  'Actual Unit Cost Minor':6475,'State':'Committed'}];
 expectReview(x,'quantity_scale_mismatch');
});
test('immutable event identity must be unique across products in a single purchase source snapshot',()=>{
 const x=base();x.settlementHistory=[
  {'Settlement ID':'STL-DUP','Product ID':'P1','State':'Committed','Oversold Lot ID':'NEG1',
   'Source Invoice ID':'INV-1','Source Sale Product ID':'P1','Purchase Lot ID':'LOT-A',
   'Operation ID':'OP-A','Quantity Ticks':0,'Quantity Scale':1,'Actual Unit Cost Minor':100},
  {'Settlement ID':'STL-DUP','Product ID':'P2','State':'Committed','Oversold Lot ID':'NONE',
   'Source Invoice ID':'INV-2','Source Sale Product ID':'P2','Purchase Lot ID':'LOT-B',
   'Operation ID':'OP-B','Quantity Ticks':1,'Quantity Scale':1,'Actual Unit Cost Minor':100}];
 expectReview(x,'duplicate_settlement_identity');
});

test('full purchase intent fingerprint is stable under cart row order but actor-bound and collision-sensitive',()=>{
 const c=ctx(),x=base();
 x.payment={discount:0,paidAmount:100,paymentMethod:'Cash',bankAccountId:'',notes:'first purchase'};
 const first=c.buildPurchaseSettlementIntentHash_(x);
 assert.match(first,/^sha256:[a-f0-9]{64}$/);
 const reordered=structuredClone(x);reordered.lines.reverse();
 assert.equal(c.buildPurchaseSettlementIntentHash_(reordered),first);
 for(const [key,val] of [['supplierId','SUP-2'],['actor','USER-2'],['date','2026-11-21'],
   ['operationId','OP-RESTOCK-20261120-002']]){
   const changed=structuredClone(x);changed[key]=val;
   assert.notEqual(c.buildPurchaseSettlementIntentHash_(changed),first,key);
 }
 for(const [key,val] of [['discount',1],['paidAmount',90],['paymentMethod','Bank'],
   ['bankAccountId','BANK-2'],['notes','a different purchase']]){
   const changed=structuredClone(x);changed.payment[key]=val;
   assert.notEqual(c.buildPurchaseSettlementIntentHash_(changed),first,key);
 }
 const q=structuredClone(x);q.lines[0].quantity=239;
 assert.notEqual(c.buildPurchaseSettlementIntentHash_(q),first,'quantity');
 const cost=structuredClone(x);cost.lines[0].unitCost=60;
 assert.notEqual(c.buildPurchaseSettlementIntentHash_(cost),first,'purchase cost');
 const sell=structuredClone(x);sell.lines[1].sellingPrice=31;
 assert.notEqual(c.buildPurchaseSettlementIntentHash_(sell),first,'selling price');
});
test('invalid money precision and quantity ticks fail before operation fingerprint is computed',()=>{
 const c=ctx(),x=base();x.payment={discount:0,paidAmount:100,paymentMethod:'Cash',bankAccountId:'',notes:''};
 x.payment.discount=0.005;
 assert.throws(()=>c.buildPurchaseSettlementIntentHash_(x),/precision|money|paisa/i);
 x.payment.discount=0;x.lines[0].quantity=1.001;
 assert.throws(()=>c.buildPurchaseSettlementIntentHash_(x),/quantity|precision/i);
 x.lines[0].quantity=240;x.lines[0].unitCost=64.755;
 assert.throws(()=>c.buildPurchaseSettlementIntentHash_(x),/price|precision|money/i);
});
