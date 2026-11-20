'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','PurchaseSettlementJournal.gs'),'utf8');
function verify(data) {
 const ctx={console,Date,JSON,Number,Math,Object};
 vm.createContext(ctx);vm.runInContext(source,ctx);
 return ctx.verifyPurchaseSettlementReceipt_(data);
}
const clone=x=>structuredClone(x);
function fixture(){
 const purchaseId='PUR-082',supplierId='SUP-1';
 const allocations=[
 {productId:'P1',oversoldLotId:'NEG-1',sourceInvoiceId:'INV-1',sourceSaleProductId:'P1',purchaseLotId:'LOT-NEW-1',
 settledQtyTicks:229,quantityScale:1,provisionalUnitCostMinor:6800,actualUnitCostMinor:6475,provisionalCOGSMinor:1557200,actualCOGSMinor:1482775,favorableVarianceMinor:74425},
 {productId:'P1',oversoldLotId:'NEG-2',sourceInvoiceId:'INV-2',sourceSaleProductId:'P1',purchaseLotId:'LOT-NEW-1',
 settledQtyTicks:2,quantityScale:1,provisionalUnitCostMinor:6800,actualUnitCostMinor:6475,provisionalCOGSMinor:13600,actualCOGSMinor:12950,favorableVarianceMinor:650}
 ];
 const lines=[
 {productId:'P1',productName:'Pipe',quantityTicks:240,quantityScale:1,unitCostMinor:6475,sellPriceMinor:7000,
  lotId:'LOT-NEW-1',availableQtyTicks:9,stockAfterTicks:9},
 {productId:'P2',productName:'Tape',quantityTicks:5,quantityScale:1,unitCostMinor:2500,sellPriceMinor:3000,
  lotId:'LOT-NEW-2',availableQtyTicks:5,stockAfterTicks:5}
 ];
 return {
   expected:{purchaseId,operationId:'OP-RESTOCK-20261120-001',date:'2026-11-20',
    supplierId,actor:'USR-1',subtotalMinor:1566500,discountMinor:0,grandTotalMinor:1566500,
    paidMinor:50000,dueMinor:1516500,method:'Cash',bankAccountId:'',
    supplierDueAfterMinor:1616500,lines,allocations,
    oldDebtUpdates:[{lotId:'NEG-1',afterTicks:0},{lotId:'NEG-2',afterTicks:0}]},
   purchases:[{'Purchase ID':purchaseId,Date:'2026-11-20','Supplier ID':supplierId,
    Subtotal:15665,Discount:0,'Grand Total':15665,'Paid Amount':500,'Due Amount':15165}],
   purchaseItems:[
    {'Purchase ID':purchaseId,'Product ID':'P1',Quantity:240,'Unit Price':64.75,'Sell Price':70,'Line Total':15540},
    {'Purchase ID':purchaseId,'Product ID':'P2',Quantity:5,'Unit Price':25,'Sell Price':30,'Line Total':125}
   ],
   products:[{'Product ID':'P1','Current Stock':9},{'Product ID':'P2','Current Stock':5}],
   stockLots:[
    {'Lot ID':'LOT-NEW-1','Product ID':'P1','Purchase ID':purchaseId,
      'Original Quantity':240,'Remaining Quantity':9,'Purchase Price':64.75,Status:'Active'},
    {'Lot ID':'LOT-NEW-2','Product ID':'P2','Purchase ID':purchaseId,
      'Original Quantity':5,'Remaining Quantity':5,'Purchase Price':25,Status:'Active'},
    {'Lot ID':'NEG-1','Product ID':'P1','Purchase ID':'OVERSOLD','Remaining Quantity':0,Status:'Consumed'},
    {'Lot ID':'NEG-2','Product ID':'P1','Purchase ID':'OVERSOLD','Remaining Quantity':0,Status:'Consumed'}],
   movements:[
    {Reference:purchaseId,Type:'Purchase','Product ID':'P1','Lot ID':'LOT-NEW-1','Quantity In':240,'Quantity Out':'','Balance Stock':9},
    {Reference:purchaseId,Type:'Purchase','Product ID':'P2','Lot ID':'LOT-NEW-2','Quantity In':5,'Quantity Out':'','Balance Stock':5}
   ],
   settlements:allocations.map((a,i)=>({
    'Settlement ID':'STL-'+(i+1),'Operation ID':'OP-RESTOCK-20261120-001','Product ID':'P1',
    'Purchase ID':purchaseId,'Purchase Lot ID':'LOT-NEW-1','Oversold Lot ID':a.oversoldLotId,
    'Source Invoice ID':a.sourceInvoiceId,'Source Sale Product ID':'P1',
    'Quantity Ticks':a.settledQtyTicks,'Quantity Scale':1,
    'Provisional Unit Cost Minor':a.provisionalUnitCostMinor,
    'Actual Unit Cost Minor':a.actualUnitCostMinor,
    'Provisional COGS Minor':a.provisionalCOGSMinor,'Actual COGS Minor':a.actualCOGSMinor,
    'Favorable Variance Minor':a.favorableVarianceMinor,State:'Committed'
   })),
   cashRows:[{Reference:purchaseId,Type:'Purchase Payment',Debit:500,Credit:''}],
   bankRows:[],
   suppliers:[{'Supplier ID':supplierId,'Current Due':16165}],
   supplierLedger:[{Reference:purchaseId,Type:'Purchase',Debit:15165,Credit:'','Supplier ID':supplierId}]
 };
}
test('verifies exact purchased lines, owned stock, old debt, immutable settlement and supplier cash evidence',()=>{
 assert.equal(verify(fixture()),true);
});
test('missing or duplicate purchase header or item is not a valid receipt',()=>{
 const a=fixture();a.purchases=[];assert.equal(verify(a),false);
 const b=fixture();b.purchases.push(clone(b.purchases[0]));assert.equal(verify(b),false);
 const c=fixture();c.purchaseItems.pop();assert.equal(verify(c),false);
 const d=fixture();d.purchaseItems.push(clone(d.purchaseItems[0]));assert.equal(verify(d),false);
});
test('stock purchase quantity, remaining amount, positive lot identity and old debt must match exactly',()=>{
 const a=fixture();a.products[0]['Current Stock']=10;assert.equal(verify(a),false);
 const b=fixture();b.stockLots[0]['Remaining Quantity']=10;assert.equal(verify(b),false);
 const c=fixture();c.stockLots[2]['Remaining Quantity']=-1;assert.equal(verify(c),false);
 const e=fixture();e.stockLots[0]['Purchase Price']=65;assert.equal(verify(e),false);
});
test('missing, duplicate or mismatched immutable settlement event invalidates receipt',()=>{
 const a=fixture();a.settlements.pop();assert.equal(verify(a),false);
 const b=fixture();b.settlements.push(clone(b.settlements[0]));assert.equal(verify(b),false);
 const c=fixture();c.settlements[0]['Source Invoice ID']='INV-OTHER';assert.equal(verify(c),false);
 const d=fixture();d.settlements[0]['Favorable Variance Minor']+=1;assert.equal(verify(d),false);
 const e=fixture();e.settlements[1].State='Writing';assert.equal(verify(e),false);
});
test('missing or duplicate stock movement cannot count as committed purchase',()=>{
 const a=fixture();a.movements.pop();assert.equal(verify(a),false);
 const b=fixture();b.movements.push(clone(b.movements[0]));assert.equal(verify(b),false);
 const c=fixture();c.movements[0]['Quantity In']=239;assert.equal(verify(c),false);
});
test('supplier due and payment cannot be committed twice or silently mismatched',()=>{
 const a=fixture();a.suppliers[0]['Current Due']=16164;assert.equal(verify(a),false);
 const b=fixture();b.supplierLedger.push(clone(b.supplierLedger[0]));assert.equal(verify(b),false);
 const c=fixture();c.cashRows.push(clone(c.cashRows[0]));assert.equal(verify(c),false);
 const d=fixture();d.cashRows[0].Debit=499;assert.equal(verify(d),false);
 const e=fixture();e.bankRows.push({Reference:'PUR-082',Type:'Purchase Payment',Debit:500});assert.equal(verify(e),false);
});
test('bank purchases must have a bank row, not a cash payment',()=>{
 const a=fixture();a.expected.method='Bank';a.expected.bankAccountId='BANK-1';
 a.cashRows=[];a.bankRows=[{Reference:'PUR-082',Type:'Purchase Payment',Debit:500,'Bank Account ID':'BANK-1'}];
 assert.equal(verify(a),true);
 const b=clone(a);b.bankRows[0]['Bank Account ID']='BANK-2';assert.equal(verify(b),false);
});
test('zero-paid purchase has no payment row and exactly one supplier due entry',()=>{
 const x=fixture();x.expected.paidMinor=0;x.expected.dueMinor=1566500;
 x.expected.supplierDueAfterMinor=1666500;
 x.purchases[0]['Paid Amount']=0;x.purchases[0]['Due Amount']=15665;
 x.cashRows=[];x.supplierLedger[0].Debit=15665;x.suppliers[0]['Current Due']=16665;
 assert.equal(verify(x),true);
 x.cashRows=[{Reference:'PUR-082',Type:'Purchase Payment',Debit:100}];
 assert.equal(verify(x),false);
});
test('purchase receipt mismatched finance amounts, reference IDs and cost precision all fail',()=>{
 const a=fixture();a.purchases[0]['Grand Total']=15664;assert.equal(verify(a),false);
 const b=fixture();b.purchaseItems[0]['Line Total']=15539;assert.equal(verify(b),false);
 const c=fixture();c.stockLots[0]['Purchase ID']='OTHER';assert.equal(verify(c),false);
 const d=fixture();d.movements[0].Reference='OTHER';assert.equal(verify(d),false);
 const e=fixture();e.purchaseItems[0]['Unit Price']=64.755;assert.equal(verify(e),false);
});

test('funded quantity plus new lot free quantity must equal exactly purchased quantity',()=>{
 const x=fixture();
 x.expected.allocations[0].settledQtyTicks=228;
 x.settlements[0]['Quantity Ticks']=228;
 assert.equal(verify(x),false);
});
test('favorable cost variance must equal recorded provisional minus actual COGS',()=>{
 const x=fixture();
 x.expected.allocations[0].favorableVarianceMinor=74424;
 x.settlements[0]['Favorable Variance Minor']=74424;
 assert.equal(verify(x),false);
});
test('settlement source must point to correct purchased lot for its own product',()=>{
 const x=fixture();x.expected.allocations[0].purchaseLotId='LOT-NEW-2';
 x.settlements[0]['Purchase Lot ID']='LOT-NEW-2';
 assert.equal(verify(x),false);
});
