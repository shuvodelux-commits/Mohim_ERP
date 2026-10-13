'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('bundle invoice gross profit is bundle revenue less actual physical component cost and cost coverage is complete',()=>{
 const lots=[['pipe',5,100],['elbow',10,20],['motor',1,3000]].map(([id,qty,cost])=>({'Invoice ID':'INV','Product ID':id,'Quantity':qty,'Unit Cost':cost,'Source Sale Product ID':'kit'}));
 const snapshot=[['pipe',5],['elbow',10],['motor',1]].map(([id,q])=>({'Invoice ID':'INV','Bundle Product ID':'kit','Component Product ID':id,'Quantity Per Set':q,'Sets Sold':1}));
 const ctx=vm.createContext({
   getAllRows_:k=>k==='SALE_ITEM_LOTS'?lots:k==='SALE_BUNDLE_COMPONENTS'?snapshot:[],
   activeRows_:()=>[],roundMoney_:v=>Math.round((v+Number.EPSILON)*100)/100,
   economicReturnLineAmount_:r=>Number(r['Line Total'])||0
 });
 vm.runInContext(read('SalesManagement.gs'),ctx);
 const sales=[{'Invoice ID':'INV','Grand Total':15000}];
 const items=[{'Invoice ID':'INV','Product ID':'kit','Quantity':1}];
 const metric=ctx.buildSalesInvoiceProfitMetrics_(sales,items,[],{});
 assert.equal(metric.INV.costComplete,true);
 assert.equal(metric.INV.profit,11300);
});
test('report assigns physical component cost to parent bundle display item',()=>{
 const r=read('Reports.gs');
 assert.match(r,/bucket_\(l\['Source Sale Product ID'\] \|\| l\['Product ID'\]/);
 assert.match(r,/SALE_BUNDLE_COMPONENTS/);
});
