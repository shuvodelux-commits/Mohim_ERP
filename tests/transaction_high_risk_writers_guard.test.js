'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const targets={
 'DeleteEngine.gs':[
  'deleteSalesInvoice','deletePurchase','deleteExpense','deleteSupplier','deleteProduct',
  'deleteBankTransaction','updateSupplierPaymentInternal_',
  'deleteSupplierPayment','updateCustomerPaymentInternal_','deleteCustomerPayment',
  'updateFinanceTransactionInternal_','deleteFinanceTransaction',
  'updateVendorPaymentInternal_','deleteVendorPayment','updateVendorReturnInternal_',
  'deleteVendorReturn','updateVendorSourcingInternal_','deleteVendorSourcing',
  'updateVendorIssueInternal_','deleteVendorIssue','updateVendorIssueMemo',
  'deleteVendorIssueMemo','updateVendorReceiptInternal_','deleteVendorReceipt',
  'updateVendorReturnReceivedInternal_','deleteVendorReturnReceived'],
 'BankLedger.gs':['addBankManualEntry','reverseBankEntry'],
 'Vendors.gs':['payVendor','returnProductsToVendor','giveProductsToVendor',
   'receiveVendorPayment','receiveProductsFromVendor'],
 'Products.gs':['adjustStock'],
 'CashReconciliation.gs':['saveCashReconciliationExplanation']
};
function body(file,name){
 const code=fs.readFileSync(path.join(root,file),'utf8');
 const marker='function '+name+'(';
 const start=code.indexOf(marker);
 assert.ok(start>=0,file+' missing '+name);
 const next=code.indexOf('\nfunction ',start+marker.length);
 return code.slice(start,next<0?undefined:next);
}
test('all high-risk legacy stock/money editors inspect unresolved purchase/refund journals',()=>{
 for(const [file,names] of Object.entries(targets))for(const name of names){
  const fn=body(file,name);
  assert.match(fn,/assertNoUncertainTransactionWrites_\(\)/,file+': '+name);
 }
});
test('journal quarantine occurs after authorization and before the first business write',()=>{
 for(const [file,names] of Object.entries(targets))for(const name of names){
  const fn=body(file,name);
  const perm=fn.search(/require(?:Delete)?Permission_\(/),
   gate=fn.indexOf('assertNoUncertainTransactionWrites_()'),
   firstWrite=fn.search(/\b(?:appendRow_|appendRows_|updateRowFields_|markRowDeleted_|adjustProductStock_|addCashBookEntry_|addBankBookEntry_)\(/);
  assert.ok(perm>=0,file+': '+name+' must authorize');
  assert.ok(gate>perm,file+': '+name+' must gate after authorization');
  assert.ok(firstWrite<0||gate<firstWrite,file+': '+name+' must gate before business write');
 }
});
test('linked purchase and sale invoice deletions cannot remove financial cost source',()=>{
 assert.match(body('DeleteEngine.gs','deletePurchase'),/assertSourceLinkedPurchaseNotModified_\(purchaseId\)/);
 assert.match(body('DeleteEngine.gs','deleteSalesInvoice'),/assertSourceLinkedSaleNotDeleted_\(invoiceId\)/);
});
