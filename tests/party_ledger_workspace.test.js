'use strict';
const fs=require('fs'), path=require('path'), vm=require('vm'), assert=require('assert');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'PartyLedger.gs'),'utf8');
let pass=0, fail=0;
function test(name,fn){try{fn();pass++;console.log('PASS',name);}catch(e){fail++;console.error('FAIL',name);console.error(e.stack||e);}}
const ctx={
  console,
  ledgerSortKey_:r=>{ const d=String(r.Date||''); const dp=d.slice(0,10); let t=d.slice(11); if((!t||t==='00:00:00')&&r['Created At'])t=String(r['Created At']).slice(11); return dp+'T'+(t||'00:00:00'); },
  roundMoney_:v=>Math.round((Number(v)||0)*100)/100,
  isDeleted_:r=>String(r['Is Deleted']||'').toUpperCase()==='TRUE',
  Utilities:{Charset:{UTF_8:'UTF-8'},base64EncodeWebSafe:s=>Buffer.from(String(s)).toString('base64url'),base64DecodeWebSafe:s=>Array.from(Buffer.from(String(s),'base64url')),newBlob:b=>({getDataAsString:()=>Buffer.from(b).toString()})}
};
vm.createContext(ctx); vm.runInContext(src,ctx);

test('page size is limited to 50/100/200',()=>{ assert.equal(ctx.partyLedgerPageSize_(undefined),50); for(const n of [50,100,200])assert.equal(ctx.partyLedgerPageSize_(n),n); assert.throws(()=>ctx.partyLedgerPageSize_(25)); });

test('authoritative index sorts backdated business dates and excludes deleted rows',()=>{
  ctx.partyLedgerReadIndex_=()=>[
    {_rowIndex:2,'Customer ID':'C1','Customer Name':'A','Ledger ID':'L1',Date:'2026-09-01','Created At':'2026-09-01T09:00:00',Debit:100,Credit:0,'Is Deleted':''},
    {_rowIndex:3,'Customer ID':'C1','Customer Name':'A','Ledger ID':'L2',Date:'2026-09-03','Created At':'2026-09-03T10:00:00',Debit:0,Credit:40,'Is Deleted':''},
    {_rowIndex:4,'Customer ID':'C1','Customer Name':'A','Ledger ID':'L3',Date:'2026-09-02','Created At':'2026-09-04T11:00:00',Debit:20,Credit:0,'Is Deleted':''},
    {_rowIndex:5,'Customer ID':'C1','Customer Name':'A','Ledger ID':'L4',Date:'2026-09-04','Created At':'2026-09-04T12:00:00',Debit:50,Credit:0,'Is Deleted':'TRUE'}
  ];
  const rows=ctx.partyLedgerBuildAscendingIndex_('customer','C1');
  assert.deepEqual(rows.map(r=>r['Ledger ID']),['L1','L3','L2']);
  assert.deepEqual(rows.map(r=>r._displayBalance),[100,120,80]);
});

test('customer source mapping routes only to native transaction modules',()=>{
  const sale={'Type':'Sale','Reference':'INV-1','Ledger ID':'L','Customer ID':'C'}; ctx.partyLedgerAttachSourceMetadata_('customer',sale); assert.equal(sale.sourceModule,'sales'); assert.equal(sale.sourceId,'INV-1'); assert.deepEqual(Array.from(sale.availableActions),['view','print','edit','return','delete']);
  const pay={'Type':'Payment','Reference':'PAYMENT','Ledger ID':'L2','Customer ID':'C'}; ctx.partyLedgerAttachSourceMetadata_('customer',pay); assert.equal(pay.sourceModule,'customerPayment'); assert.equal(pay.sourceId,'L2');
});

test('supplier source mapping routes purchase/payment/opening balance correctly',()=>{
  const purchase={'Type':'Purchase Update','Reference':'PUR-2','Ledger ID':'L'}; ctx.partyLedgerAttachSourceMetadata_('supplier',purchase); assert.equal(purchase.sourceModule,'purchase'); assert.equal(purchase.sourceId,'PUR-2');
  const opening={'Type':'Opening Balance','Reference':'S1','Ledger ID':'L','Supplier ID':'S1'}; ctx.partyLedgerAttachSourceMetadata_('supplier',opening); assert.equal(opening.sourceModule,'supplierOpeningBalance'); assert.equal(opening.sourceId,'S1');
});

test('cursor is opaque round-trip data',()=>{ const e={_stableKey:'2026-09-01T00:00:00|0000000002|L1',_rowIndex:2}; const c=ctx.partyLedgerEncodeCursor_(e); assert.ok(c && !c.includes('{')); const d=ctx.partyLedgerDecodeCursor_(c); assert.equal(d.k,e._stableKey); assert.equal(d.r,2); });

test('server uses narrow RangeList index scan and page-only full-row fetch',()=>{ assert.match(src,/getRangeList\(a1s\)/); assert.match(src,/getRangeList\(rowA1s\)/); assert.match(src,/selectedIndexEntries\.map/); assert.doesNotMatch(src,/getCustomerDetail\s*\(/); assert.doesNotMatch(src,/getSupplierDetail\s*\(/); });

test('public workspace/page/statement endpoints exist for both party kinds',()=>{ for(const n of ['getCustomerLedgerWorkspaceBootstrap','getSupplierLedgerWorkspaceBootstrap','getCustomerLedgerPage','getSupplierLedgerPage','getCustomerLedgerStatement','getSupplierLedgerStatement']) assert.match(src,new RegExp('function\\s+'+n+'\\s*\\(')); });

test('workspace is read-only and contains no accounting mutation endpoint',()=>{ assert.doesNotMatch(src,/appendRow_|updateRowFields_|deleteRow_|addCashBookEntry_|addBankBookEntry_/); });

test('statement computes opening, period debit/credit and closing from authoritative index',()=>{ assert.match(src,/if \(d < period\.from\) opening/); assert.match(src,/debit = roundMoney_/); assert.match(src,/credit = roundMoney_/); assert.match(src,/const closing = roundMoney_\(opening \+ debit - credit\)/); });

test('supplier bank payment uses actual settlement payment amount',()=>{ const suppliers=fs.readFileSync(path.join(root,'Suppliers.gs'),'utf8'); assert.match(suppliers,/Type: "Supplier Payment"[\s\S]{0,260}Debit: settlement\.payment/); assert.doesNotMatch(suppliers,/Type: "Supplier Payment"[\s\S]{0,260}Debit: amt/); });
console.log(`\n${pass}/${pass+fail} passed`); if(fail)process.exit(1);
