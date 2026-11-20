'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','FundedReturnJournal.gs'),'utf8');
const deep=x=>structuredClone(x);
function check(snapshot){
 const c={console,Number,Math,BigInt,Object,Date,JSON};vm.createContext(c);
 vm.runInContext(source,c);
 return c.verifyFundedReturnReceipt_(snapshot);
}
function sample(method='Cash') {
 const returnId='SRT-20',operationId='FUNDED-RETURN-20261120-0001';
 const rev={settlementId:'STL-1',purchaseLotId:'LOT-NEW',
   oversoldLotId:'OV-1',productId:'P1',sourceInvoiceId:'INV-1',
   sourceSaleProductId:'P1',quantityTicks:5000000,quantityScale:1000000,
   provisionalUnitCostMinor:6800,actualUnitCostMinor:6475,
   provisionalReturnedCostMinor:34000,actualReturnedCostMinor:32375,
   cogsDeltaReversalMinor:1625};
 const expected={returnId,operationId,invoiceId:'INV-1',productId:'P1',actor:'U1',
   sourceSaleProductId:'P1',oldDebtLotId:'OV-1',saleItemLotAfterTicks:224000000,
   returnQtyTicks:5000000,quantityScale:1000000,stockAfterTicks:14000000,
   refundMethod:method,refundMinor:50000,customerId:'CUS-1',
   customerDueAfterMinor:-50000,
   debtUpdates:[],purchaseLotUpdates:[{lotId:'LOT-NEW',beforeTicks:9000000,afterTicks:14000000}],
   reversalEvents:[rev]};
 const snapshot={
  expected,
  returns:[{'Return ID':returnId,'Return Operation ID':operationId,
   'Invoice ID':'INV-1','Customer ID':'CUS-1','Refund Method':method,'Total Return Amount':500}],
  returnItems:[{'Return ID':returnId,'Invoice ID':'INV-1','Product ID':'P1','Return Quantity':5,
   'Return Price':100,'Line Total':500}],
  products:[{'Product ID':'P1','Current Stock':14}],
  saleItemLots:[{'Invoice ID':'INV-1','Product ID':'P1','Source Sale Product ID':'P1',
   'Lot ID':'OV-1',Quantity:224,'Unit Cost':68}],
  stockLots:[{'Lot ID':'OV-1','Product ID':'P1','Purchase ID':'OVERSOLD',
    'Remaining Quantity':0,'Purchase Price':68,Status:'Consumed'},
   {'Lot ID':'LOT-NEW','Product ID':'P1','Purchase ID':'PUR-1',
    'Original Quantity':240,'Remaining Quantity':14,'Purchase Price':64.75,Status:'Active'}],
  originalSettlements:[{'Settlement ID':'STL-1','Product ID':'P1','Oversold Lot ID':'OV-1',
   'Source Invoice ID':'INV-1','Source Sale Product ID':'P1','Purchase Lot ID':'LOT-NEW',
   'Quantity Ticks':229000000,'Quantity Scale':1000000,
   'Provisional Unit Cost Minor':6800,'Actual Unit Cost Minor':6475,
   State:'Committed'}],
  reversals:[{'Reversal ID':'REV-1','Return Operation ID':operationId,'Return ID':returnId,
   'Settlement ID':'STL-1','Source Invoice ID':'INV-1','Source Sale Product ID':'P1',
   'Product ID':'P1','Oversold Lot ID':'OV-1','Purchase Lot ID':'LOT-NEW',
   'Quantity Ticks':5000000,'Quantity Scale':1000000,
   'Provisional Unit Cost Minor':6800,'Actual Unit Cost Minor':6475,
   'Provisional Returned Cost Minor':34000,'Actual Returned Cost Minor':32375,
   'Cogs Delta Reversal Minor':1625,State:'Committed'}],
  movements:[{Reference:returnId,Type:'Sales Return','Product ID':'P1',
   'Quantity In':5,'Quantity Out':'','Lot ID':'LOT-NEW','Balance Stock':14}],
  cashRows:[{Reference:returnId,Type:'Sales Return',Debit:500,Credit:''}],
  customers:[{'Customer ID':'CUS-1','Current Due':-500}],
  customerLedger:[],
 };
 if(method==='Store Credit'){
  snapshot.cashRows=[];
  snapshot.customerLedger=[{Reference:returnId,Type:'Sales Return Credit','Customer ID':'CUS-1',
   Credit:500,Debit:'',Balance:-500}];
 }
 return snapshot;
}
test('full source-linked funded return receipt reconciles all stock and Cash evidence',()=>{
 assert.equal(check(sample()),true);
});
test('Store Credit return is verified with customer due, ledger, and no Cash refund',()=>{
 assert.equal(check(sample('Store Credit')),true);
});
test('missing or duplicated sales return header/item and mismatched identity all fail',()=>{
 const a=sample();a.returns=[];assert.equal(check(a),false);
 const b=sample();b.returns.push(deep(b.returns[0]));assert.equal(check(b),false);
 const c=sample();c.returnItems=[];assert.equal(check(c),false);
 const d=sample();d.returnItems[0]['Return Quantity']=4;assert.equal(check(d),false);
 const e=sample();e.returns[0]['Return Operation ID']='wrong';assert.equal(check(e),false);
});
test('purchased lot/oversold debt, original sale cost and product stock must reconcile',()=>{
 const a=sample();a.products[0]['Current Stock']=13;assert.equal(check(a),false);
 const b=sample();b.stockLots[1]['Remaining Quantity']=15;assert.equal(check(b),false);
 const c=sample();c.saleItemLots[0].Quantity=223;assert.equal(check(c),false);
 const d=sample();d.saleItemLots[0]['Unit Cost']=67;assert.equal(check(d),false);
 const e=sample();e.stockLots[0]['Remaining Quantity']=-1;assert.equal(check(e),false);
 const f=sample();f.stockLots.push(deep(f.stockLots[1]));assert.equal(check(f),false);
});
test('immutable reversal must match source settlement, cents and unique event identity',()=>{
 const a=sample();a.reversals=[];assert.equal(check(a),false);
 const b=sample();b.reversals.push(deep(b.reversals[0]));assert.equal(check(b),false);
 const c=sample();c.reversals[0]['Settlement ID']='STL-OTHER';assert.equal(check(c),false);
 const d=sample();d.reversals[0]['Actual Returned Cost Minor']+=1;assert.equal(check(d),false);
 const e=sample();e.originalSettlements[0].State='Writing';assert.equal(check(e),false);
 const f=sample();f.reversals[0].State='Writing';assert.equal(check(f),false);
});
test('original source cost reversal cannot be faked from a different purchase lot',()=>{
 const a=sample();a.reversals[0]['Purchase Lot ID']='LOT-OTHER';assert.equal(check(a),false);
 const b=sample();b.stockLots[1]['Purchase Price']=66;assert.equal(check(b),false);
 const c=sample();c.originalSettlements[0]['Actual Unit Cost Minor']=6600;assert.equal(check(c),false);
});
test('return stock movement must be present once, from exact source lot and total',()=>{
 const a=sample();a.movements=[];assert.equal(check(a),false);
 const b=sample();b.movements.push(deep(b.movements[0]));assert.equal(check(b),false);
 const c=sample();c.movements[0]['Quantity In']=4;assert.equal(check(c),false);
 const d=sample();d.movements[0]['Lot ID']='LOT-OTHER';assert.equal(check(d),false);
});
test('Cash refund and Store Credit cannot both be recorded or the wrong amount paid',()=>{
 const a=sample();a.cashRows[0].Debit=501;assert.equal(check(a),false);
 const b=sample();b.cashRows.push(deep(b.cashRows[0]));assert.equal(check(b),false);
 const c=sample('Store Credit');c.cashRows=sample().cashRows;assert.equal(check(c),false);
 const d=sample('Store Credit');d.customerLedger[0].Credit=501;assert.equal(check(d),false);
 const e=sample();e.customerLedger=sample('Store Credit').customerLedger;assert.equal(check(e),false);
});
test('a mismatch in expected refund amount, source invoice, customer or cost precision fails closed',()=>{
 const a=sample();a.expected.refundMinor=50001;assert.equal(check(a),false);
 const b=sample();b.returns[0]['Invoice ID']='INV-OTHER';assert.equal(check(b),false);
 const c=sample();c.returns[0]['Customer ID']='CUS-OTHER';assert.equal(check(c),false);
 const d=sample();d.saleItemLots[0]['Unit Cost']=68.001;assert.equal(check(d),false);
});

test('source movements must equal exact difference from recorded before/after lot ticks',()=>{
 const a=sample();a.expected.purchaseLotUpdates[0].beforeTicks=9000000;assert.equal(check(a),true);
 a.expected.purchaseLotUpdates[0].beforeTicks=10000000;assert.equal(check(a),false);
});
test('Store Credit customer due and ledger balance signs must match the original expected balance',()=>{
 const a=sample('Store Credit');a.customerLedger[0].Balance=500;assert.equal(check(a),false);
 const b=sample('Store Credit');b.customers[0]['Current Due']=500;assert.equal(check(b),false);
});
test('duplicate globally referenced reversal ID fails even if the second belongs to another return',()=>{
 const a=sample();a.reversals.push({...a.reversals[0], 'Return ID':'SRT-OTHER'});
 assert.equal(check(a),false);
});
test('duplicate original sale-item-lot identity cannot be accepted after source mutation',()=>{
 const a=sample();a.saleItemLots.push(deep(a.saleItemLots[0]));
 assert.equal(check(a),false);
});
