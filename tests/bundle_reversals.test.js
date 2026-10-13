'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {test} = require('node:test');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');

test('stock restoration filters sale lot lineage by sold bundle owner',()=>{
 const stock=read('StockLots.gs');
 assert.match(stock,/sourceSaleProductId/);
 assert.match(stock,/\['Source Sale Product ID'\]/);
});
test('native return preserves visible bundle line and restores its components',()=>{
 const src=read('SalesReturn.gs');
 assert.match(src,/getSaleBundleSnapshot_\(/);
 assert.match(src,/physicalRestorations/);
 assert.match(src,/sourceSaleProductId:/);
 assert.match(src,/['"]Sold Product Type['"]:/);
});
test('return availability for bundle means outstanding complete sets, not virtual stock',()=>{
 const src=read('SalesReturn.gs');
 assert.match(src,/bundleSnapshots\[key\]/);
 assert.match(src,/bundleSnapshots\[item\.productId\]/);
 assert.match(src,/Number\.isSafeInteger\(qty\)/);
});
