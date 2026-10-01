'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const purchase = fs.readFileSync(path.join(root, 'purchase.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.html'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('PASS', name); }
  catch (err) { fail++; console.error('FAIL', name); console.error(err.stack || err); }
}

function functionSource(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.notStrictEqual(start, -1, 'missing function ' + name);
  const brace = source.indexOf('{', start);
  let depth = 0, quote = null, escape = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unclosed function ' + name);
}

test('Purchase renders numbered POS-style product lines plus an inline Add product row', () => {
  const render = functionSource(purchase, 'purRenderLines_');
  assert.match(render, /purchase-line-no/);
  assert.match(render, /purchase-cart-entry-row/);
  assert.match(render, /'Add product…'/);
  assert.match(render, /data-pur-product-input/);
  assert.match(render, /purCartCount/);
});

test('Purchase product suggestions contain useful purchasing metadata', () => {
  const matches = functionSource(purchase, 'purCartProductMatches_');
  const html = functionSource(purchase, 'purCartProductResultsHtml_');
  assert.match(matches, /smartSearchProducts_/);
  assert.match(html, /category/);
  assert.match(html, /purchasePrice/);
  assert.match(html, /sellingPrice/);
  assert.match(html, /stock/);
  assert.match(html, /unit/);
});

test('Purchase add-mode suggestions exclude every product already in the cart', () => {
  const matches = functionSource(purchase, 'purCartProductMatches_');
  assert.match(matches, /hasReplaceIndex/);
  assert.match(matches, /line\.productId\s*===\s*product\.id/);
  assert.match(matches, /!hasReplaceIndex/);
});

test('Purchase inline picker supports keyboard movement and selection', () => {
  const keys = functionSource(purchase, 'purCartProductKeydown_');
  assert.match(keys, /ArrowDown/);
  assert.match(keys, /ArrowUp/);
  assert.match(keys, /Enter/);
  assert.match(keys, /Escape/);
  assert.match(keys, /purMoveCartProductActive_/);
  assert.match(keys, /purChooseCartProduct_/);
});

test('Purchase preserves supplier-first rule for inline product entry', () => {
  const availability = functionSource(purchase, 'purRefreshCartEntryAvailability_');
  assert.match(availability, /purSupplier/);
  assert.match(availability, /disabled/);
  assert.match(availability, /Choose supplier first/);
});

test('existing Purchase rows can change product without allowing duplicates', () => {
  const replace = functionSource(purchase, 'purReplaceCartProduct_');
  assert.match(replace, /already in the list/);
  assert.match(replace, /productId/);
  assert.match(replace, /purRenderLines_/);
});

test('Purchase line inputs remain Qty Purchase Price Sell Price with computed Total', () => {
  const render = functionSource(purchase, 'purRenderLines_');
  assert.match(render, /data-f="qty"/);
  assert.match(render, /data-f="unitPrice"/);
  assert.match(render, /data-f="sellingPrice"/);
  assert.match(render, /purchase-line-total/);
  assert.match(render, /cart-remove/);
});

test('old separate purchase filter picker UI is removed', () => {
  assert.doesNotMatch(purchase, /id="purCategoryFilter"/);
  assert.doesNotMatch(purchase, /id="purBrandFilter"/);
  assert.doesNotMatch(purchase, /id="purProductPicker"/);
  assert.doesNotMatch(purchase, /id="purAddLineBtn"/);
  assert.doesNotMatch(purchase, /function\s+purMakeCombobox_\s*\(/);
});

test('Purchase cart CSS is compact on desktop and touch-friendly on mobile', () => {
  assert.match(css, /#page-purchase\s+\.purchase-cart-row\s*\{[^}]*min-height:\s*36px/);
  assert.match(css, /#page-purchase\s+\.purchase-cart-row\s+input[^}]*height:\s*30px/);
  assert.match(css, /@media\s*\(max-width:\s*540px\)[\s\S]*#page-purchase\s+\.purchase-cart-row\s+input[^}]*min-height:\s*40px/);
});

console.log('\n' + pass + '/' + (pass + fail) + ' passed');
if (fail) process.exit(1);
