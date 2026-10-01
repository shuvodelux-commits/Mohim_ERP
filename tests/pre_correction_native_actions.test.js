'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..');
const read=n=>fs.readFileSync(path.join(root,n),'utf8');
const exists=n=>fs.existsSync(path.join(root,n));
let pass=0,fail=0;function test(n,f){try{f();pass++;console.log('PASS',n)}catch(e){fail++;console.error('FAIL',n);console.error(e.stack||e)}}

test('Correction Center subsystem is absent from production surface',()=>{
  for(const f of ['CorrectionCenter.gs','CorrectionAdapters.gs','CorrectionFinancialAdapters.gs','CorrectionCancellation.gs','CorrectionReturnAdapters.gs','CorrectionBankTransfer.gs','correctionCenter.html']) assert.ok(!exists(f),f+' must be removed');
  assert.doesNotMatch(read('UI.gs'),/correctionCenter|transactionCorrection/i);
  assert.doesNotMatch(read('index.html'),/correctionCenter|correctionConfirmModal/i);
  assert.doesNotMatch(read('javascript.html'),/startAuditedCorrection_|startAuditedCancellation_|getCorrectionTransactionForEdit|openCorrectionHistory_/);
});

test('Sales Edit loads native sale update state into POS and Delete uses native delete router',()=>{
  const s=read('sales.html'), p=read('pos.html');
  assert.match(s,/function\s+smUpdateInvoice_\s*\([\s\S]{0,700}getSaleForUpdate/);
  assert.match(s,/posLoadUpdateInvoice_\([^,]+,\s*reason,\s*['"]legacy['"]\)/);
  assert.doesNotMatch(s,/getCorrectionTransactionForEdit|startAuditedCancellation_|transactionCorrection/);
  assert.match(s,/action:\s*['"]delete['"]/);
  assert.match(s,/deleteDayBookEntry/);
  assert.match(p,/serverCall\(['"]updateSale['"]/);
  assert.doesNotMatch(p,/startAuditedCorrection_/);
});

test('Purchase and Expense restore native Edit/Delete handlers',()=>{
  const pur=read('purchase.html'), exp=read('expenseList.html');
  assert.match(pur,/getPurchaseForUpdate/);
  assert.match(pur,/serverCall\(['"]updatePurchase['"]/);
  assert.match(pur,/action:\s*['"]delete['"]/);
  assert.doesNotMatch(pur,/getCorrectionTransactionForEdit|startAuditedCorrection_|startAuditedCancellation_|transactionCorrection/);
  assert.match(exp,/serverCall\(['"]updateExpense['"]/);
  assert.match(exp,/action:\s*['"]delete['"]/);
  assert.match(exp,/deleteDayBookEntry|deleteExpense/);
  assert.doesNotMatch(exp,/startAuditedCorrection_|startAuditedCancellation_|transactionCorrection/);
});

test('Customer and Supplier payment rows use native Edit/Delete including settlement discount fields',()=>{
  const c=read('customers.html'), s=read('suppliers.html');
  assert.match(c,/getCustomerPaymentForEdit/); assert.match(c,/serverCall\(['"]updateCustomerPayment['"]/); assert.match(c,/deleteCustomerPayment/);
  assert.match(s,/getSupplierPaymentForEdit/); assert.match(s,/serverCall\(['"]updateSupplierPayment['"]/); assert.match(s,/deleteSupplierPayment/);
  for(const h of [c,s]){assert.match(h,/Discount Amount|discountAmount/);assert.doesNotMatch(h,/getCorrectionTransactionForEdit|startAuditedCorrection_|startAuditedCancellation_|transactionCorrection/)}
});

test('Daybook Delete remains direct owner-module dispatch',()=>{
  const d=read('daybook.html'), e=read('DeleteEngine.gs');
  assert.match(d,/fn:\s*['"]deleteDayBookEntry['"]/);
  assert.match(e,/function\s+deleteDayBookEntry\s*\(/);
  assert.match(e,/return\s+deleteCustomerPayment\(token,\s*recordId,\s*reason\)/);
  assert.match(e,/return\s+deleteSalesInvoice\(token,\s*recordId,\s*reason\)/);
});

test('Native server paths do not require the removed correction subsystem',()=>{
  const gs=fs.readdirSync(root).filter(f=>f.endsWith('.gs')&&!f.startsWith('Correction'));
  const prod=gs.map(read).join('\n');
  assert.doesNotMatch(prod,/\bcorrectionPaymentAccount_\b|\bcurrentRevisionNo_\b/);
  assert.doesNotMatch(prod,/correctionMode\s*:\s*true/);
  assert.match(read('DeleteEngine.gs'),/function\s+paymentAccountForReference_\s*\(/);
  assert.match(read('DeleteEngine.gs'),/function\s+updateCustomerPayment\s*\([\s\S]{0,250}lockHeld:\s*false/);
  assert.match(read('DeleteEngine.gs'),/function\s+updateSupplierPayment\s*\([\s\S]{0,250}lockHeld:\s*false/);
});



test('Vendor and Finance use native edit/delete handlers with no correction UI',()=>{
  const v=read('vendors.html'), f=read('financeLedger.html');
  for(const name of ['getVendorPaymentForEdit','updateVendorPayment','deleteVendorPayment','getVendorReturnForEdit','updateVendorReturn','deleteVendorReturn','getVendorSourcingForEdit','updateVendorSourcing','deleteVendorSourcing','getVendorIssueForEdit','updateVendorIssue','deleteVendorIssue','getVendorReceiptForEdit','updateVendorReceipt','deleteVendorReceipt','getVendorReturnReceivedForEdit','updateVendorReturnReceived','deleteVendorReturnReceived']) assert.match(v,new RegExp(name));
  assert.doesNotMatch(v,/getCorrectionTransactionForEdit|startAuditedCorrection_|startAuditedCancellation_|openCorrectionHistory_|vendorCorrectionEntityType_/);
  assert.match(f,/getFinanceTransactionForEdit/); assert.match(f,/serverCall\(['"]updateFinanceTransaction['"]/); assert.match(f,/deleteFinanceTransaction/);
  assert.doesNotMatch(f,/getCorrectionTransactionForEdit|startAuditedCorrection_|startAuditedCancellation_|openCorrectionHistory_/);
});

test('Bank transfers and return histories expose no correction workflow',()=>{
  const b=read('bank.html'), r=read('returns.html'), rh=read('returnHistory.html'), p=read('purchase.html');
  for(const h of [b,r,rh,p]) assert.doesNotMatch(h,/getCorrectionTransactionForEdit|startAuditedCorrection_|startAuditedCancellation_|openCorrectionHistory_|transactionCorrection/);
  assert.match(b,/transferBetweenBankAccounts/);
  assert.match(r,/completeReturn/);
  assert.match(rh,/rhOpenDetailById_/);
});



test('Correction Center setup schema and shared confirmation remnants are removed',()=>{
  const cfg=read('Config.gs'), idx=read('index.html'), bank=read('bank.html'), pos=read('pos.html'), pur=read('purchase.html'), js=read('javascript.html');
  for(const token of ['TRANSACTION_REVISIONS','TRANSACTION_REVISION_DETAILS','TRANSACTION_INDEX','CORRECTION_JOBS','REVISION_ARCHIVE_ROW_THRESHOLD']) assert.doesNotMatch(cfg,new RegExp(token));
  assert.doesNotMatch(cfg,/Last Correction Job ID|Corrected At|Correction Job ID|Correction At|Historical Correction Difference|Last Correction Revision ID|Last Historical Correction At/);
  assert.doesNotMatch(idx,/corrShared|AuditedCorrection|Confirm\s*&amp;\s*Save/);
  assert.doesNotMatch(bank,/How corrections work|correction journal rows|records the correction in history/i);
  assert.doesNotMatch(pos,/updateMode\s*!==\s*['"]correction['"]|updateMode\s*===\s*['"]correction['"]|mode\s*\|\|\s*['"]legacy['"]/);
  assert.doesNotMatch(pur,/mode\s*!==\s*['"]correction['"]|updateMode\s*===\s*['"]correction['"]/);
  assert.doesNotMatch(js,/inv\.isCorrected|Revision\s*['"]?\s*\+/);
  for(const doc of ['AGENTS.md','PROJECT.md']) assert.doesNotMatch(read(doc),/Correction Center|Correction History|Transaction Correction|TRANSACTION_REVISIONS|CORRECTION_JOBS|TRANSACTION_INDEX/);
  for(const f of ['docs/superpowers/specs/2026-09-02-correction-center-design.md','docs/superpowers/specs/2026-09-03-in-context-correction-ux-design.md','docs/superpowers/plans/2026-09-02-correction-center-implementation.md','docs/superpowers/plans/2026-09-03-in-context-correction-ux.md']) assert.ok(!exists(f),f+' must be removed from the active project documentation');
  assert.doesNotMatch(read('CashSession.gs'),/historicalCashCorrectionDeltaForDate_|recordHistoricalCashSessionCorrection_|Correction Job ID/);
  assert.doesNotMatch(read('CashBook.gs'),/CorrectionJobId|CorrectionAt|Correction Job ID/);
  assert.doesNotMatch(read('BankBook.gs'),/CorrectionJobId|CorrectionAt|Correction Job ID/);
  for(const f of ['SalesManagement.gs','PurchaseManagement.gs','Expense.gs','DeleteEngine.gs']) {
    const src=read(f);
    assert.doesNotMatch(src,/\bcorrectionMode\b|resolveCorrectionBusinessDate_|postCorrectionMoneyEffects_|validateSaleCorrectionChronology_|validatePurchaseCorrectionChronology_|appendVendorCorrectionLedgerEffects_|CorrectionJobId|CorrectionAt/);
  }
});

console.log(`\n${pass}/${pass+fail} passed`);if(fail)process.exit(1);
