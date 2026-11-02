'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','WhatsAppService.gs'),'utf8');
const plain=x=>JSON.parse(JSON.stringify(x));
const base={
 source:'customer',entityId:'C-1',mode:'due',
 business:{name:'Example Hardware',nameBangla:'উদাহরণ হার্ডওয়্যার'},
 party:{id:'C-1',name:'Rahim',phone:'01712345678'},
 currentBalance:1250.5,balanceKind:'customer_due',
 rows:[],rowCount:0,totalDebit:0,totalCredit:0,openingBalance:null,closingBalance:null,period:null
};
function harness({view=base,settings={'Currency Symbol':'৳'}}={}){
 const calls=[],log=[];
 const ctx={console,Date, getSettingsMap_:()=>settings,
  requirePermission_:(token,module,action)=>{if(token!=='valid')throw Error('Permission denied');return {Role:'Administrator'};},
  ok_:data=>({success:true,data}),fail_:message=>({success:false,message}),
  logError_:(name,err)=>log.push([name,err.message])};
 vm.createContext(ctx);vm.runInContext(source,ctx,{filename:'WhatsAppService.gs'});
 ctx.whatsAppBuildPartySource_=(token,request)=>{calls.push(['party',token,request.source,request.entityId,request.mode]);if(token!=='valid')throw Error('Unauthorized');return view};
 ctx.whatsAppBuildFinanceSource_=(token,request)=>{calls.push(['finance',token,request.accountRole,request.entityId,request.mode]);if(token!=='valid')throw Error('Unauthorized');return view};
 return {compose:(data,language)=>vm.runInContext('whatsAppComposeText_(__data,__language)',Object.assign(ctx,{__data:data,__language:language})),
  prepare:(token,request)=>vm.runInContext('prepareWhatsAppMessage(__token,__request)',Object.assign(ctx,{__token:token,__request:request})),
  calls,log};
}
function view(patch={}){return {...base,...patch}}
function item(i,amount=10){return {'Ledger ID':'LED-'+i,Date:'2026-10-'+String(i).padStart(2,'0'),Type:'Sale',Reference:'INV-'+i,Debit:amount,Credit:0,Balance:amount};}
test('exact English customer due message includes shop, recipient and taka amount',()=>{
 const t=harness().compose(base,'en');
 assert.equal(t,'*Example Hardware*\n\nRahim\n\n*Your total due: Tk 1,250.50*\n\nThank you.');
});

test('exact Bangla due message uses Bangla shop name and natural ledger wording',()=>{
 const t=harness().compose(view({party:{...base.party,name:'রহিম'}}),'bn');
 assert.equal(t,'*উদাহরণ হার্ডওয়্যার*\n\nরহিম\n\n*আপনার মোট বাকি: ১,২৫০.৫০ টাকা*\n\nধন্যবাদ।');
});

test('customer credit is never mislabeled as customer due',()=>{
 const t=harness().compose(view({currentBalance:-45.25,balanceKind:'customer_credit'}),'en');
 assert.match(t,/Your advance deposit: Tk 45\.25/);
 assert.doesNotMatch(t,/Your total due|Tk -45/);
});

test('supplier payable and supplier advance receive distinct labels',()=>{
 const h=harness();
 assert.match(h.compose(view({source:'supplier',currentBalance:100,balanceKind:'supplier_payable'}),'en'),/Amount we owe you: Tk 100/);
 assert.match(h.compose(view({source:'supplier',currentBalance:-30,balanceKind:'supplier_advance'}),'bn'),/আপনার কাছে আমাদের অগ্রিম: ৩০ টাকা/);
});

test('finance lender, borrower and owner respect relationship balance labels',()=>{
 const h=harness();
 for(const [role,kind,expected,amount] of [
  ['Lender','lender_credit','Loan amount we owe you: Tk 500',500],
  ['Lender','lender_debit','Extra loan repayment made to you: Tk 500',-500],
  ['Borrower','borrower_debit','Your remaining loan: Tk 500',500],
  ['Borrower','borrower_credit','Your extra repayment: Tk 500',-500],
  ['Owner','owner_credit','Your capital in the shop: Tk 500',500],
  ['Owner','owner_debit','Withdrawn beyond your capital: Tk 500',-500]
 ]){
  const t=h.compose(view({source:'financePerson',accountRole:role,currentBalance:amount,balanceKind:kind}),'en');
  assert.ok(t.includes(expected),kind);
 }
});

