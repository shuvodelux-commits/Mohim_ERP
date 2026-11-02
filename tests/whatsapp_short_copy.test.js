'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','WhatsAppService.gs'),'utf8');
const party={id:'C1',name:'মো: ইত্তাকুর রহমান',phone:'01712345678'};
const base={
  source:'customer',mode:'due',entityId:'C1',
  party,business:{name:'Sher Mohammad Sanitary House',nameBangla:'শের মোহাম্মাদ স্যানিটারি হাউস'},
  currencySymbol:'৳',currentBalance:14620,balanceKind:'customer_due',
  rows:[],rowCount:0,period:null,totalDebit:0,totalCredit:0
};
function compose(patch={},language='bn'){
  const ctx={Date,console,__view:{...base,...patch},__language:language};
  vm.createContext(ctx);
  vm.runInContext(source,ctx,{filename:'WhatsAppService.gs'});
  return vm.runInContext('whatsAppComposeText_(__view,__language)',ctx);
}
const sale={'Ledger ID':'L1',Date:'2026-10-05',Type:'Sale',Reference:'INV-000106',Debit:14620,Credit:0,Balance:14620};
test('customer due is four-line low-literacy Bangla with no ledger terminology',()=>{
  const message=compose();
  assert.equal(message,'*শের মোহাম্মাদ স্যানিটারি হাউস*\n\nমো: ইত্তাকুর রহমান\n\n*আপনার মোট বাকি: ১৪,৬২০ টাকা*\n\nধন্যবাদ।');
  assert.doesNotMatch(message,/ডেবিট|ক্রেডিট|জের|লেনদেন:|৳/);
});
test('single sale shows invoice and current full balance, not debit credit',()=>{
  const message=compose({mode:'single',rows:[sale],rowCount:1,currentBalance:17500});
  assert.match(message,/বিল INV-000106: ১৪,৬২০ টাকা/);
  assert.match(message,/\*আপনার মোট বাকি: ১৭,৫০০ টাকা\*/);
  assert.doesNotMatch(message,/ডেবিট|ক্রেডিট|মোট ডেবিট|২০২৬-১০-০৫/);
});
test('selected counts without leaking rows and still shows account-wide balance',()=>{
  const message=compose({mode:'selected',rows:[sale,{...sale,'Ledger ID':'L2',Reference:'INV-PRIVATE'},{...sale,'Ledger ID':'L3',Reference:'INV-SECRET'}],rowCount:3});
  assert.match(message,/নির্বাচিত লেনদেন: ৩টি/);
  assert.match(message,/\*আপনার মোট বাকি: ১৪,৬২০ টাকা\*/);
  assert.doesNotMatch(message,/INV-000106|INV-PRIVATE|INV-SECRET|মোট ডেবিট|ডেবিট|ক্রেডিট/);
});
test('dated view shows simple localized interval but CURRENT account balance',()=>{
  const message=compose({mode:'period',period:{from:'2026-10-01',to:'2026-10-31'},rows:[sale],currentBalance:14620,closingBalance:9000});
  assert.match(message,/হিসাব: ১–৩১ অক্টোবর ২০২৬/);
  assert.match(message,/\*আপনার বর্তমান মোট বাকি: ১৪,৬২০ টাকা\*/);
  assert.doesNotMatch(message,/৯,০০০|শুরুর জের|শেষ জের|বিল INV|ডেবিট/);
});
test('supplier payable, supplier advance and customer advance never reverse ownership',()=>{
  assert.match(compose({source:'supplier',balanceKind:'supplier_payable',currentBalance:8000}),/\*আমাদের কাছে আপনার পাওনা: ৮,০০০ টাকা\*/);
  assert.match(compose({source:'supplier',balanceKind:'supplier_advance',currentBalance:-2000}),/\*আপনার কাছে আমাদের অগ্রিম: ২,০০০ টাকা\*/);
  assert.match(compose({balanceKind:'customer_credit',currentBalance:-500}),/\*আপনার অগ্রিম জমা: ৫০০ টাকা\*/);
});
test('lender, borrower, owner positive and negative balances have exact approved labels',()=>{
  const cases=[
    ['Lender','lender_credit',10000,'আমাদের কাছে আপনার ঋণের পাওনা: ১০,০০০ টাকা'],
    ['Lender','lender_debit',-2000,'আপনাকে অতিরিক্ত ফেরত দেওয়া হয়েছে: ২,০০০ টাকা'],
    ['Borrower','borrower_debit',12000,'আপনার ঋণের মোট বাকি: ১২,০০০ টাকা'],
    ['Borrower','borrower_credit',-2000,'আপনার অতিরিক্ত জমা: ২,০০০ টাকা'],
    ['Owner','owner_credit',50000,'দোকানে আপনার মোট মূলধন: ৫০,০০০ টাকা'],
    ['Owner','owner_debit',-2000,'মূলধনের চেয়ে অতিরিক্ত তুলেছেন: ২,০০০ টাকা']
  ];
  for (const [accountRole,balanceKind,currentBalance,label] of cases){
    const msg=compose({source:'financePerson',accountRole,balanceKind,currentBalance});
    assert.ok(msg.includes('*'+label+'*'),accountRole+' '+balanceKind+' '+msg);
    assert.doesNotMatch(msg,/ডেবিট|ক্রেডিট|জের/);
  }
});
test('zero balances for all roles do not claim any due',()=>{
  for (const source of ['customer','supplier','financePerson']){
    assert.match(compose({source,accountRole:'Lender',balanceKind:'settled',currentBalance:0}),/\*আপনার সাথে আমাদের কোনো টাকা বাকি নেই।\*/);
  }
});
test('finance and supplier single entries express the business action',()=>{
  const finance={financeId:'F1',date:'2026-10-05',transactionType:'Loan Repayment',debit:1000,credit:0,amount:1000,balance:9000};
  assert.match(compose({source:'financePerson',accountRole:'Lender',balanceKind:'lender_credit',currentBalance:9000,mode:'single',rows:[finance]}),/ঋণ ফেরত দেওয়া হয়েছে: ১,০০০ টাকা/);
  const purchase={'Ledger ID':'S1',Date:'2026-10-05',Type:'Purchase',Reference:'PUR-10',Debit:12000,Credit:4000};
  assert.match(compose({source:'supplier',balanceKind:'supplier_payable',currentBalance:8000,mode:'single',rows:[purchase]}),/মাল কেনা: ১২,০০০ টাকা/);
});
test('English format is equally concise and uses correct relationship wording',()=>{
  const msg=compose({},'en');
  assert.equal(msg,'*Sher Mohammad Sanitary House*\n\nমো: ইত্তাকুর রহমান\n\n*Your total due: Tk 14,620*\n\nThank you.');
  assert.doesNotMatch(msg,/Debit|Credit|ledger|balance:/i);
});
test('non-whole taka amounts preserve cents, while whole taka has no needless .00',()=>{
  assert.match(compose({currentBalance:14620.5}),/১৪,৬২০\.৫০ টাকা/);
  assert.match(compose({currentBalance:100000}),/১,০০,০০০ টাকা/);
  assert.doesNotMatch(compose({currentBalance:14620}),/\.০০/);
});
