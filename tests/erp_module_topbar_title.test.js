'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname,'..');
const read = file => fs.readFileSync(path.join(root,file),'utf8');
const js = read('javascript.html');
const css = read('style.html');
const ui = read('UI.gs');
const index = read('index.html');
const arraySource = ui.match(/const NAV_ITEMS = (\[[\s\S]*?\n\]);/);
assert.ok(arraySource, 'NAV_ITEMS must be declared by UI.gs');
const groups = vm.runInNewContext('('+arraySource[1]+')');
function formatter() {
  const source = js.match(/function moduleHeaderFor_\([^)]+\)\s*\{[\s\S]*?\n  \}/);
  assert.ok(source, 'shared moduleHeaderFor_ helper is missing');
  const context=vm.createContext({});
  vm.runInContext(source[0],context);
  return context.moduleHeaderFor_;
}
test('every ERP page is titled by its single top-level module, without parent/child path',()=>{
  const format=formatter();
  for (const group of groups) {
    const keys = [group.key].concat((group.children||[]).map(c=>c.key));
    for (const key of keys) {
      const item = format(key,group);
      assert.equal(item.title,group.label,'module title for '+key);
      assert.equal(item.bn,group.bn||'','Bangla helper for '+key);
      assert.doesNotMatch(item.title,/[›»>]/,'breadcrumb in '+key);
    }
  }
  assert.equal(format('posv2',groups.find(g=>g.key==='pos')).title,'POS');
  assert.equal(format('returnHistory',groups.find(g=>g.key==='sales')).title,'Sales');
  assert.equal(format('customerLedger',groups.find(g=>g.key==='customers')).title,'Customers');
  assert.equal(format('invoiceDesign',groups.find(g=>g.key==='settings')).title,'Settings');
});
test('ungrouped fallback is readable and has no invented Bangla text',()=>{
  const format=formatter();
  assert.equal(format('noAccess',null).title,'No Access');
  assert.equal(format('unexpectedRoute',null).bn,'');
});
test('all real navigation stays in place, only shared title renderer changes',()=>{
  assert.match(js,/renderSubNav_\(group,\s*key\);/);
  assert.match(js,/var moduleHeader = moduleHeaderFor_\(key, group\);/);
  assert.match(js,/class="topbar-module-name"/);
  assert.match(js,/escapeHtml\(moduleHeader\.title\)/);
  assert.match(js,/escapeHtml\(moduleHeader\.bn\)/);
  assert.doesNotMatch(js,/title = group\.label \+ ' \\u203A '/);
  assert.match(index,/id="pageTitle"/);
  assert.match(index,/id="subNav"/);
});
test('shared title styling is compact on desktop and mobile without changing bar height',()=>{
  assert.match(css,/\.topbar-title\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*font-size:\s*16px;/s);
  assert.match(css,/\.topbar-module-name\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;/s);
  assert.match(css,/\.topbar-title \.bn-hint\s*\{[^}]*font-size:\s*11px;[^}]*overflow:\s*hidden;/s);
  assert.match(css,/@media \(max-width: 540px\), \(orientation: landscape\)[\s\S]*?\.topbar-title\s*\{[^}]*font-size:\s*15px;/s);
  assert.match(css,/@media \(max-width: 540px\), \(orientation: landscape\)[\s\S]*?\.topbar-title \.bn-hint\s*\{[^}]*display:\s*block;[^}]*font-size:\s*10px;/s);
  assert.match(css,/:root \{ --topbar-height: 56px; \}/);
});
