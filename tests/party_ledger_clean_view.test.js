'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'PartyLedger.gs'),'utf8');
let pass=0,fail=0;
function test(name,fn){try{fn();pass++;console.log('PASS',name);}catch(e){fail++;console.error('FAIL',name);console.error(e.stack||e);}}
const ctx={
  console,
  roundMoney_:v=>Math.round((Number(v)||0)*100)/100,
  isDeleted_:r=>String(r['Is Deleted']||'').toUpperCase()==='TRUE',
  safeDateOnly_:v=>String(v||'').slice(0,10),
  sanitizeInput_:v=>String(v||'').trim(),
  Utilities:{Charset:{UTF_8:'UTF-8'},base64EncodeWebSafe:s=>Buffer.from(String(s)).toString('base64url'),base64DecodeWebSafe:s=>Array.from(Buffer.from(String(s),'base64url')),newBlob:b=>({getDataAsString:()=>Buffer.from(b).toString()})}
};
vm.createContext(ctx); vm.runInContext(src,ctx);
function row(i,type,ref,debit,credit,date='2026-09-09',party='C1'){
  return {_rowIndex:i,'Ledger ID':'L'+i,Date:date,'Customer ID':party,'Customer Name':'Party',Type:type,Reference:ref,Debit:debit||'',Credit:credit||'','Created At':date+'T10:00:00','Is Deleted':''};
}
function srow(i,type,ref,debit,credit,date='2026-09-09',party='S1'){
  return {_rowIndex:i,'Ledger ID':'SL'+i,Date:date,'Supplier ID':party,'Supplier Name':'Supplier',Type:type,Reference:ref,Debit:debit||'',Credit:credit||'','Created At':date+'T10:00:00','Is Deleted':''};
}

test('repeated sale edits collapse to one current Sale obligation',()=>{
  const raw=[row(2,'Sale','INV-1',7730,0),row(3,'Sale Update Credit','INV-1',0,7730),row(4,'Sale Update Debit','INV-1',7750,0),row(5,'Sale Update Credit','INV-1',0,7750),row(6,'Sale Update Debit','INV-1',7730,0)];
  const clean=ctx.partyLedgerProjectClean_('customer',raw,{'INV-1':'2026-09-01'});
  assert.equal(clean.length,1); assert.equal(clean[0].Type,'Sale'); assert.equal(clean[0].Reference,'INV-1'); assert.equal(clean[0].Debit,7730); assert.equal(Number(clean[0].Credit)||0,0); assert.equal(clean[0].Date,'2026-09-01'); assert.equal(clean[0]._displayBalance,7730);
});

test('sale moved away from old customer disappears while real payment remains',()=>{
  const raw=[row(2,'Sale','INV-2',5000,0,'2026-09-01','C-OLD'),row(3,'Payment','PAYMENT',0,1000,'2026-09-02','C-OLD'),row(4,'Sale Update Credit','INV-2',0,5000,'2026-09-03','C-OLD')];
  const clean=ctx.partyLedgerProjectClean_('customer',raw,{'INV-2':'2026-09-01'});
  assert.deepEqual(clean.map(r=>r.Type),['Payment']); assert.equal(clean[0].Credit,1000); assert.equal(clean[0]._displayBalance,-1000);
});

test('sale reassigned onto new customer appears as normal Sale not Sale Update Debit',()=>{
  const raw=[row(8,'Sale Update Debit','INV-3',7300,0,'2026-09-09','C-NEW')];
  const clean=ctx.partyLedgerProjectClean_('customer',raw,{'INV-3':'2026-08-31'});
  assert.equal(clean.length,1); assert.equal(clean[0].Type,'Sale'); assert.equal(clean[0].Debit,7300); assert.equal(clean[0].Date,'2026-08-31');
});

test('purchase supplier reassignment hides old chain and shows normal Purchase on new supplier',()=>{
  const oldRaw=[srow(2,'Purchase','PUR-5',50154,0,'2026-09-01','S-OLD'),srow(3,'Purchase Update','PUR-5',0,50154,'2026-09-09','S-OLD')];
  const newRaw=[srow(4,'Purchase Update','PUR-5',50154,0,'2026-09-09','S-NEW')];
  assert.equal(ctx.partyLedgerProjectClean_('supplier',oldRaw,{'PUR-5':'2026-09-01'}).length,0);
  const cleanNew=ctx.partyLedgerProjectClean_('supplier',newRaw,{'PUR-5':'2026-09-01'});
  assert.equal(cleanNew.length,1); assert.equal(cleanNew[0].Type,'Purchase'); assert.equal(cleanNew[0].Debit,50154); assert.equal(cleanNew[0].Date,'2026-09-01');
});

