'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{test}=require('node:test');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
test('purchasing a virtual bundle is not a stock transaction',()=>{
 assert.match(read('Purchase.gs'),/bundleProductType_\(product\).*Bundle/s);
 assert.match(read('PurchaseManagement.gs'),/bundleProductType_\(product\).*Bundle/s);
});
test('deleting sold bundle unwinds component stock evidence, not phantom parent stock',()=>{
 const d=read('DeleteEngine.gs');
 assert.match(d,/i\['Sold Product Type'\] !== 'Bundle'/);
 assert.match(d,/productsById\[productId\]\['Product Name'\]/);
});
test('used bundle component cannot be deleted without breaking historic return',()=>{
 assert.match(read('DeleteEngine.gs'),/SALE_BUNDLE_COMPONENTS/);
 assert.match(read('DeleteEngine.gs'),/BUNDLE_COMPONENTS/);
});
