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

def setup(p):
 p.evaluate("""window.__mockOverrides.getPurchaseBootstrap={products:[{id:'PROD-000001',name:'4 inch Test Pipe',category:'Pipe',brand:'RFL',unit:'pcs',stock:100,purchasePrice:40,sellingPrice:50}],suppliers:[{id:'SUP-OLD',name:'Matador'},{id:'SUP-NEW',name:'Karatoa'}],bankAccounts:[],categories:['Pipe'],brands:['RFL'],units:['pcs'],currencySymbol:'৳',activeSession:{sessionId:'CS-1'}};window.__mockOverrides.getPurchaseManagementList=[];window.__mockOverrides.createPurchase={purchaseId:'PUR-NEW-1'};window.__mockOverrides.updatePurchase={purchaseId:'PUR-000005'};__rpcCalls=[];goToPage('purchase');purLoad();""");p.wait_for_timeout(600)

def set_supplier(p,id):p.evaluate("id=>{var s=document.getElementById('purSupplier');s.value=id;s.dispatchEvent(new Event('change',{bubbles:true}));}",id)

def main():
 global P,F
 with sync_playwright() as pw:
  b=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox']);p=b.new_page(viewport={'width':1440,'height':1000});p.set_default_timeout(10000);errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
  t=time.time();p.set_content(html,wait_until='domcontentloaded',timeout=120000);print('boot',time.time()-t,flush=True);p.evaluate(AUTH_JS);p.wait_for_timeout(250);setup(p)
  # New purchase.
  p.evaluate("purState.cart=[{productId:'PROD-000001',name:'4 inch Test Pipe',qty:2,unitPrice:40,sellingPrice:50}];purRenderLines_();document.getElementById('purDate').value=purToday_();document.getElementById('purPaidAmount').value='0';document.getElementById('purDiscount').value='0';")
  set_supplier(p,'SUP-NEW');p.evaluate("document.getElementById('purSubmitBtn').click()");p.locator('#confirmActionModal').wait_for(state='visible');ck(len(rpc(p,'createPurchase'))==0,'Purchase create no write before confirm');ck('Karatoa' in (p.text_content('#confirmActionModal') or ''),'Purchase create confirmation shows selected supplier');confirm(p);calls=rpc(p,'createPurchase');ck(len(calls)==1 and calls[0]['args'][1]['supplierId']=='SUP-NEW' and calls[0]['args'][1]['items'][0]['productId']=='PROD-000001','Purchase create exact payload',str(calls))
  # Update supplier and freeze target ID.
  p.evaluate("__rpcCalls=[];purPopulateUpdateForm_({purchaseId:'PUR-000005',supplierId:'SUP-OLD',supplierName:'Matador',date:'2026-09-08',notes:'',discount:0,paidAmount:0,paymentMethod:'Cash',bankAccountId:'',items:[{productId:'PROD-000001',name:'4 inch Test Pipe',qty:2,unitPrice:40,sellingPrice:50}]},'legacy','wrong supplier')");set_supplier(p,'SUP-NEW');p.evaluate("document.getElementById('purSubmitBtn').click()");p.locator('#confirmActionModal').wait_for(state='visible');ck(len(rpc(p,'updatePurchase'))==0,'Purchase update no write before confirm');p.evaluate("purState.updatePurchaseId='WRONG'");confirm(p);calls=rpc(p,'updatePurchase');ck(len(calls)==1 and calls[0]['args'][1]=='PUR-000005','Purchase update freezes target ID');ck(calls[0]['args'][2]['supplierId']=='SUP-NEW','Purchase update keeps selected supplier')
  ck(not errors,'Purchase E2E zero uncaught page errors',' | '.join(errors));b.close()
 print(f'e2e_purchase_probe_assert: {P}/{P+F} PASS',flush=True)
 if F:sys.exit(1)
if __name__=='__main__':main()
