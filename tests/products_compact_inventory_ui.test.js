'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const html = read('products.html');
const css = read('style.html');

function renderedRows(products) {
  const rows = [];
  const body = { innerHTML: '', appendChild(row) { rows.push(row.innerHTML); } };
  const empty = { hidden: false };
  const el = id => {
    if (id === 'prodTableBody') return body;
    if (id === 'prodEmptyState') return empty;
    return { value: '' };
  };
  const helper = html.match(/  function prodUnitLabel_\(unit\) \{[\s\S]*?\n  \}/);
  assert.ok(helper, 'a unit display helper must exist without mutating stored Unit');
  const start = html.indexOf('  function prodRender() {');
  const end = html.indexOf('\n  var prodSearchInput_', start);
  assert.ok(start >= 0 && end > start, 'product renderer remains intact');
  const ctx = {
    prodState: { products }, document: { getElementById: el, createElement: () => ({ innerHTML: '' }) },
    window: { requestAnimationFrame: null },
    prodCloseActionMenu_() {}, prodSortRows_: v => v, smartSearchProducts_: v => v,
    prodSyncSearchClear_() {}, prodUpdateSortHeaders_() {},
    escapeHtml: v => String(v ?? ''),
    formatMoney: v => '৳' + v,
    rowActionTriggerHtml_: () => '<button data-act="menu">⋯</button>'
  };
  vm.runInNewContext(helper[0] + '\n' + html.slice(start, end) + '\nprodRender();', ctx);
  return rows;
}

test('Products columns use Product, Category, Stock, Purchase, Selling and no duplicate Unit column', () => {
  const head = html.split('<thead>')[1].split('</thead>')[0];
  const keys = Array.from(head.matchAll(/data-sort-key="([^"]+)"/g), m => m[1]);
  assert.deepEqual(keys, ['name', 'category', 'stockQty', 'purchasePrice', 'sellingPrice', 'stockValue', 'status']);
  assert.doesNotMatch(head, /<th[^>]*>\s*Unit\s*<\/th>/i);
});

test('Products put unit in stock and selling, keep brand-only subline, and show minimum stock', () => {
  const [row] = renderedRows([{
    'Product ID': 'p1', 'Product Name': 'Nipple AG', Brand: 'AG', Category: 'GI Fittings',
    Unit: 'pc', 'Current Stock': 86, 'Minimum Stock': 30, 'Purchase Price': 365,
    'Selling Price': 420, 'Stock Value': 31390, Status: 'Active'
  }]);
  assert.match(row, /prod-item-meta[^>]*>AG<\/div>/, 'product subtitle contains only brand, not the unit');
  assert.match(row, /86\s*<span[^>]*>Pcs<\/span>/);
  assert.match(row, /min 30 Pcs/);
  assert.match(row, /৳420[\s\S]*?\/Pcs/);
  assert.doesNotMatch(row, /AG · pc|AG · Pcs/);
  assert.match(row, /In stock/);
});

test('Low and out-of-stock styling follows quantity while inactive status remains distinct', () => {
  const rows = renderedRows([
    { 'Product ID': 'low', 'Product Name': 'Wire', Unit: 'kg', Brand: '', Category: 'Steel', 'Current Stock': 8, 'Minimum Stock': 25, 'Purchase Price': 126, 'Selling Price': 145, 'Stock Value': 1008, Status: 'Active' },
    { 'Product ID': 'out', 'Product Name': 'Valve', Unit: 'pc', Brand: '', Category: 'Plumbing', 'Current Stock': 0, 'Minimum Stock': 10, 'Purchase Price': 540, 'Selling Price': 650, 'Stock Value': 0, Status: 'Active' },
    { 'Product ID': 'off', 'Product Name': 'Old', Unit: 'pc', Brand: '', Category: 'Other', 'Current Stock': 20, 'Minimum Stock': 3, 'Purchase Price': 1, 'Selling Price': 2, 'Stock Value': 20, Status: 'Inactive' }
  ]);
  assert.match(rows[0], /8\s*<span[^>]*>Kg<\/span>/);
  assert.match(rows[0], /Low stock/);
  assert.match(rows[1], /Out of stock/);
  assert.match(rows[2], /Inactive/);
  assert.doesNotMatch(rows[2], /In stock/);
});

test('Bundle keeps set availability, no fabricated unit conversions, and retains action menu', () => {
  const [row] = renderedRows([{ 'Product ID': 'bundle', 'Product Type': 'Bundle', 'Product Name': 'Fixture Set', Unit: 'Set', Brand: '', Category: 'Sets', 'Current Stock': 0, 'Minimum Stock': 0, 'Available Sets': 4, 'Purchase Price': 0, 'Selling Price': 500, 'Stock Value': 0, Status: 'Active' }]);
  assert.match(row, /4\s*<span[^>]*>Sets<\/span>/);
  assert.doesNotMatch(row, /min 0/);
  assert.match(row, /data-act="menu"/);
});

test('Unspecified product unit never adds a dangling slash to selling price', () => {
  const [row] = renderedRows([{ 'Product ID': 'no-unit', 'Product Name': 'Service', Unit: '', Brand: '', Category: '', 'Current Stock': 1, 'Minimum Stock': 0, 'Purchase Price': 10, 'Selling Price': 20, 'Stock Value': 10, Status: 'Active' }]);
  assert.match(row, /৳20/);
  assert.doesNotMatch(row, /\/</);
});

test('Compact Products classes are module-scoped and existing sticky header/action behavior stays intact', () => {
  assert.match(css, /#page-products #prodTable td\s*\{/);
  assert.match(css, /#page-products \.prod-item-name\s*\{/);
  assert.match(css, /#page-products \.prod-cell-sub\s*\{/);
  assert.match(html, /function prodSyncPinnedHeader_\(refreshColumns\)/);
  assert.match(html, /rowActionTriggerHtml_\(/);
  assert.match(html, /class="mobile-card-table erp-action-table"/);
});
