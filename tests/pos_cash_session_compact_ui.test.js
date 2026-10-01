'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const pos = fs.readFileSync(path.join(root, 'pos.html'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'javascript.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.html'), 'utf8');
const cashSession = fs.readFileSync(path.join(root, 'CashSession.gs'), 'utf8');

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

test('Cash Session control is global in the topbar immediately beside calculator', () => {
  assert.match(index, /id="cashSessionToggleBtn"/);
  assert.match(index, /id="cashSessionTopbarStatus"/);
  const cashPos = index.indexOf('id="cashSessionToggleBtn"');
  const calcPos = index.indexOf('id="calcToggleBtn"');
  assert.ok(cashPos >= 0 && calcPos >= 0 && cashPos < calcPos, 'Cash Session must sit before Calculator');
});

test('POS no longer owns the compact Cash Session button', () => {
  assert.doesNotMatch(pos, /id="posSessionCompactBtn"/);
  assert.doesNotMatch(pos, /class="pos-session-compact-row"/);
  assert.doesNotMatch(pos, /class="pos-session-compact-btn"/);
});

test('Cash Session and Close Day dialogs live outside the POS page as global overlays', () => {
  assert.match(index, /id="posSessionModal"/);
  assert.match(index, /id="posCloseModal"/);
  assert.doesNotMatch(pos, /id="posSessionModal"/);
  assert.doesNotMatch(pos, /id="posCloseModal"/);
  const appStart = index.indexOf('<div id="app"');
  const modalPos = index.indexOf('id="posSessionModal"');
  assert.ok(modalPos >= 0 && appStart >= 0 && modalPos < appStart, 'Cash Session modal should be mounted globally before #app/page visibility');
});

test('global session status is permission-gated and refreshable without opening POS', () => {
  const refresh = functionSource(pos, 'posRefreshGlobalSessionStatus_');
  assert.match(refresh, /cashSessionToggleBtn/);
  assert.match(refresh, /hasActionPermission_\(['"]pos['"],\s*['"]view['"]\)/);
  assert.match(refresh, /getCashSessionSummary/);
  assert.match(refresh, /posSetGlobalSessionStatus_/);
  assert.match(refresh, /posApplySessionSummary_/);
});

test('authenticated shell refreshes the global Cash Session status', () => {
  assert.match(js, /function\s+loadAppShell_\s*\([\s\S]*posRefreshGlobalSessionStatus_\(true\)/);
});

test('global trigger opens the session modal and refreshes live summary', () => {
  const open = functionSource(pos, 'posOpenSessionModal_');
  assert.match(open, /posSessionModal/);
  assert.match(open, /posRefreshGlobalSessionStatus_/);
  assert.match(pos, /cashSessionToggleBtn['"]\)\.addEventListener\(['"]click['"],\s*posOpenSessionModal_/);
});

test('session adjustment warning remains dismissible on POS', () => {
  assert.match(pos, /id="posCashMismatchText"/);
  assert.match(pos, /id="posCashMismatchDismiss"/);
  assert.match(pos, /aria-label="Dismiss cash session adjustment warning"/);
  assert.match(css, /\.cash-mismatch-dismiss/);
});

test('dismissed mismatch stays hidden during later summary refreshes for the same mismatch', () => {
  const render = functionSource(pos, 'posRenderCashMismatchAlert_');
  const dismiss = functionSource(pos, 'posDismissCashMismatchAlert_');
  assert.match(render, /dismissedCashMismatchKey/);
  assert.match(render, /posCashMismatchKey_/);
  assert.match(dismiss, /dismissedCashMismatchKey/);
  assert.match(dismiss, /hidden\s*=\s*true/);
});

test('topbar Cash Session control has global desktop and mobile styling', () => {
  assert.match(css, /#cashSessionToggleBtn\s*\{/);
  assert.match(css, /\.topbar-cash-session-status\.is-open/);
  assert.match(css, /\.topbar-cash-session-status\.is-closed/);
  assert.match(css, /@media\s*\(max-width:\s*540px\)[\s\S]*#cashSessionToggleBtn/);
});

test('cash-session guard directs users to the global topbar control', () => {
  assert.match(cashSession, /top bar[^'"]*Cash Session/i);
  assert.doesNotMatch(cashSession, /POS page\s*→\s*Start Day/);
});

console.log('\n' + pass + '/' + (pass + fail) + ' passed');
if (fail) process.exit(1);
