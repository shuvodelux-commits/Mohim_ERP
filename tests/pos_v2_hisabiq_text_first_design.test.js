'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const v2 = fs.readFileSync(path.join(root, 'posv2.html'), 'utf8');
const pos = fs.readFileSync(path.join(root, 'pos.html'), 'utf8');

function check(name, fn) {
  fn();
  console.log('PASS', name);
}

check('HisabIQ-inspired POS keeps the existing operational cart and checkout', () => {
  assert.match(v2, /function posV2SetActive_\s*\(/);
  assert.match(v2, /customer\.appendChild\(refs\.summary\)/);
  assert.match(v2, /customer\.appendChild\(refs\.actions\)/);
  assert.match(v2, /refs\.cart\.insertBefore\(refs\.summary,\s*refs\.summaryAnchor\)/);
  assert.match(v2, /refs\.cart\.insertBefore\(refs\.actions,\s*refs\.actionsAnchor\)/);
  assert.match(pos, /function posAddToCart_\s*\(product\)/);
});

check('Quick Items are a text-first view of the existing POS product data', () => {
  assert.match(v2, /function posV2EnsureQuickItems_\s*\(/);
  assert.match(v2, /function posV2RenderQuickItems_\s*\(/);
  assert.match(v2, /function posV2RemoveQuickItems_\s*\(/);
  assert.match(v2, /posState\.products\s*\|\|\s*\[\]/);
  assert.match(v2, /Number\(product\.stock\)\s*>\s*0/);
  assert.match(v2, /\.slice\(0,\s*8\)/);
  assert.match(v2, /title\.textContent\s*=\s*product\.name/);
  assert.match(v2, /amount\.textContent\s*=/);
  assert.match(v2, /stock\.textContent\s*=/);
  assert.match(v2, /posAddToCart_\(product\)/);
  assert.doesNotMatch(v2, /<img\b|document\.createElement\(['"]img['"]\)|product\.image/i);
});

check('Quick Items use product ids, not arbitrary DOM markup, and have accessibility labels', () => {
  assert.match(v2, /button\.dataset\.posV2QuickProduct\s*=\s*String\(product\.id\)/);
  assert.match(v2, /button\.setAttribute\(['"]aria-label['"],\s*['"]Add ['"]\s*\+\s*product\.name/);
  assert.match(v2, /section\.setAttribute\(['"]aria-labelledby['"]/);
  assert.match(v2, /section\.hidden\s*=\s*products\.length\s*===\s*0/);
});

check('Responsive layout keeps quick buttons with the cart and separate mobile payment', () => {
  assert.match(v2, /"search customer"\s*"cart customer"\s*"quick customer"/);
  assert.match(v2, /grid-template-areas:\s*"search"\s*"cart"\s*"quick"\s*"customer"/);
  assert.match(v2, /grid-template-areas:\s*"tabs"\s*"search"\s*"cart"\s*"quick"\s*"customer"/);
  assert.match(v2, /data-pos-v2-tab-state="payment"\]\s+\.pos-v2-quick-items/);
  assert.match(v2, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
});

console.log('POS HisabIQ text-first design checks passed.');
