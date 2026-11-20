'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.join(__dirname,'..'),copy=x=>structuredClone(x);
function harness(){
 const tables={},seq={},writes={};let locked=false,failAt=null;
 const rows=key=>tables[key]||(tables[key]=[]);
 const c={console,Date,Math,Number,BigInt,JSON,Object,
  Utilities:{DigestAlgorithm:{SHA_256:'SHA_256'},computeDigest:(_algo,txt)=>[...crypto.createHash('sha256').update(txt).digest()].map(b=>b>127?b-256:b)},
  LockService:{getScriptLock:()=>({waitLock(){assert(!locked);locked=true},releaseLock(){locked=false}})},
  getAllRows_:key=>rows(key).map((r,i)=>({...copy(r),_rowIndex:i+2})),
  activeRows_:key=>c.getAllRows_(key),
  findRowIndex_:(key,col,id)=>{const i=rows(key).findIndex(r=>String(r[col])===String(id));return i<0?-1:i+2},
  appendRow_:(key,row)=>{
   assert(locked);writes[key]=(writes[key]||0)+1;
   if(failAt&&failAt.key===key&&failAt.kind==='append'&&!failAt.after){failAt=null;throw Error('failed before '+key)}
   rows(key).push(copy(row));
   if(failAt&&failAt.key===key&&failAt.kind==='append'){failAt=null;throw Error('failed after '+key)}
   return rows(key).length+1;
  },
  appendRows_:(key,arr)=>arr.forEach(row=>c.appendRow_(key,row)),
  updateRowFields_:(key,index,fields)=>{
   assert(locked);writes[key]=(writes[key]||0)+1;
   if(failAt&&failAt.key===key&&failAt.kind==='update'&&!failAt.after){failAt=null;throw Error('failed before '+key)}
   assert(rows(key)[index-2],'missing row');Object.assign(rows(key)[index-2],copy(fields));
   if(failAt&&failAt.key===key&&failAt.kind==='update'){failAt=null;throw Error('failed after '+key)}
  },
  isDeleted_:()=>false,requirePermission_:()=>({'User ID':'U1','Full Name':'Staff'}),
  requireActiveCashSession_:()=>true,assertNoUncertainTransactionWrites_:()=>true,
  getSettingsMap_:()=>({'Funded Oversold Return Enabled':'true'}),
  generateId_:key=>{seq[key]=(seq[key]||0)+1;return (key==='SALES_RETURN'?'SRT':key==='STOCK_MOVEMENT'?'SM':key==='STOCK_LOT_SETTLEMENT_REVERSALS'?'SRV':key)+'-'+String(seq[key]).padStart(6,'0')},
  roundMoney_:n=>Math.round((n+Number.EPSILON)*100)/100,
  isValidNonNegativeNumber_:v=>v!==null&&v!==''&&Number.isFinite(Number(v))&&Number(v)>=0,
  sanitizeInput_:v=>String(v==null?'':v).trim(),
  actorName_:u=>u['Full Name'],
  findUniqueSalesRow_:id=>c.getAllRows_('SALES').find(r=>r['Invoice ID']===id),
  resolveTransactionDate_:()=>({dateStr:'2026-11-20',isBackdated:false,backdatedDays:0,reason:''}),
  safeDateOnly_:v=>String(v).slice(0,10),
  effectiveTransactionUnitPrice_:(gross,subtotal,grand)=>gross*grand/subtotal,
  getSaleBundleSnapshot_:()=>({}),
  outstandingSaleOwnStockByProduct_:()=>({P1:229}),
  activeSalesReturnItems_:()=>c.getAllRows_('SALES_RETURN_ITEMS'),
  logError_:()=>{},ok_:data=>({success:true,data}),fail_:message=>({success:false,message}),
  getCashBalance_:()=>10000,
  getSpreadsheet_:()=>({getSheetByName:name=>{
    const config=vm.runInContext('CONFIG',c);
    const key=Object.keys(config.SHEETS).find(k=>config.SHEETS[k]===name);
    if(!key)return null;
    const hdr=config.HEADERS[key];if(!hdr)return null;
    return {getLastColumn:()=>hdr.length,getLastRow:()=>1+rows(key).length,
     getRange:()=>({getValues:()=>[hdr,...rows(key).map(r=>hdr.map(h=>r[h]??''))]})};
  }})
 };
 vm.createContext(c);
 for(const file of ['Config.gs','TransactionUncertaintyGuard.gs','FundedReturnJournal.gs','OversoldSaleReturnSettlement.gs','SalesReturn.gs','FundedReturnWriter.gs','ProfitOversoldCosts.gs']){
  vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),c,{filename:file});
 }
 // Real native preparation uses Cash/Return amount checks. Focused mocks only
 // abstract unrelated customer-settlement and invoice bootstrap reads.
 c.economicReturnLineAmount_=(r)=>Number(r['Line Total'])||0;
 c.addCashBookEntry_=fields=>c.appendRow_('CASH_BOOK',fields);
 tables.SALES=[{'Invoice ID':'INV-1','Customer ID':'CUS-1','Customer Name':'A','Customer Phone':'01700000000',
  Date:'2026-10-10',Subtotal:22900,'Grand Total':22900,'Paid Amount':22900,'Payment Detail Version':''}];
 tables.SALE_ITEMS=[{'Invoice ID':'INV-1','Product ID':'P1','Product Name':'Pipe',Quantity:229,
  'Unit Price':100,'Line Total':22900}];
 tables.PRODUCTS=[{'Product ID':'P1','Product Name':'Pipe','Current Stock':9,'Purchase Price':68}];
 tables.CUSTOMERS=[{'Customer ID':'CUS-1','Customer Name':'A','Current Due':0,Status:'Active'}];
 tables.SALE_ITEM_LOTS=[{'Invoice ID':'INV-1','Product ID':'P1','Source Sale Product ID':'P1',
  'Lot ID':'OV-1',Quantity:229,'Unit Cost':68}];
 tables.STOCK_LOTS=[{'Lot ID':'OV-1','Product ID':'P1','Purchase ID':'OVERSOLD',
   'Purchase Price':68,'Original Quantity':229,'Remaining Quantity':0,Status:'Consumed'},
   {'Lot ID':'NEW-1','Product ID':'P1','Purchase ID':'PUR-1','Purchase Price':64.75,
   'Original Quantity':240,'Remaining Quantity':9,Status:'Active'}];
 tables.PURCHASES=[{'Purchase ID':'PUR-1',Discount:0}];
 tables.PURCHASE_SETTLEMENT_JOURNAL=[{'Operation ID':'OP-PUR-1','Purchase ID':'PUR-1',
  State:'Committed','Last Completed Stage':'Committed','Result Receipt':'PUR-1'}];
 tables.STOCK_LOT_SETTLEMENTS=[{'Settlement ID':'STL-1','Operation ID':'OP-PUR-1','Purchase ID':'PUR-1',
  'Product ID':'P1','Purchase Lot ID':'NEW-1','Oversold Lot ID':'OV-1',
  'Source Invoice ID':'INV-1','Source Sale Product ID':'P1',
  'Quantity Ticks':229000000,'Quantity Scale':1000000,
  'Provisional Unit Cost Minor':6800,'Actual Unit Cost Minor':6475,
  'Provisional COGS Minor':1557200,'Actual COGS Minor':1482775,'Favorable Variance Minor':74425,
  State:'Committed'}];
 tables.CASH_BOOK=[{Reference:'OPEN',Type:'Session Open',Credit:10000,Debit:''}];
 const payload=(more={})=>({invoiceId:'INV-1',operationId:'RETURN-OP-20261120-0001',
  items:[{productId:'P1',qty:5,name:'Pipe',price:100}],refundMethod:'Cash',reason:'Return',notes:'',...more});
 return {c,tables,payload,writeCount:()=>Object.values(writes).reduce((a,b)=>a+b,0),
   fail:(key,kind='append',after=true)=>{failAt={key,kind,after}},
   enable:()=>vm.runInContext('CONFIG.FUNDED_RETURN_WRITER_RELEASE_APPROVED=true',c)};
}
test('funded return remains disabled by source flag and cannot post by Settings alone',()=>{
 const x=harness(),r=x.c.completeReturn('T',x.payload());assert.equal(r.success,false);assert.equal(x.tables.FUNDED_RETURN_JOURNAL?.length||0,0);
});
test('explicit opt-in one source-product return restores actual purchase lot, cash and journal exactly once',()=>{
 const x=harness();x.enable();const r=x.c.completeReturn('T',x.payload());assert.equal(r.success,true,r.message);
 assert.equal(x.tables.PRODUCTS[0]['Current Stock'],14);
 assert.equal(x.tables.SALE_ITEM_LOTS[0].Quantity,224);
 assert.equal(x.tables.STOCK_LOTS[1]['Remaining Quantity'],14);
 assert.equal(x.tables.SALES_RETURN.length,1);assert.equal(x.tables.SALES_RETURN_ITEMS.length,1);
 assert.equal(x.tables.STOCK_LOT_SETTLEMENT_REVERSALS.length,1);
 assert.equal(x.tables.STOCK_LOT_SETTLEMENT_REVERSALS[0]['Cogs Delta Reversal Minor'],1625);
 assert.equal(x.tables.FUNDED_RETURN_JOURNAL[0].State,'Committed');
 assert.equal(x.tables.CASH_BOOK.filter(r=>r.Type==='Sales Return').length,1);
});
test('a repeated funded operation cannot duplicate stock, cash or customer credit',()=>{
 const x=harness();x.enable();const r=x.c.completeReturn('T',x.payload());assert.equal(r.success,true,r.message);
 const count=x.writeCount();const retry=x.c.completeReturn('T',x.payload());
 assert.equal(retry.success,false);assert.equal(x.writeCount(),count);
});
test('a Sheets timeout after Cash debit leaves Needs Review and no second debit',()=>{
 const x=harness();x.enable();x.fail('CASH_BOOK','append',true);
 const r=x.c.completeReturn('T',x.payload());assert.equal(r.success,false);
 assert.equal(x.tables.FUNDED_RETURN_JOURNAL[0].State,'Needs Review');
 assert.equal(x.tables.CASH_BOOK.filter(r=>r.Type==='Sales Return').length,1);
 const before=x.writeCount();assert.equal(x.c.completeReturn('T',x.payload()).success,false);
 assert.equal(x.writeCount(),before);
});
test('an unknown return header or settlement-event append leaves no blind replay',()=>{
 for(const key of ['SALES_RETURN','STOCK_LOT_SETTLEMENT_REVERSALS']){
  const x=harness();x.enable();x.fail(key,'append',true);
  const r=x.c.completeReturn('T',x.payload());assert.equal(r.success,false);
  assert.equal(x.tables.FUNDED_RETURN_JOURNAL[0].State,'Needs Review');
  const before=x.writeCount();assert.equal(x.c.completeReturn('T',x.payload()).success,false);
  assert.equal(x.writeCount(),before);
 }
});
test('Store Credit settles exactly one signed customer balance and customer ledger',()=>{
 const x=harness();x.enable();const r=x.c.completeReturn('T',x.payload({refundMethod:'Store Credit'}));
 assert.equal(r.success,true,r.message);assert.equal(x.tables.CUSTOMERS[0]['Current Due'],-500);
 assert.equal(x.tables.CUSTOMER_LEDGER.length,1);assert.equal(x.tables.CASH_BOOK.length,1);
});
test('this source writer refuses unsupported split-payment and bundled return before any stock write',()=>{
 const x=harness();x.enable();x.tables.SALES[0]['Payment Detail Version']='1';
 const r=x.c.completeReturn('T',x.payload());assert.equal(r.success,false);
 assert.equal(x.tables.FUNDED_RETURN_JOURNAL?.length||0,0);
});
test('unknown Sheets commit after stock update, source lot, movement, or refund must be non-retryable',()=>{
 for(const [key,kind] of [['PRODUCTS','update'],['STOCK_LOTS','update'],['SALE_ITEM_LOTS','update'],
   ['SALES_RETURN_ITEMS','append'],['STOCK_MOVEMENT','append'],['FUNDED_RETURN_JOURNAL','update'],
   ['STOCK_LOT_SETTLEMENT_REVERSALS','update']]){
  const x=harness();x.enable();x.fail(key,kind,true);
  const result=x.c.completeReturn('T',x.payload());assert.equal(result.success,false,key);
  assert.equal(x.tables.FUNDED_RETURN_JOURNAL[0].State,'Needs Review',key);
  const counts=x.writeCount(),cash=x.tables.CASH_BOOK.filter(r=>r.Type==='Sales Return').length;
  assert.equal(x.c.completeReturn('T',x.payload()).success,false,key);
  assert.equal(x.writeCount(),counts,key);assert.equal(x.tables.CASH_BOOK.filter(r=>r.Type==='Sales Return').length,cash,key);
 }
});
test('journal reservation that persisted despite a timeout cannot be duplicated',()=>{
 const x=harness();x.enable();x.fail('FUNDED_RETURN_JOURNAL','append',true);
 assert.equal(x.c.completeReturn('T',x.payload()).success,false);
 assert.equal(x.tables.FUNDED_RETURN_JOURNAL.length,1);
 assert.equal(x.tables.SALES_RETURN?.length||0,0);
 const count=x.writeCount();assert.equal(x.c.completeReturn('T',x.payload()).success,false);assert.equal(x.writeCount(),count);
});
test('partly funded 229-foot sale returns 105: restore -100 debt first, then 5 to exact bought lot',()=>{
 const x=harness();x.enable();x.tables.STOCK_LOTS[0]['Remaining Quantity']=-100;
 x.tables.STOCK_LOTS[0].Status='Oversold';x.tables.STOCK_LOTS[1]['Original Quantity']=129;
 x.tables.STOCK_LOTS[1]['Remaining Quantity']=0;x.tables.STOCK_LOTS[1].Status='Consumed';
 x.tables.PRODUCTS[0]['Current Stock']=-100;
 x.tables.STOCK_LOT_SETTLEMENTS[0]['Quantity Ticks']=129000000;
 x.tables.STOCK_LOT_SETTLEMENTS[0]['Provisional COGS Minor']=129*6800;
 x.tables.STOCK_LOT_SETTLEMENTS[0]['Actual COGS Minor']=129*6475;
 x.tables.STOCK_LOT_SETTLEMENTS[0]['Favorable Variance Minor']=129*325;
 const result=x.c.completeReturn('T',x.payload({items:[{productId:'P1',qty:105,price:100}]}));
 assert.equal(result.success,true,result.message);
 assert.equal(x.tables.PRODUCTS[0]['Current Stock'],5);
 assert.equal(x.tables.SALE_ITEM_LOTS[0].Quantity,124);
 assert.equal(x.tables.STOCK_LOTS[0]['Remaining Quantity'],0);
 assert.equal(x.tables.STOCK_LOTS[1]['Remaining Quantity'],5);
 assert.equal(x.tables.STOCK_LOT_SETTLEMENT_REVERSALS[0]['Quantity Ticks'],5000000);
 assert.equal(x.tables.STOCK_MOVEMENT.reduce((n,m)=>n+Number(m['Quantity In']),0),105);
});
test('store-credit ledger unknown after append does not post a second customer credit',()=>{
 const x=harness();x.enable();x.fail('CUSTOMER_LEDGER','append',true);
 const result=x.c.completeReturn('T',x.payload({refundMethod:'Store Credit'}));
 assert.equal(result.success,false);assert.equal(x.tables.CUSTOMER_LEDGER.length,1);
 assert.equal(x.tables.CUSTOMERS[0]['Current Due'],-500);
 assert.equal(x.tables.FUNDED_RETURN_JOURNAL[0].State,'Needs Review');
 const n=x.writeCount();assert.equal(x.c.completeReturn('T',x.payload({refundMethod:'Store Credit'})).success,false);assert.equal(x.writeCount(),n);
});
test('same return operation with changed quantity or refund method never writes another transaction',()=>{
 const x=harness();x.enable();assert.equal(x.c.completeReturn('T',x.payload()).success,true);
 const n=x.writeCount();for(const change of [x.payload({items:[{productId:'P1',qty:4,price:100}]}),x.payload({refundMethod:'Store Credit'})]){
  assert.equal(x.c.completeReturn('T',change).success,false);
  assert.equal(x.writeCount(),n);
 }
});
test('the posted reversal immediately reconciles the original sale-period COGS overlay without source rewrite',()=>{
 const x=harness();x.enable();const r=x.c.completeReturn('T',x.payload());assert.equal(r.success,true,r.message);
 const overlay=x.c.computeCommittedOversoldCostOverlay_({
  saleItemLots:x.c.getAllRows_('SALE_ITEM_LOTS'),stockLots:x.c.getAllRows_('STOCK_LOTS'),
  settlements:x.c.getAllRows_('STOCK_LOT_SETTLEMENTS'),journals:x.c.getAllRows_('PURCHASE_SETTLEMENT_JOURNAL'),
  purchases:x.c.getAllRows_('PURCHASES'),reversals:x.c.getAllRows_('STOCK_LOT_SETTLEMENT_REVERSALS'),
  returnJournals:x.c.getAllRows_('FUNDED_RETURN_JOURNAL'),returnReceipts:x.c.getAllRows_('SALES_RETURN'),
  returnItems:x.c.getAllRows_('SALES_RETURN_ITEMS')
 });
 assert.equal(overlay.status,'READY',overlay.issues.join(','));
 assert.equal(overlay.totalCogsDeltaMinor,-72800);
 assert.equal(overlay.adjustments[0].quantityTicks,224e6);
});
test('after a partly funded 105-foot return, the remaining funded 124 has exact cost delta',()=>{
 const x=harness();x.enable();x.tables.STOCK_LOTS[0]['Remaining Quantity']=-100;
 x.tables.STOCK_LOTS[0].Status='Oversold';x.tables.STOCK_LOTS[1]['Original Quantity']=129;
 x.tables.STOCK_LOTS[1]['Remaining Quantity']=0;x.tables.STOCK_LOTS[1].Status='Consumed';
 x.tables.PRODUCTS[0]['Current Stock']=-100;
 Object.assign(x.tables.STOCK_LOT_SETTLEMENTS[0],{
   'Quantity Ticks':129e6,'Provisional COGS Minor':129*6800,
   'Actual COGS Minor':129*6475,'Favorable Variance Minor':129*325
 });
 assert.equal(x.c.completeReturn('T',x.payload({items:[{productId:'P1',qty:105,price:100}]})).success,true);
 const ov=x.c.computeCommittedOversoldCostOverlay_({
  saleItemLots:x.c.getAllRows_('SALE_ITEM_LOTS'),stockLots:x.c.getAllRows_('STOCK_LOTS'),
  settlements:x.c.getAllRows_('STOCK_LOT_SETTLEMENTS'),journals:x.c.getAllRows_('PURCHASE_SETTLEMENT_JOURNAL'),
  purchases:x.c.getAllRows_('PURCHASES'),reversals:x.c.getAllRows_('STOCK_LOT_SETTLEMENT_REVERSALS'),
  returnJournals:x.c.getAllRows_('FUNDED_RETURN_JOURNAL'),returnReceipts:x.c.getAllRows_('SALES_RETURN'),
  returnItems:x.c.getAllRows_('SALES_RETURN_ITEMS')
 });
 assert.equal(ov.status,'READY',ov.issues.join(','));assert.equal(ov.totalCogsDeltaMinor,-40300);
});
test('two real successive return operations restore net quantity twice without double cash for either ID',()=>{
 const x=harness();x.enable();
 const a=x.c.completeReturn('T',x.payload());assert.equal(a.success,true,a.message);
 const b=x.c.completeReturn('T',x.payload({operationId:'RETURN-OP-20261120-0002'}));
 assert.equal(b.success,true,b.message);
 assert.equal(x.tables.PRODUCTS[0]['Current Stock'],19);
 assert.equal(x.tables.SALE_ITEM_LOTS[0].Quantity,219);
 assert.equal(x.tables.STOCK_LOTS[1]['Remaining Quantity'],19);
 assert.equal(x.tables.SALES_RETURN.length,2);
 assert.equal(x.tables.CASH_BOOK.filter(r=>r.Type==='Sales Return').length,2);
 assert.equal(x.tables.FUNDED_RETURN_JOURNAL.filter(r=>r.State==='Committed').length,2);
 const ov=x.c.computeCommittedOversoldCostOverlay_({
  saleItemLots:x.c.getAllRows_('SALE_ITEM_LOTS'),stockLots:x.c.getAllRows_('STOCK_LOTS'),
  settlements:x.c.getAllRows_('STOCK_LOT_SETTLEMENTS'),journals:x.c.getAllRows_('PURCHASE_SETTLEMENT_JOURNAL'),
  purchases:x.c.getAllRows_('PURCHASES'),reversals:x.c.getAllRows_('STOCK_LOT_SETTLEMENT_REVERSALS'),
  returnJournals:x.c.getAllRows_('FUNDED_RETURN_JOURNAL'),returnReceipts:x.c.getAllRows_('SALES_RETURN'),
  returnItems:x.c.getAllRows_('SALES_RETURN_ITEMS')
 });
 assert.equal(ov.status,'READY',ov.issues.join(','));assert.equal(ov.totalCogsDeltaMinor,-71175);
});
test('fractional two-stage funded reversals are cumulatively rounded and profit has no repeated cent drift',()=>{
 const x=harness();x.enable();
 const a=x.c.completeReturn('T',x.payload({items:[{productId:'P1',qty:0.01,price:100}]}));
 assert.equal(a.success,true,a.message);
 const b=x.c.completeReturn('T',x.payload({operationId:'RETURN-OP-20261120-0002',items:[{productId:'P1',qty:0.01,price:100}]}));
 assert.equal(b.success,true,b.message);
 const third=x.c.completeReturn('T',x.payload({operationId:'RETURN-OP-20261120-0003',items:[{productId:'P1',qty:0.01,price:100}]}));
 assert.equal(third.success,true,third.message);
 const rev=x.tables.STOCK_LOT_SETTLEMENT_REVERSALS;
 assert.equal(rev.length,3);
 assert.equal(rev[0]['Cogs Delta Reversal Minor'],3);
 assert.equal(rev[1]['Cogs Delta Reversal Minor'],3);
 assert.equal(rev[2]['Cogs Delta Reversal Minor'],4);
 const ov=x.c.computeCommittedOversoldCostOverlay_({
  saleItemLots:x.c.getAllRows_('SALE_ITEM_LOTS'),stockLots:x.c.getAllRows_('STOCK_LOTS'),
  settlements:x.c.getAllRows_('STOCK_LOT_SETTLEMENTS'),journals:x.c.getAllRows_('PURCHASE_SETTLEMENT_JOURNAL'),
  purchases:x.c.getAllRows_('PURCHASES'),reversals:x.c.getAllRows_('STOCK_LOT_SETTLEMENT_REVERSALS'),
  returnJournals:x.c.getAllRows_('FUNDED_RETURN_JOURNAL'),returnReceipts:x.c.getAllRows_('SALES_RETURN'),
  returnItems:x.c.getAllRows_('SALES_RETURN_ITEMS')
 });
 assert.equal(ov.status,'READY',ov.issues.join(','));assert.equal(ov.totalCogsDeltaMinor,-74415);
});
test('funded return/purchase corrections cannot rewrite source-linked historical COGS',()=>{
 const x=harness();x.enable();const result=x.c.completeReturn('T',x.payload());assert.equal(result.success,true,result.message);
 assert.throws(()=>x.c.assertSourceLinkedReturnNotCorrected_(result.data.returnId),/linked|Needs Review/i);
 assert.throws(()=>x.c.assertSourceLinkedPurchaseNotModified_('PUR-1'),/linked|Needs Review/i);
 assert.equal(x.tables.STOCK_LOT_SETTLEMENTS[0].State,'Committed');
});
test('a writing funded-return journal blocks every other POS and finance write route, not merely identical retry',()=>{
 const x=harness();x.enable();x.fail('CASH_BOOK','append',true);
 assert.equal(x.c.completeReturn('T',x.payload()).success,false);
 assert.equal(x.c.inspectTransactionUncertainty_().safe,false);
 assert.throws(()=>x.c.assertNoUncertainTransactionWrites_(),/needs review/i);
});
test('an invoice with one funded product does not redirect an unrelated ordinary-product return',()=>{
 const x=harness();x.enable();
 x.tables.SALE_ITEM_LOTS.push({'Invoice ID':'INV-1','Product ID':'P2','Source Sale Product ID':'P2','Lot ID':'OWN-2',Quantity:1,'Unit Cost':10});
 x.tables.STOCK_LOTS.push({'Lot ID':'OWN-2','Product ID':'P2','Purchase ID':'PUR-OTHER',
   'Original Quantity':1,'Remaining Quantity':0,'Purchase Price':10,Status:'Consumed'});
 const p=x.payload({items:[{productId:'P2',name:'Tape',qty:1,price:20}]});
 assert.equal(x.c.maybeCompleteFundedOversoldReturn_(p,{}),null);
});
