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
  assert.match(render, /value="'\s*\+\s*posEscapeCartInputAttr_\(line\.name\)/);
  assert.match(start, /posRenderCart_\(\);[\s\S]*posFocusCartEntryQty_\(\)/);
  assert.doesNotMatch(focus, /setTimeout\s*\(/);
  assert.match(focus, /input\.focus\(\)/);
  assert.match(focus, /input\.select\(\)/);
});

test('selected pipe names with double quotes remain complete in the active cart input', () => {
  const escapeAttr = new Function('escapeHtml',
    functionSource('posEscapeCartInputAttr_') + '\nreturn posEscapeCartInputAttr_;'
  )(value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));

  const pipe = '6" SWR Pipe RFL 4.2';
  assert.strictEqual(escapeAttr(pipe), '6&quot; SWR Pipe RFL 4.2');
  assert.strictEqual(escapeAttr('O\'Reilly & Sons 4" Pipe'), 'O&#39;Reilly &amp; Sons 4&quot; Pipe');

  const cart = { children: [], appendChild(node) { this.children.push(node); }, insertAdjacentHTML() {} };
  const nodes = {
    posCartList: cart,
    posCartCount: { textContent: '' },
    posClearCartBtn: { disabled: false },
    posSaveDraftBtn: { disabled: false }
  };
  const document = {
    getElementById(id) { return nodes[id] || null; },
    createElement() { return { innerHTML: '', className: '' }; }
  };
  const posState = {
    cart: [{ productId: 'pipe6', name: pipe, unit: 'Foot', qty: 1,
      unitPrice: 170, lineTotal: 170, priceMode: 'fixed' }],
    cartEditIndex: null,
    cartEntryIndex: 0
  };
  new Function('document', 'posState', 'posEscapeCartInputAttr_', 'escapeHtml',
    'formatMoney', 'posShortagePanelHtml_', 'posEnhanceTabletSelects_', 'posRecalcTotals_',
    functionSource('posRenderCart_') + '\nposRenderCart_();'
  )(document, posState, escapeAttr, value => String(value), value => '৳' + value,
    () => '', () => {}, () => {});
  assert.strictEqual(cart.children.length, 2, 'active cart row and next empty add row');
  assert.match(cart.children[0].innerHTML, /value="6&quot; SWR Pipe RFL 4\.2"/);
  assert.match(cart.children[0].innerHTML, /aria-label="Product"/);
  assert.strictEqual(posState.cart[0].name, pipe, 'canonical stored name must remain unchanged');
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
  assert.match(move, /delta|activeIndex|aria-selected|popup\.scrollTop/);
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
  assert.match(render, /popup\.scrollTop\s*=\s*0/, 'new suggestions must scroll to the highlighted first item');
  assert.match(render, /aria-selected/);
  assert.match(render, /is-active/);
});

