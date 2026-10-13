'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','SalesManagement.gs'),'utf8');
test('bundle sale update is blocked before inventory mutation until historical-delta editing is implemented',()=>{
 assert.match(src,/Bundle invoice editing is not available/);
 assert.match(src,/Cannot add a bundle while updating an existing invoice/);
 const guard=src.indexOf('Bundle invoice editing is not available');
 const write=src.indexOf("deleteRow_('SALE_ITEMS'");
 assert.ok(guard>=0 && guard<write,'guard must occur before invoice writes');
});
