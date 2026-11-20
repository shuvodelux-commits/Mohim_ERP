'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','TransactionUncertaintyGuard.gs'),'utf8');
const C={
  purchase:{journal:'PURCHASE_SETTLEMENT_JOURNAL',events:'STOCK_LOT_SETTLEMENTS',
    nameJournal:'Purchase Settlement Journal',nameEvents:'Stock Lot Settlements',
    eventOp:'Operation ID',receipt:'Purchase ID'},
  returned:{journal:'FUNDED_RETURN_JOURNAL',events:'STOCK_LOT_SETTLEMENT_REVERSALS',
    nameJournal:'Funded Return Journal',nameEvents:'Stock Lot Settlement Reversals',
    eventOp:'Return Operation ID',receipt:'Return ID'}
};
function rig(){
 const tables={
  [C.purchase.nameJournal]:[
   ['Operation ID','Purchase ID','State','Last Completed Stage','Result Receipt'],
   ['OP-P1','PUR-1','Committed','Committed','PUR-1']
  ],
  [C.purchase.nameEvents]:[
   ['Settlement ID','Operation ID','Purchase ID','State'],
   ['SET-1','OP-P1','PUR-1','Committed']
  ],
  [C.returned.nameJournal]:[
   ['Operation ID','Return ID','State','Last Completed Stage','Result Receipt'],
   ['OP-R1','SRT-1','Committed','Committed','SRT-1']
  ],
  [C.returned.nameEvents]:[
   ['Reversal ID','Return Operation ID','Return ID','State'],
   ['REV-1','OP-R1','SRT-1','Committed']
  ]
 };
 let mutations=0;
 const cfg={
  SHEETS:Object.fromEntries(Object.values(C).flatMap(x=>[[x.journal,x.nameJournal],[x.events,x.nameEvents]])),
  PURCHASE_SETTLEMENT_WRITER_RELEASE_APPROVED:false,FUNDED_RETURN_WRITER_RELEASE_APPROVED:false
 };
 const v={
  CONFIG:cfg,console,
  getSpreadsheet_:()=>({getSheetByName:name=>!tables[name]?null:{
   getLastColumn:()=>tables[name][0].length,getLastRow:()=>tables[name].length,
   getRange:(_r,_c,_rows,_cols)=>({getValues:()=>tables[name].map(row=>row.slice())})
  }}),
  getSheet_:()=>{mutations++;throw Error('read-only must not create')},
  appendRow_:()=>{mutations++;throw Error('read-only must not post')}
 };
 vm.createContext(v);vm.runInContext(source,v);
 return {tables,v,mutations:()=>mutations};
}
function unsafe(x,reason){const result=x.v.inspectTransactionUncertainty_();assert.equal(result.safe,false,JSON.stringify(result));assert.match(result.issues.join(' '),reason||/journal|source|event|needs.review/i);assert.equal(x.mutations(),0);}
test('all committed journals and their unique committed events reconcile without mutation',()=>{
 const x=rig();assert.equal(x.v.inspectTransactionUncertainty_().safe,true);assert.equal(x.mutations(),0);
});
test('purchase settlement sheet missing while committed purchase journal exists blocks all new posts',()=>{
 const x=rig();delete x.tables[C.purchase.nameEvents];unsafe(x,/missing|settlement|event|source/i);
});
test('funded reversal sheet missing while committed return journal exists blocks all new posts',()=>{
 const x=rig();delete x.tables[C.returned.nameEvents];unsafe(x,/missing|reversal|event|source/i);
});
test('orphaned purchase event with missing purchase journal blocks despite disabled release flag',()=>{
 const x=rig();delete x.tables[C.purchase.nameJournal];unsafe(x,/orphan|missing|journal|event/i);
});
test('orphaned reversal event with missing return journal blocks despite disabled release flag',()=>{
 const x=rig();delete x.tables[C.returned.nameJournal];unsafe(x,/orphan|missing|journal|event/i);
});
test('legacy workbook with neither pair of sheets remains read-only safe while flags disabled',()=>{
 const x=rig();for(const n of Object.values(C)){delete x.tables[n.nameJournal];delete x.tables[n.nameEvents];}
 assert.equal(x.v.inspectTransactionUncertainty_().safe,true);assert.equal(x.mutations(),0);
});
test('committed journal without a single event cannot pass as clean',()=>{
 for(const a of Object.values(C)){const x=rig();x.tables[a.nameEvents].splice(1);unsafe(x,/missing|source|event|journal/i);}
});
test('Writing or Needs Review events cannot be hidden by a Committed journal',()=>{
 for(const a of Object.values(C))for(const state of ['Writing','Needs Review']){
  const x=rig();x.tables[a.nameEvents][1][3]=state;unsafe(x,/uncommitted|pending|event|journal|review/i);
 }
});
test('event operation or receipt mismatch blocks even if all journal stages are Committed',()=>{
 for(const a of Object.values(C)) {
  const x=rig();x.tables[a.nameEvents][1][1]='OP-FOREIGN';unsafe(x,/orphan|source|journal|event/i);
  const y=rig();y.tables[a.nameEvents][1][2]='OTHER-RECEIPT';unsafe(y,/receipt|source|event|journal/i);
 }
});
test('duplicate event ID, blank event ID or duplicate journal receipt blocks',()=>{
 for(const a of Object.values(C)){
  const x=rig();x.tables[a.nameEvents].push(x.tables[a.nameEvents][1].slice());unsafe(x,/duplicate|event/i);
  const y=rig();y.tables[a.nameEvents][1][0]='';unsafe(y,/missing|event|source|identity/i);
 }
});
test('missing or duplicated required event column blocks without repairing workbook',()=>{
 for(const a of Object.values(C)){
  const x=rig();x.tables[a.nameEvents][0][1]='Unknown';unsafe(x,/header|missing|event|source/i);
  const y=rig();y.tables[a.nameEvents][0][1]=y.tables[a.nameEvents][0][0];unsafe(y,/duplicate|header|source/i);
 }
});
