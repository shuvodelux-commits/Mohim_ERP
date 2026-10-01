const fs = require('fs');
const vm = require('vm');
function read(f){ return fs.readFileSync(f,'utf8'); }
let pass=0, fail=0;
function test(name, fn){ try{ fn(); console.log('PASS',name); pass++; }catch(e){ console.error('FAIL',name,'-',e.message); fail++; }}
function ok(cond,msg){ if(!cond) throw new Error(msg); }

const expenseGs=read('Expense.gs');
const expLed=read('expenseList.html');
const ui=read('UI.gs');
const index=read('index.html');
const vendors=read('vendors.html');
const vendorGs=read('Vendors.gs');
const config=read('Config.gs');
const js=read('javascript.html');

// Expense History / ledger-backed read path
test('Expense server read paths are self-contained from ExpenseSettings private helper',()=>{
  ok(!expenseGs.includes('getActiveExpensePayeesForUI_'), 'Expense.gs still depends on getActiveExpensePayeesForUI_');
  ok(expenseGs.includes('function getExpensePayeesForUI_'), 'local Expense payee helper missing');
});
test('Expense History keeps ledger headings and explicit empty/error states',()=>{
  ['Payee','Category','Description','Amount','Running Total'].forEach(h=>ok(expLed.includes(h),'missing heading '+h));
  ok(expLed.includes('No expenses match these filters.'),'missing no-data message');
  ok(expLed.includes('expListError'),'missing visible error state');
});

// Shared action menu + converted pages
test('shared row action menu helper exists',()=>{
  ok(js.includes('function openRowActionMenu_'),'missing openRowActionMenu_');
  ok(js.includes('function closeRowActionMenu_'),'missing closeRowActionMenu_');
});
test('Purchase Actions resolves rows from the existing purState.history store',()=>{
  const purchase=read('purchase.html');
  ok(purchase.includes('purState.history.filter(function (x) { return x.purchaseId === id; })'), 'Purchase Actions uses the wrong state object');
  ok(!purchase.includes('purMgmtState.list'), 'stale purMgmtState.list reference remains');
});
['customers.html','suppliers.html','expenseList.html','bank.html','purchase.html','sales.html'].forEach(file=>{
  test(file+' list rows expose compact Actions menu',()=>{
    const s=read(file); ok(s.includes('Actions &#9662;') || s.includes('Actions ▾'),'missing Actions button');
  });
});

// Vendor navigation/workspace
test('Vendor nav is grouped into Ledger + Workspace under Vendor',()=>{
  ok(/key:\s*'vendors',\s*label:\s*'Vendor'/.test(ui),'Vendor parent label not renamed');
  ok(ui.includes("key: 'vendorWorkspace'") && ui.includes("permKey: 'vendors'"),'vendorWorkspace child missing');
});
test('index includes vendor workspace page',()=>{
  ok(index.includes('page-vendorWorkspace'),'vendorWorkspace page section missing');
  ok(index.includes("include('vendorWorkspace')"),'vendorWorkspace include missing');
});
test('global Refresh can reload Vendor Workspace',()=>{
  ok(js.includes("vendorWorkspace: 'vlWorkspaceLoad_'"), 'Vendor Workspace is not registered with the global refresh loader');
  ok(vendors.includes('function vlWorkspaceLoad_'), 'vlWorkspaceLoad_ helper missing');
});
test('Vendor Ledger row uses Actions menu with Workspace/Delete',()=>{
  ok(vendors.includes('Actions &#9662;') || vendors.includes('Actions ▾'),'vendor Actions trigger missing');
  ok(vendors.includes("action: 'workspace'") || vendors.includes("data-menu-act=\"workspace\"") || vendors.includes("'workspace'"),'workspace menu action missing');
  ok(vendors.includes("'delete'") || vendors.includes('data-menu-act="delete"'),'delete menu action missing');
});
test('Vendor workspace markup exists as dedicated file with vendor selector',()=>{
  ok(fs.existsSync('vendorWorkspace.html'),'vendorWorkspace.html missing');
  const w=read('vendorWorkspace.html');
  ok(w.includes('vlWorkspaceVendor'),'workspace vendor selector missing');
  ok(w.includes('vlDetailDue') && w.includes('vlPayAmount') && w.includes('vlLedgerBody'),'existing workflow markup not moved to workspace');
});

// Vendor soft delete
test('VENDORS schema has soft-delete columns',()=>{
  const block=config.match(/VENDORS:\s*\[[\s\S]*?\n\s*\],/);
  ok(block && block[0].includes('Is Deleted') && block[0].includes('Delete Reason'),'VENDORS soft delete schema missing');
});
test('deleteVendor enforces delete permission, zero balances, open-obligation checks, then soft delete',()=>{
  ok(vendorGs.includes('function deleteVendor('),'deleteVendor missing');
  const block=vendorGs.match(/function deleteVendor\([\s\S]*?\n}\n/);
  ok(block,'deleteVendor block not found');
  const s=block[0];
  ok(s.includes("requireDeletePermission_(token, 'vendors'") || s.includes('requirePermission_(token, \'vendors\', \'delete\')'),'delete permission missing');
  ok(s.includes('Current Due') && s.includes('Current Receivable'),'balance guards missing');
  ok(s.includes('openSourcing') && s.includes('openIssues'),'open obligation guards missing');
  ok(s.includes('markRowDeleted_'),'soft delete write missing');
});
test('normal vendor UI lists filter soft-deleted vendors',()=>{
  const block=vendorGs.match(/function getAllVendorsForUI_\([\s\S]*?\n}\n/);
  ok(block && (block[0].includes('activeRows_') || block[0].includes('isDeleted_')),'vendor list does not filter deleted vendors');
});
test('vendor status changes reject soft-deleted masters',()=>{
  const block=vendorGs.match(/function setVendorStatus\([\s\S]*?\n}\n/);
  ok(block && block[0].includes('isDeleted_'), 'setVendorStatus can reactivate a deleted vendor');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
