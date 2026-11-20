'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const raw=name=>fs.readFileSync(path.join(root,name),'utf8');
const product=qty=>({'Product ID':'PIPE','Product Name':'SWR Pipe','Current Stock':qty,'Purchase Price':68,'Selling Price':70,'Product Type':'Standard','Status':'Active'});
const lot=(id,qty,cost,date,source='PUR-82',status='Active')=>({'Lot ID':id,'Product ID':'PIPE','Remaining Quantity':qty,'Purchase Price':cost,'Purchase Date':date,'Purchase ID':source,'Status':status});
const stock=(shortage=231)=>[
 lot('NEG',-shortage,68,'2026-11-01','OVERSOLD','Oversold'),lot('PUR',240,64.75,'2026-11-19')
];
function getBoot(qty,lots){
 const rows={'PRODUCTS':[product(qty)],'STOCK_LOTS':lots,'BUNDLE_COMPONENTS':[],'PRODUCT_CATEGORIES':[],'PRODUCT_UNITS':[]};
 const ctx={
  requirePermission_:()=>({id:'owner'}), activeRows_:key=>rows[key]||[],
  getAllRows_:key=>rows[key]||[], getSettingsMap_:()=>({'Currency Symbol':'৳'}),
  bundleProductMap_:arr=>Object.fromEntries(arr.map(p=>[p['Product ID'],p])),
  bundleProductType_:()=> 'Standard',getBundleAvailability_:()=>0,
  safeDateOnly_:v=>String(v||'').slice(0,10),
  isValidNonNegativeNumber_:x=>Number.isFinite(Number(x))&&Number(x)>=0,
  ok_:data=>({success:true,data}),fail_:msg=>({success:false,message:msg}),
  logError_:()=>{throw Error('unexpected logging');}
 };
 vm.createContext(ctx);
 vm.runInContext(raw('StockLots.gs'),ctx);
 vm.runInContext(raw('Products.gs'),ctx);
 const result=ctx.getProductsBootstrap('auth-token');
 assert.equal(result.success,true,result.message||'unknown');
 return JSON.parse(JSON.stringify(result.data.products[0]));
}
test('Products inventory preview carries real next FIFO cost, master remains a separate editable reference',()=>{
 const p=getBoot(9,stock());
 assert.equal(p['Purchase Price'],68);assert.equal(p['Next FIFO Cost'],64.75);
 assert.equal(p['Lot Cost Status'],'UNSETTLED');
 assert.equal(p['Stock Value'],null);
 assert.equal(p['Projected Stock Value'],582.75);
 assert.equal(p['Oversold Remaining Qty'],231);
});
test('Products refuses false stock value if cached 9 but visible lots add to 11',()=>{
 const p=getBoot(9,stock(229));
 assert.equal(p['Lot Cost Status'],'NEEDS_REVIEW');
 assert.equal(p['Stock Value'],null);assert.equal(p['Next FIFO Cost'],null);
 assert.equal(p['Lot Cost Issue'],'STOCK_MISMATCH');
});
test('Products delivers provisional lot-based value without changing its booked stock value',()=>{
 const p=getBoot(9,stock(229));
 assert.equal(p['Stock Value'],null);
 assert.equal(p['Next FIFO Cost'],null);
 assert.equal(p['Provisional FIFO Cost'],64.75);
 assert.equal(p['Provisional Stock Value'],712.25);
 assert.equal(p['Lot Quantity Difference'],2);
 assert.equal(p['Lot Cost Issue'],'STOCK_MISMATCH');
});
test('Products clean FIFO lot uses the actual cost for both column and stock value',()=>{
 const p=getBoot(2,[lot('PUR',2,64.75,'2026-11-19')]);
 assert.equal(p['Next FIFO Cost'],64.75);
 assert.equal(p['Lot Cost Status'],'OK');
 assert.equal(p['Stock Value'],129.5);
});
test('Products preserves legacy no-lot fallback value without claiming FIFO cost',()=>{
 const p=getBoot(3,[]);
 assert.equal(p['Stock Value'],204);
 assert.equal(p['Next FIFO Cost'],null);
 assert.equal(p['Lot Cost Status'],'NEEDS_REVIEW');
});
test('Products HTML renders FIFO Cost rather than stale Purchase Price, with explicit unresolved value message',()=>{
 const html=raw('products.html');
 assert.match(html,/>FIFO Cost/);
 assert.match(html,/p\['Next FIFO Cost'\]/);
 assert.match(html,/p\['Lot Cost Status'\]/);
 assert.match(html,/Check|Stock checks/);
 assert.match(html,/p\['Provisional FIFO Cost'\]/);
 assert.match(html,/p\['Provisional Stock Value'\]/);
 assert.doesNotMatch(html,/est\. · Reconcile/);
 assert.match(html,/purchasePrice:\s*'Next FIFO Cost'/);
});
