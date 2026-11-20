'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..');
function runtime(){const c={Number,Math,Object,Date,BigInt,console};vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(root,'ProfitOversoldCosts.gs'),'utf8'),c);return c;}
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

function withReturn(qty=5){
 const x=evidence(),returnId='SRT-NEW', op='RETURN-OP-20261120-0001';
 x.saleItemLots[0].Quantity-=qty;
 x.stockLots[2]['Remaining Quantity']+=qty;
 x.reversals=[{'Reversal ID':'SRV-1','Return Operation ID':op,'Return ID':returnId,
  'Settlement ID':'STL-1','Product ID':'P1','Source Invoice ID':'INV-1',
  'Source Sale Product ID':'P1','Oversold Lot ID':'OV-1','Purchase Lot ID':'PURLOT-1',
  'Quantity Ticks':qty*1e6,'Quantity Scale':1e6,'Provisional Unit Cost Minor':6800,
  'Actual Unit Cost Minor':6475,'Provisional Returned Cost Minor':qty*6800,
  'Actual Returned Cost Minor':qty*6475,'Cogs Delta Reversal Minor':qty*325,State:'Committed'}];
 x.returnJournals=[{'Operation ID':op,'Return ID':returnId,'Invoice ID':'INV-1','Product ID':'P1',
  State:'Committed','Last Completed Stage':'Committed','Result Receipt':returnId}];
 x.returnReceipts=[{'Return ID':returnId,'Return Operation ID':op,'Invoice ID':'INV-1'}];
 x.returnItems=[{'Return ID':returnId,'Invoice ID':'INV-1','Product ID':'P1','Return Quantity':qty}];
 return x;
}
function reject(x,pattern){const r=calc(x);assert.equal(r.status,'NEEDS_REVIEW');assert.deepEqual(r.adjustments,[]);assert.match(r.issues.join(','),new RegExp(pattern,'i'));}
test('verified funded return removes exactly returned actual-vs-provisional COGS adjustment from original sale period',()=>{
 const x=withReturn(),r=calc(x);
 assert.equal(r.status,'READY');assert.equal(r.totalCogsDeltaMinor,-73450);
 assert.equal(r.adjustments.find(a=>a.invoiceId==='INV-1').deltaMinor,-72800);
 assert.equal(r.adjustments.find(a=>a.invoiceId==='INV-2').deltaMinor,-650);
});
test('omitted committed reversal for a now-returned sold unit must not be treated as final profit',()=>{
 const x=withReturn();x.reversals=[];reject(x,'quantity|reversal|missing');
});
test('unsigned return event, wrong source invoice, returned lot, or duplicate reversal is Needs Review',()=>{
 const a=withReturn();a.reversals[0].State='Writing';reject(a,'reversal|pending');
 const b=withReturn();b.reversals[0]['Source Invoice ID']='INV-OTHER';reject(b,'invoice|source');
 const c=withReturn();c.reversals[0]['Purchase Lot ID']='NOT-SAME';reject(c,'purchase|lot|source');
 const e=withReturn();e.reversals.push({...e.reversals[0]});reject(e,'duplicate');
});
test('return journal needs verified committed receipt and matching original invoice/operation',()=>{
 const a=withReturn();a.returnJournals=[];reject(a,'journal');
 const b=withReturn();b.returnJournals[0].State='Needs Review';reject(b,'pending|journal');
 const c=withReturn();c.returnReceipts[0]['Return Operation ID']='WRONG';reject(c,'receipt|return');
 const e=withReturn();e.returnItems[0]['Return Quantity']=0;reject(e,'quantity|return');
});
test('wrong paisa COGS reversal or excess reversed quantity rejected',()=>{
 const a=withReturn();a.reversals[0]['Cogs Delta Reversal Minor']+=1;reject(a,'variance|cost|cogs');
 const b=withReturn();b.reversals[0]['Actual Returned Cost Minor']+=1;reject(b,'variance|cost|cogs');
 const c=withReturn();c.reversals[0]['Quantity Ticks']=230e6;reject(c,'quantity|reversed');
});
test('missing any one of reversals/journals/return source evidence is incomplete not a zero-cost adjustment',()=>{
 const x=withReturn();delete x.returnJournals;reject(x,'missing|incomplete');
 const y=withReturn();delete y.returnReceipts;reject(y,'missing|incomplete');
});
test('full returned funded portion has zero effective COGS for its original source',()=>{
 const x=withReturn(229),r=calc(x);assert.equal(r.status,'READY');
 assert.equal(r.adjustments.find(a=>a.invoiceId==='INV-1').deltaMinor,0);
 assert.equal(r.totalCogsDeltaMinor,-650);
});
test('malformed extra funded return journal can never be hidden from profit',()=>{
 const x=withReturn();x.returnJournals.push({'Operation ID':'UNKNOWN','Return ID':'SRT-OTHER','Invoice ID':'INV-1',State:'Writing'});
 reject(x,'pending|journal');
});
test('soft-deleted or cancelled source return receipts cannot be used to assert final COGS',()=>{
 const x=withReturn();x.returnReceipts[0]['Is Deleted']='TRUE';reject(x,'deleted|cancel|receipt');
 const y=withReturn();y.returnReceipts[0].Status='Cancelled';reject(y,'deleted|cancel|receipt');
});
