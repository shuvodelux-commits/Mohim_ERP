'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..');
const read=n=>fs.readFileSync(path.join(root,n),'utf8');
const cfg=read('Config.gs');
const draft=()=>read('DraftSales.gs');

assert.match(cfg,/SALES_DRAFTS:\s*["']Draft Invoices["']/);
assert.match(cfg,/SALES_DRAFT_AUDIT:\s*["']Draft Invoice Audit["']/);
assert.match(cfg,/SALES_DRAFTS:\s*\[[\s\S]*["']Draft ID["'][\s\S]*["']Items JSON["'][\s\S]*["']Payment JSON["'][\s\S]*["']Version["']/);
assert.match(cfg,/SALES_DRAFT_AUDIT:\s*\[[\s\S]*["']Action["'][\s\S]*["']Source Owner ID["'][\s\S]*["']Invoice ID["']/);
assert.match(cfg,/SALES:\s*\[[\s\S]*["']Source Draft ID["']/);
assert.match(cfg,/ID_PREFIX:\s*\{[\s\S]*SALES_DRAFTS:\s*["']DRF["'][\s\S]*SALES_DRAFT_AUDIT:\s*["']DRA["']/);

const src=draft();
for(const name of ['saveSalesDraft','getSalesDraftList','getSalesDraft','updateSalesDraft','deleteSalesDraft']) {
  assert.match(src,new RegExp('function\\s+'+name+'\\s*\\('));
}
for(const forbidden of ['completeSale(', 'applyStockConsumption_(', 'addCashBookEntry_(', 'addBankBookEntry_(', 'postVendorLedgerEntry_(', 'requireActiveCashSession_(']) {
  assert.strictEqual(src.includes(forbidden),false,'draft module must not call '+forbidden);
}
assert.match(src,/SALES_DRAFT_JSON_LIMIT_\s*=\s*45000/);
assert.match(src,/This draft was changed by another user\. Reload the latest version\./);
assert.match(src,/hasPermission_\(user,\s*['"]sales['"],\s*['"]edit['"]\)/);
assert.match(src,/Created By ID/);
console.log('PASS draft sales server/schema contract');
