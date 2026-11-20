'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','purchase.html'),'utf8');
function extract(name) {
 const start=source.indexOf('function '+name+'(');
 if(start===-1)throw Error('Missing '+name);
 const brace=source.indexOf('{',start);let depth=0,index=brace;
 for(;index<source.length;index++){
   if(source[index]==='{')depth++;
   if(source[index]==='}'&&--depth===0)break;
 }
 return source.slice(start,index+1);
}
test('purchase form holds one stable per-attempt operation ID through an uncertain retry',()=>{
 const state={pendingPurchaseOperationId:''},ctx={purState:state,Date,
  window:{crypto:{getRandomValues:bytes=>{for(let i=0;i<bytes.length;i++)bytes[i]=i+1;return bytes;}}}};
 vm.createContext(ctx);vm.runInContext(extract('purPurchaseOperationId_'),ctx);
 const a=ctx.purPurchaseOperationId_(),b=ctx.purPurchaseOperationId_();
 assert.equal(a,b);assert.match(a,/^[A-Za-z0-9_-]{12,100}$/);
 assert.equal(state.pendingPurchaseOperationId,a);
 state.pendingPurchaseOperationId='';
 assert.equal(ctx.purPurchaseOperationId_().length>11,true);
});
test('create purchase payload sends stable op identity but purchase edit preserves existing route',()=>{
 assert.match(source,/if\s*\(!isUpdate\)\s*payload\.operationId\s*=\s*purPurchaseOperationId_\(\)/);
 assert.match(source,/serverCall\('updatePurchase',\s*authToken,\s*targetPurchaseId,\s*payload\)/);
 assert.match(source,/serverCall\('createPurchase',\s*authToken,\s*payload\)/);
});
test('confirmed purchase clears pending operation ID; rejected or uncertain save retains it',()=>{
 const mark=source.indexOf('function finishPurchaseSave_(');
 assert.ok(mark>0);
 assert.match(source.slice(mark,mark+480),/pendingPurchaseOperationId\s*=\s*''/);
 assert.doesNotMatch(source.slice(source.indexOf('.catch(function (err)'),source.indexOf('.catch(function (err)')+200),
   /pendingPurchaseOperationId\s*=\s*''/);
});