test('same-supplier purchase updates collapse to final payable amount',()=>{
  const raw=[srow(2,'Purchase','PUR-6',1000,0,'2026-09-01'),srow(3,'Purchase Update','PUR-6',0,200,'2026-09-02'),srow(4,'Payment','PAYMENT',0,300,'2026-09-03')];
  const clean=ctx.partyLedgerProjectClean_('supplier',raw,{'PUR-6':'2026-09-01'});
  assert.deepEqual(clean.map(r=>r.Type),['Purchase','Payment']); assert.equal(clean[0].Debit,800); assert.equal(clean[0]._displayBalance,800); assert.equal(clean[1]._displayBalance,500);
});

test('real return credits and opening balances remain visible',()=>{
  const raw=[row(2,'Opening Balance','C1',1000,0,'2026-08-01'),row(3,'Sale','INV-7',500,0,'2026-09-01'),row(4,'Sales Return Credit','RET-1',0,200,'2026-09-02')];
  const clean=ctx.partyLedgerProjectClean_('customer',raw,{'INV-7':'2026-09-01'});
  assert.deepEqual(clean.map(r=>r.Type),['Opening Balance','Sale','Sales Return Credit']); assert.equal(clean.at(-1)._displayBalance,1300);
});

test('same-day edit keeps the original sale before a later real return in clean chronology',()=>{
  const raw=[row(10,'Sale','INV-ORDER',500,0,'2026-09-05'),row(11,'Sales Return Credit','RET-ORDER',0,100,'2026-09-05'),row(12,'Sale Update Credit','INV-ORDER',0,500,'2026-09-05'),row(13,'Sale Update Debit','INV-ORDER',550,0,'2026-09-05')];
  const clean=ctx.partyLedgerProjectClean_('customer',raw,{'INV-ORDER':'2026-09-05'});
  assert.deepEqual(clean.map(r=>r.Type),['Sale','Sales Return Credit']); assert.deepEqual(clean.map(r=>r._displayBalance),[550,450]);
});

test('duplicate base transaction references fail closed instead of being merged',()=>{
  const raw=[row(2,'Sale','INV-DUP',100,0,'2026-09-01'),row(3,'Sale','INV-DUP',200,0,'2026-09-02')];
  const clean=ctx.partyLedgerProjectClean_('customer',raw,{'INV-DUP':'2026-09-02'});
  assert.equal(clean.length,2); assert.deepEqual(clean.map(r=>r.Type),['Sale','Sale']); assert.equal(clean.at(-1)._displayBalance,300);
});

test('negative correction-chain anomaly fails closed by retaining raw correction rows',()=>{
  const raw=[row(2,'Sale','INV-BAD',100,0),row(3,'Sale Update Credit','INV-BAD',0,150)];
  const clean=ctx.partyLedgerProjectClean_('customer',raw,{'INV-BAD':'2026-09-01'});
  assert.equal(clean.length,2); assert.deepEqual(clean.map(r=>r.Type),['Sale','Sale Update Credit']); assert.equal(clean.at(-1)._displayBalance,-50);
});

test('clean projection closing balance equals raw closing balance for valid histories',()=>{
  const raw=[row(2,'Sale','INV-8',1000,0,'2026-09-01'),row(3,'Sale Update Credit','INV-8',0,1000,'2026-09-02'),row(4,'Sale Update Debit','INV-8',1200,0,'2026-09-02'),row(5,'Payment','PAYMENT',0,200,'2026-09-03'),row(6,'Sales Return Credit','RET-8',0,100,'2026-09-04')];
  const clean=ctx.partyLedgerProjectClean_('customer',raw,{'INV-8':'2026-09-01'});
  const rawClosing=raw.reduce((b,r)=>Math.round((b+(Number(r.Debit)||0)-(Number(r.Credit)||0))*100)/100,0);
  assert.equal(clean.at(-1)._displayBalance,rawClosing);
});



test('correction history is limited to Administrator Owner and Manager roles',()=>{
  for (const role of ['Administrator','Owner','Manager','manager']) assert.equal(ctx.partyLedgerUserCanViewCorrections_({'Role':role}),true);
  for (const role of ['Cashier','Accountant','']) assert.equal(ctx.partyLedgerUserCanViewCorrections_({'Role':role}),false);
});

