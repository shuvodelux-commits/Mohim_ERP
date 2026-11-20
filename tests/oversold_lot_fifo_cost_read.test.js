'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const vm=require('node:vm'), fs=require('node:fs'), path=require('node:path');
const root=path.resolve(__dirname,'..');
function api(){
 const ctx={
  safeDateOnly_:v=>v instanceof Date ? v.toISOString().slice(0,10) : String(v||'').slice(0,10),
  isValidNonNegativeNumber_:v=>v!==null && v!=='' && Number.isFinite(Number(v)) && Number(v)>=0,
  roundMoney_:n=>Math.round((n+Number.EPSILON)*100)/100
 };
 vm.createContext(ctx);
 vm.runInContext(fs.readFileSync(path.join(root,'StockLots.gs'),'utf8'),ctx);
 return ctx.buildLotCostSnapshot_;
}
const p=(current=9,cost=68)=>({'Product ID':'PIPE','Product Name':'SWR Pipe','Current Stock':current,'Purchase Price':cost,'Selling Price':70});
function lot(id,qty,cost,date='2026-11-19',src='PUR-082',status='Active'){
 return {'Lot ID':id,'Product ID':'PIPE','Purchase Date':date,'Purchase ID':src,
  'Purchase Price':cost,'Remaining Quantity':qty,'Original Quantity':Math.abs(qty),'Status':status};
}
const scenario=(two=true)=>[
 lot('LOT-000939',-229,68,'2026-11-01','OVERSOLD','Oversold'),
 ...(two?[lot('LOT-OTHER',-2,68,'2026-11-02','OVERSOLD','Oversold')]:[]),
 lot('LOT-000940',240,64.75)
];
const plain=x=>JSON.parse(JSON.stringify(x));
test('231 historic deficit and 240 bought gives 9 owned @ actual 64.75, while valuation stays unposted',()=>{
 const lots=scenario(),original=structuredClone(lots);
 const v=plain(api()('PIPE',lots,p()));
 assert.equal(v.status,'UNSETTLED');
 assert.equal(v.netQty,9);assert.equal(v.unresolvedOversold,231);
 assert.equal(v.originalStockValue,-168);assert.equal(v.projectedStockValue,582.75);
 assert.equal(v.nextUnitCost,64.75);
 assert.deepEqual(v.costTiers,[{qty:9,unitCost:64.75,lotId:'LOT-000940'}]);
 assert.deepEqual(lots,original);
});
test('229 debt and 240 bought gives 11, refuses cached 9 rather than inventing two feet',()=>{
 const result=plain(api()('PIPE',scenario(false),p(9)));
 assert.equal(result.status,'NEEDS_REVIEW');
 assert.equal(result.netQty,11);assert.equal(result.nextUnitCost,null);
 assert.equal(result.projectedStockValue,null);
 assert.equal(result.originalStockValue,-32);
});
test('229 debt and verified stock 11 projects 11 @ 64.75, not 9',()=>{
 const v=plain(api()('PIPE',scenario(false),p(11)));
 assert.equal(v.status,'UNSETTLED');
 assert.equal(v.projectedStockValue,712.25);assert.equal(v.nextUnitCost,64.75);
});
test('mismatched pipe stock exposes only a clearly unverified source-lot projection',()=>{
 const lots=[
  lot('OLD',2,64.68,'2026-10-07','PUR-000036'),
  lot('NEG',-404,64.68,'2026-11-20','OVERSOLD','Oversold'),
  lot('NEW',800,70,'2026-11-20','PUR-000040')
 ];
 const old=structuredClone(lots);
 const v=plain(api()('PIPE',lots,p(396,64.68)));
 assert.equal(v.status,'NEEDS_REVIEW');
 assert.equal(v.issue,'STOCK_MISMATCH');
 assert.equal(v.netQty,398);
 assert.equal(v.qtyDifference,2);
 assert.equal(v.nextUnitCost,null,'verified FIFO cost must stay blocked');
 assert.equal(v.projectedStockValue,null,'booked asset value must stay blocked');
 assert.equal(v.provisionalNextUnitCost,70);
 assert.equal(v.provisionalStockValue,27860);
 assert.equal(v.provisionalQty,398);
 assert.deepEqual(v.provisionalTiers,[{qty:398,unitCost:70,lotId:'NEW'}]);
 assert.deepEqual(lots,old,'no stock data writes');
});
test('invalid stock lot evidence never creates a fake provisional cost',()=>{
 const v=plain(api()('PIPE',[lot('X',4,'invalid')],p(3)));
 assert.equal(v.provisionalNextUnitCost,null);
 assert.equal(v.provisionalStockValue,null);
 assert.deepEqual(v.provisionalTiers,[]);
});
test('ordinary multi-supplier FIFO preserves lot price and quantity tiers',()=>{
 const lots=[lot('L-2',4,66,'2026-11-07'),lot('L-1',2,60,'2026-11-02')];
 const v=plain(api()('PIPE',lots,p(6)));
 assert.equal(v.status,'OK');
 assert.deepEqual(v.costTiers,[{qty:2,unitCost:60,lotId:'L-1'},{qty:4,unitCost:66,lotId:'L-2'}]);
 assert.equal(v.projectedStockValue,384);
 assert.equal(v.nextUnitCost,60);
});
test('FIFO debt is reserved oldest-purchase-first across verified newer positive lots',()=>{
 const lots=[
 lot('NEG',-3,68,'2026-10-10','OVERSOLD','Oversold'),
 lot('P1',2,60,'2026-11-01'),lot('P2',5,70,'2026-11-02')
 ];
 const v=plain(api()('PIPE',lots,p(4)));
 assert.equal(v.status,'UNSETTLED');
 assert.deepEqual(v.costTiers,[{qty:4,unitCost:70,lotId:'P2'}]);
 assert.equal(v.nextUnitCost,70);assert.equal(v.projectedStockValue,280);
});
test('backdated positive purchase before outstanding oversold fails closed',()=>{
 const lots=[lot('EARLY',240,64.75,'2026-10-01'),lot('NEG',-229,68,'2026-11-01','OVERSOLD','Oversold')];
 const v=plain(api()('PIPE',lots,p(11)));
 assert.equal(v.status,'NEEDS_REVIEW');assert.equal(v.projectedStockValue,null);
 assert.equal(v.nextUnitCost,null);
});
test('deleted positive lot, duplicate ID or missing lot cost fail closed',()=>{
 const cases=[
 [lot('P',4,68,'2026-11-01','PUR-1','Deleted')],
 [lot('P',2,68),lot('P',2,66)],
 [lot('P',4,'not-a-number')]
 ];
 for (const lots of cases){
  const v=plain(api()('PIPE',lots,p(4)));
  assert.equal(v.status,'NEEDS_REVIEW');
  assert.equal(v.nextUnitCost,null);
 }
});
test('valid free purchase cost 0 must not be replaced by master 68',()=>{
 const v=plain(api()('PIPE',[lot('FREE',3,0)],p(3)));
 assert.equal(v.status,'OK');assert.equal(v.nextUnitCost,0);
 assert.equal(v.projectedStockValue,0);
});
test('unpriced internal opening lot requires review, not a fabricated zero-cost asset',()=>{
 const v=plain(api()('PIPE',[lot('OPEN',2,0,'2026-10-01','OPENING')],p(2)));
 assert.equal(v.status,'NEEDS_REVIEW');assert.equal(v.nextUnitCost,null);
});
test('negative-only product remains a real shortage, with no available priced stock',()=>{
 const v=plain(api()('PIPE',[lot('NEG',-3,68,'2026-11-01','OVERSOLD','Oversold')],p(-3)));
 assert.equal(v.status,'NEGATIVE_STOCK');assert.equal(v.netQty,-3);
 assert.equal(v.costTiers.length,0);assert.equal(v.originalStockValue,-204);
});
test('empty or orphan lot cache never shows made-up lot prices',()=>{
 const a=plain(api()('PIPE',[],p(3)));
 assert.equal(a.status,'NEEDS_REVIEW');assert.equal(a.nextUnitCost,null);
 const b=plain(api()('PIPE',[],p(0)));
 assert.equal(b.status,'EMPTY');
});
test('the helper returns exact per-lot units with fractional feet',()=>{
 const lots=[lot('P1',1.5,64.75),lot('P2',1.25,70)];
 const v=plain(api()('PIPE',lots,p(2.75)));
 assert.equal(v.status,'OK');assert.equal(v.nextUnitCost,64.75);
 assert.equal(v.costTiers[0].qty,1.5);assert.equal(v.costTiers[1].qty,1.25);
});
