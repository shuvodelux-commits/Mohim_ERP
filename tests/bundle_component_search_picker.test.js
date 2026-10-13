'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'products.html'), 'utf8');

function functionSource_(name) {
  const start = html.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, name + ' must exist');
  const open = html.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < html.length; i++) {
    if (html[i] === '{') depth++;
    if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error('Function body missing: ' + name);
}

function pickerFixture_() {
  const elements = {};
  let toast = '';
  function makeElement() {
    const events = {};
    return {
      value: '', hidden: false, dataset: {}, style: {}, attributes: {},
      events, innerHTML: '', scrollHeight: 180,
      classList: { toggle() {} },
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(name, handler) { (events[name] || (events[name] = [])).push(handler); },
      dispatch(name, event = {}) { (events[name] || []).forEach(handler => handler(event)); },
      click() { this.dispatch('click', { preventDefault() {}, target: this }); },
      focus() { this.focused = true; this.dispatch('focus'); },
      select() { this.selected = true; },
      getBoundingClientRect() { return { left: 75, top: 200, bottom: 240, width: 230 }; },
      querySelectorAll() {
        return Array.from(this.innerHTML.matchAll(/data-bundle-pick="(\d+)"/g), () => ({
          classList: { toggle() {} },
          setAttribute() {}, scrollIntoView() {}
        }));
      },
      contains() { return false; }
    };
  }
  ['prodBundleSearch', 'prodBundleClear', 'prodBundleQty', 'prodBundleAddItem',
    'prodBundleEditor', 'prodBundleItems'].forEach(id => { elements[id] = makeElement(); });
  const document = {
    body: { appendChild(node) { elements[node.id] = node; } },
    getElementById: id => elements[id] || null,
    createElement: makeElement,
    addEventListener() {}
  };
  const products = [
    { 'Product ID': 'PIPE-1', 'Product Name': 'PVC Pipe', Unit: 'pcs', Status: 'Active', 'Product Type': 'Standard', 'Current Stock': 15 },
    { 'Product ID': 'PIPE-2', 'Product Name': 'Steel Pipe', Unit: 'feet', Status: 'Active', 'Product Type': 'Standard', 'Current Stock': 5 },
    { 'Product ID': 'PIPE-3', 'Product Name': 'Old Pipe', Unit: 'pcs', Status: 'Inactive', 'Product Type': 'Standard' },
    { 'Product ID': 'BUNDLE', 'Product Name': 'Pipe Set', Status: 'Active', 'Product Type': 'Bundle' },
    { 'Product ID': 'VALVE', 'Product Name': 'Valve', Unit: 'pcs', Status: 'Active', 'Product Type': 'Standard' }
  ];
  const ctx = {
    document, window: { innerWidth: 900, innerHeight: 700, addEventListener() {} },
    prodState: { products, bundleItems: [] },
    smartSearchProducts_: (list, query, limit) => list.filter(p =>
      p['Product Name'].toLowerCase().includes(query.toLowerCase())).slice(0, limit),
    escapeHtml: value => String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
    showToast: message => { toast = message; }
  };
  vm.createContext(ctx);
  vm.runInContext('var prodBundleMatches_ = []; var prodBundleActiveIndex_ = -1;', ctx);
  [
    'prodBundlePopup_', 'prodBundleCloseSearch_', 'prodBundleSyncClear_', 'prodBundleResetSearch_',
    'prodBundleHighlight_', 'prodBundlePlaceSearch_', 'prodBundleShowSearch_', 'prodBundleChoose_',
    'prodBundleRender_'
  ].forEach(name => vm.runInContext(functionSource_(name), ctx, { filename: 'products.html' }));

  const wireStart = html.indexOf('  var prodBundleSearchInput_ =');
  const wireEnd = html.indexOf('  function prodBundleRender_()', wireStart);
  assert.ok(wireStart > 0 && wireEnd > wireStart);
  vm.runInContext(html.slice(wireStart, wireEnd), ctx);

  const addStart = html.indexOf("  document.getElementById('prodBundleAddItem').addEventListener('click'");
  const addEnd = html.indexOf("  document.getElementById('prodBundleItems').addEventListener('click'", addStart);
  assert.ok(addStart > 0 && addEnd > addStart);
  vm.runInContext(html.slice(addStart, addEnd), ctx);
  return { ctx, elements, getToast: () => toast };
}

