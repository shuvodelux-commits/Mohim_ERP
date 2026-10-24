'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const server = fs.readFileSync('FinanceModule.gs','utf8');
const finance = fs.readFileSync('finance.html','utf8');
const ledger = fs.readFileSync('financeLedger.html','utf8');

test('finance transaction keys stay stable while display labels use lender borrower owner debit-credit wording', () => {
  const expected = [
    ["Owner Investment", "Owner Credit"],
    ["Owner Withdrawal", "Owner Debit"],
    ["Loan Received", "Lender Credit"],
    ["Loan Repayment", "Lender Debit"],
    ["Borrower Repayment", "Borrower Credit"],
    ["Borrower Loan", "Borrower Debit"]
  ];
  for (const [key, label] of expected) {
    assert.match(server, new RegExp(`key:'${key.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')}',\\s*label:'${label.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')}'`), `${key} -> ${label}`);
  }
});

test('Business Finance transaction selector separates Lender Borrower Owner and Opening groups', () => {
  assert.match(finance, /\['Lender',\s*'Borrower',\s*'Owner',\s*'Opening Balance'\]/);
  assert.match(finance, /data-fin-type-separator/);
  assert.match(finance, /ঋণদাতা হতে গ্রহণ/);
  assert.match(finance, /ঋণদাতাকে প্রদান/);
  assert.match(finance, /ঋণগ্রহীতা হতে গ্রহণ/);
  assert.match(finance, /ঋণগ্রহীতাকে প্রদান/);
  assert.match(finance, /মালিক হতে গ্রহণ/);
  assert.match(finance, /মালিককে প্রদান/);
  assert.match(finance, /return type\.label/);
});

test('Finance Ledger renders a selected-person balance card from complete-history summary', () => {
  ['finLedSelectedPersonCard','finLedSelectedPersonName','finLedSelectedPersonBalances'].forEach(id => {
    assert.match(ledger, new RegExp(`id=["']${id}["']`), id);
  });
  assert.match(ledger, /function\s+finLedRenderSelectedPersonBalance_/);
  assert.match(ledger, /finLedState\.selectedPerson/);
  assert.match(ledger, /finLedState\.summary/);
  assert.match(ledger, /Outstanding Loan/);
  assert.match(ledger, /Lender Advance/);
  assert.match(ledger, /Borrower Receivable/);
  assert.match(ledger, /Borrower Advance/);
  assert.match(ledger, /Owner Capital/);
  assert.match(ledger, /Owner Advance/);
});

test('transaction selectors retain original names while advance balances are unambiguous', () => {
  assert.match(server, /key:'Loan Received', label:'Lender Credit'/);
  assert.match(server, /key:'Borrower Repayment', label:'Borrower Credit'/);
  assert.ok(finance.includes('class="stat-label">Lender Advance</div>'));
  assert.ok(finance.includes('class="stat-label">Borrower Advance</div>'));
  const personLedger = fs.readFileSync('financePersonLedger.html','utf8');
  assert.ok(personLedger.includes("negative?'Lender Advance'"));
  assert.ok(personLedger.includes("negative?'Borrower Advance'"));
});

test('Customer and Supplier due-ledger columns do not falsely describe entries as cash flow', () => {
  for (const file of ['customers.html','suppliers.html']) {
    const html = fs.readFileSync(file,'utf8');
    assert.ok(html.includes('Debit<br><span class="bn-hint" style="display:inline;">বাকি বাড়ে</span>'), file);
    assert.ok(html.includes('Credit<br><span class="bn-hint" style="display:inline;">বাকি কমে</span>'), file);
  }
});

test('Finance Ledger uses Party and friendly relationship account labels', () => {
  assert.match(ledger, /<th>Party<\/th>/);
  assert.match(ledger, /label:'Party'/);
  assert.match(server, /account === 'owner'\) return 'Owner Balance'/);
  assert.match(server, /account === 'loanPayable'\) return 'Lender Balance'/);
  assert.match(server, /account === 'borrowerReceivable'\) return 'Borrower Balance'/);
});
