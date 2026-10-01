'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const pos = fs.readFileSync(path.join(root, 'pos.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.html'), 'utf8');
const v2 = fs.readFileSync(path.join(root, 'posv2.html'), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('PASS', name); }
  catch (err) { fail++; console.error('FAIL', name); console.error(err.stack || err); }
}

function functionSource(name) {
  const start = pos.indexOf('function ' + name + '(');
  assert.notStrictEqual(start, -1, 'missing function ' + name);
  const brace = pos.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < pos.length; i++) {
    if (pos[i] === '{') depth++;
    else if (pos[i] === '}' && --depth === 0) return pos.slice(start, i + 1);
  }
  throw new Error('unclosed function ' + name);
}

test('selected inline product immediately shows canonical full name before qty typing', () => {
  const render = functionSource('posRenderCart_');
  const start = functionSource('posStartCartEntry_');
  const focus = functionSource('posFocusCartEntryQty_');
  assert.match(render, /value="'\s*\+\s*escapeHtml\(line\.name\)/);
  assert.match(start, /posRenderCart_\(\);[\s\S]*posFocusCartEntryQty_\(\)/);
  assert.doesNotMatch(focus, /setTimeout\s*\(/);
  assert.match(focus, /input\.focus\(\)/);
  assert.match(focus, /input\.select\(\)/);
});

test('inline Add product and replace search support ArrowUp ArrowDown and Enter selected option', () => {
  const move = functionSource('posMoveCartProductActive_');
  const active = functionSource('posActiveCartProductOption_');
  assert.match(move, /Arrow|delta|activeIndex|aria-selected|scrollIntoView/);
  assert.match(active, /data-cart-product-pick/);

  const start = pos.indexOf("document.getElementById('posCartList').addEventListener('keydown'");
  const end = pos.indexOf("document.getElementById('posCartList').addEventListener('scroll'", start);
  const keyArea = pos.slice(start, end);
  assert.match(keyArea, /e\.key === 'ArrowDown'/);
  assert.match(keyArea, /e\.key === 'ArrowUp'/);
  assert.match(keyArea, /posMoveCartProductActive_/);
  assert.match(keyArea, /posActiveCartProductOption_/);
  assert.doesNotMatch(keyArea, /posCartProductMatches_\(e\.target\.value\)\[0\]/);
});

test('rendered cart search popup starts with one keyboard-active suggestion', () => {
  const render = functionSource('posRenderCartProductResults_');
  assert.match(render, /dataset\.activeIndex\s*=\s*html\s*\?\s*['"]0['"]\s*:\s*['"]-1['"]/);
  assert.match(render, /aria-selected/);
  assert.match(render, /is-active/);
});

test('purchase price reveal has room for long prices and eye sits inward from edge', () => {
  assert.match(css, /#page-pos \.cart-row \.c-name-title\s*\{[\s\S]*flex:\s*1\s+1\s+auto/);
  assert.match(css, /#page-pos \.cart-row \.c-cost\s*\{[^}]*margin-right:\s*8px/);
  assert.match(css, /#page-pos \.cart-row \.c-cost\.is-revealed\s*\{[^}]*min-width:\s*90px[^}]*white-space:\s*nowrap/);
});

test('cart line total uses normal sans/Inter family, not mono, in Classic and V2', () => {
  assert.match(css, /#page-pos \.cart-row \.c-line-total\s*\{[^}]*font-family:\s*var\(--font-sans\)/);
  const monoGroupStart = v2.indexOf("body.pos-v2-active #page-pos .mono");
  const monoGroupEnd = v2.indexOf('{', monoGroupStart);
  const monoGroup = v2.slice(monoGroupStart, monoGroupEnd);
  assert.doesNotMatch(monoGroup, /\.c-line-total/);
  assert.match(v2, /body\.pos-v2-active #page-pos \.cart-row \.c-line-total\s*\{[^}]*font-family:\s*['"]Inter['"]/);
});

console.log('\n' + pass + '/' + (pass + fail) + ' passed');
if (fail) process.exit(1);
