'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
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

test('Classic cleanup removes the V2 workflow tabs from the shared POS layout', () => {
  const removeTabs = functionSource(v2, 'posV2RemoveTabs_');
  assert.match(removeTabs, /\.pos-v2-workflow-tabs/);
  assert.match(removeTabs, /\.remove\s*\(/);
});

test('deactivating V2 removes tabs while activating V2 still creates them', () => {
  const setActive = functionSource(v2, 'posV2SetActive_');
  assert.match(setActive, /if\s*\(active\)[\s\S]*posV2EnsureTabs_\s*\(/);
  assert.match(setActive, /else\s*\{[\s\S]*posV2RemoveTabs_\s*\(/);
});

test('Classic cleanup still restores checkout and removes V2-only decorations', () => {
  const setActive = functionSource(v2, 'posV2SetActive_');
  assert.match(setActive, /posV2RemoveSearchToolbar_\s*\(/);
  assert.match(setActive, /posV2RemoveReorderHandles_\s*\(/);
  assert.match(setActive, /posV2RemoveCartDecorations_\s*\(/);
  assert.match(setActive, /insertBefore\(refs\.summary,\s*refs\.summaryAnchor\)/);
  assert.match(setActive, /insertBefore\(refs\.actions,\s*refs\.actionsAnchor\)/);
});

console.log('\n' + pass + '/' + (pass + fail) + ' passed');
if (fail) process.exit(1);
