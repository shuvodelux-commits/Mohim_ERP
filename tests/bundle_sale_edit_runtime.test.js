'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const scripts=['Bundles.gs','StockLots.gs','SalesManagement.gs','SalesReturn.gs','Invoice.gs']
  .map(file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8')).join('\n');

function workbook(withStandalone) {
  const standard = withStandalone ? 1 : 0;
  const products = [
    ['pipe','Pipe',90-standard,100,120,'Standard'],
    ['motor','Motor',6,3000,3500,'Standard'],
    ['kit','Tubewell Set',0,0,15000,'Bundle']
  ].map(([id,name,stock,cost,sell,type],i)=>({
    'Product ID':id,'Product Name':name,'Current Stock':stock,
    'Purchase Price':cost,'Selling Price':sell,'Product Type':type,
    'Bundle Revision':2,Status:'Active',Unit:type==='Bundle'?'set':'pcs',_rowIndex:i+2
  }));
  const saleTotal=30000+120*standard;
  const sheet={
    PRODUCTS:products,
    STOCK_LOTS:[['pipe',90-standard,100,100,120],['motor',6,8,3000,3500]]
      .map(([id,remaining,initial,cost,sell],i)=>({
        'Product ID':id,'Product Name':id,'Lot ID':'LOT-'+id,'Purchase ID':'OPEN',
        'Remaining Quantity':remaining,'Original Quantity':initial,
        'Purchase Price':cost,'Sell Price':sell,'Purchase Date':'2026-01-01',_rowIndex:i+2
      })),
    SALE_ITEM_LOTS:[['pipe',10,'kit',100],['motor',2,'kit',3000]]
      .concat(standard?[['pipe',1,'pipe',100]]:[])
      .map(([id,qty,owner,cost],i)=>({
        'Invoice ID':'INV-1','Product ID':id,'Lot ID':'LOT-'+id,
        'Quantity':qty,'Unit Cost':cost,'Source Sale Product ID':owner,_rowIndex:i+2
      })),
    SALE_BUNDLE_COMPONENTS:[['pipe',5],['motor',1]].map(([id,qty],i)=>({
      'Invoice ID':'INV-1','Bundle Product ID':'kit','Bundle Revision':1,
      'Component Product ID':id,'Quantity Per Set':qty,'Sets Sold':2,
      'Component Quantity Sold':qty*2,Unit:'pcs',_rowIndex:i+2
    })),
    BUNDLE_COMPONENTS:[['pipe',8],['motor',1]].map(([id,qty],i)=>({
      'Bundle Product ID':'kit','Component Product ID':id,'Quantity Per Set':qty,
      Revision:2,Status:'Active',Unit:'pcs',_rowIndex:i+2
    })),
    SALES:[{
      'Invoice ID':'INV-1',Date:'2026-10-13',Time:'12:00:00','Created At':'2026-10-13',
      'Customer ID':'','Customer Name':'Test','Customer Phone':'01700000000',
      Subtotal:saleTotal,'Grand Total':saleTotal,'Paid Amount':saleTotal,
      'Due Amount':0,'Payment Type':'Cash','Payment Method':'Cash','Payment Status':'Paid',_rowIndex:2
    }],
    SALE_ITEMS:[{
      'Invoice ID':'INV-1','Product ID':'kit','Product Name':'Tubewell Set',
      Quantity:2,'Unit Price':15000,'Line Total':30000,'Sold Product Type':'Bundle',_rowIndex:2
    }].concat(standard?[{
      'Invoice ID':'INV-1','Product ID':'pipe','Product Name':'Pipe',
      Quantity:1,'Unit Price':120,'Line Total':120,'Sold Product Type':'Standard',_rowIndex:3
    }]:[]),
    CASH_SESSIONS:[{Status:'Open'}],
    SALES_RETURN:[],SALES_RETURN_ITEMS:[],STOCK_MOVEMENT:[],INVOICE_EDIT_LOG:[],
    VENDOR_SOURCING:[],VENDOR_RETURNS:[],VENDORS:[],CUSTOMERS:[],CASH_BOOK:[]
  };
  let sequence=0;
  const errors=[];
  const read=key=>sheet[key]||[];
  const append=(key,obj)=>{
    const rows=sheet[key]||(sheet[key]=[]);
    rows.push({...obj,_rowIndex:rows.length+2});
  };
  const ctx=vm.createContext({
    CONFIG:{LOCK_TIMEOUT_MS:1000},
    LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
    requirePermission_:()=>({Name:'tester'}),requireActiveCashSession_:()=>true,
    findUniqueSalesRow_:id=>read('SALES').find(row=>row['Invoice ID']===id),
    isDeleted_:()=>false,activeRows_:read,getAllRows_:read,
    activeSalesReturnItems_:()=>read('SALES_RETURN_ITEMS'),
    findSessionForTimestamp_:()=>({Status:'Open'}),
    safeDateOnly_:value=>String(value).slice(0,10),safeTimeOnly_:value=>String(value).slice(0,8),
    sanitizeInput_:value=>String(value??'').trim(),
    isValidNonNegativeNumber_:value=>value!==''&&value!==null&&value!==undefined&&
      Number.isFinite(Number(value))&&Number(value)>=0,
    roundMoney_:value=>Math.round((Number(value)+Number.EPSILON)*100)/100,
    resolveBankAccount_:()=>({id:'',name:''}),isBankLikePaymentMethod_:()=>false,
    computeBackdateInfo_:()=>({isBackdated:false,backdatedDays:0}),
    actorName_:()=>'tester',generateId_:prefix=>prefix+'-'+(++sequence),
    getSettingsMap_:()=>({}),computeInvoiceDueDate_:()=>'',buildInvoiceShopPayload_:()=>({}),
    updateRowFields_:(key,index,fields)=>{
      const row=read(key).find(item=>item._rowIndex===index);
      assert.ok(row,'Missing '+key+' row '+index);
      Object.assign(row,fields);
    },
    appendRow_:append,appendRows_:(key,rows)=>rows.forEach(row=>append(key,row)),
    deleteRow_:(key,index)=>{
      const arr=read(key),i=arr.findIndex(row=>row._rowIndex===index);
      assert.ok(i>=0,'Missing row for deletion');
      arr.splice(i,1);arr.forEach((row,j)=>row._rowIndex=j+2);
    },
    findRowIndex_:(key,column,value)=>read(key).find(row=>row[column]===value)?._rowIndex??-1,
    findRows_:(key,column,value)=>read(key).filter(row=>row[column]===value),
    addCashBookEntry_:row=>append('CASH_BOOK',row),
    addBankBookEntry_:()=>{throw Error('Bank entry not expected in cash-only test');},
    ok_:data=>({success:true,data}),fail_:message=>({success:false,message}),
    logError_:(name,error)=>errors.push(name+': '+error.message),
    economicReturnLineAmount_:row=>Number(row['Line Total'])||0,
    effectiveTransactionUnitPrice_:amount=>amount,
    salesReturnCashRefundAvailable_:()=>100000,
    customerInvoiceSettlementSnapshot_:()=>null,
    Utilities:{formatDate:()=>'12:00'},Session:{getScriptTimeZone:()=>'Asia/Dhaka'}
  });
  vm.runInContext(scripts,ctx);
  function edit(qty,price=15000) {
    const items=[{productId:'kit',name:'Tubewell Set',qty,unitPrice:price,bundleRevision:1}];
    if (standard) items.push({productId:'pipe',name:'Pipe',qty:1,unitPrice:120});
    return ctx.updateSaleInternal_('token','INV-1',{
      reason:'Invoice correction',customerName:'Test',customerPhone:'01700000000',
      paymentType:'Cash',paymentMethod:'Cash',discount:0,items
    },{});
  }
  function quantity(productId) {
    return Number(products.find(p=>p['Product ID']===productId)['Current Stock']);
  }
  return {sheet,ctx,edit,quantity,errors};
}

test('bundle invoice edit preserves original recipe, parent-only print and complete-set return',()=>{
  const w=workbook(false);
  const opened=w.ctx.getSaleForUpdate('token','INV-1');
  assert.equal(opened.success,true,JSON.stringify(opened));
  assert.equal(opened.data.items.length,1);
  assert.equal(opened.data.items[0].productType,'Bundle');
  assert.equal(opened.data.items[0].bundleRevision,1);

  assert.equal(w.edit(3).success,true,JSON.stringify(w.errors));
  assert.equal(w.quantity('pipe'),85); // +5, not +8 in current master
  assert.equal(w.quantity('motor'),5);
  assert.equal(w.sheet.SALE_ITEMS.length,1);
  assert.equal(w.sheet.SALE_ITEMS[0]['Line Total'],45000);
  assert.equal(w.sheet.SALE_BUNDLE_COMPONENTS[0]['Sets Sold'],3);
  assert.equal(w.sheet.SALE_BUNDLE_COMPONENTS[0]['Quantity Per Set'],5);

  assert.equal(w.edit(1).success,true,JSON.stringify(w.errors));
  assert.equal(w.quantity('pipe'),95);
  assert.equal(w.quantity('motor'),7);
  const stockBefore=w.sheet.PRODUCTS.map(row=>row['Current Stock']);
  const fifoBefore=w.sheet.SALE_ITEM_LOTS.map(row=>row.Quantity);
  assert.equal(w.edit(1,16000).success,true,JSON.stringify(w.errors));
  assert.deepEqual(w.sheet.PRODUCTS.map(row=>row['Current Stock']),stockBefore);
  assert.deepEqual(w.sheet.SALE_ITEM_LOTS.map(row=>row.Quantity),fifoBefore);

  const print=w.ctx.buildInvoicePayload_('INV-1');
  assert.equal(print.items.length,1);
  assert.equal(print.items[0].name,'Tubewell Set');
  assert.equal(Number(print.items[0].lineTotal),16000);
  assert.equal(print.items[0].unit,'set');
  const forReturn=w.ctx.getInvoiceForReturn('token','INV-1');
  assert.equal(forReturn.success,true,JSON.stringify(forReturn));
  assert.equal(forReturn.data.items.length,1);
  assert.equal(forReturn.data.items[0].productId,'kit');

  const txDate={dateStr:'2026-10-13',isBackdated:false,backdatedDays:0,reason:''};
  const prepared=w.ctx.prepareSalesReturn_({
    invoiceId:'INV-1',refundMethod:'Cash',items:[{productId:'kit',qty:1,price:16000}]
  },{
    txDate,sale:w.sheet.SALES[0],saleItems:w.sheet.SALE_ITEMS,returnItems:[],
    consumptionRows:w.sheet.SALE_ITEM_LOTS,stockLots:w.sheet.STOCK_LOTS,
    productsById:Object.fromEntries(w.sheet.PRODUCTS.map(p=>[p['Product ID'],p])),
    cashRefundAvailable:100000
  });
  const refund=w.ctx.commitPreparedSalesReturn_(prepared,{returnId:'RET-1',actingUser:{}});
  assert.equal(refund.totalReturnAmount,16000);
  assert.equal(w.sheet.SALES_RETURN_ITEMS.length,1);
  assert.equal(w.sheet.SALES_RETURN_ITEMS[0]['Product ID'],'kit');
  assert.equal(w.quantity('pipe'),100);
  assert.equal(w.quantity('motor'),8);
  assert.equal(w.sheet.CASH_BOOK.filter(r=>r.Type==='Sales Return').length,1);
  assert.deepEqual(w.errors,[]);
});

test('standalone Pipe remains its own invoice line and is not counted as a bundle child',()=>{
 const w=workbook(true);
 assert.equal(w.edit(3).success,true,JSON.stringify(w.errors));
 assert.equal(w.quantity('pipe'),84); // 100 - 11 at original sale - 5 extra
 assert.equal(w.sheet.SALE_ITEMS.length,2);
 assert.deepEqual(w.sheet.SALE_ITEMS.map(r=>r['Product ID']),['kit','pipe']);
 assert.equal(w.sheet.SALE_ITEM_LOTS.filter(r=>
    r['Product ID']==='pipe'&&r['Source Sale Product ID']==='pipe')
    .reduce((n,r)=>n+Number(r.Quantity),0),1);
 assert.equal(w.sheet.SALE_ITEM_LOTS.filter(r=>
    r['Product ID']==='pipe'&&r['Source Sale Product ID']==='kit')
    .reduce((n,r)=>n+Number(r.Quantity),0),15);
 assert.deepEqual(w.errors,[]);
});
