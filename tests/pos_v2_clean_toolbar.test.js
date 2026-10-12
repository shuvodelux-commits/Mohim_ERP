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

test('Classic POS keeps its category and brand filters while V2 hides them', () => {
  assert.match(pos, /id="posCategoryFilter"/);
  assert.match(pos, /id="posBrandFilter"/);
  assert.match(v2, /body\.pos-v2-active\s+#page-pos\s+\.pos-product-filters\s*\{[^}]*display:\s*none\s*!important/s);
});

test('V2 shows the existing complete product catalog, with original search handlers', () => {
  assert.match(v2, /#posProductGrid\.mobile-search-idle\s*\{\s*display:\s*grid\s*!important/s);
  assert.match(v2, /posV2SetCatalogTitle_\(true\)/);
  assert.match(pos, /function\s+posRenderProductGrid_\s*\(/);
  assert.match(pos, /posSearchEl_\.addEventListener\(['"]keydown['"]/);
  assert.match(pos, /posAddToCart_\(p\)/);
  assert.doesNotMatch(v2, /function\s+posV2BindSearch_\s*\(/);
  assert.doesNotMatch(v2, /pos-v2-quick-items/);
});

test('V2 search toolbar provides Drafts and Add Product actions', () => {
  const toolbar = functionSource(v2, 'posV2EnsureSearchToolbar_');
  assert.match(toolbar, /v2DraftsBtn/);
  assert.match(toolbar, /Drafts/);
  assert.match(toolbar, /v2AddProductBtn/);
  assert.match(toolbar, /Add Product/);
});

test('V2 Drafts opens an all-drafts modal and opens drafts back into POS V2', () => {
  const load = functionSource(v2, 'posV2OpenDrafts_');
  const render = functionSource(v2, 'posV2RenderDraftRows_');
  assert.match(load, /getSalesDraftList/);
  assert.doesNotMatch(load, /slice\s*\(\s*0\s*,\s*3\s*\)/);
  assert.match(render, /draftNo/);
  assert.match(render, /customerName/);
  assert.match(render, /grandTotal/);
  assert.match(v2, /posOpenDraft_\([^,]+,\s*['"]posv2['"]\)/);
});

test('V2 Drafts modal exposes the full Draft Invoice action menu', () => {
  const ensure = functionSource(v2, 'posV2EnsureDraftModal_');
  const render = functionSource(v2, 'posV2RenderDraftRows_');
  const run = functionSource(v2, 'posV2RunDraftAction_');
  const duplicate = functionSource(v2, 'posV2DuplicateDraft_');
  const preview = functionSource(v2, 'posV2PreviewDraft_');
  const remove = functionSource(v2, 'posV2DeleteDraft_');

  assert.match(ensure, /openRowActionMenu_/);
  assert.match(ensure, /label:\s*['"]Open['"]/);
  assert.match(ensure, /label:\s*['"]Duplicate['"]/);
  assert.match(ensure, /label:\s*['"]Print \/ Preview['"]/);
  assert.match(ensure, /label:\s*['"]Save JPG['"]/);
  assert.match(ensure, /label:\s*['"]Delete['"]/);
  assert.match(render, /data-pos-v2-draft-menu/);
  assert.match(run, /posV2OpenDraftRow_/);
  assert.match(run, /posV2DuplicateDraft_/);
  assert.match(run, /posV2PreviewDraft_/);
  assert.match(run, /posV2DeleteDraft_/);
  assert.match(duplicate, /getSalesDraft/);
  assert.match(duplicate, /posLoadDuplicateInvoice_/);
  assert.match(preview, /getSalesDraftPreview/);
  assert.match(preview, /downloadInvoiceJpg_/);
  assert.match(remove, /deleteSalesDraft/);
  assert.match(remove, /posLoadRecentDrafts_/);
  assert.match(remove, /posV2OpenDrafts_/);
});

test('V2 Add Product delegates to the existing Products modal workflow', () => {
  const open = functionSource(v2, 'posV2OpenAddProduct_');
  assert.match(open, /prodAddBtn/);
  assert.match(open, /prodLoad/);
  assert.match(open, /\.click\s*\(/);
  assert.doesNotMatch(open, /serverCall\(['"]addProduct/);
});

test('shared draft opener keeps its one-argument contract while accepting an optional V2 target', () => {
  const open = functionSource(pos, 'posOpenDraft_');
  assert.match(pos, /function\s+posOpenDraft_\s*\(draftId\)/);
  assert.match(open, /arguments\[1\]/);
  assert.match(open, /targetPage/);
  assert.match(open, /goToPage\(targetPage\)/);
});

console.log('\n' + pass + '/' + (pass + fail) + ' passed');
if (fail) process.exit(1);
