from pathlib import Path
import re, json
root=Path('.')
index=(root/'index.html').read_text()
def repl(m):
    name=m.group(1)
    return (root/(name+'.html')).read_text()
# inject mock into the original shell BEFORE include expansion so a '<body>' string in CSS/comments cannot capture it
html=index
# mocked Apps Script bridge
nav=[
 {'key':'dashboard','label':'Dashboard','icon':'dashboard'},
 {'key':'pos','label':'POS','icon':'pos'}, {'key':'counter','label':'Counter','icon':'counter'},
 {'key':'sales','label':'Sales','icon':'sales','children':[{'key':'sales','label':'Sales Invoice'},{'key':'draftSales','label':'Draft Invoices'},{'key':'returns','label':'New Return'},{'key':'returnHistory','label':'Return History','permKey':'returns'}]},
 {'key':'purchase','label':'Purchases','icon':'purchase'},
 {'key':'suppliers','label':'Suppliers','icon':'suppliers','children':[{'key':'suppliers','label':'Suppliers'},{'key':'supplierLedger','label':'Supplier Ledger','permKey':'suppliers'}]},
 {'key':'vendors','label':'Vendor','icon':'vendors','children':[{'key':'vendors','label':'Vendor Ledger'},{'key':'vendorWorkspace','label':'Vendor Workspace','permKey':'vendors'}]},
 {'key':'products','label':'Products','icon':'products'},
 {'key':'customers','label':'Customers','icon':'customers','children':[{'key':'customers','label':'Customers'},{'key':'customerLedger','label':'Customer Ledger','permKey':'customers'}]},
 {'key':'bank','label':'Bank Accounts','icon':'bank'},
 {'key':'expense','label':'Expenses','icon':'expense','children':[{'key':'expense','label':'Add Expense'},{'key':'expenseList','label':'Expense List','permKey':'expense'},{'key':'expenseCategories','label':'Expense Categories','permKey':'expense'},{'key':'expenseReports','label':'Report','permKey':'expense'}]},
 {'key':'finance','label':'Business Finance','icon':'finance','children':[{'key':'finance','label':'Business Finance'},{'key':'financeLedger','label':'Finance Ledger','permKey':'finance'}]},
 {'key':'daybook','label':'Day Book','icon':'daybook'}, {'key':'reports','label':'Reports','icon':'reports'},
 {'key':'settings','label':'Settings','icon':'settings','children':[{'key':'settings','label':'General'},{'key':'invoiceDesign','label':'Invoice Design'},{'key':'users','label':'Users'},{'key':'roles','label':'Roles'}]}
]
mock_js=f'''<script>
window.__rpcCalls=[]; window.__mockOverrides={{}};
window.__NAV={json.dumps(nav)};
window.__mockData=function(name,args){{
  if(Object.prototype.hasOwnProperty.call(window.__mockOverrides,name)){{ var v=window.__mockOverrides[name]; return typeof v==='function'?v(args):v; }}
  var D={{
    getAppShellData: {{shopName:'SherERP Test',currencySymbol:'৳',navItems:window.__NAV}},
    validateSession: {{token:'test-token',user:{{id:'USR-1',name:'Admin',mobile:'01700000000',role:'Administrator'}},allowedModules:null,permissions:null}},
    getDashboardStats: {{currencySymbol:'৳',todaySalesTotal:0,todayProfit:0,todayExpenseTotal:0,cashBalance:0,totalBankBalance:0,totalBalance:0,dueReceivable:0,supplierPayable:0,inventoryValue:0,lowStockCount:0,ownerCapital:0,outstandingLoan:0,monthSalesTotal:0,monthGrossProfit:0,monthGrossMarginPercent:0,monthExpenseTotal:0,monthProfit:0,profitCoverageWarning:0,profitCoverageTotal:0,activityAvailable:true,activity:[],topProducts:[],expenseByCategory:[],topDebtors:[],topSuppliers:[],stockAlerts:[]}},
    getPosBootstrap: {{products:[{{id:'PROD-000001',name:'4 inch Test Pipe',brand:'RFL',unit:'Feet',barcode:'12345',sellingPrice:50,autoSellingPrice:50,fallbackSellPrice:50,lotPricing:[{{qty:100,sellPrice:50}}],stock:100,category:'Pipe'}}],showPurchasePrice:false,customers:[{{id:'CUS-000001',name:'মহিউদ্দিন',phone:'01712345678',address:'চারঘাট বাজার',fatherName:'',due:288}}],vendors:[],vendorsAll:[],bankAccounts:[{{id:'BANK-1',name:'Test Bank',type:'Bank'}}],activeSession:{{sessionId:'CS-1',openedAt:'2026-09-05T10:00:00+06:00'}},shopName:'SherERP Test',currencySymbol:'৳',taxPercent:0}},
    getSalesDraftList: [],
    getCashSessionSummary: {{openedAt:'2026-09-05T10:00:00+06:00',openingCash:0,cashIn:1000,cashOut:0,expectedCash:1000,cashMismatch:null}},
    getProductsBootstrap: {{products:[],categories:[],units:[],lowStockThreshold:5}},
    getCustomersBootstrap: {{customers:[],bankAccounts:[],currencySymbol:'৳'}},
    getSuppliersBootstrap: {{suppliers:[],bankAccounts:[],currencySymbol:'৳'}},
    getPurchaseBootstrap: {{products:[],suppliers:[],bankAccounts:[],categories:[],brands:[],units:[],activeSession:{{sessionId:'CS-1'}}}},
    getSalesManagementList: [],
    getReturnHistory: [],
    getVendorsBootstrap: {{vendors:[],products:[],bankAccounts:[],currencySymbol:'৳'}},
    getVendorWorkspaceBootstrap: {{vendors:[],products:[],bankAccounts:[],currencySymbol:'৳',paymentMethods:['Cash','Bank']}},
    getBankAccountsBootstrap: {{accounts:[],currencySymbol:'৳',cashBalance:0}},
    getExpenseBootstrap: {{categories:[],payees:[],paymentAccounts:[],currencySymbol:'৳',businessDate:'2026-09-05'}},
    getExpenseList: [], getExpenseLedger: [],
    getExpenseSettingsBootstrap: {{categories:[],payees:[]}},
    getFinanceBootstrap: {{people:[],paymentAccounts:[],currencySymbol:'৳',businessDate:'2026-09-05'}},
    getFinanceLedger: [],
    getDayBookBootstrap: {{currencySymbol:'৳',businessDate:'2026-09-05'}}, getDayBookTransactions: [],
    getReportsBootstrap: {{currencySymbol:'৳',categories:[],suppliers:[],customers:[]}},
    getSalesReport: {{rows:[],totals:{{}}}}, getPurchaseReport: {{rows:[],totals:{{}}}}, getStockReport: {{rows:[],totals:{{}}}}, getProfitReport: {{rows:[],totals:{{}}}}, getCashBankReport: {{rows:[],totals:{{}}}}, getBalanceSheetReport: {{rows:[],totals:{{}}}},
    getSettingsBootstrap: {{settings:{{}},categories:[],units:[],expenseCategories:[],expensePayees:[]}},
    getInvoiceDesignBootstrap: {{settings:{{}},sampleInvoice:null}},
    getUsersBootstrap: {{users:[],roles:[]}},
    getRolesBootstrap: {{roles:[],moduleOptions:[],deleteWindowOptions:[]}},
    getCounterBootstrap: {{capabilities:{{customerReceive:true,supplierPay:true,expenseAdd:true,bankTransfer:true,customerAdd:true,supplierAdd:true}},customers:[],suppliers:[],expenseCategories:[],expensePayees:[],paymentAccounts:[],transferAccounts:[],expensePaymentMethods:['Cash'],currencySymbol:'৳',businessDate:'2026-09-05'}},
    getCustomerLedgerWorkspaceBootstrap: {{customers:[],currencySymbol:'৳'}}, getCustomerLedgerPage: {{rows:[],page:1,totalPages:1,totalRows:0}},
    getSupplierLedgerWorkspaceBootstrap: {{suppliers:[],currencySymbol:'৳'}}, getSupplierLedgerPage: {{rows:[],page:1,totalPages:1,totalRows:0}},
    completeSale: {{invoiceId:'INV-000017',date:'2026-09-05',time:'18:30:00',customerId:'CUS-000001',customerName:'মহিউদ্দিন',customerPhone:'01712345678',customerAddress:'চারঘাট বাজার',items:[{{productId:'PROD-000001',name:'4 inch Test Pipe',qty:1,unit:'Feet',unitPrice:50,lineTotal:50}}],subtotal:50,discount:0,grandTotal:50,paidAmount:0,dueAmount:50,paymentMethod:'Cash',amountInWords:'Fifty taka only',shop:{{name:'SherERP Test',address:'Test Address'}}}},
    findSalesByPhone: [{{invoiceId:'INV-000005',date:'2026-09-05',time:'18:00:00',customerName:'মহিউদ্দিন',grandTotal:750,paymentStatus:'Due',duplicateInvoiceId:true}},{{invoiceId:'INV-000017',date:'2026-09-05',time:'18:30:00',customerName:'মহিউদ্দিন',grandTotal:50,paymentStatus:'Due',duplicateInvoiceId:false}}],
    searchInvoicesForReturn: [{{invoiceId:'INV-000005',date:'2026-09-05',customerName:'মহিউদ্দিন',customerPhone:'01712345678',grandTotal:750,paymentStatus:'Due',duplicateInvoiceId:true}}],
    saveSalesDraft: {{draftId:'DR-1',draftNo:'DRAFT-2026-0017',version:1}},
    getSalesDraft: {{draftId:'DR-1',draftNo:'DRAFT-2026-0017',version:1,customerId:'CUS-000001',customerName:'মহিউদ্দিন',customerPhone:'01712345678',items:[{{productId:'PROD-000001',name:'4 inch Test Pipe',unit:'Feet',qty:1,unitPrice:50,lineTotal:50,savedPriceMode:'manual'}}],discount:0,payment:{{amountReceived:'',paymentMethod:'Cash',bankAccountId:''}}}},
    logout: true
  }};
  if(Object.prototype.hasOwnProperty.call(D,name)) return D[name];
  return [];
}};
(function(){{
  var success=null,failure=null;
  var proxy=new Proxy({{}},{{get:function(t,p){{
    if(p==='withSuccessHandler') return function(fn){{success=fn;return proxy;}};
    if(p==='withFailureHandler') return function(fn){{failure=fn;return proxy;}};
    if(p==='then') return undefined;
    return function(){{ var args=[].slice.call(arguments), s=success, f=failure; success=null; failure=null; window.__rpcCalls.push({{name:String(p),args:args}}); Promise.resolve().then(function(){{try{{var data=window.__mockData(String(p),args); if(s)s({{success:true,data:data}});}}catch(e){{if(f)f(e);}}}}); }};
  }}}});
  window.google={{script:{{run:proxy}}}};
}})();
</script>'''
html=html.replace('<body>', '<body>'+mock_js,1)
html=re.sub(r"<\?!=\s*include\('([^']+)'\);\s*\?>", repl, html)
Path('/tmp/shererp_e2e.html').write_text(html)


