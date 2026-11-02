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
  await check('sales browser errors',()=>assert.deepEqual(errors,[]));await page.close();
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

  // Shared WhatsApp dialog: use the same mocked Apps Script bridge as other
  // browser checks. No real WhatsApp navigation or financial writes occur.
  ({page,errors}=await boot(browser));
  await page.evaluate(()=>{
    window.__waCalls=[];
    window.__waCopied='';
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{
      writeText:async text=>{window.__waCopied=text;}
    }});
    window.serverCall=(fn,token,req)=>{
      if(fn!=='prepareWhatsAppMessage') return Promise.reject(Error('Unexpected RPC '+fn));
      window.__waCalls.push({fn,token,req:JSON.parse(JSON.stringify(req))});
      if(req.recipientOverride && !req.confirmOverride)
        return Promise.reject(Error('Confirm changed WhatsApp recipient'));
      const bn=req.language==='bn';
      const phone=req.recipientOverride?'8801912345678':'8801712345678';
      return Promise.resolve({
        title:bn?'হিসাব':'Account balance',partyName:'Rahim',mode:req.mode,source:req.source,
        recipient:req.entityId==='MISSING'?null:{digits:phone,display:'+'+phone,overridden:!!req.recipientOverride},
        text:bn?'মোট বকেয়া: ৳1,000':'Due balance: ৳1,000',
        canOpenLink:req.entityId!=='MISSING',warnings:req.entityId==='MISSING'?['WhatsApp phone number missing']:[]
      });
    };
  });
  await check('WhatsApp preview uses shared modal, verified phone and user click only',async()=>{
    await page.evaluate(()=>openWhatsAppShare_({source:'customer',entityId:'C-1',mode:'due'}));
    await page.locator('#waShareModal').waitFor({state:'visible'});
    assert.equal(await page.inputValue('#waShareText'),'মোট বকেয়া: ৳1,000');
    assert.equal(await page.inputValue('#waSharePhone'),'+8801712345678');
    const url=await page.locator('#waShareOpen').getAttribute('href');
    assert.ok(url.startsWith('https://wa.me/8801712345678?text='));
    assert.ok(decodeURIComponent(url.split('?text=')[1]).includes('৳1,000'));
    assert.equal((await page.evaluate(()=>window.__waCalls)).length,1);
    assert.equal(await page.locator('#waShareNotice').textContent()!=='',true);
  });
  await check('WhatsApp edited message is used in direct link without a new RPC',async()=>{
    await page.fill('#waShareText','Edited: ৳2,000\nSecond line');
    const url=await page.locator('#waShareOpen').getAttribute('href');
    assert.equal(decodeURIComponent(url.split('?text=')[1]),'Edited: ৳2,000\nSecond line');
    assert.equal((await page.evaluate(()=>window.__waCalls)).length,1);
  });
  await check('WhatsApp Bangla and English recompose using authenticated RPC',async()=>{
    await page.click('#waShareLanguage + .touch-select-trigger');
    await page.click('#touchSelectMenuGlobal button[data-touch-option-index="1"]');
    await page.waitForFunction(()=>document.getElementById('waShareText').value==='Due balance: ৳1,000');
    assert.equal((await page.evaluate(()=>window.__waCalls)).length,2);
    assert.equal((await page.evaluate(()=>window.__waCalls[1].req.language)),'en');
  });
  await check('WhatsApp changed phone is blocked until explicitly confirmed',async()=>{
    await page.fill('#waSharePhone','01912345678');
    assert.equal(await page.locator('#waShareOpen').getAttribute('href'),null);
    assert.equal(await page.locator('#waShareOpen').getAttribute('aria-disabled'),'true');
    await page.check('#waShareConfirmPhone');
    await page.waitForFunction(()=>!!document.getElementById('waShareOpen').getAttribute('href'));
    assert.match(await page.locator('#waShareOpen').getAttribute('href'),/^https:\/\/wa\.me\/8801912345678\?/);
  });
  await check('WhatsApp copy uses edited draft and Escape restores focus',async()=>{
    await page.fill('#waShareText','Copy this customer message');
    await page.click('#waShareCopy');
    assert.equal(await page.evaluate(()=>window.__waCopied),'Copy this customer message');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#waShareModal').isHidden(),true);
  });
  await check('WhatsApp missing recipient offers copy only, never link',async()=>{
    await page.evaluate(()=>openWhatsAppShare_({source:'customer',entityId:'MISSING',mode:'due'}));
    await page.locator('#waShareModal').waitFor({state:'visible'});
    await page.waitForFunction(()=>document.getElementById('waShareText').value.indexOf('৳1,000')>=0);
    assert.equal(await page.locator('#waShareOpen').getAttribute('href'),null);
    assert.equal(await page.locator('#waShareOpen').getAttribute('aria-disabled'),'true');
    assert.match(await page.locator('#waShareWarnings').textContent(),/phone number missing/i);
    await page.click('#waShareClose');
  });

  // Manual open audit must happen on a user click, never on preview/copy.
  await page.evaluate(()=>{
    window.__waAudits=[];
    window.__waAuditReject=false;
    const original=window.serverCall;
    window.serverCall=(fn,token,req)=>{
      if(fn==='recordWhatsAppShare'){
        window.__waAudits.push({fn,token,req:JSON.parse(JSON.stringify(req))});
        return window.__waAuditReject
          ? Promise.reject(Error('Audit log unavailable'))
          : Promise.resolve({eventId:'WSA-000001',status:'OPEN_ATTEMPTED',duplicate:false});
      }
      return original(fn,token,req);
    };
    window.__waSyntheticClick=()=>{
      const anchor=document.getElementById('waShareOpen');
      // Prevent external navigation in a mocked test; preserve click handling.
      anchor.addEventListener('click',e=>e.preventDefault(),{once:true,capture:true});
      anchor.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
    };
  });
  await check('WhatsApp audit fires only on actual enabled Open link and captures confirmed override',async()=>{
    await page.evaluate(()=>openWhatsAppShare_({source:'customer',entityId:'C-1',mode:'due'}));
    await page.waitForFunction(()=>!!document.getElementById('waShareOpen').getAttribute('href'));
    assert.equal((await page.evaluate(()=>window.__waAudits)).length,0);
    await page.fill('#waSharePhone','01912345678');
    await page.evaluate(()=>window.__waSyntheticClick());
    assert.equal((await page.evaluate(()=>window.__waAudits)).length,0);
    await page.check('#waShareConfirmPhone');
    await page.waitForFunction(()=>!!document.getElementById('waShareOpen').getAttribute('href'));
    await page.evaluate(()=>window.__waSyntheticClick());
    const calls=await page.evaluate(()=>window.__waAudits);
    assert.equal(calls.length,1);
    assert.equal(calls[0].fn,'recordWhatsAppShare');
    assert.equal(calls[0].req.source,'customer');
    assert.equal(calls[0].req.entityId,'C-1');
    assert.equal(calls[0].req.recipientOverride,'01912345678');
    assert.equal(calls[0].req.confirmOverride,true);
    assert.match(calls[0].req.eventKey,/^[A-Za-z0-9_-]{16,90}$/);
    assert.equal(JSON.stringify(calls[0].req).includes('message'),false);
    await page.evaluate(()=>window.__waSyntheticClick());
    assert.equal((await page.evaluate(()=>window.__waAudits)).length,1,'double click should not re-record attempt');
  });
  await check('WhatsApp audit failure remains nonblocking and never claims sent',async()=>{
    await page.evaluate(()=>{window.__waAuditReject=true;waShareState_.auditLastAt=0;window.__waSyntheticClick()});
    await page.waitForFunction(()=>document.getElementById('waShareWarnings').textContent.includes('Audit log unavailable'));
    assert.equal((await page.evaluate(()=>window.__waAudits)).length,2);
    assert.ok((await page.locator('#waShareOpen').getAttribute('href')).startsWith('https://wa.me/'));
    assert.doesNotMatch(await page.locator('#waShareWarnings').textContent(),/\b(sent|delivered)\b/i);
    await page.click('#waShareClose');
  });
  await check('WhatsApp Copy never records an open attempt',async()=>{
    await page.evaluate(()=>{window.__waAuditReject=false;openWhatsAppShare_({source:'customer',entityId:'C-1',mode:'due'})});
    await page.waitForFunction(()=>!!document.getElementById('waShareOpen').getAttribute('href'));
    await page.click('#waShareCopy');
    assert.equal((await page.evaluate(()=>window.__waAudits)).length,2);
    await page.click('#waShareClose');
  });

  await check('WhatsApp preview browser errors',()=>assert.deepEqual(errors,[]));
  await page.close();

  // Party ledger integrations: real page render/menu controls with simulated
  // data, while intercepting the shared preview entry point (no live GAS).
  for (const kind of ['customer','supplier']) {
    ({page,errors}=await boot(browser));
    await route(page,kind+'Ledger');
    const prefix=kind+'Ledger';
    await page.evaluate(kind=>{
      const st=kind==='customer'?customerLedgerState:supplierLedgerState;
      st.partyId=kind==='customer'?'C1':'S1';
      st.party={id:st.partyId,name:'Test Party',phone:'01712345678',balance:175,canPay:true,status:'Active'};
      st.parties=[st.party];st.page={pageSize:50,hasOlder:false,olderCursor:'',hasNewer:false};
      st.pageSize=50;st.showCorrections=false;st.canViewCorrections=false;
      st.waSelected={};st.partyCombo=null;
      st.rows=[{'Ledger ID':'CLEAN|'+kind+'|INV-1',Date:'2026-10-01',Type:kind==='customer'?'Sale':'Purchase',
        Reference:'INV-1',Debit:200,Credit:0,Balance:200,sourceModule:kind==='customer'?'sales':'purchase',availableActions:['view']}];
      window.__waPartyRequests=[];
      window.openWhatsAppShare_=function(req,trigger){
        window.__waPartyRequests.push(JSON.parse(JSON.stringify(req)));
        return req;
      };
      (kind==='customer'?customerLedgerRender_:supplierLedgerRender_)();
    },kind);
    await check(kind+' ledger due shortcut uses selected account',async()=>{
      await page.click('#'+prefix+'ShareDueBtn');
      const requests=await page.evaluate(()=>window.__waPartyRequests);
      assert.equal(requests[0].source,kind);assert.equal(requests[0].mode,'due');
      assert.deepEqual(requests[0].rowIds,[]);
    });
    await check(kind+' ledger row selection carries across pagination',async()=>{
      await page.locator('#'+prefix+'Body input[data-'+kind+'-ledger-share-index="0"]').check();
      await page.evaluate(kind=>{
        const st=kind==='customer'?customerLedgerState:supplierLedgerState;
        st.pageNumber=2;
        st.rows=[{'Ledger ID':'SOURCE|'+kind+'|INV-2',Date:'2026-10-02',Type:'Payment',
          Reference:'INV-2',Debit:0,Credit:25,Balance:175,sourceModule:kind==='customer'?'customerPayment':'supplierPayment',availableActions:[]}];
        (kind==='customer'?customerLedgerRenderRows_:supplierLedgerRenderRows_)();
      },kind);
      await page.locator('#'+prefix+'Body input[data-'+kind+'-ledger-share-index="0"]').check();
      await page.click('#'+prefix+'ShareSelectedBtn');
      const calls=await page.evaluate(()=>window.__waPartyRequests);
      assert.equal(calls.at(-1).mode,'selected');
      assert.deepEqual(calls.at(-1).rowIds,['CLEAN|'+kind+'|INV-1','SOURCE|'+kind+'|INV-2']);
      assert.equal(Object.keys(calls.at(-1).rowVersions).length,2);
    });
    await check(kind+' mobile WhatsApp selection keeps a touch-sized checkbox and contained toolbar',async()=>{
      await page.setViewportSize({width:375,height:812});
      try {
        const m=await page.evaluate(prefix=>{
          const label=document.querySelector('#'+prefix+'Body label.wa-party-row-choice').getBoundingClientRect();
          const controls=document.querySelector('#'+prefix+'Workspace .party-ledger-list-controls');
          const r=controls.getBoundingClientRect();
          return {w:label.width,h:label.height,left:r.left,right:r.right,viewport:document.documentElement.clientWidth};
        },prefix);
        assert.ok(m.w>=32 && m.h>=32,'Checkbox touch target '+m.w+'x'+m.h);
        assert.ok(m.left>=-1 && m.right<=m.viewport+1,'Toolbar clipped on mobile '+JSON.stringify(m));
      } finally {
        await page.setViewportSize({width:1440,height:1000});
      }
    });
    await check(kind+' clears cross-page WhatsApp selections without changing ledger rows',async()=>{
      await page.click('#'+prefix+'ClearSelectedBtn');
      assert.equal(await page.locator('#'+prefix+'ShareSelectedBtn').isDisabled(),true);
      assert.equal(await page.locator('#'+prefix+'ClearSelectedBtn').isHidden(),true);
      assert.equal(await page.locator('#'+prefix+'Body input[data-'+kind+'-ledger-share-index="0"]').isChecked(),false);
      const state=await page.evaluate(kind=>{
        const s=kind==='customer'?customerLedgerState:supplierLedgerState;
        return {count:Object.keys(s.waSelected||{}).length,rows:s.rows.length};
      },kind);
      assert.deepEqual(state,{count:0,rows:1});
    });
    await check(kind+' ledger per-row Actions menu shares only one entry',async()=>{
      await page.click('#'+prefix+'Body button[data-'+kind+'-ledger-action-index="0"]');
      await page.getByRole('menuitem',{name:'WhatsApp'}).click();
      const calls=await page.evaluate(()=>window.__waPartyRequests);
      assert.equal(calls.at(-1).mode,'single');
      assert.deepEqual(calls.at(-1).rowIds,['SOURCE|'+kind+'|INV-2']);
    });
    await check(kind+' ledger date-range works even when Print has no rows',async()=>{
      await page.evaluate(prefix=>{document.getElementById(prefix+'PrintBtn').disabled=true;},prefix);
      await page.click('#'+prefix+'SharePeriodBtn');
      // The ERP's existing touch-date replacement hides native inputs.
      // Seed their values; date-picker interaction has separate regression coverage.
      await page.evaluate(prefix=>{
        document.getElementById(prefix+'PrintFrom').value='2026-10-01';
        document.getElementById(prefix+'PrintTo').value='2026-10-31';
      },prefix);
      await page.click('#'+prefix+'PrintShareBtn');
      const calls=await page.evaluate(()=>window.__waPartyRequests);
      assert.equal(calls.at(-1).mode,'period');
      assert.equal(calls.at(-1).from,'2026-10-01');
      assert.equal(calls.at(-1).to,'2026-10-31');
      assert.deepEqual(calls.at(-1).rowIds,[]);
    });
    await check(kind+' ledger permission and correction visibility fail closed',async()=>{
      await page.evaluate(kind=>{
        const st=kind==='customer'?customerLedgerState:supplierLedgerState;
        st.showCorrections=true;
        waPartyLedgerUpdateUi_(kind,st);
      },kind);
      assert.equal(await page.locator('#'+prefix+'ShareDueBtn').isDisabled(),true);
      await page.evaluate(kind=>{
        const st=kind==='customer'?customerLedgerState:supplierLedgerState;
        st.showCorrections=false;
        userPermissions={whatsappShare:{edit:false},[kind==='customer'?'customers':'suppliers']:{view:true}};
        waPartyLedgerUpdateUi_(kind,st);
      },kind);
      assert.equal(await page.locator('#'+prefix+'ShareDueBtn').isHidden(),true);
      assert.equal(await page.locator('#'+prefix+'ShareSelectedBtn').isHidden(),true);
    });
    await check(kind+' ledger WhatsApp browser errors',()=>assert.deepEqual(errors,[]));
    await page.close();
  }



  // Finance Person WhatsApp: exercise the real existing ledger workspace
  // with sample role-scoped ledger rows (mocked GAS, no transactions or sends).
  ({page,errors}=await boot(browser));
  await route(page,'financePersonLedger');
  await page.evaluate(()=>{
    const st=finPersonLedgerState;
    const roles=['Owner','Lender','Borrower'];
    st.persons=[{id:'P1',name:'Finance Party',phone:'01712345678',status:'Active',roles:roles}];
    st.balances={P1:{owner:7000,loanPayable:2000,borrowerReceivable:400}};
    st.personId='P1';st.account='Lender';st.role='All';st.page=1;
    st.transactionTypes=[
      {key:'Loan Received',role:'Lender',account:'loanPayable',balanceEffect:1,label:'Lender Credit'},
      {key:'Loan Repayment',role:'Lender',account:'loanPayable',balanceEffect:-1,label:'Lender Debit'},
      {key:'Borrower Loan',role:'Borrower',account:'borrowerReceivable',balanceEffect:1,label:'Borrower Debit'},
      {key:'Owner Investment',role:'Owner',account:'owner',balanceEffect:1,label:'Owner Credit'}
    ];
    st.rows=[
      {financeId:'F2',personId:'P1',account:'loanPayable',date:'2026-10-02',transactionType:'Loan Repayment',transactionTypeLabel:'Lender Debit',amount:1000,credit:0,debit:1000,balance:2000,referenceNo:'REF2',notes:''},
      {financeId:'F1',personId:'P1',account:'loanPayable',date:'2026-10-01',transactionType:'Loan Received',transactionTypeLabel:'Lender Credit',amount:3000,credit:3000,debit:0,balance:3000,referenceNo:'REF1',notes:''},
      {financeId:'B1',personId:'P1',account:'borrowerReceivable',date:'2026-10-01',transactionType:'Borrower Loan',transactionTypeLabel:'Borrower Debit',amount:400,credit:0,debit:400,balance:400,referenceNo:'BREF',notes:''},
      {financeId:'O1',personId:'P1',account:'owner',date:'2026-10-01',transactionType:'Owner Investment',transactionTypeLabel:'Owner Credit',amount:7000,credit:7000,debit:0,balance:7000,referenceNo:'OREF',notes:''}
    ];
    st.waFinanceSelected={};st.waFinanceScope='';
    document.getElementById('fplDateFrom').value='';
    document.getElementById('fplDateTo').value='';
    document.getElementById('fplLedgerSearch').value='';
    document.getElementById('fplTypeFilter').value='';
    document.getElementById('fplPageSize').value='50';
    window.__waFinanceRequests=[];
    window.openWhatsAppShare_=function(req){
      window.__waFinanceRequests.push(JSON.parse(JSON.stringify(req)));
      return req;
    };
    finPersonLedgerRenderSelected_();
  });
  await check('Finance Lender balance and selected entries use account role',async()=>{
    await page.click('#fplShareBalanceBtn');
    let requests=await page.evaluate(()=>window.__waFinanceRequests);
    assert.deepEqual([requests.at(-1).source,requests.at(-1).entityId,requests.at(-1).accountRole,requests.at(-1).mode],
      ['financePerson','P1','Lender','due']);
    await page.locator('#fplTransactionBody input[data-fpl-wa-check="F2"]').check();
    await page.locator('#fplTransactionBody input[data-fpl-wa-check="F1"]').check();
    await page.click('#fplShareSelectedBtn');
    requests=await page.evaluate(()=>window.__waFinanceRequests);
    assert.deepEqual(requests.at(-1).rowIds,['F2','F1']);
    assert.ok(requests.at(-1).rowVersions.F1.includes('"loanPayable"'));
  });
  await check('Finance mobile WhatsApp selection touch target remains usable',async()=>{
    await page.setViewportSize({width:375,height:812});
    try {
      const m=await page.evaluate(()=>{
        document.querySelector('#page-financePersonLedger .finance-person-workspace').classList.add('show-person');
        const rect=document.querySelector('#fplTransactionBody label.wa-party-row-choice').getBoundingClientRect();
        const clear=document.getElementById('fplClearSelectedBtn').getBoundingClientRect();
        return {w:rect.width,h:rect.height,clearLeft:clear.left,clearRight:clear.right,viewport:document.documentElement.clientWidth};
      });
      assert.ok(m.w>=32 && m.h>=32,'Finance checkbox touch target '+m.w+'x'+m.h);
      assert.ok(m.clearLeft>=-1 && m.clearRight<=m.viewport+1,'Finance Clear selection offscreen '+JSON.stringify(m));
    } finally {
      await page.setViewportSize({width:1440,height:1000});
      await page.evaluate(()=>document.querySelector('#page-financePersonLedger .finance-person-workspace').classList.remove('show-person'));
    }
  });
  await check('Finance clears WhatsApp selection and unchecks visible rows',async()=>{
    await page.click('#fplClearSelectedBtn');
    assert.equal(await page.locator('#fplShareSelectedBtn').isDisabled(),true);
    assert.equal(await page.locator('#fplClearSelectedBtn').isHidden(),true);
    assert.equal(await page.locator('#fplTransactionBody input[data-fpl-wa-check="F1"]').isChecked(),false);
    assert.equal(await page.evaluate(()=>Object.keys(finPersonLedgerState.waFinanceSelected||{}).length),0);
  });
  await check('Finance row Actions include WhatsApp with only selected role transaction',async()=>{
    await page.click('#fplTransactionBody button[data-fpl-menu="F2"]');
    await page.getByRole('menuitem',{name:'WhatsApp'}).click();
    const requests=await page.evaluate(()=>window.__waFinanceRequests);
    assert.equal(requests.at(-1).mode,'single');
    assert.deepEqual(requests.at(-1).rowIds,['F2']);
    assert.equal(requests.at(-1).accountRole,'Lender');
  });
  await check('Finance date-range uses existing filters, not visible search rows',async()=>{
    await page.evaluate(()=>{
      document.getElementById('fplDateFrom').value='2026-10-01';
      document.getElementById('fplDateTo').value='2026-10-31';
      document.getElementById('fplLedgerSearch').value='NO MATCH';
      finPersonLedgerRenderLedger_();
    });
    await page.click('#fplSharePeriodBtn');
    const requests=await page.evaluate(()=>window.__waFinanceRequests);
    assert.equal(requests.at(-1).mode,'period');
    assert.equal(requests.at(-1).from,'2026-10-01');
    assert.equal(requests.at(-1).to,'2026-10-31');
    assert.deepEqual(requests.at(-1).rowIds,[]);
  });
  await check('Finance switching Lender to Borrower drops selected Lender rows',async()=>{
    await page.evaluate(()=>{
      document.getElementById('fplDateFrom').value='';
      document.getElementById('fplDateTo').value='';
      document.getElementById('fplLedgerSearch').value='';
      finPersonLedgerRenderSelected_();
    });
    await page.click('#fplRoleChips button[data-account-role="Borrower"]');
    const info=await page.evaluate(()=>({count:Object.keys(finPersonLedgerState.waFinanceSelected).length,
      role:finPersonLedgerState.account,ids:[...document.querySelectorAll('#fplTransactionBody tr[data-finance-id]')].map(x=>x.dataset.financeId)}));
    assert.deepEqual([info.role,info.count],['Borrower',0]);
    assert.deepEqual(info.ids,['B1']);
    assert.equal(await page.locator('#fplShareSelectedBtn').isDisabled(),true);
    await page.click('#fplShareBalanceBtn');
    const requests=await page.evaluate(()=>window.__waFinanceRequests);
    assert.equal(requests.at(-1).accountRole,'Borrower');
  });
  await check('Finance Owner role remains independent and shares only Owner rows',async()=>{
    await page.click('#fplRoleChips button[data-account-role="Owner"]');
    await page.locator('#fplTransactionBody input[data-fpl-wa-check="O1"]').check();
    await page.click('#fplShareSelectedBtn');
    const requests=await page.evaluate(()=>window.__waFinanceRequests);
    assert.deepEqual(requests.at(-1).rowIds,['O1']);
    assert.equal(requests.at(-1).accountRole,'Owner');
  });
  await check('Finance sharing controls are hidden without both permissions',async()=>{
    await page.evaluate(()=>{
      userPermissions={whatsappShare:{edit:false},finance:{view:true}};
      waFinanceUpdateUi_(finPersonLedgerState);
      finPersonLedgerRenderLedger_();
    });
    assert.equal(await page.locator('#fplShareBalanceBtn').isHidden(),true);
    assert.equal(await page.locator('#fplShareSelectedBtn').isHidden(),true);
    assert.equal(await page.locator('#fplTransactionBody input[data-fpl-wa-check]').count(),0);
  });
  await check('Finance WhatsApp browser errors',()=>assert.deepEqual(errors,[]));
  await page.close();


  // Finance Ledger all-person view: read one bound row only (no bulk share).
  for (const size of [{width:1440,height:900},{width:375,height:812}]) {
    ({page,errors}=await boot(browser,size));
    await route(page,'financeLedger');
    await page.evaluate(()=>{
      finLedState.persons=[{id:'P1',name:'Finance A',roles:['Lender','Borrower']},{id:'P2',name:'Finance B',roles:['Lender']}];
      finLedState.transactionTypes=[{key:'Loan Received',account:'loanPayable',role:'Lender',cashDirection:'in',label:'Lender Credit'}];
      finLedState.currencySymbol='৳';
      finLedState.rows=[{
        financeId:'F-1',date:'2026-10-01',personId:'P1',personKey:'id:P1',
        person:'Finance A',transactionType:'Loan Received',transactionTypeLabel:'Lender Credit',
        account:'loanPayable',accountLabel:'Lender Balance',amount:500,balance:500,
        debit:0,credit:500,referenceNo:'L-1',notes:'',paymentMethod:'Cash',createdBy:'Admin'
      }];
      window.__finLedgerShares=[];
      window.openWhatsAppShare_=(req)=>{window.__finLedgerShares.push(JSON.parse(JSON.stringify(req)));return req;};
      finLedRender_();
    });
    await check('Finance Ledger '+size.width+' guarded single-person row action',async()=>{
      await page.locator('#finLedTableBody button[data-act="menuTxn"]').click();
      // Mobile Actions is a fixed-bottom menu closed by scroll events.
      // Dispatch the actual menu item click without Playwright auto-scrolling it.
      await page.getByRole('menuitem',{name:'WhatsApp'}).dispatchEvent('click');
      const requests=await page.evaluate(()=>window.__finLedgerShares);
      assert.equal(requests.length,1);
      assert.deepEqual([requests[0].source,requests[0].entityId,requests[0].accountRole,requests[0].mode],
        ['financePerson','P1','Lender','single']);
      assert.deepEqual(requests[0].rowIds,['F-1']);
      assert.ok(requests[0].rowVersions['F-1'].includes('"loanPayable"'));
    });
    await check('Finance Ledger '+size.width+' unresolved legacy person never offered WhatsApp',async()=>{
      await page.evaluate(()=>{
        finLedState.rows[0].personId='';
        finLedState.rows[0].personKey='name:Finance A';
        finLedRender_();
      });
      await page.locator('#finLedTableBody button[data-act="menuTxn"]').click();
      assert.equal(await page.getByRole('menuitem',{name:'WhatsApp'}).count(),0);
      assert.equal((await page.evaluate(()=>window.__finLedgerShares)).length,1);
    });
    await check('Finance Ledger '+size.width+' role mismatch never offered WhatsApp',async()=>{
      await page.keyboard.press('Escape');
      await page.evaluate(()=>{
        finLedState.rows[0].personId='P1';
        finLedState.rows[0].personKey='id:P1';
        finLedState.rows[0].account='owner';
        finLedRender_();
      });
      await page.locator('#finLedTableBody button[data-act="menuTxn"]').click();
      assert.equal(await page.getByRole('menuitem',{name:'WhatsApp'}).count(),0);
      assert.deepEqual(errors,[]);
    });
    await page.close();
  }

 } finally {await browser.close();}
 console.log(`production_gate_browser: ${pass}/${pass+fail} PASS; ${pages.length} routes; MOCKED Apps Script bridge`);
 if(fail)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
