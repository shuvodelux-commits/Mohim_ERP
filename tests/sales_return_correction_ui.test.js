'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=f=>fs.readFileSync(path.resolve(__dirname,'..',f),'utf8');
test('Return History offers native edit and delete without a new correction modal',()=>{
 const html=read('returnHistory.html');
 assert.match(html,/function rhOpenEditById_\(returnId\)/);
 assert.match(html,/function rhDeleteById_\(returnId\)/);
 assert.match(html,/action: 'edit', label: 'Edit'/);
 assert.match(html,/action: 'delete', label: 'Delete'/);
 assert.match(html,/serverCall\('getReturnForEdit'/);
 assert.match(html,/serverCall\('deleteSalesReturn'/);
});
test('existing Return workspace posts native update with original ID and version',()=>{
 const html=read('returns.html');
 assert.match(html,/id="rtEditReason"/);
 assert.match(html,/editVersion:/);
 assert.match(html,/serverCall\('updateSalesReturn'/);
 assert.match(html,/rtState\.editingReturnId/);
 assert.match(html,/expectedVersion: rtState\.editVersion/);
 assert.match(html,/returnId: rtState\.editingReturnId/);
});
test('Day Book edits/open original Sales Return via owning module only',()=>{
 const html=read('daybook.html'), source=read('DayBook.gs'),del=read('DeleteEngine.gs');
 assert.match(html,/row\.module === 'Sales Return'/);
 assert.match(html,/rhOpenEditById_\(row\.sourceId\)/);
 assert.match(html,/rhOpenDetailById_\(row\.sourceId\)/);
 assert.match(source,/'Sales Return': 'sales return'/);
 assert.match(del,/case 'sales return':\s*return deleteSalesReturn\(/);
});
test('split-payment refund replay after an edit fails closed instead of reporting stale creation',()=>{
 const src=read('SalesReturn.gs');
 assert.match(src,/Committed refund has since been corrected|Original refund has been corrected/);
});

test('edit shows other returned quantity based on original saved return, not edited input',()=>{
 const src=read('returns.html');
 assert.match(src,/previouslyReturnedQty\s*\|\|\s*0\)\s*-\s*Number\(rtState\.editQtyByProduct/);
});
test('Day Book return deletion uses refreshed Return History and expected version',()=>{
 const src=read('daybook.html');
 assert.match(src,/if \(row\.module === 'Sales Return'\)\s*\{\s*goToPage\('returnHistory'\);/);
 assert.match(src,/rhLoad\(\)\.then\(function\(\)\{\s*rhDeleteById_\(row\.sourceId\)/);
});
