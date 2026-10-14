'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=(name)=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const ui=read('purchase.html'),server=read('Purchase.gs'),shared=read('javascript.html');

test('Purchase preserves original supplier ID field while adding one searchable input',()=>{
 assert.match(ui,/<select\s+id="purSupplier"\s+hidden/);
 assert.match(ui, /id="purSupplierSearch"[^>]*type="search"/);
 assert.match(ui, /id="purSupplierResults"[^>]*counter-combo-results/);
 assert.match(ui, /id="purSupplierToggle"/);
 assert.equal((ui.match(/id="purSupplierSearch"/g)||[]).length,1);
});
test('Purchase bootstrap reuses active suppliers and includes existing Current Due and Phone',()=>{
 assert.match(server,/activeRows_\('SUPPLIERS'\)\.filter/);
 assert.match(server,/suppliers:\s*suppliers\.map\(function\s*\(s\)/);
 assert.match(server,/phone:\s*s\['Phone'\]/);
 assert.match(server,/currentDue:\s*Number\(s\['Current Due'\]\)\s*\|\|\s*0/);
});
test('shared party search supports escaped balance description without changing existing name or phone',()=>{
 assert.match(shared,/function createPartySearchCombobox_\(config\)/);
 assert.match(shared,/typeof config\.rightText === 'function'/);
 assert.match(shared,/escapeHtml\(String\(config\.rightText\(item\)/);
});
test('Purchase reuses shared combobox and preserves source supplier ID on selection',()=>{
 assert.match(ui,/createPartySearchCombobox_\(/);
 assert.match(ui,/onSelect:\s*function\s*\(supplier\)\s*\{\s*sel\.value\s*=\s*supplier\.id/);
 assert.match(ui,/sel\.dispatchEvent\(new Event\('change',\s*\{\s*bubbles:\s*true\s*\}\)\)/);
 assert.match(ui,/supplierCombo\.setSelected\(/);
});
test('supplier balance labels distinguish payable, supplier credit and settled',()=>{
 for(const label of ['Payable','Supplier Credit','Settled'])assert.ok(ui.includes(label));
 assert.match(ui,/formatMoney\(Math\.abs\(due\)\)/);
});
test('typing after selection invalidates the hidden supplier ID before posting',()=>{
 assert.match(ui,/purSupplierSearch[^\n]*\.addEventListener\('input'/);
 assert.match(ui,/!input\.dataset\.selectedId/);
 assert.match(ui,/sel\.value\s*=\s*''/);
});
test('purchase edit, cancel, quick-add and update reset resync the combobox',()=>{
 for(const name of ['purPopulateUpdateForm_','purCancelUpdateBtn','purQuickSupplierSave','finishPurchaseSave_'])assert.ok(ui.includes(name));
 assert.match(ui,/purPopulateUpdateForm_[\s\S]*?purFillSupplierSelect_\(\);[\s\S]*?function purEdit_/);
 assert.match(ui,/purQuickSupplierSave[\s\S]*?purFillSupplierSelect_\(\);[\s\S]*?showToast\("Supplier added"/);
});
test('stock, payments, purchase posting and confirmation still read original supplier ID',()=>{
 for(const code of [
 "document.getElementById('purSupplier').value",
 'document.getElementById("purSupplier").value',
 'supplierId: document.getElementById("purSupplier").value',
 "selectedOptionText_('purSupplier')",
 'purRefreshCartEntryAvailability_',
 'serverCall("addSupplier"'
 ])assert.ok(ui.includes(code),code);
});
