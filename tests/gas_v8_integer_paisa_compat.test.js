'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const files=[
 ['StockLots.gs','stockLotsScaledPaisa_'],
 ['PurchaseSettlement.gs','purchaseSettlementScaledPaisa_'],
 ['PurchaseSettlementJournal.gs','purchaseJournalScaledPaisa_'],
 ['ProfitOversoldCosts.gs','profitScaledPaisa_'],
 ['OversoldSaleReturnSettlement.gs','returnScaledPaisa_']
];
for(const [filename,fn] of files){
 test(filename+' contains no unsupported BigInt tokens in GAS V8',()=>{
  const code=fs.readFileSync(path.join(root,filename),'utf8');
  assert.doesNotMatch(code,/\bBigInt\s*\(|\b\d+n\b/);
 });
 test(filename+' rounds six-decimal quantity times integer paisa exactly and rejects overflow',()=>{
  const c={console,Number,Math,JSON,Date,Object};vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(root,filename),'utf8'),c);
  assert.equal(typeof c[fn],'function');
  assert.equal(c[fn](229000000,6475,1000000),1482775);
  assert.equal(c[fn](10000,6475,1000000),65);
  assert.equal(c[fn](1000,325,1000000),0);
  assert.equal(c[fn](2000,325,1000000),1);
  assert.equal(c[fn](3000,325,1000000),1);
  assert.equal(c[fn](1000000000000,12500,1000000),12500000000);
  assert.equal(c[fn](Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER,1000000),null);
  assert.equal(c[fn](1,-1,1000000),null);
  assert.equal(c[fn](1,1,0),null);
 });
}
test('every server .gs file avoids BigInt syntax rejected by Apps Script V8',()=>{
 const files=fs.readdirSync(root).filter(x=>x.endsWith('.gs'));
 assert.ok(files.length>45,'All server files must be scanned');
 for(const f of files){
  assert.doesNotMatch(fs.readFileSync(path.join(root,f),'utf8'),/\bBigInt\s*\(|\b\d+n\b/,f);
 }
});
test('scaled cost agrees with exact reference math for deterministic fractional lots',()=>{
 const c={console,Number,Math,JSON,Date,Object};vm.createContext(c);
 vm.runInContext(fs.readFileSync(path.join(root,'StockLots.gs'),'utf8'),c);
 const f=c.stockLotsScaledPaisa_;
 for(let scale of [1,3,10,1000,1000000]) {
  for(let ticks of [0,1,2,3,5,7,11,123,999,1045,500000,229000000]){
   for(let cents of [0,1,2,7,33,68,325,6475,6800,12345]){
    const expected=Number((BigInt(ticks)*BigInt(cents)+BigInt(Math.floor(scale/2)))/BigInt(scale));
    assert.equal(f(ticks,cents,scale),expected,JSON.stringify({ticks,cents,scale}));
   }
  }
 }
});
