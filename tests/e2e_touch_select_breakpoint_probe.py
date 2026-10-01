from pathlib import Path
import runpy, sys
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ns = runpy.run_path(str(ROOT / 'tests' / 'production_gate_e2e.py'), run_name='fixture')
html = ns['html']; AUTH_JS = ns['AUTH_JS']
P = F = 0

def ck(cond, name, detail=''):
    global P, F
    if cond:
        P += 1; print('PASS', name, flush=True)
    else:
        F += 1; print('FAIL', name, detail, flush=True)

def seed(page):
    page.evaluate("""()=>{
      window.__mockOverrides.getFinanceBootstrap={
        transactionTypes:[
          {key:'Loan Received',label:'Lender Credit',account:'loanPayable',balanceEffect:1,cashDirection:'in',role:'Lender',isOpening:false},
          {key:'Loan Repayment',label:'Lender Debit',account:'loanPayable',balanceEffect:-1,cashDirection:'out',role:'Lender',isOpening:false}
        ], paymentMethods:['Cash'], bankAccounts:[], currencySymbol:'৳', today:'2026-09-16',
        persons:[{id:'P1',name:'Mohiuddin Ahmed',phone:'0171',roles:['Lender'],type:'Lender',status:'Active'}],
        personsAll:[{id:'P1',name:'Mohiuddin Ahmed',phone:'0171',roles:['Lender'],type:'Lender',status:'Active'}],
        summary:{ownerCapital:0,ownerAdvance:0,outstandingLoan:0,lenderCredit:0,borrowerReceivable:0,borrowerCredit:0}
      };
      window.__mockOverrides.getExpenseBootstrap={
        categories:[{id:'C1',name:'Owner'},{id:'C2',name:'Rent'}],
        payees:[{id:'E1',name:'Belal',phone:'01772744716'},{id:'E2',name:'Mohiuddin Ahmed',phone:''}],
        bankAccounts:[], currencySymbol:'৳'
      };
    }""")

def open_and_title(page, page_key, select_id):
    page.evaluate("k=>goToPage(k)", page_key)
    page.wait_for_timeout(300)
    page.locator(f'#{select_id} + .touch-select-trigger').click()
    page.wait_for_timeout(60)
    return page.locator('#touchSelectMenuGlobal')

def main():
    global P, F
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        page = browser.new_page(viewport={'width':513,'height':900}, has_touch=True, is_mobile=False)
        page.set_default_timeout(10000)
        page.set_content(html, wait_until='domcontentloaded', timeout=120000)
        page.evaluate(AUTH_JS); seed(page)

        for page_key, select_id, label in [
            ('finance','finType','Transaction Type'),
            ('finance','finPerson','Finance Person'),
            ('expense','expCategory','Expense Category'),
            ('expense','expPayee','Payee')
        ]:
            menu = open_and_title(page, page_key, select_id)
            ck(menu.get_attribute('data-mode') == 'mobile', f'{select_id} uses mobile sheet below 600px')
            title = menu.locator('.touch-select-sheet-title').text_content() or ''
            ck(title.strip() == label, f'{select_id} mobile header uses human label', title)
            page.locator('.touch-select-sheet-close').click()

        page.set_viewport_size({'width':800,'height':700})
        page.wait_for_timeout(150)
        for page_key, select_id in [('finance','finType'),('finance','finPerson'),('expense','expCategory'),('expense','expPayee')]:
            menu = open_and_title(page, page_key, select_id)
            ck(menu.get_attribute('data-mode') == 'tablet', f'{select_id} uses anchored tablet mode at 800px')
            ck(menu.locator('.touch-select-sheet-head').count() == 0, f'{select_id} tablet dropdown has no mobile sheet header')
            mb = menu.bounding_box(); tb = page.locator(f'#{select_id} + .touch-select-trigger').bounding_box()
            ck(bool(mb and tb and abs(mb['x'] - tb['x']) < 40), f'{select_id} tablet dropdown is anchored to field', str((mb,tb)))
            page.keyboard.press('Escape')

        page.set_viewport_size({'width':600,'height':700})
        page.wait_for_timeout(150)
        menu = open_and_title(page, 'expense', 'expCategory')
        ck(menu.get_attribute('data-mode') == 'tablet', '600px exact boundary uses tablet anchored dropdown')
        page.keyboard.press('Escape')
        page.set_viewport_size({'width':599,'height':700})
        page.wait_for_timeout(150)
        menu = open_and_title(page, 'expense', 'expCategory')
        ck(menu.get_attribute('data-mode') == 'mobile', '599px stays mobile bottom-sheet dropdown')

        browser.close()

    print(f'e2e_touch_select_breakpoint_probe: {P}/{P+F} PASS', flush=True)
    if F: sys.exit(1)

if __name__ == '__main__': main()
