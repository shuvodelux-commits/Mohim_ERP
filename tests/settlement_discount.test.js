'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const root=path.resolve(__dirname,'..');
const read=n=>fs.readFileSync(path.join(root,n),'utf8');
function fnSource(src,name){const st=src.indexOf('function '+name+'(');assert.ok(st>=0,'missing function '+name);let i=src.indexOf('{',st),d=0,q=null,e=false,l=false,b=false;for(;i<src.length;i++){const c=src[i],n=src[i+1];if(l){if(c==='\n')l=false;continue}if(b){if(c==='*'&&n==='/'){b=false;i++}continue}if(q){if(e){e=false;continue}if(c==='\\'){e=true;continue}if(c===q)q=null;continue}if(c==='/'&&n==='/'){l=true;i++;continue}if(c==='/'&&n==='*'){b=true;i++;continue}if(c==='"'||c==="'"||c==='`'){q=c;continue}if(c==='{')d++;if(c==='}'){d--;if(d===0)return src.slice(st,i+1)}}throw Error('unterminated '+name)}
const tests=[];const test=(n,f)=>tests.push([n,f]);

test('ledger schema adds payment amount, discount amount and discount reason to customer and supplier ledgers',()=>{
  const cfg=read('Config.gs');
  const supplier=cfg.slice(cfg.indexOf('SUPPLIER_LEDGER: ['),cfg.indexOf('CUSTOMERS: ['));
  const customer=cfg.slice(cfg.indexOf('CUSTOMER_LEDGER: ['),cfg.indexOf('EXPENSES: ['));
  for(const block of [supplier,customer]){
    assert.match(block,/"Payment Amount"/);
    assert.match(block,/"Discount Amount"/);
    assert.match(block,/"Discount Reason"/);
  }
});

