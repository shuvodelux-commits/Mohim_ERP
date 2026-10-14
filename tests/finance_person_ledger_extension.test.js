'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','financeLedger.html'),'utf8');
const types={
 'Opening Loan':{account:'loanPayable',balanceEffect:1},'Loan Received':{account:'loanPayable',balanceEffect:1},'Loan Repayment':{account:'loanPayable',balanceEffect:-1},
 'Opening Borrower Loan':{account:'borrowerReceivable',balanceEffect:1},'Borrower Repayment':{account:'borrowerReceivable',balanceEffect:-1},
 'Opening Owner Capital':{account:'owner',balanceEffect:1},'Owner Withdrawal':{account:'owner',balanceEffect:-1}
};
function statement(rows,account,from='',to=''){
 const b=html.indexOf('// BEGIN FINANCE PERSON STATEMENT'),e=html.indexOf('// END FINANCE PERSON STATEMENT',b);
 assert.ok(b>=0&&e>b,'missing person statement read-only projection');
 const ctx={rows,account,from,to,finLedType_:key=>types[key]};
 vm.runInNewContext(html.slice(b,e)+'\nresult=finLedPersonStatementRows_(rows,account,from,to)',ctx);
 return JSON.parse(JSON.stringify(ctx.result));
}
function r(id,date,type,amount,balance,account){return {financeId:id,date,transactionType:type,amount,balance,account,personId:'P1'};}
const loan=[r('F3','2026-10-14','Loan Repayment',5000,25000,'loanPayable'),r('F2','2026-10-10','Loan Received',10000,30000,'loanPayable'),r('F1','2026-10-01','Opening Loan',20000,20000,'loanPayable')];
test('Person Ledger reuses customer ledger cards, table and pagination without removing Finance All Transactions',()=>{
 for(const id of ['finLedAllView','finLedPersonView','finLedPersonBody','finLedPersonPageSize','finLedPersonPrevBtn','finLedPersonNextBtn']) assert.ok(html.includes('id="'+id+'"'),id);
 for(const c of ['party-ledger-workspace','party-ledger-toolbar','party-ledger-party-card','party-ledger-balance-box','party-ledger-list-card','party-ledger-pagination','mobile-card-table']) assert.ok(html.includes(c),c);
 for(const fn of ['finLedTableBody','finLedOpenEdit_','finLedDelete_','finLedCsvRows_']) assert.ok(html.includes(fn),fn);
 assert.equal((html.match(/id="finLedPersonSearch"/g)||[]).length,1);
});
test('lender relationship debits and credits include opening amount, unlike cash direction',()=>{
 const s=statement(loan,'loanPayable');
 assert.deepEqual(s.rows.map(x=>[x.financeId,x.debit,x.credit,x.balance]),[['F3',5000,0,25000],['F2',0,10000,30000],['F1',0,20000,20000]]);
 assert.equal(s.opening,0);assert.equal(s.closing,25000);
});
test('borrower opening is Debit; repayment Credit; owner capital opening Credit',()=>{
 const borrow=[r('B2','2026-10-05','Borrower Repayment',5000,15000,'borrowerReceivable'),r('B1','2026-10-01','Opening Borrower Loan',20000,20000,'borrowerReceivable')];
 assert.deepEqual(statement(borrow,'borrowerReceivable').rows.map(x=>[x.debit,x.credit]),[[0,5000],[20000,0]]);
 const owner=[r('O2','2026-10-05','Owner Withdrawal',20000,60000,'owner'),r('O1','2026-10-01','Opening Owner Capital',80000,80000,'owner')];
 assert.deepEqual(statement(owner,'owner').rows.map(x=>[x.debit,x.credit]),[[20000,0],[0,80000]]);
});
test('multiple roles never net across relationship balances',()=>{
 const mixed=[...loan,r('B1','2026-10-01','Opening Borrower Loan',5000,5000,'borrowerReceivable')];
 assert.equal(statement(mixed,'loanPayable').closing,25000);
 assert.equal(statement(mixed,'borrowerReceivable').closing,5000);
});
test('empty period preserves full-history opening and closing balances',()=>{
 const s=statement(loan,'loanPayable','2026-10-11','2026-10-13');assert.equal(s.opening,30000);assert.equal(s.closing,30000);assert.equal(s.rows.length,0);
});
test('date range filters display but not historical balance arithmetic',()=>{
 const s=statement(loan,'loanPayable','2026-10-10','2026-10-14');assert.equal(s.opening,20000);assert.equal(s.closing,25000);assert.deepEqual(s.rows.map(x=>x.financeId),['F3','F2']);
});
test('filtered person statement rows retain original source indexes for existing action menu',()=>{
 const s=statement(loan,'loanPayable','2026-10-10','2026-10-14');assert.deepEqual(s.rows.map(x=>x.sourceIndex),[0,1]);
});
