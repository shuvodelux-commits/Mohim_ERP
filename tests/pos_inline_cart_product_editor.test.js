'use strict';
// TDD regression for the approved POS cart inline product-entry workflow.

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const pos = fs.readFileSync(path.join(root, 'pos.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.html'), 'utf8');

let pass = 0;
let fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('PASS', name); }
  catch (err) { fail++; console.error('FAIL', name); console.error(err.stack || err); }
}

function functionSource(name) {
  const start = pos.indexOf('function ' + name + '(');
  assert.notStrictEqual(start, -1, 'missing function ' + name);
  const brace = pos.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < pos.length; i++) {
    if (pos[i] === '{') depth++;
    else if (pos[i] === '}' && --depth === 0) return pos.slice(start, i + 1);
  }
  throw new Error('unclosed function ' + name);
}

test('cart columns read Product Qty Unit Price Total in that order', () => {
  assert.match(
    pos,
    /class="pos-cart-columns"[^>]*>\s*<span>Product<\/span>\s*<span>Qty<\/span>\s*<span class="pos-cart-col-unit">Unit<\/span>\s*<span>Price \(৳\)<\/span>\s*<span>Total \(৳\)<\/span>/s
  );
});

test('cart keeps one invoice-style entry row instead of a separate Add product control', () => {
  const render = functionSource('posRenderCart_');
  assert.doesNotMatch(pos, /id="posCartAddInput"|id="posCartAddResults"/);
  assert.match(render, /pos-cart-entry-row/);
  assert.match(render, /data-cart-product-mode="add"/);
  assert.match(render, /c-qty-wrap/);
  assert.match(render, /c-unit-wrap/);
  assert.match(render, /c-price-wrap/);
  assert.match(render, /c-line-total-wrap/);
});

test('initial POS load renders the empty Add product row before any product is added', () => {
  const load = functionSource('posLoad');
  assert.match(load, /posRenderCart_\(\)/);
});

test('selecting a product starts an active row while leaving the next empty Add product row available', () => {
  const start = functionSource('posStartCartEntry_');
  const render = functionSource('posRenderCart_');
  assert.match(start, /posState\.cart\.push\(posCreateCartLine_\(product\)\)/);
  assert.match(start, /posState\.cartEntryIndex\s*=\s*posState\.cart\.length\s*-\s*1/);
  assert.match(start, /posRenderCart_\(\)/);
  assert.match(start, /posFocusCartEntryQty_/);
  assert.match(render, /data-cart-product-mode="add"/);
  assert.doesNotMatch(render, /if\s*\(posState\.cartEntryIndex\s*===\s*null\)\s*\{\s*var entryRow/);
});

test('active entry row looks like a normal searchable product row with qty unit price total', () => {
  const render = functionSource('posRenderCart_');
  assert.match(render, /posState\.cartEntryIndex/);
  assert.match(render, /productMode\s*=\s*activeEntry\s*\?\s*['"]entry['"]\s*:\s*['"]replace['"]/);
  assert.match(render, /data-cart-product-mode="'\s*\+\s*productMode/);
  assert.match(render, /data-cart-entry-qty/);
  assert.match(render, /data-cart-entry-price/);
  assert.match(render, /line\.unit/);
  assert.match(render, /lineTotal/);
  assert.match(render, /activeEntry\s*=\s*posState\.cartEntryIndex\s*===\s*i/);
  assert.match(render, /pos-cart-entry-row is-active/);
});

test('after selecting product the quantity field receives focus and selects default qty', () => {
  const focus = functionSource('posFocusCartEntryQty_');
  assert.match(focus, /data-cart-entry-qty/);
  assert.match(focus, /\.focus\(\)/);
  assert.match(focus, /\.select\(\)/);
});

test('Qty Enter finishes the active row and focuses the new empty product row', () => {
  const finish = functionSource('posFinishCartEntry_');
  assert.match(finish, /posState\.cartEntryIndex\s*=\s*null/);
  assert.match(finish, /posRenderCart_\(\)/);
  assert.match(finish, /posFocusCartEntryProduct_/);

  const keyArea = pos.slice(
    pos.indexOf("document.getElementById('posCartList').addEventListener('keydown'"),
    pos.indexOf("document.getElementById('posDiscount').addEventListener", pos.indexOf("document.getElementById('posCartList').addEventListener('keydown'"))
  );
  assert.match(keyArea, /data-cart-entry-qty/);
  assert.match(keyArea, /posFinishCartEntry_/);
});

test('clicking an existing product opens the same searchable combobox and shows suggestions', () => {
  const render = functionSource('posRenderCart_');
  const clickArea = pos.slice(
    pos.indexOf("document.getElementById('posCartList').addEventListener('click'"),
    pos.indexOf("document.getElementById('posCartList').addEventListener('change'", pos.indexOf("document.getElementById('posCartList').addEventListener('click'"))
  );
  assert.match(render, /data-cart-product-edit/);
  assert.match(render, /productMode\s*=\s*activeEntry\s*\?\s*['"]entry['"]\s*:\s*['"]replace['"]/);
  assert.match(render, /data-cart-product-mode="'\s*\+\s*productMode/);
  assert.match(clickArea, /posRenderCartProductResults_/);
  assert.match(clickArea, /\.focus\(\)/);
  assert.match(clickArea, /\.select\(\)/);
});

test('cart product suggestions render in a body-level floating popup so cart scrolling cannot clip them', () => {
  const popup = functionSource('posCartProductPopup_');
  const place = functionSource('posPlaceCartProductResults_');
  const render = functionSource('posRenderCartProductResults_');
  assert.match(popup, /document\.body\.appendChild\(popup\)/);
  assert.match(popup, /posCartProductPopup/);
  assert.match(place, /getBoundingClientRect/);
  assert.match(place, /window\.innerHeight|document\.documentElement\.clientHeight/);
  assert.match(render, /posCartProductPopup_/);
  assert.match(render, /posPlaceCartProductResults_/);
  assert.match(css, /#posCartProductPopup|\.pos-cart-product-popup/);
  assert.match(css, /position:\s*fixed/);
});

test('typing in either product combobox uses smart product search and updates suggestions', () => {
  const search = functionSource('posCartProductMatches_');
  assert.match(search, /smartSearchProducts_/);
  const inputArea = pos.slice(
    pos.indexOf("document.getElementById('posCartList').addEventListener('input'"),
    pos.indexOf("document.getElementById('posCartList').addEventListener('change'", pos.indexOf("document.getElementById('posCartList').addEventListener('input'"))
  );
  assert.match(inputArea, /posRenderCartProductResults_/);
  assert.match(inputArea, /data-cart-product-input/);
});

test('choosing a replace suggestion keeps the row position and starts fresh product state', () => {
  const create = functionSource('posCreateCartLine_');
  const replace = functionSource('posReplaceCartProduct_');
  assert.match(create, /qty:\s*1/);
  assert.match(create, /priceMode:\s*['"]auto['"]/);
  assert.match(replace, /posState\.cart\[index\]\s*=\s*posCreateCartLine_/);
  assert.match(replace, /already/i);
});

test('cart order remains authoritative for draft and posted sale payloads', () => {
  const draft = functionSource('posBuildDraftPayload_');
  assert.match(draft, /items:\s*posState\.cart\.map/);
  assert.match(pos, /items:\s*posState\.cart\.map\(function\s*\(l\)/);
});

console.log('\n' + pass + '/' + (pass + fail) + ' passed');
if (fail) process.exit(1);
