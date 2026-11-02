'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const source=read('WhatsAppService.gs'),financeUi=read('financeLedger.html');
const customer=[
 {'Ledger ID':'CLEAN|customer|INV-1',Date:'2026-10-01',Type:'Sale',Reference:'INV-1',Debit:250,Credit:0,Balance:250,'Customer ID':'C1'},
 {'Ledger ID':'PAY-C',Date:'2026-10-02',Type:'Payment',Reference:'PAY-C',Debit:0,Credit:50,Balance:200,'Customer ID':'C1'}
];
const supplier=[
 {'Ledger ID':'SOURCE|supplier|PUR-1',Date:'2026-10-01',Type:'Purchase',Reference:'PUR-1',Debit:300,Credit:100,Balance:200,'Supplier ID':'S1'},
 {'Ledger ID':'PAY-S',Date:'2026-10-02',Type:'Payment',Reference:'PAY-S',Debit:0,Credit:75,Balance:125,'Supplier ID':'S1'}
];
const finance=[
 {financeId:'L1',date:'2026-10-01',personKey:'id:P1',personId:'P1',transactionType:'Loan Received',account:'loanPayable',amount:500,balance:500,referenceNo:'L1',notes:''},
 {financeId:'L2',date:'2026-10-02',personKey:'id:P1',personId:'P1',transactionType:'Loan Repayment',account:'loanPayable',amount:200,balance:300,referenceNo:'L2',notes:''},
 {financeId:'B1',date:'2026-10-03',personKey:'id:P1',personId:'P1',transactionType:'Borrower Loan',account:'borrowerReceivable',amount:150,balance:150,referenceNo:'B1',notes:''},
 {financeId:'OTHER',date:'2026-10-03',personKey:'id:P2',personId:'P2',transactionType:'Loan Received',account:'loanPayable',amount:900,balance:900,referenceNo:'OTHER',notes:''}
];
const types={
 'Loan Received':{key:'Loan Received',account:'loanPayable',role:'Lender',balanceEffect:1,label:'Lender Credit'},
 'Loan Repayment':{key:'Loan Repayment',account:'loanPayable',role:'Lender',balanceEffect:-1,label:'Lender Debit'},
 'Borrower Loan':{key:'Borrower Loan',account:'borrowerReceivable',role:'Borrower',balanceEffect:1,label:'Borrower Debit'}
};
const clone=x=>JSON.parse(JSON.stringify(x));
function harness({allow=true,phoneMissing=false,partyRows,financeOverride}={}){
 const writes=[],access=[],indices=partyRows||{customer,supplier};
 const sheets={
 CUSTOMERS:[{'Customer ID':'C1',Phone:phoneMissing?'':'01712345678'}],
 SUPPLIERS:[{'Supplier ID':'S1',Phone:'01812345678'}],
 FINANCE_PERSONS:[
  {'Person ID':'P1','Person Name':'Finance A','Roles':'Owner,Lender,Borrower',Phone:'01712345678'},
  {'Person ID':'P2','Person Name':'Finance B','Roles':'Lender',Phone:'01812345678'}
 ], WHATSAPP_SHARE_LOG:[]};
 let serial=0;
 const context={
 Date,Math,Set,JSON,console,
 requirePermission_:(token,module,action)=>{access.push({token,module,action});if(token!=='valid'||!allow)throw Error('Permission denied');return {'User ID':'USR-1','Role':'Administrator'};},
 getAllRows_:key=>sheets[key]||[],isDeleted_:row=>row['Is Deleted']==='TRUE',
 financePersonRoles_:row=>String(row.Roles||'').split(','),
 financeTransactionType_:key=>types[key]||null,
 getFinanceLedger:(token,filter)=>({success:true,data:{rows:(financeOverride||finance).filter(r=>r.personId===filter.personId).slice().reverse()}}),
 getSettingsMap_:()=>({'Currency Symbol':'৳','Shop Name':'ERP Shop'}),
 partyLedgerBusinessIdentity_:()=>({name:'ERP Shop'}),
 assertCustomerSalesIntegrity_:id=>{if(id!=='C1')throw Error('Integrity mismatch')},
 partyLedgerBuildDisplayIndex_:kind=>indices[kind],
 partyLedgerNormalizeFullRows_:(kind,rows)=>rows,
 partyLedgerSelectedParty_:(kind,id,rows)=>({id,name:kind==='customer'?'Customer A':'Supplier A',
  phone:kind==='customer'?(phoneMissing?'':'01712345678'):'01812345678',
  balance:rows.at(-1)?.Balance||0}),
 partyLedgerValidateStatementDates_:(from,to)=>{
   if(!/^\d{4}-\d{2}-\d{2}$/.test(String(from||''))||!/^\d{4}-\d{2}-\d{2}$/.test(String(to||''))||from>to||to>'2026-11-02')throw Error('Invalid period');
   return {from,to};
 },
 getPartyLedgerStatement_:(kind,token,id,from,to)=>{
   const period=context.partyLedgerValidateStatementDates_(from,to);
   const rows=indices[kind].filter(r=>r.Date>=from&&r.Date<=to),before=indices[kind].filter(r=>r.Date<from);
   return {party:{id,name:kind==='supplier'?'Supplier A':'Customer A',phone:kind==='supplier'?'01812345678':phoneMissing?'':'01712345678',balance:indices[kind].at(-1)?.Balance||0},
   business:{name:'ERP Shop'},rows,period:{from,to},openingBalance:before.at(-1)?.Balance||0,
   closingBalance:indices[kind].filter(r=>r.Date<=to).at(-1)?.Balance||0,
   periodDebit:rows.reduce((v,r)=>v+Number(r.Debit||0),0),
   periodCredit:rows.reduce((v,r)=>v+Number(r.Credit||0),0)};
 },
 ok_:data=>({success:true,data}),fail_:message=>({success:false,message:String(message)}),
 LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
 appendRow_:(sheet,row)=>{writes.push({sheet,row:clone(row)});sheets[sheet].push(clone(row))},
 generateId_:()=> 'WSA-'+ ++serial,logError_:(n,e)=>{throw e}
 };
 vm.createContext(context);vm.runInContext(source,context);
 const call=(fn,...args)=>{context.__args=args;return clone(vm.runInContext(fn+'(...__args)',context));};
 return {call,writes,access,indices};
}
const request=(source,entityId,mode,patch={})=>({source,entityId,mode,language:'en',...patch});
test('customer due preview produces authorized recipient and safely encoded wa.me text',()=>{
 const h=harness(),res=h.call('prepareWhatsAppMessage','valid',request('customer','C1','due'));
 assert.equal(res.success,true);assert.equal(res.data.recipient.digits,'8801712345678');
 assert.match(res.data.text,/Your total due: Tk 200/);
 assert.equal(decodeURIComponent(encodeURIComponent(res.data.text)),res.data.text);
 assert.match('https://wa.me/'+res.data.recipient.digits+'?text='+encodeURIComponent(res.data.text),/^https:\/\/wa\.me\/8801712345678/);
});
test('supplier period includes supplier payment and reconciled opening/closing',()=>{
 const h=harness(),r=h.call('prepareWhatsAppMessage','valid',request('supplier','S1','period',{from:'2026-10-01',to:'2026-10-02'}));
 assert.equal(r.success,true);assert.match(r.data.text,/Statement: 1–2 October 2026/);assert.match(r.data.text,/Current amount we owe you: Tk 125/);assert.doesNotMatch(r.data.text,/PAY-S|Opening balance|Closing balance/);
});
test('Lender statement follows finance relationship credit/debit, never other-person entries',()=>{
 const h=harness(),r=h.call('prepareWhatsAppMessage','valid',request('financePerson','P1','period',{accountRole:'Lender',from:'2026-10-01',to:'2026-10-02'}));
 assert.equal(r.success,true);assert.match(r.data.text,/Current loan amount we owe you: Tk 300/);assert.doesNotMatch(r.data.text,/OTHER|Tk 900|Credit|Debit/);
});
test('Borrower balance cannot silently include lender transactions',()=>{
 const h=harness(),r=h.call('prepareWhatsAppMessage','valid',request('financePerson','P1','due',{accountRole:'Borrower'}));
 assert.equal(r.success,true);assert.match(r.data.text,/Your remaining loan: Tk 150/);assert.doesNotMatch(r.data.text,/OTHER|Lender|Tk 900/);
});
test('future period and authorization fail; missing phone remains Copy only',()=>{
 const h=harness();assert.equal(h.call('prepareWhatsAppMessage','invalid',request('customer','C1','due')).success,false);
 assert.equal(h.call('prepareWhatsAppMessage','valid',request('customer','C1','period',{from:'2026-10-01',to:'2999-10-01'})).success,false);
 const r=harness({phoneMissing:true}).call('prepareWhatsAppMessage','valid',request('customer','C1','due'));
 assert.equal(r.success,true);assert.equal(r.data.canOpenLink,false);assert.equal(r.data.recipient,null);
});
test('25 selected supported, 26 rejected; no fabricated reconciled closing for disjoint set',()=>{
 const many=Array.from({length:26},(_,i)=>({'Ledger ID':'X'+i,Date:'2026-10-01',Type:'Payment',Reference:'PAY'+i,Debit:0,Credit:1,Balance:25-i,'Customer ID':'C1'}));
 const h=harness({partyRows:{customer:many,supplier}}),versions={};
 for(const row of many)versions[row['Ledger ID']]=h.call('whatsAppPartyRowVersion_',row);
 const r=request('customer','C1','selected',{rowIds:many.slice(0,25).map(r=>r['Ledger ID']),rowVersions:versions});
 const ok=h.call('prepareWhatsAppMessage','valid',r);
 assert.equal(ok.success,true);assert.match(ok.data.text,/Selected transactions: 25/);assert.doesNotMatch(ok.data.text,/Closing balance:/);
 assert.equal(h.call('prepareWhatsAppMessage','valid',{...r,rowIds:many.map(r=>r['Ledger ID'])}).success,false);
});
test('changed CLEAN synthetic row is blocked before any audit write',()=>{
 const h=harness(),id=customer[0]['Ledger ID'],version=h.call('whatsAppPartyRowVersion_',customer[0]);
 const changed=harness({partyRows:{customer:[{...customer[0],Debit:999},customer[1]],supplier}});
 const r=changed.call('prepareWhatsAppMessage','valid',request('customer','C1','single',{rowIds:[id],rowVersions:{[id]:version}}));
 assert.equal(r.success,false);assert.match(r.message,/changed|stale|refresh/i);assert.equal(changed.writes.length,0);
});
test('audit event is OPEN_ATTEMPTED only, no message or raw recipient stored',()=>{
 const h=harness(),evt={source:'customer',entityId:'C1',mode:'due',eventKey:'wa_20261102_integration_01'};
 const one=h.call('recordWhatsAppShare','valid',evt),two=h.call('recordWhatsAppShare','valid',evt);
 assert.equal(one.success,true);assert.equal(two.data.duplicate,true);assert.equal(one.data.status,'OPEN_ATTEMPTED');
 assert.equal(h.writes.length,1);assert.equal(h.writes[0].sheet,'WHATSAPP_SHARE_LOG');
 assert.doesNotMatch(JSON.stringify(h.writes[0].row),/SENT|DELIVERED|01712345678|8801712345678/);
});
test('Finance Ledger row menu offers guarded individual-person WhatsApp only',()=>{
 assert.match(financeUi,/function finLedCanWhatsAppRow_/);
 assert.match(financeUi,/function finLedShareWhatsAppRow_/);
 assert.match(financeUi,/action: 'whatsapp'|action:'whatsapp'/);
 assert.match(financeUi,/waFinanceRowVersion_/);
 assert.match(financeUi,/openWhatsAppShare_/);
});
