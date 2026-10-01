const fs=require('fs'), assert=require('assert');
const h=fs.readFileSync('counter.html','utf8');
function test(n,f){try{f();console.log('PASS '+n)}catch(e){console.error('FAIL '+n+'\n'+e.message);process.exitCode=1}}

test('Counter mounts native Customer/Supplier add modals outside hidden SPA pages before opening them',()=>{
  assert.match(h,/function counterEnsureGlobalModal_\s*\(modalId\)[\s\S]{0,500}document\.body\.appendChild\(modal\)/);
  assert.match(h,/counterCustomerAdd['"]?\)\.addEventListener\('click',[\s\S]{0,300}counterEnsureGlobalModal_\('custModal'\)[\s\S]{0,200}custOpenAdd_\(/);
  assert.match(h,/counterSupplierAdd['"]?\)\.addEventListener\('click',[\s\S]{0,300}counterEnsureGlobalModal_\('supModal'\)[\s\S]{0,200}supOpenAdd_\(/);
});

test('Expense Counter exposes inline quick-add controls for category and payee',()=>{
  ['counterExpenseCategoryAdd','counterExpenseCategoryQuick','counterExpenseCategoryName','counterExpenseCategorySave',
   'counterExpensePayeeAdd','counterExpensePayeeQuick','counterExpensePayeeName','counterExpensePayeePhone','counterExpensePayeeSave']
    .forEach(id=>assert(h.includes('id="'+id+'"'),id+' missing'));
});

test('Expense Category quick-add reuses addExpenseCategory and auto-selects created category',()=>{
  assert.match(h,/serverCall\('addExpenseCategory',\s*authToken,\s*\{\s*name:\s*name\s*\}\)/);
  assert.match(h,/counterState\.expenseCategories\.push\([\s\S]{0,180}id:\s*res\.id[\s\S]{0,180}name:\s*name/);
  assert.match(h,/counterFillSimpleSelect_\(document\.getElementById\('counterExpenseCategory'\)[\s\S]{0,220}document\.getElementById\('counterExpenseCategory'\)\.value\s*=\s*res\.id/);
});

test('Expense Payee quick-add reuses addExpensePayee and auto-selects created payee',()=>{
  assert.match(h,/serverCall\('addExpensePayee',\s*authToken,\s*\{\s*name:\s*name,\s*phone:\s*phone\s*\}\)/);
  assert.match(h,/counterState\.expensePayees\.push\([\s\S]{0,220}id:\s*res\.id[\s\S]{0,220}name:\s*res\.name\s*\|\|\s*name[\s\S]{0,220}phone:\s*phone/);
  assert.match(h,/counterFillSimpleSelect_\(document\.getElementById\('counterExpensePayee'\)[\s\S]{0,220}document\.getElementById\('counterExpensePayee'\)\.value\s*=\s*res\.id/);
});

test('Quick-add failures do not reset the active Counter transaction form',()=>{
  ['addExpenseCategory','addExpensePayee'].forEach(fn=>{
    const idx=h.indexOf("serverCall('"+fn+"'");
    assert(idx>=0,fn+' RPC missing');
    const catchIdx=h.indexOf('.catch(function (err)',idx);
    assert(catchIdx>idx,fn+' catch missing');
    const failure=h.slice(catchIdx,catchIdx+500);
    assert(!/counterResetExpense_\(\)/.test(failure),fn+' failure must not clear expense entry');
  });
});

if(!process.exitCode)console.log('5/5 passed');
