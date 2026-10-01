'use strict';
const fs=require('fs'),assert=require('assert');
const read=f=>fs.readFileSync(f,'utf8');
function fnSource(src,name){const s=src.indexOf('function '+name+'(');assert(s>=0,name+' missing');const n=src.indexOf('\nfunction ',s+10);return src.slice(s,n<0?src.length:n);}
let pass=0,fail=0;function test(n,f){try{f();pass++;console.log('PASS',n)}catch(e){fail++;console.error('FAIL',n,'\n'+e.stack)}}

test('Sales detail serializes Sheet date/time as date-only and time-only strings',()=>{
  const b=fnSource(read('SalesManagement.gs'),'getSaleForUpdate');
  assert.match(b,/date:\s*safeDateOnly_\(sale\[['"]Date['"]\]\)/);
  assert.match(b,/time:\s*safeTimeOnly_\(sale\[['"]Time['"]\]\)/);
});

test('Sales Return search and invoice detail serialize date-only values',()=>{
  const s=read('SalesReturn.gs');
  assert.match(fnSource(s,'searchInvoicesForReturn'),/date:\s*safeDateOnly_\(s\[['"]Date['"]\]\)/);
  assert.match(fnSource(s,'getInvoiceForReturn'),/date:\s*safeDateOnly_\(sale\[['"]Date['"]\]\)/);
});

test('Purchase Return search and purchase detail serialize date-only values',()=>{
  const s=read('PurchaseReturn.gs');
  assert.match(fnSource(s,'searchPurchasesForReturn'),/date:\s*safeDateOnly_\(p\[['"]Date['"]\]\)/);
  assert.match(fnSource(s,'getPurchaseForReturn'),/date:\s*safeDateOnly_\(purchase\[['"]Date['"]\]\)/);
});

test('Day Book sale time serializes a time-only Sheet cell',()=>{
  const b=fnSource(read('DayBook.gs'),'getDayBookTransactions');
  assert.match(b,/time:\s*safeTimeOnly_\(s\[['"]Time['"]\]\)/);
});

console.log(`\n${pass}/${pass+fail} passed`);if(fail)process.exit(1);
