'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const finance=fs.readFileSync(path.join(root,'FinanceModule.gs'),'utf8');
const service=fs.readFileSync(path.join(root,'WhatsAppService.gs'),'utf8');
const basePeople=[
 {'Person ID':'P1','Person Name':'Alpha','Roles':'Owner,Lender,Borrower','Phone':'01712345678','Status':'Active'},
 {'Person ID':'P2','Person Name':'Beta','Roles':'Lender','Phone':'01812345678','Status':'Active'}
];
function tx(id,date,type,amount,personId='P1',name=personId==='P1'?'Alpha':'Beta',more={}){
 return {'Finance ID':id,'Date':date,'Transaction Type':type,'Amount':amount,
   'Person ID':personId,'Person':name,'Reference No':id+'-REF','Notes':'','Is Deleted':'',...more};
}
const baseRows=[
 tx('F1','2026-10-01','Opening Loan',20000),
 tx('F2','2026-10-10','Loan Received',10000),
 tx('F3','2026-10-14','Loan Repayment',5000),
 tx('B1','2026-10-01','Opening Borrower Loan',12000),
 tx('B2','2026-10-12','Borrower Repayment',2000),
 tx('O1','2026-10-01','Opening Owner Capital',80000),
 tx('O2','2026-10-13','Owner Withdrawal',3000),
 tx('OTHER','2026-10-10','Loan Received',9000,'P2','Beta')
];
const plain=x=>JSON.parse(JSON.stringify(x));
function rig({rows=baseRows,people=basePeople,allow=true,failLedger=false}={}){
 const reads=[],authorizations=[],writes=[];
 const sandbox={
  console,
  getAllRows_:name=>{reads.push(name);if(name==='FINANCE_PERSONS')return people;if(name==='FINANCE_TRANSACTIONS')return rows;return []},
  activeRows_:name=>{reads.push(name);return name==='FINANCE_TRANSACTIONS'?rows.filter(r=>r['Is Deleted']!=='TRUE'):[]},
  isDeleted_:row=>row['Is Deleted']==='TRUE',
  getSettingsMap_:()=>({'Shop Name':'Example Shop','Currency Symbol':'৳'}),
  partyLedgerBusinessIdentity_:()=>({name:'Example Shop'}),
  partyLedgerValidateStatementDates_:(from,to)=>{
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(from||'')) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(String(to||''))) throw Error('Invalid date range');
    if (from>to) throw Error('Invalid date range');
    if (to>'2026-11-02') throw Error('Future statement date');
    return {from,to};
  },
  sanitizeInput_:x=>String(x==null?'':x).trim(),
  safeDateOnly_:x=>String(x||'').slice(0,10),
  roundMoney_:x=>Math.round(Number(x)*100)/100,
  ok_:data=>({success:true,data}),
  fail_:message=>({success:false,message}),
  logError_:(name,err)=>{throw Error('Unexpected finance ledger error: '+err.message)},
  requirePermission_:(token,mod,action)=>{
   authorizations.push([mod,action]);
   if(token!=='valid'||!allow)throw Error('Permission denied');
   return {Role:'Administrator'};
  },
  appendRow_:(...args)=>{writes.push(args);throw Error('Financial write forbidden')}
 };
 vm.createContext(sandbox);
 vm.runInContext(finance,sandbox,{filename:'FinanceModule.gs'});
 vm.runInContext(service,sandbox,{filename:'WhatsAppService.gs'});
 return {call:(name,...args)=>{sandbox.__args=args;return vm.runInContext(name+'(...__args)',sandbox)},
  reads,authorizations,writes};
}
const q=(accountRole,mode,extra={})=>({source:'financePerson',entityId:'P1',accountRole,mode,...extra});
test('lender loan received is relationship Credit and repayment is Debit (not cash-direction fields)',()=>{
 const h=rig(),result=plain(h.call('whatsAppBuildFinanceSource_','valid',q('Lender','period',{from:'2026-10-10',to:'2026-10-14'})));
 assert.equal(result.account,'loanPayable');
 assert.deepEqual(result.rows.map(r=>[r.financeId,r.debit,r.credit,r.balance]),[
   ['F3',5000,0,25000],['F2',0,10000,30000]]);
 assert.equal(result.openingBalance,20000);
 assert.equal(result.closingBalance,25000);
 assert.equal(result.totalDebit,5000);assert.equal(result.totalCredit,10000);
 assert.equal(result.currentBalance,25000);assert.equal(result.balanceKind,'lender_credit');
 assert.equal(result.party.phone,'01712345678');
 assert.equal(result.business.name,'Example Shop');
 assert.ok(h.authorizations.some(x=>x[0]==='whatsappShare'&&x[1]==='edit'));
 assert.ok(h.authorizations.some(x=>x[0]==='finance'&&x[1]==='view'));
 assert.equal(h.writes.length,0);
});
test('borrower opening is relationship Debit and repayment is Credit',()=>{
 const h=rig(),r=plain(h.call('whatsAppBuildFinanceSource_','valid',q('Borrower','period',{from:'2026-10-01',to:'2026-10-12'})));
 assert.deepEqual(r.rows.map(x=>[x.financeId,x.debit,x.credit]),[['B2',0,2000],['B1',12000,0]]);
 assert.equal(r.closingBalance,10000);assert.equal(r.currentBalance,10000);
 assert.equal(r.balanceKind,'borrower_debit');
 assert.equal(r.openingBalance,0);
});
test('owner capital is Credit, withdrawal Debit and does not mix lender entries',()=>{
 const h=rig(),r=plain(h.call('whatsAppBuildFinanceSource_','valid',q('Owner','period',{from:'2026-10-01',to:'2026-10-14'})));
 assert.deepEqual(r.rows.map(x=>[x.financeId,x.debit,x.credit]),[['O2',3000,0],['O1',0,80000]]);
 assert.equal(r.currentBalance,77000);assert.equal(r.balanceKind,'owner_credit');
});
test('empty period preserves opening and closing at that date, current balance remains current',()=>{
 const h=rig(),r=h.call('whatsAppBuildFinanceSource_','valid',q('Lender','period',{from:'2026-10-11',to:'2026-10-13'}));
 assert.equal(r.openingBalance,30000);assert.equal(r.closingBalance,30000);
 assert.equal(r.currentBalance,25000);assert.equal(r.rows.length,0);
 assert.equal(r.totalDebit,0);assert.equal(r.totalCredit,0);
});
test('due mode returns only role-specific current balance and no private bank account fields',()=>{
 const h=rig(),r=plain(h.call('whatsAppBuildFinanceSource_','valid',q('Lender','due')));
 assert.equal(r.rows.length,0);assert.equal(r.currentBalance,25000);
 assert.equal(JSON.stringify(r).includes('bankAccountId'),false);
 assert.equal(JSON.stringify(r).includes('bankAccountName'),false);
 assert.equal(JSON.stringify(r).includes('OTHER-REF'),false);
});
test('single and disjoint selected entries use stable Finance IDs with row versions',()=>{
 const h=rig(),selected=h.call('whatsAppBuildFinanceSource_','valid',q('Lender','period',{from:'2026-10-01',to:'2026-10-14'}));
 const versions=Object.fromEntries(selected.rows.map(r=>[r.financeId,h.call('whatsAppFinanceRowVersion_',r)]));
 const r=plain(h.call('whatsAppBuildFinanceSource_','valid',q('Lender','selected',{rowIds:['F1','F3'],rowVersions:versions})));
 assert.deepEqual(r.rows.map(x=>x.financeId),['F3','F1']);assert.equal(r.summaryLabel,'Selected entries');
 assert.equal(r.openingBalance,null);assert.equal(r.closingBalance,null);
 assert.equal(r.totalDebit,5000);assert.equal(r.totalCredit,20000);
 const single=h.call('whatsAppBuildFinanceSource_','valid',q('Lender','single',{rowIds:['F2'],rowVersions:versions}));
 assert.equal(single.rows[0].transactionTypeLabel,'Lender Credit');
});
test('stale or wrong-role selected Finance IDs are rejected',()=>{
 const a=rig(),old=a.call('whatsAppBuildFinanceSource_','valid',q('Lender','period',{from:'2026-10-01',to:'2026-10-14'}));
 const versions=Object.fromEntries(old.rows.map(r=>[r.financeId,a.call('whatsAppFinanceRowVersion_',r)]));
 const changed=rig({rows:baseRows.map(r=>r['Finance ID']==='F2'?{...r,Amount:11000}:r)});
 assert.throws(()=>changed.call('whatsAppBuildFinanceSource_','valid',q('Lender','single',{rowIds:['F2'],rowVersions:versions})),/changed|refresh|stale/i);
 assert.throws(()=>a.call('whatsAppBuildFinanceSource_','valid',q('Lender','single',{rowIds:['B1'],rowVersions:versions})),/missing|role|refresh/i);
 assert.throws(()=>a.call('whatsAppBuildFinanceSource_','valid',q('Lender','single',{rowIds:['OTHER'],rowVersions:versions})),/missing|person|refresh/i);
 assert.throws(()=>a.call('whatsAppBuildFinanceSource_','valid',q('Lender','selected',{rowIds:['F1','F1'],rowVersions:versions})),/duplicate/i);
 assert.throws(()=>a.call('whatsAppBuildFinanceSource_','valid',q('Lender','selected',{rowIds:Array(26).fill('F1'),rowVersions:versions})),/25|limit/i);
 assert.throws(()=>a.call('whatsAppBuildFinanceSource_','valid',q('Lender','single',{rowIds:['F1']})),/version|refresh/i);
});
test('reject missing role, wrong person, all-persons request and denied permissions',()=>{
 const h=rig();
 assert.throws(()=>h.call('whatsAppBuildFinanceSource_','valid',{source:'financePerson',mode:'due',accountRole:'Lender'}),/person|account|choose|valid/i);
 assert.throws(()=>h.call('whatsAppBuildFinanceSource_','valid',{source:'financePerson',mode:'due',entityId:'P1'}),/role/i);
 assert.throws(()=>h.call('whatsAppBuildFinanceSource_','valid',q('Lender','due',{entityId:'P2',accountRole:'Borrower'})),/role/i);
 assert.throws(()=>h.call('whatsAppBuildFinanceSource_','invalid',q('Lender','due')),/permission/i);
 assert.throws(()=>rig({allow:false}).call('whatsAppBuildFinanceSource_','valid',q('Lender','due')),/permission/i);
});
test('reject unresolved legacy finance rows that alias selected person by name',()=>{
 const h=rig({rows:baseRows.concat([tx('LEGACY','2026-10-05','Loan Received',1000,'','Alpha')])});
 assert.throws(()=>h.call('whatsAppBuildFinanceSource_','valid',q('Lender','due')),/legacy|unresolved|person id|review/i);
});
test('reject future or inverted period and rows provided in due/period modes',()=>{
 const h=rig();
 assert.throws(()=>h.call('whatsAppBuildFinanceSource_','valid',q('Lender','period',{from:'2999-01-03',to:'2999-01-04'})),/date|future/i);
 assert.throws(()=>h.call('whatsAppBuildFinanceSource_','valid',q('Lender','period',{from:'2026-10-12',to:'2026-10-11'})),/date|range/i);
 assert.throws(()=>h.call('whatsAppBuildFinanceSource_','valid',q('Lender','due',{rowIds:['F1']})),/row|mode/i);
});
test('reject deleted transactions and ambiguous duplicate finance IDs',()=>{
 const rows=baseRows.concat([{...baseRows[1],'Finance ID':'DELETE','Is Deleted':'TRUE'}]);
 const h=rig({rows});
 assert.throws(()=>h.call('whatsAppBuildFinanceSource_','valid',q('Lender','single',{rowIds:['DELETE'],rowVersions:{DELETE:'x'}})),/missing|refresh|changed/i);
 const d=rig({rows:baseRows.concat([tx('F2','2026-10-12','Loan Repayment',5000)])});
 assert.throws(()=>d.call('whatsAppBuildFinanceSource_','valid',q('Lender','due')),/duplicate|ambiguous|review/i);
});
