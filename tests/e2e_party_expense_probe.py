from pathlib import Path
import runpy,time,sys
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
ns=runpy.run_path(str(ROOT/'tests'/'production_gate_e2e.py'),run_name='fixture');html=ns['html'];AUTH_JS=ns['AUTH_JS']
P=F=0

def ck(c,n,d=''):
 global P,F
 if c:P+=1;print('PASS',n,flush=True)
 else:F+=1;print('FAIL',n,d,flush=True)
def rpc(p,n):return p.evaluate("n=>__rpcCalls.filter(x=>x.name===n)",n)
def confirm(p):p.evaluate("document.getElementById('confirmActionConfirm').click()");p.wait_for_timeout(250)

def main():
 global P,F
 with sync_playwright() as pw:
  b=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox']);p=b.new_page(viewport={'width':1440,'height':1000});p.set_default_timeout(10000);errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
  t=time.time();p.set_content(html,wait_until='domcontentloaded',timeout=120000);print('boot',time.time()-t,flush=True);p.evaluate(AUTH_JS);p.wait_for_timeout(250)
  # Expense edit.
  p.evaluate("""window.__mockOverrides.getExpenseList=[];window.__mockOverrides.getExpenseBootstrap={categories:[{id:'CAT-1',name:'Rent'}],payees:[{id:'PAY-1',name:'Landlord'}],paymentAccounts:[],currencySymbol:'৳',businessDate:'2026-09-08'};window.__mockOverrides.getExpenseDetail={'Expense ID':'EXP-1','Date':'2026-09-08','Status':'Active','Category ID':'CAT-1','Category Name':'Rent','Ledger ID':'PAY-1','Ledger Name':'Landlord','Amount':100,'Payment Method':'Cash','Bank Account ID':'','Reference No':'','Description':'Rent','Notes':''};window.__mockOverrides.updateExpense=true;__rpcCalls=[];goToPage('expenseList');""");p.wait_for_timeout(350);p.evaluate("expListState.categories=[{id:'CAT-1',name:'Rent'}];expListState.payees=[{id:'PAY-1',name:'Landlord'}];expListState.bankAccounts=[];expOpenEdit_('EXP-1')");p.locator('#expEditModal').wait_for(state='visible');p.fill('#expEditAmount','125');p.evaluate("document.getElementById('expEditSaveBtn').click()");p.locator('#confirmActionModal').wait_for(state='visible');ck(len(rpc(p,'updateExpense'))==0,'Expense no write before confirm');p.evaluate("expListState.editingId='WRONG'");confirm(p);calls=rpc(p,'updateExpense');ck(len(calls)==1 and calls[0]['args'][1]=='EXP-1','Expense freezes correct ID');ck(str(calls[0]['args'][2]['amount'])=='125','Expense exact edited amount')
  # Customer ledger search and receive payment.
  p.evaluate("goToPage('customerLedger')");p.wait_for_timeout(250);ck(p.evaluate("!!customerLedgerState.partyCombo"),'Customer ledger combobox initialized')
  p.evaluate("customerLedgerState.parties=[{id:'C1',name:'রিপন সরকার',phone:'01754551449',address:'শ্রীপুর',balance:1000,advance:0,status:'Active',canPay:true},{id:'C2',name:'Delowar',phone:'01681487177',address:'',balance:0,advance:0,status:'Active',canPay:true}];customerLedgerState.partyCombo.clear();")
  q=p.locator('#customerLedgerSelector');q.click();p.wait_for_timeout(60);ck(p.locator('#customerLedgerPartyResults').is_hidden(),'Customer blank search closed');q.fill('৫১৪৪৯');p.wait_for_timeout(80);ck(p.locator('#customerLedgerPartyResults .combo-option').count()==1 and 'রিপন' in (p.text_content('#customerLedgerPartyResults') or ''),'Customer Bangla phone search')
  p.evaluate("""customerLedgerState.party={id:'C1',name:'রিপন সরকার',phone:'01754551449',balance:1000,advance:0,status:'Active',canPay:true};customerLedgerState.partyId='C1';customerLedgerState.bankAccounts=[];window.__mockOverrides.receivePayment={};window.__mockOverrides.getCustomerPaymentContext={currentDue:1000,computedNetDue:1000,customerCredit:0,invoices:[]};__rpcCalls=[];customerLedgerRender_();""");p.evaluate("document.getElementById('customerLedgerReceiveBtn').click()");p.fill('#customerLedgerPayAmount','300');p.evaluate("document.getElementById('customerLedgerPaySaveBtn').click()");p.locator('#confirmActionModal').wait_for(state='visible');p.evaluate("customerLedgerState.partyId='WRONG'");confirm(p);calls=rpc(p,'receivePayment');ck(len(calls)==1 and calls[0]['args'][1]=='C1','Customer payment freezes customer ID')
  # Supplier ledger search and payment.
  p.evaluate("goToPage('supplierLedger')");p.wait_for_timeout(250);ck(p.evaluate("!!supplierLedgerState.partyCombo"),'Supplier ledger combobox initialized')
  p.evaluate("supplierLedgerState.parties=[{id:'S1',name:'Karatoa',phone:'01711112889',address:'',balance:1000,status:'Active',canPay:true},{id:'S2',name:'Matador',phone:'01800000000',address:'',balance:500,status:'Active',canPay:true}];supplierLedgerState.partyCombo.clear();")
  q=p.locator('#supplierLedgerSelector');q.click();p.wait_for_timeout(60);ck(p.locator('#supplierLedgerPartyResults').is_hidden(),'Supplier blank search closed');q.fill('12889');p.wait_for_timeout(80);ck(p.locator('#supplierLedgerPartyResults .combo-option').count()==1 and 'Karatoa' in (p.text_content('#supplierLedgerPartyResults') or ''),'Supplier phone search')
  p.evaluate("""supplierLedgerState.party={id:'S1',name:'Karatoa',phone:'01711112889',balance:1000,status:'Active',canPay:true};supplierLedgerState.partyId='S1';supplierLedgerState.bankAccounts=[];window.__mockOverrides.paySupplier={};__rpcCalls=[];supplierLedgerRender_();""");p.evaluate("document.getElementById('supplierLedgerMakePaymentBtn').click()");p.fill('#supplierLedgerPayAmount','250');p.evaluate("document.getElementById('supplierLedgerPaySaveBtn').click()");p.locator('#confirmActionModal').wait_for(state='visible');p.evaluate("supplierLedgerState.partyId='WRONG'");confirm(p);calls=rpc(p,'paySupplier');ck(len(calls)==1 and calls[0]['args'][1]=='S1','Supplier payment freezes supplier ID')
  ck(not errors,'Party/Expense E2E zero uncaught page errors',' | '.join(errors));b.close()
 print(f'e2e_party_expense_probe: {P}/{P+F} PASS',flush=True)
 if F:sys.exit(1)
if __name__=='__main__':main()
