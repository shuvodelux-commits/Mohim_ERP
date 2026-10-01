'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const expense = fs.readFileSync('expense.html','utf8');
const shared = fs.readFileSync('javascript.html','utf8');

test('Expense Category and Payee use internal-scroll touch pickers and do not opt into page-scroll persistence', () => {
  assert.match(expense, /id=["']expCategory["'][^>]*data-touch-select-internal-scroll=["']true["']/);
  assert.match(expense, /id=["']expPayee["'][^>]*data-touch-select-internal-scroll=["']true["']/);
  assert.doesNotMatch(expense, /data-touch-select-keep-open-on-scroll/);
  assert.match(shared, /touchSelectInternalScroll_/);
  assert.match(shared, /touchstart/);
  assert.match(shared, /touchmove/);
  assert.match(shared, /menu\.scrollTop\s*=\s*gesture\.startScrollTop/);
  assert.doesNotMatch(shared, /touchSelectKeepOpenOnScroll_/);
});