test('Qty Enter focuses Add Product and next Enter selects an available suggestion', () => {
  const products = [
    { id: '1', name: '4" SWR Pipe RFL 2.9' },
    { id: '2', name: '6" SWR Pipe RFL 4.2' },
    { id: '3', name: '6" SWR Pipe RFL 3.1 mm' },
    { id: '4', name: '4" SWR Pipe PPL 2.7' },
    { id: '5', name: '4" SWR Pipe PPL Gold 2.7' }
  ];
  const state = {
    products,
    cart: products.slice(0, 3).map(p => ({ productId: p.id, name: p.name })),
    cartEntryIndex: 2,
    cartEditIndex: null
  };
  const calls = [];
  let deferredFrame = null;
  const focusedInput = {
    isConnected: true,
    parentNode: { querySelector: () => ({}) },
    focus() { document.activeElement = this; calls.push('restore-focus-without-enter'); }
  };
  const document = {
    body: { classList: { contains: cls => cls === 'pos-v2-active' } },
    activeElement: focusedInput,
    querySelector: () => focusedInput,
    getElementById: () => null
  };
  const runtime = new Function('posState', 'smartSearchProducts_', 'showToast',
    'posCreateCartLine_', 'posRenderCart_', 'posFocusCartEntryProduct_', 'posFocusCartEntryQty_',
    'document', 'requestAnimationFrame', 'posV2EnhanceCartRows_',
    'posRenderCartProductResults_', 'posPlaceCartProductResults_',
    functionSource('posCartProductMatches_') + '\n' +
    functionSource('posFinishCartEntry_') + '\n' +
    functionSource('posStartCartEntry_') + '\n' +
    'return { matches:posCartProductMatches_, finish:posFinishCartEntry_, start:posStartCartEntry_ };'
  )(state, (list, query, limit) =>
      list.filter(p => p.name.toLowerCase().includes(query.toLowerCase())).slice(0, limit),
    message => calls.push('toast:' + message),
    p => ({ productId: p.id, name: p.name }),
    () => calls.push('render'),
    () => calls.push('focus-add'),
    () => calls.push('focus-qty'),
    document,
    fn => { deferredFrame = fn; },
    () => calls.push('decorate-v2-rows'),
    () => calls.push('open-dropdown'),
    () => calls.push('reposition-dropdown')
  );

  assert.strictEqual(runtime.finish(), true);
  assert.strictEqual(state.cartEntryIndex, null);
  assert.deepStrictEqual(calls.slice(0, 3), ['render', 'decorate-v2-rows', 'focus-add'],
    'V2 must finish laying out cart rows BEFORE focusing Add Product');
  assert.strictEqual(typeof deferredFrame, 'function', 'the popup needs a paint-frame stabilization');
  const openPopup = { hidden: false, _anchorInput: focusedInput };
  document.getElementById = () => openPopup;
  deferredFrame();
  assert.strictEqual(calls[3], 'reposition-dropdown',
    'the initially opened popup must snap beneath the finalized Add Product input');
  document.getElementById = () => null;
  deferredFrame();
  assert.strictEqual(calls[4], 'open-dropdown',
    'if a scroll event closed the popup, focus transition must reopen it automatically');

  // Reproduce the real browser failure: a cart DOM mutation detaches Qty,
  // making document.body active while an Add Product dropdown stays visible.
  // Typing must work immediately; no additional Enter may be required.
  document.getElementById = () => openPopup;
  document.activeElement = document.body;
  const focusBefore = calls.length;
  deferredFrame();
  assert.deepStrictEqual(calls.slice(focusBefore),
    ['restore-focus-without-enter', 'reposition-dropdown']);
  assert.strictEqual(document.activeElement, focusedInput,
    'Add Product must own the keyboard after Qty Enter, without another Enter');

  // An intentional move to another real input must not be overridden.
  const otherInput = { isConnected: true };
  document.activeElement = otherInput;
  const callsBeforeOtherInput = calls.length;
  deferredFrame();
  assert.strictEqual(document.activeElement, otherInput);
  assert.strictEqual(calls.length, callsBeforeOtherInput);

  const suggestions = runtime.matches('', 'add');
  assert.deepStrictEqual(suggestions.map(p => p.id), ['4', '5'],
    'do not highlight products already in the cart');
  assert.strictEqual(runtime.matches('RFL', 'add').length, 0,
    'typed Add Product search must also prevent duplicate selection');
  assert.strictEqual(runtime.matches('', 'v2-search').length, 0,
    'separate toolbar search retains blank-query behavior');

  assert.strictEqual(runtime.start(suggestions[0]), true,
    'first Enter on the highlighted new product succeeds');
  assert.strictEqual(state.cart.length, 4);
  assert.strictEqual(state.cart[3].name, products[3].name);
  assert.deepStrictEqual(calls.slice(-2), ['render', 'focus-qty']);
  assert.strictEqual(calls.filter(x => x.startsWith('toast:')).length, 0);
});

