'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const server=fs.readFileSync(path.join(__dirname,'..','FinanceModule.gs'),'utf8');
function balances(people,rows) {
 const ctx={people,rows,roundMoney_:n=>Math.round(n*100)/100};
 vm.runInNewContext(server+'\nresult=financePersonBalancesForUI_(people,rows)',ctx);
 return JSON.parse(JSON.stringify(ctx.result));
}
test('balance map never nets owner, lender and borrower accounts',()=>{
 const result=balances([{id:'P1',name:'One',roles:['Owner','Lender','Borrower']}],[
  {'Person ID':'P1','Person':'One','Transaction Type':'Owner Investment','Amount':700},
  {'Person ID':'P1','Person':'One','Transaction Type':'Loan Received','Amount':200},
  {'Person ID':'P1','Person':'One','Transaction Type':'Borrower Loan','Amount':350},
  {'Person ID':'P1','Person':'One','Transaction Type':'Loan Repayment','Amount':50}
 ]);
 assert.deepEqual(result.P1,{owner:700,loanPayable:150,borrowerReceivable:350});
});
test('explicit Person IDs separate equal display names; inactive people retain balances',()=>{
 const result=balances([
  {id:'P1',name:'Same Name',roles:['Lender'],status:'Active'},
  {id:'P2',name:'Same Name',roles:['Borrower'],status:'Inactive'}],[
  {'Person ID':'P1','Person':'Same Name','Transaction Type':'Loan Received','Amount':120},
  {'Person ID':'P2','Person':'Same Name','Transaction Type':'Opening Borrower Loan','Amount':80}
 ]);
 assert.deepEqual(result.P1,{owner:0,loanPayable:120,borrowerReceivable:0});
 assert.deepEqual(result.P2,{owner:0,loanPayable:0,borrowerReceivable:80});
});
