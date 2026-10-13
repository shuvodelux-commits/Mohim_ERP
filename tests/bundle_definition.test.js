'use strict';
const assert = require('node:assert/strict');
const {test} = require('node:test');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const src = () => fs.readFileSync(path.join(__dirname,'..','Bundles.gs'),'utf8');
const ctx = vm.createContext({console});
const products = {
 pipe:{'Product ID':'pipe','Product Type':'Standard','Status':'Active','Current Stock':100,'Unit':'pcs'},
 elbow:{'Product ID':'elbow','Product Type':'Standard','Status':'Active','Current Stock':100,'Unit':'pcs'},
 motor:{'Product ID':'motor','Product Type':'Standard','Status':'Active','Current Stock':3,'Unit':'pcs'},
 kit:{'Product ID':'kit','Product Type':'Bundle','Bundle Revision':2,'Status':'Active'}
};
const recipe = [
 {'Bundle Product ID':'kit','Component Product ID':'pipe','Quantity Per Set':5,'Unit':'pcs','Revision':2,'Status':'Active'},
 {'Bundle Product ID':'kit','Component Product ID':'elbow','Quantity Per Set':10,'Unit':'pcs','Revision':2,'Status':'Active'},
 {'Bundle Product ID':'kit','Component Product ID':'motor','Quantity Per Set':1,'Unit':'pcs','Revision':2,'Status':'Active'}
];
test('bundle helper accepts active unique standard products and rejects invalid components', () => {
 vm.runInContext(src(),ctx);
 assert.equal(ctx.validateBundleDefinition_('kit',[{productId:'pipe',qtyPerSet:5}],products).length,1);
 assert.throws(()=>ctx.validateBundleDefinition_('kit',[],products),/at least one/);
 assert.throws(()=>ctx.validateBundleDefinition_('kit',[{productId:'pipe',qtyPerSet:1},{productId:'pipe',qtyPerSet:2}],products),/more than once/);
 assert.throws(()=>ctx.validateBundleDefinition_('kit',[{productId:'kit',qtyPerSet:1}],products),/standard product/);
 assert.throws(()=>ctx.validateBundleDefinition_('kit',[{productId:'pipe',qtyPerSet:0}],products),/greater than zero/);
});
test('virtual availability and negative stock differ from sale eligibility', () => {
 const d=ctx.getBundleDefinitions_(['kit'],products,recipe).kit;
 assert.equal(d.revision,2);
 assert.equal(ctx.getBundleAvailability_(d,products),3);
 products.motor['Current Stock']=-2;
 assert.equal(ctx.getBundleAvailability_(d,products),0);
 products.motor['Current Stock']=3;
});
test('two sets consume exactly 10 pipe, 20 elbow, 2 motor and share standalone pipe requirements', () => {
 const definitions=ctx.getBundleDefinitions_(['kit'],products,recipe);
 const demand=ctx.buildSaleStockDemands_([{productId:'kit',productType:'Bundle',qty:2},{productId:'pipe',productType:'Standard',qty:3}],definitions,{});
 assert.equal(demand.requirementsByProductId.pipe,13);
 assert.equal(demand.requirementsByProductId.elbow,20);
 assert.equal(demand.requirementsByProductId.motor,2);
 assert.deepEqual(Array.from(demand.ownersByProductId.pipe,x=>[x.sourceSaleProductId,x.qty]),[['kit',10],['pipe',3]]);
});
test('sale helper forbids fractional numbers of sets', () => {
 const d=ctx.getBundleDefinitions_(['kit'],products,recipe);
 assert.throws(()=>ctx.buildSaleStockDemands_([{productId:'kit',productType:'Bundle',qty:1.5}],d,{}),/whole sets/);
});
