'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

function functionSource(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, name + ' must exist');
  const brace = source.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('Unclosed function: ' + name);
}

function loadFunctions(context, filename, names) {
  const source = read(filename);
  vm.createContext(context);
  names.forEach(name => vm.runInContext(functionSource(source, name), context, { filename }));
}

test('Products starts newest first without changing the bootstrap payload', async () => {
  const products = [
    { 'Product ID': 'OLD', 'Product Name': 'Apple', 'Created At': '' },
    { 'Product ID': 'NEW', 'Product Name': 'Zebra', 'Created At': '' }
  ];
  const context = {
    authToken: 'test',
    prodState: { products: [], categories: [], units: [], sortKey: '', sortDir: 'asc' },
    serverCall: name => {
      assert.equal(name, 'getProductsBootstrap');
      return { products, categories: [], units: [], lowStockThreshold: 5 };
    },
    withLoader: response => Promise.resolve(response),
    prodFillBundleSelector_: () => {},
    smartIndexProducts_: () => {},
    prodFillCategoryAndUnitSelects_: () => {},
    prodRender: () => {},
    showToast: message => { throw new Error(message); }
  };
  loadFunctions(context, 'products.html', ['prodLoad', 'prodSortValue_', 'prodSortRows_']);
  await context.prodLoad();

  assert.deepEqual(Array.from(context.prodState.products, p => p['Product ID']), ['NEW', 'OLD']);
  assert.deepEqual(products.map(p => p['Product ID']), ['OLD', 'NEW'], 'bootstrap data remains unchanged');
  assert.deepEqual(Array.from(context.prodSortRows_(context.prodState.products), p => p['Product ID']), ['NEW', 'OLD']);

  context.prodState.sortKey = 'name';
  assert.deepEqual(Array.from(context.prodSortRows_(context.prodState.products), p => p['Product ID']), ['OLD', 'NEW'],
    'explicit Product Name header sort still takes priority');
  context.prodState.sortDir = 'desc';
  assert.deepEqual(Array.from(context.prodSortRows_(context.prodState.products), p => p['Product ID']), ['NEW', 'OLD']);
});

function partyDocument(prefix) {
  const search = { value: '' };
  const table = {
    rows: [],
    set innerHTML(value) { this.rows = []; },
    appendChild(row) { this.rows.push(row); }
  };
  const empty = { hidden: true };
  const elements = {};
  elements[prefix + 'Search'] = search;
  elements[prefix + 'TableBody'] = table;
  elements[prefix + 'Empty'] = empty;
  elements[prefix + 'PayMethod'] = { value: 'Cash' };
  elements[prefix + 'PayBankAccount'] = { value: '' };
  return {
    search,
    table,
    empty,
    document: {
      getElementById: id => {
        assert.ok(elements[id], 'unexpected DOM field: ' + id);
        return elements[id];
      },
      createElement: () => ({ innerHTML: '' })
    }
  };
}

test('Customer list displays newest account first and preserves search filtering', async () => {
  const customers = [
    { 'Customer ID': 'OLD', 'Customer Name': 'Old Customer', Phone: '01711111111', 'Current Due': 0 },
    { 'Customer ID': 'NEW', 'Customer Name': 'New Customer', Phone: '01722222222', 'Current Due': 100 }
  ];
  const ui = partyDocument('cust');
  const context = {
    authToken: 'test',
    custState: { customers: [], bankAccounts: [], currencySymbol: '' },
    document: ui.document,
    serverCall: name => {
      assert.equal(name, 'getCustomersBootstrap');
      return { customers, bankAccounts: [], currencySymbol: '৳' };
    },
    withLoader: response => Promise.resolve(response),
    custFillBankAccountSelect_: () => {},
    escapeHtml: value => String(value),
    formatMoney: value => String(value),
    phoneSearchMatches_: (phone, query) => String(phone || '').includes(query),
    showToast: message => { throw new Error(message); }
  };
  loadFunctions(context, 'customers.html', ['custLoad', 'custRender']);
  await context.custLoad();

  assert.deepEqual(Array.from(context.custState.customers, c => c['Customer ID']), ['NEW', 'OLD']);
  assert.deepEqual(customers.map(c => c['Customer ID']), ['OLD', 'NEW']);
  assert.equal(ui.table.rows.length, 2);
  assert.match(ui.table.rows[0].innerHTML, /New Customer/);
  ui.search.value = '017111';
  context.custRender();
  assert.equal(ui.table.rows.length, 1);
  assert.match(ui.table.rows[0].innerHTML, /Old Customer/);
});

test('Supplier list displays newest account first and preserves search filtering', async () => {
  const suppliers = [
    { 'Supplier ID': 'OLD', 'Supplier Name': 'Old Supplier', Phone: '01711111111', 'Current Due': 0, Status: 'Active' },
    { 'Supplier ID': 'NEW', 'Supplier Name': 'New Supplier', Phone: '01722222222', 'Current Due': 100, Status: 'Active' }
  ];
  const ui = partyDocument('sup');
  const context = {
    authToken: 'test',
    supState: { suppliers: [], bankAccounts: [], currencySymbol: '' },
    document: ui.document,
    serverCall: name => {
      assert.equal(name, 'getSuppliersBootstrap');
      return { suppliers, bankAccounts: [], currencySymbol: '৳' };
    },
    withLoader: response => Promise.resolve(response),
    fillBankAccountSelect_: () => {},
    escapeHtml: value => String(value),
    formatMoney: value => String(value),
    phoneSearchMatches_: (phone, query) => String(phone || '').includes(query),
    showToast: message => { throw new Error(message); }
  };
  loadFunctions(context, 'suppliers.html', ['supLoad', 'supRender']);
  await context.supLoad();

  assert.deepEqual(Array.from(context.supState.suppliers, s => s['Supplier ID']), ['NEW', 'OLD']);
  assert.deepEqual(suppliers.map(s => s['Supplier ID']), ['OLD', 'NEW']);
  assert.equal(ui.table.rows.length, 2);
  assert.match(ui.table.rows[0].innerHTML, /New Supplier/);
  ui.search.value = 'Old';
  context.supRender();
  assert.equal(ui.table.rows.length, 1);
  assert.match(ui.table.rows[0].innerHTML, /Old Supplier/);
});
