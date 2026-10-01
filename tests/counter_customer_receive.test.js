const fs=require('fs'), assert=require('assert');
const h=fs.readFileSync('counter.html','utf8');
function test(n,f){try{f();console.log('PASS '+n)}catch(e){console.error('FAIL '+n+'\n'+e.message);process.exitCode=1}}

test('Customer Receive has the approved quick-entry fields',()=>{
  ['counterCustomerSearch','counterCustomerAdd','counterCustomerDue','counterCustomerAmount','counterCustomerWords','counterCustomerDiscount','counterCustomerDiscountReason','counterCustomerMethod','counterCustomerAccount','counterCustomerMore','counterCustomerDate','counterCustomerNote','counterCustomerBackdatedReason','counterCustomerTotal','counterCustomerBalance','counterCustomerPost'].forEach(id=>assert(h.includes('id="'+id+'"'),id+' missing'));
});

test('Customer Receive posts only through native receivePayment signature',()=>{
  assert.match(h,/serverCall\('receivePayment',\s*authToken,\s*customerId,\s*amount,\s*method,\s*bankId,\s*note,\s*date,\s*backdatedReason,\s*discountAmount,\s*discountReason,\s*allocatedInvoiceId\)/);
  assert(!/postCounterCustomer|counterReceivePayment/.test(h));
});

test('Customer Receive quick add reuses native modal then refreshes/selects new customer',()=>{
  assert.match(h,/custOpenAdd_\(function\s*\(newId\)/);
  assert.match(h,/serverCall\('getCounterCustomers',\s*authToken\)/);
  assert.match(h,/counterState\.customerCombo\.selectById\(newId\)/);
});

test('Customer Receive guards duplicate posting and preserves on failure',()=>{
  assert.match(h,/if\s*\(counterState\.inFlight\)\s*return/);
  assert.match(h,/counterSetPosting_\(true/);
  assert.match(h,/\.catch\(function\s*\(err\)[\s\S]{0,500}counterSetPosting_\(false/);
  assert.match(h,/function counterResetCustomer_\s*\(/);
});

test('Customer amount words are based on payment amount while settlement adds discount',()=>{
  assert.match(h,/counterAmountInBangla_\(document\.getElementById\('counterCustomerAmount'\)\.value\)/);
  assert.match(h,/payment\s*\+\s*discount/);
  assert.match(h,/counterCustomerDiscountReasonRow[\s\S]{0,240}discount\s*>\s*0/);
});

if(!process.exitCode)console.log('5/5 passed');