test('display index defaults to clean projection and raw mode preserves correction rows',()=>{
  const raw=[row(2,'Sale','INV-X',100,0),row(3,'Sale Update Credit','INV-X',0,100),row(4,'Sale Update Debit','INV-X',120,0)];
  ctx.partyLedgerBuildAscendingIndex_=()=>raw;
  ctx.partyLedgerSourceDateMap_=()=>({'INV-X':'2026-09-01'});
  const clean=ctx.partyLedgerBuildDisplayIndex_('customer','C1',false);
  const audit=ctx.partyLedgerBuildDisplayIndex_('customer','C1',true);
  assert.deepEqual(clean.map(r=>r.Type),['Sale']); assert.equal(clean[0].Debit,120);
  assert.deepEqual(audit.map(r=>r.Type),['Sale','Sale Update Credit','Sale Update Debit']);
});

test('unauthorized correction-mode request is rejected server-side',()=>{
  assert.equal(ctx.partyLedgerResolveCorrectionsMode_({'Role':'Manager'},true),true);
  assert.equal(ctx.partyLedgerResolveCorrectionsMode_({'Role':'Cashier'},false),false);
  assert.throws(()=>ctx.partyLedgerResolveCorrectionsMode_({'Role':'Cashier'},true),/restricted|correction/i);
});



test('page endpoint defaults to clean mode, allows privileged raw mode, and rejects cashier raw mode',()=>{
  const raw=[row(2,'Sale','INV-P',100,0),row(3,'Sale Update Credit','INV-P',0,100),row(4,'Sale Update Debit','INV-P',120,0)];
  ctx.requirePermission_=(token)=>({'Role':token==='admin'?'Administrator':'Cashier'});
  ctx.assertCustomerSalesIntegrity_=()=>{};
  ctx.partyLedgerBuildAscendingIndex_=()=>raw;
  ctx.partyLedgerSourceDateMap_=()=>({'INV-P':'2026-09-01'});
  ctx.partyLedgerPageFromAscending_=(kind,asc)=>({rows:asc,page:{}});
  const clean=ctx.getPartyLedgerPage_('customer','cashier','C1',50,'',false);
  assert.deepEqual(clean.rows.map(r=>r.Type),['Sale']);
  const audit=ctx.getPartyLedgerPage_('customer','admin','C1',50,'',true);
  assert.deepEqual(audit.rows.map(r=>r.Type),['Sale','Sale Update Credit','Sale Update Debit']);
  assert.throws(()=>ctx.getPartyLedgerPage_('customer','cashier','C1',50,'',true),/restricted|correction/i);
});

test('workspace bootstrap exposes correction-view capability and defaults to clean projection',()=>{
  const raw=[row(2,'Sale','INV-B',100,0),row(3,'Sale Update Credit','INV-B',0,100),row(4,'Sale Update Debit','INV-B',125,0)];
  ctx.requirePermission_=(token)=>({'Role':token==='admin'?'Administrator':'Cashier'});
  ctx.assertCustomerSalesIntegrity_=()=>{};
  ctx.partyLedgerBuildAscendingIndex_=()=>raw;
  ctx.partyLedgerSourceDateMap_=()=>({'INV-B':'2026-09-01'});
  ctx.partyLedgerSelectorParties_=()=>[]; ctx.getActiveBankAccountsForUI_=()=>[]; ctx.getSettingsMap_=()=>({'Currency Symbol':'৳'});
  ctx.partyLedgerSelectedParty_=()=>({id:'C1',name:'A',balance:125});
  ctx.partyLedgerPageFromAscending_=(kind,asc)=>({rows:asc,page:{pageSize:50}});
  const data=ctx.getPartyLedgerWorkspaceBootstrap_('customer','admin','C1',50,false);
  assert.equal(data.canViewCorrections,true); assert.deepEqual(data.page.rows.map(r=>r.Type),['Sale']);
  const cashier=ctx.getPartyLedgerWorkspaceBootstrap_('customer','cashier','C1',50,false);
  assert.equal(cashier.canViewCorrections,false);
});

test('print statement implementation is clean-only and has no includeCorrections parameter',()=>{
  assert.match(src,/function\s+getPartyLedgerStatement_\s*\(kind, token, partyId, fromDate, toDate\)/);
  assert.match(src,/partyLedgerBuildDisplayIndex_\(kind, pid, false\)/);
  assert.doesNotMatch(src,/getCustomerLedgerStatement\s*\([^)]*includeCorrections/);
  assert.doesNotMatch(src,/getSupplierLedgerStatement\s*\([^)]*includeCorrections/);
});

console.log(`\n${pass}/${pass+fail} passed`); if(fail)process.exit(1);
