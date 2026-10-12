'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const pos = fs.readFileSync(path.join(root, 'pos.html'), 'utf8');
const v2 = fs.readFileSync(path.join(root, 'posv2.html'), 'utf8');

function functionSource(name) {
  const start = pos.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, name + ' is missing');
  const opening = pos.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
  for (let i = opening; i < pos.length; i++) {
    const c = pos[i], next = pos[i + 1];
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
    } else if (c === '/' && next === '/') {
      while (i < pos.length && pos[i] !== '\n') i++;
    } else if (c === '/' && next === '*') {
      i = pos.indexOf('*/', i + 2);
      assert.notEqual(i, -1, 'Unclosed comment in ' + name);
      i++;
    } else if (c === '"' || c === "'" || c === String.fromCharCode(96)) {
      quote = c;
    } else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return pos.slice(start, i + 1);
  }
  throw new Error('Unclosed function: ' + name);
}

function check(label, fn) {
  fn();
  console.log('PASS', label);
}
const products = Array.from({length: 12}, (_, i) => ({
  id: String(i + 1), name: 'Product ' + i, unit: 'pcs',
  category: 'Hardware', brand: 'Test', sellingPrice: i + 10,
  stock: i === 2 ? 0 : 10
}));

function sandbox(isV2) {
  const world = {
    posState: { products },
    document: {body: {classList: {contains: name => isV2 && name === 'pos-v2-active'}}},
    smartSearchProducts_: (all, query, limit) => all.filter(p =>
      !query || p.name.toLowerCase().includes(String(query).toLowerCase())).slice(0, limit),
    escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
    formatMoney: value => '৳' + Number(value)
  };
  vm.runInNewContext(functionSource('posCartProductMatches_') + '\n' +
    functionSource('posCartProductResultsHtml_'), world);
  return world;
}

check('empty inline product focus produces first eight suggestions in POS V2', () => {
  const context = sandbox(true);
  assert.equal(context.posCartProductMatches_('').length, 8);
  assert.equal(context.posCartProductMatches_('   ').length, 8);
});

check('Classic POS retains original blank-query behavior', () => {
  assert.equal(sandbox(false).posCartProductMatches_('').length, 0);
});

check('typed search works through the existing product matcher', () => {
  const context = sandbox(true);
  const results = context.posCartProductMatches_('Product 11');
  assert.equal(results.length, 1);
  assert.equal(results[0].id, '12');
});

check('suggestions show name, category, price, stock and unit without photos', () => {
  const context = sandbox(true);
  const html = context.posCartProductResultsHtml_('', 'add', null);
  assert.match(html, /pos-picker-name/);
  assert.match(html, /Hardware/);
  assert.match(html, /pos-picker-price/);
  assert.match(html, /৳10/);
  assert.match(html, /pos-picker-stock/);
  assert.match(html, /pcs/);
  assert.match(html, /Out of stock/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /data-cart-product-pick="1"/);
});

check('popup appears on keyboard focus and click but not on initial un-focused activation', () => {
  assert.match(pos, /addEventListener\('focusin', function \(e\) \{\s*posShowCartProductPicker_\(e\.target\)/);
  assert.match(pos, /addEventListener\('click', function \(e\) \{\s*if \(e\.target\.hasAttribute\('data-cart-product-input'\)\)/);
  assert.match(functionSource('posRenderCartProductResults_'), /document\.activeElement !== input/);
  assert.match(functionSource('posRenderCartProductResults_'), /aria-expanded/);
  assert.match(functionSource('posMoveCartProductActive_'), /aria-activedescendant/);
  assert.match(functionSource('posCloseCartProductPopup_'), /aria-expanded.*false/);
});

check('live POS edit, Enter, Qty, shortcut, and shortage behavior remain attached', () => {
  assert.match(pos, /function posChooseCartProduct_\(/);
  assert.match(pos, /function posReplaceCartProduct_\(/);
  assert.match(pos, /function posStartCartEntry_\(/);
  assert.match(pos, /function posFinishCartEntry_\(/);
  assert.match(pos, /posFocusCartEntryQty_\(\)/);
  assert.match(pos, /posFocusCartEntryProduct_\(\)/);
  assert.match(pos, /function posShortagePanelHtml_\(/);
  assert.match(pos, /posActiveCartProductOption_\(\)/);
  assert.match(pos, /function posHandleCartFastEntryKeydown_\(/);
});

check('POS V2 keeps the catalog hidden and its existing search toolbar', () => {
  assert.match(v2, /#posProductGrid,[\s\S]*?display: none !important/);
  assert.match(v2, /function posV2BindSearch_\(/);
  assert.match(v2, /function posV2EnsureSearchToolbar_\(/);
  assert.match(v2, /posV2BindSearch_\(\)/);
  assert.doesNotMatch(v2, /pos-v2-quick-items|posV2SetCatalogTitle_/);
  assert.match(v2, /body\.pos-v2-active \.pos-cart-product-popup \{/);
});

check('responsive combobox and checkout reuse existing shared DOM and payment workflow', () => {
  assert.match(v2, /min-width:\s*541px/);
  assert.match(v2, /max-width:\s*540px/);
  assert.match(v2, /customer\.appendChild\(refs\.summary\)/);
  assert.match(v2, /customer\.appendChild\(refs\.actions\)/);
  assert.match(v2, /data-pos-v2-tab="payment"/);
  assert.match(pos, /id="posPaymentMethod"/);
  assert.match(pos, /id="posSaveDraftBtn"/);
  assert.match(pos, /id="posCompleteBtn"/);
});

console.log('POS HisabIQ inline focus-picker design checks passed.');
