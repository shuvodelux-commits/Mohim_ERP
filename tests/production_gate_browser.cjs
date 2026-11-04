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
async function route(page,key) {await page.evaluate(k=>goToPage(k),key);const runtimeKey=key==='posv2'?'pos':key;await page.locator('#page-'+runtimeKey).waitFor({state:'visible'});}
async function main() {
 let salesTableVisualMetrics;
 const browser=await pw.chromium.launch({headless:true,...(process.env.SHER_CHROMIUM?{executablePath:process.env.SHER_CHROMIUM}:{}),args:['--no-sandbox']});
 try {
  let {page,errors}=await boot(browser);
  for(const key of pages) await check('route '+key,async()=>{const before=errors.length;await route(page,key);await page.waitForTimeout(200);assert.equal(errors.length,before,errors.join('\n'));});
  await page.close();
  ({page,errors}=await boot(browser)); await route(page,'posv2');
  await page.fill('#posSearch','4 inch Test Pipe');
  await page.press('#posSearch','Enter');
  await check('POS V2 search adds product',async()=>assert.equal(await page.textContent('#posCartCount'),'1'));
  await page.fill('#posCustomerName','মহিউদ্দিন');await page.fill('#posCustomerPhone','01712345678');
  await check('POS cart and cash-session gating',async()=>{assert.equal(await page.textContent('#posCartCount'),'1');assert.equal(await page.isDisabled('#posCompleteBtn'),false);});
  await page.click('#posCompleteBtn');
  await check('POS confirmation',async()=>{await page.locator('#confirmActionModal').waitFor({state:'visible'});assert.equal(await page.textContent('#confirmActionTitle'),'Complete Sale?');});
  await page.click('#confirmActionConfirm');await page.locator('#invoiceModal').waitFor({state:'visible'});
  await check('POS invoice uses exact returned identity/customer',async()=>{assert.match(await page.textContent('#invoicePaper'),/INV-000017/);assert.match(await page.textContent('#invoicePaper'),/মহিউদ্দিন/);});
  await check('POS posts exactly once',async()=>{const calls=await page.evaluate(()=>__rpcCalls.filter(c=>c.name==='completeSale'));assert.equal(calls.length,1);assert.equal(calls[0].args[1].items[0].productId,'PROD-000001');});
  await check('POS browser errors',()=>assert.deepEqual(errors,[]));await page.close();
  // The split-payment feature stays off in real Settings: exercise UI only
  // with mock browser state and never call a transactional Apps Script RPC.
  ({page,errors}=await boot(browser,{width:768,height:1024}));
  await route(page,'posv2');
  await page.waitForFunction(()=>posState.products.length>0);
  await page.fill('#posSearch','4 inch Test Pipe');
  await page.press('#posSearch','Enter');
  await page.evaluate(()=>{
    posState.multiPaymentEnabled=true;
    posState.paymentModeLegacy=false;
    posState.bankAccounts=[
      {id:'B1',name:'Demo Bank',type:'Bank'},
      {id:'M1',name:'Demo Mobile',type:'Mobile Banking'}
    ];
    posApplyPaymentMode_();
  });
  await check('POS split controls are opt-in and use compact, readable payment rows',async()=>{
    assert.equal(await page.locator('#posMultiPaymentFields').isVisible(),true);
    assert.equal(await page.locator('#posMultiPaymentRows [data-payment-row]').count(),1);
    assert.match(await page.locator('#posMultiPaymentFields').innerText(),/Paid Now/);
    assert.equal(await page.locator('#posMultiPaymentRows .pos-multi-remove svg').count(),1);
    const h=await page.locator('#posMultiPaymentRows .pos-multi-amount').first()
      .evaluate(el=>getComputedStyle(el).height);
    assert.equal(h,'36px');
  });
  await page.click('#posAddPaymentRowBtn');
  await check('adding a payment focuses its method without changing Cash row',async()=>{
    assert.equal(await page.locator('#posMultiPaymentRows [data-payment-row]').count(),2);
    const f=await page.evaluate(()=>{
      const select=document.querySelector('#posMultiPaymentRows [data-payment-row="pm-2"] .pos-multi-method');
      return document.activeElement===select || document.activeElement===select._touchSelectTrigger;
    });
    assert.equal(f,true);
  });
  await page.evaluate(()=>{
    window.__firstPaymentAmount=document.querySelector('#posMultiPaymentRows [data-payment-row="pm-1"] .pos-multi-amount');
  });
  await page.locator('#posMultiPaymentRows [data-payment-row="pm-2"] .pos-multi-method + .touch-select-trigger').click();
  await page.locator('#touchSelectMenuGlobal [data-touch-option-index]').filter({hasText:'Mobile Banking'}).click();
  await page.waitForFunction(()=>{
    const a=document.querySelector('#posMultiPaymentRows [data-payment-row="pm-2"] [data-payment-field="accountId"]');
    return a && (document.activeElement===a || document.activeElement===a._touchSelectTrigger);
  });
  await check('changing method updates only its account, preserving the other amount DOM and focus',async()=>{
    const v=await page.evaluate(()=>{
      const first=document.querySelector('#posMultiPaymentRows [data-payment-row="pm-1"] .pos-multi-amount');
      const second=document.querySelector('#posMultiPaymentRows [data-payment-row="pm-2"] [data-payment-field="accountId"]');
      return {sameNode:first===window.__firstPaymentAmount,
        accountExists:!!second,
        accountFocused:document.activeElement===second || document.activeElement===second._touchSelectTrigger};
    });
    assert.deepEqual(v,{sameNode:true,accountExists:true,accountFocused:true});
  });
  await page.locator('#posMultiPaymentRows [data-payment-row="pm-2"] .pos-multi-account .touch-select-trigger').click();
  await page.locator('#touchSelectMenuGlobal [data-touch-option-index]').filter({hasText:'Demo Mobile'}).click();
  await page.fill('#posMultiPaymentRows [data-payment-row="pm-1"] .pos-multi-amount','20');
  await page.fill('#posMultiPaymentRows [data-payment-row="pm-2"] .pos-multi-amount','5');
  await check('split checkout keeps applied paid and due separate before Fill Due',async()=>{
    assert.match(await page.locator('#posMultiPaidAmount').innerText(),/25/);
    assert.match(await page.locator('#posMultiDueAmount').innerText(),/25/);
  });
  await page.locator('#posMultiPaymentRows [data-payment-row="pm-2"] [data-payment-action="remaining"]').click();
  await check('Fill Due preserves Cash amount and restores amount focus',async()=>{
    const v=await page.evaluate(()=>{
      const one=document.querySelector('#posMultiPaymentRows [data-payment-row="pm-1"] .pos-multi-amount');
      const two=document.querySelector('#posMultiPaymentRows [data-payment-row="pm-2"] .pos-multi-amount');
      return {one:one.value,two:two.value,focus:document.activeElement===two,paid:document.getElementById('posMultiPaidAmount').textContent,due:document.getElementById('posMultiDueAmount').textContent};
    });
    assert.equal(v.one,'20');
    assert.equal(v.two,'30.00');
    assert.equal(v.focus,true);
    assert.match(v.paid,/50/);
    assert.match(v.due,/0/);
  });
  await check('POS split row controls never overlap tablet totals',async()=>{
    const geo=await page.evaluate(()=>{
      const row=document.querySelector('#posMultiPaymentRows [data-payment-row="pm-2"]');
      const rm=row.querySelector('.pos-multi-remove').getBoundingClientRect();
      const totals=document.querySelector('#page-pos .pos-checkout-totals').getBoundingClientRect();
      const fields=document.querySelector('#page-pos .pos-checkout-fields').getBoundingClientRect();
      return {removeRight:rm.right,totalsLeft:totals.left,fieldsRight:fields.right,rowRight:row.getBoundingClientRect().right};
    });
    assert.ok(geo.removeRight<=geo.totalsLeft+1,JSON.stringify(geo));
    assert.ok(geo.rowRight<=geo.fieldsRight+1,JSON.stringify(geo));
  });
  await page.locator('#posMultiPaymentRows [data-payment-row="pm-2"] [data-payment-action="remove"]').click();
  await check('remove retains one Cash row, disables its trash action and posts nothing',async()=>{
    assert.equal(await page.locator('#posMultiPaymentRows [data-payment-row]').count(),1);
    assert.equal(await page.locator('#posMultiPaymentRows .pos-multi-remove').isDisabled(),true);
    assert.equal(await page.locator('#posMultiPaymentRows [data-payment-row="pm-1"] .pos-multi-amount').inputValue(),'20');
    const calls=await page.evaluate(()=>__rpcCalls.filter(c=>c.name==='completeSale'));
    assert.equal(calls.length,0);
    assert.deepEqual(errors,[]);
  });
  await page.close();

  ({page,errors}=await boot(browser));await route(page,'posv2');
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
  await check('Sales uses one continuous vertical page scroller and pins table header beneath topbar',async()=>{
    await page.setViewportSize({width:1280,height:900});
    await page.evaluate(()=>{
      const wrap=document.getElementById('smTableScroll');
      const body=wrap.querySelector('tbody');
      const source=body.querySelector('tr');
      if(!source)throw Error('fixture sale row missing');
      for(let i=0;i<60;i++)body.appendChild(source.cloneNode(true));
      const content=document.getElementById('content');
      content.scrollTop=0;
      smSyncTopScrollbar_();
    });
    const initial=await page.evaluate(()=>({
      pinned:document.getElementById('smPinnedSalesHeader')?.hidden,
      nestedMaxHeight:getComputedStyle(document.getElementById('smTableScroll')).maxHeight,
      nestedOverflow:getComputedStyle(document.getElementById('smTableScroll')).overflowY
    }));
    assert.equal(initial.pinned,true);
    assert.equal(initial.nestedMaxHeight,'none');
    assert.notEqual(initial.nestedOverflow,'auto');
    await page.evaluate(()=>document.getElementById('content').scrollTop=420);
    await page.waitForFunction(()=>!document.getElementById('smPinnedSalesHeader').hidden);
    const geometry=await page.evaluate(()=>{
      const content=document.getElementById('content');
      const wrap=document.getElementById('smTableScroll');
      const pinned=document.getElementById('smPinnedSalesHeader');
      const actual=wrap.querySelector('thead');
      const overlayHead=pinned.querySelector('thead');
      const top=pinned.getBoundingClientRect().top;
      return {
        pageScroll:content.scrollTop,innerScroll:wrap.scrollTop,
        contentTop:content.getBoundingClientRect().top,
        originalHeaderBottom:actual.getBoundingClientRect().bottom,
        pinnedTop:top,barHeight:document.getElementById('smPinnedTopScroll')?.hidden ? 0 : document.getElementById('smPinnedTopScroll').offsetHeight,
        heading:overlayHead?.textContent||'',
        headerCells:overlayHead?.querySelectorAll('th').length,
        originalCells:actual.querySelectorAll('th').length
      };
    });
    assert.ok(geometry.pageScroll>=400);
    assert.equal(geometry.innerScroll,0);
    assert.ok(geometry.originalHeaderBottom<geometry.contentTop);
    assert.ok(Math.abs(geometry.pinnedTop-geometry.contentTop-geometry.barHeight)<=2);
    assert.match(geometry.heading,/Invoice/);
    assert.match(geometry.heading,/Actions/);
    assert.equal(geometry.headerCells,geometry.originalCells);
    await page.evaluate(()=>document.getElementById('content').scrollTop=0);
    await page.waitForFunction(()=>document.getElementById('smPinnedSalesHeader').hidden);
  });
  await check('Sales pinned header works at tablet width without a bottom-limited row viewport',async()=>{
    await page.setViewportSize({width:768,height:1024});
    await page.evaluate(()=>document.getElementById('content').scrollTop=500);
    await page.waitForFunction(()=>!document.getElementById('smPinnedSalesHeader').hidden);
    const tablet=await page.evaluate(()=>{
      const content=document.getElementById('content');
      const wrap=document.getElementById('smTableScroll');
      const pinned=document.getElementById('smPinnedSalesHeader');
      return {scroll:content.scrollTop,innerScroll:wrap.scrollTop,
        pinTop:pinned.getBoundingClientRect().top,
        barHeight:document.getElementById('smPinnedTopScroll')?.hidden ? 0 : document.getElementById('smPinnedTopScroll').offsetHeight,
        contentTop:content.getBoundingClientRect().top,
        cap:getComputedStyle(wrap).maxHeight};
    });
    assert.ok(tablet.scroll>100);
    assert.equal(tablet.innerScroll,0);
    assert.equal(tablet.cap,'none');
    assert.ok(Math.abs(tablet.pinTop-tablet.contentTop-tablet.barHeight)<=2);
    await page.setViewportSize({width:390,height:844});
    await page.waitForTimeout(60);
    const mobile=await page.evaluate(()=>{
      const wrap=document.getElementById('smTableScroll');
      const pinned=document.getElementById('smPinnedSalesHeader');
      return {maxHeight:getComputedStyle(wrap).maxHeight,
        headerDisplay:getComputedStyle(wrap.querySelector('thead')).display,
        pinnedDisplay:getComputedStyle(pinned).display};
    });
    assert.equal(mobile.maxHeight,'none');
    assert.equal(mobile.headerDisplay,'none');
    assert.equal(mobile.pinnedDisplay,'none');
  });
  await check('tablet keeps Sales Actions pinned right across horizontal scrolling',async()=>{
    await page.setViewportSize({width:768,height:1024});
    const position=await page.evaluate(()=>{
      const scroll=document.getElementById('smTableScroll');
      scroll.scrollTop=0;
      const td=scroll.querySelector('tbody td.erp-sticky-action-col');
      const th=scroll.querySelector('thead th.erp-sticky-action-col');
      if(!td||!th)throw new Error('Sticky action column missing');
      const before=td.getBoundingClientRect().right;
      const sr=scroll.getBoundingClientRect();
      scroll.scrollLeft=scroll.scrollWidth;
      const r=td.getBoundingClientRect();
      return {overflow:scroll.scrollWidth>scroll.clientWidth+10,
        scrollAmount:scroll.scrollLeft,before:before,after:r.right,containerRight:sr.right,
        scrollportRight:sr.left+scroll.clientLeft+scroll.clientWidth,
        scrollbarWidth:scroll.offsetWidth-scroll.clientWidth,
        position:getComputedStyle(td).position,head:getComputedStyle(th).position,
        lastHeader:th===scroll.querySelector('thead tr').lastElementChild,
        lastRowCell:td===scroll.querySelector('tbody tr').lastElementChild};
    });
    assert.equal(position.overflow,true,'tablet should be able to scroll horizontally');
    assert.ok(position.scrollAmount>10,'test must actually scroll horizontally');
    assert.equal(position.position,'sticky');assert.equal(position.head,'sticky');
    assert.equal(position.lastHeader,true);assert.equal(position.lastRowCell,true);
    // The native vertical scrollbar consumes part of the scrollport, so the
    // pinned cell may settle inward by its width when horizontal scrolling
    // starts. It must never travel away with the other table columns.
    assert.ok(Math.abs(position.before-position.after)<=position.scrollbarWidth+2,
      'right action moves beyond scrollbar gutter: '+JSON.stringify(position));
    assert.ok(Math.abs(position.after-position.scrollportRight)<=2,
      'right action must stay against usable scrollport right edge: '+JSON.stringify(position));
  });
  await check('pinned Sales header follows horizontal scroll while Actions stay on the right',async()=>{
    await page.setViewportSize({width:768,height:1024});
    await page.evaluate(()=>{
      document.getElementById('content').scrollTop=500;
      smSyncPinnedHeader_(true);
    });
    await page.waitForFunction(()=>!document.getElementById('smPinnedSalesHeader').hidden);
    const geometry=await page.evaluate(()=>{
      const wrap=document.getElementById('smTableScroll');
      wrap.scrollLeft=wrap.scrollWidth;
      smSyncPinnedHeader_();
      const pinned=document.getElementById('smPinnedSalesHeader');
      const last=pinned.querySelector('th.erp-sticky-action-col');
      return {realScroll:wrap.scrollLeft,mirroredScroll:pinned.scrollLeft,
        pinnedRight:pinned.getBoundingClientRect().right,
        actionRight:last.getBoundingClientRect().right,
        columnAlignment:Array.from(wrap.querySelectorAll('thead th')).map((cell,i)=>{
          const clone=pinned.querySelectorAll('thead th')[i];
          return {label:cell.textContent.trim(),
            dx:Math.abs(cell.getBoundingClientRect().left-clone.getBoundingClientRect().left),
            dw:Math.abs(cell.getBoundingClientRect().width-clone.getBoundingClientRect().width)};
        }).filter(c=>c.label!=='Profit'),
        duplicateIdCount:document.querySelectorAll('#smProfitHeader').length};
    });
    assert.ok(geometry.realScroll>10);
    assert.ok(Math.abs(geometry.mirroredScroll-geometry.realScroll)<=1);
    assert.ok(Math.abs(geometry.actionRight-geometry.pinnedRight)<=15);
    assert.equal(geometry.duplicateIdCount,1,'cloned headings must never duplicate DOM IDs');
    assert.ok(geometry.columnAlignment.every(c=>c.dx<=3 && c.dw<=3),
      'pinned header columns must align with corresponding invoice cells: '+JSON.stringify(geometry.columnAlignment));
  });
  await check('Sales pinned top slider is visible, clickable and synchronized both directions',async()=>{
    await page.setViewportSize({width:768,height:1024});
    await page.evaluate(()=>{
      document.getElementById('content').scrollTop=500;
      document.getElementById('smTableScroll').scrollLeft=0;
      smSyncTopScrollbar_();
    });
    await page.waitForFunction(()=>{
      const b=document.getElementById('smPinnedTopScroll');
      return b && !b.hidden && b.scrollWidth>b.clientWidth+10;
    });
    const m=await page.evaluate(()=>{
      const tableScroll=document.getElementById('smTableScroll');
      const pinned=document.getElementById('smPinnedSalesHeader');
      const pinnedBar=document.getElementById('smPinnedTopScroll');
      const originalBar=document.getElementById('smTopScroll');
      const content=document.getElementById('content');
      const initial={barTop:pinnedBar.getBoundingClientRect().top,
        headerTop:pinned.getBoundingClientRect().top,
        contentTop:content.getBoundingClientRect().top,barHeight:pinnedBar.offsetHeight,
        tabIndex:pinnedBar.tabIndex,barWidth:pinnedBar.scrollWidth,viewWidth:pinnedBar.clientWidth};
      pinnedBar.scrollLeft=100;
      pinnedBar.dispatchEvent(new Event('scroll'));
      const afterThumb={table:tableScroll.scrollLeft,normal:originalBar.scrollLeft,header:pinned.scrollLeft};
      tableScroll.scrollLeft=0;
      tableScroll.dispatchEvent(new Event('scroll'));
      const afterTable={bar:pinnedBar.scrollLeft,normal:originalBar.scrollLeft,header:pinned.scrollLeft};
      return {initial,afterThumb,afterTable};
    });
    assert.ok(m.initial.barWidth-m.initial.viewWidth>100);
    assert.equal(m.initial.tabIndex,0);
    assert.ok(Math.abs(m.initial.barTop-m.initial.contentTop)<=2);
    assert.ok(Math.abs(m.initial.headerTop-m.initial.barTop-m.initial.barHeight)<=2);
    assert.ok(Math.abs(m.afterThumb.table-100)<=1,JSON.stringify(m));
    assert.ok(Math.abs(m.afterThumb.normal-100)<=1);
    assert.ok(Math.abs(m.afterThumb.header-100)<=1);
    assert.ok(Math.abs(m.afterTable.bar)<=1);
    assert.ok(Math.abs(m.afterTable.normal)<=1);
    assert.ok(Math.abs(m.afterTable.header)<=1);
  });
  await check('Sales row three-dot actions show icons and preserve keyboard/menu semantics',async()=>{
    await page.evaluate(()=>{
      document.getElementById('content').scrollTop=0;
      document.getElementById('smTableScroll').scrollLeft=0;
      smSyncPinnedHeader_();
    });
    const button=page.locator('#smTableBody button[data-id="INV-000017"]').first();
    await button.click();
    const menu=page.locator('#rowActionMenuGlobal');
    await menu.waitFor({state:'visible'});
    const labels=await menu.locator('button[data-row-action]').allTextContents();
    assert.ok(labels.includes('View'),JSON.stringify(labels));assert.ok(labels.includes('Duplicate'),JSON.stringify(labels));
    assert.ok(labels.includes('Delete'));
    assert.equal(await menu.locator('button[data-row-action] .action-menu-icon').count(),labels.length);
    assert.ok(await menu.locator('button[data-row-action="delete"]').evaluate(el=>el.classList.contains('danger')));
    await page.keyboard.press('Home');
    assert.equal(await page.evaluate(()=>document.activeElement?.dataset?.rowAction),'view');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(()=>document.activeElement?.dataset?.rowAction),'duplicate');
    await page.keyboard.press('Escape');
    assert.equal(await menu.isVisible(),false);
    assert.equal(await button.evaluate(el=>el===document.activeElement),true,'Escape restores trigger focus');
  });
  await check('mobile sales cards keep invoice first and row action at card end',async()=>{
    await page.setViewportSize({width:390,height:844});
    const g=await page.evaluate(()=>{
      const row=document.querySelector('#smTableBody tr');
      const action=row.querySelector('td.erp-sticky-action-col');
      const invoice=row.children[1];
      return {actionOrder:getComputedStyle(action).order,invoiceOrder:getComputedStyle(invoice).order,
        actionPosition:getComputedStyle(action).position,
        actionName:action.querySelector('button')?.getAttribute('aria-label')||''};
    });
    assert.equal(g.actionPosition,'static');
    assert.ok(Number(g.invoiceOrder)<Number(g.actionOrder));
    assert.match(g.actionName,/Actions for invoice/);
  });
  await check('approved Sales desktop shell is sticky in normal flow with compact one-row filters',async()=>{
    await page.setViewportSize({width:1280,height:900});
    const m=await page.evaluate(()=>{
      const bar=document.querySelector('.topbar');
      const content=document.getElementById('content');
      const filters=document.querySelector('#page-sales > .toolbar');
      const action=document.querySelector('#smTableScroll tbody td.erp-sticky-action-col');
      const header=document.querySelector('#smTableScroll thead th.erp-sticky-action-col');
      const table=document.getElementById('smTableScroll');
      return {
        barPosition:getComputedStyle(bar).position,
        topOffset:Math.abs(content.getBoundingClientRect().top-bar.getBoundingClientRect().bottom),
        contentMargin:getComputedStyle(content).marginTop,
        filtersDisplay:getComputedStyle(filters).display,
        filtersHeight:filters.getBoundingClientRect().height,
        actionBorder:getComputedStyle(action).borderLeftWidth,
        actionShadow:getComputedStyle(action).boxShadow,
        headerShadow:getComputedStyle(header).boxShadow,
        headerText:header.textContent.trim(),
        stickyRight:getComputedStyle(action).right,
        tableHeight:table.clientHeight,
        tableMaxHeight:getComputedStyle(table).maxHeight
      };
    });
    assert.equal(m.barPosition,'sticky');
    assert.ok(m.topOffset<=2,'content must directly follow top bar without fixed-offset gap');
    assert.equal(m.contentMargin,'0px');
    assert.equal(m.filtersDisplay,'grid');
    assert.ok(m.filtersHeight<=54,'desktop filters should occupy one compact row');
    assert.equal(m.actionBorder,'0px');
    assert.equal(m.actionShadow,'none');
    assert.equal(m.headerShadow,'none');
    assert.equal(m.headerText,'Actions');
    assert.equal(m.stickyRight,'0px');
    assert.ok(m.tableHeight>250,'table stays a readable scroll area');
  });
  await check('approved Sales tablet filters wrap compactly without clipping or fixed topbar',async()=>{
    await page.setViewportSize({width:768,height:1024});
    const m=await page.evaluate(()=>{
      const filters=document.querySelector('#page-sales > .toolbar');
      const wrap=document.getElementById('smTableScroll');
      const row=filters.getBoundingClientRect(), content=document.getElementById('content');
      return {
        topbar:getComputedStyle(document.querySelector('.topbar')).position,
        grid:getComputedStyle(filters).display,
        height:row.height,
        contentRight:content.getBoundingClientRect().right,
        rowRight:row.right,
        actionPosition:getComputedStyle(wrap.querySelector('td.erp-sticky-action-col')).position
      };
    });
    assert.equal(m.topbar,'sticky');assert.equal(m.grid,'grid');
    assert.ok(m.height<=106,'tablet filters should require at most two compact rows');
    assert.ok(m.rowRight<=m.contentRight+1,'filter row must not exceed the viewport');
    assert.equal(m.actionPosition,'sticky');
  });
  await check('Sales reference table metrics for Products parity',async()=>{
    await page.setViewportSize({width:768,height:1024});
    await page.evaluate(()=>{document.getElementById('content').scrollTop=500;smSyncTopScrollbar_();});
    await page.waitForFunction(()=>!document.getElementById('smPinnedSalesHeader').hidden);
    salesTableVisualMetrics=await page.evaluate(()=>{
      const style=el=>{const c=getComputedStyle(el);return {
        fontSize:c.fontSize,fontWeight:c.fontWeight,lineHeight:c.lineHeight,
        paddingTop:c.paddingTop,paddingBottom:c.paddingBottom,
        paddingLeft:c.paddingLeft,paddingRight:c.paddingRight,
        textTransform:c.textTransform,letterSpacing:c.letterSpacing};};
      const wrap=document.getElementById('smTableScroll');
      const button=getComputedStyle(wrap.querySelector('tbody tr .erp-row-action-trigger'));
      return {th:style(wrap.querySelector('thead th')),td:style(wrap.querySelector('tbody td')),
        pinned:style(document.querySelector('#smPinnedSalesHeader th')),
        action:{width:button.width,height:button.height,minHeight:button.minHeight}};
    });
    assert.equal(salesTableVisualMetrics.th.fontSize,'12px');
  });
  await check('clicking a Sales customer opens the paid-invoice-aware Customer detail modal',async()=>{
    await page.evaluate(()=>{
      window.__mockOverrides.getCustomerDetail={
        customer:{'Customer ID':'C2','Customer Name':'মহিউদ্দিন','Phone':'01712345678','Current Due':0},
        ledger:[
          {'Ledger ID':'SOURCE|customer|INV-000017','Date':'2026-09-05','Type':'Sale',
            'Reference':'INV-000017',Debit:50,Credit:50,Balance:0,_invoiceProjection:true},
          {'Ledger ID':'CL-22','Date':'2026-09-01','Type':'Payment','Reference':'PAYMENT',
            Debit:'',Credit:20,Balance:0,'Payment Amount':20,'Discount Amount':0}
        ]
      };
    });
    await page.locator('#smTableBody button[data-customer-profile-id="C2"]').first().click();
    await page.locator('#custDetailModal').waitFor({state:'visible'});
    const detail=page.locator('#custLedgerBody');
    const text=await detail.innerText();
    assert.match(text,/INV-000017/);
    assert.match(text,/Paid at Checkout/);
    assert.match(text,/Invoice Total/);
    assert.equal(await detail.locator('tr').count(),2);
    assert.equal(await detail.locator('button[data-act="menuLed"]').count(),1,
      'only real payment rows retain Edit/Delete actions');
    assert.equal(await page.locator('#custDetailDue').innerText(),'৳0');
    const calls=await page.evaluate(()=>__rpcCalls.filter(c=>c.name==='getCustomerDetail'));
    assert.equal(calls.at(-1).args[1],'C2');
    await page.locator('#custDetailModal .modal-close').first().click();
  });
  await check('sales browser errors',()=>assert.deepEqual(errors,[]));await page.close();
  ({page,errors}=await boot(browser,{width:1280,height:900}));
  await page.evaluate(()=>{
    const products=Array.from({length:58},(_,i)=>({
      'Product ID':'TEST-PROD-'+String(i+1).padStart(3,'0'),
      'Product Name':'Pipe sample '+String(i+1).padStart(3,'0'),
      'Category':'Pipe','Brand':'RFL','Unit':'pcs','Product Type':'Standard',
      'Purchase Price':100,'Selling Price':120,'Current Stock':40+i,
      'Minimum Stock':5,'Stock Value':4000+(i*100),'Status':'Active'
    }));
    window.__mockOverrides.getProductsBootstrap={products,categories:[{name:'Pipe'}],units:[{name:'pcs'}],lowStockThreshold:5};
  });
  await route(page,'products');
  await page.locator('#prodTableBody tr').first().waitFor();
  await check('Products rows scroll with page and conditional heading pins under topbar',async()=>{
    const start=await page.evaluate(()=>{
      const content=document.getElementById('content');
      content.scrollTop=0;
      prodSyncPinnedHeader_(true);
      const wrap=document.getElementById('prodTableScroll');
      return {initialHidden:document.getElementById('prodPinnedHeader').hidden,
        maxHeight:getComputedStyle(wrap).maxHeight,
        overflowY:getComputedStyle(wrap).overflowY,
        totalRows:document.querySelectorAll('#prodTableBody tr').length};
    });
    assert.equal(start.initialHidden,true);
    assert.equal(start.maxHeight,'none');
    assert.notEqual(start.overflowY,'auto');
    assert.equal(start.totalRows,58);
    await page.evaluate(()=>document.getElementById('content').scrollTop=500);
    await page.waitForFunction(()=>!document.getElementById('prodPinnedHeader').hidden);
    const geometry=await page.evaluate(()=>{
      const wrap=document.getElementById('prodTableScroll');
      const content=document.getElementById('content');
      const pin=document.getElementById('prodPinnedHeader');
      return {pageScroll:content.scrollTop,innerScroll:wrap.scrollTop,
        contentTop:content.getBoundingClientRect().top,
        pinnedTop:pin.getBoundingClientRect().top,
        barHeight:document.getElementById('prodPinnedTopScroll')?.hidden ? 0 : document.getElementById('prodPinnedTopScroll').offsetHeight,
        realHeaderBottom:wrap.querySelector('thead').getBoundingClientRect().bottom,
        headerCount:pin.querySelectorAll('th').length,
        originalCount:wrap.querySelectorAll('thead th').length};
    });
    assert.ok(geometry.pageScroll>250);
    assert.equal(geometry.innerScroll,0);
    assert.ok(geometry.realHeaderBottom<geometry.contentTop);
    assert.ok(Math.abs(geometry.contentTop+geometry.barHeight-geometry.pinnedTop)<=2);
    assert.equal(geometry.headerCount,geometry.originalCount);
  });
  await check('Products pinned heading synchronizes horizontally and preserves rightmost Actions',async()=>{
    await page.setViewportSize({width:768,height:1024});
    await page.evaluate(()=>{
      document.getElementById('content').scrollTop=500;
      document.getElementById('prodTableScroll').scrollLeft=0;
      prodSyncPinnedHeader_(true);
    });
    await page.waitForFunction(()=>!document.getElementById('prodPinnedHeader').hidden);
    const geo=await page.evaluate(()=>{
      const wrap=document.getElementById('prodTableScroll');
      wrap.scrollLeft=wrap.scrollWidth;
      prodSyncPinnedHeader_();
      const pin=document.getElementById('prodPinnedHeader');
      const action=pin.querySelector('th.erp-sticky-action-col');
      return {
        realScroll:wrap.scrollLeft,pinnedScroll:pin.scrollLeft,
        rightDiff:Math.abs(action.getBoundingClientRect().right-pin.getBoundingClientRect().right),
        order:action===pin.querySelector('tr').lastElementChild,
        columnErrors:Array.from(wrap.querySelectorAll('thead th')).map((real,i)=>{
          const clone=pin.querySelectorAll('thead th')[i];
          return {dLeft:Math.abs(real.getBoundingClientRect().left-clone.getBoundingClientRect().left),
            dWidth:Math.abs(real.getBoundingClientRect().width-clone.getBoundingClientRect().width)};
        }),
        buttonName:wrap.querySelector('td.erp-sticky-action-col button')?.getAttribute('aria-label')||''
      };
    });
    assert.ok(geo.realScroll>10);
    assert.ok(Math.abs(geo.pinnedScroll-geo.realScroll)<=1);
    assert.ok(geo.rightDiff<=15);
    assert.equal(geo.order,true);
    assert.ok(geo.columnErrors.every(x=>x.dLeft<=3 && x.dWidth<=3),JSON.stringify(geo.columnErrors));
    assert.match(geo.buttonName,/Actions for product/);
  });
  await check('Products inline and pinned top scrollbars stay aligned with tablet header',async()=>{
    await page.setViewportSize({width:768,height:1024});
    await page.evaluate(()=>{
      document.getElementById('content').scrollTop=500;
      document.getElementById('prodTableScroll').scrollLeft=0;
      prodSyncTopScrollbar_();
    });
    await page.waitForFunction(()=>{
      const b=document.getElementById('prodPinnedTopScroll');
      return b && !b.hidden && b.scrollWidth>b.clientWidth+10;
    });
    const m=await page.evaluate(()=>{
      const tableScroll=document.getElementById('prodTableScroll');
      const pinned=document.getElementById('prodPinnedHeader');
      const pinnedBar=document.getElementById('prodPinnedTopScroll');
      const originalBar=document.getElementById('prodTopScroll');
      const content=document.getElementById('content');
      const initial={barTop:pinnedBar.getBoundingClientRect().top,
        headerTop:pinned.getBoundingClientRect().top,contentTop:content.getBoundingClientRect().top,
        barHeight:pinnedBar.offsetHeight,tabIndex:pinnedBar.tabIndex,
        barWidth:pinnedBar.scrollWidth,viewWidth:pinnedBar.clientWidth};
      pinnedBar.scrollLeft=60;
      pinnedBar.dispatchEvent(new Event('scroll'));
      const afterThumb={table:tableScroll.scrollLeft,normal:originalBar.scrollLeft,header:pinned.scrollLeft};
      tableScroll.scrollLeft=0;
      tableScroll.dispatchEvent(new Event('scroll'));
      const afterTable={bar:pinnedBar.scrollLeft,normal:originalBar.scrollLeft,header:pinned.scrollLeft};
      return {initial,afterThumb,afterTable};
    });
    assert.ok(m.initial.barWidth-m.initial.viewWidth>60);
    assert.equal(m.initial.tabIndex,0);
    assert.ok(Math.abs(m.initial.barTop-m.initial.contentTop)<=2);
    assert.ok(Math.abs(m.initial.headerTop-m.initial.barTop-m.initial.barHeight)<=2);
    assert.ok(Math.abs(m.afterThumb.table-60)<=1,JSON.stringify(m));
    assert.ok(Math.abs(m.afterThumb.normal-60)<=1);
    assert.ok(Math.abs(m.afterThumb.header-60)<=1);
    assert.ok(Math.abs(m.afterTable.bar)<=1);
    assert.ok(Math.abs(m.afterTable.normal)<=1);
    assert.ok(Math.abs(m.afterTable.header)<=1);
  });
  await check('Products tablet typography and pinned headings match Sales exactly',async()=>{
    await page.setViewportSize({width:768,height:1024});
    await page.evaluate(()=>{document.getElementById('content').scrollTop=500;prodSyncTopScrollbar_();});
    await page.waitForFunction(()=>!document.getElementById('prodPinnedHeader').hidden);
    const metrics=await page.evaluate(()=>{
      const style=el=>{const c=getComputedStyle(el);return {
        fontSize:c.fontSize,fontWeight:c.fontWeight,lineHeight:c.lineHeight,
        paddingTop:c.paddingTop,paddingBottom:c.paddingBottom,
        paddingLeft:c.paddingLeft,paddingRight:c.paddingRight,
        textTransform:c.textTransform,letterSpacing:c.letterSpacing};};
      const wrap=document.getElementById('prodTableScroll');
      const button=getComputedStyle(wrap.querySelector('tbody tr .erp-row-action-trigger'));
      const name=getComputedStyle(wrap.querySelector('tbody .prod-item-name'));
      const price=getComputedStyle(wrap.querySelector('tbody .prod-price-main'));
      return {th:style(wrap.querySelector('thead th')),td:style(wrap.querySelector('tbody td')),
        pinned:style(document.querySelector('#prodPinnedHeader th')),
        action:{width:button.width,height:button.height,minHeight:button.minHeight},
        name:{size:name.fontSize,weight:name.fontWeight},price:{size:price.fontSize,weight:price.fontWeight}};
    });
    assert.deepEqual(metrics.th,salesTableVisualMetrics.th);
    assert.deepEqual(metrics.td,salesTableVisualMetrics.td);
    assert.deepEqual(metrics.pinned,salesTableVisualMetrics.pinned);
    assert.deepEqual(metrics.action,salesTableVisualMetrics.action);
    assert.equal(metrics.name.size,salesTableVisualMetrics.td.fontSize);
    assert.equal(metrics.name.weight,salesTableVisualMetrics.td.fontWeight);
    assert.equal(metrics.price.size,salesTableVisualMetrics.td.fontSize);
    assert.equal(metrics.price.weight,salesTableVisualMetrics.td.fontWeight);
  });
  await check('Products sticky heading sorting uses existing product sort and item actions',async()=>{
    const sort=page.locator('#prodPinnedHeader button[data-sort-key="sellingPrice"]');
    await sort.click();
    await page.waitForFunction(()=>prodState.sortKey==='sellingPrice' && prodState.sortDir==='asc');
    assert.equal(await page.locator('#prodTable thead th[aria-sort="ascending"]').count(),1);
    assert.equal(await page.locator('#prodTableBody tr').count(),58);
    await page.evaluate(()=>{
      document.getElementById('content').scrollTop=0;
      document.getElementById('prodTableScroll').scrollLeft=0;
      prodSyncPinnedHeader_();
    });
    const trigger=page.locator('#prodTableBody button[data-act="menu"]').first();
    await trigger.click();
    const menu=page.locator('#rowActionMenuGlobal');
    await menu.waitFor({state:'visible'});
    const labels=await menu.locator('button[data-row-action]').allTextContents();
    assert.deepEqual(labels,['Edit','Adjust Stock','View Lots','Deactivate','Delete']);
    assert.equal(await menu.locator('button[data-row-action] .action-menu-icon').count(),labels.length);
    assert.equal(await menu.locator('button[data-row-action="delete"].danger').count(),1);
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(()=>document.activeElement?.dataset?.rowAction),'stock');
    await page.keyboard.press('Escape');
    assert.equal(await menu.isVisible(),false);
    assert.equal(await trigger.evaluate(el=>el===document.activeElement),true);
  });
  await check('Products phone cards and other module never show mirrored header',async()=>{
    await page.setViewportSize({width:390,height:844});
    const mobile=await page.evaluate(()=>{
      prodSyncPinnedHeader_();
      const wrap=document.getElementById('prodTableScroll');
      const pin=document.getElementById('prodPinnedHeader');
      return {display:getComputedStyle(pin).display,heading:getComputedStyle(wrap.querySelector('thead')).display};
    });
    assert.equal(mobile.display,'none');
    assert.equal(mobile.heading,'none');
    await route(page,'sales');
    assert.equal(await page.locator('#prodPinnedHeader').isVisible(),false);
  });
  await check('products browser errors',()=>assert.deepEqual(errors,[]));await page.close();
  ({page,errors}=await boot(browser));await route(page,'returns');await page.fill('#rtSearchInput','INV-000005');await page.click('#rtFindBtn');
  await check('return blocks duplicate invoice load',async()=>{const b=page.locator('#rtSearchResults button[data-id="INV-000005"]');await b.waitFor();assert.equal(await b.isDisabled(),true);assert.equal(await page.evaluate(()=>__rpcCalls.filter(c=>c.name==='getInvoiceForReturn').length),0);});
  await check('return browser errors',()=>assert.deepEqual(errors,[]));await page.close();
  ({page,errors}=await boot(browser));
  await page.evaluate(source.match(/page.evaluate\("""(window\.__mockOverrides.getInvoiceForReturn=[\s\S]*?)"""\)/)[1]);
  await route(page,'returns');await page.evaluate("returnsLoadInvoiceById_('INV-UNPAID')");
  await check('unpaid return uses store credit and blocks cash',async()=>{await page.waitForFunction(()=>document.getElementById('rtRefundMethod').value==='Store Credit');assert.equal(await page.locator('#rtRefundMethod option[value="Cash"]').isDisabled(),true);assert.match(await page.textContent('#rtRefundHint'),/No cash was collected/);});
  await check('unpaid return browser errors',()=>assert.deepEqual(errors,[]));await page.close();
  ({page,errors}=await boot(browser));await route(page,'posv2');await page.fill('#posSearch','4 inch Test Pipe');await page.press('#posSearch','Enter');
  await page.fill('#posCustomerName','মহিউদ্দিন');await page.fill('#posCustomerPhone','01712345678');await page.click('#posSaveDraftBtn');
  await check('draft save preserves totals without posting sale',async()=>{await page.waitForFunction(()=>__rpcCalls.some(c=>c.name==='saveSalesDraft'));const calls=await page.evaluate(()=>__rpcCalls);const draft=calls.filter(c=>c.name==='saveSalesDraft');assert.equal(draft.length,1);assert.equal(draft[0].args[1].grandTotal,50);assert.equal(draft[0].args[1].items[0].lineTotal,50);assert.equal(calls.filter(c=>c.name==='completeSale').length,0);});
  await check('draft browser errors',()=>assert.deepEqual(errors,[]));await page.close();
  ({page,errors}=await boot(browser,{width:768,height:1024}));await route(page,'posv2');
  await check('tablet POS adaptive layout',async()=>{const n=await page.$eval('#page-pos .pos-layout',e=>getComputedStyle(e).gridTemplateColumns.split(/\s+/).filter(Boolean).length);assert.ok(n>=1&&n<=2);});
  await check('tablet no document overflow',async()=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)<=1));
  await check('tablet sidebar rail',async()=>assert.ok(await page.$eval('#app',e=>e.classList.contains('sidebar-collapsed'))));
  await check('tablet browser errors',()=>assert.deepEqual(errors,[]));await page.close();
 } finally {await browser.close();}
 console.log(`production_gate_browser: ${pass}/${pass+fail} PASS; ${pages.length} routes; MOCKED Apps Script bridge`);
 if(fail)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
