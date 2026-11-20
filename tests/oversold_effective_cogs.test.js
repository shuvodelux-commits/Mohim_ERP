'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
function runtime(){
 const c={Number,Math,Object,Date,console};
 vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(root,'ProfitOversoldCosts.gs'),'utf8'),c);
 return c;
}
const plain=x=>JSON.parse(JSON.stringify(x));
function evidence(){
 const op='OP-RESTOCK-20261120-001',pid='PUR-100';
 const lots=[
 {'Lot ID':'OV-1','Product ID':'P1','Purchase ID':'OVERSOLD','Original Quantity':229,'Remaining Quantity':0,'Purchase Price':68,Status:'Consumed'},
 {'Lot ID':'OV-2','Product ID':'P1','Purchase ID':'OVERSOLD','Original Quantity':2,'Remaining Quantity':0,'Purchase Price':68,Status:'Consumed'},
 {'Lot ID':'PURLOT-1','Product ID':'P1','Purchase ID':pid,'Original Quantity':240,'Remaining Quantity':9,'Purchase Price':64.75,Status:'Active'}
 ];
 const link=[
 {'Invoice ID':'INV-1','Product ID':'P1','Source Sale Product ID':'P1','Lot ID':'OV-1',Quantity:229,'Unit Cost':68},
 {'Invoice ID':'INV-2','Product ID':'P1','Source Sale Product ID':'P1','Lot ID':'OV-2',Quantity:2,'Unit Cost':68}
 ];
 const events=link.map((l,i)=>({
 'Settlement ID':'STL-'+(i+1),'Operation ID':op,'Purchase ID':pid,'Purchase Lot ID':'PURLOT-1',
 'Product ID':'P1','Oversold Lot ID':l['Lot ID'],'Source Invoice ID':l['Invoice ID'],
 'Source Sale Product ID':'P1','Quantity Ticks':l.Quantity*1e6,'Quantity Scale':1e6,
 'Provisional Unit Cost Minor':6800,'Actual Unit Cost Minor':6475,
 'Provisional COGS Minor':l.Quantity*6800,'Actual COGS Minor':l.Quantity*6475,
 'Favorable Variance Minor':l.Quantity*(6800-6475),State:'Committed'
 }));
 return {
 saleItemLots:link,stockLots:lots,settlements:events,
 journals:[{'Operation ID':op,'Purchase ID':pid,State:'Committed','Last Completed Stage':'Committed','Result Receipt':pid}],
 purchases:[{'Purchase ID':pid,Discount:0}]
 };
}
function calc(data){return plain(runtime().computeCommittedOversoldCostOverlay_(data));}
function review(data,re){const r=calc(data);assert.equal(r.status,'NEEDS_REVIEW');assert.deepEqual(r.adjustments,[]);assert.match(r.issues.join(' '),new RegExp(re,'i'));}
test('replace provisional 231 feet @৳68 with actual new lot @৳64.75, without source mutation',()=>{
 const x=evidence(),before=structuredClone(x);const raw=runtime().computeCommittedOversoldCostOverlay_(x),r=plain(raw);
 assert.equal(r.status,'READY');assert.equal(r.totalCogsDeltaMinor,-75075);
 assert.deepEqual(r.adjustments.map(a=>[a.invoiceId,a.sourceSaleProductId,a.deltaMinor]),[
  ['INV-1','P1',-74425],['INV-2','P1',-650]]);
 assert.equal(Object.isFrozen(raw),true);assert.deepEqual(before,x);
});
test('out-of-range invoice is excluded by report layer, not from source evidence integrity',()=>{
 const x=evidence(),r=calc(x);
 assert.equal(r.adjustments.length,2);
 assert.equal(r.adjustments.find(a=>a.invoiceId==='INV-2').deltaMinor,-650);
});
test('missing committed journal, incomplete journal or duplicate journal blocks the whole cost overlay',()=>{
 const x=evidence();x.journals=[];review(x,'journal');
 const y=evidence();y.journals[0].State='Writing';review(y,'pending|journal|writing');
 const z=evidence();z.journals.push({...z.journals[0]});review(z,'duplicate|journal');
});
test('event without source sale-item lot or duplicated event ID cannot be counted',()=>{
 const x=evidence();x.saleItemLots.pop();review(x,'source|sale');
 const y=evidence();y.settlements[1]['Settlement ID']='STL-1';review(y,'duplicate');
 const z=evidence();z.settlements[0].State='Writing';review(z,'uncommitted|writing|pending');
});
test('cost source, purchase cost, and event cost conservation must agree in integer paisa',()=>{
 const x=evidence();x.saleItemLots[0]['Unit Cost']=67;review(x,'provisional|source');
 const y=evidence();y.stockLots[2]['Purchase Price']=65;review(y,'purchase|cost');
 const z=evidence();z.settlements[0]['Favorable Variance Minor']+=1;review(z,'variance|cost');
 const a=evidence();a.settlements[0]['Actual COGS Minor']+=1;review(a,'cost|cogs');
});
test('no more units can be funded than the outstanding original sale quantity',()=>{
 const x=evidence();x.saleItemLots[0].Quantity=228;review(x,'quantity|funded|returned');
 const y=evidence();y.settlements[0]['Quantity Ticks']+=1e6;review(y,'quantity|funded');
});
test('signed debt quantity must equal outstanding sold units minus all committed funding',()=>{
 const x=evidence();x.stockLots[0]['Remaining Quantity']=-1;review(x,'debt|stock|quantity');
});
test('previously partially funded stock can have distinct original and subsequent purchase prices',()=>{
 const x=evidence();
 x.stockLots[0]['Remaining Quantity']=0;x.stockLots[2]['Remaining Quantity']=9;
 x.stockLots.push({'Lot ID':'PURLOT-OLD','Product ID':'P1','Purchase ID':'PUR-OLD',
 'Original Quantity':100,'Remaining Quantity':0,'Purchase Price':66,Status:'Consumed'});
 x.journals.push({'Operation ID':'OP-OLDER','Purchase ID':'PUR-OLD',State:'Committed','Last Completed Stage':'Committed','Result Receipt':'PUR-OLD'});
 x.purchases.push({'Purchase ID':'PUR-OLD',Discount:0});
 x.settlements[0]['Quantity Ticks']=129e6;x.settlements[0]['Provisional COGS Minor']=129*6800;
 x.settlements[0]['Actual COGS Minor']=129*6475;
 x.settlements[0]['Favorable Variance Minor']=129*325;
 x.settlements.push({
  ...x.settlements[0],'Settlement ID':'STL-OLD','Operation ID':'OP-OLDER','Purchase ID':'PUR-OLD',
  'Purchase Lot ID':'PURLOT-OLD','Quantity Ticks':100e6,
  'Provisional COGS Minor':100*6800,'Actual COGS Minor':100*6600,
  'Actual Unit Cost Minor':6600,'Favorable Variance Minor':20000
 });
 const r=calc(x);assert.equal(r.status,'READY');
 assert.equal(r.totalCogsDeltaMinor,-(129*325+100*200+2*325));
});
test('committed allocation with invoice discount is withheld pending explicit effective-cost policy',()=>{
 const x=evidence();x.purchases[0].Discount=100;review(x,'discount|policy');
});
test('old ERP without settlement events remains cost-neutral when journal is empty',()=>{
 const x=evidence();x.stockLots=[];x.settlements=[];x.journals=[];x.saleItemLots=[];
 const r=calc(x);assert.equal(r.status,'READY');assert.equal(r.totalCogsDeltaMinor,0);
 assert.deepEqual(r.adjustments,[]);
});

test('committed purchase missing one old negative-source allocation cannot silently omit its COGS delta',()=>{
 const x=evidence();x.settlements.pop();review(x,'missing|debt|quantity|source');
});
test('partly funded old sale remains clearly provisional until its remaining one unit is replenished',()=>{
 const x=evidence();
 x.settlements[1]['Quantity Ticks']=1000000;
 x.settlements[1]['Provisional COGS Minor']=6800;
 x.settlements[1]['Actual COGS Minor']=6475;
 x.settlements[1]['Favorable Variance Minor']=325;
 x.stockLots[1]['Remaining Quantity']=-1;x.stockLots[1].Status='Oversold';
 x.stockLots[2]['Remaining Quantity']=10;
 const r=calc(x);
 assert.equal(r.status,'PROVISIONAL');
 assert.equal(r.provisionalSourceCount,1);
 assert.equal(r.totalCogsDeltaMinor,-74750);
});
