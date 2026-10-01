'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

const index = read('index.html');
const ui = read('UI.gs');
const js = read('javascript.html');
const pos = read('pos.html');
const v2 = read('posv2.html');

let pass = 0;
let fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('PASS', name); }
  catch (err) { fail++; console.error('FAIL', name); console.error(err.stack || err); }
}

test('POS V2 is a separate route/file but reuses the one live POS runtime', () => {
  assert.match(index, /id="page-posv2"[^>]*data-page="posv2"[^>]*hidden[\s\S]*?<\?!= include\('posv2'\); \?>/);
  assert.match(js, /runtimeKey\s*=\s*key\s*===\s*['"]posv2['"]\s*\?\s*['"]pos['"]\s*:\s*key/);
  assert.match(js, /classList\.toggle\(['"]pos-v2-active['"],\s*key\s*===\s*['"]posv2['"]\)/);
});

test('POS navigation offers Classic and V2 while both use POS permission', () => {
  assert.match(ui, /key:\s*['"]pos['"][\s\S]*children:\s*\[[\s\S]*key:\s*['"]pos['"][\s\S]*key:\s*['"]posv2['"][\s\S]*permKey:\s*['"]pos['"]/);
  const permissionStart = ui.indexOf('const PERMISSION_MODULES = [');
  const permissionEnd = ui.indexOf('];', permissionStart);
  assert.notStrictEqual(permissionStart, -1);
  assert.notStrictEqual(permissionEnd, -1);
  const permissionBlock = ui.slice(permissionStart, permissionEnd + 2);
  assert.doesNotMatch(permissionBlock, /key:\s*['"]posv2['"]/);
});

test('classic POS loader also serves POS V2', () => {
  assert.match(pos, /key\s*===\s*['"]pos['"]\s*\|\|\s*key\s*===\s*['"]posv2['"]/);
});

test('posv2 does not duplicate operational POS controls or IDs', () => {
  assert.doesNotMatch(v2, /<(?:input|button|select|textarea|div|section|aside)[^>]+id="pos[A-Z][^"]*"/i);
  assert.doesNotMatch(v2, /var\s+posState\s*=/);
  assert.doesNotMatch(v2, /function\s+posLoad\s*\(/);
});

test('POS V2 applies the SherHisab compact design tokens only while active', () => {
  assert.match(v2, /body\.pos-v2-active\s+#page-pos/);
  assert.match(v2, /--pos-v2-primary:\s*#1A56DB/i);
  assert.match(v2, /font-family:\s*['"]Geist['"]/);
  assert.match(v2, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(300px,\s*23vw\)/);
});

test('POS V2 moves checkout into the customer rail and restores Classic layout', () => {
  assert.match(v2, /function\s+posV2SetActive_\s*\(/);
  assert.match(v2, /pos-checkout-summary/);
  assert.match(v2, /pos-checkout-actions/);
  assert.match(v2, /pos-v2-checkout-anchor/);
  assert.match(v2, /insertBefore\(refs\.summary,\s*refs\.summaryAnchor\)/);
  assert.match(v2, /insertBefore\(refs\.actions,\s*refs\.actionsAnchor\)/);
});

test('POS V2 keeps the search-first cart workflow and responsive mobile tabs', () => {
  assert.match(v2, /\.product-grid\.mobile-search-idle\s*\{\s*display:\s*none/i);
  assert.match(v2, /data-pos-v2-tab="cart"/);
  assert.match(v2, /data-pos-v2-tab="customer"/);
  assert.match(v2, /data-pos-v2-tab="payment"/);
  assert.match(v2, /@media\s*\(max-width:\s*540px\)/);
});

console.log('\n' + pass + '/' + (pass + fail) + ' passed');
if (fail) process.exit(1);
