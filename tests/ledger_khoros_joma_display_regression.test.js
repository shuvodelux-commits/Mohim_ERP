'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');
const read=p=>fs.readFileSync(p,'utf8');
const fp=read('financePersonLedger.html'),fl=read('financeLedger.html'),fin=read('finance.html');
const sl=read('supplierLedger.html'),sup=read('suppliers.html'),cl=read('customerLedger.html'),cust=read('customers.html');
const shared=read('javascript.html');

test('Finance person balance cards use transaction type names',()=>{
  for(const s of ["positive?'Lender Credit':negative?'Lender Debit'","positive?'Borrower Debit':negative?'Borrower Credit'","positive?'Owner Credit':negative?'Owner Debit'"])
    assert.ok(fp.includes(s),s);
  for(const label of ['Owner Credit','Owner Debit','Lender Credit','Lender Debit','Borrower Debit','Borrower Credit']){
    assert.ok(fin.includes('class="stat-label">'+label+'</div>'),label+' Finance');
    assert.ok(fl.includes('>'+label+'</div>'),label+' Finance Ledger');
  }
});

test('Finance and Supplier use English Debit/Credit with Bangla khoros/joma',()=>{
  for(const src of [fp,fl,sl,sup]){
    assert.match(src,/Debit<br><span class="bn-hint"[^>]*>খরচ<\/span>/);
    assert.match(src,/Credit<br><span class="bn-hint"[^>]*>জমা<\/span>/);
  }
});

test('Supplier screens invert displayed amounts without changing raw ledger fields',()=>{
  assert.ok(sl.includes("var debit = supplierLedgerAmountCell_(row, 'Credit')"));
  assert.ok(sl.includes("data-label=\"Debit\">' + debit + '</td>'"));
  assert.ok(sl.includes("data-label=\"Credit\">' + supplierLedgerAmountCell_(row, 'Debit')"));
  assert.ok(sup.includes("var debitHtml = l['Credit'] ? formatMoney(l['Credit']) : ''"));
  assert.ok(sup.includes("ledger-txn--decrease\">' + debitHtml + '</td>'"));
  assert.ok(sup.includes("ledger-txn--increase\">' + (l['Debit'] ? formatMoney(l['Debit']) : '')"));
});

test('Customer ledger keeps existing due semantics, with Credit first',()=>{
  assert.match(cust,/Debit<br><span class="bn-hint"[^>]*>বাকি বাড়ে<\/span>/);
  assert.match(cust,/Credit<br><span class="bn-hint"[^>]*>বাকি কমে<\/span>/);
  assert.ok(cl.includes("data-label=\"Debit\">' + customerLedgerAmountCell_(row, 'Debit')"));
  assert.ok(cl.includes("data-label=\"Credit\">' + credit + '</td>'"));
});

test('Credit appears left of Debit throughout Customer, Supplier and Finance ledgers',()=>{
  for(const src of [fp,fl,sl,sup,cl,cust]){
    const tableHeaders=[...src.matchAll(/<thead>[\s\S]*?<\/thead>/g)].map(match=>match[0]);
    const header=tableHeaders.find(h=>h.includes('Credit') && h.includes('Debit'));
    assert.ok(header,'ledger table header exists');
    assert.ok(header.indexOf('Credit')<header.indexOf('Debit'),'Credit must precede Debit in header');
  }
  assert.ok(cl.indexOf('data-label="Credit"')<cl.indexOf('data-label="Debit"'),'Customer row order');
  assert.ok(sl.indexOf('data-label="Credit"')<sl.indexOf('data-label="Debit"'),'Supplier row order');
  assert.ok(fp.indexOf('data-label="Credit"')<fp.indexOf('data-label="Debit"'),'Finance person row order');
  assert.ok(fl.indexOf("finLedMoneyCell_(r, 'credit')")<fl.indexOf("finLedMoneyCell_(r, 'debit')"),'Finance row order');
  assert.ok(fl.indexOf("key:'credit', label:'Credit'")<fl.indexOf("key:'debit', label:'Debit'"),'Finance export order');
  assert.ok(fp.indexOf("key:'credit',label:'Credit'")<fp.indexOf("key:'debit',label:'Debit'"),'Finance person export order');
});

test('Money-held/away card colors use the approved role-specific sign convention',()=>{
  assert.ok(fp.includes("account==='loanPayable'?(positive?'positive':'negative')"));
  assert.ok(fp.includes("account==='borrowerReceivable'?(positive?'negative':'positive')"));
  const styles=read('style.html');
  assert.match(styles,/#page-supplierLedger \.party-ledger-balance-box\.ledger-tone--advance/);
  assert.match(styles,/#page-suppliers \.ledger-tone--advance/);
  assert.match(styles,/#page-financePersonLedger \.fpl-balance\.positive/);
  assert.match(styles,/#page-financePersonLedger \.fpl-balance\.negative/);
  assert.match(fl,/outstandingLoan: \{ kind:'positive', label:'Credit Balance' \}/);
  assert.match(fl,/borrowerReceivable: \{ kind:'negative', label:'Debit Balance' \}/);
});

function printStatement(kind){
  const begin=shared.indexOf('function partyLedgerPrintStatement_(statement) {');
  const end=shared.indexOf('\n  }\n',begin);
  assert.ok(begin>=0&&end>begin);
  let html='';
  const host={set innerHTML(s){if(s)html=s},get innerHTML(){return html}};
  const doc={getElementById:id=>id==='printHost'?host:null,body:{classList:{add(){},remove(){}}}};
  const source=shared.slice(begin,end+4);
  const fn=new Function('document','window','escapeHtml','formatMoney','return ('+source+');')(doc,{print(){}},String,String);
  fn({kind,business:{name:'Demo'},party:{name:'ABC'},
      period:{from:'2026-10-01',to:'2026-10-24'},
      rows:[{Date:'2026-10-24',Type:'Purchase',Reference:'P1',Debit:1000,Credit:400,Balance:600}],
      openingBalance:0,periodDebit:1000,periodCredit:400,closingBalance:600,printedAt:''});
  return html;
}

test('Supplier printed statement inverts displayed debit/credit, customer does not',()=>{
  const s=printStatement('supplier');
  assert.ok(s.includes('<th>Credit<br>জমা</th><th>Debit<br>খরচ</th>'));
  assert.ok(s.includes('Period Debit: <strong>400</strong>'));
  assert.ok(s.includes('Period Credit: <strong>1000</strong>'));
  assert.ok(s.includes('<td style="text-align:right">1000</td><td style="text-align:right">400</td>'));
  const c=printStatement('customer');
  assert.ok(c.includes('<th>Credit</th><th>Debit</th>'));
  assert.ok(c.includes('Period Debit: <strong>1000</strong>'));
  assert.ok(c.includes('Period Credit: <strong>400</strong>'));
  assert.ok(c.includes('<td style="text-align:right">400</td><td style="text-align:right">1000</td>'));
});
