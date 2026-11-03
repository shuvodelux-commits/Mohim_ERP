'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const payment = (id, method, amount, accountId = '') => ({id,method,amount,accountId});
const product = {'Product ID':'P1','Product Name':'Widget','Selling Price':100,'Current Stock':12,'Status':'Active'};
const accounts = [
  {'Bank Account ID':'B1','Account Name':'DBBL','Account Type':'Bank','Status':'Active'},
  {'Bank Account ID':'M1','Account Name':'bKash Merchant','Account Type':'Mobile Banking','Status':'Active'},
  {'Bank Account ID':'B2','Account Name':'Other Bank','Account Type':'Bank','Status':'Inactive'}
];
const payload = (payments, operationId = 'multi-payment-operation-00001') => ({
  customerName:'Buyer',customerPhone:'01700000000', customerId:'C1',
  discount:0, items:[{productId:'P1',name:'Widget',qty:1,unitPrice:100,priceMode:'manual'}],
  payments, operationId
});

function harness(enabled = true, failAt = '') {
  const tables = {
    PRODUCTS:[{...product}], STOCK_LOTS:[], BUNDLE_COMPONENTS:[], VENDORS:[],
    CUSTOMERS:[{'Customer ID':'C1','Customer Name':'Buyer','Phone':'01700000000','Current Due':0,'Status':'Active'}],
    BANK_ACCOUNTS:accounts.map(a=>({...a})),
    SALES:[], SALE_PAYMENTS:[], SALE_POSTING_JOURNAL:[],
    CASH_BOOK:[], BANK_BOOK:[], CUSTOMER_LEDGER:[]
  };
  const writes = [], writeLog = [];
  let serial = 0, lockHeld = false, failed = false;
  const rows = key => tables[key] || (tables[key] = []);
  const mutate = (key, write) => {
    assert.equal(lockHeld, true, 'all sale writes require script lock: '+key);
    writes.push(key);
    if (!failed && failAt === key) {failed = true; throw new Error('Injected write failure: '+key);}
    const v=write(); writeLog.push(key); return v;
  };
  const context = vm.createContext({
    console,Date,Math,JSON,
    CONFIG:{LOCK_TIMEOUT_MS:1000},
    LockService:{getScriptLock:()=>({waitLock:()=>{assert.equal(lockHeld,false);lockHeld=true;},releaseLock:()=>{lockHeld=false;}})},
    Session:{getScriptTimeZone:()=> 'UTC'},
    Utilities:{
      DigestAlgorithm:{SHA_256:'SHA_256'},
      computeDigest:(_alg,input)=>Array.from(crypto.createHash('sha256').update(String(input)).digest()),
      formatDate:()=> '11:00:00'
    },
    getAllRows_:key=>rows(key).map((r,i)=>({...r,_rowIndex:i+2})),
    activeRows_:key=>rows(key).map((r,i)=>({...r,_rowIndex:i+2})).filter(r=>r['Is Deleted']!=='TRUE'),
    findRowIndex_:(key,column,val)=>rows(key).findIndex(r=>r[column]===val)+2,
    appendRow_:(key,row)=>mutate(key,()=>{rows(key).push({...row});return rows(key).length+1;}),
    appendRows_:(key,items)=>items.forEach(row=>context.appendRow_(key,row)),
    updateRowFields_:(key,index,data)=>mutate(key,()=>Object.assign(rows(key)[index-2],data)),
    generateId_:key=>key+'-'+(++serial),
    requirePermission_:()=>({'Full Name':'Test Owner'}),
    actorName_:u=>u['Full Name'],
    requireActiveCashSession_:()=>({id:'SESSION'}),
    sanitizeInput_:v=>String(v==null?'':v).trim(),
    isValidNonNegativeNumber_:v=>v!==''&&v!==null&&v!==undefined&&Number.isFinite(Number(v))&&Number(v)>=0,
    isDeleted_:row=>row['Is Deleted']==='TRUE',
    roundMoney_:v=>Math.round((Number(v)+Number.EPSILON)*100)/100,
    getSettingsMap_:()=>({'POS Multi Payment Enabled': enabled?'true':'false'}),
    getBundleDefinitions_:()=>({}),
    bundleProductType_:()=> 'Standard',
    computePlanSellingPrice_:(_p,qty)=>({unitPrice:100,lineTotal:qty*100}),
    planStockConsumption_:(_id,qty)=>({draws:[],shortfall:0,fallbackPrice:10}),
    applyStockConsumption_:()=>[],
    resolveTransactionDate_:()=>({dateStr:'2026-11-03',isBackdated:false,backdatedDays:0,reason:''}),
    resolveBankAccount_:(method,accountId)=>{
      if(method==='Cash'||!method)return {id:'',name:''};
      const a=rows('BANK_ACCOUNTS').find(a=>a['Bank Account ID']===accountId);
      if(!a||a.Status!=='Active')throw new Error('Invalid account');
      return {id:a['Bank Account ID'],name:a['Account Name']};
    },
    isBankLikePaymentMethod_:m=>m==='Bank'||m==='Mobile Banking',
    resolveOrCreateCustomer_:()=> 'C1',
    normalizePhoneDisplay_:v=>v,
    addBankBookEntry_:(accountId,entry)=>context.appendRow_('BANK_BOOK',{'Bank Account ID':accountId,...entry}),
    addCashBookEntry_:entry=>context.appendRow_('CASH_BOOK',entry),
    buildInvoicePayload_:id=>({invoiceId:id}),
    ok_:v=>({success:true,data:v}),
    fail_:v=>({success:false,message:String(v)}),
    logError_:()=>{}
  });
  vm.runInContext(read('SalePayments.gs'),context,{filename:'SalePayments.gs'});
  vm.runInContext(read('Sales.gs'),context,{filename:'Sales.gs'});
  return {context,tables,writes,writeLog,rows};
}

