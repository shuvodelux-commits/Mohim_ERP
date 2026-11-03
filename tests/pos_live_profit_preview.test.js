'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function sourceOf(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' must exist');
  let depth = 0, quoted = '', escaped = false, lineComment = false, blockComment = false;
  let begin = src.indexOf('{',start);
  for(let i=begin;i<src.length;i++){
    const ch=src[i],next=src[i+1];
    if(lineComment){if(ch==='\n')lineComment=false;continue;}
    if(blockComment){if(ch==='*'&&next==='/'){blockComment=false;i++;}continue;}
    if(quoted){if(escaped){escaped=false;continue;}if(ch==='\\'){escaped=true;continue;}if(ch===quoted)quoted='';continue;}
    if(ch==='/'&&next==='/'){lineComment=true;i++;continue;}
    if(ch==='/'&&next==='*'){blockComment=true;i++;continue;}
    if(ch==='"'||ch==="'"||ch==='`'){quoted=ch;continue;}
    if(ch==='{')depth++;
    if(ch==='}'&&!--depth)return src.slice(start,i+1);
  }
  throw new Error('Unterminated function ' + name);
}
function fixture() {
  const c = vm.createContext({
    roundMoney_: n => Math.round(Number(n)*100)/100,
    isValidNonNegativeNumber_: n => n !== null && n !== '' && Number.isFinite(Number(n)) && Number(n)>=0,
    compareLotsFifo_: (a,b)=> String(a['Lot ID']).localeCompare(String(b['Lot ID'])),
    lotSellPrice_: (lot,p)=> Number(lot && lot['Sell Price']!==undefined ? lot['Sell Price'] : p['Selling Price'])||0,
    bundleProductType_: p => p && p['Product Type']==='Bundle'?'Bundle':'Standard'
  });
  for(const n of ['planStockConsumption_','planSaleVendorConsumption_'])vm.runInContext(sourceOf(read('StockLots.gs'),n),c);
  vm.runInContext(sourceOf(read('Bundles.gs'),'buildSaleStockDemands_'),c);
  vm.runInContext(sourceOf(read('StockLots.gs'),'computePlanSellingPrice_'),c);
  vm.runInContext(sourceOf(read('Sales.gs'),'estimatePosInvoiceProfit_'),c);
  return c;
}
function standard(id,price,stock,unitCost) {
 return {'Product ID':id,'Product Name':id,'Product Type':'Standard','Purchase Price':unitCost,
         'Selling Price':price,'Current Stock':stock};
}
function item(productId,qty,unitPrice,other={}) {return {productId,name:productId,qty,unitPrice,priceMode:'manual',...other};}
function lot(productId,lotId,qty,unitCost,sellPrice) {
 return {'Product ID':productId,'Lot ID':lotId,'Remaining Quantity':qty,'Purchase Price':unitCost,
         'Sell Price':sellPrice,'Purchase Date':'2026-01-01','Status':'Active'};
}

test('live POS profit uses FIFO lot cost and subtracts the current invoice discount',()=>{
  const c=fixture(),products={P:standard('P',20,2,15)};
  const result=c.estimatePosInvoiceProfit_(
    {items:[item('P',2,20)],discount:5},products,
    [lot('P','L1',1,8,20),lot('P','L2',1,12,20)],{});
  assert.equal(result.subtotal,40);
  assert.equal(result.discount,5);
  assert.equal(result.grandTotal,35);
  assert.equal(result.cogs,20);
  assert.equal(result.profit,15);
});

test('live POS profit accounts for vendor-sourced shortages rather than stock fallback cost',()=>{
  const c=fixture(),products={P:standard('P',20,1,9)};
  const result=c.estimatePosInvoiceProfit_(
    {items:[item('P',3,20,{vendorId:'V',vendorUnitCost:12})],discount:0},
    products,[lot('P','L1',1,10,20)],{});
  assert.equal(result.cogs,34);
  assert.equal(result.profit,26);
});

test('live POS profit plans bundle and standalone shared components once',()=>{
  const c=fixture();
  const products={P:standard('P',20,3,15),B:{'Product ID':'B','Product Name':'B',
    'Product Type':'Bundle','Bundle Revision':1,'Selling Price':50,'Current Stock':0}};
  const definitions={B:{revision:1,components:[{productId:'P',qtyPerSet:2}]}};
  const result=c.estimatePosInvoiceProfit_(
    {items:[item('B',1,50,{bundleRevision:1}),item('P',1,20)],discount:5},
    products,[lot('P','L1',1,5,20),lot('P','L2',1,7,20),lot('P','L3',1,11,20)],definitions);
  assert.equal(result.grandTotal,65);
  assert.equal(result.cogs,23);
  assert.equal(result.profit,42);
});

test('POS profit endpoint refuses data to unauthorized users even if UI is manipulated',()=>{
  const c=vm.createContext({
    requirePermission_: () => ({'Role':'Staff'}),
    canViewInvoiceProfit_: () => false,
    fail_: m => ({success:false,message:m}),
    ok_: v => ({success:true,data:v}),
    logError_:()=>{},
    sanitizeInput_:v=>String(v||'')
  });
  vm.runInContext(sourceOf(read('Sales.gs'),'previewPosInvoiceProfit'),c);
  const out=c.previewPosInvoiceProfit('staff',{items:[item('P',1,100)],discount:0});
  assert.equal(out.success,false);
  assert.match(out.message,/permission|not authorized|profit/i);
});

test('POS live profit indicator is hidden unless an authorized preview is returned',()=>{
  const pos=read('pos.html'),sales=read('Sales.gs');
  assert.match(pos,/id="posCurrentInvoiceProfitRow"[^>]*hidden/);
  assert.match(pos,/previewPosInvoiceProfit/);
  assert.match(pos,/posProfitRequestSequence_/);
  assert.match(sales,/canViewCurrentInvoiceProfit/);
});
