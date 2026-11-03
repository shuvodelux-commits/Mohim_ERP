'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=n=>fs.readFileSync(path.join(__dirname,'..',n),'utf8');

function runtime() {
  let sale={'Invoice ID':'INV-1','Date':'2026-11-03','Payment Detail Version':1,'Paid Amount':100};
  const ctx=vm.createContext({
    CONFIG:{LOCK_TIMEOUT_MS:1000},
    requirePermission_:()=>({id:'U1'}),
    requireDeletePermission_:()=>({id:'U1'}),
    requireActiveCashSession_:()=>{},
    findUniqueSalesRow_:()=>sale,
    findRows_:()=>[],
    getAllRows_:()=>[],
    isDeleted_:()=>false,
    sanitizeInput_:v=>String(v||'').trim(),
    fail_:m=>({success:false,message:String(m)}),
    ok_:d=>({success:true,data:d}),
    logError_:()=>{},
    LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
    activeSalesReturnItems_:()=>{throw new Error('LEGACY_EDIT_PATH_REACHED');},
    activeRows_:()=>{throw new Error('LEGACY_DELETE_PATH_REACHED');},
    safeDateOnly_:()=>{throw new Error('LEGACY_RETURN_PATH_REACHED');}
  });
  for(const src of ['SalePayments.gs','SalesManagement.gs','DeleteEngine.gs','SalesReturn.gs']) {
    vm.runInContext(read(src),ctx,{filename:src});
  }
  return {ctx,setSale:next=>{sale=next}};
}

test('new-format invoice readback fails closed on missing child allocations',()=>{
  const h=runtime();
  const res=h.ctx.getSaleForUpdate('token','INV-1');
  assert.equal(res.success,false);
  assert.match(res.message,/integrity|mismatch|missing|payment format/i);
  h.setSale({'Invoice ID':'INV-old',Date:'2026-11-03'});
  const legacy=h.ctx.getSaleForUpdate('token','INV-old');
  assert.match(legacy.message,/LEGACY_EDIT_PATH_REACHED/);
});

test('server updateSale refuses split-to-legacy request conversion',()=>{
  const h=runtime();
  const res=h.ctx.updateSale('token','INV-1',{reason:'Correction',items:[{productId:'P1'}]});
  assert.equal(res.success,false);
  assert.match(res.message,/integrity|mismatch|missing|payment format/i);
});

test('corrupted split-payment rows stop delete before stock work; returns remain guarded',()=>{
  const h=runtime();
  const del=h.ctx.deleteSalesInvoice('token','INV-1','');
  assert.equal(del.success,false);
  assert.match(del.message,/integrity|mismatch|missing/i);
  assert.throws(()=>h.ctx.prepareSalesReturn_(
    {invoiceId:'INV-1',items:[{productId:'P1',qty:1}],refundMethod:'Cash'},
    {sale:{'Invoice ID':'INV-1','Payment Detail Version':1},txDate:{dateStr:'2026-11-03'}}
  ),/multi.payment|split.payment|not yet enabled/i);
});