test('split tender posts exactly one Cash credit and one credit per bank/mobile account, due only once',()=>{
  const h=harness(),p=payload([payment('cash','Cash','20'),payment('bank','Bank','30','B1'),payment('mobile','Mobile Banking','10','M1')]);
  const r=h.context.completeSale('token',p);
  assert.equal(r.success,true,r.message);
  assert.equal(h.rows('SALES').length,1);
  assert.equal(h.rows('SALES')[0]['Paid Amount'],60);
  assert.equal(h.rows('SALES')[0]['Due Amount'],40);
  assert.equal(h.rows('SALES')[0]['Payment Detail Version'],1);
  assert.equal(h.rows('SALES')[0]['Payment Method'],'Multiple');
  assert.equal(h.rows('CASH_BOOK').length,1);
  assert.equal(h.rows('CASH_BOOK')[0].Credit,20);
  assert.deepEqual(h.rows('BANK_BOOK').map(r=>[r['Bank Account ID'],r.Credit]),[['B1',30],['M1',10]]);
  assert.equal(h.rows('SALE_PAYMENTS').length,3);
  assert.deepEqual(h.rows('SALE_PAYMENTS').map(r=>r['Applied Amount']),[20,30,10]);
  assert.equal(h.rows('CUSTOMER_LEDGER').length,1);
  assert.equal(h.rows('CUSTOMER_LEDGER')[0].Debit,40);
  assert.equal(h.rows('CUSTOMERS')[0]['Current Due'],40);
  assert.equal(h.rows('SALE_POSTING_JOURNAL')[0].State,'Committed');
});

test('full Cash + Bank payment has no customer due, and cash change never enters cash book',()=>{
  const h=harness();
  const r=h.context.completeSale('token',payload([payment('cash','Cash','80'),payment('bank','Bank','50','B1')]));
  assert.equal(r.success,true,r.message);
  assert.equal(h.rows('CASH_BOOK')[0].Credit,50);
  assert.equal(h.rows('BANK_BOOK')[0].Credit,50);
  assert.equal(h.rows('SALES')[0]['Paid Amount'],100);
  assert.equal(h.rows('SALES')[0]['Due Amount'],0);
  assert.equal(h.rows('CUSTOMER_LEDGER').length,0);
  assert.equal(h.rows('SALE_PAYMENTS')[0]['Tendered Amount'],80);
  assert.equal(h.rows('SALE_PAYMENTS')[0]['Applied Amount'],50);
  assert.equal(h.rows('SALE_PAYMENTS')[0]['Change Amount'],30);
});

test('invalid bank/account or missing operation is rejected before any write',()=>{
  for(const p of [
    payload([payment('bad','Bank','50','B2')]),
    payload([payment('bad','Bank','101','B1')]),
    payload([payment('bad','Mobile Banking','10','B1')]),
    payload([payment('cash','Cash','10')],'')
  ]) {
    const h=harness();
    const r=h.context.completeSale('token',p);
    assert.equal(r.success,false,'invalid payment should fail');
    assert.deepEqual(h.writes,[]);
    assert.equal(h.rows('SALE_POSTING_JOURNAL').length,0);
  }
});

