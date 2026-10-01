'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'UI.gs'), 'utf8');
const js = fs.readFileSync(path.join(root, 'javascript.html'), 'utf8');
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

test('POS group exposes POS V2 only and never renders Classic POS as a child', () => {
  const posBlock = ui.slice(ui.indexOf("key: 'pos', label: 'POS'"), ui.indexOf("{ key: 'counter'"));
  assert.match(posBlock, /landingKey:\s*['"]posv2['"]/);
  assert.match(posBlock, /key:\s*['"]posv2['"]\s*,\s*label:\s*['"]POS V2['"]/);
  assert.doesNotMatch(posBlock, /Classic POS/);
  const childBlock = posBlock.slice(posBlock.indexOf('children:'));
  assert.doesNotMatch(childBlock, /key:\s*['"]pos['"]\s*,\s*label:/);
});

test('desktop sidebar uses a group landing key instead of always opening the parent key', () => {
  const helper = functionSource(js, 'navLandingKey_');
  const build = functionSource(js, 'buildNav_');
  assert.match(helper, /item\.landingKey/);
  assert.match(build, /goToPage\(navLandingKey_\(item\)\)/);
});

test('mobile POS button uses the same POS V2 landing key', () => {
  const mobile = functionSource(js, 'mobileItemKey_');
  assert.match(mobile, /navLandingKey_\(item\)/);
});

test('legacy pos route is compatibility-only and normalizes to POS V2', () => {
  const normalize = functionSource(v2, 'posV2NormalizeRoute_');
  assert.match(normalize, /key\s*===\s*['"]pos['"]/);
  assert.match(normalize, /['"]posv2['"]/);
  assert.match(v2, /key\s*=\s*posV2NormalizeRoute_\(key\)/);
  assert.match(v2, /posV2SetActive_\(key\s*===\s*['"]posv2['"]\)/);
});

console.log('\n' + pass + '/' + (pass + fail) + ' passed');
if (fail) process.exit(1);
