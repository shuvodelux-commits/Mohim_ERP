const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..'); const read=n=>fs.readFileSync(path.join(root,n),'utf8');
const invoice=read('Invoice.gs'), draft=read('DraftSales.gs'), js=read('javascript.html');
assert.match(invoice,/function buildInvoiceShopPayload_/); assert.match(draft,/function getSalesDraftPreview/); assert.match(draft,/isDraft:\s*true/);
assert.match(draft,/invoiceId:\s*row\[['"]Draft No['"]\]/); assert.match(js,/function buildInvDraftMark_/); assert.match(js,/DRAFT/); assert.match(js,/খসড়া/);
assert.match(js,/if\s*\(inv\.isDraft\)\s*return\s*['"]["']/); assert.match(js,/is-draft/); assert.match(js,/!inv\.isDraft[\s\S]*PAID/);
console.log('PASS draft invoice preview contract');