test('ArrowDown and ArrowUp scroll the dropdown only, not the page', () => {
  const items = [
    { id: '101', label: 'A' },
    { id: '102', label: 'B' },
    { id: '103', label: 'C' }
  ];
  const popup = {
    hidden: false,
    scrollTop: 0,
    dataset: { activeIndex: '0' },
    getBoundingClientRect() { return { top: 100, bottom: 142 }; },
    querySelectorAll() { return options; }
  };
  const options = items.map((item, i) => ({
    id: 'pos-cart-product-option-' + i,
    dataset: { cartProductPick: item.id },
    classList: { toggle() {} },
    setAttribute() {},
    scrollIntoView() { throw new Error('Page scrolling is forbidden'); },
    getBoundingClientRect() {
      return { top: 100 + i * 36 - popup.scrollTop, bottom: 136 + i * 36 - popup.scrollTop };
    }
  }));
  const input = {
    attrs: { 'aria-controls': 'posCartProductPopup' },
    getAttribute(key) { return this.attrs[key]; },
    setAttribute(key, value) { this.attrs[key] = value; }
  };
  const document = { activeElement: input, getElementById() { return popup; } };
  const handlers = new Function('document',
    functionSource('posMoveCartProductActive_') + '\n' +
    functionSource('posActiveCartProductOption_') + '\n' +
    'return { move:posMoveCartProductActive_, active:posActiveCartProductOption_ };'
  )(document);

  assert.strictEqual(handlers.move(1), options[1]);
  assert.strictEqual(input.attrs['aria-activedescendant'], options[1].id);
  assert.ok(popup.scrollTop > 0, 'only popup scrollbar should move');
  assert.strictEqual(handlers.move(1), options[2]);
  assert.strictEqual(handlers.active(), options[2]);
  assert.strictEqual(handlers.active().dataset.cartProductPick, '103');
  assert.strictEqual(handlers.move(-1), options[1]);
  assert.strictEqual(handlers.active().dataset.cartProductPick, '102');
});

test('Entering highlighted item works with numeric IDs and no extra Enter', () => {
  const lookup = new Function('posState',
    functionSource('posProductById_') + '\nreturn posProductById_;'
  )({ products: [{ id: 102, name: '6" SWR Pipe RFL 4.2' }] });
  assert.strictEqual(lookup('102').name, '6" SWR Pipe RFL 4.2');

  const keyArea = pos.slice(
    pos.indexOf("document.getElementById('posCartList').addEventListener('keydown'"),
    pos.indexOf("document.getElementById('posCartList').addEventListener('scroll'")
  );
  assert.match(keyArea, /if \(!option\) \{[\s\S]*posRenderCartProductResults_\(e\.target, enterHost, pickerMode, enterIndex\);[\s\S]*option = posActiveCartProductOption_\(\)/);
  assert.match(keyArea, /posChooseCartProduct_\(match, replaceIndex, pickerMode\)/);

  const anchor = functionSource('posKeepCartProductPopupAnchored_');
  assert.match(anchor, /posPlaceCartProductResults_\(input, popup\)/);
  assert.match(anchor, /popup\.contains/);
  assert.match(pos, /document\.addEventListener\('scroll', posKeepCartProductPopupAnchored_, true\)/);
});

test('clicking a detached dropdown option does not prematurely finish the Qty row', () => {
  const state = { cartEntryIndex: 3 };
  let finished = 0;
  const document = {
    getElementById(id) {
      if (id === 'posCartList') {
        return { querySelector() { return { contains() { return false; } }; } };
      }
      if (id === 'posCartProductPopup') {
        return { contains() { return false; } };
      }
      return null;
    }
  };
  const outsideClick = new Function('posState', 'document', 'posFinishCartEntry_',
    functionSource('posCartEntryOutsideClick_') + '\nreturn posCartEntryOutsideClick_;'
  )(state, document, () => { finished++; });

  outsideClick({ target: {
    closest(selector) {
      return selector === '[data-cart-product-pick]' ? { dataset: { cartProductPick: '4' } } : null;
    }
  } });
  assert.strictEqual(finished, 0,
    'product selection click must not complete its active entry row after popup HTML is removed');

  outsideClick({ target: { closest() { return null; } } });
  assert.strictEqual(finished, 1, 'genuine outside click must still finish an entry');
});

test('POS V2 cost eye is centered in full product cell, including revealed value', () => {
  const cell = v2.match(/body\.pos-v2-active #page-pos \.cart-row \.c-name\s*\{([^}]*)\}/);
  const main = v2.match(/body\.pos-v2-active #page-pos \.cart-row \.c-name-main\s*\{([^}]*)\}/);
  const eye = v2.match(/body\.pos-v2-active #page-pos \.cart-row \.c-cost\s*\{([^}]*)\}/);
  assert.ok(cell && main && eye, 'POS V2 cost eye placement selectors must exist');
  assert.match(cell[1], /position:\s*relative/);
  assert.match(main[1], /position:\s*static/);
  assert.match(eye[1], /position:\s*absolute/);
  assert.match(eye[1], /top:\s*50%/);
  assert.match(eye[1], /transform:\s*translateY\(-50%\)/);
  assert.match(v2, /body\.pos-v2-active #page-pos \.cart-row \.c-cost\.is-revealed\s*\{/);
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
