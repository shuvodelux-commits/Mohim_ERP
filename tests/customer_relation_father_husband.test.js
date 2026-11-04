'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=n=>fs.readFileSync(path.resolve(__dirname,'..',n),'utf8');
const p=read('pos.html'),c=read('customers.html'),mod=read('Customer.gs'),cfg=read('Config.gs'),draft=read('DraftSales.gs'),sale=read('Sales.gs'),upd=read('SalesManagement.gs'),inv=read('Invoice.gs'),print=read('javascript.html'),style=read('posv2.html');
test('POS relationship dropdown switches dynamic label and stays inline with current name input',()=>{
 assert.match(p,/id="posCustomerRelationType"/);
 assert.match(p,/id="posCustomerRelationNameLabel"/);
 assert.match(p,/value="Husband"/);
 assert.match(p,/function posSetCustomerRelationType_\(/);
 assert.match(p,/posCustomerRelationType'\)\.addEventListener\('change'/);
 assert.match(style,/\.pos-customer-relation-entry/);
});
test('Add/Edit customer dropdown restores relationship and posts the selected type',()=>{
 assert.match(c,/id="custRelationType"/);
 assert.match(c,/id="custRelationNameLabel"/);
 assert.match(c,/function custSetRelationType_\(/);
 assert.match(c,/custSetRelationType_\('Father'\)/);
 assert.match(c,/custSetRelationType_\(customer\['Relation Type'\]/);
 assert.match(c,/relationType:\s*document\.getElementById\('custRelationType'\)\.value/);
});
test('server stores relation type alongside the legacy Father Name column',()=>{
 assert.match(cfg,/CUSTOMERS:[\s\S]*?"Father Name"[\s\S]*?"Relation Type"/);
 assert.match(mod,/"Relation Type":\s*normalizeCustomerRelationType_\(payload\.relationType\)/);
 assert.match(sale,/relationType:\s*normalizeCustomerRelationType_\(c\['Relation Type'\]\)/);
 assert.match(mod,/function normalizeCustomerRelationType_\(/);
 const fn=mod.match(/function normalizeCustomerRelationType_\(value\)\s*\{[\s\S]*?\n\}/);
 assert.ok(fn);
 const cx=vm.createContext({});
 vm.runInContext(fn[0],cx);
 assert.equal(cx.normalizeCustomerRelationType_('Husband'),'Husband');
 assert.equal(cx.normalizeCustomerRelationType_('Father'),'Father');
 assert.equal(cx.normalizeCustomerRelationType_(''),'Father');
 assert.equal(cx.normalizeCustomerRelationType_('anything'),'Father');
});
test('POS selects and restores type in customer pick, clearing, draft, and invoice edits',()=>{
 assert.match(p,/posSetCustomerRelationType_\(match\.relationType\)/);
 assert.match(p,/posSetCustomerRelationType_\('Father'\)/);
 assert.match(p,/customerRelationType:\s*document\.getElementById\('posCustomerRelationType'\)\.value/);
 assert.match(p,/posSetCustomerRelationType_\(draft\.customerRelationType\)/);
 assert.match(p,/posSetCustomerRelationType_\(source\.customerRelationType/);
 assert.match(p,/posSetCustomerRelationType_\(inv\.customerRelationType/);
});
test('draft snapshots carry relation through create, update, parse, and preview',()=>{
 assert.match(cfg,/SALES_DRAFTS:[\s\S]*?"Customer Father Name"[\s\S]*?"Customer Relation Type"/);
 assert.match(draft,/customerRelationType:\s*normalizeCustomerRelationType_\(payload\.customerRelationType\)/);
 assert.match(draft,/'Customer Relation Type':\s*clean\.customerRelationType/g);
 assert.match(draft,/customerRelationType:\s*normalizeCustomerRelationType_\(row\['Customer Relation Type'\]\)/g);
});
test('sale snapshot stores relation name/type even for cash sale and updates',()=>{
 assert.match(cfg,/SALES:[\s\S]*?"Customer Relation Name"[\s\S]*?"Customer Relation Type"/);
 assert.match(sale,/'Customer Relation Name':\s*customerFatherName/);
 assert.match(sale,/'Customer Relation Type':\s*customerRelationType/);
 assert.match(upd,/'Customer Relation Name':\s*Object\.prototype\.hasOwnProperty\.call\(payload, 'customerFatherName'\)/);
 assert.match(upd,/'Customer Relation Type':\s*Object\.prototype\.hasOwnProperty\.call\(payload, 'customerRelationType'\)/);
});
test('legacy update clients do not overwrite saved relation types or sale snapshots',()=>{
 assert.match(mod,/Object\.prototype\.hasOwnProperty\.call\(payload, 'relationType'\)/);
 assert.match(upd,/Object\.prototype\.hasOwnProperty\.call\(payload, 'customerRelationType'\)/);
 assert.match(upd,/Object\.prototype\.hasOwnProperty\.call\(payload, 'customerFatherName'\)/);
 assert.match(draft,/Object\.prototype\.hasOwnProperty\.call\(payload, 'customerRelationType'\)/);
});
test('reprint and receipt use relation-specific label and legacy fallback',()=>{
 assert.match(inv,/customerFatherName:\s*customerFatherName/);
 assert.match(inv,/customerRelationType:\s*customerRelationType/);
 assert.match(inv,/sale\['Customer Relation Name'\]/);
 assert.match(print,/inv\.customerRelationType === 'Husband' \? 'স্বামী' : 'পিতা'/g);
});
