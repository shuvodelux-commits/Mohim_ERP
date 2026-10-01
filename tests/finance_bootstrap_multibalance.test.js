'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'FinanceModule.gs'), 'utf8');

function runtime() {
  const financeRows = [
    { 'Person ID':'P1', Person:'A', 'Transaction Type':'Opening Owner Capital', Amount:100 },
    { 'Person ID':'P2', Person:'B', 'Transaction Type':'Loan Received', Amount:80 },
    { 'Person ID':'P3', Person:'C', 'Transaction Type':'Borrower Loan', Amount:40 },
    { 'Person ID':'P3', Person:'C', 'Transaction Type':'Borrower Repayment', Amount:60 }
  ];
  const people = [
    { 'Person ID':'P1','Person Name':'A','Person Type':'Owner','Roles':'Owner,Borrower',Status:'Active',Phone:'0171' }
  ];
  const context = {
    console,
    requirePermission_: () => ({}),
    getSettingsMap_: () => ({'Currency Symbol':'৳'}),
    getActiveBankAccountsForUI_: () => [],
    getAllRows_: key => key === 'FINANCE_PERSONS' ? people : financeRows,
    activeRows_: key => key === 'FINANCE_TRANSACTIONS' ? financeRows : [],
    roundMoney_: n => Math.round((Number(n)+Number.EPSILON)*100)/100,
    ok_: data => data,
    fail_: message => ({success:false,message}),
    logError_: () => {},
    formatDate_: () => '2026-09-15'
  };
  vm.createContext(context);
  vm.runInContext(source, context, {filename:'FinanceModule.gs'});
  return context;
}

test('bootstrap exposes full transaction metadata and multi-role people', () => {
  const data = runtime().getFinanceBootstrap('T');
  assert.equal(data.transactionTypes.length, 9);
  assert.deepEqual(Object.keys(data.transactionTypes[0]).sort(), ['account','balanceEffect','cashDirection','isOpening','key','label','role'].sort());
  assert.equal(data.transactionTypes.find(t => t.key === 'Opening Loan').cashDirection, 'none');
  assert.deepEqual(Array.from(data.personsAll[0].roles), ['Owner','Borrower']);
});

test('bootstrap exposes six-value summary while preserving legacy aliases', () => {
  const data = runtime().getFinanceBootstrap('T');
  assert.deepEqual(JSON.parse(JSON.stringify(data.summary)), {
    ownerCapital:100, ownerAdvance:0, outstandingLoan:80,
    lenderCredit:0, borrowerReceivable:0, borrowerCredit:20
  });
  assert.equal(data.ownerCapital, data.summary.ownerCapital);
  assert.equal(data.outstandingLoan, data.summary.outstandingLoan);
  assert.equal(data.borrowerCredit, data.summary.borrowerCredit);
});
