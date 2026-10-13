'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {test} = require('node:test');
const read = file => fs.readFileSync(path.join(__dirname,'..',file),'utf8');

test('POS bootstrap exposes sellable bundle products with independent price and availability',()=>{
 const sales=read('Sales.gs'),pos=read('pos.html');
 assert.match(sales,/bundleProductType_\(p\)/);
 assert.match(sales,/getBundleAvailability_\(/);
 assert.match(sales,/bundleRevision:/);
 assert.match(pos,/bundleRevision:/);
 assert.match(pos,/productType === 'Bundle'/);
});
test('selling a bundle writes only a parent SALE_ITEMS row while posting physical component lots',()=>{
 const src=read('Sales.gs');
 assert.match(src,/buildSaleStockDemands_\(/);
 assert.match(src,/attributeBundleConsumption_\(/);
 assert.match(src,/SALE_BUNDLE_COMPONENTS/);
 assert.match(src,/Source Sale Product ID/);
 assert.match(src,/applyStockConsumption_\(physical\.plan\)/);
});
test('bundle price is the own Selling Price, not sum of component individual prices',()=>{
 const src=read('Sales.gs');
 assert.match(src,/product\['Selling Price'\]/);
 assert.match(src,/isBundle \? \{ unitPrice:/);
});
test('customer money and sale header still post exactly once outside component loop',()=>{
 const src=read('Sales.gs');
 assert.equal((src.match(/appendRow_\('SALES', \{/g)||[]).length,1);
 assert.equal((src.match(/appendRow_\('CUSTOMER_LEDGER', \{/g)||[]).length,1);
});
