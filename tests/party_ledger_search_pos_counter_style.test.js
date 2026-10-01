'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const cl = read('customerLedger.html');
const sl = read('supplierLedger.html');
const js = read('javascript.html');
const css = read('style.html');
let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('PASS', name); }
  catch (err) { fail++; console.error('FAIL', name); console.error(err.stack || err); }
}

test('customer and supplier ledgers use Counter-style combobox containers', () => {
  assert.match(cl, /class="counter-combobox party-ledger-combobox"/);
  assert.match(sl, /class="counter-combobox party-ledger-combobox"/);
  assert.match(cl, /id="customerLedgerPartyResults" class="counter-combo-results party-ledger-party-results"/);
  assert.match(sl, /id="supplierLedgerPartyResults" class="counter-combo-results party-ledger-party-results"/);
});

test('party search helper renders Counter-style result cards with bold name and small phone', () => {
  assert.match(js, /row\.className\s*=\s*'counter-combo-option combo-option'/);
  assert.match(js, /<strong>'\s*\+\s*escapeHtml\(item\.name \|\| ''\)\s*\+\s*'<\/strong>/);
  assert.match(js, /<small>'\s*\+\s*escapeHtml\(item\.phone\)\s*\+\s*'<\/small>/);
});

test('ledger result popup remains bounded and visually matches Counter picker', () => {
  assert.match(css, /\.party-ledger-party-results\s*\{[^}]*max-height:\s*min\(44vh,\s*300px\)/s);
  assert.match(css, /\.party-ledger-party-results\s+\.counter-combo-option\s*\{[^}]*min-height:\s*44px/s);
});

test('party search keeps blank focus closed, 20 result cap and keyboard navigation', () => {
  assert.match(js, /if \(!query \|\| input\.dataset\.selectedId\) \{ close_\(\); return; \}/);
  assert.match(js, /config\.limit \|\| 20/);
  for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Escape']) assert.match(js, new RegExp("e\\.key === '" + key + "'"));
});

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
