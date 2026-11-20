'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const html = read('products.html');
const css = read('style.html');

function renderedRows(products, options = {}) {
  const rows = [];
  const body = { innerHTML: '', appendChild(row) { rows.push(row.innerHTML); } };
  const empty = { hidden: false };
  const el = id => {
    if (id === 'prodTableBody') return body;
    if (id === 'prodEmptyState') return empty;
    if (id === 'prodStockIssuesBtn') return { textContent: '', setAttribute() {}, classList: { toggle() {} } };
    return { value: '' };
  };
  const helper = html.match(/  function prodUnitLabel_\(unit\) \{[\s\S]*?\n  \}/);
  assert.ok(helper, 'unit display helper must not mutate saved product units');
  const stockIssues = html.match(/  function prodHasStockIssue_\(product\) \{[\s\S]*?\n  \}/);
  const start = html.indexOf('  function prodRender() {');
  const end = html.indexOf('\n  var prodSearchInput_', start);
  assert.ok(start >= 0 && end > start);
  const ctx = {
    prodState: { products, showStockChecks: !!options.onlyIssues }, document: { getElementById: el, createElement: () => ({ innerHTML: '' }) },
    window: { requestAnimationFrame: null },
    prodCloseActionMenu_() {}, prodSortRows_: v => v, smartSearchProducts_: v => v,
    prodSyncSearchClear_() {}, prodUpdateSortHeaders_() {},
    escapeHtml: v => String(v ?? ''),
    formatMoney: v => '৳' + v,
    rowActionTriggerHtml_: () => '<button data-act="menu">⋯</button>'
  };
  vm.runInNewContext(helper[0] + '\n' + (stockIssues ? stockIssues[0] : '') + '\n' + html.slice(start, end) + '\nprodRender();', ctx);
  return rows;
}
function cells(row) {
  return Array.from(row.matchAll(/<td(?:\s[^>]*)?>([\s\S]*?)<\/td>/g), match => match[1]);
}
function visibleText(markup) {
  return markup.replace(/<[^>]*>/g, '').trim();
}

test('Products table headers match approved compact tablet order and retain all actions', () => {
  const head = html.split('<thead>')[1].split('</thead>')[0];
  const keys = Array.from(head.matchAll(/data-sort-key="([^"]+)"/g), m => m[1]);
  assert.deepEqual(keys, ['name', 'category', 'purchasePrice', 'sellingPrice', 'stockQty', 'stockValue', 'status']);
  assert.match(head, /erp-sticky-action-col/);
  assert.doesNotMatch(head, /<th[^>]*>\s*Unit\s*<\/th>/i);
});

test('Product column displays only name, no brand, unit, bundle badge, or unpriced lot badge', () => {
  const [row] = renderedRows([{
    'Product ID': 'p1', 'Product Name': 'Test Bundle Products 100 pcs 2',
    Brand: 'BRB', Category: 'Pipe', Unit: 'pc', 'Current Stock': 80, 'Minimum Stock': 30,
    'Purchase Price': 120, 'Next FIFO Cost': 120, 'Lot Cost Status': 'OK', 'Selling Price': 130, 'Stock Value': 9600,
    'Unpriced Lot Count': 2, Status: 'Active'
  }]);
  const columns = cells(row);
  assert.equal(columns.length, 8);
  assert.equal(visibleText(columns[0]), 'Test Bundle Products 100 pcs 2');
  assert.doesNotMatch(columns[0], /prod-item-meta|Bundle<\/span>|Unpriced lots|BRB/);
  assert.match(columns[0], /title="Test Bundle Products 100 pcs 2"/);
  assert.equal(visibleText(columns[1]), 'Pipe');
  assert.equal(visibleText(columns[2]), '৳120');
  assert.equal(visibleText(columns[3]), '৳130');
  assert.match(columns[4], /80\s*<span[^>]*>pcs<\/span>/);
  assert.doesNotMatch(columns[4], /prod-cell-sub|<div[^>]*>min 30/);
  assert.match(columns[4], /title="[^"]*30 pcs/);
  assert.match(columns[4], /Unpriced lots: 2/);
  assert.equal(visibleText(columns[5]), '৳9600');
  assert.equal(visibleText(columns[6]), 'Active');
  assert.match(columns[7], /data-act="menu"/);
});

