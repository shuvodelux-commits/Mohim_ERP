const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const assert = require('assert');

const ROOT = process.cwd();
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const src = {};
for (const f of fs.readdirSync(ROOT).filter(f => f.endsWith('.html'))) src[f] = read(f);
const js = src['javascript.html'];
const css = src['style.html'];
const index = src['index.html'];
const runCache = new Map();
function runTest(file) {
  if (!runCache.has(file)) {
    cp.execFileSync(process.execPath, [file], { cwd: ROOT, stdio: 'pipe' });
    runCache.set(file, true);
  }
  return true;
}
function functionBlock(text, name) {
  const re = new RegExp('function\\s+' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)(?=\\n\\s*function\\s+|\\n\\s*document\\.|\\n\\s*// \-|<\/script>)');
  const m = text.match(re);
  assert.ok(m, 'function not found: ' + name);
  return m[0];
}
function confirmedRpc(file, rpc) {
  const pattern = new RegExp(String.raw`(?:runConfirmedAction|confirmDelete)\([\s\S]{0,3500}(?:serverCall\(['"]${rpc}['"]|fn:\s*['"]${rpc}['"])`);
  assert.match(src[file], pattern);
}
function noConfirmationIn(file, fn) {
  const b = functionBlock(src[file], fn);
  assert.doesNotMatch(b, /runConfirmedAction|confirmAction\s*\(|confirmDelete\s*\(/);
}
function assertValidationBeforeConfirm(file, fn) {
  const b = functionBlock(src[file], fn);
  const c = b.indexOf('runConfirmedAction');
  assert.ok(c > 0, fn + ' must confirm');
  const before = b.slice(0, c);
  assert.match(before, /if\s*\([^)]*\)\s*\{[^{}]*return;/s, fn + ' must validate before confirmation');
}
function stripComments(t) { return t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1'); }
function topLevelGsFunctions() {
  const map = new Map();
  for (const f of fs.readdirSync(ROOT).filter(f => f.endsWith('.gs'))) {
    const t = read(f); let m; const re = /^function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
    while ((m = re.exec(t))) { if (!map.has(m[1])) map.set(m[1], []); map.get(m[1]).push(f); }
  }
  return map;
}
function parseAllGs() { for (const f of fs.readdirSync(ROOT).filter(f=>f.endsWith('.gs'))) new Function(read(f)); }
function parseAllHtmlScripts() {
  for (const f of fs.readdirSync(ROOT).filter(f=>f.endsWith('.html'))) {
    const t=read(f), re=/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi; let m;
    while((m=re.exec(t))) { const body=m[1].replace(/<\?[\s\S]*?\?>/g,''); if(body.trim()) new Function(body); }
  }
}
const BASELINE_GS_HASHES = {
  "Auth.gs": "4a74a6f318b2f7f00fa29795992ca9ea0018626652f3355404c622d9ef0bdbd8",
  "BankAccounts.gs": "5422bfa613c5f2d4bf11e3396b5100484997230847cd907f97389823b891e8fd",
  "BankBook.gs": "1aa211d641018310196063c95b3cb209a624fe4eab9d38e06a25cee89e16b788",
  "BankLedger.gs": "5728cb23acf6854fd4a44e34a916c4da96d9f9acb3b9049c386767e5ee6ef08b",
  "CashBook.gs": "3cc01c44cad7a39883723dd70db9947f525b56ba1454bd20acd33f79b0875e3e",
  "CashSession.gs": "577cf9c5c942079fbff4957c9da794eaa190c662a0111c23e49dc404827faf4f",
  "Code.gs": "ff0e80706eea15187274297c9684f7248486363dc95d646437346ad0c4c00135",
  "Config.gs": "173293e5afb795452ad7d369b6b3f358e5703b040d2f15e28bf600c562822f04",
  "Counter.gs": "78eafc50fb651a989554062f03eb2791549f67dd8eca424a48177cb1be4357cb",
  "Customer.gs": "80bb08ac0c075521b6dce9e87633bd02a0199044c6cae6e58f64b956fa1de232",
  "Dashboard.gs": "5cae070c6005d730a4fd82768120c6f5ad7978dbf1b25b8d2f2b75574f74ea26",
  "Database.gs": "77efe8751a5c34ae8aec3ee5a202eb0fd89182c051ff4e3e1186127ab62e0e8a",
  "DayBook.gs": "6655fd56cbad53a040f5f99dc24ed1b78e8524baa776b6a67797438366eaafa1",
  "DeleteEngine.gs": "b4c1d1b59484428f0231c640831c6f38b9261cc9afa6f5dd5c543e84dc61fb18",
  "Diagnostics.gs": "036c92cd5493336644612d8e28ada4bf95b3c2499b4afaf03c16e88b0c95c37c",
  "DraftSales.gs": "873004e5368d7246cea76dc777f5fc2b482437cd5ef71406e6a6d6f061f687e8",
  "Expense.gs": "e8ac6c1da973641dab10eddf59944b519c8ae12dfabc8eb5f1aa05ac6d3d54cd",
  "ExpenseSettings.gs": "9a99f033aba940df911d1eb723d470d05f64e9c2e103d285ed4795307014c7f6",
  "FinanceModule.gs": "21abde180581241fa71631bc6a073848f5e53249fe5e85593231cce57f237953",
  "Invoice.gs": "01017b7a6f003beec4768663315526aab4bcc538660f385db77c152ff84ac1db",
  "OpeningBalance.gs": "98d79916a74a91607f7dd6a84df44acb8bf333b0a61f3fe47931507cd3de3d6f",
  "PartyLedger.gs": "71ca5950b8f53e7ece1d6bc737bf9cd4ded2f0bf2b806665ef25bfee0ae1f248",
  "ProductSettings.gs": "7516c9b39f4247532516dfbf6017a4287e5a51e8da49ec77a05fca0d3fe5536c",
  "Products.gs": "03c7ee3d3cca2bf45c5f041aa220df30007a4223024b2fd384a25c9aa8002abd",
  "Purchase.gs": "f6d7f5ba2e14c0ba6e4a63cb18c4c0fe79591a5d1fbcf6834617e373b55751cf",
  "PurchaseManagement.gs": "0ce133d8e74e1a750291993c5677daba7f47f89eaf220f2dc4a87b37cd6b7ca9",
  "PurchaseReturn.gs": "43460cd32af04d3e54483beb4d6be8e33f6cc1c869bb0cf0852067fd9ab3b154",
  "Reports.gs": "b95a592d2572737a1d0077b7c7ab606a7d6054f795f10a579f23193e9fabf406",
  "RoleManagement.gs": "1d817054dfbcab9e490de7359fe512a4cbf8f74149173c97eb9b8ddd1c84c4a8",
  "Sales.gs": "03736082da20887ce59eeae4ac74b7f8a302f3c7cb17c329bbb6ca4631916d4b",
  "SalesManagement.gs": "1318d3275fa1dbfd293063a27f8380040015ee7f74a9f1dfcc05e00bd362e4ba",
  "SalesReturn.gs": "a65981fd4d2f3a08c55be8240ffeddf4a132561d6e79209b8da78116f74bbf20",
  "SeedData.gs": "36a3df37af0ba0adf99dc61785f2dc75953dc53a48d0e245c6256d6ee00697bd",
  "Settings.gs": "f9623cde85ec98d4fb97eefb9637a2afdb85ed5303df3b20f1a672c0cc22e383",
  "SettlementDiscount.gs": "1af2a3497af22832fbed1236b492caa49f4ba68f8171ea651d1652fa0845156a",
  "Setup.gs": "7cb21db3d3d7759d224b085f85b4a90231c81523850bb7ddd1bc5e0aaa02927e",
  "StockLots.gs": "010d2b9cc1443e71a88e728fef161d92ad80aa50739eb8c4315d90801deeb177",
  "Suppliers.gs": "cd57b9c6d9bff09abe0bd058d3fd2f3d607166aa5b5668d8e23429a1cdeb29b0",
  "UI.gs": "171b4ca6a7322580759ab4fd8fd38680fe12f0b623381e0a605df5c1fdd6fe16",
  "UserManagement.gs": "761ac1de6dd01572702eb9e3f1797c53164ccb6c7d49efdf7aa4ba8a879d62d2",
  "Utils.gs": "1fb66aaf6da247c431ea041a50e1612ec19b1698709d5c0090f5390cedc16ff3",
  "Vendors.gs": "0ec3d3813de2eec3ac2773a453d6c8d49b63784d5f8616a6f2a8625a23e451a5"
};
function assertGsUnchanged() {
  const files=Object.keys(BASELINE_GS_HASHES).sort();
  assert.deepEqual(fs.readdirSync(ROOT).filter(f=>f.endsWith('.gs')).sort(), files);
  for(const f of files) { const h=crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,f))).digest('hex'); assert.equal(h, BASELINE_GS_HASHES[f], f+' server code changed'); }
}
function rpcAudit() {
  const funcs=topLevelGsFunctions(); const missing=new Set();
  for(const [f,t0] of Object.entries(src)) { const t=stripComments(t0); let m; const re=/\bserverCall\(\s*['"]([A-Za-z_$][\w$]*)['"]/g; while((m=re.exec(t))) if(!funcs.has(m[1])) missing.add(m[1]); }
  assert.deepEqual([...missing], []);
}
function duplicateAudit() { const dup=[...topLevelGsFunctions()].filter(([,files])=>files.length>1); assert.deepEqual(dup, []); }
function noConflictMarkers() { for(const f of fs.readdirSync(ROOT).filter(f=>/\.(?:gs|html|js|md)$/.test(f))) assert.doesNotMatch(read(f), /^(?:<<<<<<<|=======|>>>>>>>)/m, f); }
function runGroup(files) { files.forEach(runTest); }

const checks = [];
function check(n, name, fn) { checks.push({n,name,fn}); }
check(1,'global container outside SPA',()=>{assert.match(index,/id="confirmActionModal"/); assert.ok(index.indexOf('id="confirmActionModal"') > index.indexOf('</main>'));});
check(2,'desktop centered modal',()=>assert.match(css,/\.confirm-action-overlay\s*\{[^}]*align-items:\s*center;[^}]*justify-content:\s*center/s));
check(3,'mobile bottom sheet',()=>runTest('tests/confirmation_acceptance.test.js'));
check(4,'single confirmation at a time',()=>runTest('tests/confirmation_acceptance.test.js'));
check(5,'confirm initial focus',()=>runTest('tests/confirmation_acceptance.test.js'));
check(6,'opening Enter guard',()=>runTest('tests/confirmation_acceptance.test.js'));
check(7,'second Enter confirms',()=>runTest('tests/confirmation_acceptance.test.js'));
check(8,'Esc cancels pre-submit',()=>runTest('tests/confirmation_acceptance.test.js'));
check(9,'cancel restores trigger focus',()=>runTest('tests/confirmation_acceptance.test.js'));
check(10,'background is modal-locked',()=>{assert.match(index,/aria-modal="true"/); assert.match(css,/body\.confirm-action-open\s*\{[^}]*overflow:\s*hidden/s);});
check(11,'frozen payload drives summary and native action',()=>runTest('tests/confirmation_sales_purchase_returns.test.js'));
check(12,'Customer Receive confirmation',()=>runTest('tests/confirmation_financial_flows.test.js'));
check(13,'Customer Ledger Receive confirmation',()=>runTest('tests/confirmation_financial_flows.test.js'));
check(14,'Counter Customer Receive confirmation',()=>runTest('tests/confirmation_financial_flows.test.js'));
check(15,'Supplier Pay confirmation',()=>runTest('tests/confirmation_financial_flows.test.js'));
check(16,'Supplier Ledger Pay confirmation',()=>runTest('tests/confirmation_financial_flows.test.js'));
check(17,'Counter Supplier Pay confirmation',()=>runTest('tests/confirmation_financial_flows.test.js'));
check(18,'Expense Add confirmation',()=>runTest('tests/confirmation_financial_flows.test.js'));
check(19,'Counter Expense confirmation',()=>runTest('tests/confirmation_financial_flows.test.js'));
check(20,'Bank Transfer confirmation',()=>runTest('tests/confirmation_financial_flows.test.js'));
check(21,'Counter Bank Transfer confirmation',()=>runTest('tests/confirmation_financial_flows.test.js'));
check(22,'Sale posting confirmation',()=>runTest('tests/confirmation_sales_purchase_returns.test.js'));
check(23,'Purchase posting confirmation',()=>runTest('tests/confirmation_sales_purchase_returns.test.js'));
check(24,'Sales Return confirmation',()=>runTest('tests/confirmation_sales_purchase_returns.test.js'));
check(25,'Purchase Return confirmation',()=>runTest('tests/confirmation_sales_purchase_returns.test.js'));
check(26,'Start Cash Session confirmation',()=>runTest('tests/confirmation_sales_purchase_returns.test.js'));
check(27,'Close Cash Session confirmation',()=>runTest('tests/confirmation_sales_purchase_returns.test.js'));
check(28,'Finance posting confirmation',()=>runTest('tests/confirmation_vendor_finance_inventory.test.js'));
check(29,'Vendor money movement confirmation',()=>runTest('tests/confirmation_vendor_finance_inventory.test.js'));
check(30,'Vendor stock movement confirmation',()=>runTest('tests/confirmation_vendor_finance_inventory.test.js'));
check(31,'Stock adjustment confirmation',()=>runTest('tests/confirmation_vendor_finance_inventory.test.js'));
check(32,'Delete Sale danger path',()=>{assert.match(src['sales.html'],/confirmDelete\([\s\S]{0,1000}deleteDayBookEntry/); runTest('tests/confirmation_dialog_core.test.js');});
check(33,'Delete Purchase danger path',()=>confirmedRpc('purchase.html','deletePurchase'));
check(34,'Delete Customer Payment danger path',()=>confirmedRpc('customers.html','deleteCustomerPayment'));
check(35,'Delete Supplier Payment danger path',()=>confirmedRpc('suppliers.html','deleteSupplierPayment'));
check(36,'Delete Expense danger path',()=>confirmedRpc('expenseList.html','deleteExpense'));
check(37,'Delete Finance danger path',()=>confirmedRpc('financeLedger.html','deleteFinanceTransaction'));
check(38,'confirmDelete compatibility',()=>runTest('tests/confirmation_dialog_core.test.js'));
check(39,'required destructive reason rendered',()=>{assert.match(js,/reason:\s*\{[\s\S]{0,220}required:\s*true/); assert.match(index,/id="confirmActionReason"/);});
check(40,'blank reason blocked',()=>runTest('tests/confirmation_acceptance.test.js'));
check(41,'reason reaches native function',()=>assert.match(js,/concat\(o\.args\s*\|\|\s*\[\],\s*\[reason\]\)/));
check(42,'financial numeric amount summary',()=>runTest('tests/confirmation_financial_flows.test.js'));
check(43,'financial Bangla amount summary',()=>{runTest('tests/confirmation_dialog_core.test.js'); runTest('tests/confirmation_financial_flows.test.js');});
check(44,'settlement shows movement and total',()=>runTest('tests/confirmation_financial_flows.test.js'));
check(45,'words use physical payment not settlement',()=>runTest('tests/confirmation_financial_flows.test.js'));
check(46,'bank confirmation shows account',()=>{assert.match(src['bank.html'],/label:\s*'Account'/); runTest('tests/confirmation_financial_flows.test.js');});
check(47,'bank transfer shows From and To',()=>{assert.match(src['counter.html'],/label:'From'/); assert.match(src['counter.html'],/label:'To'/);});
check(48,'sale summary fields',()=>runTest('tests/confirmation_sales_purchase_returns.test.js'));
check(49,'purchase summary fields',()=>runTest('tests/confirmation_sales_purchase_returns.test.js'));
check(50,'return warns stock/accounting',()=>runTest('tests/confirmation_sales_purchase_returns.test.js'));
check(51,'danger styling',()=>{assert.match(js,/o\.type === 'danger' \? 'btn-danger'/); assert.match(css,/\.confirm-action-dialog\.is-danger/);});
check(52,'financial primary styling',()=>{assert.match(js,/: 'btn-primary'/); assert.match(css,/\.confirm-action-dialog\.is-financial/);});
check(53,'state-change warning styling',()=>{assert.match(js,/'btn-warning'/); assert.match(css,/\.confirm-action-dialog\.is-state-change/);});
check(54,'confirm disabled after submit',()=>runTest('tests/confirmation_acceptance.test.js'));
check(55,'repeat click no duplicate RPC',()=>runTest('tests/confirmation_acceptance.test.js'));
check(56,'repeat Enter no duplicate RPC',()=>runTest('tests/confirmation_acceptance.test.js'));
check(57,'Cancel disabled pending',()=>runTest('tests/confirmation_acceptance.test.js'));
check(58,'server failure not success',()=>runTest('tests/confirmation_acceptance.test.js'));
check(59,'failure preserves form values',()=>runTest('tests/confirmation_acceptance.test.js'));
check(60,'client validation before confirmation',()=>{['counterCustomerPost_','counterSupplierPost_','counterExpensePost_','counterTransferPost_'].forEach(fn=>assertValidationBeforeConfirm('counter.html',fn));});
check(61,'invalid forms do not confirm',()=>{['counterCustomerPost_','counterSupplierPost_','counterExpensePost_','counterTransferPost_'].forEach(fn=>assertValidationBeforeConfirm('counter.html',fn));});
check(62,'quick-adds stay confirmation-free',()=>{ const c=src['counter.html']; for(const marker of ['custOpenAdd_(','supOpenAdd_(','addExpenseCategory','addExpensePayee']){ const i=c.indexOf(marker); assert.ok(i>=0,marker); assert.doesNotMatch(c.slice(Math.max(0,i-700),i+1300),/runConfirmedAction|confirmAction\s*\(|confirmDelete\s*\(/,marker+' must stay direct'); } });
check(63,'view print search pagination stay confirmation-free',()=>{noConfirmationIn('javascript.html','printLedgerRange'); noConfirmationIn('customerLedger.html','customerLedgerLoadPage_'); noConfirmationIn('supplierLedger.html','supplierLedgerLoadPage_'); noConfirmationIn('customers.html','custOpenDetail_'); noConfirmationIn('suppliers.html','supOpenDetail_');});
check(64,'ordinary non-financial master edits stay direct',()=>runTest('tests/confirmation_vendor_finance_inventory.test.js'));
check(65,'Customer deletion confirmation',()=>{assert.match(src['customers.html'],/title:\s*'Delete Customer\?'/); assert.match(src['customers.html'],/type:\s*'danger'/);});
check(66,'Supplier deletion confirmation',()=>confirmedRpc('suppliers.html','deleteSupplier'));
check(67,'Product deletion confirmation',()=>confirmedRpc('products.html','deleteProduct'));
check(68,'User delete/reset confirmation',()=>runTest('tests/confirmation_system_actions.test.js'));
check(69,'Role deletion confirmation',()=>runTest('tests/confirmation_system_actions.test.js'));
check(70,'Sign-out confirmation',()=>runTest('tests/confirmation_system_actions.test.js'));
check(71,'Remove logo confirmation',()=>runTest('tests/confirmation_system_actions.test.js'));
check(72,'protected browser confirm removed',()=>runTest('tests/confirmation_system_actions.test.js'));
check(73,'server accounting mutation regressions',()=>runGroup(['tests/audit_financial_crud.test.js','tests/audit_sales_stock.test.js','tests/state_drift_accounting_invariants.test.js']));
check(74,'no server confirmation UI writer',()=>{for(const f of fs.readdirSync(ROOT).filter(f=>f.endsWith('.gs'))) assert.doesNotMatch(read(f), /function\s+(?:confirmAction|runConfirmedAction|confirmDelete)\s*\(/);});
check(75,'Customer accounting regressions',()=>runGroup(['tests/settlement_discount.test.js','tests/party_ledger_workspace.test.js']));
check(76,'Supplier accounting regressions',()=>runGroup(['tests/settlement_discount.test.js','tests/party_ledger_workspace.test.js']));
check(77,'Expense accounting regressions',()=>runGroup(['tests/audit_financial_crud.test.js','tests/vendor_workspace_actions_expense_test.js']));
check(78,'Bank regressions',()=>runGroup(['tests/audit_financial_crud.test.js','tests/reports_business_logic.test.js']));
check(79,'Sales Purchase Return regressions',()=>runGroup(['tests/audit_sales_stock.test.js','tests/return_ledger_regressions.test.js','tests/lot_selling_price.test.js','tests/pre_correction_native_actions.test.js']));
check(80,'Vendor Finance regressions',()=>runGroup(['tests/vendor_workspace_actions_expense_test.js','tests/pre_correction_native_actions.test.js']));
check(81,'Counter transaction regressions',()=>runGroup(['tests/counter_bootstrap.test.js','tests/counter_expense_transfer.test.js','tests/counter_quick_add_fix.test.js','tests/counter_quick_add_reuse.test.js','tests/counter_supplier_pay.test.js','tests/confirmation_financial_flows.test.js']));
check(82,'mobile transaction regressions',()=>runGroup(['tests/mobile_customer_return_regressions.test.js','tests/confirmation_acceptance.test.js']));
check(83,'HTML and Apps Script syntax',()=>{parseAllGs(); parseAllHtmlScripts();});
check(84,'RPC target validation',()=>rpcAudit());
check(85,'no duplicate globals',()=>{duplicateAudit(); noConflictMarkers();});

assert.equal(checks.length, 85, 'matrix must define exactly 85 checks');
for (let i=1;i<=85;i++) assert.equal(checks[i-1].n,i,'matrix must stay sequential');
let failed=0;
for(const c of checks){ try{c.fn(); console.log('PASS '+c.n+'/85 '+c.name);}catch(e){failed++; console.error('FAIL '+c.n+'/85 '+c.name+'\n'+e.stack);} }
if(failed) process.exitCode=1; else console.log('confirmation_spec_matrix: 85/85 PASS');
