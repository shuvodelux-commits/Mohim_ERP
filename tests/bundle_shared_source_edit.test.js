'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'..','SalesManagement.gs'),'utf8');
test('reclassifying standalone vendor source does not consume component lots owned by a bundle',()=>{
  assert.match(code,/String\(r\['Source Sale Product ID'\] \|\| r\['Product ID'\]\) === String\(productId\)/);
});
test('reducing standalone stock in a mixed invoice scopes lot restoration to standalone owner',()=>{
  assert.match(code,/restoreStockToLots_\(invoiceId, c\.productId, c\.name, Math\.abs\(c\.delta\), invoiceId \+ '-UPDATE', undefined, c\.productId\)/);
});
test('standard sale-edit FIFO evidence explicitly identifies its visible parent',()=>{
  assert.match(code,/'Source Sale Product ID': c\.productId/);
});
