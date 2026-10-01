'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

function fnSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing function ${name}`);
  const brace = source.indexOf('{', start);
  let depth = 0;
  let quote = null;
  let escape = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];

    if (lineComment) {
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') {
        blockComment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && next === '/') {
      lineComment = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      blockComment = true;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }

  throw new Error(`unterminated function ${name}`);
}

function loadSalesFunctions(names, overrides = {}) {
  const source = read('SalesManagement.gs');
  const context = {
    console,
    roundMoney_: value => Math.round((Number(value) + Number.EPSILON) * 100) / 100,
    economicReturnLineAmount_: (row, subtotal, grandTotal) => {
      const gross = Number(row['Line Total']) ||
        (Number(row['Return Quantity']) || 0) * (Number(row['Unit Price']) || 0);
      return Number(subtotal) > 0
        ? Math.round((gross * Number(grandTotal) / Number(subtotal) + Number.EPSILON) * 100) / 100
        : 0;
    },
    getAllRows_: () => [],
    activeRows_: () => [],
    isValidNonNegativeNumber_: value => Number.isFinite(Number(value)) && Number(value) >= 0,
    hasPermission_: () => false,
    ...overrides
  };

  vm.createContext(context);
  const body = names.map(name => fnSource(source, name)).join('\n') +
    '\nthis.__api = {' + names.join(',') + '};';
  vm.runInContext(body, context, { filename: 'SalesManagement.gs' });
  return context.__api;
}

test('invoice profit uses net sale after returns and recorded FIFO/vendor COGS', () => {
  const saleItemLots = [
    { 'Invoice ID': 'INV-1', 'Product ID': 'P1', Quantity: 1, 'Unit Cost': 100 }
  ];
  const vendorSourcing = [
    { 'Invoice ID': 'INV-1', 'Product ID': 'P2', Quantity: 1, 'Total Cost': 200, 'Unit Cost': 999 }
  ];

  const api = loadSalesFunctions(['buildSalesInvoiceProfitMetrics_'], {
    getAllRows_: key => key === 'SALE_ITEM_LOTS' ? saleItemLots : [],
    activeRows_: key => key === 'VENDOR_SOURCING' ? vendorSourcing : []
  });

  const result = api.buildSalesInvoiceProfitMetrics_(
    [{ 'Invoice ID': 'INV-1', Subtotal: 1000, 'Grand Total': 1000 }],
    [
      { 'Invoice ID': 'INV-1', 'Product ID': 'P1', Quantity: 2 },
      { 'Invoice ID': 'INV-1', 'Product ID': 'P2', Quantity: 1 }
    ],
    [{ 'Invoice ID': 'INV-1', 'Product ID': 'P1', 'Return Quantity': 1, 'Unit Price': 300, 'Line Total': 300 }],
    {}
  );

  assert.equal(result['INV-1'].profit, 400);
  assert.equal(result['INV-1'].costComplete, true);
  assert.ok(Math.abs(result['INV-1'].profitMarginPercent - (400 / 700 * 100)) < 0.000001);
});

test('invoice profit marks incomplete historical cost coverage instead of pretending it is exact', () => {
  const api = loadSalesFunctions(['buildSalesInvoiceProfitMetrics_'], {
    getAllRows_: key => key === 'SALE_ITEM_LOTS'
      ? [{ 'Invoice ID': 'INV-2', 'Product ID': 'P1', Quantity: 1, 'Unit Cost': 50 }]
      : [],
    activeRows_: () => []
  });

  const result = api.buildSalesInvoiceProfitMetrics_(
    [{ 'Invoice ID': 'INV-2', Subtotal: 500, 'Grand Total': 500 }],
    [{ 'Invoice ID': 'INV-2', 'Product ID': 'P1', Quantity: 2 }],
    [],
    {}
  );

  assert.equal(result['INV-2'].profit, 450);
  assert.equal(result['INV-2'].costComplete, false);
});

test('invoice profit visibility requires reports or POS purchase-price permission', () => {
  const denied = loadSalesFunctions(['canViewInvoiceProfit_'], {
    hasPermission_: () => false
  });
  assert.equal(denied.canViewInvoiceProfit_({}), false);

  const reports = loadSalesFunctions(['canViewInvoiceProfit_'], {
    hasPermission_: (_user, module, action) => module === 'reports' && action === 'view'
  });
  assert.equal(reports.canViewInvoiceProfit_({}), true);

  const posCost = loadSalesFunctions(['canViewInvoiceProfit_'], {
    hasPermission_: (_user, module, action) => module === 'posCost' && action === 'view'
  });
  assert.equal(posCost.canViewInvoiceProfit_({}), true);
});

test('sales table preserves Invoice Date Customer Phone order and makes invoice/customer clickable', () => {
  const html = read('sales.html');

  assert.match(
    html,
    /<th>Invoice<\/th>[\s\S]*?<th>Date<\/th>[\s\S]*?<th>Customer<\/th>[\s\S]*?<th>Phone<\/th>/
  );
  assert.match(html, /data-invoice-view-id=/);
  assert.match(html, /data-customer-profile-id=/);
  assert.match(html, /button\[data-invoice-view-id\][\s\S]*?smOpenView_\(invoiceLink\.dataset\.invoiceViewId/);
  assert.match(html, /button\[data-customer-profile-id\][\s\S]*?goToPage\(['"]customers['"]\)[\s\S]*?custOpenDetail_\(customerId\)/);
});

test('sales profit remains internal to management UI and is not added to customer invoice renderer', () => {
  const salesHtml = read('sales.html');
  const invoiceJs = read('javascript.html');

  assert.match(salesHtml, /id="smProfitHeader"[\s\S]*?>Profit<\/th>/);
  assert.match(salesHtml, /Gross Profit/);
  assert.match(salesHtml, /Profit Margin/);
  assert.doesNotMatch(invoiceJs, /Gross Profit|Profit Margin|smProfitHeader/);
});
