'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','FundedReturnJournal.gs'),'utf8');
function harness(){
 const sheets={FUNDED_RETURN_JOURNAL:[]},writes=[];let fault=null,locked=false,verified=0;
 const ctx={Date,Math,Number,JSON,console,
  getAllRows_:name=>(sheets[name]||[]).map((r,i)=>({...r,_rowIndex:i+2})),
  appendRow_:(name,row)=>{
   assert(locked,'ScriptLock required');if(fault&&fault.name===name&&fault.mode==='append'&&!fault.after){
    fault=null;throw Error('failed before append');
   }
   (sheets[name]||(sheets[name]=[])).push({...row});writes.push(['append',name]);
   if(fault&&fault.name===name&&fault.mode==='append'){fault=null;throw Error('timeout after append');}
   return sheets[name].length+1;
  },
  updateRowFields_:(name,index,fields)=>{
   assert(locked,'ScriptLock required');
   if(fault&&fault.name===name&&fault.mode==='update'&&!fault.after){
    fault=null;throw Error('failed before update');
   }
   const row=sheets[name][index-2];assert(row,'row identity needed');Object.assign(row,fields);
   writes.push(['update',name]);
   if(fault&&fault.name===name&&fault.mode==='update'){fault=null;throw Error('timeout after update');}
  }
 };
 vm.createContext(ctx);vm.runInContext(src,ctx);
 const intent=()=>({operationId:'FUNDED-RETURN-20261120-0001',returnId:'SRT-000020',invoiceId:'INV-9',
   productId:'P1',actor:'U1',fingerprint:'sha256:'+'c'.repeat(64)});
 return {ctx,sheets,writes,intent,lock:()=>{locked=true;},unlock:()=>{locked=false},
   fault:(mode,after=true)=>{fault={name:'FUNDED_RETURN_JOURNAL',mode,after};},
   decision:(i,verify=()=>{verified++;return true})=>ctx.fundedReturnJournalDecision_(i,ctx.getAllRows_('FUNDED_RETURN_JOURNAL'),verify),
   verified:()=>verified};
}
test('new funded return requires no existing operation and makes no writes on preflight',()=>{
 const h=harness();const r=h.decision(h.intent());
 assert.equal(r.status,'NEW');assert.equal(r.postable,false);assert.equal(h.writes.length,0);
});
test('reservation is first journal write with stable full-cart identity under caller lock',()=>{
 const h=harness(),i=h.intent();h.lock();const r=h.ctx.reserveFundedReturnJournal_(i);
 assert.equal(r.status,'WRITING');assert.equal(h.writes.length,1);
 const row=h.sheets.FUNDED_RETURN_JOURNAL[0];
 assert.equal(row['Operation ID'],i.operationId);
 assert.equal(row['Return ID'],i.returnId);
 assert.equal(row['Intent Fingerprint'],i.fingerprint);
 assert.equal(row.State,'Writing');assert.equal(row['Last Completed Stage'],'Reserved');
 assert.equal(row.Actor,i.actor);
});
test('committed append that throws blocks every repeat and all new funded returns',()=>{
 const h=harness();h.lock();h.fault('append',true);
 assert.equal(h.ctx.reserveFundedReturnJournal_(h.intent()).status,'NEEDS_REVIEW');
 assert.equal(h.sheets.FUNDED_RETURN_JOURNAL.length,1);
 assert.equal(h.ctx.reserveFundedReturnJournal_(h.intent()).status,'NEEDS_REVIEW');
 const next={...h.intent(),operationId:'FUNDED-RETURN-20261120-0002',returnId:'SRT-000021'};
 assert.equal(h.decision(next).status,'NEEDS_REVIEW');assert.equal(h.writes.length,1);
});
test('append that failed before writing can be attempted later with the same operation',()=>{
 const h=harness();h.lock();h.fault('append',false);
 assert.equal(h.ctx.reserveFundedReturnJournal_(h.intent()).status,'NEEDS_REVIEW');
 assert.equal(h.sheets.FUNDED_RETURN_JOURNAL.length,0);
 assert.equal(h.ctx.reserveFundedReturnJournal_(h.intent()).status,'WRITING');
});
test('committed receipt replays only after matching actor, invoice, exact cart and verified source',()=>{
 const h=harness(),i=h.intent();h.lock();h.ctx.reserveFundedReturnJournal_(i);
 Object.assign(h.sheets.FUNDED_RETURN_JOURNAL[0],{State:'Committed','Last Completed Stage':'Committed','Result Receipt':i.returnId});
 assert.equal(h.decision(i,()=>false).status,'NEEDS_REVIEW');
 assert.equal(h.decision(i,()=>true).status,'REPLAY');
 const changed={...i,fingerprint:'sha256:'+'f'.repeat(64)};
 assert.equal(h.decision(changed).status,'NEEDS_REVIEW');
 assert.equal(h.decision({...i,actor:'U2'}).status,'NEEDS_REVIEW');
 assert.equal(h.decision({...i,invoiceId:'INV-OTHER'}).status,'NEEDS_REVIEW');
 assert.equal(h.writes.length,1);
});
test('duplicate journal ID or duplicate return ID across operations fails closed',()=>{
 const h=harness(),i=h.intent();h.lock();h.ctx.reserveFundedReturnJournal_(i);
 Object.assign(h.sheets.FUNDED_RETURN_JOURNAL[0],{State:'Committed','Last Completed Stage':'Committed','Result Receipt':i.returnId});
 h.sheets.FUNDED_RETURN_JOURNAL.push({...h.sheets.FUNDED_RETURN_JOURNAL[0], 'Operation ID':'FUNDED-RETURN-20261120-0002'});
 assert.equal(h.decision(i,()=>true).status,'NEEDS_REVIEW');assert.equal(h.verified(),0);
 const dup={...i,returnId:'SRT-000021'};
 h.sheets.FUNDED_RETURN_JOURNAL.push({...h.sheets.FUNDED_RETURN_JOURNAL[0]});
 assert.equal(h.decision(dup).status,'NEEDS_REVIEW');
});
test('stage machine rejects stage skipping and stage repeats without retrying business rows',()=>{
 const h=harness(),i=h.intent();h.lock();h.ctx.reserveFundedReturnJournal_(i);
 assert.equal(h.ctx.advanceFundedReturnJournal_(i,'Refund').status,'NEEDS_REVIEW');
 assert.equal(h.ctx.advanceFundedReturnJournal_(i,'Return Header').status,'WRITING');
 const w=h.writes.length;
 assert.equal(h.ctx.advanceFundedReturnJournal_(i,'Return Header').status,'NEEDS_REVIEW');
 assert.equal(h.writes.length,w);
});
test('stage update that throws after actual commit permanently marks Needs Review',()=>{
 const h=harness(),i=h.intent();h.lock();h.ctx.reserveFundedReturnJournal_(i);
 h.fault('update',true);
 assert.equal(h.ctx.advanceFundedReturnJournal_(i,'Return Header').status,'NEEDS_REVIEW');
 assert.equal(h.sheets.FUNDED_RETURN_JOURNAL[0].State,'Needs Review');
 assert.equal(h.ctx.advanceFundedReturnJournal_(i,'Stock And Source Lots').status,'NEEDS_REVIEW');
});
test('committed operation must pass complete source receipt readback before commit',()=>{
 const h=harness(),i=h.intent();h.lock();h.ctx.reserveFundedReturnJournal_(i);
 for(const step of ['Return Header','Stock And Source Lots','Reversal Events','Return Items And Movement','Refund']){
  assert.equal(h.ctx.advanceFundedReturnJournal_(i,step).status,'WRITING');
 }
 assert.equal(h.ctx.commitFundedReturnJournal_(i,()=>false).status,'NEEDS_REVIEW');
 assert.equal(h.sheets.FUNDED_RETURN_JOURNAL[0].State,'Writing');
 assert.equal(h.ctx.commitFundedReturnJournal_(i,()=>true).status,'COMMITTED');
 assert.equal(h.decision(i,()=>true).status,'REPLAY');
});
test('interrupted committed marker cannot be overwritten as Needs Review and cannot reapply cash',()=>{
 const h=harness(),i=h.intent();h.lock();h.ctx.reserveFundedReturnJournal_(i);
 Object.assign(h.sheets.FUNDED_RETURN_JOURNAL[0],{State:'Committed','Last Completed Stage':'Committed','Result Receipt':i.returnId});
 assert.equal(h.ctx.markFundedReturnNeedsReview_(i,'ambiguous').status,'NEEDS_REVIEW');
 assert.equal(h.sheets.FUNDED_RETURN_JOURNAL[0].State,'Committed');
 assert.equal(h.ctx.advanceFundedReturnJournal_(i,'Return Header').status,'NEEDS_REVIEW');
});
test('journal stage and replay require the exact source actor, invoice, product, return ID and hash',()=>{
 const h=harness(),i=h.intent();h.lock();h.ctx.reserveFundedReturnJournal_(i);
 for(const changed of [{...i,actor:'forged'},{...i,invoiceId:'INV-2'},
  {...i,productId:'P2'},{...i,returnId:'SRT-OTHER'},
  {...i,fingerprint:'sha256:'+'0'.repeat(64)}]){
   assert.equal(h.ctx.advanceFundedReturnJournal_(changed,'Return Header').status,'NEEDS_REVIEW');
 }
 assert.equal(h.writes.length,1);
});

test('malformed unrelated Committed journal must not authorize another new refund',()=>{
 const h=harness(),i=h.intent();
 h.sheets.FUNDED_RETURN_JOURNAL.push({
   'Operation ID':'FUNDED-RETURN-20261120-PREV','Return ID':'SRT-000001',
   State:'Committed','Last Completed Stage':'Refund','Result Receipt':'SRT-000001'
 });
 assert.equal(h.decision(i).status,'NEEDS_REVIEW');
 h.sheets.FUNDED_RETURN_JOURNAL[0]['Last Completed Stage']='Committed';
 h.sheets.FUNDED_RETURN_JOURNAL[0]['Result Receipt']='SRT-MISMATCH';
 assert.equal(h.decision(i).status,'NEEDS_REVIEW');
});
