'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

const pos = read('pos.html');
const v2 = read('posv2.html');
const ui = read('UI.gs');
const sales = read('sales.html');
const drafts = read('draftSales.html');
const daybook = read('daybook.html');
const dashboard = read('dashboard.html');
const index = read('index.html');
const invoice = read('Invoice.gs');

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

test('New Sale resets the shared runtime and opens POS V2', () => {
  const marker = "document.getElementById('posNewSaleBtn').addEventListener";
  const start = pos.indexOf(marker);
  assert.notStrictEqual(start, -1);
  const block = pos.slice(start, start + 650);
  assert.match(block, /posExitUpdateMode_\(\)/);
  assert.match(block, /posExitDraftMode_\(false\)/);
  assert.match(block, /posResetSaleForm_\(\)/);
  assert.match(block, /goToPage\(['"]posv2['"]\)/);
});

test('Open Draft and Continue use POS V2 while retaining the same draft identity', () => {
  const open = functionSource(pos, 'posOpenDraft_');
  const restore = functionSource(pos, 'posRestoreDraft_');
  assert.match(open, /:\s*['"]posv2['"]/);
  assert.match(open, /serverCall\(['"]getSalesDraft['"]/);
  assert.match(open, /posRestoreDraft_\(results\[1\]\)/);
  assert.match(drafts, /posOpenDraft_\(draftId,['"]posv2['"]\)/);
  assert.match(restore, /posState\.draftId\s*=\s*draft\.draftId/);
  assert.match(restore, /posState\.draftVersion\s*=\s*draft\.version/);
});

test('draft restoration preserves full saved form and line metadata', () => {
  const restore = functionSource(pos, 'posRestoreDraft_');
  for (const token of [
    'draft.customerName', 'draft.customerPhone', 'draft.customerFatherName', 'draft.customerAddress',
    'draft.discount', 'payment.amountReceived', 'payment.paymentMethod', 'payment.bankAccountId',
    'draft.notes', 'item.unit', 'item.qty', 'item.unitPrice', 'item.lineTotal',
    'item.savedPriceMode', 'item.shortageResolution', 'item.vendorId', 'item.vendorName',
    'item.vendorUnitCost', 'item.serialSelections', 'item.warrantyData'
  ]) assert.ok(restore.includes(token), 'missing draft restoration token: ' + token);
});

test('Edit Sale and Day Book Edit route to POS V2', () => {
  const edit = functionSource(sales, 'smUpdateInvoice_');
  assert.match(edit, /serverCall\(['"]getSaleForUpdate['"]/);
  assert.match(edit, /goToPage\(['"]posv2['"]\)/);
  assert.match(edit, /posLoadUpdateInvoice_/);
  assert.match(daybook, /getSaleForUpdate[\s\S]*goToPage\(['"]posv2['"]\)[\s\S]*posLoadUpdateInvoice_/);
});

test('existing sale restoration keeps original invoice identity and editable sale data', () => {
  const updateStart = pos.indexOf('function posLoadUpdateInvoice_(');
  const updateEnd = pos.indexOf('function posEnterUpdateMode_', updateStart);
  assert.notStrictEqual(updateStart, -1);
  assert.notStrictEqual(updateEnd, -1);
  const update = pos.slice(updateStart, updateEnd);
  for (const token of [
    'item.qty', 'item.unitPrice', 'item.lineTotal', 'item.vendorId', 'item.vendorName',
    'item.vendorUnitCost', 'inv.customerName', 'inv.customerPhone', 'inv.customerAddress',
    'inv.discount', 'inv.paidAmount', 'inv.paymentMethod', 'inv.bankAccountId'
  ]) assert.ok(update.includes(token), 'missing update restoration token: ' + token);
  assert.match(update, /posState\.updateInvoiceId\s*=\s*inv\.invoiceId/);
  assert.match(update, /posEnterUpdateMode_\(\)/);
  assert.match(pos, /isUpdate\s*\?\s*serverCall\(['"]updateSale['"]/);
});

test('Duplicate Draft and Duplicate Sale/Invoice route to POS V2', () => {
  const draftDup = functionSource(drafts, 'draftSalesDuplicate_');
  const saleDup = functionSource(sales, 'smDuplicateSale_');
  assert.match(draftDup, /goToPage\(['"]posv2['"]\)/);
  assert.match(draftDup, /posLoadDuplicateInvoice_\(draft\)/);
  assert.match(saleDup, /goToPage\(["']posv2["']\)/);
  assert.match(saleDup, /posLoadDuplicateInvoice_\(inv\)/);
});

test('duplicate restores copied form data but clears source identity', () => {
  const duplicate = functionSource(pos, 'posLoadDuplicateInvoice_');
  const fields = functionSource(pos, 'posRestoreCopiedSaleFields_');
  assert.match(duplicate, /posExitUpdateMode_\(\)/);
  assert.match(duplicate, /posExitDraftMode_\(false\)/);
  assert.match(duplicate, /posState\.updateInvoiceId\s*=\s*null/);
  assert.match(duplicate, /posState\.draftId\s*=\s*null/);
  assert.match(duplicate, /posRestoreCopiedSaleFields_\(inv\)/);
  assert.doesNotMatch(duplicate, /posState\.updateInvoiceId\s*=\s*inv\.invoiceId/);
  for (const token of [
    'source.customerName', 'source.customerPhone', 'source.customerFatherName', 'source.customerAddress',
    'source.discount', 'source.notes', 'payment.amountReceived', 'payment.paymentMethod', 'payment.bankAccountId'
  ]) assert.ok(fields.includes(token), 'missing duplicate field restoration token: ' + token);
  for (const token of [
    'item.unit', 'item.unitPrice', 'item.lineTotal', 'item.savedPriceMode',
    'item.shortageResolution', 'item.vendorId', 'item.vendorName', 'item.vendorUnitCost',
    'item.serialSelections', 'item.warrantyData'
  ]) assert.ok(duplicate.includes(token), 'missing duplicate line token: ' + token);
});

test('Duplicate Invoice uses original tender, not later settlement collections', () => {
  const payload = functionSource(invoice, 'buildInvoicePayload_');
  assert.match(payload, /originalPaidAmount:\s*Number\(sale\[['"]Paid Amount['"]\]\)/);
  assert.match(payload, /bankAccountId:\s*sale\[['"]Bank Account ID['"]\]/);
  const payment = functionSource(pos, 'posCopiedPaymentSnapshot_');
  assert.ok(payment.indexOf('source.originalPaidAmount') < payment.indexOf('source.paidAmount'));
});

test('duplicate completion cannot modify the source invoice or draft', () => {
  const duplicate = functionSource(pos, 'posLoadDuplicateInvoice_');
  assert.doesNotMatch(duplicate, /sourceDraftId|sourceDraftVersion|updateSale/);
  assert.match(pos, /var targetInvoiceId = posState\.updateInvoiceId \|\| ['"]/);
  assert.match(pos, /isUpdate\s*\?\s*serverCall\(['"]updateSale['"][\s\S]*:\s*serverCall\(['"]completeSale['"]/);
});

test('all audited user-facing POS links point to V2 and Classic is absent from nav', () => {
  const posBlock = ui.slice(ui.indexOf("key: 'pos', label: 'POS'"), ui.indexOf("{ key: 'counter'"));
  assert.match(posBlock, /landingKey:\s*['"]posv2['"]/);
  assert.doesNotMatch(posBlock, /Classic POS/);
  assert.match(dashboard, /goToPage\(['"]posv2['"]\)/);
  assert.match(index, /data-mobile-page="pos"[\s\S]*?goToPage\(['"]posv2['"]\)/);

  const htmlFiles = fs.readdirSync(root).filter(name => name.endsWith('.html'));
  for (const name of htmlFiles) {
    const source = read(name);
    assert.doesNotMatch(source, /goToPage\s*\(\s*['"]pos['"]\s*\)/, name + ' still opens Classic POS');
  }

  const normalize = functionSource(v2, 'posV2NormalizeRoute_');
  assert.match(normalize, /key\s*===\s*['"]pos['"]\s*\?\s*['"]posv2['"]/);
});

console.log('\n' + pass + '/' + (pass + fail) + ' passed');
if (fail) process.exit(1);
