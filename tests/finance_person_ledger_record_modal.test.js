'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=n=>fs.readFileSync(path.join(__dirname,'..',n),'utf8');
const page=read('financePersonLedger.html'),finance=read('finance.html'),ledger=read('financeLedger.html'),index=read('index.html');
test('record modal moves existing Finance form, not a second posting form',()=>{
 assert.match(finance,/id="finEntryFormCard"/);
 assert.match(finance,/id="finEntryFormHome"/);
 assert.match(page,/finEntryFormCard/);
 assert.match(page,/fplRecordFormSlot/);
 assert.match(page,/finPersonLedgerRecordOpen_\(/);
 assert.match(page,/finPersonLedgerCloseRecord_\(/);
 assert.equal((page.match(/id="finAmount"/g)||[]).length,0);
 assert.equal((page.match(/serverCall\('addFinanceTransaction'/g)||[]).length,0);
 assert.match(finance,/serverCall\('addFinanceTransaction'/);
});
test('entry confirmation and existing finance validation remain one route',()=>{
 assert.match(finance,/runConfirmedAction\(/);
 assert.match(finance,/banglaAmountInWords_/);
 assert.match(finance,/finBackdatedReason/);
 assert.match(finance,/finEntryAfterSave_\(/);
});
test('modals are visible from the independent Person Ledger route',()=>{
 assert.match(ledger,/id="finLedViewModal"/);
 assert.match(ledger,/id="finLedEditModal"/);
 assert.match(page,/document\.body\.appendChild\(modal\)/);
 assert.match(page,/finLedOpenView_/);
});
test('new entry from person ledger preselects current finance person and role',()=>{
 assert.match(page,/finRenderTypeOptions_/);
 assert.match(page,/finUpdateHint_/);
 assert.match(page,/finPerson/);
 assert.match(page,/transactionTypes/);
});

test('selected person and role are locked while posting in the Person Ledger modal',()=>{
 assert.match(page,/function finEntryRoleLock_\(/);
 assert.match(page,/t\.role !== role/);
 assert.match(page,/option\.disabled/);
 assert.match(page,/document\.getElementById\('finPerson'\)\.value\s*=\s*person\.id/);
 assert.match(read('style.html'),/#fplNewModal \.form-grid > div:has\(#finPerson\)/);
});
