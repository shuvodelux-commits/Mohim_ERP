'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..');
const service=fs.readFileSync(path.join(root,'WhatsAppService.gs'),'utf8');
const config=fs.readFileSync(path.join(root,'Config.gs'),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const key='wa_20261102_abc12345';
const sourceView={source:'customer',entityId:'C1',mode:'selected',rowCount:2,
 party:{id:'C1',phone:'01712345678'},rows:[{id:'A'},{id:'B'}]};
function setup(opts={}){
 const db={WHATSAPP_SHARE_LOG:[]},writes=[],locks=[],calls=[];
 let locked=false,serial=0;
 const actor={'User ID':'USR-42','Full Name':'Operator','Mobile Number':'01798765432','Role':'Administrator'};
 const ctx={
  Date,Math,JSON,Object,Array,Set,console,
  requirePermission_:(token,module,operation)=>{
    calls.push(['permission',token,module,operation]);
    if(token!=='valid' || opts.deny===module)throw Error('Permission denied');
    return actor;
  },
  whatsAppBuildPartySource_:(token,q)=>{calls.push(['party',q.source,q.entityId,q.mode]);if(opts.builderFailure)throw Error(opts.builderFailure);return opts.view||sourceView},
  whatsAppBuildFinanceSource_:(token,q)=>{calls.push(['finance',q.accountRole]);return opts.view||{...sourceView,source:'financePerson',accountRole:q.accountRole,entityId:q.entityId};},
  getAllRows_:(sheet)=>{calls.push(['read',sheet]);if(sheet!=='WHATSAPP_SHARE_LOG')throw Error('Unexpected sheet read: '+sheet);return db[sheet];},
  appendRow_:(sheet,row)=>{
    if(opts.failAppend)throw Error('Audit log unavailable');
    writes.push({sheet,row:plain(row),locked});
    (db[sheet]||[]).push(plain(row));
  },
  generateId_:sheet=>{calls.push(['generate',sheet]);return 'WSA-'+String(++serial).padStart(6,'0');},
  LockService:{getScriptLock:()=>({
    waitLock(ms){if(locked)throw Error('Concurrent lock busy');locked=true;locks.push(['acquire',ms]);},
    releaseLock(){locks.push(['release']);locked=false;}
  })},
  whatsAppResolveRecipient_:(stored,override,confirmed)=>{
    calls.push(['normalize',stored,override,confirmed]);
    const value=String(override||stored||'');
    if(override && !confirmed)throw Error('Confirm changed WhatsApp recipient');
    if(!/^(?:\+?88)?01[3-9]\d{8}$/.test(value))throw Error('Invalid phone');
    return {digits:value.replace(/^\+/,'').replace(/^01/,'8801'),overridden:!!override};
  },
  ok_:data=>({success:true,data}),
  fail_:message=>({success:false,message:String(message)})
 };
 vm.createContext(ctx);vm.runInContext(service,ctx,{filename:'WhatsAppService.gs'});
 // Isolate audit boundary: ensure it calls authorized source builders, no actual Sheets.
 ctx.whatsAppBuildPartySource_=(token,q)=>{calls.push(['party',q.source,q.entityId,q.mode]);if(opts.builderFailure)throw Error(opts.builderFailure);return opts.view||sourceView};
 ctx.whatsAppBuildFinanceSource_=(token,q)=>{calls.push(['finance',q.accountRole]);if(opts.builderFailure)throw Error(opts.builderFailure);return opts.view||{...sourceView,source:'financePerson',accountRole:q.accountRole,entityId:q.entityId};};
 return {db,writes,locks,calls,actor,call:(token,request)=>{ctx.__token=token;ctx.__request=request;return plain(vm.runInContext('recordWhatsAppShare(__token,__request)',ctx));}};
}
const req=(patch={})=>({source:'customer',entityId:'C1',mode:'selected',rowIds:['A','B'],
 rowVersions:{A:'v1',B:'v2'},eventKey:key,...patch});

test('schema declares only a separate audit sheet, immutable status and additive prefix',()=>{
 const ctx={};vm.createContext(ctx);vm.runInContext(config+';this.__cfg=CONFIG;',ctx);
 const cfg=ctx.__cfg;
 assert.equal(cfg.SHEETS.WHATSAPP_SHARE_LOG,'WhatsApp Share Log');
 assert.equal(cfg.ID_PREFIX.WHATSAPP_SHARE_LOG,'WSA');
 assert.deepEqual(plain(cfg.HEADERS.WHATSAPP_SHARE_LOG),[
  'Event ID','Event Key','Timestamp','Actor','Source','Entity ID','Account Role',
  'Mode','Row Count','Recipient Last4','Recipient Override','Status'
 ]);
 for(const field of cfg.HEADERS.WHATSAPP_SHARE_LOG) assert.doesNotMatch(field,/message|full phone|bank account|delivery|sent/i);
});

test('legitimate click appends exactly one OPEN_ATTEMPTED, no message or raw phone',()=>{
 const h=setup(),result=h.call('valid',req());
 assert.equal(result.success,true);
 assert.equal(result.data.status,'OPEN_ATTEMPTED');
 assert.equal(result.data.duplicate,false);
 assert.equal(h.writes.length,1);
 const log=h.writes[0];
 assert.equal(log.sheet,'WHATSAPP_SHARE_LOG');assert.equal(log.locked,true);
 assert.equal(log.row['Event ID'],'WSA-000001');
 assert.equal(log.row['Event Key'],key);
 assert.equal(log.row.Actor,'USR-42');assert.equal(log.row.Source,'customer');
 assert.equal(log.row['Entity ID'],'C1');assert.equal(log.row.Mode,'selected');
 assert.equal(log.row['Row Count'],2);assert.equal(log.row['Recipient Last4'],'5678');
 assert.equal(log.row['Recipient Override'],false);
 assert.equal(log.row.Status,'OPEN_ATTEMPTED');
 assert.match(log.row.Timestamp,/^\d{4}-\d{2}-\d{2}T/);
 assert.doesNotMatch(JSON.stringify(log.row),/01712345678|8801712345678|Operator|Notes|Due balance|DELIVERED|SENT/);
 assert.deepEqual(h.locks.map(x=>x[0]),['acquire','release']);
});

test('same actor/event key is exactly-once even on retried RPC',()=>{
 const h=setup(),r=req();
 const a=h.call('valid',r),b=h.call('valid',r);
 assert.equal(a.success,true);assert.equal(b.success,true);
 assert.equal(a.data.eventId,b.data.eventId);assert.equal(b.data.duplicate,true);
 assert.equal(h.writes.length,1);assert.equal(h.calls.filter(x=>x[0]==='generate').length,1);
});

test('replayed event key cannot be reused for a different person, role or source',()=>{
 const h=setup();
 assert.equal(h.call('valid',req()).success,true);
 for(const patch of [{entityId:'C2'},{source:'supplier'},{mode:'due'},{accountRole:'Lender'}]){
  const r=h.call('valid',req(patch));assert.equal(r.success,false);
 }
 assert.equal(h.writes.length,1);
});

test('invalid token or missing sharing permission produces no sheet reads or writes',()=>{
 for(const opts of [{}, {deny:'whatsappShare'}]){
  const h=setup(opts),r=h.call(opts.deny?'valid':'expired',req({eventKey:'bad'}));
  assert.equal(r.success,false);assert.equal(h.writes.length,0);
  assert.equal(h.calls.filter(x=>x[0]==='read').length,0);
 }
});

test('invalid event key fails closed before append',()=>{
 for(const eventKey of ['', 'short','wa/'.repeat(40), 'a'.repeat(160),123]){
  const h=setup(),r=h.call('valid',req({eventKey}));
  assert.equal(r.success,false);assert.equal(h.writes.length,0);
 }
});

test('client-provided audit amounts and rowCount are never trusted',()=>{
 const h=setup(),result=h.call('valid',req({rowCount:99999,totalDebit:900000,message:'secret'}));
 assert.equal(result.success,true);
 assert.equal(h.writes[0].row['Row Count'],2);
 assert.doesNotMatch(JSON.stringify(h.writes[0].row),/99999|900000|secret/);
});

test('confirmed changed recipient stores only last four digits and override TRUE',()=>{
 const h=setup();
 const result=h.call('valid',req({recipientOverride:'01912345678',confirmOverride:true}));
 assert.equal(result.success,true);assert.equal(h.writes[0].row['Recipient Last4'],'5678');
 assert.equal(h.writes[0].row['Recipient Override'],true);
 assert.doesNotMatch(JSON.stringify(h.writes[0].row),/01912345678|8801912345678/);
});

test('unconfirmed recipient override fails without audit write',()=>{
 const h=setup(),r=h.call('valid',req({recipientOverride:'01912345678'}));
 assert.equal(r.success,false);assert.equal(h.writes.length,0);
});

test('Finance attempts require selected person role and never persist account details',()=>{
 const h=setup({view:{...sourceView,source:'financePerson',accountRole:'Lender',entityId:'P1',mode:'due',rowCount:1,
 party:{id:'P1',phone:'01712345678'}}});
 const r=h.call('valid',req({source:'financePerson',entityId:'P1',accountRole:'Lender',mode:'due',rowIds:[],rowVersions:{}}));
 assert.equal(r.success,true);
 const row=h.writes[0].row;
 assert.equal(row.Source,'financePerson');assert.equal(row['Account Role'],'Lender');
 assert.equal(row['Entity ID'],'P1');assert.equal(row['Row Count'],1);
 assert.deepEqual(h.calls.filter(x=>x[0]==='finance'),[['finance','Lender']]);
 assert.equal(JSON.stringify(row).includes('bankAccount'),false);
});

test('stale or forbidden source builder errors do not create audit rows',()=>{
 const h=setup({builderFailure:'Selected Finance transaction changed'});
 const result=h.call('valid',req());assert.equal(result.success,false);
 assert.match(result.message,/changed/);assert.equal(h.writes.length,0);
});

test('audit append failure is not a delivery acknowledgement and lock is released',()=>{
 const h=setup({failAppend:true}),r=h.call('valid',req());
 assert.equal(r.success,false);
 assert.match(r.message,/Audit log unavailable/);
 assert.equal(h.writes.length,0);
 assert.deepEqual(h.locks.map(x=>x[0]),['acquire','release']);
});

test('audit endpoint never requires an active cash session or writes account tables',()=>{
 const h=setup(),r=h.call('valid',req());
 assert.equal(r.success,true);
 assert.deepEqual([...new Set(h.writes.map(w=>w.sheet))],['WHATSAPP_SHARE_LOG']);
 assert.equal(h.calls.filter(x=>x[0]==='permission').some(x=>x[2]==='cashSession'),false);
});
