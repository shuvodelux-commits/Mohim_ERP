'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=path=>fs.readFileSync(require('node:path').join(root,path),'utf8');
const shared=read('whatsappShare.html'),script=shared.match(/<script>([\s\S]*?)<\/script>/)[1];
const serverSource=read('WhatsAppService.gs'),financePage=read('financePersonLedger.html');
const lender={financeId:'F1',date:'2026-10-01',transactionType:'Loan Received',
 transactionTypeLabel:'Lender Credit',account:'loanPayable',personId:'P1',
 amount:1500,referenceNo:'LOAN-1',notes:'memo',balance:1500,debit:0,credit:1500};
const loanPayment={...lender,financeId:'F2',date:'2026-10-02',
 transactionType:'Loan Repayment',transactionTypeLabel:'Lender Debit',
 amount:500,balance:1000,debit:500,credit:0};
const borrower={...lender,financeId:'B1',transactionType:'Borrower Loan',
 account:'borrowerReceivable',transactionTypeLabel:'Borrower Debit',
 debit:1200,credit:0,amount:1200,balance:1200};
const person={id:'P1',name:'Person One',status:'Active',roles:['Owner','Lender','Borrower']};
const plain=x=>JSON.parse(JSON.stringify(x));
function rig(permissions=null){
 const calls=[],toasts=[],elements={};
 for(const id of ['fplShareBalanceBtn','fplShareSelectedBtn','fplSharePeriodBtn'])
  elements[id]={hidden:false,disabled:false,textContent:'',setAttribute(){},removeAttribute(){}};
 const ctx={console,Date,JSON,Object,Array,Set,Promise,userPermissions:permissions,
 document:{readyState:'loading',addEventListener(){},activeElement:{id:'trigger'},getElementById:id=>elements[id]||null},
 showToast:(msg,level)=>toasts.push([msg,level])};
 vm.createContext(ctx);
 vm.runInContext(script,ctx,{filename:'whatsappShare.html'});
 ctx.openWhatsAppShare_=(request,trigger)=>{calls.push({request:plain(request),trigger});return request};
 const server={};vm.createContext(server);vm.runInContext(serverSource,server,{filename:'WhatsAppService.gs'});
 return {calls,toasts,elements,server,ctx,call:(fn,...args)=>{ctx.__args=args;return vm.runInContext(fn+'(...__args)',ctx)}};
}
function state(account='Lender'){
 return {persons:[person],personId:'P1',account,rows:[lender,loanPayment,borrower],waFinanceSelected:{},
  transactionTypes:[{key:'Loan Received',role:'Lender',balanceEffect:1,account:'loanPayable'},{key:'Loan Repayment',role:'Lender',balanceEffect:-1,account:'loanPayable'},
  {key:'Borrower Loan',role:'Borrower',balanceEffect:1,account:'borrowerReceivable'}]};
}
test('Finance UI row fingerprint equals authoritative finance source signature, not cash debit/credit',()=>{
 const h=rig(),client=h.call('waFinanceRowVersion_',lender,'Lender','P1');
 assert.equal(client,h.server.whatsAppFinanceRowVersion_({...lender,accountRole:'Lender'}));
 assert.notEqual(client,h.call('waFinanceRowVersion_',loanPayment,'Lender','P1'));
 assert.notEqual(client,h.call('waFinanceRowVersion_',lender,'Borrower','P1'));
 assert.notEqual(client,h.call('waFinanceRowVersion_',{...lender,amount:1501},'Lender','P1'));
 assert.notEqual(client,h.call('waFinanceRowVersion_',{...lender,balance:1501},'Lender','P1'));
});
test('finance sharing requires finance view and whatsappShare.edit, with role verified',()=>{
 const h=rig({whatsappShare:{edit:true},finance:{view:true}});
 assert.equal(h.call('waFinanceCanShare_',state('Lender')),true);
 assert.equal(h.call('waFinanceCanShare_',{...state(),account:'Unknown'}),false);
 assert.equal(h.call('waFinanceCanShare_',{...state(),account:'Lender',persons:[{...person,roles:['Owner']}]}),false);
 h.ctx.userPermissions={whatsappShare:{edit:true},finance:{view:false,edit:true}};
 assert.equal(h.call('waFinanceCanShare_',state()),false);
 h.ctx.userPermissions={whatsappShare:{view:true},finance:{view:true}};
 assert.equal(h.call('waFinanceCanShare_',state()),false);
});
test('Finance current balance and period requests are account role scoped, never all persons',()=>{
 const h=rig(),st=state('Lender');
 const due=plain(h.call('waFinanceSend_',st,'due'));
 assert.deepEqual([due.source,due.entityId,due.accountRole,due.mode],['financePerson','P1','Lender','due']);
 assert.deepEqual(due.rowIds,[]);
 const period=plain(h.call('waFinanceSend_',st,'period',null,{from:'2026-10-01',to:'2026-10-31'}));
 assert.equal(period.from,'2026-10-01');assert.equal(period.to,'2026-10-31');
 assert.deepEqual(period.rowIds,[]);
 assert.equal(h.calls.length,2);
});
test('single Finance row carries exact Finance ID and version, not bank fields',()=>{
 const h=rig(),q=plain(h.call('waFinanceSend_',state(),'single',lender));
 assert.deepEqual(q.rowIds,['F1']);assert.equal(q.rowVersions.F1,h.call('waFinanceRowVersion_',lender,'Lender','P1'));
 assert.equal(JSON.stringify(q).includes('bankAccount'),false);
});
test('Finance selected cross-page rows preserve order and are 25 limited',()=>{
 const h=rig(),st=state();
 assert.equal(h.call('waFinanceToggle_',st,lender,true),true);
 assert.equal(h.call('waFinanceToggle_',st,loanPayment,true),true);
 const q=plain(h.call('waFinanceSend_',st,'selected'));
 assert.deepEqual(q.rowIds,['F1','F2']);assert.equal(Object.keys(q.rowVersions).length,2);
 for(let i=3;i<=25;i++) assert.equal(h.call('waFinanceToggle_',st,{...lender,financeId:'F'+i},true),true);
 assert.equal(h.call('waFinanceToggle_',st,{...lender,financeId:'F26'},true),false);
 assert.equal(Object.keys(st.waFinanceSelected).length,25);assert.match(h.toasts.at(-1)[0],/25/);
});
test('Finance selection rejects cross-person and cross-role row even if visible',()=>{
 const h=rig(),st=state();
 assert.equal(h.call('waFinanceToggle_',st,borrower,true),false);
 assert.equal(h.call('waFinanceToggle_',st,{...lender,personId:'P2'},true),false);
 assert.equal(h.call('waFinanceSend_',st,'single',borrower),false);
 assert.equal(h.calls.length,0);
});
test('role/person changes reset Finance selections and prevent carryover',()=>{
 const h=rig(),st=state();
 h.call('waFinanceToggle_',st,lender,true);
 h.call('waFinanceReset_',st);
 assert.equal(Object.keys(st.waFinanceSelected).length,0);
 st.account='Borrower';
 assert.equal(h.call('waFinanceSend_',st,'selected'),false);
 st.personId='P2';
 assert.equal(h.call('waFinanceSend_',st,'due'),false);
});
test('invalid, missing or future period must never request a preview',()=>{
 const h=rig(),st=state();
 for(const d of [{from:'',to:'2026-10-31'},{from:'2026-10-31',to:'2026-10-01'},{from:'2999-01-01',to:'2999-02-01'}]){
  assert.equal(h.call('waFinanceSend_',st,'period',null,d),false);
 }
 assert.equal(h.calls.length,0);
});
test('Finance UI preserves current ledger actions and prints while adding WhatsApp controls',()=>{
 for(const id of ['fplShareBalanceBtn','fplShareSelectedBtn','fplSharePeriodBtn'])assert.ok(financePage.includes('id="'+id+'"'));
 assert.match(financePage,/waFinanceSend_/);assert.match(financePage,/waFinanceToggle_/);
 assert.match(financePage,/waFinanceReset_/);
 assert.match(financePage,/data-fpl-wa-check/);
 assert.match(financePage,/openRowActionMenu_/);
 assert.match(financePage,/finPersonLedgerPrint_/);
 assert.match(financePage,/finLedDelete_/);
});
