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

test('POS V2 adds a reorder handle only to completed cart rows', () => {
  const enhance = functionSource(v2, 'posV2EnhanceCartRows_');
  assert.match(enhance, /pos-v2-reorder-handle/);
  assert.match(enhance, /pos-cart-entry-row/);
  assert.match(enhance, /cartEntryIndex/);
  assert.match(enhance, /cartEditIndex/);
  assert.doesNotMatch(pos, /pos-v2-reorder-handle/);
});

test('the reorder handle is V2-scoped and touch friendly', () => {
  assert.match(v2, /body\.pos-v2-active\s+#page-pos\s+\.pos-v2-reorder-handle/);
  assert.match(v2, /touch-action:\s*none/);
  assert.match(v2, /cursor:\s*grab/);
});

test('pointer drag tracks a drop boundary without mutating cart during move', () => {
  const down = functionSource(v2, 'posV2ReorderPointerDown_');
  const move = functionSource(v2, 'posV2ReorderPointerMove_');
  assert.match(down, /pointerId/);
  assert.match(down, /setPointerCapture/);
  assert.match(move, /getBoundingClientRect/);
  assert.match(move, /pos-v2-drop-before|pos-v2-drop-after/);
  assert.doesNotMatch(move, /posState\.cart\.splice/);
});

test('drop reorders the actual cart array once and rerenders', () => {
  const commit = functionSource(v2, 'posV2CommitReorder_');
  assert.match(commit, /posState\.cart\.splice\(fromIndex,\s*1\)/);
  assert.match(commit, /posState\.cart\.splice\(insertIndex,\s*0,\s*moved\)/);
  assert.match(commit, /posRenderCart_\(\)/);
});

test('dragging near cart edges scrolls the V2 cart list', () => {
  const move = functionSource(v2, 'posV2ReorderPointerMove_');
  assert.match(move, /scrollTop/);
  assert.match(move, /getBoundingClientRect/);
});

test('reorder survives cart rerenders and is removed when V2 deactivates', () => {
  const bind = functionSource(v2, 'posV2BindCartReorder_');
  const active = functionSource(v2, 'posV2SetActive_');
  assert.match(bind, /MutationObserver/);
  assert.match(active, /posV2BindCartReorder_/);
  assert.match(active, /posV2RemoveReorderHandles_/);
});

test('draft and sale payloads still follow posState cart order', () => {
  assert.match(pos, /items:\s*posState\.cart\.map\(function\s*\(line\)/);
  assert.match(pos, /items:\s*posState\.cart\.map\(function\s*\(l\)/);
});

console.log('\n' + pass + '/' + (pass + fail) + ' passed');
if (fail) process.exit(1);
