const fs=require('fs'), assert=require('assert');
const h=fs.readFileSync('counter.html','utf8');
function test(n,f){try{f();console.log('PASS '+n)}catch(e){console.error('FAIL '+n+'\n'+e.message);process.exitCode=1}}

test('Supplier Pay has quick search, payable, settlement and conditional payment fields',()=>{
  ['counterSupplierSearch','counterSupplierAdd','counterSupplierPayable','counterSupplierAmount','counterSupplierWords','counterSupplierDiscount','counterSupplierDiscountReason','counterSupplierMethod','counterSupplierAccount','counterSupplierMore','counterSupplierDate','counterSupplierNote','counterSupplierBackdatedReason','counterSupplierTotal','counterSupplierBalance','counterSupplierPost'].forEach(id=>assert(h.includes('id="'+id+'"'),id+' missing'));
});

test('Supplier Pay posts only through native paySupplier signature',()=>{
  assert.match(h,/serverCall\('paySupplier',\s*authToken,\s*supplierId,\s*amount,\s*method,\s*bankId,\s*note,\s*date,\s*backdatedReason,\s*discountAmount,\s*discountReason\)/);
  assert(!/postCounterSupplier|counterSupplierPaymentRpc/.test(h));
});

test('Supplier quick add reuses native add modal and autoselects after lightweight refresh',()=>{
  assert.match(h,/supOpenAdd_\(function\s*\(newId\)/);
  assert.match(h,/serverCall\('getCounterSuppliers',\s*authToken\)/);
  assert.match(h,/counterState\.supplierCombo\.selectById\(newId\)/);
});

test('Supplier amount words use physical payment and settlement includes discount',()=>{
  assert.match(h,/counterAmountInBangla_\(document\.getElementById\('counterSupplierAmount'\)\.value\)/);
  assert.match(h,/function counterSupplierRecalc_[\s\S]{0,900}payment\s*\+\s*discount/);
});

test('Supplier failure preserves entry and success resets/focuses supplier search',()=>{
  assert.match(h,/function counterResetSupplier_\s*\(/);
  assert.match(h,/counterState\.supplierCombo\.focus\(\)/);
  assert.match(h,/serverCall\('paySupplier'[\s\S]{0,900}counterResetSupplier_\(\)[\s\S]{0,900}\.catch\(function\s*\(err\)/);
});

test('Supplier payable display and settlement use bootstrap payable field',()=>{
  assert.match(h,/function counterSupplierSelected_[\s\S]{0,500}item\.payable/);
  assert.match(h,/function counterSupplierRecalc_[\s\S]{0,900}currentSupplier\.payable/);
});

if(!process.exitCode)console.log('6/6 passed');
