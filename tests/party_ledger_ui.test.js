'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert'); const root=path.resolve(__dirname,'..'); const read=n=>fs.readFileSync(path.join(root,n),'utf8'); let pass=0,fail=0; function test(n,f){try{f();pass++;console.log('PASS',n)}catch(e){fail++;console.error('FAIL',n);console.error(e.stack||e)}}
const ui=read('UI.gs'), index=read('index.html'), js=read('javascript.html'), cust=read('customers.html'), sup=read('suppliers.html'), cl=read('customerLedger.html'), sl=read('supplierLedger.html'), css=read('style.html');
test('navigation exposes Customer Ledger and Supplier Ledger under existing modules',()=>{assert.match(ui,/key: 'customerLedger'[\s\S]*permKey: 'customers'/);assert.match(ui,/key: 'supplierLedger'[\s\S]*permKey: 'suppliers'/);assert.match(index,/id="page-customerLedger"/);assert.match(index,/id="page-supplierLedger"/)});
test('existing lists are preserved and only party names gain ledger links',()=>{assert.match(cust,/data-customer-ledger-id/);assert.match(cust,/data-act="menu"/);assert.match(sup,/data-supplier-ledger-id/);assert.match(sup,/data-act="menu"/);assert.match(css,/\.party-ledger-link/)});
test('direct name click preselects party while direct navigation clears selection',()=>{assert.match(js,/openCustomerLedger_\(customerLink\.dataset\.customerLedgerId/);assert.match(js,/openSupplierLedger_\(supplierLink\.dataset\.supplierLedgerId/);assert.match(cl,/partyId = String\(pendingCustomerId \|\| ''\)/);assert.match(sl,/partyId = String\(pendingSupplierId \|\| ''\)/)});
test('both ledger pages default to 50 and support 50 100 200 with Previous Next',()=>{for(const h of [cl,sl]){assert.match(h,/<option value="50" selected>50<\/option>/);assert.match(h,/<option value="100">100<\/option>/);assert.match(h,/<option value="200">200<\/option>/);assert.match(h,/Previous/);assert.match(h,/Next/)}});
test('Customer Ledger reuses native payment edit delete and settlement fields',()=>{for(const s of ['receivePayment','getCustomerPaymentForEdit','updateCustomerPayment','deleteCustomerPayment'])assert.match(cl,new RegExp(s));assert.match(cl,/Discount Given/);assert.match(cl,/Settle Full Balance/)});
test('Supplier Ledger reuses native payment edit delete and settlement fields',()=>{for(const s of ['paySupplier','getSupplierPaymentForEdit','updateSupplierPayment','deleteSupplierPayment'])assert.match(sl,new RegExp(s));assert.match(sl,/Discount Received/);assert.match(sl,/Settle Full Balance/)});
test('transaction source actions route through native Sales Purchase Return and Opening Balance flows',()=>{for(const s of ['smOpenView_','smUpdateInvoice_','returnsLoadInvoiceById_','purOpenView_','purEdit_','prtLoadPurchaseById_','custOpenEdit_','supOpenEdit_'])assert.match(js,new RegExp(s));assert.doesNotMatch(js,/createLedgerSale|updateLedgerPurchase|postLedgerPayment/)});
test('date-range print is independent from visible page size',()=>{assert.match(cl,/getCustomerLedgerStatement/);assert.match(sl,/getSupplierLedgerStatement/);assert.match(js,/function partyLedgerPrintStatement_/);assert.match(js,/Opening Balance/);assert.match(js,/Closing Balance/)});
test('mobile ledger renders as cards without normal horizontal overflow',()=>{assert.match(cl,/mobile-card-table party-ledger-table/);assert.match(sl,/mobile-card-table party-ledger-table/);assert.match(css,/@media\s*\(max-width:\s*540px\)[\s\S]*\.party-ledger-table-scroll\s*\{\s*overflow:visible/)});
test('existing embedded customer/supplier detail ledgers remain present',()=>{assert.match(cust,/id="custDetailModal"/);assert.match(cust,/id="custLedgerBody"/);assert.match(sup,/id="supDetailModal"/);assert.match(sup,/id="supLedgerBody"/)});

test('clean view is default and privileged Show corrections toggle is wired on both ledgers',()=>{
  assert.match(cl,/id="customerLedgerCorrectionsToggle"/); assert.match(sl,/id="supplierLedgerCorrectionsToggle"/);
  assert.match(cl,/Show corrections/); assert.match(sl,/Show corrections/);
  assert.match(cl,/showCorrections:\s*false/); assert.match(sl,/showCorrections:\s*false/);
  assert.match(cl,/canViewCorrections:\s*false/); assert.match(sl,/canViewCorrections:\s*false/);
  assert.match(cl,/getCustomerLedgerPage[\s\S]{0,220}showCorrections/); assert.match(sl,/getSupplierLedgerPage[\s\S]{0,220}showCorrections/);
  assert.match(cl,/getCustomerLedgerWorkspaceBootstrap[\s\S]{0,220}showCorrections/); assert.match(sl,/getSupplierLedgerWorkspaceBootstrap[\s\S]{0,220}showCorrections/);
});
test('party change resets corrections to clean and print RPC never passes correction mode',()=>{
  assert.match(cl,/customerLedgerSelectParty_[\s\S]{0,260}showCorrections\s*=\s*false/);
  assert.match(sl,/supplierLedgerSelectParty_[\s\S]{0,260}showCorrections\s*=\s*false/);
  assert.doesNotMatch(cl,/getCustomerLedgerStatement[^\n]*showCorrections/);
  assert.doesNotMatch(sl,/getSupplierLedgerStatement[^\n]*showCorrections/);
});
console.log(`\n${pass}/${pass+fail} passed`);if(fail)process.exit(1);
