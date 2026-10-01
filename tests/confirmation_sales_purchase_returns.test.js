const fs=require('fs'), assert=require('assert');
const pos=fs.readFileSync('pos.html','utf8'), purchase=fs.readFileSync('purchase.html','utf8'), returns=fs.readFileSync('returns.html','utf8');
function test(n,f){try{f();console.log('PASS '+n)}catch(e){console.error('FAIL '+n+'\n'+e.stack);process.exitCode=1}}
test('cash session start and close are confirmation gated',()=>{assert.match(pos,/runConfirmedAction\([\s\S]{0,1800}serverCall\('startCashSession'/);assert.match(pos,/runConfirmedAction\([\s\S]{0,2200}serverCall\('closeCashSession'/);});
test('sale create/update uses frozen payload behind confirmation',()=>{assert.match(pos,/runConfirmedAction\([\s\S]{0,2800}serverCall\('updateSale'/);assert.match(pos,/runConfirmedAction\([\s\S]{0,2800}serverCall\('completeSale'/);assert.match(pos,/Grand Total/);assert.match(pos,/Paid Now/);assert.match(pos,/Due/);assert.match(pos,/Item Count/);});
if(!process.exitCode) console.log('2/2 passed');

test('purchase create/update is confirmation gated with supplier totals and item count',()=>{
  assert.match(purchase,/runConfirmedAction\([\s\S]{0,3200}serverCall\('updatePurchase'/);
  assert.match(purchase,/runConfirmedAction\([\s\S]{0,3200}serverCall\('createPurchase'/);
  assert.match(purchase,/Supplier/);
  assert.match(purchase,/Purchase Total/);
  assert.match(purchase,/Paid Now/);
  assert.match(purchase,/Due/);
  assert.match(purchase,/Item Count/);
});

test('sales and purchase returns confirm stock and accounting changes before native commit',()=>{
  assert.match(returns,/runConfirmedAction\([\s\S]{0,2600}serverCall\('completeReturn'/);
  assert.match(purchase,/runConfirmedAction\([\s\S]{0,2800}serverCall\("completePurchaseReturn"/);
  assert.match(returns,/stock and customer accounting/i);
  assert.match(purchase,/stock and supplier accounting/i);
});
