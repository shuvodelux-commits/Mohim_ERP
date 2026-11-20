'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),crypto=require('node:crypto');
const root=path.join(__dirname,'..');
function fixture(){
 const sheets={},seq={},writesBySheet={};let locked=false,fault=null,bankBalance=1000;
 const rows=key=>sheets[key]||(sheets[key]=[]);
 const x={
   console,Date,JSON,Number,Math,BigInt,Object,
   Utilities:{DigestAlgorithm:{SHA_256:'SHA_256'},computeDigest:(alg,t)=>Array.from(crypto.createHash('sha256').update(t).digest(),n=>n>127?n-256:n)},
   LockService:{getScriptLock:()=>({waitLock(){assert.equal(locked,false);locked=true;},releaseLock(){locked=false;}})},
   getAllRows_:key=>rows(key).map((r,i)=>({...structuredClone(r),_rowIndex:i+2})),
   findRowIndex_:(key,col,id)=>{const index=rows(key).findIndex(r=>String(r[col])===String(id));return index<0?-1:index+2;},
   findFirstRow_:(key,col,id)=>x.getAllRows_(key).find(r=>String(r[col])===String(id)),
   appendRow_:(key,obj)=>{
     assert.equal(locked,true,'writer must hold ScriptLock');
     writesBySheet[key]=(writesBySheet[key]||0)+1;
     rows(key).push(structuredClone(obj));
     if(fault&&fault.sheet===key&&fault.operation==='append'){
       const err=fault;fault=null;if(err.after)throw Error('unknown result after '+key+' append');
       rows(key).pop();throw Error('before '+key+' append');
     }
     return rows(key).length+1;
   },
   appendRows_:(key,batch)=>batch.forEach(r=>x.appendRow_(key,r)),
   updateRowFields_:(key,index,fields)=>{
     assert.equal(locked,true);
     assert(rows(key)[index-2],'missing row for update '+key);
     writesBySheet[key]=(writesBySheet[key]||0)+1;
     const before=structuredClone(rows(key)[index-2]);
     Object.assign(rows(key)[index-2],structuredClone(fields));
     if(fault&&fault.sheet===key&&fault.operation==='update'){
       const err=fault;fault=null;if(err.after)throw Error('unknown result after '+key+' update');
       rows(key)[index-2]=before;throw Error('before '+key+' update');
     }
   },
   deleteRow_:()=>{throw Error('no delete allowed in purchase write');},
   requirePermission_:()=>({'User ID':'USR-1','Full Name':'Audit Staff'}),
   requireActiveCashSession_:()=>({}),getSettingsMap_:()=>({'Oversold Purchase Settlement Writer Enabled':'true'}),
   logError_:()=>{},actorName_:u=>u['Full Name'],getSessionUser_:()=>({'User ID':'USR-1'}),
   getSpreadsheet_:()=>({getSheetByName:name=>{
     if(!['Stock Lot Settlements','Purchase Settlement Journal'].includes(name))return null;
     const key=name==='Stock Lot Settlements'?'STOCK_LOT_SETTLEMENTS':'PURCHASE_SETTLEMENT_JOURNAL';
     const hs=vm.runInContext('CONFIG.HEADERS.'+key,x);
     return {getLastColumn:()=>hs.length,getRange:()=>({getValues:()=>[hs.slice()]})};
   }}),
   invalidateDerivedCachesForSheet_:()=>{},
 };
 vm.createContext(x);
 for(const file of ['Config.gs','Utils.gs','DeleteEngine.gs','StockLots.gs','Bundles.gs',
  'SettlementDiscount.gs','CustomerSettlement.gs','SupplierSettlement.gs','CashBook.gs',
  'BankBook.gs','PurchaseSettlement.gs','PurchaseSettlementJournal.gs','PurchaseSettlementWriter.gs',
  'Purchase.gs','PurchaseManagement.gs','PurchaseReturn.gs','Customer.gs','Suppliers.gs']){
   vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),x,{filename:file});
 }
 Object.assign(x,{
   generateId_:key=>{
     seq[key]=(seq[key]||0)+1;
     return ({PURCHASES:'PUR',STOCK_LOTS:'LOT',STOCK_LOT_SETTLEMENTS:'STL',
       STOCK_MOVEMENT:'SM',SUPPLIER_LEDGER:'SLD'}[key]||key)+'-'+String(seq[key]).padStart(6,'0');
   },
   resolveTransactionDate_:()=>({dateStr:'2026-11-20',isBackdated:false,backdatedDays:0,reason:''}),
   safeDateOnly_:v=>String(v||'').slice(0,10),formatDate_:()=> '2026-11-20',
   logError_:()=>{},
   ok_:data=>({success:true,data}),fail_:message=>({success:false,message}),
   getCashBalance_:()=>1000,
   getBankBalance_:()=>bankBalance
 });
 vm.runInContext('CONFIG.PURCHASE_SETTLEMENT_WRITER_RELEASE_APPROVED=true',x);
 sheets.PRODUCTS=[
  {'Product ID':'P1','Product Name':'Pipe','Current Stock':-231,'Purchase Price':68,'Selling Price':70,Status:'Active'},
  {'Product ID':'P2','Product Name':'Tape','Current Stock':0,'Purchase Price':25,'Selling Price':30,Status:'Active'}
 ];
 sheets.SUPPLIERS=[{'Supplier ID':'S1','Supplier Name':'Matador','Current Due':1000,Status:'Active'}];
 sheets.STOCK_LOTS=[
  {'Lot ID':'NEG1','Product ID':'P1','Product Name':'Pipe','Purchase ID':'OVERSOLD',
   'Purchase Date':'2026-10-01','Original Quantity':229,'Remaining Quantity':-229,'Purchase Price':68,Status:'Oversold'},
  {'Lot ID':'NEG2','Product ID':'P1','Product Name':'Pipe','Purchase ID':'OVERSOLD',
   'Purchase Date':'2026-10-02','Original Quantity':2,'Remaining Quantity':-2,'Purchase Price':68,Status:'Oversold'}
 ];
 sheets.SALES=[{'Invoice ID':'INV-1',Date:'2026-10-01'},{'Invoice ID':'INV-2',Date:'2026-10-02'}];
 sheets.SALE_ITEM_LOTS=[
  {'Invoice ID':'INV-1','Lot ID':'NEG1','Product ID':'P1','Source Sale Product ID':'P1',Quantity:229,'Unit Cost':68},
  {'Invoice ID':'INV-2','Lot ID':'NEG2','Product ID':'P1','Source Sale Product ID':'P1',Quantity:2,'Unit Cost':68}];
 sheets.CASH_BOOK=[{Reference:'OPEN',Type:'Session Open',Credit:1000,Debit:''}];
 sheets.BANK_ACCOUNTS=[{'Bank Account ID':'BANK-1','Account Name':'Bank One',Status:'Active'}];
 sheets.BANK_BOOK=[];
 const payload=(more={})=>({
  operationId:'OP-RESTOCK-20261120-001',supplierId:'S1',
  items:[{productId:'P1',name:'Pipe',qty:240,unitPrice:64.75,sellingPrice:70},
    {productId:'P2',name:'Tape',qty:5,unitPrice:25,sellingPrice:30}],
  discount:0,paidAmount:500,paymentMethod:'Cash',bankAccountId:'',notes:'',...more
 });
 return {x,sheets,payload,writeCounts:()=>({...writesBySheet}),
   totalWrites:()=>Object.values(writesBySheet).reduce((n,v)=>n+v,0),
   fail:(sheet,operation,after)=>{fault={sheet,operation,after}},
   enable:val=>vm.runInContext('CONFIG.PURCHASE_SETTLEMENT_WRITER_RELEASE_APPROVED='+val,x)
 };
}
const round=x=>Number(x.toFixed(2));
test('live code flag is disabled by default to avoid accidental historical or finance posts',()=>{
 const c=vm.createContext({});
 vm.runInContext(fs.readFileSync(path.join(root,'Config.gs'),'utf8'),c);
 assert.equal(vm.runInContext('CONFIG.PURCHASE_SETTLEMENT_WRITER_RELEASE_APPROVED',c),false);
});
test('under explicit feature flag, new purchase settles -231 into a +240 lot and leaves 9',()=>{
 const f=fixture(),r=f.x.createPurchase('T',f.payload());
 assert.equal(r.success,true,r.message);
 assert.equal(f.sheets.PRODUCTS[0]['Current Stock'],9);
 assert.equal(f.sheets.PRODUCTS[1]['Current Stock'],5);
 assert.deepEqual(f.sheets.STOCK_LOTS.slice(0,2).map(l=>[l['Remaining Quantity'],l.Status]),[[0,'Consumed'],[0,'Consumed']]);
 const bought=f.sheets.STOCK_LOTS.filter(l=>l['Purchase ID']===r.data.purchaseId);
 assert.deepEqual(bought.map(l=>[l['Original Quantity'],l['Remaining Quantity']]),[[240,9],[5,5]]);
 assert.equal(f.sheets.STOCK_LOT_SETTLEMENTS.length,2);
 assert.equal(f.sheets.STOCK_LOT_SETTLEMENTS[0]['Actual Unit Cost Minor'],6475);
 assert.equal(f.sheets.STOCK_LOT_SETTLEMENTS[0].State,'Committed');
 assert.equal(f.sheets.PURCHASE_SETTLEMENT_JOURNAL.length,1);
 assert.equal(f.sheets.PURCHASE_SETTLEMENT_JOURNAL[0].State,'Committed');
 assert.equal(f.sheets.PURCHASE_ITEMS.length,2);assert.equal(f.sheets.STOCK_MOVEMENT.length,2);
 assert.equal(round(f.sheets.SUPPLIERS[0]['Current Due']),16165);
 assert.equal(f.sheets.CASH_BOOK.filter(r=>r.Type==='Purchase Payment').length,1);
 assert.equal(f.sheets.CASH_BOOK.find(r=>r.Type==='Purchase Payment').Debit,500);
});
test('same operation replay never increments cash, stock, supplier or purchase again',()=>{
 const f=fixture(),first=f.x.createPurchase('T',f.payload());
 assert.equal(first.success,true,first.message);
 const counts=f.writeCounts(),second=f.x.createPurchase('T',f.payload());
 assert.equal(second.success,true,second.message);
 assert.equal(second.data.purchaseId,first.data.purchaseId);
 assert.deepEqual(f.writeCounts(),counts);
});
test('changed cart with same operation ID is a conflict before any new write',()=>{
 const f=fixture();assert.equal(f.x.createPurchase('T',f.payload()).success,true);
 const before=f.totalWrites(),p=f.payload();p.items[0].unitPrice=65;
 const attempt=f.x.createPurchase('T',p);
 assert.equal(attempt.success,false);assert.match(attempt.message,/conflict|needs review|operation/i);
 assert.equal(f.totalWrites(),before);
});
test('missing original sale-item link fails entire purchase before first write',()=>{
 const f=fixture();f.sheets.SALE_ITEM_LOTS.pop();
 const r=f.x.createPurchase('T',f.payload());
 assert.equal(r.success,false);assert.match(r.message,/missing_sale_item_link|needs review/i);
 assert.equal(f.totalWrites(),0);
});
test('incomplete previous operation blocks a different purchase',()=>{
 const f=fixture();
 f.sheets.PURCHASE_SETTLEMENT_JOURNAL=[{'Operation ID':'PREV-1','Purchase ID':'PUR-OLD','Product ID':'*',
  State:'Writing','Intent Fingerprint':'sha256:abc'}];
 const r=f.x.createPurchase('T',f.payload());
 assert.equal(r.success,false);assert.match(r.message,/needs review|pending/i);
 assert.equal(f.totalWrites(),0);
});
test('after-commit failure of purchase header append cannot be automatically retried',()=>{
 const f=fixture();f.fail('PURCHASES','append',true);
 const first=f.x.createPurchase('T',f.payload());
 assert.equal(first.success,false);assert.match(first.message,/needs review|interrupted/i);
 assert.equal(f.sheets.PURCHASES.length,1);
 const count=f.totalWrites(),next=f.x.createPurchase('T',f.payload());
 assert.equal(next.success,false);assert.equal(f.sheets.PURCHASES.length,1);
 assert.equal(f.sheets.STOCK_MOVEMENT?.length||0,0);
 assert.equal(f.sheets.CASH_BOOK.filter(r=>r.Type==='Purchase Payment').length,0);
 assert.equal(f.totalWrites(),count);
});
test('after-commit failure of first stock update cannot double supplier or cash',()=>{
 const f=fixture();f.fail('PRODUCTS','update',true);
 const first=f.x.createPurchase('T',f.payload());
 assert.equal(first.success,false);
 assert.equal(f.sheets.PURCHASE_SETTLEMENT_JOURNAL.length,1);
 assert.equal(f.sheets.PURCHASE_SETTLEMENT_JOURNAL[0].State,'Needs Review');
 const before=f.totalWrites();const repeat=f.x.createPurchase('T',f.payload());
 assert.equal(repeat.success,false);
 assert.equal(f.totalWrites(),before);
 assert.equal(f.sheets.CASH_BOOK.filter(r=>r.Type==='Purchase Payment').length,0);
});
test('after-commit failure of cash entry blocks any retry before another cash debit',()=>{
 const f=fixture();f.fail('CASH_BOOK','append',true);
 const r=f.x.createPurchase('T',f.payload());
 assert.equal(r.success,false);
 assert.equal(f.sheets.CASH_BOOK.filter(r=>r.Type==='Purchase Payment').length,1);
 const before=f.totalWrites();assert.equal(f.x.createPurchase('T',f.payload()).success,false);
 assert.equal(f.totalWrites(),before);
});
test('cash and stock validation rejects backdated missing source before journal',()=>{
 const f=fixture();f.sheets.SALES[0].Date='2026-12-01';
 const r=f.x.createPurchase('T',f.payload());
 assert.equal(r.success,false);assert.equal(f.totalWrites(),0);
});
test('bank purchase posts one bank debit and no cash debit',()=>{
 const f=fixture();
 const p=f.payload({paymentMethod:'Bank',bankAccountId:'BANK-1'});
 const r=f.x.createPurchase('T',p);
 assert.equal(r.success,true,r.message);
 assert.equal(f.sheets.CASH_BOOK.filter(x=>x.Type==='Purchase Payment').length,0);
 assert.equal(f.sheets.BANK_BOOK.filter(x=>x.Type==='Purchase Payment').length,1);
});
test('with feature disabled, existing old purchase flow and no new journals remain unchanged',()=>{
 const f=fixture();f.enable('false');
 const result=f.x.createPurchase('T',f.payload());
 assert.equal(result.success,true,result.message);
 assert.equal(f.sheets.PURCHASE_SETTLEMENT_JOURNAL?.length||0,0);
});

