const fs=require('fs'), assert=require('assert');
const finance=fs.readFileSync('finance.html','utf8');
const financeLedger=fs.readFileSync('financeLedger.html','utf8');
const vendors=fs.readFileSync('vendors.html','utf8');
function test(n,f){try{f();console.log('PASS '+n)}catch(e){console.error('FAIL '+n);console.error(e.stack);process.exitCode=1;}}

test('finance add/update and person status are confirmation gated',()=>{
  assert.match(finance,/runConfirmedAction\([\s\S]{0,2600}serverCall\('addFinanceTransaction'/);
  assert.match(financeLedger,/runConfirmedAction\([\s\S]{0,2600}serverCall\('updateFinanceTransaction'/);
  assert.match(finance,/runConfirmedAction\([\s\S]{0,1800}serverCall\('setFinancePersonStatus'/);
  ['Person','Transaction Type','Amount','Method','Account'].forEach(x=>assert.match(finance,new RegExp(x)));
});

test('vendor pay and receive payment use financial confirmation with actual amount words',()=>{
  assert.match(vendors,/runConfirmedAction\([\s\S]{0,2600}serverCall\('payVendor'/);
  assert.match(vendors,/runConfirmedAction\([\s\S]{0,2600}serverCall\('receiveVendorPayment'/);
  assert.match(vendors,/banglaAmountInWords_\(/);
  assert.match(vendors,/Vendor/);
  assert.match(vendors,/Method/);
  assert.match(vendors,/Account/);
});

test('vendor stock movements confirm product and quantity with inventory consequence',()=>{
  assert.match(vendors,/runConfirmedAction\([\s\S]{0,3000}serverCall\('returnProductsToVendor'/);
  assert.match(vendors,/runConfirmedAction\([\s\S]{0,3000}serverCall\('giveProductsToVendor'/);
  assert.match(vendors,/runConfirmedAction\([\s\S]{0,3000}serverCall\('receiveProductsFromVendor'/);
  assert.match(vendors,/inventory/i);
  assert.match(vendors,/Product/);
  assert.match(vendors,/Quantity/);
});

test('vendor status uses state-change confirmation and delete keeps confirmDelete',()=>{
  assert.match(vendors,/type:\s*'state-change'[\s\S]{0,1600}serverCall\('setVendorStatus'/);
  assert.match(vendors,/confirmDelete\([\s\S]{0,900}deleteVendor/);
});

test('vendor posted transaction edits use the shared confirmation before native update',()=>{
  assert.match(vendors,/function vlSaveNative_[\s\S]{0,2400}runConfirmedAction\([\s\S]{0,1800}serverCall\(handlers\.update/);
});

if(!process.exitCode) console.log('4/4 passed');

const products=fs.readFileSync('products.html','utf8');
const expenseCategory=fs.readFileSync('expenseCategory.html','utf8');
const suppliers=fs.readFileSync('suppliers.html','utf8');
const bank=fs.readFileSync('bank.html','utf8');
const roles=fs.readFileSync('roles.html','utf8');
const users=fs.readFileSync('users.html','utf8');
const pos=fs.readFileSync('pos.html','utf8');

test('stock adjustment confirms current delta result and native adjustStock',()=>{
  assert.match(products,/runConfirmedAction\([\s\S]{0,2600}serverCall\('adjustStock'/);
  ['Product','Current Stock','Adjustment','Resulting Stock','Note'].forEach(x=>assert.match(products,new RegExp(x)));
});

test('material status changes use state-change confirmation in every entry point',()=>{
  [
    [products,'setProductStatus'],[expenseCategory,'setExpenseCategoryStatus'],[suppliers,'setSupplierStatus'],
    [bank,'setBankAccountStatus'],[roles,'setRoleStatus'],[users,'setUserStatus'],[finance,'setFinancePersonStatus'],
    [vendors,'setVendorStatus'],[pos,'setVendorStatus']
  ].forEach(([src,fn])=>assert.match(src,new RegExp("type:\\s*'state-change'[\\s\\S]{0,2000}serverCall\\('"+fn+"'")));
});

test('product category and unit removal use shared state-change confirmation',()=>{
  const start=products.indexOf("document.getElementById('prodManageListBody')");
  const end=products.indexOf("document.getElementById('prodSaveBtn')",start);
  const block=products.slice(start,end);
  assert.match(block,/setProductCategoryStatus/);
  assert.match(block,/setProductUnitStatus/);
  assert.match(block,/type:\s*'state-change'/);
  assert.match(block,/serverCall\(fn,/);
  assert.match(block,/Products already using it keep their current value/i);
});

test('ordinary product save remains direct without extra confirmation',()=>{
  const start=products.indexOf("document.getElementById('prodSaveBtn')");
  const end=products.indexOf('function prodOpenStock_',start);
  const block=products.slice(start,end);
  assert.match(block,/serverCall\('updateProduct'/);
  assert.match(block,/serverCall\('addProduct'/);
  assert.doesNotMatch(block,/runConfirmedAction/);
});
