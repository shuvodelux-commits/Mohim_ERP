'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const script=read('whatsappShare.html').match(/<script>([\s\S]*?)<\/script>/)[1];
const service=read('WhatsAppService.gs');
const c=read('customerLedger.html'),s=read('supplierLedger.html');
const row=(id,debit,credit,balance)=>({'Ledger ID':id,Date:'2026-10-12',Type:'Sale',Reference:'INV-'+id,Debit:debit,Credit:credit,Balance:balance,'Customer ID':'C1'});
const fixture=[row('CLEAN|customer|INV-1',100,0,100),row('PAY-2',0,30,70)];
function run(permissions=null){
 const calls=[],messages=[],elements={};
 for(const id of ['customerLedgerShareDueBtn','customerLedgerShareSelectedBtn','supplierLedgerShareDueBtn','supplierLedgerShareSelectedBtn']){
  elements[id]={disabled:false,hidden:false,textContent:'',setAttribute(){},removeAttribute(){}};
 }
 const ctx={
   console,Date,Promise,Set,Array,Object,JSON,userPermissions:permissions,
   document:{readyState:'loading',addEventListener(){},activeElement:{id:'trigger'} ,getElementById:id=>elements[id]||null},
   showToast:(message,kind)=>messages.push([message,kind]),
   openWhatsAppShare_:(request,trigger)=>{calls.push({request:JSON.parse(JSON.stringify(request)),trigger});return request;}
 };
 vm.createContext(ctx);vm.runInContext(script,ctx,{filename:'whatsappShare.html'});
 ctx.openWhatsAppShare_=(request,trigger)=>{calls.push({request:JSON.parse(JSON.stringify(request)),trigger});return request;};
 const server={};vm.createContext(server);vm.runInContext(service,server,{filename:'WhatsAppService.gs'});
 return {ctx,calls,messages,elements,server,call:(fn,...args)=>{ctx.__args=args;return vm.runInContext(fn+'(...__args)',ctx)}};
}
test('shared UI uses same authoritative version signature as server including synthetic clean IDs',()=>{
 const h=run();
 for(const r of fixture){
  const v=h.call('waPartyLedgerRowVersion_',r);
  assert.equal(v,h.server.whatsAppPartyRowVersion_(r));
 }
 const changed={...fixture[0],Debit:101};
 assert.notEqual(h.call('waPartyLedgerRowVersion_',changed),h.call('waPartyLedgerRowVersion_',fixture[0]));
});
test('customer and supplier share require view plus whatsappShare.edit, not generic edit rights',()=>{
 const rights={whatsappShare:{edit:true},customers:{view:true},suppliers:{view:false,edit:true}};
 const h=run(rights);
 assert.equal(h.call('waPartyLedgerCanShare_','customer'),true);
 assert.equal(h.call('waPartyLedgerCanShare_','supplier'),false);
 h.ctx.userPermissions={whatsappShare:{view:true},customers:{view:true}};
 assert.equal(h.call('waPartyLedgerCanShare_','customer'),false);
});
test('selected rows persist across pages with stable IDs up to 25',()=>{
 const h=run(),state={partyId:'C1',party:{id:'C1'},showCorrections:false,waSelected:{}};
 assert.equal(h.call('waPartyLedgerToggle_', 'customer',state,fixture[0],true),true);
 assert.equal(h.call('waPartyLedgerToggle_', 'customer',state,fixture[1],true),true);
 const sent=h.call('waPartyLedgerSend_','customer',state,'selected',null,null,{id:'button'});
 assert.deepEqual(JSON.parse(JSON.stringify(sent.rowIds)),['CLEAN|customer|INV-1','PAY-2']);
 assert.equal(sent.rowVersions['CLEAN|customer|INV-1'],h.call('waPartyLedgerRowVersion_',fixture[0]));
 assert.equal(sent.source,'customer');assert.equal(sent.entityId,'C1');
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].request.mode,'selected');
});
test('row share and due share do not pick stale selected rows',()=>{
 const h=run(),state={partyId:'C1',party:{id:'C1'},showCorrections:false,waSelected:{}};
 h.call('waPartyLedgerToggle_','customer',state,fixture[0],true);
 const single=h.call('waPartyLedgerSend_','customer',state,'single',fixture[1],null,null);
 const due=h.call('waPartyLedgerSend_','customer',state,'due',null,null,null);
 assert.deepEqual(JSON.parse(JSON.stringify(single.rowIds)),['PAY-2']);
 assert.equal(single.rowVersions['PAY-2'],h.call('waPartyLedgerRowVersion_',fixture[1]));
 assert.deepEqual(JSON.parse(JSON.stringify(due.rowIds)),[]);
});
test('supplier period shares inclusive dates without current-page row IDs',()=>{
 const h=run(),state={partyId:'S1',party:{id:'S1'},showCorrections:false,waSelected:{}};
 const sent=h.call('waPartyLedgerSend_','supplier',state,'period',null,{from:'2026-10-01',to:'2026-10-31'},null);
 assert.equal(sent.from,'2026-10-01');assert.equal(sent.to,'2026-10-31');
 assert.equal(sent.source,'supplier');assert.deepEqual(JSON.parse(JSON.stringify(sent.rowIds)),[]);
});
test('more than 25 selections fail closed without losing existing selection',()=>{
 const h=run(),state={partyId:'C1',party:{id:'C1'},showCorrections:false,waSelected:{}};
 for(let i=0;i<25;i++) assert.equal(h.call('waPartyLedgerToggle_','customer',state,row('R'+i,1,0,i+1),true),true);
 assert.equal(h.call('waPartyLedgerToggle_','customer',state,row('R26',1,0,26),true),false);
 assert.equal(Object.keys(state.waSelected).length,25);assert.match(h.messages.at(-1)[0],/25/);
});
test('correction mode and invalid/empty dates block sharing without touching preview',()=>{
 const h=run(),state={partyId:'C1',party:{id:'C1'},showCorrections:true,waSelected:{}};
 assert.equal(h.call('waPartyLedgerSend_','customer',state,'due',null,null,null),false);
 state.showCorrections=false;
 assert.equal(h.call('waPartyLedgerSend_','customer',state,'period',null,{from:'2026-11-01',to:'2026-10-01'},null),false);
 assert.equal(h.call('waPartyLedgerSend_','customer',state,'period',null,{from:'',to:'2026-10-01'},null),false);
 assert.equal(h.calls.length,0);
});
test('new party resets selections; no leakage across customer or supplier account',()=>{
 const h=run(),state={partyId:'C1',party:{id:'C1'},showCorrections:false,waSelected:{}};
 h.call('waPartyLedgerToggle_','customer',state,fixture[0],true);
 h.call('waPartyLedgerReset_',state);
 assert.equal(Object.keys(state.waSelected).length,0);
 assert.equal(h.call('waPartyLedgerSend_','customer',{...state,partyId:''},'due'),false);
});
test('permission-restricted sharing returns no request even when party exists',()=>{
 const h=run({whatsappShare:{edit:false},customers:{view:true}}),state={partyId:'C1',party:{id:'C1'},showCorrections:false,waSelected:{}};
 assert.equal(h.call('waPartyLedgerSend_','customer',state,'due'),false);
 assert.equal(h.call('waPartyLedgerToggle_','customer',state,fixture[0],true),false);
 assert.equal(h.calls.length,0);
});
test('both ledger screens integrate due, selected, row menu and print period in native UI',()=>{
 for(const [name,html] of [['customer',c],['supplier',s]]){
  const prefix=name+'Ledger';
  for(const id of [prefix+'ShareDueBtn',prefix+'ShareSelectedBtn',prefix+'SharePeriodBtn',prefix+'PrintShareBtn']){
   assert.ok(html.includes('id="'+id+'"'),name+': '+id);
  }
  assert.ok(html.includes('waPartyLedgerSend_'),name+' must use common share dispatcher');
  assert.ok(html.includes('waPartyLedgerToggle_'),name+' must use shared selection');
  assert.ok(html.includes('waPartyLedgerReset_'),name+' must reset selection on party change');
  assert.match(html,new RegExp('data-'+name+'-ledger-share-index'));
  assert.ok(html.includes('openRowActionMenu_'),name+' retain native Action menu');
 }
});
