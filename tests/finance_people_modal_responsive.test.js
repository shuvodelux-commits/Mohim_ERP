'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const finance = fs.readFileSync('finance.html','utf8');

test('Manage Finance People modal opts into a wide desktop layout without outer horizontal overflow', () => {
  assert.match(finance, /id=["']finManagePersonsModal["'][\s\S]*?class=["'][^"']*fin-manage-people-modal/);
  assert.match(finance, /\.fin-manage-people-modal\s*\{[\s\S]*?max-width:\s*1040px/);
  assert.match(finance, /\.fin-manage-people-modal\s+\.modal-body\s*\{[\s\S]*?overflow-x:\s*hidden/);
  assert.match(finance, /class=["']fin-manage-table-wrap["']/);
});

test('Finance role controls use compact role chips instead of mobile-sized generic checkbox inputs', () => {
  const roleChoiceCount = (finance.match(/class=["']fin-role-choice["']/g) || []).length;
  assert.ok(roleChoiceCount >= 6, `expected role choice class on create/edit controls, got ${roleChoiceCount}`);
  assert.match(finance, /\.fin-role-choice\s+input\[type=["']checkbox["']\]\s*\{[\s\S]*?width:\s*16px;[\s\S]*?height:\s*16px;[\s\S]*?min-height:\s*0/);
  assert.match(finance, /@media\s*\(max-width:\s*540px\)[\s\S]*?\.fin-person-role-row\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
});

test('Manage Finance People table becomes stacked cards on mobile instead of requiring horizontal scroll', () => {
  assert.match(finance, /@media\s*\(max-width:\s*540px\)[\s\S]*?\.fin-manage-persons-table\s+thead\s*\{\s*display:\s*none/);
  assert.match(finance, /\.fin-manage-persons-table\s+tbody\s+tr\s*\{[\s\S]*?border-radius:/);
  assert.match(finance, /\.fin-manage-persons-table\s+td:nth-child\(2\)::before\s*\{\s*content:\s*["']Phone["']/);
});
