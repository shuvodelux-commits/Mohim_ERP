from pathlib import Path
import runpy,time,sys
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
ns=runpy.run_path(str(ROOT/'tests'/'production_gate_e2e.py'),run_name='fixture')
html=ns['html'];AUTH_JS=ns['AUTH_JS']
P=F=0

def ck(cond,name,detail=''):
 global P,F
 if cond:P+=1;print('PASS',name,flush=True)
 else:F+=1;print('FAIL',name,detail,flush=True)
def rpc(p,n):return p.evaluate("n=>__rpcCalls.filter(x=>x.name===n)",n)
def confirm(p):p.evaluate("document.getElementById('confirmActionConfirm').click()");p.wait_for_timeout(250)

def main():
 global P,F
 with sync_playwright() as pw:
  b=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  p=b.new_page(viewport={'width':1440,'height':1000});p.set_default_timeout(10000);errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
  t=time.time();p.set_content(html,wait_until='domcontentloaded',timeout=120000);print('boot',time.time()-t,flush=True)
  p.evaluate(AUTH_JS);p.wait_for_timeout(250)
  # Sales return completion.
  p.evaluate("""__rpcCalls=[];window.__mockOverrides.completeReturn={returnId:'RET-1',totalReturnAmount:50};rtState.invoice={invoiceId:'INV-RET-1',customerName:'মহিউদ্দিন',cashRefundAvailable:0,items:[{productId:'PROD-000001',supplierId:'',name:'4 inch Test Pipe',unitPrice:50,soldQty:2,previouslyReturnedQty:0,availableQty:2}]};rtState.editingReturnId=null;rtState.editQtyByProduct={};rtRenderCart_();rtState.invoice.items[0]._returnQty=1;rtState.invoice.items[0]._returnPrice=50;rtRecalcTotal_();document.getElementById('rtRefundMethod').value='Store Credit';document.getElementById('rtReason').value='Damaged';document.getElementById('rtDate').value=rtToday_();""")
  p.evaluate("document.getElementById('rtCompleteBtn').click()");p.locator('#confirmActionModal').wait_for(state='visible');ck(len(rpc(p,'completeReturn'))==0,'Sales return no write before confirm');ck('INV-RET-1' in (p.text_content('#confirmActionModal') or ''),'Sales return confirmation shows invoice');confirm(p);calls=rpc(p,'completeReturn');ck(len(calls)==1 and calls[0]['args'][1]['invoiceId']=='INV-RET-1' and calls[0]['args'][1]['items'][0]['qty']==1 and calls[0]['args'][1]['refundMethod']=='Store Credit','Sales return exact payload',str(calls))

  # Purchase return completion.
  p.evaluate("""__rpcCalls=[];window.__mockOverrides.completePurchaseReturn={returnId:'PRT-1',totalReturnAmount:40};window.__mockOverrides.getPurchaseReturnHistory=[];prtState.purchase={purchaseId:'PUR-RET-1',supplierName:'Karatoa',items:[{productId:'PROD-000001',name:'4 inch Test Pipe',unitPrice:40,availableQty:2}]};prtState.editingReturnId=null;prtState.editQtyByProduct={};prtRenderCart_();prtState.purchase.items[0]._returnQty=1;prtRecalcTotal_();document.getElementById('prtRefundMethod').value='Supplier Credit';document.getElementById('prtReason').value='Damaged';document.getElementById('prtDate').value=prtToday_();""")
  p.evaluate("document.getElementById('prtCompleteBtn').click()");p.locator('#confirmActionModal').wait_for(state='visible');ck(len(rpc(p,'completePurchaseReturn'))==0,'Purchase return no write before confirm');ck('PUR-RET-1' in (p.text_content('#confirmActionModal') or ''),'Purchase return confirmation shows purchase');confirm(p);calls=rpc(p,'completePurchaseReturn');ck(len(calls)==1 and calls[0]['args'][1]['purchaseId']=='PUR-RET-1' and calls[0]['args'][1]['items'][0]['qty']==1 and calls[0]['args'][1]['refundMethod']=='Supplier Credit','Purchase return exact payload',str(calls))
  ck(not errors,'Return E2E has zero uncaught page errors',' | '.join(errors));b.close()
 print(f'e2e_returns_probe: {P}/{P+F} PASS',flush=True)
 if F:sys.exit(1)
if __name__=='__main__':main()
