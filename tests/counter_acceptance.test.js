const fs=require('fs'), assert=require('assert');
const h=fs.readFileSync('counter.html','utf8');
const js=fs.readFileSync('javascript.html','utf8');
const css=fs.readFileSync('style.html','utf8');
const gs=fs.readFileSync('Counter.gs','utf8');
const ui=fs.readFileSync('UI.gs','utf8');
function test(n,f){try{f();console.log('PASS '+n)}catch(e){console.error('FAIL '+n+'\n'+e.message);process.exitCode=1}}

test('Counter is a capability-gated UI route directly after POS and is not a permission module',()=>{
  assert.match(ui,/key:\s*'counter'[\s\S]{0,500}actionPermAny/);
  assert.match(ui,/key:\s*'pos'[\s\S]{0,900}key:\s*'counter'/);
  const permBlock=(ui.match(/const PERMISSION_MODULES\s*=\s*\[[\s\S]*?\n\];/)||[''])[0];
  assert(permBlock,'permission module block missing');
  assert(!/key:\s*['"]counter['"]/.test(permBlock));
});

test('Counter registers with global reloaders and loads once on first Counter navigation',()=>{
  assert.match(js,/counter:\s*'counterLoad'/);
  assert.match(h,/goToPage\s*=\s*function\s*\(key\)[\s\S]{0,700}key\s*===\s*'counter'[\s\S]{0,700}!counterState\.loaded[\s\S]{0,700}counterLoad\(\)/);
});

test('Counter initial load uses one bootstrap RPC and combobox filtering is local',()=>{
  const load=(h.match(/function counterLoad\(\)[\s\S]*?\n  \}/)||[''])[0];
  assert.equal((load.match(/serverCall\('getCounterBootstrap'/g)||[]).length,1);
  const filter=(h.match(/function counterFilterItems_\([\s\S]*?\n  \}/)||[''])[0];
  const combo=(h.match(/function counterCreateCombobox_\([\s\S]*?\n  \}/)||[''])[0];
  assert(!/serverCall\(/.test(filter+combo),'combobox search must not call Apps Script');
});

test('Individual transaction selectors are hidden from bootstrap capabilities',()=>{
  ['customerReceive','supplierPay','expenseAdd','bankTransfer'].forEach(cap=>assert(h.includes('counterState.capabilities.'+cap),cap+' capability missing'));
  assert.match(h,/data-counter-type="customer"/); assert.match(h,/data-counter-type="supplier"/); assert.match(h,/data-counter-type="expense"/); assert.match(h,/data-counter-type="transfer"/);
});

test('Counter has all four native mutation calls and no Counter-specific financial mutation',()=>{
  ['receivePayment','paySupplier','addExpense','transferBetweenBankAccounts'].forEach(fn=>assert(h.includes("serverCall('"+fn+"'"),fn+' native RPC missing'));
  assert(!/postCounter|saveCounter|counter(?:Payment|Expense|Transfer)Rpc/.test(h));
  ['appendRow_','updateRowFields_','addCashBookEntry_','addBankBookEntry_','receivePayment(','paySupplier(','addExpense(','transferBetweenBankAccounts('].forEach(token=>assert(!gs.includes(token),'Counter.gs must remain read-only: '+token));
});

test('Successful reset keeps active type, closes More details, and failures preserve form values',()=>{
  ['Customer','Supplier','Expense','Transfer'].forEach(kind=>{
    const reset=(h.match(new RegExp('function counterReset'+kind+'_\\s*\\([\\s\\S]*?\\n  \\}'))||[''])[0];
    assert(reset,'reset missing '+kind);
    assert(!/counterSetActiveType_/.test(reset),'reset must not switch active type: '+kind);
    assert(/\.open\s*=\s*false/.test(reset),'More details must close: '+kind);
  });
  ['receivePayment','paySupplier','addExpense','transferBetweenBankAccounts'].forEach(fn=>{
    const idx=h.indexOf("serverCall('"+fn+"'"); const catchIdx=h.indexOf('.catch(function (err)',idx);
    assert(idx>=0&&catchIdx>idx,fn+' failure handler missing');
    const failure=h.slice(catchIdx,catchIdx+700);
    assert(!/counterReset(?:Customer|Supplier|Expense|Transfer)_\(\)/.test(failure),fn+' failure must not reset form');
  });
});

test('Quick-entry keyboard helper advances only visible fields and never submits from search input',()=>{
  assert.match(h,/function counterWireEnterAdvance_\s*\(/);
  assert.match(h,/e\.key\s*!==\s*'Enter'/);
  assert.match(h,/type\s*===\s*'search'/);
  assert.match(h,/counter-combo-results/);
});

test('Money inputs request decimal keyboard and Bangla words remain attached to physical amount fields',()=>{
  ['counterCustomerAmount','counterSupplierAmount','counterExpenseAmount','counterTransferAmount'].forEach(id=>{
    assert(new RegExp('id="'+id+'"[^>]*inputmode="decimal"').test(h),id+' needs decimal inputmode');
  });
  ['counterCustomerWords','counterSupplierWords','counterExpenseWords','counterTransferWords'].forEach(id=>assert(h.includes('id="'+id+'"'),id+' missing'));
});

test('Counter responsive CSS is compact desktop and single-column phone with 2x2 selector',()=>{
  assert.match(css,/\.counter-page\s*\{[^}]*max-width:/s);
  assert.match(css,/\.counter-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s);
  assert.match(css,/@media\s*\(max-width:\s*540px\)[\s\S]*?\.counter-type-switch\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s);
  assert.match(css,/@media\s*\(max-width:\s*540px\)[\s\S]*?\.counter-grid\s*\{[^}]*grid-template-columns:\s*1fr/s);
  assert.match(css,/\.counter-combo-option\s*\{[^}]*min-height:\s*44px/s);
});

test('Existing mobile primary nav remains Dashboard POS Sales Products and Counter is not promoted there',()=>{
  assert.match(js,/MOBILE_PRIMARY_KEYS_\s*=\s*\['dashboard',\s*'pos',\s*'sales',\s*'products'\]/);
  const line=(js.match(/MOBILE_PRIMARY_KEYS_[^\n]*/)||[''])[0];
  assert(!line.includes('counter'));
});

test('Counter remains quick-entry only with no history/edit/delete/report surface',()=>{
  ['Transaction History','Edit Transaction','Delete Transaction','Counter Report'].forEach(text=>assert(!h.includes(text),text+' must stay out of V1'));
});

if(!process.exitCode)console.log('11/11 passed');
