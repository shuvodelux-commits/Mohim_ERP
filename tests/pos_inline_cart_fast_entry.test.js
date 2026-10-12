'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const pos = fs.readFileSync(path.join(root, 'pos.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.html'), 'utf8');
const v2 = fs.readFileSync(path.join(root, 'posv2.html'), 'utf8');

let pass = 0, fail = 0;
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

test('selected inline product immediately shows canonical full name before qty typing', () => {
  const render = functionSource('posRenderCart_');
  const start = functionSource('posStartCartEntry_');
  const focus = functionSource('posFocusCartEntryQty_');
  assert.match(render, /value="'\s*\+\s*escapeHtml\(line\.name\)/);
  assert.match(start, /posRenderCart_\(\);[\s\S]*posFocusCartEntryQty_\(\)/);
  assert.doesNotMatch(focus, /setTimeout\s*\(/);
  assert.match(focus, /input\.focus\(\)/);
  assert.match(focus, /input\.select\(\)/);
});

test('cart page Enter shortcut focuses Add Product without hijacking form controls or modals', () => {
  const shortcut = functionSource('posHandleCartFastEntryKeydown_');
  const interactive = functionSource('posCartFastEntryTargetIsInteractive_');

  assert.match(shortcut, /e\.key !== 'Enter'/);
  assert.match(shortcut, /currentPage !== 'pos'/);
  assert.match(shortcut, /currentPage !== 'posv2'/);
  assert.match(shortcut, /confirmActionModal/);
  assert.match(shortcut, /\.modal-overlay:not\(\[hidden\]\)/);
  assert.match(shortcut, /posCartFastEntryTargetIsInteractive_\(e\.target\)/);
  assert.match(shortcut, /e\.preventDefault\(\)/);
  assert.match(shortcut, /posFocusCartEntryProduct_\(\)/);

  assert.match(interactive, /input, textarea, select, button/);
  assert.match(interactive, /a\[href\]/);
  assert.match(interactive, /contenteditable/);
  assert.match(pos, /document\.addEventListener\('keydown', posHandleCartFastEntryKeydown_\)/);
});

test('quantity Enter completes the active line and focuses the next Add Product row', () => {
  const finish = functionSource('posFinishCartEntry_');
  const start = pos.indexOf("document.getElementById('posCartList').addEventListener('keydown'");
  const end = pos.indexOf("document.getElementById('posCartList').addEventListener('scroll'", start);
  const keyArea = pos.slice(start, end);

  assert.match(keyArea, /data-cart-entry-qty/);
  assert.match(keyArea, /e\.key === 'Enter'/);
  assert.match(keyArea, /posFinishCartEntry_\(\)/);
  assert.match(finish, /posState\.cartEntryIndex = null/);
  assert.match(finish, /posRenderCart_\(\)/);
  assert.match(finish, /posFocusCartEntryProduct_\(\)/);
});

test('inline Add product and replace search support ArrowUp ArrowDown and Enter selected option', () => {
  const move = functionSource('posMoveCartProductActive_');
  const active = functionSource('posActiveCartProductOption_');
  assert.match(move, /Arrow|delta|activeIndex|aria-selected|scrollIntoView/);
  assert.match(active, /data-cart-product-pick/);

  const start = pos.indexOf("document.getElementById('posCartList').addEventListener('keydown'");
  const end = pos.indexOf("document.getElementById('posCartList').addEventListener('scroll'", start);
  const keyArea = pos.slice(start, end);
  assert.match(keyArea, /e\.key === 'ArrowDown'/);
  assert.match(keyArea, /e\.key === 'ArrowUp'/);
  assert.match(keyArea, /posMoveCartProductActive_/);
  assert.match(keyArea, /posActiveCartProductOption_/);
  assert.doesNotMatch(keyArea, /posCartProductMatches_\(e\.target\.value\)\[0\]/);
});

test('rendered cart search popup starts with one keyboard-active suggestion', () => {
  const render = functionSource('posRenderCartProductResults_');
  assert.match(render, /dataset\.activeIndex\s*=\s*html\s*\?\s*['"]0['"]\s*:\s*['"]-1['"]/);
  assert.match(render, /aria-selected/);
  assert.match(render, /is-active/);
});

test('purchase price reveal has room for long prices and eye sits inward from edge', () => {
  assert.match(css, /#page-pos \.cart-row \.c-name-title\s*\{[\s\S]*flex:\s*1\s+1\s+auto/);
  assert.match(css, /#page-pos \.cart-row \.c-cost\s*\{[^}]*margin-right:\s*8px/);
  assert.match(css, /#page-pos \.cart-row \.c-cost\.is-revealed\s*\{[^}]*min-width:\s*90px[^}]*white-space:\s*nowrap/);
});

test('cart line total uses normal sans/Inter family, not mono, in Classic and V2', () => {
  assert.match(css, /#page-pos \.cart-row \.c-line-total\s*\{[^}]*font-family:\s*var\(--font-sans\)/);
  const monoGroupStart = v2.indexOf("body.pos-v2-active #page-pos .mono");
  const monoGroupEnd = v2.indexOf('{', monoGroupStart);
  const monoGroup = v2.slice(monoGroupStart, monoGroupEnd);
  assert.doesNotMatch(monoGroup, /\.c-line-total/);
  assert.match(v2, /body\.pos-v2-active #page-pos \.cart-row \.c-line-total\s*\{[^}]*font-family:\s*['"]Inter['"]/);
});


test('cart Add Product suggests products before typing and filters entered text', () => {
  const sample = [
    { id: '1', name: 'RFL Pipe', category: 'Pipe', brand: 'RFL', unit: 'Foot', stock: 400, autoSellingPrice: 70 },
    { id: '2', name: 'Small Nail', category: 'Hardware', brand: 'ABC', unit: 'pcs', stock: 0, sellingPrice: 3 }
  ];
  const picker = new Function('posState', 'smartSearchProducts_', 'escapeHtml', 'formatMoney',
    functionSource('posCartProductMatches_') + '\n' +
    functionSource('posCartProductResultsHtml_') + '\n' +
    'return {matches:posCartProductMatches_, html:posCartProductResultsHtml_};'
  )({ products: sample },
    (products, query, limit) => products.filter(p => p.name.toLowerCase().includes(query.toLowerCase())).slice(0, limit),
    value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
    amount => '৳' + String(amount)
  );
  assert.strictEqual(picker.matches('').length, 2);
  assert.strictEqual(picker.matches('  ').length, 2);
  assert.strictEqual(picker.matches('pipe').length, 1);
  assert.strictEqual(picker.matches('does-not-exist').length, 0);
  const html = picker.html('', 'add', null);
  for (const expected of ['RFL Pipe', 'Category: Pipe', 'Brand: RFL', '৳70', '/Foot', '400 Foot available', 'Out of stock']) {
    assert.ok(html.includes(expected), 'dropdown should show ' + expected);
  }
  assert.doesNotMatch(html, /<img\b/i);
  assert.match(html, /role="option"/);
  assert.match(html, /pos-cart-product-option-0/);
});

test('cart dropdown opens on focus or click without changing other POS workflows', () => {
  const start = pos.indexOf("document.getElementById('posCartList').addEventListener('focusin'");
  const end = pos.indexOf("document.getElementById('posCartList').addEventListener('input'", start);
  const handlers = pos.slice(start, end);
  assert.match(handlers, /focusin/);
  assert.match(handlers, /addEventListener\('click'/);
  assert.match(handlers, /posRenderCartProductResults_/);
  const render = functionSource('posRenderCartProductResults_');
  const close = functionSource('posCloseCartProductPopup_');
  assert.match(render, /document\.activeElement !== input/);
  assert.match(render, /aria-expanded/);
  assert.match(render, /aria-activedescendant/);
  assert.match(close, /aria-expanded/);
  assert.match(v2, /body\.pos-v2-active \.pos-cart-product-popup \.pos-picker-main/);
  assert.match(v2, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(300px,\s*23vw\)/);
  assert.match(pos, /serverCall\('findSalesByPhone', authToken, phone, customerId\)/);
  assert.match(pos, /serverCall\('completeSale', authToken, payload\)/);
});

console.log('\n' + pass + '/' + (pass + fail) + ' passed');
if (fail) process.exit(1);
