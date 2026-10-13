'use strict';
const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function workbook(motorStock = 8) {
  let serial = 0;
  const errors = [];
  const product = (id, stock, cost, sell, type) => ({
    'Product ID': id, 'Product Name': id, 'Product Type': type || 'Standard',
    'Current Stock': stock, 'Purchase Price': cost, 'Selling Price': sell,
    Status: 'Active'
  });
  const products = [
    product('pipe',100,100,120),
    product('elbow',80,15,30),
    product('motor',motorStock,3000,3500),
    product('kit',0,0,15000,'Bundle')
  ];
  products[3]['Bundle Revision'] = 1;
  products.forEach((p,i)=>p._rowIndex=i+2);
  const rows = {
    PRODUCTS: products,
    BUNDLE_COMPONENTS: [['pipe',5],['elbow',10],['motor',1]].map(([id,qty])=>({
      'Bundle Product ID':'kit','Component Product ID':id,
      'Quantity Per Set':qty,Revision:1,Status:'Active',Unit:'pcs'
    })),
    STOCK_LOTS: products.slice(0,3).filter(p=>p['Current Stock']>0).map((p,i)=>({
      'Lot ID':'LOT-'+p['Product ID'],'Product ID':p['Product ID'],
      'Purchase ID':'OPENING','Purchase Date':'2026-10-01',
      'Remaining Quantity':p['Current Stock'],'Original Quantity':p['Current Stock'],
      'Purchase Price':p['Purchase Price'],'Sell Price':p['Selling Price'],_rowIndex:i+2
    })),
    SALES:[], SALE_ITEMS:[], SALE_ITEM_LOTS:[], SALE_BUNDLE_COMPONENTS:[],
    STOCK_MOVEMENT:[], SALES_RETURN:[], SALES_RETURN_ITEMS:[],
    VENDORS:[], CASH_BOOK:[]
  };
  const row = (key,value) => {
    const table = rows[key] || (rows[key]=[]);
    table.push({...value,_rowIndex:table.length+2});
  };
  const roundMoney_ = n => Math.round((Number(n)+Number.EPSILON)*100)/100;
  const ctx = vm.createContext({
    console, Date, Math, JSON,
    CONFIG: {LOCK_TIMEOUT_MS:1000},
    LockService: {getScriptLock:()=>({waitLock(){},releaseLock(){}})},
    requirePermission_:()=>({'User ID':'tester'}),
    requireActiveCashSession_:()=>true,
    sanitizeInput_:n=>String(n??'').trim(),
    isValidNonNegativeNumber_:n=>n!==''&&n!==null&&n!==undefined&&Number.isFinite(Number(n))&&Number(n)>=0,
    activeRows_:key=>rows[key]||[],getAllRows_:key=>rows[key]||[],
    appendRow_:row,appendRows_:(key,items)=>items.forEach(item=>row(key,item)),
    updateRowFields_:(key,index,fields)=>{
      const current=(rows[key]||[]).find(r=>r._rowIndex===index);
      if(!current)throw Error('Missing '+key+' row '+index);
      Object.assign(current,fields);
    },
    generateId_:key=>key+'-'+(++serial),
    roundMoney_,
    resolveBankAccount_:()=>({id:'',name:''}),
    resolveTransactionDate_:()=>({dateStr:'2026-10-13',isBackdated:false,backdatedDays:0,reason:''}),
    actorName_:()=> 'Cashier',
    Utilities:{formatDate:()=>'12:30:00'},
    Session:{getScriptTimeZone:()=>'Asia/Dhaka'},
    addCashBookEntry_:entry=>row('CASH_BOOK',entry),
    isBankLikePaymentMethod_:()=>false,
    addBankBookEntry_:()=>{throw Error('Unexpected bank operation');},
    buildInvoicePayload_:invoiceId=>({invoiceId}),
    ok_:data=>({success:true,data}),
    fail_:message=>({success:false,message}),
    logError_:(name,e)=>errors.push(name+': '+e.message),
    isDeleted_:()=>false,
    safeDateOnly_:value=>String(value||'').slice(0,10),
    effectiveTransactionUnitPrice_:n=>n,
    economicReturnLineAmount_:r=>Number(r['Line Total'])||0,
    salesReturnCashRefundAvailable_:()=>30000
  });
  for(const file of ['Bundles.gs','StockLots.gs','Sales.gs','SalesReturn.gs']){
    vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),ctx,{filename:file});
  }
  ctx.createLotWithRow_ = (id,name,source,date,cost,qty,supplierId,supplierName,sellPrice)=>{
    const lotId='OVERSOLD-'+(++serial);
    row('STOCK_LOTS',{'Lot ID':lotId,'Product ID':id,'Product Name':name,
      'Purchase ID':source,'Purchase Date':date,'Purchase Price':cost,
      'Sell Price':sellPrice,'Remaining Quantity':qty,'Original Quantity':qty});
    return {id:lotId,rowIndex:rows.STOCK_LOTS.at(-1)._rowIndex};
  };
  ctx.createLot_ = (id,name,source,date,cost,qty)=>{
    const lotId='RESTORE-'+(++serial);
    row('STOCK_LOTS',{'Lot ID':lotId,'Product ID':id,'Product Name':name,
      'Purchase ID':source,'Purchase Price':cost,'Remaining Quantity':qty});
    return lotId;
  };
  const sell = (items,discount=0) => ctx.completeSale('token',{
    customerName:'Example',customerPhone:'01700000000',items,
    paymentType:'Cash',paymentMethod:'Cash',discount
  });
  const kit = (qty=2,revision=1)=>({
    productId:'kit',name:'Tubewell Set',qty,
    unitPrice:15000,priceMode:'auto',bundleRevision:revision
  });
  const state=()=>Object.fromEntries(rows.PRODUCTS.map(p=>[p['Product ID'],p['Current Stock']]));
  return {ctx,rows,errors,sell,kit,state,roundMoney_};
}

