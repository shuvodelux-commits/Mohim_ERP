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
def confirm(p):p.evaluate("document.getElementById('confirmActionConfirm').click()");p.wait_for_timeout(220)

def main():
 global P,F
 with sync_playwright() as pw:
  b=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox']);p=b.new_page(viewport={'width':1440,'height':1000});p.set_default_timeout(10000);errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
  t=time.time();p.set_content(html,wait_until='domcontentloaded',timeout=120000);print('boot',time.time()-t,flush=True);p.evaluate(AUTH_JS);p.wait_for_timeout(250)
  p.evaluate("""__rpcCalls=[];window.__mockOverrides.transferBetweenBankAccounts={};window.__mockOverrides.addBankManualEntry={};goToPage('bank');""");p.wait_for_timeout(250)
  p.evaluate("""()=>{var f=document.getElementById('bnkTransferFrom'),t=document.getElementById('bnkTransferTo');f.innerHTML='<option value="B1">Bank One</option><option value="B2">Bank Two</option>';t.innerHTML='<option value="B1">Bank One</option><option value="B2">Bank Two</option>';f.value='B1';t.value='B2';document.getElementById('bnkTransferAmount').value='500';document.getElementById('bnkTransferNotes').value='E2E';}""");p.evaluate("document.getElementById('bnkTransferBtn').click()");p.locator('#confirmActionModal').wait_for(state='visible');ck(len(rpc(p,'transferBetweenBankAccounts'))==0,'Bank transfer no write before confirm');confirm(p);calls=rpc(p,'transferBetweenBankAccounts');ck(len(calls)==1 and calls[0]['args'][1]['fromAccountId']=='B1' and calls[0]['args'][1]['toAccountId']=='B2' and str(calls[0]['args'][1]['amount'])=='500','Bank transfer exact payload')
  p.evaluate("""__rpcCalls=[];()=>{}""");p.evaluate("""()=>{var a=document.getElementById('bnkManAccount');a.innerHTML='<option value="B1">Bank One</option>';a.value='B1';document.getElementById('bnkManAmount').value='120';document.getElementById('bnkManDate').value='2026-09-08';document.getElementById('bnkManReference').value='REF-E2E';}""");p.evaluate("document.getElementById('bnkManSaveBtn').click()");p.locator('#confirmActionModal').wait_for(state='visible');ck(len(rpc(p,'addBankManualEntry'))==0,'Manual bank entry no write before confirm');confirm(p);calls=rpc(p,'addBankManualEntry');ck(len(calls)==1 and calls[0]['args'][1]['bankAccountId']=='B1' and str(calls[0]['args'][1]['amount'])=='120','Manual bank entry exact payload')
  p.evaluate("goToPage('finance');__rpcCalls=[];window.__mockOverrides.addFinanceTransaction={ownerCapital:1000,outstandingLoan:0};");p.wait_for_timeout(250)
  p.evaluate("""()=>{var person=document.getElementById('finPerson');person.innerHTML='<option value="FP1">Owner</option>';person.value='FP1';document.getElementById('finAmount').value='1000';document.getElementById('finPaymentMethod').value='Cash';document.getElementById('finDate').value=finToday_();document.getElementById('finReferenceNo').value='CAP-E2E';}""");p.evaluate("document.getElementById('finSaveBtn').click()");p.locator('#confirmActionModal').wait_for(state='visible');ck(len(rpc(p,'addFinanceTransaction'))==0,'Finance no write before confirm');confirm(p);calls=rpc(p,'addFinanceTransaction');ck(len(calls)==1 and calls[0]['args'][1]['personId']=='FP1' and str(calls[0]['args'][1]['amount'])=='1000','Finance exact payload')
  ck(not errors,'Bank/Finance E2E zero uncaught page errors',' | '.join(errors));b.close()
 print(f'e2e_bank_finance_probe: {P}/{P+F} PASS',flush=True)
 if F:sys.exit(1)
if __name__=='__main__':main()