test('failure after the journal append never permits posting a second purchase',()=>{
 const f=fixture();f.fail('PURCHASE_SETTLEMENT_JOURNAL','append',true);
 const first=f.x.createPurchase('T',f.payload());
 assert.equal(first.success,false);
 assert.equal(f.sheets.PURCHASE_SETTLEMENT_JOURNAL.length,1);
 assert.equal(f.sheets.PURCHASES?.length||0,0);
 const before=f.totalWrites();
 assert.equal(f.x.createPurchase('T',f.payload()).success,false);
 assert.equal(f.totalWrites(),before);
});
test('failure at immutable settlement append leaves old source audit for manual reconciliation only',()=>{
 const f=fixture();f.fail('STOCK_LOT_SETTLEMENTS','append',true);
 const first=f.x.createPurchase('T',f.payload());
 assert.equal(first.success,false);
 assert.equal(f.sheets.PURCHASE_SETTLEMENT_JOURNAL[0].State,'Needs Review');
 assert.equal(f.sheets.STOCK_LOT_SETTLEMENTS.length,1);
 assert.equal(f.sheets.CASH_BOOK.filter(x=>x.Type==='Purchase Payment').length,0);
 const before=f.totalWrites();
 assert.equal(f.x.createPurchase('T',f.payload()).success,false);
 assert.equal(f.totalWrites(),before);
});
test('failure after purchase-items append records Needs Review and never posts extra cash',()=>{
 const f=fixture();f.fail('PURCHASE_ITEMS','append',true);
 const first=f.x.createPurchase('T',f.payload());
 assert.equal(first.success,false);
 assert.equal(f.sheets.PURCHASE_ITEMS.length,1);
 assert.equal(f.sheets.PURCHASE_SETTLEMENT_JOURNAL[0].State,'Needs Review');
 const before=f.totalWrites();
 assert.equal(f.x.createPurchase('T',f.payload()).success,false);
 assert.equal(f.totalWrites(),before);
});
test('failure after supplier ledger append cannot duplicate payable when retried',()=>{
 const f=fixture();f.fail('SUPPLIER_LEDGER','append',true);
 const first=f.x.createPurchase('T',f.payload());
 assert.equal(first.success,false);
 assert.equal(f.sheets.SUPPLIER_LEDGER.length,1);
 assert.equal(f.sheets.PURCHASE_SETTLEMENT_JOURNAL[0].State,'Needs Review');
 const before=f.totalWrites();
 assert.equal(f.x.createPurchase('T',f.payload()).success,false);
 assert.equal(f.totalWrites(),before);
 assert.equal(f.sheets.SUPPLIER_LEDGER.length,1);
});
test('two restocks each fund only remaining negative sale quantity, at their own purchase price',()=>{
 const f=fixture();
 let p=f.payload();p.items[0].qty=100;
 const a=f.x.createPurchase('T',p);
 assert.equal(a.success,true,a.message);
 assert.equal(f.sheets.PRODUCTS[0]['Current Stock'],-131);
 assert.equal(f.sheets.STOCK_LOTS[0]['Remaining Quantity'],-129);
 assert.equal(f.sheets.STOCK_LOT_SETTLEMENTS.length,1);
 assert.equal(f.sheets.STOCK_LOT_SETTLEMENTS[0]['Quantity Ticks'],100000000);
 const p2=f.payload({operationId:'OP-RESTOCK-20261120-002'});
 p2.items[0].qty=140;p2.items[0].unitPrice=66;
 const b=f.x.createPurchase('T',p2);
 assert.equal(b.success,true,b.message);
 assert.equal(f.sheets.PRODUCTS[0]['Current Stock'],9);
 assert.deepEqual(f.sheets.STOCK_LOTS.slice(0,2).map(l=>[l['Remaining Quantity'],l.Status]),[[0,'Consumed'],[0,'Consumed']]);
 const second=f.sheets.STOCK_LOTS.find(l=>l['Purchase ID']===b.data.purchaseId&&l['Product ID']==='P1');
 assert.equal(second['Remaining Quantity'],9);
 const allocations=f.sheets.STOCK_LOT_SETTLEMENTS.filter(l=>l['Purchase ID']===b.data.purchaseId);
 assert.equal(allocations.reduce((n,l)=>n+Number(l['Quantity Ticks']),0),131000000);
 assert.ok(allocations.every(l=>l['Actual Unit Cost Minor']===6600));
});
test('one invalid product in a combined purchase leaves zero stock, supplier and journal effects',()=>{
 const f=fixture();const p=f.payload();p.items[1].productId='NO-SUCH-PRODUCT';
 const original=structuredClone(f.sheets.PRODUCTS);const r=f.x.createPurchase('T',p);
 assert.equal(r.success,false);
 assert.equal(f.totalWrites(),0);
 assert.deepEqual(f.sheets.PRODUCTS,original);
});
test('zero-paid purchase maintains a single payable and no Cash/Bank movement',()=>{
 const f=fixture(),r=f.x.createPurchase('T',f.payload({paidAmount:0}));
 assert.equal(r.success,true,r.message);
 assert.equal(f.sheets.CASH_BOOK.filter(x=>x.Type==='Purchase Payment').length,0);
 assert.equal(f.sheets.BANK_BOOK.filter(x=>x.Type==='Purchase Payment').length,0);
 assert.equal(f.sheets.SUPPLIER_LEDGER.filter(x=>x.Reference===r.data.purchaseId).length,1);
});
test('tampered settlement receipt cannot be declared committed if cost math no longer balances',()=>{
 const f=fixture();f.fail('PURCHASE_SETTLEMENT_JOURNAL','update',true);
 const r=f.x.createPurchase('T',f.payload());
 assert.equal(r.success,false);
 assert.equal(f.sheets.PURCHASE_SETTLEMENT_JOURNAL.length,1);
 assert.equal(f.sheets.CASH_BOOK.filter(x=>x.Type==='Purchase Payment').length,0);
});
