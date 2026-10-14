'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
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
 assert.match(ui,/input\.addEventListener\('input',\s*function/);
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

test('selected supplier ID and result balances stay correct while switching and typing',()=>{
 const begin=ui.indexOf('  function purFillSupplierSelect_() {');
 const end=ui.indexOf('  function purProductById_',begin);
 assert.ok(begin>=0 && end>begin);
 const listeners={},changes=[],selected=[];
 const sel={
   value:'',_html:'',
   get innerHTML(){return this._html;},
   set innerHTML(value){this._html=value;this.value='';},
   dispatchEvent(event){changes.push(event.type);}
 };
 const input={dataset:{selectedId:''},value:'',addEventListener(name,fn){listeners[name]=fn;}};
 const elements={purSupplier:sel,purSupplierSearch:input,
   purSupplierResults:{id:'purSupplierResults'},purSupplierToggle:{}};
 let config;
 const suppliers=[
   {id:'S1',name:'Rahim Traders',phone:'0170001',currentDue:200},
   {id:'S2',name:'Credit Supplier',phone:'',currentDue:-40},
   {id:'S3',name:'Settled Supplier',phone:'',currentDue:0}
 ];
 const context={
   document:{getElementById:id=>elements[id]},purState:{suppliers,supplierCombo:null},
   createPartySearchCombobox_:options=>{
     config=options;
     return {setSelected(item){
       selected.push(item&&item.id||'');
       input.dataset.selectedId=item&&item.id||'';
       input.value=item&&item.name||'';
     }};
   },
   escapeHtml:String,formatMoney:amount=>'৳'+amount,
   Event:function(type){this.type=type;}
 };
 vm.runInNewContext(ui.slice(begin,end),context);
 context.purFillSupplierSelect_();
 assert.equal(config.rightText(suppliers[0]),'Payable · ৳200');
 assert.equal(config.rightText(suppliers[1]),'Supplier Credit · ৳40');
 assert.equal(config.rightText(suppliers[2]),'Settled · ৳0');
 config.onSelect(suppliers[0]);
 assert.equal(sel.value,'S1');
 input.dataset.selectedId='';
 listeners.input();
 assert.equal(sel.value,'','unselected typing must invalidate old supplier ID');
 assert.equal(changes.filter(x=>x==='change').length,2);
 sel.value='S2';
 context.purFillSupplierSelect_();
 assert.equal(selected.at(-1),'S2','purchase edit/reset must sync visible selection');
 config.onClear();
 assert.equal(sel.value,'');
});

test('hidden supplier ID does not create a second touch dropdown control',()=>{
 assert.match(ui,/<select\s+id="purSupplier"[^>]*hidden[^>]*data-touch-select-skip="true"/);
 assert.match(ui, /#purSupplier\s*\{\s*display:\s*none\s*!important\s*;?\s*\}/);
 const start=shared.indexOf('  function touchSelectShouldEnhance_(select) {');
 const end=shared.indexOf('  function touchSelectLabel_(select) {',start);
 assert.ok(start>=0&&end>start,'use the real ERP touch select enhancer predicate');
 const c={};
 vm.runInNewContext(shared.slice(start,end)+
   "result={internal:touchSelectShouldEnhance_({tagName:'SELECT',dataset:{touchSelectSkip:'true'}}),"+
   "normal:touchSelectShouldEnhance_({tagName:'SELECT',dataset:{}})}",c);
 assert.equal(c.result.internal,false,'internal purchase supplier ID must not spawn visible dropdown');
 assert.equal(c.result.normal,true,'visible ERP select controls must retain touch behavior');
});

test('touch enhancer cannot insert a visible trigger for the supplier ID store',()=>{
 const shouldStart=shared.indexOf('  function touchSelectShouldEnhance_(select) {');
 const shouldEnd=shared.indexOf('  function touchSelectLabel_(select) {',shouldStart);
 const enhanceStart=shared.indexOf('  function enhanceTouchSelect_(select) {');
 const enhanceEnd=shared.indexOf('  function enhanceTouchSelects_(root) {',enhanceStart);
 assert.ok(shouldStart>=0&&shouldEnd>shouldStart&&enhanceStart>=0&&enhanceEnd>enhanceStart);
 let inserted=0;
 const internal={
   tagName:'SELECT',dataset:{touchSelectSkip:'true'},classList:{add(){}},
   insertAdjacentElement(){inserted++;}
 };
 vm.runInNewContext(shared.slice(shouldStart,shouldEnd)+shared.slice(enhanceStart,enhanceEnd)+
   '\nenhanceTouchSelect_(internal)',{internal});
 assert.equal(inserted,0,'Only search field + New button must be visible');
 assert.equal(internal._touchSelectTrigger,undefined);
});
