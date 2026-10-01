const fs = require('fs');
const assert = require('assert');
function read(f){return fs.readFileSync(f,'utf8');}
function test(name, fn){try{fn();console.log('PASS '+name);}catch(e){console.error('FAIL '+name+'\n'+e.stack);process.exitCode=1;}}
const files={counter:read('counter.html'),customers:read('customers.html'),customerLedger:read('customerLedger.html'),suppliers:read('suppliers.html'),supplierLedger:read('supplierLedger.html'),js:read('javascript.html'),expense:read('expense.html'),expenseList:read('expenseList.html'),bank:read('bank.html')};

test('shared settlement confirmation helper exists',()=>{assert.match(files.js,/function settlementConfirmDetails_\(o\)/);});
test('Counter customer and supplier posts are confirmation-gated',()=>{assert.match(files.counter,/runConfirmedAction\([\s\S]{0,2200}serverCall\('receivePayment'/);assert.match(files.counter,/runConfirmedAction\([\s\S]{0,2200}serverCall\('paySupplier'/);});
test('Customer page and ledger payment posts are confirmation-gated',()=>{assert.match(files.customers,/runConfirmedAction\([\s\S]{0,2200}serverCall\('receivePayment'/);assert.match(files.customerLedger,/runConfirmedAction\([\s\S]{0,2200}serverCall\('receivePayment'/);});
test('Supplier page and ledger payment posts are confirmation-gated',()=>{assert.match(files.suppliers,/runConfirmedAction\([\s\S]{0,2200}serverCall\('paySupplier'/);assert.match(files.supplierLedger,/runConfirmedAction\([\s\S]{0,2200}serverCall\('paySupplier'/);});
test('Payment update RPCs are confirmation-gated',()=>{for(const k of ['customers','customerLedger','suppliers','supplierLedger']) assert.match(files[k],/runConfirmedAction\([\s\S]{0,1800}serverCall\('update(?:Customer|Supplier)Payment'/);});
test('Settlement summary includes actual amount words discount and total',()=>{assert.match(files.js,/banglaAmountInWords_\(amount\)/);assert.match(files.js,/Total Settlement/);assert.match(files.js,/o\.discount/);assert.match(files.js,/o\.method/);});

if(!process.exitCode) console.log('6/6 passed');

test('Expense and Counter Expense use confirmation before add/update RPCs',()=>{assert.match(files.expense,/runConfirmedAction\([\s\S]{0,2000}serverCall\('addExpense'/);assert.match(files.expenseList,/runConfirmedAction\([\s\S]{0,2000}serverCall\('updateExpense'/);assert.match(files.counter,/runConfirmedAction\([\s\S]{0,2200}serverCall\('addExpense'/);});
test('Bank transfers and manual entries are confirmation-gated',()=>{assert.match(files.bank,/runConfirmedAction\([\s\S]{0,2200}serverCall\('transferBetweenBankAccounts'/);assert.match(files.bank,/runConfirmedAction\([\s\S]{0,2200}serverCall\('addBankManualEntry'/);assert.match(files.counter,/runConfirmedAction\([\s\S]{0,2200}serverCall\('transferBetweenBankAccounts'/);});
test('Bank reversal reason and account status use shared confirmation',()=>{assert.doesNotMatch(files.bank,/prompt\('Reason for reversing/);assert.doesNotMatch(files.bank,/if \(!confirm\(/);assert.match(files.bank,/title:\s*'Reverse Bank Entry\?'/);assert.match(files.bank,/type:\s*'state-change'/);});
