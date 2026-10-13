'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const pos = fs.readFileSync(path.join(root, 'pos.html'), 'utf8');
const v2 = fs.readFileSync(path.join(root, 'posv2.html'), 'utf8');

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

test('outside click completes an active cart entry like Enter without forcing focus away from the clicked control', () => {
  const finish = functionSource(pos, 'posFinishCartEntry_');
  const outside = functionSource(pos, 'posCartEntryOutsideClick_');
  assert.match(finish, /focusNext/);
  assert.match(finish, /focusNext\s*!==\s*false/);
  assert.match(outside, /posState\.cartEntryIndex\s*===\s*null/);
  assert.match(outside, /pos-cart-entry-row\.is-active/);
  assert.match(outside, /posCartProductPopup/);
  assert.match(outside, /data-cart-product-mode="add"/);
  assert.match(outside, /posFinishCartEntry_/);
  assert.match(pos, /document\.addEventListener\(['"]click['"],\s*posCartEntryOutsideClick_/);
});

test('POS V2 product metadata shows category normal price and stock with unit only', () => {
  const meta = functionSource(v2, 'posV2ProductMetaHtml_');
  assert.match(meta, /product\.category/);
  assert.match(meta, /product\.autoSellingPrice/);
  assert.match(meta, /product\.sellingPrice/);
  assert.match(meta, /product\.stock/);
  assert.match(meta, /product\.unit/);
  assert.doesNotMatch(meta, /barcode|product\.id/);
});

test('POS V2 injects a # header and one-based line number for real products only', () => {
  const header = functionSource(v2, 'posV2EnsureCartNumberHeader_');
  const enhance = functionSource(v2, 'posV2EnhanceCartRows_');
  assert.match(header, /textContent\s*=\s*['"]#['"]/);
  assert.match(header, /pos-v2-line-no-header/);
  assert.match(enhance, /pos-v2-line-no/);
  assert.match(enhance, /String\(index\s*\+\s*1\)/);
  assert.match(enhance, /pos-cart-entry-row/);
  assert.doesNotMatch(pos, /pos-v2-line-no/);
});

test('POS V2 adds metadata under completed product names and refreshes it after rerender', () => {
  const enhance = functionSource(v2, 'posV2EnhanceCartRows_');
  assert.match(enhance, /posV2ProductMetaHtml_/);
  assert.match(enhance, /pos-v2-product-meta/);
  assert.match(enhance, /innerHTML/);
});

test('POS V2 purchase-price eye is vertically centered without overlapping product names', () => {
  // The product cell is now the positioning context so the eye stays
  // vertically centered even with a multi-line name or metadata below it.
  assert.match(v2, /body\.pos-v2-active\s+#page-pos\s+\.cart-row\s+\.c-name\s*\{[^}]*position:\s*relative/s);
  assert.match(v2, /body\.pos-v2-active\s+#page-pos\s+\.cart-row\s+\.c-name-main\s*\{[^}]*position:\s*static[^}]*padding-right:\s*76px/s);
  assert.match(v2, /body\.pos-v2-active\s+#page-pos\s+\.cart-row\s+\.c-cost\s*\{[^}]*position:\s*absolute[^}]*right:\s*0[^}]*top:\s*50%[^}]*transform:\s*translateY\(-50%\)/s);
  assert.match(v2, /body\.pos-v2-active\s+#page-pos\s+\.cart-row\s+\.c-cost\.is-revealed\s*\{[^}]*right:\s*0/s);
});

test('POS V2 seven-column grid includes # before Product while Classic markup remains unchanged', () => {
  assert.match(v2, /grid-template-columns:\s*28px\s+minmax\(/);
  assert.doesNotMatch(pos, /<span>#<\/span>/);
});

console.log('\n' + pass + '/' + (pass + fail) + ' passed');
if (fail) process.exit(1);
