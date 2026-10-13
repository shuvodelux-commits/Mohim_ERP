'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'..','Products.gs'),'utf8');
function makeService(products, components) {
  let writes=0,locked=0;
  const db={PRODUCTS:products,BUNDLE_COMPONENTS:components};
  const context={
    requirePermission_:()=>({}),LockService:{getScriptLock:()=>({waitLock:()=>{locked++},releaseLock:()=>{locked--}})},
    CONFIG:{LOCK_TIMEOUT_MS:20000},
    findRowIndex_:(k,col,id)=>(db[k]||[]).find(x=>x[col]===id)?2:-1,
    getAllRows_:k=>db[k]||[],
    updateRowFields_:(k,idx,fields)=>{Object.assign(db[k][0],fields);writes++;},
    bundleProductType_:p=>p&&p['Product Type']==='Bundle'?'Bundle':'Standard',
    ok_:data=>({success:true,data}), fail_:message=>({success:false,message}),
    logError_:()=>{}
  };
  const api=Function(...Object.keys(context),code+'; return {setProductStatus};')(...Object.values(context));
  return {call:(id,status)=>api.setProductStatus('test',id,status),writes:()=>writes,locked:()=>locked};
}
test('cannot deactivate a component while an active bundle uses it',()=>{
  const service=makeService([
    {'Product ID':'PIPE','Product Type':'Standard',Status:'Active',_rowIndex:2},
    {'Product ID':'SET','Product Type':'Bundle',Status:'Active','Bundle Revision':1,_rowIndex:3}
  ],[{'Bundle Product ID':'SET','Component Product ID':'PIPE',Revision:1,Status:'Active'}]);
  const result=service.call('PIPE','Inactive');
  assert.equal(result.success,false);
  assert.match(result.message,/bundle/i);
  assert.equal(service.writes(),0);
  assert.equal(service.locked(),0);
});
