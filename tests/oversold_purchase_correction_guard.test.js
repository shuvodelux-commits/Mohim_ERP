'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','StockLots.gs'),'utf8');
function harness(){
 const ctx={safeDateOnly_:x=>String(x||'').slice(0,10),getAllRows_:()=>{throw Error('No hidden sheet reads');}};
 vm.createContext(ctx);vm.runInContext(source,ctx);
 return ctx;
}
const positive=(id,purchaseId,qty,date='2026-11-10')=>({
 'Lot ID':id,'Product ID':'P1','Purchase ID':purchaseId,'Purchase Date':date,
 'Remaining Quantity':qty,'Original Quantity':qty,'Purchase Price':65,Status:'Active',_rowIndex:2
});
const debt=(qty)=>({
 'Lot ID':'OV-OLD','Product ID':'P1','Purchase ID':'OVERSOLD',
 'Purchase Date':'2026-11-01','Remaining Quantity':-qty,'Original Quantity':qty,
 'Purchase Price':68,Status:'Oversold',_rowIndex:4
});
const data=()=>[positive('L1','PUR-A',20,'2026-11-04'),positive('L2','PUR-B',30,'2026-11-11'),debt(20)];
const norm=x=>JSON.parse(JSON.stringify(x));

test('RED: FIFO reservation binds -20 historic debt to older PUR-A, not newer PUR-B',()=>{
 const lots=data(),before=structuredClone(lots);
 const r=norm(harness().planPurchaseLotOwnAvailability_('P1',lots,{'Product ID':'P1','Current Stock':30}));
 assert.equal(r.outstandingOversoldQty,20);
 assert.deepEqual(r.lots.map(l=>[l.lotId,l.reservedQty,l.freeQty]),[['L1',20,0],['L2',0,30]]);
 assert.equal(r.netQty,30);assert.deepEqual(lots,before);
});
test('RED: a purchase return against reserved lot refuses even when product net stock is enough',()=>{
 const c=harness(),lots=data(),prod={'Product ID':'P1','Current Stock':30};
 assert.throws(()=>c.planPurchaseReturnLotReduction_('PUR-A','P1',1,lots,prod),/reserved|oversold|available/i);
 assert.deepEqual(norm(c.planPurchaseReturnLotReduction_('PUR-B','P1',30,lots,prod).draws.map(x=>x.take)),[30]);
});
test('RED: purchase return only 9 of 240 when 231 older oversold',()=>{
 const c=harness(),lots=[positive('PUR-NEW','PUR-82',240),debt(231)],product={'Product ID':'P1','Current Stock':9};
 assert.deepEqual(norm(c.planPurchaseReturnLotReduction_('PUR-82','P1',9,lots,product).draws.map(x=>x.take)),[9]);
 assert.throws(()=>c.planPurchaseReturnLotReduction_('PUR-82','P1',15,lots,product),/9|reserved/i);
});
test('RED: older lots reserve first across several positive lots',()=>{
 const lots=[positive('L-OLD','PUR-A',12,'2026-10-01'),positive('L-MID','PUR-B',8,'2026-10-10'),
 positive('L-NEW','PUR-C',20,'2026-10-20'),debt(15)];
 const r=norm(harness().planPurchaseLotOwnAvailability_('P1',lots,{'Product ID':'P1','Current Stock':25}));
 assert.deepEqual(r.lots.map(x=>[x.lotId,x.reservedQty,x.freeQty]),[['L-OLD',12,0],['L-MID',3,5],['L-NEW',0,20]]);
});
test('RED: stock cache mismatch is blocked with no writes',()=>{
 const c=harness();assert.throws(()=>c.planPurchaseReturnLotReduction_('PUR-B','P1',1,data(),
 {'Product ID':'P1','Current Stock':31}),/mismatch|Needs Review/i);
});
test('RED: invalid negative lot or deleted positive lot cannot serve purchase return',()=>{
 const c=harness(),bad=data();bad[2]['Purchase ID']='ADJUSTMENT';
 assert.throws(()=>c.planPurchaseReturnLotReduction_('PUR-B','P1',1,bad,
 {'Product ID':'P1','Current Stock':30}),/oversold|Needs Review/i);
 const deleted=data();deleted[0].Status='Deleted';
 assert.throws(()=>c.planPurchaseReturnLotReduction_('PUR-B','P1',1,deleted,
 {'Product ID':'P1','Current Stock':30}),/deleted|Needs Review/i);
});
test('RED: duplicate source lot identity and invalid price fail closed',()=>{
 const c=harness(),dups=data();dups[1]['Lot ID']='L1';
 assert.throws(()=>c.planPurchaseReturnLotReduction_('PUR-B','P1',1,dups,{'Product ID':'P1','Current Stock':30}),/duplicate|Needs Review/i);
 const unpriced=data();unpriced[0]['Purchase Price']='';
 assert.throws(()=>c.planPurchaseReturnLotReduction_('PUR-B','P1',1,unpriced,{'Product ID':'P1','Current Stock':30}),/unpriced|Needs Review/i);
});
test('RED: no historic negative debt preserves existing normal FIFO purchase return',()=>{
 const c=harness(),lots=[positive('L1','PUR-A',3),positive('L2','PUR-A',2)];
 const p=norm(c.planPurchaseReturnLotReduction_('PUR-A','P1',4,lots));
 assert.deepEqual(p.draws.map(d=>d.take),[3,1]);
 assert.deepEqual(lots.map(l=>l['Remaining Quantity']),[3,2]);
});
test('RED: target purchase with several lots only returns sum of its truly free units',()=>{
 const c=harness(),lots=[
 positive('L1','PUR-A',10,'2026-11-02'),positive('L2','PUR-A',15,'2026-11-04'),
 positive('L3','PUR-B',5,'2026-11-10'),debt(17)
 ],prod={'Product ID':'P1','Current Stock':13};
 assert.throws(()=>c.planPurchaseReturnLotReduction_('PUR-A','P1',9,lots,prod),/8|reserved/i);
 assert.deepEqual(norm(c.planPurchaseReturnLotReduction_('PUR-A','P1',8,lots,prod).draws.map(d=>d.take)),[8]);
});
