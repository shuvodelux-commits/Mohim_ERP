'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('POS update payload sends explicit shortage resolution for every cart line', () => {
  const pos = read('pos.html');
  assert.match(pos, /var item\s*=\s*\{[^}]*shortageResolution\s*:\s*l\.shortageResolution/s);
});

test('switching a shortage line to Negative Stock clears stale vendor identity and cost', () => {
  const pos = read('pos.html');
  const m = pos.match(/else if \(act === 'negative'\) \{([\s\S]{0,500})\n\s*\} else if \(act === 'vendor'\)/);
  assert.ok(m, 'Negative Stock handler not found');
  assert.match(m[1], /line\.vendorId\s*=\s*''/);
  assert.match(m[1], /line\.vendorName\s*=\s*''/);
  assert.match(m[1], /line\.vendorUnitCost\s*=\s*''/);
});
