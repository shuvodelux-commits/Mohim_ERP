'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','PurchaseSettlementJournal.gs'),'utf8');
function harness(){
 const sheets={PURCHASE_SETTLEMENT_JOURNAL:[]};
 let locked=false,writes=0,afterAppendFailure=false,afterStageFailure=false,verifyCount=0;
 const ctx={
   Date,JSON,console,Math,
   getAllRows_:key=>(sheets[key]||[]).map((r,i)=>({...r,_rowIndex:i+2})),
   findRowIndex_:(key,col,value)=>((sheets[key]||[]).findIndex(r=>r[col]===value)+2)||1,
   appendRow_:(key,row)=>{assert(locked);writes++;(sheets[key]||[]).push({...row});
     if(afterAppendFailure){afterAppendFailure=false;throw Error('timeout after append committed');}
     return sheets[key].length+1;},
   updateRowFields_:(key,i,fields)=>{assert(locked);writes++;assert(sheets[key][i-2]);Object.assign(sheets[key][i-2],fields);
     if(afterStageFailure){afterStageFailure=false;throw Error('timeout after update committed');}
   },
 };
 vm.createContext(ctx);vm.runInContext(source,ctx);
 const intent=()=>({operationId:'OP-RESTOCK-20261120-001',purchaseId:'PUR-082',
   actor:'USR-1',fingerprint:'sha256:'+'a'.repeat(64),productIds:['P1','P2']});
 return {ctx,sheets,intent,lock:()=>{locked=true},unlock:()=>{locked=false},writes:()=>writes,
   failNextAppend:()=>{afterAppendFailure=true},failNextStage:()=>{afterStageFailure=true},
   inspect:(x,receipt=()=>{verifyCount++;return true})=>JSON.parse(JSON.stringify(ctx.purchaseSettlementJournalDecision_(x,ctx.getAllRows_('PURCHASE_SETTLEMENT_JOURNAL'),receipt))),
   verifyCount:()=>verifyCount};
}
const frozen=x=>Object.isFrozen(x)&&Object.isFrozen(x.issues);
test('fresh valid operation has NEW decision without a journal write',()=>{
 const w=harness(),i=w.intent();const r=w.inspect(i);
 assert.equal(r.status,'NEW');assert.equal(r.postable,false);assert.equal(w.writes(),0);
});
test('journal reservation is a one-way first write under caller lock',()=>{
 const w=harness(),i=w.intent();w.lock();
 const r=w.ctx.reservePurchaseSettlementJournal_(i);
 assert.equal(r.status,'WRITING');assert.equal(w.sheets.PURCHASE_SETTLEMENT_JOURNAL.length,1);
 assert.equal(w.sheets.PURCHASE_SETTLEMENT_JOURNAL[0]['Operation ID'],i.operationId);
 assert.equal(w.sheets.PURCHASE_SETTLEMENT_JOURNAL[0].State,'Writing');
 assert.equal(w.sheets.PURCHASE_SETTLEMENT_JOURNAL[0]['Product ID'],'*');
 assert.equal(w.sheets.PURCHASE_SETTLEMENT_JOURNAL[0]['Last Completed Stage'],'Reserved');
 assert.equal(w.sheets.PURCHASE_SETTLEMENT_JOURNAL[0]['Intent Fingerprint'],i.fingerprint);
 assert.equal(w.writes(),1);
});
test('retry of unresolved same operation and any new operation is blocked',()=>{
 const w=harness();w.lock();w.ctx.reservePurchaseSettlementJournal_(w.intent());
 assert.equal(w.inspect(w.intent()).status,'NEEDS_REVIEW');
 const next=w.intent();next.operationId='OP-RESTOCK-20261120-002';next.purchaseId='PUR-083';
 assert.equal(w.inspect(next).status,'NEEDS_REVIEW');
 assert.equal(w.writes(),1);
});
test('unknown append outcome never prompts a second append',()=>{
 const w=harness();w.lock();w.failNextAppend();
 const r=w.ctx.reservePurchaseSettlementJournal_(w.intent());
 assert.equal(r.status,'NEEDS_REVIEW');assert.equal(w.sheets.PURCHASE_SETTLEMENT_JOURNAL.length,1);
 assert.equal(w.sheets.PURCHASE_SETTLEMENT_JOURNAL[0].State,'Writing');
 const second=w.ctx.reservePurchaseSettlementJournal_(w.intent());
 assert.equal(second.status,'NEEDS_REVIEW');
 assert.equal(w.writes(),1);
});
test('ambiguous absent append may be retried safely only when no business writes occurred',()=>{
 const w=harness();w.lock();
 const original=w.ctx.appendRow_;
 w.ctx.appendRow_=()=>{throw Error('failed before append');};
 assert.equal(w.ctx.reservePurchaseSettlementJournal_(w.intent()).status,'NEEDS_REVIEW');
 assert.equal(w.sheets.PURCHASE_SETTLEMENT_JOURNAL.length,0);
 w.ctx.appendRow_=original;
 assert.equal(w.ctx.reservePurchaseSettlementJournal_(w.intent()).status,'WRITING');
 assert.equal(w.sheets.PURCHASE_SETTLEMENT_JOURNAL.length,1);
});
test('duplicate op ID and conflicting Purchase ID fail even if one row says committed',()=>{
 const w=harness();let i=w.intent();w.sheets.PURCHASE_SETTLEMENT_JOURNAL.push(
 {'Operation ID':i.operationId,'Purchase ID':i.purchaseId,Actor:i.actor,
 'Intent Fingerprint':i.fingerprint,State:'Committed','Result Receipt':i.purchaseId},
 {'Operation ID':i.operationId,'Purchase ID':i.purchaseId,Actor:i.actor,
 'Intent Fingerprint':i.fingerprint,State:'Committed','Result Receipt':i.purchaseId}
 );
 assert.equal(w.inspect(i).status,'NEEDS_REVIEW');i={...i,operationId:'OP-RESTOCK-20261120-002'};
 assert.equal(w.inspect(i).status,'NEEDS_REVIEW');
});
test('actor or whole-payload mismatch blocks replay with no receipt verification',()=>{
 const w=harness();w.lock();w.ctx.reservePurchaseSettlementJournal_(w.intent());
 Object.assign(w.sheets.PURCHASE_SETTLEMENT_JOURNAL[0],{State:'Committed','Last Completed Stage':'Committed','Result Receipt':'PUR-082'});
 const a=w.intent();a.actor='USR-2';assert.equal(w.inspect(a).status,'NEEDS_REVIEW');
 const b=w.intent();b.fingerprint='sha256:'+'b'.repeat(64);assert.equal(w.inspect(b).status,'NEEDS_REVIEW');
 assert.equal(w.verifyCount(),0);
});
test('committed operation replay must verify entire original receipt',()=>{
 const w=harness();w.lock();w.ctx.reservePurchaseSettlementJournal_(w.intent());
 Object.assign(w.sheets.PURCHASE_SETTLEMENT_JOURNAL[0],{State:'Committed','Last Completed Stage':'Committed','Result Receipt':'PUR-082'});
 assert.equal(w.inspect(w.intent(),()=>false).status,'NEEDS_REVIEW');
 const r=w.inspect(w.intent(),(purchaseId)=>purchaseId==='PUR-082');
 assert.equal(r.status,'REPLAY');assert.equal(r.receiptRef,'PUR-082');
 assert.equal(w.sheets.PURCHASE_SETTLEMENT_JOURNAL.length,1);assert.equal(w.writes(),1);
});
test('failed post-commit readback cannot be assumed successful',()=>{
 const w=harness();w.lock();w.ctx.reservePurchaseSettlementJournal_(w.intent());
 Object.assign(w.sheets.PURCHASE_SETTLEMENT_JOURNAL[0],{State:'Committed','Last Completed Stage':'Committed','Result Receipt':'PUR-082'});
 assert.equal(w.inspect(w.intent(),()=>{throw Error('Sheets unavailable');}).status,'NEEDS_REVIEW');
});
test('valid stages advance only with exact journal identity under lock',()=>{
 const w=harness(),i=w.intent();w.lock();w.ctx.reservePurchaseSettlementJournal_(i);
 const a=w.ctx.advancePurchaseSettlementJournal_(i,'Purchase Header');
 assert.equal(a.status,'WRITING');
 assert.equal(w.sheets.PURCHASE_SETTLEMENT_JOURNAL[0]['Last Completed Stage'],'Purchase Header');
 const b=w.ctx.advancePurchaseSettlementJournal_(i,'Stock And Lots');
 assert.equal(b.status,'WRITING');
 assert.equal(w.sheets.PURCHASE_SETTLEMENT_JOURNAL[0]['Last Completed Stage'],'Stock And Lots');
});
test('out-of-order and repeated stages never imply writes were repeated safely',()=>{
 const w=harness(),i=w.intent();w.lock();w.ctx.reservePurchaseSettlementJournal_(i);
 assert.equal(w.ctx.advancePurchaseSettlementJournal_(i,'Payments').status,'NEEDS_REVIEW');
 assert.equal(w.sheets.PURCHASE_SETTLEMENT_JOURNAL[0]['Last Completed Stage'],'Reserved');
 w.ctx.advancePurchaseSettlementJournal_(i,'Purchase Header');
 const before=w.writes();
 assert.equal(w.ctx.advancePurchaseSettlementJournal_(i,'Purchase Header').status,'NEEDS_REVIEW');
 assert.equal(w.writes(),before);
});
test('stage update may throw after write; next stage must not blindly advance',()=>{
 const w=harness(),i=w.intent();w.lock();w.ctx.reservePurchaseSettlementJournal_(i);w.failNextStage();
 assert.equal(w.ctx.advancePurchaseSettlementJournal_(i,'Purchase Header').status,'NEEDS_REVIEW');
 assert.equal(w.sheets.PURCHASE_SETTLEMENT_JOURNAL[0]['Last Completed Stage'],'Purchase Header');
 assert.equal(w.ctx.advancePurchaseSettlementJournal_(i,'Stock And Lots').status,'NEEDS_REVIEW');
});
test('Needs Review mark is monotonic, blocks committed transition',()=>{
 const w=harness(),i=w.intent();w.lock();w.ctx.reservePurchaseSettlementJournal_(i);
 const r=w.ctx.markPurchaseSettlementNeedsReview_(i,'purchase header append ambiguous');
 assert.equal(r.status,'NEEDS_REVIEW');
 assert.equal(w.sheets.PURCHASE_SETTLEMENT_JOURNAL[0].State,'Needs Review');
 assert.equal(w.ctx.advancePurchaseSettlementJournal_(i,'Purchase Header').status,'NEEDS_REVIEW');
});
test('cannot mark Committed without explicit source verified receipt',()=>{
 const w=harness(),i=w.intent();w.lock();w.ctx.reservePurchaseSettlementJournal_(i);
 for(const stage of ['Purchase Header','Stock And Lots','Settlement Events','Purchase Items','Stock Movements','Payments','Supplier Due']){
   assert.equal(w.ctx.advancePurchaseSettlementJournal_(i,stage).status,'WRITING');
 }
 assert.equal(w.ctx.commitPurchaseSettlementJournal_(i,()=>false).status,'NEEDS_REVIEW');
 assert.equal(w.sheets.PURCHASE_SETTLEMENT_JOURNAL[0].State,'Writing');
 const r=w.ctx.commitPurchaseSettlementJournal_(i,id=>id==='PUR-082');
 assert.equal(r.status,'COMMITTED');
 assert.equal(w.sheets.PURCHASE_SETTLEMENT_JOURNAL[0].State,'Committed');
 assert.equal(w.inspect(i,id=>id==='PUR-082').status,'REPLAY');
});
test('a completed operation retains source actor/purchase ID and cannot be changed',()=>{
 const w=harness(),i=w.intent();w.lock();w.ctx.reservePurchaseSettlementJournal_(i);
 const forged={...i,purchaseId:'PUR-999'};assert.equal(w.ctx.advancePurchaseSettlementJournal_(forged,'Purchase Header').status,'NEEDS_REVIEW');
 const other={...i,actor:'USR-HACK'};assert.equal(w.ctx.advancePurchaseSettlementJournal_(other,'Purchase Header').status,'NEEDS_REVIEW');
 assert.equal(w.writes(),1);
});

test('replay rejects a second committed operation sharing the original purchase receipt ID',()=>{
 const w=harness(),i=w.intent();w.lock();w.ctx.reservePurchaseSettlementJournal_(i);
 Object.assign(w.sheets.PURCHASE_SETTLEMENT_JOURNAL[0],{State:'Committed','Last Completed Stage':'Committed','Result Receipt':i.purchaseId});
 w.sheets.PURCHASE_SETTLEMENT_JOURNAL.push({'Operation ID':'OP-OTHER','Purchase ID':i.purchaseId,State:'Committed'});
 const decision=w.inspect(i,()=>true);
 assert.equal(decision.status,'NEEDS_REVIEW');assert.equal(w.verifyCount(),0);
});
test('malformed unknown state is not a free new-purchase slot',()=>{
 const w=harness(),i=w.intent();
 w.sheets.PURCHASE_SETTLEMENT_JOURNAL.push({'Operation ID':'OTHER','Purchase ID':'PUR-OLD',State:'Some New State','Product ID':'*'});
 assert.equal(w.inspect(i).status,'NEEDS_REVIEW');
});
