'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=n=>fs.readFileSync(path.join(__dirname,'..',n),'utf8');
const ledger=read('financeLedger.html'),person=read('financePersonLedger.html'),finance=read('finance.html');
test('View/Actions use selected person rows by Finance ID in independent route',()=>{
 assert.match(ledger,/function finLedRowForView_\(/);
 assert.match(ledger,/currentPage\s*===\s*'financePersonLedger'/);
 assert.match(ledger,/finPersonLedgerState\.rows/);
 assert.match(ledger,/function finLedOpenView_\(financeId\)/);
 assert.match(person,/function finPersonLedgerView_\(id\)/);
});
test('Edit/Delete retain existing accounting mutation RPC and refresh person ledger',()=>{
 assert.match(ledger,/serverCall\('updateFinanceTransaction'/);
 assert.match(ledger,/fn:'deleteFinanceTransaction'/);
 assert.match(ledger,/finPersonLedgerRefreshAfterMutation_\(/);
 assert.match(person,/function finPersonLedgerEdit_\(id\)/);
 assert.match(person,/finLedEnsureLoaded_\(/);
});
test('Finance posting still uses confirmation and one addFinanceTransaction call',()=>{
 assert.match(finance,/runConfirmedAction/);
 assert.equal((finance.match(/serverCall\('addFinanceTransaction'/g)||[]).length,1);
});

test('View then Edit bootstraps Finance metadata before existing edit form',()=>{
 assert.match(ledger,/function finLedOpenEdit_\(financeId\)\s*\{/);
 assert.match(ledger,/if \(!finLedState\._typesLoaded\) return finLedEnsureLoaded_\(\)/);
 assert.match(person,/finLedState\.currencySymbol=finPersonLedgerState\.currencySymbol/);
});

test('clicking the ledger row opens View modal, not just the particulars button',()=>{
 assert.match(person,/e\.target\.closest\('tr\[data-finance-id\]'\)/);
 assert.match(person,/finPersonLedgerView_\(row\.dataset\.financeId\)/);
});
