const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..'); const read=n=>fs.readFileSync(path.join(root,n),'utf8');
const page=read('draftSales.html'), pos=read('pos.html'), js=read('javascript.html'), draft=read('DraftSales.gs');
assert.match(page,/function draftSalesDelete_/); assert.match(page,/typeof confirmAction\s*===\s*['"]function['"]/); assert.match(page,/confirmDelete\s*\(/);
assert.match(js,/successMessage/); assert.match(pos,/Reload Latest/); assert.match(pos,/function posShowDraftConflict_/); assert.match(pos,/function posReloadDraftLatest_/);
assert.match(draft,/deleteSalesDraft[\s\S]*expectedVersion/); assert.match(draft,/deleteSalesDraft[\s\S]*DELETED/);
const forbidden=['completeSale(', 'applyStockConsumption_(', 'addCashBookEntry_(', 'addBankBookEntry_(', 'postVendorLedgerEntry_(', 'requireActiveCashSession_('];
for(const fn of ['saveSalesDraft','updateSalesDraft','deleteSalesDraft']){
  const start=draft.indexOf('function '+fn+'('); assert(start>=0,fn+' missing'); const next=draft.indexOf('\nfunction ',start+10); const body=draft.slice(start,next<0?draft.length:next);
  forbidden.forEach(token=>assert(!body.includes(token),fn+' must not call '+token));
}
assert(!/data-act=["']post["']|>\s*Post\s*</i.test(page),'draft list must not expose Post');
assert(!/serverCall\(['"]completeSale['"]/.test(page),'draft list must not post directly');
console.log('PASS draft delete/conflict/accounting boundary contract');