from playwright.sync_api import sync_playwright

PAGES = ['dashboard','pos','counter','sales','draftSales','returns','returnHistory','purchase','suppliers','supplierLedger','vendorWorkspace','vendors','products','customers','customerLedger','bank','expense','expenseList','expenseCategories','expenseReports','finance','financeLedger','daybook','reports','settings','invoiceDesign','users','roles']
AUTH_JS = "onAuthenticated_({token:'test-token',user:{id:'USR-1',name:'Admin',mobile:'017',role:'Administrator'},allowedModules:null,permissions:null})"

class Gate:
    def __init__(self):
        self.passed = 0
        self.failed = 0
    def check(self, cond, name, detail=''):
        if cond:
            self.passed += 1
            print('PASS', name)
        else:
            self.failed += 1
            print('FAIL', name, detail)


def boot(browser, viewport=None):
    page = browser.new_page(viewport=viewport or {'width':1440,'height':1000})
    errors=[]
    page.on('pageerror', lambda e: errors.append('PAGEERROR '+str(e)+' '+(e.stack or '')))
    page.on('console', lambda m: errors.append('CONSOLE '+m.type+' '+m.text) if m.type == 'error' else None)
    page.set_content(html, wait_until='domcontentloaded')
    page.evaluate(AUTH_JS)
    page.wait_for_timeout(450)
    return page, errors


