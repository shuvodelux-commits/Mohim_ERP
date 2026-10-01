const fs=require('fs'), assert=require('assert');
const cust=fs.readFileSync('customers.html','utf8');
const sup=fs.readFileSync('suppliers.html','utf8');
function test(n,f){try{f();console.log('PASS '+n)}catch(e){console.error('FAIL '+n+'\n'+e.message);process.exitCode=1}}

test('Customer Add button and Counter can share one native add opener',()=>{
  assert.match(cust,/function custOpenAdd_\s*\(onSaved\)/);
  assert.match(cust,/custAddBtn['"]?\)\.addEventListener\('click',[\s\S]{0,180}custOpenAdd_\(null\)/);
  assert.match(cust,/serverCall\('addCustomerChecked'/);
  assert.match(cust,/custState\.addSuccessCallback/);
  assert.match(cust,/addSuccessCallback[\s\S]{0,500}res\.id/);
});

test('Supplier Add button and Counter can share one native add opener',()=>{
  assert.match(sup,/function supOpenAdd_\s*\(onSaved\)/);
  assert.match(sup,/supAddBtn['"]?\)\.addEventListener\('click',[\s\S]{0,180}supOpenAdd_\(null\)/);
  assert.match(sup,/serverCall\('addSupplier'/);
  assert.match(sup,/supState\.addSuccessCallback/);
  assert.match(sup,/addSuccessCallback[\s\S]{0,500}res\.id/);
});

test('Add callbacks are cleared for edit/cancel-safe reuse',()=>{
  assert.match(cust,/custState\.addSuccessCallback\s*=\s*null/);
  assert.match(sup,/supState\.addSuccessCallback\s*=\s*null/);
  assert.match(cust,/custOpenEdit_[\s\S]{0,180}addSuccessCallback\s*=\s*null/);
  assert.match(sup,/supOpenEdit_[\s\S]{0,180}addSuccessCallback\s*=\s*null/);
});

if(!process.exitCode)console.log('3/3 passed');