test('Bundles show one-line available sets without clutter in Product column', () => {
  const [row] = renderedRows([{
    'Product ID': 'b1', 'Product Type': 'Bundle', 'Product Name': 'TEST BUNDLE 1',
    Category: 'Bundle', Unit: 'set', Brand: 'Supplier', 'Available Sets': 8,
    'Current Stock': 0, 'Minimum Stock': 0, 'Purchase Price': 0,
    'Selling Price': 1500, 'Stock Value': 0, Status: 'Active'
  }]);
  const c = cells(row);
  assert.equal(visibleText(c[0]), 'TEST BUNDLE 1');
  assert.equal(visibleText(c[4]), '8 sets');
  assert.equal(visibleText(c[3]), '৳1500');
  assert.equal(visibleText(c[6]), 'Active');
  assert.equal(visibleText(c[2]), '—');
  assert.equal(visibleText(c[5]), '—');
});

test('Low and out-of-stock warning stays in stock cell; status means Active or Inactive', () => {
  const rows = renderedRows([
    { 'Product ID': 'low', 'Product Name': 'Tee', Unit: 'pc', Brand: 'BRB', Category: 'uPVC', 'Current Stock': 2, 'Minimum Stock': 10, 'Purchase Price': 50, 'Selling Price': 60, 'Stock Value': 100, Status: 'Active' },
    { 'Product ID': 'out', 'Product Name': 'Valve', Unit: 'kg', Brand: '', Category: 'Steel', 'Current Stock': 0, 'Minimum Stock': 4, 'Purchase Price': 50, 'Selling Price': 60, 'Stock Value': 0, Status: 'Active' },
    { 'Product ID': 'off', 'Product Name': 'Old', Unit: 'pc', Brand: '', Category: '', 'Current Stock': 30, 'Minimum Stock': 2, 'Purchase Price': 1, 'Selling Price': 2, 'Stock Value': 30, Status: 'Inactive' }
  ]);
  assert.equal(visibleText(cells(rows[0])[4]), '2 pcs');
  assert.match(cells(rows[0])[4], /prod-stock-low/);
  assert.match(cells(rows[0])[4], /title="[^"]*10 pcs"/);
  assert.equal(visibleText(cells(rows[0])[6]), 'Active');
  assert.match(cells(rows[1])[4], /prod-stock-out/);
  assert.equal(visibleText(cells(rows[1])[6]), 'Active');
  assert.equal(visibleText(cells(rows[2])[6]), 'Inactive');
});

test('Product with unspecified unit shows bare quantity and selling price without a slash', () => {
  const [row] = renderedRows([{
    'Product ID': 'no-unit', 'Product Name': 'Service', Unit: '', Brand: '', Category: '',
    'Current Stock': 1, 'Minimum Stock': 0, 'Purchase Price': 10,
    'Selling Price': 20, 'Stock Value': 10, Status: 'Active'
  }]);
  assert.equal(visibleText(cells(row)[4]), '1');
  assert.equal(visibleText(cells(row)[3]), '৳20');
  assert.doesNotMatch(row, /\/Pcs|\/<|undefined/);
});