test('two sets post one invoice line and 10 pipe, 20 elbow, 2 motor movements exactly once',()=>{
 const w=workbook(),res=w.sell([w.kit()]);
 assert.equal(res.success,true,res.message);
 assert.equal(w.rows.SALES.length,1);
 assert.equal(w.rows.SALE_ITEMS.length,1);
 assert.equal(w.rows.SALE_ITEMS[0]['Product ID'],'kit');
 assert.equal(w.rows.SALE_ITEMS[0]['Line Total'],30000);
 assert.equal(w.rows.SALE_BUNDLE_COMPONENTS.length,3);
 assert.equal(w.rows.CASH_BOOK.length,1);
 assert.deepEqual(w.state(),{pipe:90,elbow:60,motor:6,kit:0});
 assert.deepEqual(w.rows.SALE_ITEM_LOTS.map(r=>[r['Product ID'],r.Quantity,r['Source Sale Product ID']]),
   [['pipe',10,'kit'],['elbow',20,'kit'],['motor',2,'kit']]);
});

test('bundle sale allows motor stock to go negative through an OVERSOLD lot',()=>{
 const w=workbook(0),res=w.sell([w.kit()]);
 assert.equal(res.success,true,res.message);
 assert.equal(w.state().motor,-2);
 assert.equal(w.rows.STOCK_LOTS.find(l=>l['Purchase ID']==='OVERSOLD')['Remaining Quantity'],-2);
 assert.equal(w.rows.SALE_ITEM_LOTS.find(l=>l['Product ID']==='motor').Quantity,2);
});

test('bundle plus standalone pipe deducts combined physical stock without double-consuming',()=>{
 const w=workbook(),res=w.sell([w.kit(),{productId:'pipe',name:'pipe',qty:3,priceMode:'auto',unitPrice:120}]);
 assert.equal(res.success,true,res.message);
 assert.equal(w.state().pipe,87);
 assert.equal(w.rows.SALE_ITEM_LOTS.filter(l=>l['Product ID']==='pipe').reduce((n,l)=>n+l.Quantity,0),13);
 assert.deepEqual(w.rows.SALE_ITEM_LOTS.filter(l=>l['Product ID']==='pipe').map(l=>l['Source Sale Product ID']),['kit','pipe']);
 assert.equal(w.rows.CASH_BOOK.length,1);
});

test('stale revision rejects sale before any sheet write or payment',()=>{
 const w=workbook(),res=w.sell([w.kit(2,99)]);
 assert.equal(res.success,false);
 assert.match(res.message,/recipe must be refreshed/);
 assert.equal(w.rows.SALES.length,0);
 assert.equal(w.rows.STOCK_MOVEMENT.length,0);
 assert.equal(w.rows.CASH_BOOK.length,0);
 assert.deepEqual(w.state(),{pipe:100,elbow:80,motor:8,kit:0});
});

