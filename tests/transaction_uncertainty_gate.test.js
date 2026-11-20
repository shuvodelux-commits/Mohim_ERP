'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','TransactionUncertaintyGuard.gs'),'utf8');
const paths=['Sales.gs','Purchase.gs','PurchaseReturn.gs','SalesReturn.gs','Expense.gs','BankBook.gs','FinanceModule.gs','Customer.gs','Suppliers.gs','PurchaseManagement.gs'];
function fixture(){
 const tables={
   'Purchase Settlement Journal':[['Operation ID','Purchase ID','State','Last Completed Stage','Result Receipt'],['OP-P1','PUR-1','Committed','Committed','PUR-1']],
   'Funded Return Journal':[['Operation ID','Return ID','State','Last Completed Stage','Result Receipt'],['OP-R1','SRT-1','Committed','Committed','SRT-1']]
 };
 let writes=0;
 const c={console,Date,JSON,Math,Number,CONFIG:{SHEETS:{PURCHASE_SETTLEMENT_JOURNAL:'Purchase Settlement Journal',FUNDED_RETURN_JOURNAL:'Funded Return Journal'},PURCHASE_SETTLEMENT_WRITER_RELEASE_APPROVED:false,FUNDED_RETURN_WRITER_RELEASE_APPROVED:false},getSpreadsheet_:()=>({getSheetByName:name=>tables[name]?{getLastColumn:()=>tables[name][0].length,getLastRow:()=>tables[name].length,getRange:(_r,_c,_nr,_nc)=>({getValues:()=>tables[name].map(row=>row.slice())})}:null}),getSheet_:()=>{writes++;throw Error('no sheet creation')},appendRow_:()=>{writes++;throw Error('no writes')}};
 vm.createContext(c);vm.runInContext(source,c);return {c,tables,writes:()=>writes};
}
test('good committed receipt journals permit normal posts with no writes',()=>{
 const x=fixture(),r=x.c.inspectTransactionUncertainty_();assert.equal(r.safe,true);assert.equal(x.writes(),0);assert.doesNotThrow(()=>x.c.assertNoUncertainTransactionWrites_());
});
test('Writing or Needs Review purchase blocks all writes before stock/money',()=>{
 for(const state of ['Writing','Needs Review','Unknown']){
  const x=fixture();x.tables['Purchase Settlement Journal'][1][2]=state;
  assert.equal(x.c.inspectTransactionUncertainty_().safe,false);assert.throws(()=>x.c.assertNoUncertainTransactionWrites_(),/needs review/i);assert.equal(x.writes(),0);
 }
});
test('Writing or Needs Review funded return similarly blocks POS/Purchase/Cash',()=>{
 for(const state of ['Writing','Needs Review']){const x=fixture();x.tables['Funded Return Journal'][1][2]=state;
  assert.equal(x.c.inspectTransactionUncertainty_().safe,false);assert.throws(()=>x.c.assertNoUncertainTransactionWrites_(),/needs review/i);}
});
test('malformed Committed receipt and duplicate operation ID fail closed',()=>{
 const x=fixture();x.tables['Purchase Settlement Journal'][1][4]='PUR-OTHER';assert.equal(x.c.inspectTransactionUncertainty_().safe,false);
 const y=fixture();y.tables['Funded Return Journal'].push([...y.tables['Funded Return Journal'][1]]);assert.equal(y.c.inspectTransactionUncertainty_().safe,false);
});
test('missing optional legacy journal Sheets do not mutate workbook or block old ERP',()=>{
 const x=fixture();delete x.tables['Purchase Settlement Journal'];delete x.tables['Funded Return Journal'];assert.equal(x.c.inspectTransactionUncertainty_().safe,true);assert.equal(x.writes(),0);
});
test('released writer with missing corresponding journal fails closed rather than creating it',()=>{
 const x=fixture();delete x.tables['Purchase Settlement Journal'];x.c.CONFIG.PURCHASE_SETTLEMENT_WRITER_RELEASE_APPROVED=true;assert.equal(x.c.inspectTransactionUncertainty_().safe,false);
 const y=fixture();delete y.tables['Funded Return Journal'];y.c.CONFIG.FUNDED_RETURN_WRITER_RELEASE_APPROVED=true;assert.equal(y.c.inspectTransactionUncertainty_().safe,false);
});
test('missing required journal header, duplicate or blank operation fails closed',()=>{
 const x=fixture();x.tables['Funded Return Journal'][0][2]='Unknown';assert.equal(x.c.inspectTransactionUncertainty_().safe,false);
 const y=fixture();y.tables['Purchase Settlement Journal'][1][0]='';assert.equal(y.c.inspectTransactionUncertainty_().safe,false);
});
test('every native money, stock or refund public handler invokes the server-side gate',()=>{
 const all=paths.map(file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8'));
 for(let i=0;i<all.length;i++) assert.match(all[i],/assertNoUncertainTransactionWrites_\(/,paths[i]);
});
test('purchase-return/edit cannot change a purchase lot already funding an oversold sale',()=>{
 const x=fixture();x.tables['Stock Lot Settlements']=[['Purchase ID','Settlement ID'],['PUR-1','STL-1']];
 x.c.CONFIG.SHEETS.STOCK_LOT_SETTLEMENTS='Stock Lot Settlements';
 assert.throws(()=>x.c.assertSourceLinkedPurchaseNotModified_('PUR-1'),/linked|Needs Review/i);
 assert.doesNotThrow(()=>x.c.assertSourceLinkedPurchaseNotModified_('PUR-NO-FUNDING'));
});
test('Sales Return edit/delete cannot undo a committed funded-sale reversal',()=>{
 const x=fixture();x.tables['Stock Lot Settlement Reversals']=[['Return ID','Reversal ID'],['SRT-9','SRV-1']];
 x.c.CONFIG.SHEETS.STOCK_LOT_SETTLEMENT_REVERSALS='Stock Lot Settlement Reversals';
 assert.throws(()=>x.c.assertSourceLinkedReturnNotCorrected_('SRT-9'),/linked|Needs Review/i);
 assert.doesNotThrow(()=>x.c.assertSourceLinkedReturnNotCorrected_('SRT-10'));
});
test('missing source sheet cannot be created during read-only correction preflight',()=>{
 const x=fixture();x.c.CONFIG.SHEETS.STOCK_LOT_SETTLEMENT_REVERSALS='Stock Lot Settlement Reversals';
 assert.doesNotThrow(()=>x.c.assertSourceLinkedReturnNotCorrected_('SRT-10'));
 assert.equal(x.writes(),0);
});
test('cash sessions, sale edits and inventory cost corrections are guarded too',()=>{
 for(const filename of ['CashSession.gs','SalesManagement.gs','StockLots.gs']){
  const text=fs.readFileSync(path.join(__dirname,'..',filename),'utf8');
  assert.match(text,/assertNoUncertainTransactionWrites_\(/,filename);
 }
});
