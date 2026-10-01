'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

function fnSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing function ${name}`);
  const brace = source.indexOf('{', start);
  let depth = 0, quote = null, escape = false, line = false, block = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i], next = source[i + 1];
    if (line) { if (ch === '\n') line = false; continue; }
    if (block) { if (ch === '*' && next === '/') { block = false; i++; } continue; }
    if (quote) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && next === '/') { line = true; i++; continue; }
    if (ch === '/' && next === '*') { block = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated ${name}`);
}

function resolverHarness(customers) {
  const utils = read('Utils.gs');
  const customer = read('Customer.gs');
  const created = [];
  const ctx = {
    console,
    getAllRows_: key => {
      assert.equal(key, 'CUSTOMERS');
      return customers.map((row, i) => ({ ...row, _rowIndex: i + 2 }));
    },
    isDeleted_: row => String(row && row['Is Deleted'] || '').toUpperCase() === 'TRUE',
    addCustomer_: payload => {
      const id = `NEW-${created.length + 1}`;
      created.push({ id, payload });
      return { success: true, data: { id } };
    },
    fail_: message => ({ success: false, message })
  };
  vm.createContext(ctx);
  for (const name of ['sanitizeInput_', 'normalizePhoneDisplay_', 'normalizePhoneSearch_', 'phoneNumbersEqual_']) {
    vm.runInContext(fnSource(utils, name), ctx, { filename: 'Utils.gs' });
  }
  vm.runInContext(fnSource(customer, 'resolveOrCreateCustomer_'), ctx, { filename: 'Customer.gs' });
  return { ctx, created };
}

test('selected customer id wins when duplicate active rows share the same phone', () => {
  const customers = [
    { 'Customer ID': 'C-OLD', 'Customer Name': 'Ripon', Phone: '01754551449', Status: 'Active', 'Current Due': 11660 },
    { 'Customer ID': 'C-DRAFT', 'Customer Name': 'Ripon', Phone: '01754551449', Status: 'Active', 'Current Due': 0 }
  ];
  const { ctx } = resolverHarness(customers);
  assert.equal(
    ctx.resolveOrCreateCustomer_('Ripon', '01754551449', 'Sripur', '', 'C-DRAFT'),
    'C-DRAFT'
  );
});

test('phone-only resolution refuses multiple active customer ids instead of picking row order', () => {
  const customers = [
    { 'Customer ID': 'C-1', 'Customer Name': 'Ripon', Phone: '01754551449', Status: 'Active' },
    { 'Customer ID': 'C-2', 'Customer Name': 'Ripon', Phone: '01754551449', Status: 'Active' }
  ];
  const { ctx } = resolverHarness(customers);
  assert.throws(
    () => ctx.resolveOrCreateCustomer_('Ripon', '01754551449', '', '', ''),
    /more than one|duplicate|select.*customer/i
  );
});

test('selected customer id must exist and be active; the selected id is authoritative over a stale supplied phone', () => {
  const customers = [
    { 'Customer ID': 'C-1', 'Customer Name': 'Ripon', Phone: '01754551449', Status: 'Active' },
    { 'Customer ID': 'C-2', 'Customer Name': 'Other', Phone: '01800000000', Status: 'Inactive' }
  ];
  const { ctx } = resolverHarness(customers);
  assert.equal(ctx.resolveOrCreateCustomer_('Ripon', '01800000000', '', '', 'C-1'), 'C-1');
  assert.throws(() => ctx.resolveOrCreateCustomer_('Other', '01800000000', '', '', 'C-2'), /inactive/i);
  assert.throws(() => ctx.resolveOrCreateCustomer_('Ghost', '01900000000', '', '', 'C-MISSING'), /not found|re-?select/i);
});

test('phone-only resolution still reuses one canonical active customer and quick-creates only when none exists', () => {
  let h = resolverHarness([
    { 'Customer ID': 'C-1', 'Customer Name': 'Ripon', Phone: '+8801754551449', Status: 'Active' }
  ]);
  assert.equal(h.ctx.resolveOrCreateCustomer_('Ripon', '০১৭৫৪৫৫১৪৪৯', '', '', ''), 'C-1');
  assert.equal(h.created.length, 0);

  h = resolverHarness([]);
  assert.equal(h.ctx.resolveOrCreateCustomer_('New Buyer', '01700000000', 'Dhaka', '', ''), 'NEW-1');
  assert.equal(h.created.length, 1);
});


test('normal customer creation still rejects the same canonical phone in Bangla or country-code form', () => {
  const utils = read('Utils.gs');
  const customer = read('Customer.gs');
  const writes = [];
  const ctx = {
    console,
    getAllRows_: key => {
      assert.equal(key, 'CUSTOMERS');
      return [{ 'Customer ID': 'C-1', 'Customer Name': 'Ripon', Phone: '+8801754551449', Status: 'Active', _rowIndex: 2 }];
    },
    parseSignedOpeningBalance_: () => 0,
    openingBalanceLedgerAmounts_: () => ({ Debit: '', Credit: '' }),
    generateId_: () => 'NEW',
    appendRow_: (key, row) => writes.push({ key, row }),
    sanitizeInput_: value => value == null ? '' : String(value).trim(),
    fail_: message => ({ success: false, message }),
    ok_: data => ({ success: true, data }),
    logError_: () => {}
  };
  vm.createContext(ctx);
  for (const name of ['normalizePhoneDisplay_', 'normalizePhoneSearch_', 'phoneNumbersEqual_']) {
    vm.runInContext(fnSource(utils, name), ctx, { filename: 'Utils.gs' });
  }
  vm.runInContext(fnSource(customer, 'addCustomer_'), ctx, { filename: 'Customer.gs' });
  const result = ctx.addCustomer_({ name: 'Ripon Sarkar', phone: '০১৭৫৪৫৫১৪৪৯', openingBalance: 0 });
  assert.equal(result.success, false);
  assert.match(result.message, /already exists/i);
  assert.deepEqual(writes, []);
});

test('sale creation and sale editing pass the selected customer id into identity resolution', () => {
  const sales = fnSource(read('Sales.gs'), 'completeSale');
  const management = fnSource(read('SalesManagement.gs'), 'updateSaleInternal_');
  assert.match(sales, /resolveOrCreateCustomer_\([\s\S]*?customerId\s*\)/,
    'completeSale must preserve the selected customerId when resolving a due sale');
  assert.match(management, /resolveOrCreateCustomer_\([\s\S]*?payload\.customerId[\s\S]*?\)/,
    'updateSale must preserve the selected customerId when moving/reposting due');
});