test('feature disabled rejects split request and leaves legacy sales untouched',()=>{
  const h=harness(false);
  const result=h.context.completeSale('token',payload([payment('cash','Cash','10'),payment('bank','Bank','40','B1')]));
  assert.equal(result.success,false);
  assert.match(result.message,/disabled|not enabled/i);
  assert.deepEqual(h.writes,[]);
});

test('committed duplicate returns same invoice without duplicating stock, payments or book entries',()=>{
  const h=harness(),p=payload([payment('cash','Cash','20'),payment('bank','Bank','60','B1')]);
  const first=h.context.completeSale('token',p);
  assert.equal(first.success,true,first.message);
  const count=h.writes.length;
  const second=h.context.completeSale('token',p);
  assert.equal(second.success,true,second.message);
  assert.equal(first.data.invoiceId,second.data.invoiceId);
  assert.equal(h.writes.length,count);
  assert.equal(h.rows('SALES').length,1);
  assert.equal(h.rows('SALE_POSTING_JOURNAL').length,1);
  assert.equal(h.rows('BANK_BOOK').length,1);
  assert.equal(h.rows('CUSTOMER_LEDGER').length,1);
});

test('operation ID with modified payload is rejected, never silently replayed',()=>{
  const h=harness(),p=payload([payment('cash','Cash','10')]);
  assert.equal(h.context.completeSale('token',p).success,true);
  const prior=h.writes.length;
  const swapped={...p,payments:[payment('cash','Cash','20')]};
  const result=h.context.completeSale('token',swapped);
  assert.equal(result.success,false);
  assert.match(result.message,/different|mismatch/i);
  assert.equal(h.writes.length,prior);
});

test('partial financial write becomes Needs Review; retries never create duplicate invoice',()=>{
  const h=harness(true,'BANK_BOOK'),p=payload([payment('cash','Cash','20'),payment('bank','Bank','30','B1')]);
  const first=h.context.completeSale('token',p);
  assert.equal(first.success,false);
  assert.equal(h.rows('SALES').length,1);
  const journal=h.rows('SALE_POSTING_JOURNAL')[0];
  assert.equal(journal.State,'Needs Review');
  const count=h.writes.length;
  const again=h.context.completeSale('token',p);
  assert.equal(again.success,false);
  assert.match(again.message,/review|interrupted|reconcile/i);
  assert.equal(h.writes.length,count);
  assert.equal(h.rows('SALES').length,1);
  assert.equal(h.rows('CASH_BOOK').length,1);
});

test('fully Due multi-payment invoice records a version with no payment child rows',()=>{
  const h=harness(),p=payload([payment('cash','Cash','')]);
  const r=h.context.completeSale('token',p);
  assert.equal(r.success,true,r.message);
  assert.equal(h.rows('SALE_PAYMENTS').length,0);
  assert.equal(h.rows('SALES')[0]['Payment Detail Version'],1);
  assert.equal(h.rows('SALES')[0]['Paid Amount'],0);
  assert.equal(h.rows('SALES')[0]['Due Amount'],100);
  assert.equal(h.rows('CASH_BOOK').length,0);
  assert.equal(h.rows('BANK_BOOK').length,0);
  assert.equal(h.rows('CUSTOMER_LEDGER').length,1);
});

test('feature remains disabled by default until complete accounting UI and reversals ship',()=>{
  const cfg=read('Config.gs');
  assert.match(cfg,/"POS Multi Payment Enabled":\s*"false"/);
});

test('all posting-stage write failures remain quarantined and a retry never duplicates stock or money',()=>{
  for(const stage of ['SALES','SALE_ITEMS','SALE_PAYMENTS','CASH_BOOK','BANK_BOOK','CUSTOMER_LEDGER']) {
    const h=harness(true,stage);
    const p=payload([payment('cash','Cash','20'),payment('bank','Bank','30','B1')],
      'failure-stage-'+stage+'-operation');
    const one=h.context.completeSale('token',p);
    assert.equal(one.success,false,'expected failure at '+stage);
    assert.equal(h.rows('SALE_POSTING_JOURNAL').length,1,stage);
    assert.equal(h.rows('SALE_POSTING_JOURNAL')[0].State,'Needs Review',stage);
    const count=h.writes.length;
    const again=h.context.completeSale('token',p);
    assert.equal(again.success,false,stage);
    assert.match(again.message,/Needs Review/i,stage);
    assert.equal(h.writes.length,count,stage);
    assert.ok(h.rows('SALES').length<=1,stage);
    assert.ok(h.rows('CASH_BOOK').length<=1,stage);
    assert.ok(h.rows('BANK_BOOK').length<=1,stage);
  }
});
