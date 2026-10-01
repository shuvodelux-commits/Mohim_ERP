'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'products.html'), 'utf8');

test('Products exposes bulk and per-lot purchase-cost correction controls', () => {
  assert.match(html, /Unpriced Stock Lots/);
  assert.match(html, /Correct Purchase Cost/);
  assert.match(html, /Historical COGS Impact/);
  assert.match(html, /Correction Reason/);
  assert.match(html, /Apply Selected Corrections/);
  assert.match(html, /Unpriced lots:/);
});

test('Products correction UI calls only the dedicated preview and correction RPCs', () => {
  assert.match(html, /serverCall\('getUnpricedInternalStockLots',\s*authToken\)/);
  assert.match(html, /serverCall\('correctInternalStockLotCost',\s*authToken,/);
  assert.match(html, /serverCall\('correctInternalStockLotCosts',\s*authToken,/);
});

test('Stock Lots table keeps existing valuation fields and adds an action column', () => {
  assert.match(html, /<th>Lot ID<\/th>[\s\S]*?<th>Source<\/th>[\s\S]*?<th[^>]*>Purchase Price<\/th>/);
  assert.match(html, /Original Qty/);
  assert.match(html, /Remaining Qty/);
  assert.match(html, />Value<\/th>/);
  assert.match(html, /<th>Action<\/th>/);
});

test('correction confirmation explains that financial settlement and stock quantity are unchanged', () => {
  assert.match(html, /Sales totals, payments, customer due and stock quantity will not change/i);
  assert.match(html, /inventory cost\/COGS evidence only/i);
});

test('bulk correction uses editable proposed cost and informational preview totals', () => {
  assert.match(html, /Proposed Cost/);
  assert.match(html, /Historical Invoice Count/);
  assert.match(html, /Selected Lots/);
  assert.match(html, /Projected Historical COGS/);
  assert.match(html, /data-prod-cost-select/);
  assert.match(html, /data-prod-cost-value/);
});

test('bulk correction requires explicit operator selection before apply', () => {
  assert.match(html, /copy\.selected\s*=\s*false/);
  assert.match(html, /prodCostSelectReadyBtn/);
  assert.match(html, /row\.selected\s*=\s*\(Number\(row\.proposedCost\)\s*\|\|\s*0\)\s*>\s*0/);
});

test('project docs and CI define internal stock lot cost correction contract', () => {
  const project = fs.readFileSync(path.join(root, 'PROJECT.md'), 'utf8');
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'regression-tests.yml'), 'utf8');
  assert.match(project, /Internal Stock Lot Cost Correction/);
  assert.match(project, /exact Lot ID/i);
  assert.match(project, /Positive Opening Stock[\s\S]*Purchase Price > 0/i);
  assert.match(project, /SALE_ITEM_LOTS\.Unit Cost/);
  assert.match(workflow, /Stock lot cost correction\s*\n\s*run:\s*node --test tests\/stock_lot_cost_correction_regressions\.test\.js/);
  assert.match(workflow, /Stock lot cost correction UI\s*\n\s*run:\s*node --test tests\/stock_lot_cost_correction_ui_static\.test\.js/);
});