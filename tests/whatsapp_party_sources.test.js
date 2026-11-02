'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','WhatsAppService.gs'),'utf8');
const C=[
 {'Ledger ID':'CLEAN|customer|INV-1',Date:'2026-10-01',Type:'Sale',Reference:'INV-1',Debit:150,Credit:'',Balance:150,'Customer ID':'C1'},
 {'Ledger ID':'PAY-1',Date:'2026-10-02',Type:'Payment',Reference:'PAY',Debit:'',Credit:50,Balance:100,'Customer ID':'C1'},
 {'Ledger ID':'RET-1',Date:'2026-10-03',Type:'Sales Return Credit',Reference:'RET-1',Debit:'',Credit:20,Balance:80,'Customer ID':'C1'}];
const S=[
 {'Ledger ID':'SOURCE|supplier|PUR-PAID',Date:'2026-10-01',Type:'Purchase',Reference:'PUR-PAID',Debit:200,Credit:200,Balance:0,'Supplier ID':'S1'},
 {'Ledger ID':'SOURCE|supplier|PUR-DUE',Date:'2026-10-02',Type:'Purchase',Reference:'PUR-DUE',Debit:300,Credit:100,Balance:200,'Supplier ID':'S1'}];
function sandbox(opts={}){
 const calls=[],indices=opts.indices||{customer:C,supplier:S}, masters={
  CUSTOMERS:[{'Customer ID':'C1',Phone:'01712345678'}],
  SUPPLIERS:[{'Supplier ID':'S1',Phone:'01812345678'}]};
 const ctx={
  requirePermission_(token,module,action){if(token!=='valid'||opts.denied===module)throw Error('Permission denied');calls.push(['permission',module,action]);return {Role:'Administrator'}},
  getAllRows_:key=>masters[key]||[],isDeleted_:r=>r['Is Deleted']==='TRUE',financePersonRoles_:()=>[],
  assertCustomerSalesIntegrity_:id=>{if(id!=='C1')throw Error('Integrity mismatch')},
  partyLedgerBuildDisplayIndex_(kind,id,corrections){calls.push(['index',kind,id,corrections]);return indices[kind]||[]},
  partyLedgerSelectedParty_(kind,id,rows){return {id,name:kind==='customer'?'Customer A':'Supplier A',phone:kind==='customer'?'01712345678':'01812345678',balance:rows.at(-1)?.Balance||0}},
  partyLedgerNormalizeFullRows_:(kind,rows)=>rows.map(r=>({...r})),
  partyLedgerBusinessIdentity_:()=>({name:'Test Hardware'}),
  getPartyLedgerStatement_(kind,token,id,from,to){
   calls.push(['statement',kind,token,id,from,to]);
   if(!/^\d{4}-\d\d-\d\d$/.test(from)||!/^\d{4}-\d\d-\d\d$/.test(to)||from>to||to>'2026-11-02')throw Error('Invalid period');
   const all=indices[kind]||[],rows=all.filter(r=>r.Date>=from&&r.Date<=to);
   const opening=all.filter(r=>r.Date<from).at(-1)?.Balance||0;
   const debit=rows.reduce((s,r)=>s+(Number(r.Debit)||0),0),credit=rows.reduce((s,r)=>s+(Number(r.Credit)||0),0);
   return {party:{id,name:'Test Party',phone:'01712345678',balance:all.at(-1)?.Balance||0},business:{name:'Test Hardware'},period:{from,to},openingBalance:opening,closingBalance:opening+debit-credit,periodDebit:debit,periodCredit:credit,rows};
  }
 };
 vm.createContext(ctx);vm.runInContext(src,ctx);
 return {calls,call:(name,...args)=>{ctx.__args=args;return vm.runInContext(name+'(...__args)',ctx)}};
}
const plain=x=>JSON.parse(JSON.stringify(x));
const v=(h,rows)=>Object.fromEntries(rows.map(r=>[r['Ledger ID'],h.call('whatsAppPartyRowVersion_',r)]));
const party=(source,mode,extra={})=>({source,entityId:source==='customer'?'C1':'S1',mode,...extra});
test('period_statement_matches_getPartyLedgerStatement',()=>{
 const h=sandbox(),r=plain(h.call('whatsAppBuildPartySource_','valid',party('customer','period',{from:'2026-10-02',to:'2026-10-03'})));
 assert.deepEqual(h.calls.filter(x=>x[0]==='statement'),[['statement','customer','valid','C1','2026-10-02','2026-10-03']]);
 assert.equal(r.openingBalance,150);assert.equal(r.closingBalance,80);assert.equal(r.totalCredit,70);assert.equal(r.rows.length,2);assert.equal(r.currentBalance,80);
});
test('same_day_inclusive_and_invalid_period_rejected',()=>{
 const h=sandbox(),r=h.call('whatsAppBuildPartySource_','valid',party('customer','period',{from:'2026-10-02',to:'2026-10-02'}));
 assert.deepEqual(plain(r.rows.map(x=>x['Ledger ID'])),['PAY-1']);assert.equal(r.closingBalance,100);
 assert.throws(()=>h.call('whatsAppBuildPartySource_','valid',party('customer','period',{from:'2026-10-03',to:'2026-10-02'})),/period|date/i);
});
test('current_due_credit_semantics_for_customers_and_suppliers',()=>{
 const h=sandbox();
 assert.equal(h.call('whatsAppBuildPartySource_','valid',party('customer','due')).balanceKind,'customer_due');
 assert.equal(h.call('whatsAppBuildPartySource_','valid',party('supplier','due')).balanceKind,'supplier_payable');
 const hn=sandbox({indices:{customer:C.map((x,i)=>i===2?{...x,Balance:-40}:x),supplier:S}});
 assert.equal(hn.call('whatsAppBuildPartySource_','valid',party('customer','due')).balanceKind,'customer_credit');
 const hz=sandbox({indices:{customer:C,supplier:S.map((x,i)=>i===1?{...x,Balance:0}:x)}});
 assert.equal(hz.call('whatsAppBuildPartySource_','valid',party('supplier','due')).balanceKind,'settled');
});
test('selected_disjoint_rows_are_not_period_statement',()=>{
 const h=sandbox(),ids=['CLEAN|customer|INV-1','RET-1'];
 const r=plain(h.call('whatsAppBuildPartySource_','valid',party('customer','selected',{rowIds:ids,rowVersions:v(h,[C[0],C[2]])})));
 assert.deepEqual(r.rows.map(x=>x['Ledger ID']),ids);assert.equal(r.summaryLabel,'Selected entries');assert.equal(r.openingBalance,null);assert.equal(r.closingBalance,null);
 assert.equal(r.totalDebit,150);assert.equal(r.totalCredit,20);assert.equal(r.currentBalance,80);assert.equal(h.calls.some(x=>x[0]==='statement'),false);
});
test('synthetic_clean_row_selected_by_CLEAN_id',()=>{
 const h=sandbox(),r=h.call('whatsAppBuildPartySource_','valid',party('customer','single',{rowIds:['CLEAN|customer|INV-1'],rowVersions:v(h,[C[0]])}));
 assert.equal(r.rows[0].Debit,150);assert.equal(r.rows[0].Type,'Sale');assert.equal(r.rowCount,1);
 assert.ok(h.calls.some(x=>x[0]==='index'&&x[3]===false));
});
test('supplier_paid_purchase_visible',()=>{
 const h=sandbox(),r=h.call('whatsAppBuildPartySource_','valid',party('supplier','single',{rowIds:['SOURCE|supplier|PUR-PAID'],rowVersions:v(h,[S[0]])}));
 assert.equal(r.rows[0].Debit,200);assert.equal(r.rows[0].Credit,200);assert.equal(r.totalDebit,200);assert.equal(r.totalCredit,200);assert.equal(r.currentBalance,200);
});
test('reject_other_party_id_and_invalid_session',()=>{
 const h=sandbox();
 assert.throws(()=>h.call('whatsAppBuildPartySource_','valid',party('customer','single',{rowIds:['L-FROM-OTHER-PARTY'],rowVersions:v(h,[C[0]])})),/missing|changed|stale|refresh/i);
 assert.throws(()=>h.call('whatsAppBuildPartySource_','invalid',party('customer','due')),/permission/i);
});
test('reject_deleted_or_changed_row_even_when_synthetic_ID_survives',()=>{
 const h=sandbox(),rowVersions=v(h,[C[0]]),request=party('customer','single',{rowIds:['CLEAN|customer|INV-1'],rowVersions});
 const changed=sandbox({indices:{customer:C.map((r,i)=>i===0?{...r,Debit:999,Balance:999}:r),supplier:S}});
 assert.throws(()=>changed.call('whatsAppBuildPartySource_','valid',request),/changed|stale|refresh/i);
 const deleted=sandbox({indices:{customer:C.slice(1),supplier:S}});
 assert.throws(()=>deleted.call('whatsAppBuildPartySource_','valid',request),/changed|missing|refresh/i);
});
test('reject_more_than_25_duplicate_and_missing_row_versions',()=>{
 const h=sandbox(),rowVersions=v(h,[C[0]]),call=x=>h.call('whatsAppBuildPartySource_','valid',party('customer','selected',x));
 assert.throws(()=>call({rowIds:Array(26).fill('fake'),rowVersions}),/25|limit/i);
 assert.throws(()=>call({rowIds:['PAY-1','PAY-1'],rowVersions}),/duplicate/i);
 assert.throws(()=>call({rowIds:['PAY-1']}),/version|refresh/i);
 assert.throws(()=>h.call('whatsAppBuildPartySource_','valid',party('customer','single',{rowIds:['PAY-1','RET-1'],rowVersions})),/exactly one/i);
});
test('unresolved_correction_rows_never_leave_server',()=>{
 const anomaly={...C[2],'Ledger ID':'RAW-CORRECTION',Date:'2026-10-04',Type:'Sale Update Credit'};
 const h=sandbox({indices:{customer:C.concat([anomaly]),supplier:S}});
 assert.throws(()=>h.call('whatsAppBuildPartySource_','valid',party('customer','due')),/correction|review/i);
 assert.throws(()=>h.call('whatsAppBuildPartySource_','valid',party('customer','period',{from:'2026-10-01',to:'2026-10-04'})),/correction|review/i);
});
test('source_party_id_contamination_is_rejected',()=>{
 const h=sandbox({indices:{customer:C.concat([{...C[2],'Ledger ID':'FOREIGN','Customer ID':'C2'}]),supplier:S}});
 assert.throws(()=>h.call('whatsAppBuildPartySource_','valid',party('customer','due')),/party|account|mismatch/i);
});
