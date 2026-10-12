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

check('POS V2 visibly presents the existing complete product catalog', () => {
  assert.match(v2, /#posProductGrid\.mobile-search-idle\s*\{\s*display:\s*grid\s*!important/i);
  assert.match(v2, /function\s+posV2SetCatalogTitle_\s*\(/);
  assert.match(v2, /posV2SetCatalogTitle_\(true\)/);
  assert.match(v2, /Products · পণ্য/);
  assert.match(v2, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(v2, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.doesNotMatch(v2, /pos-v2-quick-items|function posV2RenderQuickItems_/);
});

check('Product catalog reuses the actual POS products and search, not images', () => {
  assert.match(pos, /function posRenderProductGrid_\s*\(/);
  assert.match(pos, /smartSearchProducts_\(posState\.products,\s*q/);
  assert.match(pos, /list\.forEach\(function\s*\(p,\s*idx\)/);
  assert.match(pos, /className\s*=\s*'product-tile'/);
  assert.match(pos, /escapeHtml\(p\.name\)/);
  assert.match(pos, /formatMoney\(p\.autoSellingPrice/);
  assert.match(pos, /escapeHtml\(p\.unit\s*\|\|\s*''\)/);
  assert.match(pos, /posAddToCart_\(p\)/);
  assert.doesNotMatch(v2, /<img\b|document\.createElement\(['"]img['"]\)|product\.image/i);
});

check('Original POS keyboard and barcode workflow is preserved', () => {
  assert.match(pos, /posSearchEl_\.addEventListener\(['"]keydown['"]/);
  assert.match(pos, /smartProductHasExactCode_\(selected,\s*posSearchEl_\.value\)/);
  assert.match(pos, /posAddToCart_\(selected\)/);
  // Do not install the V2 dropdown handlers over the original catalog keyboard handlers.
  assert.doesNotMatch(v2, /^\s+posV2BindSearch_\(\);\s*$/m);
});

check('Existing cart checkout and mobile tabs remain in place', () => {
  assert.match(v2, /customer\.appendChild\(refs\.summary\)/);
  assert.match(v2, /customer\.appendChild\(refs\.actions\)/);
  assert.match(v2, /refs\.cart\.insertBefore\(refs\.summary,\s*refs\.summaryAnchor\)/);
  assert.match(v2, /refs\.cart\.insertBefore\(refs\.actions,\s*refs\.actionsAnchor\)/);
  assert.match(v2, /data-pos-v2-tab="cart"/);
  assert.match(v2, /data-pos-v2-tab="customer"/);
  assert.match(v2, /data-pos-v2-tab="payment"/);
});

console.log('POS HisabIQ product-catalog design checks passed.');
