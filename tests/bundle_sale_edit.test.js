'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const code=fs.readFileSync(path.join(__dirname,'..','Bundles.gs'),'utf8');
const pipe={'Product ID':'pipe','Product Name':'Pipe',Status:'Active',Unit:'pcs','Current Stock':60,'Purchase Price':100,_rowIndex:2};
const motor={'Product ID':'motor','Product Name':'Motor',Status:'Active',Unit:'pcs','Current Stock':6,'Purchase Price':3000,_rowIndex:3};
const kit={'Product ID':'kit','Product Name':'Tubewell Set',Status:'Active','Product Type':'Bundle','Bundle Revision':2,'Selling Price':15000,_rowIndex:4};
const products={pipe,motor,kit};
const historic=[['pipe',5],['motor',1]].map(([id,qty],idx)=>({'Invoice ID':'INV','Bundle Product ID':'kit','Bundle Revision':1,'Component Product ID':id,'Quantity Per Set':qty,'Sets Sold':2,'Component Quantity Sold':qty*2,'Unit':'pcs',_rowIndex:10+idx}));
const latest=[['pipe',8],['motor',1]].map(([id,qty])=>({'Bundle Product ID':'kit','Component Product ID':id,'Quantity Per Set':qty,'Revision':2,'Unit':'pcs','Status':'Active'}));
const old=[{'Product ID':'kit','Sold Product Type':'Bundle','Quantity':2}];
const originalEvidence=[['pipe',10],['motor',2]].map(([id,qty],idx)=>({'Invoice ID':'INV','Product ID':id,'Source Sale Product ID':'kit','Quantity':qty,_rowIndex:20+idx}));
function setup(){
  const fifo=[],restores=[];
  const ctx=vm.createContext({
    planStockConsumption_:(id,qty)=>{fifo.push([id,qty]);return {productId:id,draws:[],shortfall:qty};},
    planSaleReturnRestoration_:(inv,id,name,qty,options)=>{restores.push([id,qty,options.sourceSaleProductId]);return {productId:id,draws:[{sourceKind:'LOT',qty}]};},
    getAllRows_:()=>[],Number,JSON,Math
  });
  vm.runInContext(code,ctx);
  return {ctx,fifo,restores};
}
test('existing bundle grows using historic component ratio, not edited recipe',()=>{
  const {ctx,fifo}=setup();
  const plan=ctx.planBundleInvoiceEdit_({
    invoiceId:'INV',oldItems:old,newItems:[{productId:'kit',qty:3,bundleRevision:1}],
    snapshotRows:historic,productsById:products,definitionRows:latest,consumptionRows:originalEvidence,
    stockLots:[],allLots:[]
  });
  assert.deepEqual(fifo.sort(),[['motor',1],['pipe',5]]);
  assert.equal(plan.changes.length,2);
  assert.equal(plan.snapshots[0].newQty,3);
  assert.equal(plan.snapshots[0].revision,1);
});
test('decrease one set restores original parent component lots',()=>{
  const {ctx,restores}=setup();
  const plan=ctx.planBundleInvoiceEdit_({
    invoiceId:'INV',oldItems:old,newItems:[{productId:'kit',qty:1}],
    snapshotRows:historic,productsById:products,definitionRows:latest,consumptionRows:originalEvidence,stockLots:[],allLots:[]
  });
  assert.deepEqual(restores.sort(),[['motor',1,'kit'],['pipe',5,'kit']]);
  assert.equal(plan.snapshots[0].newQty,1);
  assert.ok(plan.changes.every(c=>c.delta<0));
});
test('price-only edit does not alter physical stock or snapshots',()=>{
  const {ctx,fifo,restores}=setup();
  const plan=ctx.planBundleInvoiceEdit_({
    invoiceId:'INV',oldItems:old,newItems:[{productId:'kit',qty:2,unitPrice:14500}],
    snapshotRows:historic,productsById:products,definitionRows:latest,consumptionRows:originalEvidence,stockLots:[],allLots:[]
  });
  assert.equal(plan.changes.length,0);
  assert.equal(plan.snapshots.length,0);
  assert.equal(fifo.length+restores.length,0);
});
test('new bundle in old invoice requires current revision',()=>{
  const {ctx,fifo}=setup();
  const fresh=ctx.planBundleInvoiceEdit_({
    invoiceId:'INV',oldItems:[],newItems:[{productId:'kit',qty:2,bundleRevision:2}],
    snapshotRows:[],productsById:products,definitionRows:latest,consumptionRows:[],stockLots:[],allLots:[]
  });
  assert.deepEqual(fifo.sort(),[['motor',2],['pipe',16]]);
  assert.equal(fresh.snapshots[0].revision,2);
  assert.throws(()=>ctx.planBundleInvoiceEdit_({
    invoiceId:'INV',oldItems:[],newItems:[{productId:'kit',qty:1,bundleRevision:1}],
    snapshotRows:[],productsById:products,definitionRows:latest,consumptionRows:[],stockLots:[],allLots:[]
  }),/refresh/i);
});
test('set edit removes entire parent and does not allow fractional set quantities',()=>{
 const {ctx}=setup();
 const gone=ctx.planBundleInvoiceEdit_({
    invoiceId:'INV',oldItems:old,newItems:[],snapshotRows:historic,
    productsById:products,definitionRows:latest,consumptionRows:originalEvidence,stockLots:[],allLots:[]
 });
 assert.equal(gone.snapshots[0].newQty,0);
 assert.throws(()=>ctx.planBundleInvoiceEdit_({
    invoiceId:'INV',oldItems:old,newItems:[{productId:'kit',qty:1.5}],snapshotRows:historic,
    productsById:products,definitionRows:latest,consumptionRows:originalEvidence,stockLots:[],allLots:[]
 }),/whole sets/i);
});
test('invoice presentation exposes only parent item, never physical component as billed row',()=>{
 const src=fs.readFileSync(path.join(__dirname,'..','Invoice.gs'),'utf8');
 assert.match(src,/items: items\.map\(function \(i\)/);
 assert.doesNotMatch(src,/SALE_BUNDLE_COMPONENTS/);
});