test('bundle editor uses searchable product input instead of dropdown', () => {
  assert.match(html, /id="prodBundleSearch"[^>]*role="combobox"/);
  assert.match(html, /id="prodBundleClear"/);
  assert.doesNotMatch(html, /id="prodBundleSelect"/);
  assert.match(html, /smartSearchProducts_\(available, query, 12\)/);
  assert.match(html, /popup\.style\.position = 'fixed'/);
  assert.match(html, /document\.body\.appendChild\(popup\)/);
  assert.match(html, /data-bundle-pick/);
  assert.match(html, /e\.key === 'ArrowDown'/);
  assert.match(html, /e\.key === 'ArrowUp'/);
  assert.match(html, /e\.key === 'Enter'/);
  assert.match(html, /components: prodState\.bundleItems\.slice\(\)/);
});

test('search filters ineligible components, Enter selects, quantity Enter adds and resets', () => {
  const { ctx, elements, getToast } = pickerFixture_();
  const search = elements.prodBundleSearch;
  search.value = 'pipe';
  search.dispatch('input');
  const popup = elements.prodBundleResults;
  assert.equal(popup.hidden, false);
  assert.match(popup.innerHTML, /PVC Pipe/);
  assert.match(popup.innerHTML, /Steel Pipe/);
  assert.doesNotMatch(popup.innerHTML, /Old Pipe|Pipe Set/);
  assert.match(popup.innerHTML, /Stock 15 pcs/);

  search.dispatch('keydown', { key: 'ArrowDown', preventDefault() {} });
  search.dispatch('keydown', { key: 'Enter', preventDefault() {} });
  assert.equal(search.dataset.selectedId, 'PIPE-2');
  assert.equal(elements.prodBundleQty.focused, true);
  assert.equal(popup.hidden, true);

  elements.prodBundleQty.value = '3';
  elements.prodBundleQty.dispatch('keydown', { key: 'Enter', preventDefault() {} });
  assert.deepEqual(Array.from(ctx.prodState.bundleItems, x => ({ productId: x.productId, qtyPerSet: x.qtyPerSet })),
    [{ productId: 'PIPE-2', qtyPerSet: 3 }]);
  assert.equal(search.value, '');
  assert.equal(search.dataset.selectedId, '');
  assert.equal(elements.prodBundleQty.value, 1);
  assert.equal(getToast(), '');

  search.value = 'pipe';
  search.dispatch('input');
  assert.match(popup.innerHTML, /PVC Pipe/);
  assert.doesNotMatch(popup.innerHTML, /Steel Pipe/, 'already-added component cannot be selected again');
  assert.equal(ctx.prodState.bundleItems.length, 1);
});

test('typing is not treated as selection and unknown products cannot be added', () => {
  const { ctx, elements, getToast } = pickerFixture_();
  const search = elements.prodBundleSearch;
  search.value = 'not a real product';
  search.dispatch('input');
  assert.match(elements.prodBundleResults.innerHTML, /No matching products/);
  elements.prodBundleQty.value = '2';
  elements.prodBundleAddItem.click();
  assert.equal(ctx.prodState.bundleItems.length, 0);
  assert.match(getToast(), /Select a product from search/);

  search.value = 'valve';
  search.dispatch('input');
  ctx.prodBundleChoose_(0);
  assert.equal(search.dataset.selectedId, 'VALVE');
  elements.prodBundleClear.click();
  assert.equal(search.dataset.selectedId, '');
  assert.equal(search.value, '');
});
