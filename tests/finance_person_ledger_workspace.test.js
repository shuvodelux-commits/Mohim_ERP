'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const ui=read('financePersonLedger.html'),server=read('FinanceModule.gs'),style=read('style.html');
test('bootstrap adds per-person finance balance map from existing signed calculator',()=>{
 assert.match(server,/personBalances\s*:\s*financePersonBalancesForUI_\(/);
 assert.match(server,/function financePersonBalancesForUI_\(/);
 assert.match(server,/financeSignedBalances_\(/);
 assert.match(server,/financePersonNameAliasMap_\(/);
});
test('finance people only: searchable name and phone, role filters and per-account balances',()=>{
 for(const id of ['fplSearch','fplRoleFilters','fplPeopleList','fplPeoplePanel','fplDetailPanel','fplSelectedName','fplCurrentBalance','fplRoleChips'])assert.ok(ui.includes('id="'+id+'"'),id);
 assert.match(ui,/Owner/);assert.match(ui,/Lender/);assert.match(ui,/Borrower/);
 assert.match(ui,/personBalances/);assert.match(ui,/person\.id/);
});
test('ledger display is 2 panes, with a full-width mobile detail and back action',()=>{
 assert.match(style,/\.finance-person-workspace\s*\{/);
 assert.match(style,/#page-financePersonLedger/);
 assert.match(ui,/id="fplBackPeople"/);
});
test('record transaction and view details open modals, not navigate to Business Finance',()=>{
 assert.match(ui,/id="fplRecordBtn"/);
 assert.match(ui,/id="fplTransactionBody"/);
 assert.match(ui,/id="fplNewModal"/);
 assert.match(ui,/finPersonLedgerRecordOpen_\(/);
 assert.doesNotMatch(ui,/goToPage\('finance'\)/);
});
test('record and view use same Finance monetary APIs',()=>{
 assert.match(ui,/addFinanceTransaction|finSaveBtn/);
 assert.match(ui,/finLedOpenView_|finPersonLedgerView_/);
 assert.match(ui,/finLedOpenEdit_|finPersonLedgerEdit_/);
});

test('search supports Enter and keyboard arrow selection on the finance-only list',()=>{
 assert.match(ui,/getElementById\('fplSearch'\)\.addEventListener\('keydown'/);
 assert.match(ui,/key==='ArrowDown'/);
 assert.match(ui,/key==='Enter'/);
 assert.match(ui,/getElementById\('fplPeopleList'\)\.addEventListener\('keydown'/);
});
