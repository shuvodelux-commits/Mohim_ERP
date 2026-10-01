'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('PASS', name); }
  catch (err) { fail++; console.error('FAIL', name); console.error(err.stack || err); }
}

const index = read('index.html');
const js = read('javascript.html');
const css = read('style.html');

test('phone shell has device viewport, five-item bottom navigation and More sheet', () => {
  assert.match(index, /<meta\s+name="viewport"\s+content="[^"]*width=device-width[^"]*viewport-fit=cover[^"]*">/i);
  assert.match(index, /id="mobileBottomNav"/);
  for (const page of ['dashboard','pos','sales','products','more']) {
    assert.match(index, new RegExp('data-mobile-page="' + page + '"'));
  }
  assert.match(index, /id="mobileMoreSheet"/);
  assert.match(index, /id="mobileMoreList"/);
});

test('mobile navigation reuses role-filtered NAV_ITEMS and synchronizes with goToPage', () => {
  for (const fn of ['buildMobileNav_','syncMobileNavigation_','openMobileMore_','closeMobileMore_']) {
    assert.match(js, new RegExp('function\\s+' + fn + '\\s*\\('), 'missing ' + fn);
  }
  assert.match(js, /buildMobileNav_\(items\)/);
  assert.match(js, /syncMobileNavigation_\(key/);
  assert.match(js, /filterNavByRole_|navItemVisible_/);
  assert.match(js, /mobileMoreList/);
});

test('phone breakpoint implements PWA-style sticky app chrome and safe areas without replacing desktop sidebar', () => {
  assert.match(css, /@media\s*\(max-width:\s*540px\)/);
  assert.match(css, /\.mobile-bottom-nav[\s\S]*position:\s*fixed/);
  assert.match(css, /\.mobile-more-sheet[\s\S]*position:\s*fixed/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /\.topbar[\s\S]*position:\s*(?:sticky|fixed)/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /@media\s*\(min-width:\s*541px\)[\s\S]*\.sidebar/);
});

test('shared mobile interaction layer provides card tables, full-screen modals and action bottom sheets', () => {
  assert.match(js, /function\s+enhanceMobileCardTables_\s*\(/);
  assert.match(js, /MutationObserver/);
  assert.match(js, /data-label/);
  assert.match(css, /\.mobile-card-table/);
  assert.match(css, /\.mobile-card-table[\s\S]*display:\s*block/);
  assert.match(css, /\.action-menu[\s\S]*bottom:/);
  assert.match(css, /\.modal-overlay[\s\S]*align-items:\s*(?:stretch|flex-end)/);
  assert.match(css, /\.modal[\s\S]*max-height:\s*(?:100dvh|100vh)/);
});

test('dashboard matches the current lightweight mobile KPI pattern with quick actions and two-column stats', () => {
  const html = read('dashboard.html');
  assert.match(html, /class="mobile-quick-actions"/);
  for (const target of ['pos','sales','purchase','customers']) assert.match(html, new RegExp('data-mobile-quick="' + target + '"'));
  assert.match(css, /@media\s*\(max-width:\s*540px\)[\s\S]*\.stat-grid[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.ok((html.match(/class="stat-card"/g) || []).length >= 8, 'dashboard should keep the operational KPI cards');
});

test('primary operational lists opt into mobile card rendering', () => {
  for (const file of ['sales.html','purchase.html','customers.html','suppliers.html','products.html','vendors.html','expenseList.html','financeLedger.html']) {
    assert.match(read(file), /<table[^>]*class="[^"]*mobile-card-table[^"]*"/, file + ' primary list missing mobile-card-table');
  }
});

test('customer and supplier settlement panels have dedicated mobile layout hooks', () => {
  assert.match(read('customers.html'), /class="[^"]*mobile-payment-panel[^"]*"/);
  assert.match(read('suppliers.html'), /class="[^"]*mobile-payment-panel[^"]*"/);
  assert.match(css, /\.mobile-payment-panel/);
  assert.match(css, /\.mobile-payment-summary/);
});

test('POS and Purchase have phone-specific touch/layout rules without separate transaction code', () => {
  assert.match(css, /@media\s*\(max-width:\s*540px\)[\s\S]*\.pos-layout/);
  assert.match(css, /@media\s*\(max-width:\s*540px\)[\s\S]*\.cart-row/);
  assert.match(css, /#page-purchase[\s\S]*\.table-scroll/);
  assert.doesNotMatch(js, /mobile(Create|Update|Post)(Sale|Purchase)/i);
});

// Refinement contracts from the approved mockup: the bottom bar must reflow
// when role filtering hides a primary destination, and browser chrome should
// match the blue mobile app shell.
test('mobile app chrome declares theme metadata and bottom navigation reflows after role filtering', () => {
  assert.match(index, /<meta\s+name="theme-color"\s+content="#0d5bd7"\s*>/i);
  assert.match(index, /<meta\s+name="mobile-web-app-capable"\s+content="yes"\s*>/i);
  assert.match(index, /<meta\s+name="apple-mobile-web-app-capable"\s+content="yes"\s*>/i);
  assert.match(css, /\.mobile-bottom-nav[\s\S]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(0,\s*1fr\)\)/);
});

test('settlement payment summary stacks into clear total and balance rows on phones', () => {
  assert.match(css, /\.mobile-payment-panel > \*[\s\S]*max-width:\s*none\s*!important/);
  assert.match(css, /\.mobile-payment-summary[\s\S]*display:\s*grid/);
  assert.match(css, /\.mobile-payment-summary strong[\s\S]*font-size:/);
  assert.match(read('customers.html'), /mobile-payment-summary-row/);
  assert.match(read('suppliers.html'), /mobile-payment-summary-row/);
  assert.match(css, /#custPaySettleFullBtn[\s\S]*width:\s*100%/);
  assert.match(css, /#supPaySettleFullBtn[\s\S]*width:\s*100%/);
});

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