test('settled zero balance is neutral for every source',()=>{
 const h=harness();
 for(const sourceKind of ['customer','supplier','financePerson']){
  const t=h.compose(view({source:sourceKind,accountRole:sourceKind==='financePerson'?'Lender':undefined,currentBalance:0,balanceKind:'settled'}),'en');
  assert.match(t,/\*Nothing outstanding between us\.\*/);
  assert.doesNotMatch(t,/Your total due|Amount we owe you|Loan amount we owe you/);
 }
});

test('single transaction includes only invoice amount and the full current balance',()=>{
 const t=harness().compose(view({mode:'single',rows:[item(5,125)],rowCount:1,totalDebit:125}),'en');
 assert.match(t,/Invoice INV-5: Tk 125/);
 assert.match(t,/Your total due: Tk 1,250\.50/);
 assert.doesNotMatch(t,/2026-10-05|Debit|Credit|Opening balance|Closing balance/);
});

test('finance single transaction uses local relationship language, never bank or private notes',()=>{
 const row={financeId:'F-2',date:'2026-10-10',transactionType:'Loan Received',transactionTypeLabel:'Lender Credit',referenceNo:'REF-F2',debit:0,credit:1000,balance:1000,bankAccountName:'PRIVATE BANK',notes:'SECRET MEMO'};
 const t=harness().compose(view({source:'financePerson',accountRole:'Lender',mode:'single',rows:[row],rowCount:1,balanceKind:'lender_credit'}),'en');
 assert.match(t,/Loan received from you: Tk 1,000/);
 assert.doesNotMatch(t,/PRIVATE BANK|SECRET MEMO|Bank Account|REF-F2|Credit|Debit/);
});

test('period with 13 entries stays compact and labels CURRENT account balance',()=>{
 const rows=Array.from({length:13},(_,i)=>item(i+1,100));
 const data=view({mode:'period',period:{from:'2026-10-01',to:'2026-10-31'},rows,rowCount:13,
  openingBalance:50,totalDebit:1300,totalCredit:0,closingBalance:1350,currentBalance:1400});
 const t=harness().compose(data,'en');
 assert.match(t,/Statement: 1–31 October 2026/);
 assert.match(t,/Your current total due: Tk 1,400/);
 assert.doesNotMatch(t,/Showing 12|Total debit|Closing balance|INV-13|INV-1/);
});

test('empty period shows selected dates and the authoritative CURRENT balance',()=>{
 const t=harness().compose(view({mode:'period',period:{from:'2026-10-10',to:'2026-10-12'},rows:[],rowCount:0,openingBalance:500,closingBalance:500}),'en');
 assert.match(t,/Statement: 10–12 October 2026/);
 assert.match(t,/Your current total due: Tk 1,250\.50/);
 assert.doesNotMatch(t,/Opening balance|Closing balance|Showing 12|No transactions/);
});

test('selected rows show count but never imply date-range reconciliation',()=>{
 const t=harness().compose(view({mode:'selected',rows:[item(1),item(3)],rowCount:2,totalDebit:20}),'en');
 assert.match(t,/Selected transactions: 2/);
 assert.match(t,/Your total due: Tk 1,250\.50/);
 assert.doesNotMatch(t,/Total debit|Opening balance|Closing balance|Period:|INV-1|INV-3/);
});

test('clean untrusted names and references as plain single-line text without HTML encoding',()=>{
 const t=harness().compose(view({
  business:{name:'<Shop>\nURGENT',nameBangla:''},
  party:{...base.party,name:'Rahim\nPAY NOW'},
  mode:'single',rows:[{...item(2),Reference:'INV-2\nPAY NOW'}]
 }),'en');
 assert.match(t,/<Shop>/);
 assert.equal(t.split('\n')[0],'*<Shop> URGENT*');
 assert.doesNotMatch(t,/&lt;|Rahim\nPAY NOW|INV-2\nPAY NOW/);
 assert.match(t,/Invoice INV-2 PAY NOW/);
});

