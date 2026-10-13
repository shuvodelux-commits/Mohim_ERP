'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('invalid bundle recipe never blocks ordinary POS product bootstrap',()=>{
 const src=read('Sales.gs');
 assert.match(src,/bundleUnavailableById/);
 assert.match(src,/products\.filter\(function \(p\) \{ return !bundleUnavailableById/);
});
test('product editor can recover malformed or inactive bundle definitions',()=>{
 const src=read('Products.gs'),bundle=read('Bundles.gs');
 assert.match(src,/bundleErrorById/);
 assert.match(src,/Bundle Error/);
 assert.match(bundle,/getStoredBundleDefinition_/);
});