test('role grid exposes settlement discount as one edit-only special permission',()=>{
  const ui=read('UI.gs');
  assert.match(ui,/key:\s*['"]settlementDiscount['"]/);
  assert.match(ui,/Settlement Discount/);
  assert.match(ui,/permissionMode:\s*['"]editOnly['"]/);
});

test('settlement helpers preserve legacy rows and calculate payment discount and total separately',()=>{
  const src=read('SettlementDiscount.gs');
  const ctx={roundMoney_:n=>Math.round((Number(n)+Number.EPSILON)*100)/100};
  vm.createContext(ctx);
  ['settlementPaymentAmount_','settlementDiscountAmount_','settlementTotalAmount_'].forEach(n=>vm.runInContext(fnSource(src,n),ctx));
  const legacy={'Credit':25000};
  assert.strictEqual(ctx.settlementPaymentAmount_(legacy),25000);
  assert.strictEqual(ctx.settlementDiscountAmount_(legacy),0);
  assert.strictEqual(ctx.settlementTotalAmount_(legacy),25000);
  const row={'Credit':25000,'Payment Amount':24000,'Discount Amount':1000};
  assert.strictEqual(ctx.settlementPaymentAmount_(row),24000);
  assert.strictEqual(ctx.settlementDiscountAmount_(row),1000);
  assert.strictEqual(ctx.settlementTotalAmount_(row),25000);
});

test('discount validation requires special permission and forbids discount-created advance',()=>{
  const body=fnSource(read('SettlementDiscount.gs'),'validateSettlementDiscount_');
  assert.match(body,/requirePermission_\(token,\s*['"]settlementDiscount['"],\s*['"]edit['"]\)/);
  assert.match(body,/Discount Reason|discount reason|reason/i);
  assert.match(body,/currentDue|currentBalance/i);
  assert.match(body,/payment.*discount|discount.*payment/is);
});

test('customer receive and supplier pay accept discount and settle due by payment plus discount while moving only payment money',()=>{
  const cust=fnSource(read('Customer.gs'),'receivePayment');
  const sup=fnSource(read('Suppliers.gs'),'paySupplier');
  for(const body of [cust,sup]){
    assert.match(body,/discountAmount/);
    assert.match(body,/discountReason/);
    assert.match(body,/validateSettlementDiscount_/);
    assert.match(body,/Payment Amount/);
    assert.match(body,/Discount Amount/);
    assert.match(body,/Discount Reason/);
    assert.match(body,/Credit:\s*settlement\.total|Credit:\s*totalSettled|Credit:\s*settledTotal/);
  }
  assert.match(cust,/Credit:\s*settlement\.payment|Credit:\s*paymentAmount|Credit:\s*actualPayment/);
  assert.match(sup,/Debit:\s*settlement\.payment|Debit:\s*paymentAmount|Debit:\s*actualPayment/);
});



test('day book uses actual Payment Amount rather than total ledger Credit for customer and supplier settlements',()=>{
  const body=fnSource(read('DayBook.gs'),'getDayBookTransactions');
  const custSection=body.slice(body.indexOf('// ---------------- Customer payments'),body.indexOf('// ---------------- Supplier payments'));
  const supSection=body.slice(body.indexOf('// ---------------- Supplier payments'),body.indexOf('// ---------------- Finance'));
  assert.match(custSection,/settlementPaymentAmount_\(l\)/);
  assert.match(supSection,/settlementPaymentAmount_\(l\)/);
  assert.match(custSection,/Discount|discount/);
  assert.match(supSection,/Discount|discount/);
});

test('settlement discount profit helper totals customer discount as cost and supplier discount as income by business date',()=>{
  const src=read('SettlementDiscount.gs');
  const ctx={
    activeRows_: key => key==='CUSTOMER_LEDGER' ? [
      {Date:'2026-09-01',Type:'Payment','Discount Amount':1000},
      {Date:'2026-09-03',Type:'Payment','Discount Amount':500}
    ] : [
      {Date:'2026-09-02',Type:'Payment','Discount Amount':2000},
      {Date:'2026-09-05',Type:'Payment','Discount Amount':300}
    ],
    safeDateOnly_: v=>String(v),
    inRange_: (d,r)=>d>=r.from&&d<=r.to,
    roundMoney_: n=>Math.round((Number(n)+Number.EPSILON)*100)/100
  };
  vm.createContext(ctx);
  vm.runInContext(fnSource(src,'settlementDiscountAmount_'),ctx);
  vm.runInContext(fnSource(src,'computeSettlementDiscountProfit_'),ctx);
  const out=ctx.computeSettlementDiscountProfit_({from:'2026-09-01',to:'2026-09-03'});
  assert.deepStrictEqual(JSON.parse(JSON.stringify(out)),{
    customerDiscountGiven:1500,
    supplierDiscountReceived:2000,
    netProfitImpact:500
  });
});

test('profit engine includes settlement discount totals and adjusts net profit without rewriting revenue or cogs',()=>{
  const body=fnSource(read('Reports.gs'),'computeProfit_');
  assert.match(body,/computeSettlementDiscountProfit_/);
  assert.match(body,/customerSettlementDiscount/);
  assert.match(body,/supplierSettlementDiscountReceived/);
  assert.match(body,/settlementDiscountNetImpact/);
  assert.match(body,/grossProfit\s*-\s*expenses[^;\n]*supplier|grossProfit[^;\n]*settlement/i);
});

test('profit cache generation is invalidated by every source that changes profit',()=>{
  const body=fnSource(read('Database.gs'),'invalidateDerivedCachesForSheet_');
  const profitBlock=body.slice(body.indexOf('// Profit depends'),body.indexOf("if (sheetKey === 'STOCK_LOTS'"));
  assert.match(profitBlock,/CUSTOMER_LEDGER/);
  assert.match(profitBlock,/SUPPLIER_LEDGER/);
  assert.match(profitBlock,/VENDOR_SOURCING/);
});

test('profit UI shows customer discount given and supplier discount received separately',()=>{
  const html=read('reports.html');
  assert.match(html,/Customer Settlement Discount|Customer Discount Given/i);
  assert.match(html,/Supplier Settlement Discount|Supplier Discount Received/i);
  assert.match(html,/customerSettlementDiscount/);
  assert.match(html,/supplierSettlementDiscountReceived/);
});



test('native payment edit loaders expose actual payment, discount, and bank account separately with legacy fallback',()=>{
  const src=read('DeleteEngine.gs');
  for(const name of ['getCustomerPaymentForEdit','getSupplierPaymentForEdit']){
    const load=fnSource(src,name);
    assert.match(load,/settlementPaymentAmount_/);
    assert.match(load,/settlementDiscountAmount_/);
    assert.match(load,/discountAmount/);
    assert.match(load,/discountReason/);
    assert.match(load,/paymentAccountForReference_/);
  }
});

test('customer and supplier native payment edit restores old total then reapplies new total while moving only actual payment cash',()=>{
  const src=read('DeleteEngine.gs');
  const pairs=[
    ['updateCustomerPaymentInternal_','reverseCustomerPaymentMoney_','adjustCustomerDue_'],
    ['updateSupplierPaymentInternal_','reverseSupplierPaymentMoney_','adjustSupplierDue_']
  ];
  for(const [name,reverseFn,dueFn] of pairs){
    const body=fnSource(src,name);
    assert.match(body,/oldPayment\s*=\s*settlementPaymentAmount_/);
    assert.match(body,/oldTotal\s*=\s*settlementTotalAmount_/);
    assert.match(body,/validateSettlementDiscount_/);
    assert.match(body,/settlementBalanceBeforePayment_/);
    assert.match(body,new RegExp(reverseFn+'\\([^;]+oldPayment[^;]+oldTotal'));
    assert.match(body,new RegExp(dueFn+'\\([^,]+,\\s*-settlement\\.total\\)'));
    assert.match(body,/['"]Payment Amount['"]:\s*settlement\.payment/);
    assert.match(body,/['"]Discount Amount['"]:\s*settlement\.discount/);
    assert.match(body,/Credit:\s*settlement\.payment|Debit:\s*settlement\.payment/);
  }
});

test('native payment delete restores total settlement to party due but reverses only actual payment money',()=>{
  const src=read('DeleteEngine.gs');
  const pairs=[
    ['deleteCustomerPayment','reverseCustomerPaymentMoney_'],
    ['deleteSupplierPayment','reverseSupplierPaymentMoney_']
  ];
  for(const [name,reverseFn] of pairs){
    const body=fnSource(src,name);
    assert.match(body,/paymentAmount\s*=\s*settlementPaymentAmount_/);
    assert.match(body,/totalSettled\s*=\s*settlementTotalAmount_/);
    assert.match(body,new RegExp(reverseFn+'\\([^;]+paymentAmount[^;]+totalSettled'));
    assert.match(body,/markRowDeleted_/);
  }
});

test('preserving an existing discount during an unrelated native edit does not require settlement-discount permission, but changing it does',()=>{
  const src=read('SettlementDiscount.gs');
  let permissionCalls=0;
  const ctx={
    roundMoney_:n=>Math.round((Number(n)+Number.EPSILON)*100)/100,
    sanitizeInput_:v=>String(v==null?'':v).trim(),
    isValidNonNegativeNumber_:v=>v!==''&&isFinite(Number(v))&&Number(v)>=0,
    requirePermission_:()=>{permissionCalls++;}
  };
  vm.createContext(ctx); vm.runInContext(fnSource(src,'validateSettlementDiscount_'),ctx);
  ctx.validateSettlementDiscount_('T','customers',25000,24000,1000,'Negotiated',1000,'Negotiated');
  assert.strictEqual(permissionCalls,0,'unchanged discount should not consume special permission');
  ctx.validateSettlementDiscount_('T','customers',25000,23500,1500,'Negotiated',1000,'Negotiated');
  assert.strictEqual(permissionCalls,1,'changed discount must require special permission');
});



test('customer payment UI exposes discount, reason, live settlement summary, full-settle shortcut and permission gate',()=>{
  const html=read('customers.html');
  for(const id of ['custPayDiscount','custPayDiscountReason','custPayTotalSettled','custPayBalanceAfter','custPaySettleFullBtn','custLedEditDiscount','custLedEditDiscountReason']) assert.match(html,new RegExp(id));
  assert.match(html,/settlementDiscount.*edit|edit.*settlementDiscount/is);
  assert.match(html,/custPayRecalc_/);
  assert.match(html,/Settle Full Balance/);
  assert.match(html,/receivePayment[^\n]*discountAmount[^\n]*discountReason|serverCall\('receivePayment'[\s\S]{0,500}discount/i);
  assert.match(html,/discountAmount:\s*document\.getElementById\('custLedEditDiscount'\)/);
  assert.match(html,/discountReason:\s*document\.getElementById\('custLedEditDiscountReason'\)/);
});

test('supplier payment UI mirrors customer settlement discount behavior and sends actual discount fields',()=>{
  const html=read('suppliers.html');
  for(const id of ['supPayDiscount','supPayDiscountReason','supPayTotalSettled','supPayBalanceAfter','supPaySettleFullBtn','supLedEditDiscount','supLedEditDiscountReason']) assert.match(html,new RegExp(id));
  assert.match(html,/settlementDiscount.*edit|edit.*settlementDiscount/is);
  assert.match(html,/supPayRecalc_/);
  assert.match(html,/Settle Full Balance/);
  assert.match(html,/paySupplier[^\n]*discountAmount[^\n]*discountReason|serverCall\('paySupplier'[\s\S]{0,500}discount/i);
  assert.match(html,/discountAmount:\s*document\.getElementById\('supLedEditDiscount'\)/);
  assert.match(html,/discountReason:\s*document\.getElementById\('supLedEditDiscountReason'\)/);
});

test('customer and supplier ledger rows visibly separate actual payment and negotiated discount when present',()=>{
  const cust=read('customers.html'), sup=read('suppliers.html');
  assert.match(cust,/Payment Amount|Discount Amount/);
  assert.match(sup,/Payment Amount|Discount Amount/);
  assert.match(cust,/Discount/);
  assert.match(sup,/Discount/);
});

let failed=0;for(const [n,f] of tests){try{f();console.log('PASS',n)}catch(e){failed++;console.error('FAIL',n);console.error(e.stack||e)}}console.log(`\n${tests.length-failed}/${tests.length} passed`);if(failed)process.exit(1);
