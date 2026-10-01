const fs=require('fs'), assert=require('assert');
const h=fs.readFileSync('counter.html','utf8');
function test(n,f){try{f();console.log('PASS '+n)}catch(e){console.error('FAIL '+n+'\n'+e.message);process.exitCode=1}}

test('Expense quick entry exposes native required and conditional fields',()=>{
  ['counterExpenseCategory','counterExpensePayee','counterExpenseDescription','counterExpenseAmount','counterExpenseWords','counterExpenseMethod','counterExpenseAccount','counterExpenseMore','counterExpenseDate','counterExpenseReference','counterExpenseNotes','counterExpenseBackdatedReason','counterExpensePost'].forEach(id=>assert(h.includes('id="'+id+'"'),id+' missing'));
});

test('Expense posts only through native addExpense payload',()=>{
  assert.match(h,/var expensePayload\s*=\s*\{[\s\S]{0,1200}date:\s*date,[\s\S]{0,1200}categoryId:\s*categoryId,[\s\S]{0,1200}payeeId:\s*payeeId,[\s\S]{0,1200}amount:\s*amount,[\s\S]{0,1200}paymentMethod:\s*method,[\s\S]{0,1200}bankAccountId:\s*bankId,[\s\S]{0,1200}description:\s*description,[\s\S]{0,1200}referenceNo:\s*referenceNo,[\s\S]{0,1200}notes:\s*notes,[\s\S]{0,1200}backdatedReason:\s*backdatedReason/);
  assert.match(h,/serverCall\('addExpense',\s*authToken,\s*expensePayload\)/);
  assert(!/postCounterExpense|counterExpenseRpc/.test(h));
});

test('Expense words use physical amount and success resets/focuses category while failure preserves',()=>{
  assert.match(h,/counterAmountInBangla_\(document\.getElementById\('counterExpenseAmount'\)\.value\)/);
  assert.match(h,/function counterResetExpense_\s*\(/);
  assert.match(h,/document\.getElementById\('counterExpenseCategory'\)\.focus\(\)/);
  assert.match(h,/serverCall\('addExpense'[\s\S]{0,900}counterResetExpense_\(\)[\s\S]{0,900}\.catch\(function\s*\(err\)/);
});

test('Bank Transfer exposes from, to, physical amount words and notes without a transaction date',()=>{
  ['counterTransferFrom','counterTransferTo','counterTransferAmount','counterTransferWords','counterTransferMore','counterTransferNotes','counterTransferPost'].forEach(id=>assert(h.includes('id="'+id+'"'),id+' missing'));
  assert(!h.includes('id="counterTransferDate"'));
  assert.match(h,/counterAmountInBangla_\(document\.getElementById\('counterTransferAmount'\)\.value\)/);
});

test('Bank Transfer validates different accounts and posts exact native payload only',()=>{
  assert.match(h,/if\s*\(fromAccountId\s*===\s*toAccountId\)/);
  assert.match(h,/if\s*\(amount\s*<=\s*0\)/);
  assert.match(h,/var transferPayload\s*=\s*\{\s*fromAccountId:\s*fromAccountId,\s*toAccountId:\s*toAccountId,\s*amount:\s*amount,\s*notes:\s*notes\s*\}/);
  assert.match(h,/serverCall\('transferBetweenBankAccounts',\s*authToken,\s*transferPayload\)/);
  assert(!/postCounterTransfer|counterBankTransferRpc/.test(h));
});

test('Bank Transfer success resets/focuses From and failure preserves entry',()=>{
  assert.match(h,/function counterResetTransfer_\s*\(/);
  assert.match(h,/document\.getElementById\('counterTransferFrom'\)\.focus\(\)/);
  assert.match(h,/serverCall\('transferBetweenBankAccounts'[\s\S]{0,900}counterResetTransfer_\(\)[\s\S]{0,900}\.catch\(function\s*\(err\)/);
});

if(!process.exitCode)console.log('6/6 passed');
