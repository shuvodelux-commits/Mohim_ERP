const fs = require('fs');
const assert = require('assert');
const ui = fs.readFileSync('UI.gs','utf8');
const js = fs.readFileSync('javascript.html','utf8');
const index = fs.readFileSync('index.html','utf8');
function test(name, fn){ try{ fn(); console.log('PASS '+name); } catch(e){ console.error('FAIL '+name+'\n'+e.message); process.exitCode=1; } }

test('Counter navigation sits between POS and Sales and is action-capability gated', () => {
  assert.match(ui, /key:\s*'counter'[\s\S]{0,240}sidebarGroup:\s*0[\s\S]{0,120}sidebarOrder:\s*25/);
  assert.match(ui, /key:\s*'counter'[\s\S]{0,700}actionPermAny[\s\S]{0,700}customers[\s\S]{0,120}edit[\s\S]{0,240}suppliers[\s\S]{0,120}edit[\s\S]{0,240}expense[\s\S]{0,120}add[\s\S]{0,240}bank[\s\S]{0,120}add/);
  const posOrder = Number((ui.match(/key:\s*'pos'[\s\S]{0,180}sidebarOrder:\s*(\d+)/)||[])[1]);
  const counterOrder = Number((ui.match(/key:\s*'counter'[\s\S]{0,280}sidebarOrder:\s*(\d+)/)||[])[1]);
  const salesOrder = Number((ui.match(/key:\s*'sales'[\s\S]{0,280}sidebarOrder:\s*(\d+)/)||[])[1]);
  assert(posOrder < counterOrder && counterOrder < salesOrder);
});

test('Counter is not a new permission module', () => {
  const permBlock = (ui.match(/const PERMISSION_MODULES\s*=\s*\[[\s\S]*?\n\];/)||[''])[0];
  assert(!/key:\s*'counter'/.test(permBlock));
});

test('Counter page is included in the SPA shell', () => {
  assert.match(index, /id="page-counter"[^>]*data-page="counter"[\s\S]{0,180}include\('counter'\)/);
});

test('Client nav understands action-level capability metadata', () => {
  assert.match(js, /function hasActionPermission_\s*\(/);
  assert.match(js, /item\.actionPermAny/);
});

test('Grouped sidebar divider renderer remains authoritative', () => {
  assert.match(js, /divider\.className\s*=\s*'nav-divider'/);
  assert.match(js, /group\s*!==\s*lastGroup/);
});

if (!process.exitCode) console.log('5/5 passed');
