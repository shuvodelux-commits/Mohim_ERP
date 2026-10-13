'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','SalesManagement.gs'),'utf8');
test('sold bundle line is editable as one product under native invoice permissions',()=>{
 assert.doesNotMatch(src,/Bundle invoice editing is not available/);
 assert.match(src,/bundleRevision:.*revision/);
 assert.match(src,/['"]Sold Product Type['"]:.*Bundle/);
});
test('invoice edit uses historical component plans and updates saved snapshot totals',()=>{
 assert.match(src,/planBundleInvoiceEdit_\(/);
 assert.match(src,/applyBundleInvoiceEdit_\(/);
 assert.match(src,/SALE_BUNDLE_COMPONENTS/);
});
test('physical component lines never become editable customer invoice lines',()=>{
 assert.match(src,/getAllRows_\('SALE_ITEMS'\)\.filter/);
 const print=fs.readFileSync(path.join(__dirname,'..','Invoice.gs'),'utf8');
 assert.match(print,/items: items\.map\(function \(i\)/);
 assert.doesNotMatch(print,/SALE_ITEM_LOTS.*items:/);
});
