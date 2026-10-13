'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{test}=require('node:test');
const src=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('draft stores bundle product type and revision in immutable draft JSON',()=>{
 const d=src('DraftSales.gs');
 assert.match(d,/bundleRevision:/);
 assert.match(d,/productType:/);
});
test('POS draft restoration and duplication carry recipe revision',()=>{
 const p=src('pos.html');
 assert.match(p,/bundleRevision: line\.bundleRevision/);
 assert.match(p,/bundleRevision: item\.bundleRevision/);
 assert.match(p,/bundleRevision: product\.bundleRevision/);
});
