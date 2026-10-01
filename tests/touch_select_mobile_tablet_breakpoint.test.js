'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const js = fs.readFileSync('javascript.html','utf8');
const css = fs.readFileSync('style.html','utf8');
const finance = fs.readFileSync('finance.html','utf8');
const expense = fs.readFileSync('expense.html','utf8');

test('shared touch-select uses 600px as mobile/tablet boundary', () => {
  assert.match(js, /function\s+responsiveViewportMode_\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(w\s*<\s*600\)\s*return\s*['"]mobile['"]/);
  assert.doesNotMatch(js, /if\s*\(w\s*<\s*768\)\s*return\s*['"]mobile['"]/);
  assert.match(css, /@media\s*\(max-width:\s*599px\)\s*\{[\s\S]*?body\s+\.touch-select-menu/);
  assert.doesNotMatch(css, /@media\s*\(max-width:\s*767px\)\s*\{[\s\S]*?body\s+\.touch-select-menu/);
});

test('shared non-mobile date layer follows the same 600px control boundary', () => {
  assert.match(css, /@media\s*\(min-width:\s*600px\)\s*\{[\s\S]*?input\[type=["']date["']\]\.touch-date-native/);
});

test('mobile sheet headers use human labels for approved Finance and Expense selects', () => {
  assert.match(finance, /<select\s+id=["']finType["'][^>]*aria-label=["']Transaction Type["']/);
  assert.match(finance, /<select\s+id=["']finPerson["'][^>]*aria-label=["']Finance Person["']/);
  assert.match(expense, /<select\s+id=["']expCategory["'][^>]*aria-label=["']Expense Category["']/);
  assert.match(expense, /<select\s+id=["']expPayee["'][^>]*aria-label=["']Payee["']/);
});
