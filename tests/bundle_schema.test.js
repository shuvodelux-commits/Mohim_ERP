'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {test} = require('node:test');
const config = fs.readFileSync(path.join(__dirname, '..', 'Config.gs'), 'utf8');

function block(key, nextKey) {
  const start = config.indexOf(key);
  assert.ok(start >= 0, 'missing ' + key);
  const end = nextKey ? config.indexOf(nextKey, start + key.length) : config.length;
  assert.ok(end > start, 'missing successor ' + nextKey);
  return config.slice(start, end);
}

test('declares two additive bundle sheets with no new physical stock sheet', () => {
  assert.match(block('SHEETS: {', 'HEADERS: {'), /BUNDLE_COMPONENTS:\s*["']Bundle Components["']/);
  assert.match(block('SHEETS: {', 'HEADERS: {'), /SALE_BUNDLE_COMPONENTS:\s*["']Sale Bundle Components["']/);
  assert.doesNotMatch(block('SHEETS: {', 'HEADERS: {'), /BUNDLE_STOCK:/);
});

test('stores type and revision on the existing Products sheet', () => {
  const hdr = block('HEADERS: {', 'SUPPLIERS: [');
  assert.match(hdr, /["']Product Type["']/);
  assert.match(hdr, /["']Bundle Revision["']/);
  assert.match(hdr, /["']Current Stock["']/);
});

test('stores visible sale type and physical source lineage', () => {
  assert.match(block('SALE_ITEMS: [', 'CUSTOMERS: ['), /["']Sold Product Type["']/);
  assert.match(block('SALE_ITEM_LOTS: [', 'STOCK_LOT_COST_CORRECTIONS: ['), /["']Source Sale Product ID["']/);
  assert.match(block('STOCK_MOVEMENT: [', 'STOCK_LOTS: ['), /["']Source Sale Product ID["']/);
  assert.match(block('SALES_RETURN_ITEMS: [', 'PURCHASE_RETURN: ['), /["']Sold Product Type["']/);
});

test('bundle component definitions and sale snapshots include all required columns', () => {
  const c = block('BUNDLE_COMPONENTS: [', 'SALE_BUNDLE_COMPONENTS: [');
  for (const key of ['Bundle Product ID','Component Product ID','Quantity Per Set','Unit','Revision','Status','Updated At']) {
    assert.ok(c.includes('"' + key + '"'), 'missing definition: '+key);
  }
  const s = block('SALE_BUNDLE_COMPONENTS: [', 'SUPPLIERS: [');
  for (const key of ['Invoice ID','Bundle Product ID','Bundle Revision','Component Product ID','Quantity Per Set','Sets Sold','Component Quantity Sold','Unit','Created At']) {
    assert.ok(s.includes('"' + key + '"'), 'missing sale snapshot: '+key);
  }
});

test('legacy Standard Products and sold lot rows do not require backfill', () => {
  assert.match(config, /["']Product Type["']/);
  assert.match(config, /["']Source Sale Product ID["']/);
});
