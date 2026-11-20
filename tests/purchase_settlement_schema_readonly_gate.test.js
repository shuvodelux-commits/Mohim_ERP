'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..');
function harness(missing=[],custom={}){
 const sheets={
  'Purchase Settlement Journal':['Operation ID','Purchase ID','Product ID','Intent Fingerprint','State',
   'Last Completed Stage','Result Receipt','Actor','Created At','Updated At','Error'],
  'Stock Lot Settlements':['Settlement ID','Operation ID','Product ID','Purchase ID','Purchase Lot ID',
   'Oversold Lot ID','Source Invoice ID','Source Sale Product ID','Quantity Ticks','Quantity Scale',
   'Provisional Unit Cost Minor','Actual Unit Cost Minor','Provisional COGS Minor','Actual COGS Minor',
   'Favorable Variance Minor','State','Created At','Actor']
 };
 for(const name of missing)delete sheets[name];
 Object.assign(sheets,custom);
 let writes=0,reads=0;
 const ctx={console,Date,JSON,
   CONFIG:{SHEETS:{PURCHASE_SETTLEMENT_JOURNAL:'Purchase Settlement Journal',STOCK_LOT_SETTLEMENTS:'Stock Lot Settlements'},
    HEADERS:{PURCHASE_SETTLEMENT_JOURNAL:['Operation ID','Purchase ID','Product ID','Intent Fingerprint','State',
      'Last Completed Stage','Result Receipt','Actor','Created At','Updated At','Error'],
      STOCK_LOT_SETTLEMENTS:['Settlement ID','Operation ID','Product ID','Purchase ID','Purchase Lot ID',
        'Oversold Lot ID','Source Invoice ID','Source Sale Product ID','Quantity Ticks','Quantity Scale',
        'Provisional Unit Cost Minor','Actual Unit Cost Minor','Provisional COGS Minor','Actual COGS Minor',
        'Favorable Variance Minor','State','Created At','Actor']}},
   getSpreadsheet_:()=>({getSheetByName:name=>{
     if(!sheets[name])return null;
     return {getLastColumn:()=>sheets[name].length,
       getRange:()=>({getValues:()=>{reads++;return [sheets[name].slice()]},
         setValues:()=>{writes++}})};
   }}),
   getSheet_:()=>{writes++;throw Error('NO implicit sheet creation in preflight')},
   appendRow_:()=>{writes++;throw Error('NO writes')},
   updateRowFields_:()=>{writes++;throw Error('NO writes')}
 };
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(root,'PurchaseSettlementJournal.gs'),'utf8'),ctx);
 return {ctx,reads:()=>reads,writes:()=>writes};
}
test('prewrite schema gate reads existing exact headers without creating any sheet',()=>{
 const x=harness(),result=x.ctx.purchaseSettlementWriterSchemaReady_();
 assert.equal(result.ready,true);
 assert.equal(x.reads(),2);
 assert.equal(x.writes(),0);
});
test('missing setup sheet blocks before the first financial mutation',()=>{
 for(const name of ['Purchase Settlement Journal','Stock Lot Settlements']){
   const x=harness([name]);const result=x.ctx.purchaseSettlementWriterSchemaReady_();
   assert.equal(result.ready,false);
   assert.match(result.reason,/setup|missing|schema/i);
   assert.equal(x.writes(),0);
 }
});
test('required missing header blocks; this gate must not silently append it',()=>{
 const x=harness([],{ 'Purchase Settlement Journal':['Operation ID','Purchase ID'] });
 const result=x.ctx.purchaseSettlementWriterSchemaReady_();
 assert.equal(result.ready,false);
 assert.equal(x.writes(),0);
});
test('duplicate existing columns block ambiguous journal identity',()=>{
 const x=harness([],{ 'Purchase Settlement Journal':['Operation ID','Operation ID','Purchase ID'] });
 const result=x.ctx.purchaseSettlementWriterSchemaReady_();
 assert.equal(result.ready,false);
 assert.equal(x.writes(),0);
});
