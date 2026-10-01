'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const expense = fs.readFileSync('expense.html','utf8');
const finance = fs.readFileSync('finance.html','utf8');
const shared = fs.readFileSync('javascript.html','utf8');

test('Expense Payee and Category use internally scrollable tablet touch selects', () => {
  assert.match(expense, /id=["']expCategory["'][^>]*data-touch-select-internal-scroll=["']true["']/);
  assert.match(expense, /id=["']expPayee["'][^>]*data-touch-select-internal-scroll=["']true["']/);
  assert.doesNotMatch(expense, /data-touch-select-keep-open-on-scroll/);
  assert.match(shared, /touchSelectInternalScroll_/);
  assert.match(shared, /menu\.scrollTop\s*=\s*gesture\.startScrollTop/);
});

test('Borrower transaction display order is Credit before Debit only', () => {
  assert.match(finance, /Borrower Repayment['"]\s*:\s*0[\s\S]*Borrower Loan['"]\s*:\s*1/);
});
