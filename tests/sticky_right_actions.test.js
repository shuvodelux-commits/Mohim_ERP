'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname,'..',name),'utf8');

test('Sales, Daybook and both Party ledgers put pinned action last for horizontal tablet scrolling', () => {
  for (const name of ['sales.html','daybook.html','customerLedger.html','supplierLedger.html']) {
    const html = read(name);
    assert.match(html, /<th[^>]*erp-sticky-action-col[^>]*>[\s\S]*?<\/th>\s*<\/tr>/, name + ' needs last action header');
    assert.match(html, /<td class="erp-sticky-action-col/, name + ' needs a row action cell');
  }
});
test('each transaction row actually renders Actions after its final financial/status field', () => {
  for (const [name, lastField] of [
    ['sales.html', 's.paymentStatus'],
    ['daybook.html', 'statusBadge'],
    ['customerLedger.html', 'data-label="Balance"'],
    ['supplierLedger.html', 'data-label="Balance"']
  ]) {
    const html = read(name);
    const start = html.indexOf('      tr.innerHTML =');
    const end = html.indexOf('      body.appendChild(tr);', start);
    assert.ok(start >= 0 && end > start, name + ' must build a row');
    const row = html.slice(start, end);
    const action = row.lastIndexOf("'<td class=\"erp-sticky-action-col\">");
    const field = row.lastIndexOf(lastField);
    assert.ok(action > field, name + ' must render Actions after the last data cell');
  }
});

test('sticky Actions is an opaque rightmost column above rows and preserved on desktop/tablet', () => {
  const css = read('style.html');
  assert.match(css, /\.erp-sticky-action-col\s*\{[^}]*position:\s*sticky;[^}]*right:\s*0;/s);
  assert.match(css, /\.table-scroll[^}]*thead[^}]*\.erp-sticky-action-col[^}]*z-index:\s*[3-9]/s);
  assert.match(css, /\.erp-sticky-action-col[^}]*background:\s*var\(--color-surface\)/s);
  assert.match(css, /@media print[^}]*\.erp-sticky-action-col[^}]*position:\s*static/s);
});
test('tablet actions are three-dot icon buttons, with descriptive names and click handlers preserved', () => {
  const sales=read('sales.html'), customer=read('customerLedger.html'), supplier=read('supplierLedger.html'), daybook=read('daybook.html');
  for (const page of [sales, customer, supplier, daybook]) {
    assert.match(page, /rowActionTriggerHtml_\(/, 'page must use shared accessible three-dot trigger');
    assert.match(page, /Actions for (?:invoice|transaction|customer|supplier)/);
    assert.doesNotMatch(page, /Actions &#9662;/);
  }
  const shared=read('javascript.html');
  assert.match(shared, /class="erp-row-action-trigger"/);
  assert.match(shared, /aria-label="' \+ escapeHtml/);
  assert.match(sales, /data-act="menu"/);
  assert.match(customer, /data-customer-ledger-action-index=/);
  assert.match(supplier, /data-supplier-ledger-action-index=/);
  assert.match(daybook, /openRowActionMenu_\(btn,/);
  assert.match(daybook, /dbDelete_\(row\)/);
});
test('mobile card presentation keeps last action cell at card end and invoice first', () => {
  const css=read('style.html');
  assert.match(css, /@media[^\n]*max-width:\s*540px[^]*\.mobile-card-table[^\{]*\.erp-sticky-action-col/);
  assert.match(css, /order:\s*9/);
  assert.match(css, /#smTableScroll[^}]*first-child/);
});
test('shared menu renders SVG leading icons and an accessible divider/danger item', () => {
  const js=read('javascript.html');
  assert.match(js, /rowActionMenuIcon_/);
  assert.match(js, /createElementNS\(['"]http:\/\/www\.w3\.org\/2000\/svg['"]/);
  assert.match(js, /action-menu-icon/);
  assert.match(js, /btn\.appendChild\(.*label/i);
  assert.match(js, /item\.danger/);
  assert.match(js, /aria-expanded.*false/);
  assert.match(js, /e\.key === ['"]Escape['"].*closeRowActionMenu_\(true\)/);
});
