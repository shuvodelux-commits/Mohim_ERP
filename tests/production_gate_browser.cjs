'use strict';
// Node runner for the existing Python browser fixtures; no Apps Script writes.
const fs=require('fs'), vm=require('vm'), assert=require('assert');
const {createRequire}=require('module');
const pw=require(process.env.SHER_PLAYWRIGHT_MODULE || 'playwright');
const source=fs.readFileSync('tests/production_gate_e2e.py','utf8');
const nav=vm.runInNewContext(source.match(/\nnav=(\[[\s\S]*?\n\])/)[1]);
const bridge=source.match(/mock_js=f'''([\s\S]*?)'''/)[1]
  .replace('{json.dumps(nav)}',JSON.stringify(nav)).replace(/\{\{/g,'{').replace(/\}\}/g,'}');
const html=fs.readFileSync('index.html','utf8').replace('<body>','<body>'+bridge)
  .replace(/<\?!=\s*include\('([^']+)'\);\s*\?>/g,(_,name)=>fs.readFileSync(name+'.html','utf8'));
const pages=vm.runInNewContext(source.match(/PAGES = (\[[^\n]+\])/)[1]);
let pass=0,fail=0;
async function check(name,fn) {try {await fn();pass++;console.log('PASS',name);}catch(e){fail++;console.error('FAIL',name,e.stack);}}
async function boot(browser,viewport={width:1440,height:1000}) {
  const page=await browser.newPage({viewport}); const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.setContent(html,{waitUntil:'domcontentloaded'});
  await page.evaluate("onAuthenticated_({token:'test-token',user:{id:'USR-1',name:'Admin',mobile:'017',role:'Administrator'},allowedModules:null,permissions:null})");
  await page.waitForFunction(()=>document.getElementById('page-dashboard') && !document.getElementById('page-dashboard').hidden);
  return {page,errors};
}
async function route(page,key) {await page.evaluate(k=>goToPage(k),key);await page.locator('#page-'+key).waitFor({state:'visible'});}
async function main() {
 const browser=await pw.chromium.launch({headless:true,...(process.env.SHER_CHROMIUM?{executablePath:process.env.SHER_CHROMIUM}:{}),args:['--no-sandbox']});
 try {
  let {page,errors}=await boot(browser);
  for(const key of pages) await check('route '+key,async()=>{const before=errors.length;await route(page,key);await page.waitForTimeout(200);assert.equal(errors.length,before,errors.join('\n'));});
  await page.close();
  ({page,errors}=await boot(browser)); await route(page,'pos');
  await page.locator('#posProductGrid .product-tile').first().waitFor();
  await check('POS bootstrap',async()=>assert.equal(await page.locator('#posProductGrid .product-tile').count(),1));
  await page.locator('#posProductGrid .product-tile').first().click();
  await page.fill('#posCustomerName','মহিউদ্দিন');await page.fill('#posCustomerPhone','01712345678');
  await check('POS cart and cash-session gating',async()=>{assert.equal(await page.textContent('#posCartCount'),'1');assert.equal(await page.isDisabled('#posCompleteBtn'),false);});
  await page.click('#posCompleteBtn');
  await check('POS confirmation',async()=>{await page.locator('#confirmActionModal').waitFor({state:'visible'});assert.equal(await page.textContent('#confirmActionTitle'),'Complete Sale?');});
  await page.click('#confirmActionConfirm');await page.locator('#invoiceModal').waitFor({state:'visible'});
  await check('POS invoice uses exact returned identity/customer',async()=>{assert.match(await page.textContent('#invoicePaper'),/INV-000017/);assert.match(await page.textContent('#invoicePaper'),/মহিউদ্দিন/);});
  await check('POS posts exactly once',async()=>{const calls=await page.evaluate(()=>__rpcCalls.filter(c=>c.name==='completeSale'));assert.equal(calls.length,1);assert.equal(calls[0].args[1].items[0].productId,'PROD-000001');});
  await check('POS browser errors',()=>assert.deepEqual(errors,[]));await page.close();
  ({page,errors}=await boot(browser));await route(page,'pos');
  await page.fill('#posCustomerPhone','01712345678');await page.press('#posCustomerPhone','Escape');await page.click('#posHistoryBtn');
  await check('phone history blocks duplicate ID',async()=>{const button=page.locator('#posHistoryBody button[data-id="INV-000005"]');await button.waitFor();assert.equal(await button.isDisabled(),true);});
  await check('phone history permits unique ID',async()=>assert.equal(await page.locator('#posHistoryBody button[data-id="INV-000017"]').isDisabled(),false));
  await check('history browser errors',()=>assert.deepEqual(errors,[]));await page.close();
  ({page,errors}=await boot(browser));
  const salesOverride=source.match(/page.evaluate\("""(window\.__mockOverrides.getSalesManagementList=[\s\S]*?)"""\)/)[1];
  await page.evaluate(salesOverride);await route(page,'sales');
  await page.locator('#smTableBody button[data-id="INV-000005"]').first().waitFor();
  await check('sales marks both duplicate rows',async()=>assert.equal(await page.locator('#smTableBody .badge-danger',{hasText:'Duplicate ID'}).count(),2));
  await check('sales disables all duplicate actions',async()=>{for(const b of await page.locator('#smTableBody button[data-id="INV-000005"]').all())assert.equal(await b.isDisabled(),true);});
  await check('sales allows unique actions',async()=>assert.equal(await page.locator('#smTableBody button[data-id="INV-000017"]').isDisabled(),false));
  await check('sales browser errors',()=>assert.deepEqual(errors,[]));await page.close();
  ({page,errors}=await boot(browser));await route(page,'returns');await page.fill('#rtSearchInput','INV-000005');await page.click('#rtFindBtn');
  await check('return blocks duplicate invoice load',async()=>{const b=page.locator('#rtSearchResults button[data-id="INV-000005"]');await b.waitFor();assert.equal(await b.isDisabled(),true);assert.equal(await page.evaluate(()=>__rpcCalls.filter(c=>c.name==='getInvoiceForReturn').length),0);});
  await check('return browser errors',()=>assert.deepEqual(errors,[]));await page.close();
  ({page,errors}=await boot(browser));
  await page.evaluate(source.match(/page.evaluate\("""(window\.__mockOverrides.getInvoiceForReturn=[\s\S]*?)"""\)/)[1]);
  await route(page,'returns');await page.evaluate("returnsLoadInvoiceById_('INV-UNPAID')");
  await check('unpaid return uses store credit and blocks cash',async()=>{await page.waitForFunction(()=>document.getElementById('rtRefundMethod').value==='Store Credit');assert.equal(await page.locator('#rtRefundMethod option[value="Cash"]').isDisabled(),true);assert.match(await page.textContent('#rtRefundHint'),/No cash was collected/);});
  await check('unpaid return browser errors',()=>assert.deepEqual(errors,[]));await page.close();
  ({page,errors}=await boot(browser));await route(page,'pos');await page.locator('#posProductGrid .product-tile').first().click();
  await page.fill('#posCustomerName','মহিউদ্দিন');await page.fill('#posCustomerPhone','01712345678');await page.click('#posSaveDraftBtn');
  await check('draft save preserves totals without posting sale',async()=>{await page.waitForFunction(()=>__rpcCalls.some(c=>c.name==='saveSalesDraft'));const calls=await page.evaluate(()=>__rpcCalls);const draft=calls.filter(c=>c.name==='saveSalesDraft');assert.equal(draft.length,1);assert.equal(draft[0].args[1].grandTotal,50);assert.equal(draft[0].args[1].items[0].lineTotal,50);assert.equal(calls.filter(c=>c.name==='completeSale').length,0);});
  await check('draft browser errors',()=>assert.deepEqual(errors,[]));await page.close();
  ({page,errors}=await boot(browser,{width:768,height:1024}));await route(page,'pos');
  await check('tablet POS adaptive layout',async()=>{const n=await page.$eval('#page-pos .pos-layout',e=>getComputedStyle(e).gridTemplateColumns.split(/\s+/).filter(Boolean).length);assert.ok(n>=1&&n<=2);});
  await check('tablet no document overflow',async()=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)<=1));
  await check('tablet sidebar rail',async()=>assert.ok(await page.$eval('#app',e=>e.classList.contains('sidebar-collapsed'))));
  await check('tablet browser errors',()=>assert.deepEqual(errors,[]));await page.close();
 } finally {await browser.close();}
 console.log(`production_gate_browser: ${pass}/${pass+fail} PASS; ${pages.length} routes; MOCKED Apps Script bridge`);
 if(fail)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
