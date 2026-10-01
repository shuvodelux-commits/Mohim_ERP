const fs=require('fs'),assert=require('assert');
const files=['products.html','expenseCategory.html','suppliers.html','bank.html','roles.html','users.html','finance.html','vendors.html','pos.html'];
const src=Object.fromEntries(files.map(f=>[f,fs.readFileSync(f,'utf8')]));
function test(n,f){try{f();console.log('PASS '+n)}catch(e){console.error('FAIL '+n);console.error(e.stack);process.exitCode=1;}}
test('material status RPCs are protected by shared state-change confirmation',()=>{
  const pairs=[['products.html','setProductStatus'],['expenseCategory.html','setExpenseCategoryStatus'],['suppliers.html','setSupplierStatus'],['bank.html','setBankAccountStatus'],['roles.html','setRoleStatus'],['users.html','setUserStatus'],['finance.html','setFinancePersonStatus'],['vendors.html','setVendorStatus'],['pos.html','setVendorStatus']];
  pairs.forEach(([file,fn])=>assert.match(src[file],new RegExp("type:\\s*'state-change'[\\s\\S]{0,2200}serverCall\\('"+fn+"'"),file+' '+fn));
});
test('stock adjustment is confirmation gated',()=>assert.match(src['products.html'],/runConfirmedAction\([\s\S]{0,2800}serverCall\('adjustStock'/));

const js=fs.readFileSync('javascript.html','utf8');
const customers=fs.readFileSync('customers.html','utf8');
const invoice=fs.readFileSync('invoiceDesign.html','utf8');

test('protected workflows contain no native browser confirm calls',()=>{
  const protectedSources=[js,src['users.html'],src['roles.html'],customers,invoice,src['products.html'],src['suppliers.html'],src['expenseCategory.html'],src['vendors.html']];
  protectedSources.forEach(s=>assert.doesNotMatch(s,/\bconfirm\s*\(/));
});

test('sign out uses shared state-change confirmation',()=>{
  assert.match(js,/title:\s*'Sign out\?'/);
  assert.match(js,/type:\s*'state-change'/);
  assert.match(js,/doLogout_\(\)/);
});

test('reset password validates then confirms without exposing password in details',()=>{
  const u=src['users.html'];
  assert.match(u,/pw\.length\s*<\s*8/);
  assert.match(u,/runConfirmedAction\([\s\S]{0,2200}serverCall\('resetPassword'/);
  const start=u.indexOf("title: 'Reset Password?'");
  const end=u.indexOf("serverCall('resetPassword'",start);
  const summary=u.slice(start,end);
  assert.doesNotMatch(summary,/value:\s*pw/);
});

test('user role and invoice-logo permanent actions use shared danger confirmation',()=>{
  assert.match(src['users.html'],/type:\s*'danger'[\s\S]{0,1800}serverCall\('deleteUser'/);
  assert.match(src['roles.html'],/type:\s*'danger'[\s\S]{0,1800}serverCall\('deleteRole'/);
  assert.match(invoice,/type:\s*'danger'[\s\S]{0,1800}serverCall\('removeInvoiceLogo'/);
});

test('customer permanent deletion confirms first and preserves delete confirmation key',()=>{
  assert.match(customers,/type:\s*'danger'/);
  assert.match(customers,/prompt\('Enter the delete confirmation key to proceed:'\)/);
  assert.match(customers,/serverCall\('deleteCustomer',\s*authToken,\s*id,\s*key\)/);
  assert.ok(customers.indexOf("title: 'Delete Customer?'") < customers.indexOf("prompt('Enter the delete confirmation key to proceed:')"));
});
