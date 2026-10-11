'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('ledger tones use existing semantic theme colors, not monetary mutations', () => {
  const css = read('style.html');
  const js = read('javascript.html');
  assert.match(css, /\.ledger-txn--increase[\s\S]*?color:var\(--color-danger\)/);
  assert.match(css, /\.ledger-txn--decrease[\s\S]*?color:var\(--color-success\)/);
  assert.match(css, /\.ledger-tone--due\s*\{\s*color:var\(--color-danger\)/);
  assert.match(css, /\.ledger-tone--advance\s*\{\s*color:var\(--color-success\)/);
  assert.match(js, /function partyLedgerBalanceTone_\(balance\)/);
  assert.match(js, /function partyLedgerPaintBalance_\(element, balance\)/);
  const source = js.slice(js.indexOf('  // UI-only: all ledgers retain'), js.indexOf('  function partyLedgerPrintStatement_'));
  const helpers = new Function(source + 'return { tone:partyLedgerBalanceTone_, paint:partyLedgerPaintBalance_ };')();
  assert.equal(helpers.tone(500), 'ledger-tone--due');
  assert.equal(helpers.tone(-500), 'ledger-tone--advance');
  assert.equal(helpers.tone(0), 'ledger-tone--neutral');
  const tokens = new Set(['ledger-tone--due', 'other-class']);
  const element = { classList: {
    remove(...names) { names.forEach(n => tokens.delete(n)); },
    add(name) { tokens.add(name); }
  }};
  helpers.paint(element, -3);
  assert.ok(tokens.has('ledger-tone--advance'));
  assert.ok(!tokens.has('ledger-tone--due'));
  assert.ok(tokens.has('other-class'));
  helpers.paint(element, 0);
  assert.ok(tokens.has('ledger-tone--neutral'));
  assert.ok(!tokens.has('ledger-tone--advance'));
});

test('customer and supplier main ledger rows color debit credit and signed running balances', () => {
  for (const p of ['customerLedger.html', 'supplierLedger.html']) {
    const s = read(p);
    assert.match(s, /class="num ledger-txn--increase" data-label="Debit"/);
    assert.match(s, /class="num ledger-txn--decrease" data-label="Credit"/);
    assert.match(s, /partyLedgerBalanceTone_\(row\['Balance'\]\)/);
    assert.match(s, /partyLedgerPaintBalance_\(document\.querySelector\(/);
    assert.match(s, /partyLedgerPaintBalance_\(document\.getElementById\('(?:customer|supplier)LedgerPayBalanceAfter'\), after\)/);
    assert.match(s, /customerLedgerRenderPagination_|supplierLedgerRenderPagination_/);
  }
});

test('embedded customer supplier ledgers and balance/payment previews share same tone, preserve actions', () => {
  const a = read('customers.html');
  const b = read('suppliers.html');
  for (const s of [a, b]) {
    assert.match(s, /class="num ledger-txn--increase"/);
    assert.match(s, /class="num ledger-txn--decrease"/);
    assert.match(s, /partyLedgerBalanceTone_\(l\['Balance'\]\)/);
    assert.match(s, /partyLedgerPaintBalance_\(document\.getElementById\('(?:cust|sup)DetailDue'\), detailDue\)/);
    assert.match(s, /partyLedgerPaintBalance_\(document\.getElementById\('(?:cust|sup)PayBalanceAfter'\), balance\)/);
    assert.match(s, /data-act="menuLed"/);
  }
  assert.match(a, /'Customer Name'/);
  assert.match(b, /'Supplier Name'/);
});

test('supplier legacy debit-credit correction remains a separate PR, no change to backend calculations', () => {
  const source = read('PartyLedger.gs');
  assert.match(source, /balance = roundMoney_\(balance \+ \(Number\(r\['Debit'\]\) \|\| 0\) - \(Number\(r\['Credit'\]\) \|\| 0\)\)/);
  const css = read('style.html');
  assert.match(css, /Current sheet\/ledger convention: Debit increases due, Credit settles due/);
});
