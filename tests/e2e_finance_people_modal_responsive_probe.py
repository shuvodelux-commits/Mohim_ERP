from pathlib import Path
import runpy, sys
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ns = runpy.run_path(str(ROOT / 'tests' / 'production_gate_e2e.py'), run_name='fixture')
html = ns['html']
AUTH_JS = ns['AUTH_JS']
P = F = 0

def ck(cond, name, detail=''):
    global P, F
    if cond:
        P += 1; print('PASS', name, flush=True)
    else:
        F += 1; print('FAIL', name, detail, flush=True)

def seed(page):
    page.evaluate(AUTH_JS)
    page.evaluate("""()=>{
      window.__mockOverrides.getFinanceBootstrap={
        transactionTypes:[],paymentMethods:['Cash'],bankAccounts:[],currencySymbol:'৳',today:'2026-09-16',
        persons:[],personsAll:[
          {id:'P1',name:'Mohiuddin Ahmed',phone:'01711111111',description:'Owner',type:'Owner',roles:['Owner'],status:'Active'},
          {id:'P2',name:'Sufia Apa',phone:'01822222222',description:'Primary lender',type:'Lender',roles:['Lender'],status:'Active'},
          {id:'P3',name:'Shahinoor Khatun',phone:'01933333333',description:'Family lender',type:'Lender',roles:['Lender'],status:'Active'},
          {id:'P4',name:'BRAC Bank',phone:'09612345678',description:'Business term loan',type:'Lender',roles:['Lender'],status:'Active'}
        ],
        summary:{ownerCapital:0,ownerAdvance:0,outstandingLoan:0,lenderCredit:0,borrowerReceivable:0,borrowerCredit:0}
      };
      goToPage('finance');
    }""")
    page.wait_for_timeout(250)
    page.click('#finManagePersonsBtn')
    page.locator('#finManagePersonsModal').wait_for(state='visible')
    page.wait_for_timeout(80)

def main():
    global P,F
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])

        desktop = browser.new_page(viewport={'width': 867, 'height': 850})
        desktop.set_content(html, wait_until='domcontentloaded', timeout=120000)
        seed(desktop)
        dm = desktop.locator('#finManagePersonsModal .fin-manage-people-modal')
        body = desktop.locator('#finManagePersonsModal .modal-body')
        table_wrap = desktop.locator('#finManagePersonsModal .fin-manage-table-wrap')
        metrics = desktop.evaluate("""()=>{
          const m=document.querySelector('#finManagePersonsModal .fin-manage-people-modal');
          const b=document.querySelector('#finManagePersonsModal .modal-body');
          const w=document.querySelector('#finManagePersonsModal .fin-manage-table-wrap');
          return {mw:m.getBoundingClientRect().width,bClient:b.clientWidth,bScroll:b.scrollWidth,wClient:w.clientWidth,wScroll:w.scrollWidth};
        }""")
        ck(metrics['mw'] >= 800, 'Desktop Finance People modal uses available PC width', str(metrics))
        ck(metrics['bScroll'] <= metrics['bClient'] + 1, 'Desktop modal body has no outer horizontal scroll', str(metrics))
        ck(metrics['wScroll'] <= metrics['wClient'] + 2, 'Desktop people table fits without horizontal scroll at screenshot width', str(metrics))

        desktop.set_viewport_size({'width': 513, 'height': 900})
        desktop.wait_for_timeout(120)
        mobile = desktop
        mobile_metrics = mobile.evaluate("""()=>{
          const cb=document.querySelector('#finManageRoleOwner');
          const roleRow=document.querySelector('#finManagePersonsModal .fin-person-role-row');
          const body=document.querySelector('#finManagePersonsModal .modal-body');
          const table=document.querySelector('#finManagePersonsModal .fin-manage-persons-table');
          const r=cb.getBoundingClientRect();
          return {cbW:r.width,cbH:r.height,roleDisplay:getComputedStyle(roleRow).display,bodyClient:body.clientWidth,bodyScroll:body.scrollWidth,tableW:table.getBoundingClientRect().width};
        }""")
        ck(mobile_metrics['cbW'] <= 18 and mobile_metrics['cbH'] <= 18, 'Mobile Finance roles use compact checkboxes', str(mobile_metrics))
        ck(mobile_metrics['roleDisplay'] == 'grid', 'Mobile Finance roles use three-column compact grid', str(mobile_metrics))
        ck(mobile_metrics['bodyScroll'] <= mobile_metrics['bodyClient'] + 1, 'Mobile Manage Finance People has no horizontal page scroll', str(mobile_metrics))
        ck(mobile.locator('#finManagePersonsModal .fin-manage-persons-table thead').evaluate("e=>getComputedStyle(e).display") == 'none', 'Mobile people table switches to cards')

        browser.close()
    print(f'e2e_finance_people_modal_responsive_probe: {P}/{P+F} PASS', flush=True)
    if F: sys.exit(1)

if __name__=='__main__':
    main()