test('Tablet and desktop Products rows are single line with horizontal overflow and compact spacing', () => {
  assert.match(css, /@media screen and \(min-width:\s*541px\)/);
  assert.match(css, /#page-products #prodTable\s*\{[^}]*min-width:\s*\d+px;/s);
  assert.match(css, /#page-products #prodTable th,\s*#page-products #prodTable td\s*\{[^}]*white-space:\s*nowrap;/s);
  assert.match(css, /#page-products #prodTable \.prod-item-name\s*\{[^}]*text-overflow:\s*ellipsis;/s);
  assert.match(css, /#page-products #prodTableScroll\s*\{[^}]*overflow-x:\s*auto;/s);
  assert.match(css, /#page-products #prodTable th\.erp-sticky-action-col,[\s\S]*#page-products #prodTable td\.erp-sticky-action-col/);
});

test('Products preserve phone cards, filters, sorting and conditional pinned headings', () => {
  assert.match(html, /class="mobile-card-table erp-action-table"/);
  assert.match(html, /function prodSyncPinnedHeader_\(refreshColumns\)/);
  assert.match(html, /prodSortKey_\(sortButton\.dataset\.sortKey\)/);
  assert.match(html, /rowActionTriggerHtml_\(/);
  assert.match(html, /document\.getElementById\('prodBrandFilter'\)\.addEventListener\('change', prodRender\)/);
  assert.match(css, /@media screen and \(max-width:\s*540px\)[^{]*\{/);
});

test('Mirrored Products heading uses the same padding as the real heading on tablets', () => {
  assert.match(css, /#page-sales #smTableScroll th,\s*#page-products #prodTable th\s*\{\s*padding:\s*9px 12px;/s);
  assert.match(css, /#page-sales #smTableScroll td,\s*#page-products #prodTable td\s*\{\s*padding:\s*8px 12px;\s*line-height:\s*1\.35;/s);
  assert.match(css, /\.sm-pinned-sales-header th,\s*\.prod-pinned-header th\s*\{[^}]*padding:\s*9px 12px;/s);
  assert.doesNotMatch(css, /\.prod-pinned-header th\s*\{\s*padding:\s*6px 7px;/s);
});

test('estimated inventory values are concise, while genuine quantity mismatch stays inspectable', () => {
 const [row] = renderedRows([{
  'Product ID':'PIPE', 'Product Name':'4-inch Pipe', 'Product Type':'Standard',
  Category:'Pipe',Unit:'Foot','Current Stock':396,'Minimum Stock':2,
  'Selling Price':75,'Next FIFO Cost':null,'Stock Value':null,
  'Provisional FIFO Cost':70,'Provisional Stock Value':27860,
  'Provisional Lot Quantity':398,'Lot Quantity Difference':2,
  'Lot Cost Status':'NEEDS_REVIEW','Lot Cost Issue':'STOCK_MISMATCH',Status:'Active'
 }]);
 const c=cells(row);
 assert.equal(visibleText(c[2]), '≈৳70 ⓘ');
 assert.equal(visibleText(c[5]), '≈৳27860 ⓘ');
 assert.match(c[2], /Lot total.*398/);
 assert.match(c[5], /product stock.*396/);
 assert.doesNotMatch(c[2]+c[5], /est\. · Reconcile|est\. · Review/);
});
test('unsettled stock estimates show only compact numbers without a false data-error icon',()=>{
 const [row] = renderedRows([{
 'Product ID':'P','Product Name':'Pipe','Current Stock':9,
 'Next FIFO Cost':64.75,'Lot Cost Status':'UNSETTLED','Lot Cost Issue':'',
 'Stock Value':null,'Provisional Stock Value':582.75,'Provisional FIFO Cost':64.75,
 'Selling Price':75, Status:'Active'
 }]);
 const c=cells(row);
 assert.equal(visibleText(c[2]), '≈৳64.75');
 assert.equal(visibleText(c[5]), '≈৳582.75');
 assert.doesNotMatch(c[2]+c[5], /ⓘ/);
});
test('stock checks filter finds real issues, not every estimated inventory value',()=>{
 const items=[
 {'Product ID':'clean','Product Name':'Clean', 'Current Stock':5,'Stock Value':100,'Lot Cost Status':'OK'},
 {'Product ID':'pending','Product Name':'Pending', 'Current Stock':4,'Lot Cost Status':'UNSETTLED'},
 {'Product ID':'bad','Product Name':'Bad', 'Current Stock':8,'Lot Cost Status':'NEEDS_REVIEW','Lot Cost Issue':'STOCK_MISMATCH'},
 {'Product ID':'bundle','Product Name':'Bundle', 'Product Type':'Bundle','Lot Cost Issue':'STOCK_MISMATCH'}
 ];
 const rows=renderedRows(items,{onlyIssues:true});
 assert.equal(rows.length,1);
 assert.match(rows[0], /Bad/);
 assert.match(html,/id="prodStockIssuesBtn"/);
 assert.match(html,/prodState\.showStockChecks\s*=\s*!prodState\.showStockChecks/);
});
