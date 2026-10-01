'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const purchase = fs.readFileSync(path.join(root, 'purchase.html'), 'utf8');
const products = fs.readFileSync(path.join(root, 'products.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.html'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('PASS', name); }
  catch (err) { fail++; console.error('FAIL', name); console.error(err.stack || err); }
}

function functionSource(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.notStrictEqual(start, -1, 'missing function ' + name);
  const brace = source.indexOf('{', start);
  let depth = 0, quote = null, escape = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unclosed function ' + name);
}

test('Purchase product header exposes Add Product beside Clear Cart', () => {
  assert.match(purchase, /class="purchase-cart-actions"/);
  assert.match(purchase, /id="purAddProductBtn"/);
  assert.match(purchase, />\+ Add Product</);
  assert.match(purchase, /id="purClearCartBtn"/);
});

test('Purchase Add Product respects Products add permission', () => {
  const sync = functionSource(purchase, 'purSyncAddProductPermission_');
  assert.match(sync, /hasActionPermission_/);
  assert.match(sync, /['"]products['"]\s*,\s*['"]add['"]/);
  assert.match(sync, /purAddProductBtn/);
  assert.match(sync, /hidden/);
});

test('Purchase opens the shared Products modal and never duplicates addProduct RPC', () => {
  const open = functionSource(purchase, 'purOpenAddProduct_');
  assert.match(open, /prodLoad/);
  assert.match(open, /prodOpenAddModal_/);
  assert.match(open, /['"]purchase['"]/);
  assert.match(open, /prodModal/);
  assert.match(open, /document\.body\.appendChild/);
  assert.doesNotMatch(purchase, /serverCall\(\s*['"]addProduct['"]/);
});

test('Products exposes one reusable Add Product modal opener', () => {
  const open = functionSource(products, 'prodOpenAddModal_');
  assert.match(open, /prodState\.editingId\s*=\s*null/);
  assert.match(open, /prodState\.addSource/);
  assert.match(open, /prodModalTitle/);
  assert.match(open, /openModal\(['"]prodModal['"]\)/);
  assert.match(products, /prodAddBtn['"]\)\.addEventListener\(['"]click['"][\s\S]*prodOpenAddModal_\(['"]products['"]\)/);
});

test('shared category and unit Manage modal escapes the hidden Products page before opening', () => {
  const manage = functionSource(products, 'prodOpenManageList_');
  assert.match(manage, /prodManageListModal/);
  assert.match(manage, /document\.body\.appendChild/);
  assert.match(manage, /openModal\(['"]prodManageListModal['"]\)/);
});

test('successful new product save publishes its source context', () => {
  assert.match(products, /shererp:product-saved/);
  assert.match(products, /detail:\s*\{\s*source:/);
  assert.match(products, /savedWasNew/);
  assert.match(products, /savedSource/);
});

test('Purchase refreshes only its product catalog after product creation', () => {
  const refresh = functionSource(purchase, 'purRefreshProductCatalog_');
  assert.match(refresh, /getPurchaseBootstrap/);
  assert.match(refresh, /purState\.products/);
  assert.match(refresh, /smartIndexProducts_/);
  assert.match(refresh, /purRenderLines_/);
  assert.doesNotMatch(refresh, /purState\.cart\s*=/);
  assert.doesNotMatch(refresh, /purSupplier['"]\)\.value\s*=/);

  assert.match(purchase, /addEventListener\(['"]shererp:product-saved['"]/);
  assert.match(purchase, /detail\.source\s*!==\s*['"]purchase['"]/);
});

test('Purchase cart header actions remain compact', () => {
  assert.match(css, /#page-purchase\s+\.purchase-cart-actions\s*\{/);
  assert.match(css, /#page-purchase\s+\.purchase-cart-actions\s+\.btn/);
});

console.log('\n' + pass + '/' + (pass + fail) + ' passed');
if (fail) process.exit(1);
