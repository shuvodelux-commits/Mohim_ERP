const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const indexHtml = fs.readFileSync('index.html', 'utf8');
const js = fs.readFileSync('javascript.html', 'utf8');
const css = fs.readFileSync('style.html', 'utf8');

assert.match(indexHtml, /id="confirmActionModal"/, 'global confirmation modal shell must exist');
assert.match(indexHtml, /role="dialog"/);
assert.match(indexHtml, /aria-modal="true"/);
assert.doesNotMatch(indexHtml, /id="deleteModal"/, 'legacy delete modal shell must be retired');
assert.match(js, /function confirmAction\(options\)/);
assert.match(js, /function runConfirmedAction\(options, runner\)/);
assert.match(js, /function banglaAmountInWords_\(value\)/);
assert.match(css, /\.confirm-action-overlay/);
assert.match(css, /\.confirm-action-dialog/);
assert.match(css, /is-danger/);
assert.match(css, /is-state-change/);

// Evaluate only the Bangla amount converter and its lookup table in isolation.
const tableMatch = js.match(/var BN_AMOUNT_0_99_\s*=\s*\[[\s\S]*?\];/);
const intMatch = js.match(/function banglaInteger_\(n\)\s*\{[\s\S]*?\n  \}/);
const amountMatch = js.match(/function banglaAmountInWords_\(value\)\s*\{[\s\S]*?\n  \}/);
assert.ok(tableMatch && intMatch && amountMatch, 'shared Bangla amount helpers must be extractable');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(`${tableMatch[0]}\n${intMatch[0]}\n${amountMatch[0]}`, ctx);
assert.equal(ctx.banglaAmountInWords_('23,000.50'), 'তেইশ হাজার টাকা পঞ্চাশ পয়সা মাত্র');
assert.equal(ctx.banglaAmountInWords_('1,25,00,000'), 'এক কোটি পঁচিশ লাখ টাকা মাত্র');
assert.equal(ctx.banglaAmountInWords_('0'), '');

console.log('confirmation_dialog_core: PASS');

assert.match(js, /function confirmDelete\(opts\)/, 'legacy confirmDelete entry point must remain');
assert.match(js, /function legacyDeleteSummaryText_\(html\)/);
assert.doesNotMatch(js, /function submitDelete\(/, 'legacy submitDelete must be retired');
assert.doesNotMatch(js, /var deleteCtx_\s*=/, 'legacy delete modal state must be retired');
