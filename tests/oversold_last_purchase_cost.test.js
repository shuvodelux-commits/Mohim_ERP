'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','StockLots.gs'),'utf8');
const product=(cost=72)=>({'Product ID':'P1','Product Name':'Cable','Purchase Price':cost,'Selling Price':100,'Current Stock':0});
function lot(id,date,cost,remaining=0,more={}){
 return {'Lot ID':id,'Product ID':'P1','Purchase ID':'PUR-01','Purchase Date':date,'Original Quantity':20,
   'Remaining Quantity':remaining,'Purchase Price':cost,'Status':remaining>0?'Active':'Consumed',...more};
}
function harness(lots,master=72){
 const writes=[],ctx={Date,console,isValidNonNegativeNumber_:x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x))&&Number(x)>=0,
 safeDateOnly_:x=>x instanceof Date?x.toISOString().slice(0,10):String(x||'').slice(0,10),
 isDeleted_:x=>x['Is Deleted']===true||String(x['Is Deleted']).toUpperCase()==='TRUE',
 getAllRows_:name=>name==='STOCK_LOTS'?lots:name==='PRODUCTS'?[product(master)]:[],
 createLotWithRow_:(...args)=>{writes.push({kind:'create',args});return{id:'OV-1',rowIndex:2};},
 updateRowFields_:(...args)=>writes.push({kind:'update',args})};
 vm.createContext(ctx);vm.runInContext(source,ctx);
 ctx.createLotWithRow_=(...args)=>{writes.push({kind:'create',args});return{id:'OV-1',rowIndex:2};};
 return {ctx,writes,plan:(qty,date='2026-09-30')=>ctx.planStockConsumption_('P1',qty,lots,product(master),date)};
}
const plain=x=>JSON.parse(JSON.stringify(x));

test('OVERSOLD uses last actual purchase cost even if fully consumed, not product master',()=>{
 const w=harness([lot('L-FIRST','2026-09-01',60),lot('L-LAST','2026-09-05',68)],72);
 const plan=w.plan(10);
 assert.equal(plan.shortfall,10);
 assert.equal(plan.fallbackPrice,68);
 assert.equal(plan.fallbackCostLotId,'L-LAST');
 assert.equal(plan.fallbackCostPurchaseId,'PUR-01');
 assert.deepEqual(w.writes,[]);
});
test('last real lot at sale date is ordered by purchase date and stable lot ID, not input order',()=>{
 const w=harness([lot('L-2','2026-09-10',75),lot('L-3','2026-09-10',77),lot('L-1','2026-09-01',68)],72);
 const plan=w.plan(2,'2026-09-11');
 assert.equal(plan.fallbackPrice,77);
 assert.equal(plan.fallbackCostLotId,'L-3');
});
test('future or backdated sale must not borrow a later purchase cost',()=>{
 const w=harness([lot('OLD','2026-09-01',68),lot('FUTURE','2026-09-19',90)],72);
 assert.equal(w.plan(2,'2026-09-05').fallbackPrice,68);
 assert.equal(w.plan(2,'2026-09-30').fallbackPrice,90);
});
test('exclude OVERSOLD, OPENING, adjustment, deleted and unrelated product from last purchase',()=>{
 const rows=[
 lot('OLD','2026-09-01',68),
 lot('BAD-DELETED','2026-09-20',90,0,{'Is Deleted':'TRUE'}),
 lot('OV','2026-09-21',95,-2,{'Purchase ID':'OVERSOLD','Status':'Oversold'}),
 lot('ADJ','2026-09-22',99,0,{'Purchase ID':'ADJUSTMENT'}),
 lot('OP','2026-09-23',98,0,{'Purchase ID':'OPENING'}),
 lot('OTHER','2026-09-24',110,0,{'Product ID':'P2'})
 ];
 const w=harness(rows);
 // This test isolates historical *source selection*; the synthetic lot
 // snapshot is intentionally not stock-balanced (-2) and a real sale must
 // now reject it before posting rather than silently spending gross stock.
 assert.equal(w.ctx.lastPurchasedLotCostAsOf_('P1',rows,'2026-09-30').unitCost,68);
 assert.throws(()=>w.plan(1,'2026-09-30'),/mismatch|Needs Review/i);
});
test('invalid most recent real purchase cost fails closed, not older or master price',()=>{
 const w=harness([lot('OLD','2026-09-01',68),lot('BAD','2026-09-05','')],72);
 assert.throws(()=>w.plan(1),/Needs Review|purchase cost/i);
 assert.deepEqual(w.writes,[]);
});
test('no trustworthy purchased lot blocks unauditable oversold before writes',()=>{
 for(const rows of [[],[lot('OPEN','2026-09-01',40,0,{'Purchase ID':'OPENING'})]]){
  const w=harness(rows,72);
  assert.throws(()=>w.plan(1),/Needs Review|purchase cost/i);
  assert.deepEqual(w.writes,[]);
 }
});
test('a purchased lot dated after the sale is not a valid fallback, even if in the sheet',()=>{
 const w=harness([lot('NEW','2026-09-12',80)],72);
 assert.throws(()=>w.plan(1,'2026-09-09'),/Needs Review|purchase cost/i);
});
test('positive available lot consumes normally; no fallback lookup is required',()=>{
 const w=harness([lot('IN-STOCK','2026-09-01',45,4)],72);
 const p=plain(w.plan(3,'2026-09-05'));
 assert.equal(p.shortfall,0);assert.equal(p.draws.length,1);
 assert.equal(p.draws[0].unitCost,45);
 assert.deepEqual(w.writes,[]);
});
test('OVERSOLD write retains original cost-source lot identity, never changes master or cash',()=>{
 const w=harness([lot('OLD','2026-09-01',68)]);
 const plan=w.plan(3,'2026-09-05'),out=plain(w.ctx.applyStockConsumption_(plan));
 assert.deepEqual(out,[{lotId:'OV-1',qty:3,unitCost:68,unitSellPrice:100}]);
 assert.equal(w.writes[0].kind,'create');assert.equal(w.writes[0].args[4],68);
 const fields=w.writes.find(x=>x.kind==='update').args[2];
 assert.equal(fields['Remaining Quantity'],-3);
 assert.equal(fields['Provisional Cost Source Lot ID'],'OLD');
 assert.equal(fields['Provisional Cost Source Purchase ID'],'PUR-01');
});
test('genuine zero-cost purchase can be the last lot without silently reverting to master cost',()=>{
 const w=harness([lot('FREE','2026-09-01',0)]);
 assert.equal(w.plan(3).fallbackPrice,0);
});

test('last purchased lot provenance schema is explicitly declared in Stock Lots headers',()=>{
 const config=fs.readFileSync(path.join(__dirname,'..','Config.gs'),'utf8');
 const stockHeaders=config.split('STOCK_LOTS: [')[1].split('SALE_ITEM_LOTS: [')[0];
 assert.match(stockHeaders,/Provisional Cost Source Lot ID/);
 assert.match(stockHeaders,/Provisional Cost Source Purchase ID/);
});
test('duplicate last purchase lot identity blocks provisional COGS rather than guessing',()=>{
 const w=harness([lot('DUP','2026-09-01',68),lot('DUP','2026-09-01',70)]);
 assert.throws(()=>w.plan(1),/ambiguous|Needs Review/i);
 assert.deepEqual(w.writes,[]);
});
