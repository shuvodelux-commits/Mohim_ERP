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
  t=time.time();p.set_content(html,wait_until='domcontentloaded',timeout=120000);print('boot',time.time()-t,flush=True);p.evaluate(AUTH_JS);p.wait_for_timeout(300)
  # Complete sale.
  p.evaluate("goToPage('pos');__rpcCalls=[]");p.wait_for_timeout(300);p.locator('#posProductGrid .product-tile').first.click();p.evaluate("""()=>{var c=posState.customers[0];var n=document.getElementById('posCustomerName');n.value=c.name;n.dataset.customerId=c.id;document.getElementById('posCustomerPhone').value=c.phone;}""")
  p.evaluate("document.getElementById('posCompleteBtn').click()");p.locator('#confirmActionModal').wait_for(state='visible');ck(len(rpc(p,'completeSale'))==0,'POS no write before confirm');confirm(p);p.locator('#invoiceModal').wait_for(state='visible');calls=rpc(p,'completeSale');ck(len(calls)==1,'POS complete posts once');ck(calls[0]['args'][1]['customerId']=='CUS-000001','POS exact selected customer ID');ck(calls[0]['args'][1]['items'][0]['productId']=='PROD-000001','POS exact product payload');p.evaluate("closeModal('invoiceModal');posResetSaleForm_();")
  # Draft save no posting.
  p.evaluate("__rpcCalls=[]");p.locator('#posProductGrid .product-tile').first.click();p.evaluate("""()=>{var c=posState.customers[0];var n=document.getElementById('posCustomerName');n.value=c.name;n.dataset.customerId=c.id;document.getElementById('posCustomerPhone').value=c.phone;}""");p.evaluate("document.getElementById('posSaveDraftBtn').click()");p.wait_for_timeout(250);ck(len(rpc(p,'saveSalesDraft'))==1,'Draft saves once');ck(len(rpc(p,'completeSale'))==0,'Draft does not post sale');p.evaluate("if(posState.draftId)posExitDraftMode_(false);posResetSaleForm_();")
  # Sale update freezes target and selected customer.
  p.evaluate("""__rpcCalls=[];window.__mockOverrides.updateSale={invoiceId:'INV-EDIT-1',date:'2026-09-08',time:'12:00:00',customerId:'CUS-000001',customerName:'মহিউদ্দিন',customerPhone:'01712345678',customerAddress:'',items:[{productId:'PROD-000001',name:'4 inch Test Pipe',qty:1,unit:'Feet',unitPrice:50,lineTotal:50}],subtotal:50,discount:0,grandTotal:50,paidAmount:0,dueAmount:50,paymentMethod:'Cash',amountInWords:'Fifty taka only',shop:{name:'SherERP Test'}};posLoadUpdateInvoice_({invoiceId:'INV-EDIT-1',customerId:'CUS-000001',customerName:'মহিউদ্দিন',customerPhone:'01712345678',customerAddress:'',items:[{productId:'PROD-000001',name:'4 inch Test Pipe',qty:1,unitPrice:50,lineTotal:50,vendorQty:0}],discount:0,paidAmount:0,paymentMethod:'Cash',bankAccountId:''},'e2e edit')""");p.wait_for_function("()=>posState.updateInvoiceId==='INV-EDIT-1'");p.evaluate("document.getElementById('posCompleteBtn').click()");p.locator('#confirmActionModal').wait_for(state='visible');p.evaluate("posState.updateInvoiceId='WRONG'");confirm(p);calls=rpc(p,'updateSale');ck(len(calls)==1 and calls[0]['args'][1]=='INV-EDIT-1','Sale update freezes invoice ID');ck(calls[0]['args'][2]['customerId']=='CUS-000001','Sale update preserves explicit customer ID')
  # Same-quantity vendor -> Negative Stock edit carries explicit sourcing intent.
  p.evaluate("""closeModal('invoiceModal');__rpcCalls=[];posExitUpdateMode_();window.__mockOverrides.updateSale={invoiceId:'INV-SOURCE-1',date:'2026-09-08',time:'12:00:00',customerId:'CUS-000001',customerName:'মহিউদ্দিন',customerPhone:'01712345678',customerAddress:'',items:[{productId:'PROD-000001',name:'4 inch Test Pipe',qty:2,unit:'Feet',unitPrice:50,lineTotal:100}],subtotal:100,discount:0,grandTotal:100,paidAmount:0,dueAmount:100,paymentMethod:'Cash',amountInWords:'One hundred taka only',shop:{name:'SherERP Test'}};posLoadUpdateInvoice_({invoiceId:'INV-SOURCE-1',customerId:'CUS-000001',customerName:'মহিউদ্দিন',customerPhone:'01712345678',customerAddress:'',items:[{productId:'PROD-000001',name:'4 inch Test Pipe',qty:2,unitPrice:50,lineTotal:100,vendorQty:1,vendorId:'V1',vendorName:'Jewel Hardware',vendorUnitCost:400}],discount:0,paidAmount:0,paymentMethod:'Cash',bankAccountId:''},'source correction')""");p.wait_for_function("()=>posState.updateInvoiceId==='INV-SOURCE-1'");p.evaluate("""()=>{posState.productStockById['PROD-000001']=0;posState.vendors=[{id:'V1',name:'Jewel Hardware',status:'Active'}];posState.vendorsAll=posState.vendors.slice();posRenderCart_();}""");p.locator('[data-shortage-act=\"negative\"]').click();ck(p.evaluate("()=>posState.cart[0].shortageResolution==='negative' && !posState.cart[0].vendorId && posState.cart[0].vendorUnitCost===''"),'Vendor-to-negative edit clears stale vendor state');p.evaluate("document.getElementById('posCompleteBtn').click()");p.locator('#confirmActionModal').wait_for(state='visible');confirm(p);calls=rpc(p,'updateSale');source_payload=calls[-1]['args'][2] if calls else {};source_item=(source_payload.get('items') or [{}])[0];ck(source_item.get('shortageResolution')=='negative' and 'vendorId' not in source_item,'Sale update posts explicit negative sourcing intent')
  ck(not errors,'POS/Sale E2E zero uncaught page errors',' | '.join(errors));b.close()
 print(f'e2e_pos_sale_probe: {P}/{P+F} PASS',flush=True)
 if F:sys.exit(1)
if __name__=='__main__':main()
