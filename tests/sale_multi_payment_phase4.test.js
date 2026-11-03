'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const plain=x=>JSON.parse(JSON.stringify(x));
const accounts=[
  {'Bank Account ID':'B1','Account Name':'DBBL','Account Type':'Bank','Status':'Active'},
  {'Bank Account ID':'M1','Account Name':'bKash Merchant','Account Type':'Mobile Banking','Status':'Active'}
];
const split=[{id:'cash',method:'Cash',amount:'80',accountId:''},{id:'bank',method:'Bank',amount:'50',accountId:'B1'}];
const draftPayload=(payment)=>({
  customerName:'A',customerPhone:'01700000000',items:[{productId:'P1',name:'Widget',qty:1,unitPrice:100,lineTotal:100}],
  payment,subtotal:100,discount:0,grandTotal:100
});
function draftKernel(enabled=true) {
  const source=read('DraftSales.gs'),ctx=vm.createContext({
    JSON,Math,Number,Array,Error,SALES_DRAFT_JSON_LIMIT_:45000,
    sanitizeInput_:x=>String(x==null?'':x).trim(),
    isValidNonNegativeNumber_:n=>Number.isFinite(Number(n))&&Number(n)>=0,
    roundMoney_:n=>Math.round(Number(n)*100)/100,
    getSettingsMap_:()=>({'POS Multi Payment Enabled':enabled?'true':'false'}),
    getAllRows_:()=>accounts
  });
  vm.runInContext(read('SalePayments.gs'),ctx);
  vm.runInContext(source.slice(source.indexOf('function cleanDraftText_('),source.indexOf('function parseSalesDraftRow_(')),ctx);
  return ctx;
}
test('split draft saves exact rows including Cash tender/change and reads a distinguishable version',()=>{
  const clean=draftKernel().validateSalesDraftPayload_(draftPayload({payments:split}));
  assert.deepEqual(plain(JSON.parse(clean.paymentJson).payments),split);
  assert.equal(clean.payment.payments[0].amount,'80');
  assert.equal(clean.grandTotal,100);
});
test('legacy draft still saves the original three payment fields',()=>{
  const clean=draftKernel().validateSalesDraftPayload_(draftPayload({amountReceived:'20',paymentMethod:'Bank',bankAccountId:'B1'}));
  assert.deepEqual(plain(JSON.parse(clean.paymentJson)),{amountReceived:'20',paymentMethod:'Bank',bankAccountId:'B1'});
});
test('draft split rows validate before any write; disabled feature rejects new split drafts',()=>{
  assert.throws(()=>draftKernel(false).validateSalesDraftPayload_(draftPayload({payments:split})),/enabled|disabled/i);
  assert.throws(()=>draftKernel().validateSalesDraftPayload_(draftPayload({payments:[{id:'x',method:'Bank',amount:'15',accountId:'BAD'}]})),/account/i);
  assert.throws(()=>draftKernel().validateSalesDraftPayload_(draftPayload({payments:[{id:'x',method:'Cash',amount:'1.234',accountId:''}]})),/decimal|places/i);
});
function invoiceKernel() {
  const sale={'Invoice ID':'INV-1','Payment Detail Version':1,'Paid Amount':100,'Grand Total':100,
    'Date':'2026-11-03','Time':'12:00:00','Customer Name':'Buyer','Customer Phone':'017','Customer ID':'',
    'Subtotal':100,'Discount':0,'Due Amount':0,'Payment Method':'Multiple','Payment Status':'Paid'};
  const child=[
    {'Invoice ID':'INV-1','Payment ID':'SP-1','Revision':1,'Row Order':1,'Method':'Cash','Tendered Amount':80,'Applied Amount':50,'Change Amount':30,'Status':'Active'},
    {'Invoice ID':'INV-1','Payment ID':'SP-2','Revision':1,'Row Order':2,'Method':'Bank','Bank Account ID':'B1','Bank Account Name':'DBBL','Tendered Amount':50,'Applied Amount':50,'Change Amount':0,'Status':'Active'}
  ];
  const ctx=vm.createContext({
    JSON,Math,Number,Date,findRows_:(table)=>table==='SALES'?[sale]:table==='SALE_PAYMENTS'?child:[],
    getAllRows_:()=>[],getSettingsMap_:()=>({}),isDeleted_:()=>false,
    safeDateOnly_:x=>x,safeTimeOnly_:x=>x,computeInvoiceDueDate_:()=>'',buildInvoiceShopPayload_:()=>({}),
    customerInvoiceSettlementSnapshot_:()=>({paidAmount:110,dueAmount:0,customerCreditUsed:10,paymentStatus:'Paid',paymentType:'Cash'})
  });
  vm.runInContext(read('SalePayments.gs'),ctx);
  const source=read('Invoice.gs');
  vm.runInContext(source.slice(source.indexOf('function buildInvoicePayload_('),source.indexOf('function resolveInvoiceLogoDataUri_(')),ctx);
  return {ctx,sale,child};
}
test('historical invoice returns original sale Cash/Bank allocations independently from later settlement',()=>{
  const {ctx}=invoiceKernel();
  const result=plain(ctx.buildInvoicePayload_('INV-1'));
  assert.equal(result.paidAmount,110);
  assert.equal(result.originalPaidAmount,100);
  assert.equal(result.paymentDetailVersion,'1');
  assert.deepEqual(result.payments.map(p=>({method:p.method,tendered:p.tendered,applied:p.applied,change:p.change})),[
    {method:'Cash',tendered:80,applied:50,change:30},{method:'Bank',tendered:50,applied:50,change:0}
  ]);
});
test('legacy invoice readback uses one legacy method; new-format missing children must fail',()=>{
  const {ctx,sale,child}=invoiceKernel();
  sale['Payment Detail Version']='';sale['Paid Amount']=25;sale['Payment Method']='Mobile Banking';sale['Bank Account ID']='M1';
  let inv=plain(ctx.buildInvoicePayload_('INV-1'));
  assert.equal(inv.payments.length,1);
  assert.equal(inv.payments[0].legacy,true);
  assert.equal(inv.payments[0].method,'Mobile Banking');
  sale['Payment Detail Version']=1;sale['Paid Amount']=25;child.splice(0,child.length);
  assert.throws(()=>ctx.buildInvoicePayload_('INV-1'),/integrity|mismatch|missing/i);
});
test('POS saves/restores split draft and duplicates the original tender, not later collection amounts',()=>{
  const pos=read('pos.html');
  assert.match(pos,/payment:\s*posMultiPaymentEnabledForSale_\(\)\s*\?/);
  assert.match(pos,/posRestoreDraft_[\s\S]*?posRestoreMultiPaymentSnapshot_/);
  assert.match(pos,/posRestoreCopiedSaleFields_[\s\S]*?posRestoreMultiPaymentSnapshot_/);
  assert.match(pos,/posMultiPaymentEnabledForSale_\([\s\S]*?paymentModeLegacy/);
  assert.match(pos,/payload\.payments\s*=\s*posMultiPaymentPayloadRows_\(/);
  assert.match(pos,/payload\.operationId\s*=\s*posMultiPaymentOperationId_\(/);
});
test('draft preview, sales detail, A4 and thermal receipt show each applied payment and Cash change',()=>{
  assert.match(read('DraftSales.gs'),/buildSalesDraftPreviewPayload_[\s\S]*?paymentDetailVersion/);
  assert.match(read('sales.html'),/smViewPaymentBreakdown/);
  const html=read('javascript.html');
  assert.match(html,/function buildInvSalePaymentBreakdown_/);
  assert.match(html,/buildInvBottom_[\s\S]*?buildInvSalePaymentBreakdown_\(inv/);
  assert.match(html,/buildInvThermalTotals_[\s\S]*?buildInvSalePaymentBreakdown_\(inv/);
  assert.match(html,/Cash Change/);
});
test('multi-account edit, delete, return protections remain active until Phase 5',()=>{
  for(const name of ['SalesManagement.gs','DeleteEngine.gs','SalesReturn.gs']) {
    assert.match(read(name),/Payment Detail Version/,name);
  }
});

test('restored split payment rows copy original Cash tender and preserve account order',()=>{
  const source=read('pos.html');
  const start=source.indexOf('  function posMultiPaymentEnabledForSale_(');
  const end=source.indexOf('  function posMultiPaymentPayloadRows_(',start);
  assert.ok(start>=0 && end>start);
  const state={multiPaymentEnabled:true,updateInvoiceId:null,paymentModeLegacy:false,paymentRows:[]};
  const ctx=vm.createContext({posState:state});
  vm.runInContext(source.slice(start,end),ctx,{filename:'POS snapshot helpers'});
  const src={paymentDetailVersion:'1',payments:[
    {rowId:'SP1',method:'Cash',tendered:80,applied:50,change:30},
    {rowId:'SP2',method:'Bank',bankAccountId:'B1',bankAccountName:'DBBL',tendered:50,applied:50,change:0}
  ],originalPaidAmount:100,paidAmount:110};
  assert.equal(ctx.posHasSplitPaymentSnapshot_(src),true);
  assert.equal(ctx.posHasSplitPaymentSnapshot_({payment:{amountReceived:'100'}}),false);
  ctx.posRestoreMultiPaymentSnapshot_(src);
  assert.deepEqual(plain(state.paymentRows),[
    {id:'pm-1',method:'Cash',accountId:'',amount:'80'},
    {id:'pm-2',method:'Bank',accountId:'B1',amount:'50'}
  ]);
  assert.equal(ctx.posMultiPaymentEnabledForSale_(),true);
  assert.equal(state.paymentSnapshotSplit,true);
  state.multiPaymentEnabled=false;
  assert.equal(ctx.posMultiPaymentEnabledForSale_(),false);
});
test('split draft preview displays the actual applied sum, due and Cash change',()=>{
  const ctx=draftKernel();
  const source=read('DraftSales.gs');
  ctx.safeDateOnly_=x=>x;
  ctx.buildInvoiceShopPayload_=()=>({currencySymbol:'৳'});
  vm.runInContext(source.slice(source.indexOf('function parseSalesDraftRow_('),source.indexOf('function appendSalesDraftAudit_(')),ctx);
  vm.runInContext(source.slice(source.indexOf('function buildSalesDraftPreviewPayload_('),source.indexOf('function getSalesDraftPreview(')),ctx);
  const clean=ctx.validateSalesDraftPayload_(draftPayload({payments:split}));
  const preview=plain(ctx.buildSalesDraftPreviewPayload_({
    'Draft No':'DRF-1','Draft Date':'2026-11-03','Payment JSON':clean.paymentJson,'Items JSON':clean.itemsJson,
    'Grand Total':100,'Subtotal':100,'Discount':0
  }));
  assert.equal(preview.paymentDetailVersion,'1');
  assert.equal(preview.paidAmount,100);
  assert.equal(preview.dueAmount,0);
  assert.deepEqual(preview.payments.map(x=>[x.method,x.tendered,x.applied,x.change]),[
    ['Cash',80,50,30],['Bank',50,50,0]
  ]);
});
test('an interrupted split draft post cannot be treated as an already posted successful retry',()=>{
  const src=read('Sales.gs');
  assert.match(src,/if \(alreadyPosted\)[\s\S]*?SALE_POSTING_JOURNAL[\s\S]*?Committed[\s\S]*?readSalePaymentBreakdown_/);
  assert.match(src,/savedSplit !== multiPayment/);
});
