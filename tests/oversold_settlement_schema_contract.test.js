'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
function config(){
 const ctx=vm.createContext({});
 vm.runInContext(fs.readFileSync(path.join(root,'Config.gs'),'utf8'),ctx);
 return vm.runInContext('CONFIG',ctx);
}
test('TDD: append-only original sale + purchase + cost allocation evidence gets a dedicated source sheet',()=>{
 const c=config();
 assert.equal(c.SHEETS.STOCK_LOT_SETTLEMENTS,'Stock Lot Settlements');
 const headers=c.HEADERS.STOCK_LOT_SETTLEMENTS;
 assert.equal(headers[0],'Settlement ID');
 for(const field of ['Operation ID','Product ID','Purchase ID','Purchase Lot ID','Oversold Lot ID',
   'Source Invoice ID','Source Sale Product ID','Quantity Ticks','Quantity Scale',
   'Provisional Unit Cost Minor','Actual Unit Cost Minor','Provisional COGS Minor',
   'Actual COGS Minor','Favorable Variance Minor','State','Created At','Actor']){
   assert.ok(headers.includes(field),field);
 }
 assert.equal(new Set(headers).size,headers.length);
 assert.ok(c.ID_PREFIX.STOCK_LOT_SETTLEMENTS);
});
test('TDD: separate purchase write-status journal supports nonreplayable interrupted operations',()=>{
 const c=config();
 assert.equal(c.SHEETS.PURCHASE_SETTLEMENT_JOURNAL,'Purchase Settlement Journal');
 const headers=c.HEADERS.PURCHASE_SETTLEMENT_JOURNAL;
 assert.equal(headers[0],'Operation ID');
 for(const field of ['Purchase ID','Product ID','Intent Fingerprint','State','Last Completed Stage',
   'Result Receipt','Actor','Created At','Updated At','Error']){
   assert.ok(headers.includes(field),field);
 }
 assert.equal(new Set(headers).size,headers.length);
});
test('TDD: generic setup creates all declared sheets and can self-heal additive headers',()=>{
 const setup=fs.readFileSync(path.join(root,'Setup.gs'),'utf8');
 const db=fs.readFileSync(path.join(root,'Database.gs'),'utf8');
 assert.match(setup,/Object\.keys\(CONFIG\.SHEETS\)\.forEach/);
 assert.match(db,/const missing = configHeaders\.filter/);
});