def run():
    gate=Gate()
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])

        # 1) Every routed page renders without uncaught browser/console errors.
        page, errors = boot(browser)
        for key in PAGES:
            before=len(errors)
            try:
                page.evaluate('k=>goToPage(k)', key)
                page.wait_for_timeout(180)
                visible=page.eval_on_selector('#page-'+key, 'e=>!e.hidden')
                gate.check(bool(visible) and len(errors)==before, 'route '+key, '; '.join(errors[before:]))
            except Exception as exc:
                gate.check(False, 'route '+key, str(exc))
        page.close()

        # 2) POS post -> global confirmation -> exact returned invoice render.
        page, errors = boot(browser)
        page.evaluate("goToPage('pos')"); page.wait_for_timeout(350)
        gate.check(page.locator('#posProductGrid .product-tile').count() == 1, 'POS product bootstrap')
        page.locator('#posProductGrid .product-tile').first.click()
        page.fill('#posCustomerName','মহিউদ্দিন'); page.fill('#posCustomerPhone','01712345678')
        gate.check(page.text_content('#posCartCount') == '1', 'POS product added to cart')
        gate.check(not page.is_disabled('#posCompleteBtn'), 'POS complete enabled with open cash session')
        page.click('#posCompleteBtn'); page.wait_for_timeout(80)
        gate.check(not page.eval_on_selector('#confirmActionModal','e=>e.hidden') and page.text_content('#confirmActionTitle') == 'Complete Sale?', 'POS financial confirmation displayed')
        page.click('#confirmActionConfirm'); page.wait_for_timeout(500)
        invoice_text=page.text_content('#invoicePaper') or ''
        gate.check(not page.eval_on_selector('#invoiceModal','e=>e.hidden'), 'POS invoice preview opened')
        gate.check('INV-000017' in invoice_text and 'মহিউদ্দিন' in invoice_text, 'POS renders exact server-returned invoice/customer')
        calls=page.evaluate("__rpcCalls.filter(x=>x.name==='completeSale')")
        gate.check(len(calls)==1 and calls[0]['args'][1]['customerName']=='মহিউদ্দিন' and calls[0]['args'][1]['items'][0]['productId']=='PROD-000001', 'POS posts one authoritative completeSale payload')
        gate.check(not errors, 'POS flow has zero browser errors', '\n'.join(errors))
        page.close()

        # 3) Phone sales history fails closed for an already-duplicated ID.
        page, errors = boot(browser)
        page.evaluate("goToPage('pos')"); page.wait_for_timeout(300)
        page.fill('#posCustomerPhone','01712345678'); page.press('#posCustomerPhone','Escape'); page.click('#posHistoryBtn'); page.wait_for_timeout(220)
        history=page.text_content('#posHistoryBody') or ''
        dup_btn=page.locator('#posHistoryBody button[data-id="INV-000005"]')
        unique_btn=page.locator('#posHistoryBody button[data-id="INV-000017"]')
        gate.check('Duplicate ID' in history and dup_btn.count()==1 and dup_btn.is_disabled(), 'POS phone history disables duplicate invoice actions')
        gate.check(unique_btn.count()==1 and not unique_btn.is_disabled(), 'POS phone history keeps unique invoice actions enabled')
        gate.check(not errors, 'POS history has zero browser errors', '\n'.join(errors))
        page.close()

        # 4) Sales list presents both corrupted historical headers but never enables ambiguous actions.
        page, errors = boot(browser)
        page.evaluate("""window.__mockOverrides.getSalesManagementList=[
          {invoiceId:'INV-000005',date:'2026-09-05',time:'18:00:00',customerId:'C2',customerName:'মহিউদ্দিন',customerPhone:'01712345678',grandTotal:750,paidAmount:750,dueAmount:0,returnedAmount:null,netSale:null,paymentStatus:'Paid',returnStatus:'Integrity Error',editable:false,duplicateInvoiceId:true},
          {invoiceId:'INV-000005',date:'2026-08-31',time:'12:00:00',customerId:'C1',customerName:'Delowar',customerPhone:'1681487177',grandTotal:5000,paidAmount:0,dueAmount:5000,returnedAmount:null,netSale:null,paymentStatus:'Due',returnStatus:'Integrity Error',editable:false,duplicateInvoiceId:true},
          {invoiceId:'INV-000017',date:'2026-09-05',time:'18:30:00',customerId:'C2',customerName:'মহিউদ্দিন',customerPhone:'01712345678',grandTotal:50,paidAmount:0,dueAmount:50,returnedAmount:0,netSale:50,paymentStatus:'Due',returnStatus:'No Return',editable:true,duplicateInvoiceId:false}
        ];""")
        page.evaluate("goToPage('sales')"); page.wait_for_timeout(320)
        gate.check(page.locator('#smTableBody tr').count()==3 and page.locator('#smTableBody .badge-danger',has_text='Duplicate ID').count()==2, 'Sales list marks both duplicate INV-000005 rows')
        gate.check(page.locator('#smTableBody button[data-id="INV-000005"]').first.is_disabled(), 'Sales list blocks duplicate invoice actions')
        gate.check(not page.locator('#smTableBody button[data-id="INV-000017"]').is_disabled(), 'Sales list permits unique invoice actions')
        gate.check(not errors, 'Sales integrity UI has zero browser errors', '\n'.join(errors))
        page.close()

        # 5) Sales Return search never auto-loads an ambiguous duplicate invoice.
        page, errors = boot(browser)
        page.evaluate("goToPage('returns')")
        page.fill('#rtSearchInput','INV-000005'); page.click('#rtFindBtn'); page.wait_for_timeout(220)
        result=page.text_content('#rtSearchResults') or ''
        gate.check('Duplicate ID' in result and page.locator('#rtSearchResults button[data-id="INV-000005"]').is_disabled(), 'Sales Return blocks duplicate invoice Load')
        gate.check(page.evaluate("__rpcCalls.filter(x=>x.name==='getInvoiceForReturn').length") == 0, 'Sales Return does not auto-fetch ambiguous invoice')
        gate.check(not errors, 'Sales Return duplicate flow has zero browser errors', '\n'.join(errors))
        page.close()

        # 5b) Unpaid invoice return never defaults to an impossible cash payout.
        page, errors = boot(browser)
        page.evaluate("""window.__mockOverrides.getInvoiceForReturn={
          invoiceId:'INV-UNPAID',date:'2026-09-05',customerId:'CUS-000001',customerName:'মহিউদ্দিন',customerPhone:'01712345678',customerAddress:'চারঘাট বাজার',
          grandTotal:500,paidAmount:0,dueAmount:500,previouslyReturnedAmount:0,netSale:500,cashRefundAvailable:0,
          items:[{productId:'PROD-000001',name:'4 inch Test Pipe',unitPrice:50,soldQty:10,vendorSourcedQty:0,previouslyReturnedQty:0,availableQty:10}]
        };""")
        page.evaluate("goToPage('returns')"); page.wait_for_timeout(120)
        page.evaluate("returnsLoadInvoiceById_('INV-UNPAID')"); page.wait_for_timeout(220)
        cash_option = page.locator('#rtRefundMethod option[value="Cash"]')
        gate.check(cash_option.is_disabled(), 'Unpaid return disables impossible cash refund')
        gate.check(page.input_value('#rtRefundMethod') == 'Store Credit', 'Unpaid return defaults to due adjustment/store credit')
        gate.check('No cash was collected' in (page.text_content('#rtRefundHint') or ''), 'Unpaid return explains accounting-safe settlement')
        gate.check(not errors, 'Unpaid return refund UI has zero browser errors', '\n'.join(errors))
        page.close()

        # 6) Draft save is accounting-free client flow and carries exact cart state to draft RPC.
        page, errors = boot(browser)
        page.evaluate("goToPage('pos')"); page.wait_for_timeout(300)
        page.locator('#posProductGrid .product-tile').first.click()
        page.fill('#posCustomerName','মহিউদ্দিন'); page.fill('#posCustomerPhone','01712345678')
        page.click('#posSaveDraftBtn'); page.wait_for_timeout(280)
        drafts=page.evaluate("__rpcCalls.filter(x=>x.name==='saveSalesDraft')")
        completes=page.evaluate("__rpcCalls.filter(x=>x.name==='completeSale')")
        gate.check(len(drafts)==1 and drafts[0]['args'][1]['grandTotal']==50 and drafts[0]['args'][1]['items'][0]['lineTotal']==50, 'Draft save preserves cart total/line total')
        gate.check(len(completes)==0, 'Draft save does not post a sale')
        gate.check(not errors, 'Draft save has zero browser errors', '\n'.join(errors))
        page.close()

        # 7) Galaxy Tab-like portrait keeps the desktop/tablet two-column POS without overflow.
        page, errors = boot(browser, {'width':768,'height':1024})
        page.evaluate("goToPage('pos')"); page.wait_for_timeout(320)
        cols=page.eval_on_selector('#page-pos .pos-layout','e=>getComputedStyle(e).gridTemplateColumns.split(/\\s+/).filter(Boolean)')
        overflow=page.evaluate('document.documentElement.scrollWidth-document.documentElement.clientWidth')
        gate.check(1 <= len(cols) <= 2, 'Tablet POS adaptive layout renders usable columns', str(cols))
        gate.check(overflow <= 1, 'Tablet POS has no document horizontal overflow', str(overflow))
        gate.check(page.eval_on_selector('#app',"e=>e.classList.contains('sidebar-collapsed')"), 'Tablet shell collapses sidebar to icon rail')
        gate.check(not errors, 'Tablet POS has zero browser errors', '\n'.join(errors))
        page.close()

        browser.close()

    total=gate.passed+gate.failed
    print(f'production_gate_e2e: {gate.passed}/{total} PASS')
    if gate.failed:
        raise SystemExit(1)

if __name__=='__main__':
    run()
