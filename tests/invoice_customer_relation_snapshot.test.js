'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=n=>fs.readFileSync(path.join(__dirname,'..',n),'utf8');
const helper=read('Customer.gs').match(/function normalizeCustomerRelationType_\(value\)\s*\{[^}]*\}/)[0];
const src=read('Invoice.gs');
const buildSource=src.slice(src.indexOf('function buildInvoicePayload_('),src.indexOf('function resolveInvoiceLogoDataUri_('));
function invoice(sale,customer) {
 const context=vm.createContext({
  findRows_:(name)=>name==='SALES'?[sale]:[],
  getAllRows_:name=>name==='CUSTOMERS'?[customer]:[],
  getSettingsMap_:()=>({}),isDeleted_:()=>false,
  safeDateOnly_:v=>v,safeTimeOnly_:v=>v,
  computeInvoiceDueDate_:()=>'',buildInvoiceShopPayload_:()=>({}),
  readSalePaymentBreakdown_:()=>[],customerInvoiceSettlementSnapshot_:()=>null,
 });
 vm.runInContext(helper,context);
 vm.runInContext(buildSource,context);
 return context.buildInvoicePayload_(sale['Invoice ID']);
}
test('cash invoice snapshots Husband type and name even without a ledger customer',()=>{
 const sale={'Invoice ID':'I-1','Date':'2026-11-04','Time':'12:00','Customer Name':'Buyer','Customer Relation Type':'Husband','Customer Relation Name':'Rahim','Customer ID':'','Paid Amount':100,'Grand Total':100};
 const result=invoice(sale,{});
 assert.equal(result.customerRelationType,'Husband');
 assert.equal(result.customerFatherName,'Rahim');
});
test('legacy invoice stays Father even if the current customer was later changed to Husband',()=>{
 const sale={'Invoice ID':'I-LEG','Date':'2026-11-03','Time':'12:00','Customer Name':'Buyer','Customer ID':'C1','Paid Amount':100,'Grand Total':100};
 const customer={'Customer ID':'C1','Father Name':'Karim','Relation Type':'Husband'};
 const result=invoice(sale,customer);
 assert.equal(result.customerRelationType,'Father');
 assert.equal(result.customerFatherName,'Karim');
});
