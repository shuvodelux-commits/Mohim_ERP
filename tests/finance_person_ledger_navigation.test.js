'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const nav=read('UI.gs'),html=read('index.html'),ledger=read('financeLedger.html'),js=read('javascript.html'),person=read('financePersonLedger.html');
test('Finance has independent three-tab navigation with finance permission',()=>{
 const match=nav.match(/key:\s*'finance',\s*label:\s*'Business Finance'[\s\S]+?children:\s*\[([\s\S]*?)\]/);
 assert.ok(match,'Finance NAV group exists');
 const children=match[1];
 for(const key of ['finance','financeLedger','financePersonLedger'])assert.match(children,new RegExp("key:\\s*'"+key+"'"));
 assert.match(children,/key:\s*'financePersonLedger'[^\n]*permKey:\s*'finance'/);
 assert.ok(children.indexOf("key: 'financePersonLedger'") < children.indexOf("key: 'financeLedger'"), 'approved Person Ledger middle tab order');
});
test('Person Ledger owns separate page and reload registration',()=>{
 assert.match(html,/<section class="page" id="page-financePersonLedger" data-page="financePersonLedger" hidden>/);
 assert.match(html,/<\?!= include\('financePersonLedger'\); \?>/);
 assert.match(js,/financePersonLedger:\s*'financePersonLedgerLoad'/);
 assert.match(js,/key === 'financePersonLedger' && typeof financePersonLedgerLoad === 'function'/);
 assert.match(person,/function financePersonLedgerLoad\(/);
});
test('original Finance Ledger has no second mode-tab switch or person workspace',()=>{
 assert.doesNotMatch(ledger,/id="finLedAllModeBtn"|id="finLedPersonModeBtn"|id="finLedPersonView"/);
 assert.match(ledger,/id="finLedTableBody"/);
 assert.match(ledger,/function finLedOpenView_\(/);
 assert.match(ledger,/function finLedOpenEdit_\(/);
 assert.match(ledger,/function finLedDelete_\(/);
});
