from pathlib import Path
import runpy, sys, time
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

def rpc(page, name):
    return page.evaluate("n=>__rpcCalls.filter(x=>x.name===n)", name)

def confirm(page):
    btn = page.locator('#confirmActionConfirm')
    btn.wait_for(state='visible')
    btn.click()
    page.wait_for_timeout(220)

def main():
    global P, F
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        page = browser.new_page(viewport={'width': 1440, 'height': 1000})
        page.set_default_timeout(10000)
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.set_content(html, wait_until='domcontentloaded', timeout=120000)
        page.evaluate(AUTH_JS)
        page.wait_for_timeout(250)

        page.evaluate("""()=>{
          var types=[
            {key:'Owner Investment',label:'Owner Credit',account:'owner',balanceEffect:1,cashDirection:'in',role:'Owner',isOpening:false},
            {key:'Owner Withdrawal',label:'Owner Debit',account:'owner',balanceEffect:-1,cashDirection:'out',role:'Owner',isOpening:false},
            {key:'Loan Received',label:'Lender Credit',account:'loanPayable',balanceEffect:1,cashDirection:'in',role:'Lender',isOpening:false},
            {key:'Loan Repayment',label:'Lender Debit',account:'loanPayable',balanceEffect:-1,cashDirection:'out',role:'Lender',isOpening:false},
            {key:'Borrower Loan',label:'Borrower Debit',account:'borrowerReceivable',balanceEffect:1,cashDirection:'out',role:'Borrower',isOpening:false},
            {key:'Borrower Repayment',label:'Borrower Credit',account:'borrowerReceivable',balanceEffect:-1,cashDirection:'in',role:'Borrower',isOpening:false},
            {key:'Opening Owner Capital',label:'Opening Owner Capital',account:'owner',balanceEffect:1,cashDirection:'none',role:'Owner',isOpening:true},
            {key:'Opening Loan',label:'Opening Loan',account:'loanPayable',balanceEffect:1,cashDirection:'none',role:'Lender',isOpening:true},
            {key:'Opening Borrower Loan',label:'Opening Borrower Loan',account:'borrowerReceivable',balanceEffect:1,cashDirection:'none',role:'Borrower',isOpening:true}
          ];
          var people=[
            {id:'P1',name:'BRAC Person',phone:'০১৭১২৩৪৫৬৭৮',description:'Main business lender',type:'Lender',roles:['Lender','Borrower'],status:'Active'},
            {id:'P2',name:'Other Lender',phone:'01800000000',description:'Secondary lender',type:'Lender',roles:['Lender'],status:'Active'}
          ];
          for(var i=3;i<=25;i++) people.push({id:'P'+i,name:'Finance Person '+i,phone:'017000000'+String(i).padStart(2,'0'),description:'Historical finance person '+i,type:'Lender',roles:['Lender'],status:i===25?'Inactive':'Active'});
          window.__mockOverrides.getFinanceBootstrap={
            transactionTypes:types,paymentMethods:['Cash','Bank','Mobile Banking'],bankAccounts:[{id:'B1',name:'Bank One',type:'Bank'}],
            persons:people,personsAll:people,currencySymbol:'৳',today:'2026-09-15',
            summary:{ownerCapital:0,ownerAdvance:0,outstandingLoan:580,lenderCredit:0,borrowerReceivable:30,borrowerCredit:0},
            ownerCapital:0,outstandingLoan:580
          };
          window.__mockOverrides.getFinanceLedger=function(args){
            var f=args[1]||{};
            if(f.personId==='P1') return {
              rows:[{financeId:'FIN-1',date:'2026-09-10',transactionType:'Loan Received',transactionTypeLabel:'Lender Credit',account:'loanPayable',accountLabel:'Lender Balance',personId:'P1',person:'BRAC Person',paymentMethod:'Cash',bankAccountId:'',bankAccountName:'',amount:80,debit:0,credit:80,balance:80,referenceNo:'R1',notes:'',createdBy:'Admin'}],
              summary:{ownerCapital:0,ownerAdvance:0,outstandingLoan:80,lenderCredit:0,borrowerReceivable:30,borrowerCredit:0},
              selectedPerson:people[0],currencySymbol:'৳',transactionTypes:types
            };
            return {rows:[],summary:{ownerCapital:0,ownerAdvance:0,outstandingLoan:580,lenderCredit:0,borrowerReceivable:30,borrowerCredit:0},selectedPerson:null,currencySymbol:'৳',transactionTypes:types};
          };
          window.__mockOverrides.getFinanceTransactionForEdit={financeId:'FIN-1',date:'2026-09-10',transactionType:'Loan Received',personId:'P1',paymentMethod:'Cash',bankAccountId:'',amount:80,referenceNo:'R1',notes:''};
          window.__mockOverrides.updateFinanceTransaction={id:'FIN-1'};
          window.__mockOverrides.addFinancePerson={id:'P26',roles:['Lender']};
          window.__mockOverrides.updateFinancePerson=function(args){ var p=args[2]||{}; return {id:args[1],name:p.name,type:(p.roles||[])[0]||'Lender',roles:p.roles||['Lender'],phone:p.phone||'',description:p.description||'',status:'Active'}; };
          __rpcCalls=[];
          goToPage('financeLedger');
        }""")
        page.wait_for_timeout(400)

        page.focus('#finLedPersonSearch')
        page.wait_for_timeout(120)
        ck(page.locator('#finLedPersonResults .combo-option').count() == 25, 'Finance person combobox opens the complete people master list on focus')
        ck(page.get_attribute('#finLedPersonSearch', 'aria-expanded') == 'true', 'Finance person combobox exposes expanded state when dropdown is open')
        page.fill('#finLedPersonSearch', 'BRAC')
        page.wait_for_timeout(120)
        ck(page.locator('#finLedPersonResults .combo-option').count() == 1, 'Finance person search is bounded to matching result')
        page.locator('#finLedPersonResults .combo-option').first.click()
        page.wait_for_timeout(260)
        ledger_calls = rpc(page, 'getFinanceLedger')
        ck(any((c['args'][1] or {}).get('personId') == 'P1' for c in ledger_calls), 'Finance ledger RPC carries selected person id')
        ck('80' in (page.text_content('#finLedLoan') or '') and '30' in (page.text_content('#finLedBorrowerReceivable') or ''), 'Selected person cards use complete person summary')
        ck(not page.locator('#finLedSelectedPersonCard').get_attribute('hidden'), 'Selected person balance card is visible after selecting a person')
        selected_card = page.text_content('#finLedSelectedPersonCard') or ''
        ck('BRAC Person' in selected_card and 'Outstanding Loan' in selected_card and '80' in selected_card and 'Borrower Receivable' in selected_card and '30' in selected_card, 'Selected person card shows complete-history relationship balances')

        ck(page.locator('#finLedPersonToggle').count() == 1, 'Finance person combobox has an explicit dropdown toggle')
        if page.locator('#finLedPersonToggle').count():
            page.click('#finLedPersonToggle')
            page.wait_for_timeout(80)
            ck(page.locator('#finLedPersonResults .combo-option').count() == 25, 'Finance person dropdown toggle opens all people even after a selection')
            page.keyboard.press('Escape')

        page.evaluate("finLedOpenEdit_('FIN-1')")
        page.locator('#finLedEditModal').wait_for(state='visible')
        page.evaluate("()=>{var s=document.getElementById('finLedEditType');s.value='Opening Borrower Loan';s.dispatchEvent(new Event('change',{bubbles:true}));}")
        page.wait_for_timeout(80)
        ck(page.eval_on_selector('#finLedEditPaymentRow', "e=>getComputedStyle(e).display==='none'"), 'Opening edit hides payment controls')
        ck(page.input_value('#finLedEditPerson') == 'P1', 'Multi-role person remains selected across lender to borrower edit')

        page.evaluate("__rpcCalls=[]")
        page.click('#finLedEditSaveBtn')
        page.locator('#confirmActionModal').wait_for(state='visible')
        ck(len(rpc(page, 'updateFinanceTransaction')) == 0, 'Finance edit performs no write before confirmation')
        ck('no Cash/Bank movement' in (page.text_content('#confirmActionModal') or ''), 'Opening confirmation states non-cash behavior')
        confirm(page)
        calls = rpc(page, 'updateFinanceTransaction')
        payload = calls[0]['args'][2] if calls else {}
        ck(len(calls) == 1 and calls[0]['args'][1] == 'FIN-1', 'Finance edit posts captured transaction id once')
        ck(payload.get('transactionType') == 'Opening Borrower Loan' and payload.get('personId') == 'P1' and payload.get('paymentMethod') == '' and payload.get('bankAccountId') == '' and str(payload.get('amount')) == '80', 'Finance edit exact confirmed opening payload')
        page.evaluate("goToPage('finance')")
        page.wait_for_timeout(260)
        group_headers = page.eval_on_selector_all('#finType option.fin-type-group-header', "els=>els.map(e=>e.textContent.trim())")
        ck(len(group_headers) == 4 and all(name in group_headers[i] for i, name in enumerate(['Lender','Borrower','Owner','Opening Balance'])), 'Business Finance type dropdown groups Lender Borrower Owner and Opening in approved order')
        ck(page.locator('#finType option[data-fin-type-separator]').count() == 4, 'Business Finance type dropdown uses compact horizontal group headers')
        options_text = page.eval_on_selector_all('#finType option', "els=>els.map(e=>e.textContent).join(' | ')")
        option_values = page.eval_on_selector_all('#finType option:not([disabled])', "els=>els.map(e=>e.value)")
        ck(option_values.index('Borrower Repayment') < option_values.index('Borrower Loan'), 'Borrower Credit renders above Borrower Debit')
        ck('Lender Credit' in options_text and 'Lender Debit' in options_text and 'Borrower Credit' in options_text and 'Borrower Debit' in options_text and 'Owner Credit' in options_text and 'Owner Debit' in options_text, 'Business Finance type dropdown shows approved debit-credit display labels')
        ck('ঋণদাতা হতে গ্রহণ' in options_text and 'ঋণদাতাকে প্রদান' in options_text and 'ঋণগ্রহীতা হতে গ্রহণ' in options_text and 'ঋণগ্রহীতাকে প্রদান' in options_text, 'Business Finance type dropdown shows approved Bangla descriptions')
        ck('প্রারম্ভিক মালিক মূলধন' in options_text and 'প্রারম্ভিক ঋণ' in options_text and 'প্রারম্ভিক ঋণগ্রহীতা ঋণ' in options_text, 'Business Finance opening types show Bangla descriptions')

        page.click('#finManagePersonsBtn')
        page.locator('#finManagePersonsModal').wait_for(state='visible')
        ck(page.locator('#finManageNewPhone').count() == 1 and page.locator('#finManageNewDescription').count() == 1, 'Finance Person create form includes phone and description')
        page.fill('#finManageNewName', 'New Lender')
        page.fill('#finManageNewPhone', '01911111111')
        page.fill('#finManageNewDescription', 'New finance lender description')
        page.check('#finManageRoleLender')
        page.evaluate('__rpcCalls=[]')
        page.click('#finManageAddBtn')
        page.wait_for_timeout(220)
        add_calls = rpc(page, 'addFinancePerson')
        add_payload = add_calls[0]['args'][1] if add_calls else {}
        ck(len(add_calls) == 1 and add_payload.get('name') == 'New Lender' and add_payload.get('phone') == '01911111111' and add_payload.get('description') == 'New finance lender description' and add_payload.get('roles') == ['Lender'], 'Finance Person create RPC carries name phone description and role')

        page.locator('#finManageBody button[data-act="edit"][data-id="P26"]').click()
        page.locator('#finEditPersonModal').wait_for(state='visible')
        ck(page.input_value('#finEditPersonPhone') == '01911111111' and page.input_value('#finEditPersonDescription') == 'New finance lender description', 'Finance Person edit form loads phone and description')
        page.fill('#finEditPersonName', 'Updated Lender')
        page.fill('#finEditPersonPhone', '01822222222')
        page.fill('#finEditPersonDescription', 'Updated finance person description')
        page.check('#finEditRoleBorrower')
        page.evaluate('__rpcCalls=[]')
        page.click('#finEditPersonSaveBtn')
        page.locator('#confirmActionModal').wait_for(state='visible')
        ck(len(rpc(page, 'updateFinancePerson')) == 0, 'Finance Person edit performs no write before confirmation')
        confirm(page)
        page.wait_for_function("()=>__rpcCalls.some(x=>x.name==='updateFinancePerson')")
        person_update_calls = rpc(page, 'updateFinancePerson')
        person_payload = person_update_calls[0]['args'][2] if person_update_calls else {}
        ck(len(person_update_calls) == 1 and person_update_calls[0]['args'][1] == 'P26' and person_payload.get('name') == 'Updated Lender' and person_payload.get('phone') == '01822222222' and person_payload.get('description') == 'Updated finance person description' and person_payload.get('roles') == ['Lender','Borrower'], 'Finance Person edit posts exact confirmed master-data payload')

        ck(not errors, 'Finance multibalance E2E zero uncaught page errors', ' | '.join(errors))
        browser.close()

    print(f'e2e_finance_multibalance_probe: {P}/{P+F} PASS', flush=True)
    if F: sys.exit(1)

if __name__ == '__main__':
    main()
