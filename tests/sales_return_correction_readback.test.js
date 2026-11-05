'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = name => fs.readFileSync(path.join(root, name), 'utf8');
function fixture() {
  const tables = {
    SALES_RETURN: [
      {'Return ID':'R1','Invoice ID':'INV1','Date':'2026-11-02','Customer ID':'C1','Total Return Amount':100,'Refund Method':'Cash','Created At':'2026-11-02T10:00:00'},
      {'Return ID':'R2','Invoice ID':'INV2','Date':'2026-11-02','Is Deleted':'TRUE','Created At':'2026-11-02T11:00:00'}
    ],
    SALES_RETURN_ITEMS: [
      {'Return ID':'R1','Invoice ID':'INV1','Product ID':'P1','Return Quantity':1,'Return Price':100},
      {'Return ID':'R1','Invoice ID':'INV1','Product ID':'P1','Return Quantity':2,'Is Deleted':'TRUE'},
      {'Return ID':'R2','Invoice ID':'INV2','Product ID':'P1','Return Quantity':3}
    ]
  };
  let rights = [];
  const ctx = vm.createContext({console,Date,Math,JSON});
  vm.runInContext(source('Utils.gs'),ctx);
  vm.runInContext(source('SalesReturn.gs'),ctx);
  Object.assign(ctx, {
    getAllRows_: key => (tables[key] || []).map((r,i)=>({...r,_rowIndex:i+2})),
    activeRows_: key => ctx.getAllRows_(key).filter(r=>!ctx.isDeleted_(r)),
    isDeleted_: r => String(r && r['Is Deleted'] || '').toUpperCase()==='TRUE',
    requirePermission_: (_token,key,verb)=>{rights.push(key+':'+verb);return {'Full Name':'Tester'};},
    sanitizeInput_: v=>String(v==null?'':v).trim(),
    ok_: data=>({success:true,data}),
    fail_: message=>({success:false,message}),
    logError_: ()=>{},
    safeDateOnly_: x=>x,
    getInvoiceForReturn: ()=>({success:true,data:{invoiceId:'INV1',items:[{productId:'P1',name:'Widget',availableQty:4,unitPrice:100}]}})
  });
  return {ctx,rights,tables};
}
test('return history excludes soft deleted return headers',()=>{
  const w=fixture();const out=w.ctx.getReturnHistory('t');
  assert.equal(out.success,true);assert.deepEqual(out.data.map(r=>r['Return ID']),['R1']);
});
test('return detail rejects soft deleted source and deleted children',()=>{
  const w=fixture();
  assert.equal(w.ctx.getReturnDetail('t','R2').success,false);
  const detail=w.ctx.getReturnDetail('t','R1');
  assert.equal(detail.success,true);assert.equal(detail.data.items.length,1);
});
test('native return edit readback requires edit permission and exposes source and version',()=>{
  const w=fixture();
  assert.equal(typeof w.ctx.getReturnForEdit,'function');
  const out=w.ctx.getReturnForEdit('t','R1');
  assert.equal(out.success,true);
  assert.equal(out.data.header['Return ID'],'R1');
  assert.equal(out.data.items.length,1);
  assert.equal(out.data.version,0);
  assert.equal(out.data.invoice.invoiceId,'INV1');
  assert.ok(w.rights.includes('returns:edit'));
});
test('duplicate return identifiers cannot be opened for mutation',()=>{
  const w=fixture();w.tables.SALES_RETURN.push({...w.tables.SALES_RETURN[0]});
  const out=w.ctx.getReturnForEdit('t','R1');
  assert.equal(out.success,false);assert.match(out.message,/duplicate/i);
});
test('active return children ignore soft-deleted lines and deleted parents',()=>{
  const w=fixture();const children=w.ctx.activeSalesReturnItems_();
  assert.equal(children.length,1);
  assert.equal(children[0]['Return ID'],'R1');
});
test('return schema declares safe correction metadata without dropping legacy rows',()=>{
  const config=source('Config.gs');
  const head=config.split('SALES_RETURN: [')[1].split('SALES_RETURN_ITEMS: [')[0];
  for(const x of ['Edit Version','Updated By','Updated At','Edit Reason'])assert.ok(head.includes('"'+x+'"'),x);
  const children=config.split('SALES_RETURN_ITEMS: [')[1].split('PURCHASE_RETURN: [')[0];
  assert.ok(children.includes('"Is Deleted"'));
});