test('return one of two sets restores original physical lots and only one bundle refund',()=>{
 const w=workbook(),sale=w.sell([w.kit()]);
 assert.equal(sale.success,true,sale.message);
 const invoiceId=sale.data.invoiceId;
 const opts={
   sale:w.rows.SALES[0],saleItems:w.rows.SALE_ITEMS,returnItems:[],
   consumptionRows:w.rows.SALE_ITEM_LOTS,stockLots:w.rows.STOCK_LOTS,
   productsById:Object.fromEntries(w.rows.PRODUCTS.map(p=>[p['Product ID'],p])),
   cashRefundAvailable:30000,
   txDate:{dateStr:'2026-10-14',isBackdated:false,backdatedDays:0,reason:''}
 };
 const prepared=w.ctx.prepareSalesReturn_({
   invoiceId,refundMethod:'Cash',items:[{productId:'kit',name:'Tubewell Set',qty:1,price:15000}]
 },opts);
 assert.equal(prepared.totalReturnAmount,15000);
 w.ctx.commitPreparedSalesReturn_(prepared,{returnId:'RET-1',actingUser:{'User ID':'tester'}});
 assert.deepEqual(w.state(),{pipe:95,elbow:70,motor:7,kit:0});
 assert.equal(w.rows.SALES_RETURN_ITEMS.length,1);
 assert.equal(w.rows.SALES_RETURN_ITEMS[0]['Product ID'],'kit');
 assert.equal(w.rows.SALES_RETURN_ITEMS[0]['Return Quantity'],1);
 assert.equal(w.rows.CASH_BOOK.length,2);
 assert.deepEqual(w.rows.SALE_ITEM_LOTS.map(l=>l.Quantity),[5,10,1]);
});


test('historical bundle return uses sale-time recipe after master recipe changes',()=>{
 const w=workbook(),sale=w.sell([w.kit()]);
 assert.equal(sale.success,true,sale.message);
 // Future sets now contain 99 pipes, but this old invoice contained 5.
 w.rows.BUNDLE_COMPONENTS[0]['Quantity Per Set']=99;
 w.rows.PRODUCTS.find(p=>p['Product ID']==='kit')['Bundle Revision']=2;
 const opts={
   sale:w.rows.SALES[0],saleItems:w.rows.SALE_ITEMS,returnItems:[],
   consumptionRows:w.rows.SALE_ITEM_LOTS,stockLots:w.rows.STOCK_LOTS,
   productsById:Object.fromEntries(w.rows.PRODUCTS.map(p=>[p['Product ID'],p])),
   cashRefundAvailable:30000,
   txDate:{dateStr:'2026-10-14',isBackdated:false,backdatedDays:0,reason:''}
 };
 const prepared=w.ctx.prepareSalesReturn_({invoiceId:sale.data.invoiceId,refundMethod:'Cash',items:[
   {productId:'kit',qty:1,price:15000}
 ]},opts);
 w.ctx.commitPreparedSalesReturn_(prepared,{returnId:'RET-HISTORY',actingUser:{'User ID':'tester'}});
 assert.deepEqual(w.state(),{pipe:95,elbow:70,motor:7,kit:0});
});

test('a bundle return against OVERSOLD component restores negative stock consistently',()=>{
 const w=workbook(0),sale=w.sell([w.kit()]);
 assert.equal(sale.success,true,sale.message);
 const opts={
   sale:w.rows.SALES[0],saleItems:w.rows.SALE_ITEMS,returnItems:[],
   consumptionRows:w.rows.SALE_ITEM_LOTS,stockLots:w.rows.STOCK_LOTS,
   productsById:Object.fromEntries(w.rows.PRODUCTS.map(p=>[p['Product ID'],p])),
   cashRefundAvailable:30000,
   txDate:{dateStr:'2026-10-14',isBackdated:false,backdatedDays:0,reason:''}
 };
 const prepared=w.ctx.prepareSalesReturn_({invoiceId:sale.data.invoiceId,refundMethod:'Cash',items:[
   {productId:'kit',qty:1,price:15000}
 ]},opts);
 w.ctx.commitPreparedSalesReturn_(prepared,{returnId:'RET-NEG',actingUser:{'User ID':'tester'}});
 assert.equal(w.state().motor,-1);
 assert.equal(w.rows.STOCK_LOTS.filter(l=>l['Product ID']==='motor').reduce((n,l)=>n+Number(l['Remaining Quantity']||0),0),-1);
 assert.equal(w.rows.SALE_ITEM_LOTS.find(l=>l['Product ID']==='motor').Quantity,1);
});
