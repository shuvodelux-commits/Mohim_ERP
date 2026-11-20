'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),source=fs.readFileSync(path.join(root,'FundedReturnJournal.gs'),'utf8');
function harness(missing=[],overrides={}){
 const c={console,Date,JSON,Number,Math};vm.createContext(c);
 vm.runInContext(fs.readFileSync(path.join(root,'Config.gs'),'utf8'),c);
 const headers={},sheets={};
 for(const name of ['STOCK_LOT_SETTLEMENT_REVERSALS','FUNDED_RETURN_JOURNAL']){
  const cols=vm.runInContext('CONFIG.HEADERS.'+name,c);
  const title=vm.runInContext('CONFIG.SHEETS.'+name,c);
  headers[name]=cols;
  if(!missing.includes(name)) sheets[title]=(overrides[name]||cols).slice();
 }
 let writes=0;
 c.getSpreadsheet_=()=>({getSheetByName:name=>sheets[name]?{
  getLastColumn:()=>sheets[name].length,
  getRange:()=>({getValues:()=>[sheets[name].slice()]})
 }:null});
 c.getSheet_=()=>{writes++;throw Error('read-only preflight must not create Sheets');};
 c.appendRow_=()=>{writes++;throw Error('no writes')};
 c.updateRowFields_=()=>{writes++;throw Error('no writes')};
 vm.runInContext(source,c);
 return {c,writes:()=>writes};
}
test('Config explicitly declares both dedicated return audit Sheets and their immutable columns',()=>{
 const c=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(root,'Config.gs'),'utf8'),c);
 for(const key of ['STOCK_LOT_SETTLEMENT_REVERSALS','FUNDED_RETURN_JOURNAL']){
  const conf=vm.runInContext('CONFIG.SHEETS.'+key,c);
  const headers=vm.runInContext('CONFIG.HEADERS.'+key,c);
  const prefix=vm.runInContext('CONFIG.ID_PREFIX.'+key,c);
  assert.ok(conf);assert.ok(prefix);assert.ok(headers.length>9);
 }
});
test('preflight reads both existing audited schemas with no mutation',()=>{
 const x=harness(),r=x.c.fundedSaleReturnSchemaReady_();
 assert.equal(r.ready,true);assert.equal(x.writes(),0);
});
test('missing either journal blocks before the first customer refund mutation',()=>{
 for(const key of ['STOCK_LOT_SETTLEMENT_REVERSALS','FUNDED_RETURN_JOURNAL']){
  const x=harness([key]),r=x.c.fundedSaleReturnSchemaReady_();
  assert.equal(r.ready,false);assert.match(r.reason,/missing|setup/i);
  assert.equal(x.writes(),0);
 }
});
test('truncated or duplicate audit columns block without self-healing',()=>{
 const x=harness([],{FUNDED_RETURN_JOURNAL:['Operation ID','Return ID']});
 assert.equal(x.c.fundedSaleReturnSchemaReady_().ready,false);
 const y=harness([],{STOCK_LOT_SETTLEMENT_REVERSALS:['Reversal ID','Reversal ID','Settlement ID']});
 assert.equal(y.c.fundedSaleReturnSchemaReady_().ready,false);
 assert.equal(x.writes()+y.writes(),0);
});
test('released return writer flag is FALSE in source even if tenant setting is true',()=>{
 const c=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(root,'Config.gs'),'utf8'),c);
 assert.equal(vm.runInContext('CONFIG.FUNDED_RETURN_WRITER_RELEASE_APPROVED',c),false);
 assert.equal(vm.runInContext('CONFIG.PURCHASE_SETTLEMENT_WRITER_RELEASE_APPROVED',c),false);
});

test('future immutable reversal/journal writes must invalidate cached profit reports',()=>{
 const src=fs.readFileSync(path.join(root,'Database.gs'),'utf8');
 assert.match(src,/STOCK_LOT_SETTLEMENT_REVERSALS:true/);
 assert.match(src,/FUNDED_RETURN_JOURNAL:true/);
});
