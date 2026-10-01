from pathlib import Path
import runpy,time,sys
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
ns=runpy.run_path(str(ROOT/'tests'/'production_gate_e2e.py'),run_name='fixture'); html=ns['html']; AUTH_JS=ns['AUTH_JS']
P=F=0
def ck(c,n,d=''):
 global P,F
 if c: P+=1; print('PASS',n,flush=True)
 else: F+=1; print('FAIL',n,d,flush=True)
def rpc(p,n): return p.evaluate("n=>__rpcCalls.filter(x=>x.name===n)",n)
def main():
 global P,F
 with sync_playwright() as pw:
  b=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  p=b.new_page(viewport={'width':1440,'height':1000}); p.set_default_timeout(10000); errors=[]; p.on('pageerror',lambda e:errors.append(str(e)))
  t=time.time(); p.set_content(html,wait_until='domcontentloaded',timeout=120000); print('boot',time.time()-t,flush=True); p.evaluate(AUTH_JS); p.wait_for_timeout(250)
  p.evaluate("""window.__mockOverrides.getExpenseBootstrap={categories:[{id:'CAT-1',name:'Rent'}],payees:[{id:'P1',name:'Landlord',phone:'0171'}],bankAccounts:[],currencySymbol:'৳'};
  window.__mockOverrides.getExpenseLedger={rows:[{expenseId:'EXP-1',date:'2026-09-15',payeeId:'P1',payeeName:'Landlord',categoryId:'CAT-1',category:'Rent',description:'Office rent',paymentMethod:'Cash',amount:100,status:'Active',runningTotal:100,createdBy:'Admin'}],totalExpense:100,filteredTotal:100,categories:[{id:'CAT-1',name:'Rent'}],payees:[{id:'P1',name:'Landlord'}],paymentMethods:['Cash'],currencySymbol:'৳'}; __rpcCalls=[]; goToPage('expenseList');""")
  p.wait_for_timeout(350)
  ck(p.text_content('#expHistTotal')=='৳100','Expense History total card')
  ck(p.text_content('#expHistFilteredTotal')=='৳100','Expense History filtered card')
  ck(p.text_content('#expHistCount')=='1','Expense History entry count')
  ck('100' in (p.text_content('#expListTableBody') or ''),'Expense History renders running total row')

  p.evaluate("""window.__mockOverrides.getExpensePayeesManagement=[{id:'P1',name:'Landlord',phone:'0171',notes:'Rent',status:'Active'},{id:'P2',name:'Utility',phone:'0181',notes:'Power',status:'Inactive'}];
  window.__mockOverrides.updateExpensePayee={}; window.__mockOverrides.setExpensePayeeStatus={}; window.__mockOverrides.deleteExpensePayee={}; __rpcCalls=[]; goToPage('expense');""")
  p.wait_for_timeout(250); p.click('#expManagePayeesBtn'); p.locator('#expPayeeManageModal').wait_for(state='visible')
  ck(p.locator('#expPayeeManageBody tr').count()==2,'Manage Payees lists active and inactive')
  p.locator('#expPayeeManageBody button[data-id="P1"]').click(); p.locator('#rowActionMenuGlobal button[data-row-action="edit"]').click(); p.locator('#expPayeeEditModal').wait_for(state='visible')
  p.fill('#expPayeeEditName','Property Owner'); p.click('#expPayeeEditSaveBtn'); p.wait_for_timeout(250)
  calls=rpc(p,'updateExpensePayee'); ck(len(calls)==1 and calls[0]['args'][1]=='P1' and calls[0]['args'][2]['name']=='Property Owner','Payee edit exact RPC')
  p.evaluate("__rpcCalls=[]"); p.locator('#expPayeeManageBody button[data-id="P2"]').click(); p.locator('#rowActionMenuGlobal button[data-row-action="toggle"]').click(); p.wait_for_timeout(250)
  calls=rpc(p,'setExpensePayeeStatus'); ck(len(calls)==1 and calls[0]['args'][1]=='P2' and calls[0]['args'][2]=='Active','Payee activate exact RPC')
  ck(not errors,'Expense Payee/History E2E zero uncaught page errors',' | '.join(errors))
  b.close()
 print(f'e2e_expense_payee_history_probe: {P}/{P+F} PASS',flush=True)
 if F: sys.exit(1)
if __name__=='__main__': main()
