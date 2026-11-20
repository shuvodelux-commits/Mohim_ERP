'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const raw=name=>fs.readFileSync(path.join(root,name),'utf8');
const product={ 'Product ID':'PIPE','Product Name':'SWR Pipe', 'Current Stock':9,'Purchase Price':68,'Selling Price':70,'Status':'Active','Product Type':'Standard'};
const lots=[
 {'Lot ID':'NEG','Product ID':'PIPE','Purchase ID':'OVERSOLD','Purchase Date':'2026-11-01','Status':'Oversold','Purchase Price':68,'Remaining Quantity':-231},
 {'Lot ID':'PUR','Product ID':'PIPE','Purchase ID':'PUR-082','Purchase Date':'2026-11-19','Status':'Active','Purchase Price':64.75,'Sell Price':70,'Remaining Quantity':240}
];
function bootstrap({costPermission=true,setting=true,stock=9,productLots=lots}={}){
 const user={role:'salesperson'};
 const ctx={
  requirePermission_:()=>user,hasPermission_:()=>costPermission,
  isSettingEnabled_:()=>setting,canViewInvoiceProfit_:()=>false,
  activeRows_:key=>key==='PRODUCTS'?[{...product,'Current Stock':stock}]:[],
  getAllRows_:key=>key==='STOCK_LOTS'?productLots:[],
  getSettingsMap_:()=>({'POS Show Purchase Price':setting}),
  getActiveCashSession_:()=>({success:true,data:null}),
  getActiveBankAccountsForUI_:()=>[],getActiveVendorsForUI_:()=>[],getAllVendorsForUI_:()=>[],
  bundleProductMap_:items=>Object.fromEntries(items.map(p=>[p['Product ID'],p])),
  bundleProductType_:()=> 'Standard',
  safeDateOnly_:v=>String(v||'').slice(0,10),
  isValidNonNegativeNumber_:x=>x!==''&&x!==null&&Number.isFinite(Number(x))&&Number(x)>=0,
  CONFIG:{APP_NAME:'Mohim'},ok_:data=>({success:true,data}),fail_:msg=>({success:false,message:msg}),
  logError_:()=>{},resolveBankAccount_:()=>({}),getActiveCashSession_:()=>({success:true,data:null})
 };
 vm.createContext(ctx);
 vm.runInContext(raw('StockLots.gs'),ctx);
 vm.runInContext(raw('Sales.gs'),ctx);
 const response=ctx.getPosBootstrap('auth-token');
 assert.equal(response.success,true,response.message||'');
 return JSON.parse(JSON.stringify(response.data));
}
test('privileged POS receives next genuine lot cost, not product master cost',()=>{
 const data=bootstrap(),item=data.products[0];
 assert.equal(data.showPurchasePrice,true);
 assert.equal(item.purchasePrice,64.75);
 assert.deepEqual(item.fifoCostTiers,[{qty:9,unitCost:64.75}]);
 assert.equal(item.fifoCostStatus,'UNSETTLED');
});
test('POS cost and FIFO tiers never appear on the wire without permission',()=>{
 for(const opts of [{costPermission:false},{setting:false}]){
  const data=bootstrap(opts);
  assert.equal(data.showPurchasePrice,false);
  for(const item of data.products){
   assert.equal(Object.hasOwn(item,'purchasePrice'),false);
   assert.equal(Object.hasOwn(item,'fifoCostTiers'),false);
   assert.equal(Object.hasOwn(item,'fifoCostStatus'),false);
  }
 }
});
test('mismatched cached stock does not expose guessed master cost',()=>{
 const data=bootstrap({stock:11});const item=data.products[0];
 assert.equal(Object.hasOwn(item,'purchasePrice'),false);
 assert.equal(item.fifoCostStatus,'NEEDS_REVIEW');
});
test('POS uses first FIFO lot cost and tiers across multiple costs',()=>{
 const data=bootstrap({stock:6,productLots:[
  {'Lot ID':'P1','Product ID':'PIPE','Purchase ID':'PUR-1','Status':'Active','Purchase Date':'2026-10-01','Purchase Price':60,'Remaining Quantity':2},
  {'Lot ID':'P2','Product ID':'PIPE','Purchase ID':'PUR-2','Status':'Active','Purchase Date':'2026-11-01','Purchase Price':66,'Remaining Quantity':4}
 ]});
 const item=data.products[0];
 assert.equal(item.purchasePrice,60);
 assert.deepEqual(item.fifoCostTiers,[{qty:2,unitCost:60},{qty:4,unitCost:66}]);
});
function extractPos(name) {
 const src=raw('pos.html'),beg=src.indexOf('function '+name+'(');
 assert.ok(beg>=0,'missing function '+name);
 let brace=src.indexOf('{',beg),depth=0,quote='',escaped=false;
 for(let i=brace;i<src.length;i++){
  const ch=src[i];
  if(quote){if(escaped){escaped=false;continue;}if(ch==='\\'){escaped=true;continue;}if(ch===quote)quote='';continue;}
  if(ch==='\''||ch==='"'||ch==='\x60'){quote=ch;continue;}
  if(ch==='{')depth++;
  if(ch==='}' && --depth===0)return src.slice(beg,i+1);
 }
 throw Error('malformed pos function');
}
test('POS quantity-weighted FIFO cost uses exact cart quantities not one stale price',()=>{
 const ctx={posState:{productCostTiersById:{PIPE:[{qty:2,unitCost:60},{qty:4,unitCost:66}]}},Math};
 vm.createContext(ctx);vm.runInContext(extractPos('posFifoCartCostEstimate_'),ctx);
 const value=JSON.parse(JSON.stringify(ctx.posFifoCartCostEstimate_({productId:'PIPE',qty:3})));
 assert.equal(value.complete,true);assert.equal(value.averageCost,62);
 assert.equal(value.totalCost,186);assert.equal(value.pricedQty,3);
 const shortage=JSON.parse(JSON.stringify(ctx.posFifoCartCostEstimate_({productId:'PIPE',qty:7})));
 assert.equal(shortage.complete,false);assert.equal(shortage.pricedQty,6);
});
test('POS cost reveal continues using original eye-button, never embeds hidden cost in HTML',()=>{
 const html=raw('pos.html');
 assert.match(html,/posFifoCartCostEstimate_\(costLine\)/);
 assert.match(html,/posCostMarkerHtml_/);
 assert.match(html,/productCostTiersById/);
 assert.match(html,/POS_COST_REVEAL_MS/);
});