test('authenticated preview ignores client-provided amounts and returns normalized recipient',()=>{
 const h=harness();
 const res=plain(h.prepare('valid',{source:'customer',entityId:'C-1',mode:'due',language:'en',currentBalance:999999,party:{name:'Fake',phone:'01999999999'}}));
 assert.equal(res.success,true);assert.equal(res.data.recipient.digits,'8801712345678');
 assert.equal(res.data.partyName,'Rahim');assert.equal(res.data.source,'customer');
 assert.equal(res.data.text.includes('1,250.50'),true);assert.equal(res.data.text.includes('999,999'),false);
 assert.equal(res.data.canOpenLink,true);
 assert.deepEqual(h.calls,[['party','valid','customer','C-1','due']]);
});
test('missing or malformed stored phone still permits copy but blocks WhatsApp opening',()=>{
 for(const phone of ['', '123',null]){
  const h=harness({view:view({party:{...base.party,phone}})});
  const res=plain(h.prepare('valid',{source:'customer',entityId:'C-1',mode:'due',language:'bn'}));
  assert.equal(res.success,true);assert.equal(res.data.canOpenLink,false);assert.equal(res.data.recipient,null);
  assert.ok(res.data.warnings.some(x=>/phone|নম্বর/i.test(x)));
  assert.ok(res.data.text.includes('১,২৫০.৫০ টাকা'));
 }
});

test('recipient override requires confirmation and does not persist contact changes',()=>{
 const h=harness(),q={source:'customer',entityId:'C-1',mode:'due',language:'en',recipientOverride:'01912345678'};
 assert.equal(h.prepare('valid',q).success,false);
 const ok=plain(h.prepare('valid',{...q,confirmOverride:true}));
 assert.equal(ok.success,true);assert.equal(ok.data.recipient.digits,'8801912345678');
 assert.equal(ok.data.recipient.overridden,true);
 assert.equal(base.party.phone,'01712345678');
});
test('Finance Person preview dispatch requires accountRole',()=>{
 const h=harness({view:view({source:'financePerson',accountRole:'Lender',balanceKind:'lender_credit',party:{id:'P-1',name:'Ali',phone:'01912345678'}})});
 const response=plain(h.prepare('valid',{source:'financePerson',entityId:'P-1',accountRole:'Lender',mode:'due',language:'en'}));
 assert.equal(response.success,true);assert.equal(h.calls[0][0],'finance');assert.equal(h.calls[0][2],'Lender');
});
test('missing or invalid language and source cannot bypass message validation',()=>{
 const h=harness();
 assert.equal(h.prepare('valid',{source:'customer',entityId:'C-1',mode:'due',language:'fr'}).success,false);
 assert.equal(h.prepare('invalid',{source:'customer',entityId:'C-1',mode:'due',language:'en'}).success,false);
 assert.equal(h.prepare('valid',{source:'all',entityId:'C-1',mode:'due',language:'en'}).success,false);
});
test('very long business name still respects the 8000 encoded-character WhatsApp link guard',()=>{
 const longName='X'.repeat(8100);
 const h=harness({view:view({business:{name:longName,nameBangla:longName}})});
 const result=plain(h.prepare('valid',{source:'customer',entityId:'C-1',mode:'due',language:'en'}));
 assert.equal(result.success,true);
 assert.equal(result.data.canOpenLink,false);
 assert.ok(result.data.warnings.some(x=>/copy|long|দীর্ঘ/i.test(x)));
 assert.ok(result.data.text.includes(longName));
});

test('authenticated preview checks session before validating malicious or missing request source',()=>{
 const h=harness();
 const result=plain(h.prepare('invalid',{source:'not-a-source',mode:'due',language:'en'}));
 assert.equal(result.success,false);
 assert.match(result.message,/permission|session/i);
 assert.deepEqual(h.calls,[]);
});
test('negative balances in dated statements show advance, not a negative due',()=>{
 const h=harness();
 const result=h.compose(view({mode:'period',period:{from:'2026-10-01',to:'2026-10-10'},
   rows:[],rowCount:0,openingBalance:-25,closingBalance:-25,currentBalance:-25,balanceKind:'customer_credit'}),'en');
 assert.match(result,/Your advance deposit: Tk 25/);
 assert.doesNotMatch(result,/Tk -25|Your current total due|Opening balance|Closing balance/);
});

