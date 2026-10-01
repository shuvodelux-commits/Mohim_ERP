'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

function fnSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `missing function ${name}`);
  let brace = source.indexOf('{', start);
  let depth = 0, quote = null, escape = false, line = false, block = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i], next = source[i + 1];
    if (line) { if (ch === '\n') line = false; continue; }
    if (block) { if (ch === '*' && next === '/') { block = false; i++; } continue; }
    if (quote) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && next === '/') { line = true; i++; continue; }
    if (ch === '/' && next === '*') { block = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    if (ch === '}') { depth--; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(`unterminated function ${name}`);
}

const tests = [];
function test(name, fn) { tests.push({name, fn}); }

test('role system exposes one shared edit-only Opening Balance permission', () => {
  const ui = read('UI.gs');
  assert.match(ui, /key:\s*['"]openingBalance['"]/);
  assert.match(ui, /Opening Balance Edit/);
  assert.match(ui, /permissionMode:\s*['"]editOnly['"]/);
  const role = read('RoleManagement.gs');
  assert.match(fnSource(role, 'sanitizePermissions_'), /permissionMode|editOnly/);
  const html = read('roles.html');
  assert.match(html, /permissionMode/);
  assert.match(html, /editOnly/);
});

test('opening balance audit sheet and ID prefix are declared', () => {
  const cfg = read('Config.gs');
  assert.match(cfg, /OPENING_BALANCE_EDIT_LOG:\s*['"]Opening Balance Edit Log['"]/);
  assert.match(cfg, /OPENING_BALANCE_EDIT_LOG:\s*\[/);
  assert.match(cfg, /Old Opening Balance/);
  assert.match(cfg, /New Opening Balance/);
  assert.match(cfg, /Reason/);
  assert.match(cfg, /Changed By/);
  assert.match(cfg, /OPENING_BALANCE_EDIT_LOG:\s*['"]OBL['"]/);
});

test('signed opening balance helper maps positive to debit and negative to credit', () => {
  const src = read('OpeningBalance.gs');
  const ctx = {
    roundMoney_: n => Math.round((Number(n) + Number.EPSILON) * 100) / 100,
    sanitizeInput_: v => String(v == null ? '' : v).trim()
  };
  vm.createContext(ctx);
  vm.runInContext(fnSource(src, 'parseSignedOpeningBalance_'), ctx);
  vm.runInContext(fnSource(src, 'openingBalanceLedgerAmounts_'), ctx);
  assert.strictEqual(ctx.parseSignedOpeningBalance_('-123.456'), -123.46);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.openingBalanceLedgerAmounts_(250))), {Debit:250, Credit:''});
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.openingBalanceLedgerAmounts_(-250))), {Debit:'', Credit:250});
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.openingBalanceLedgerAmounts_(0))), {Debit:'', Credit:''});
});

test('opening balance correction plan uses delta and shifts every active dependent ledger balance', () => {
  const src = read('OpeningBalance.gs');
  const ctx = {
    roundMoney_: n => Math.round((Number(n) + Number.EPSILON) * 100) / 100,
    sanitizeInput_: v => String(v == null ? '' : v).trim(),
    isDeleted_: row => String(row['Is Deleted'] || '').toUpperCase() === 'TRUE',
    actorName_: user => user && user.name || 'Tester',
    generateId_: () => 'OBL-000001'
  };
  vm.createContext(ctx);
  ['parseSignedOpeningBalance_', 'openingBalanceLedgerAmounts_', 'openingBalanceEntityConfig_', 'buildOpeningBalanceCorrectionPlan_'].forEach(name => vm.runInContext(fnSource(src, name), ctx));
  const master = {'Customer ID':'CUS-1','Customer Name':'A','Opening Balance':100,'Current Due':130,'Created At':'2026-08-01T10:00:00'};
  const ledger = [
    {_rowIndex:2,'Ledger ID':'LED-1','Customer ID':'CUS-1','Type':'Opening Balance','Reference':'DEMO','Debit':100,'Credit':'','Balance':100},
    {_rowIndex:3,'Ledger ID':'LED-2','Customer ID':'CUS-1','Type':'Sale','Debit':50,'Credit':'','Balance':150},
    {_rowIndex:4,'Ledger ID':'LED-3','Customer ID':'CUS-1','Type':'Payment','Debit':'','Credit':20,'Balance':130},
    {_rowIndex:5,'Ledger ID':'LED-X','Customer ID':'CUS-1','Type':'Payment','Credit':1,'Balance':999,'Is Deleted':'TRUE'}
  ];
  const plan = ctx.buildOpeningBalanceCorrectionPlan_('Customer', master, ledger, -50, 'Correction', {name:'Admin'}, new Date('2026-09-02T10:00:00Z'));
  assert.strictEqual(plan.delta, -150);
  assert.strictEqual(plan.newDue, -20);
  assert.strictEqual(plan.masterFields['Opening Balance'], -50);
  assert.strictEqual(plan.masterFields['Current Due'], -20);
  assert.strictEqual(plan.ledgerUpdates.length, 3);
  const byRow = Object.fromEntries(plan.ledgerUpdates.map(x => [x.rowIndex, x.fields]));
  assert.strictEqual(byRow[2].Balance, -50);
  assert.strictEqual(byRow[2].Debit, '');
  assert.strictEqual(byRow[2].Credit, 50);
  assert.strictEqual(byRow[3].Balance, 0);
  assert.strictEqual(byRow[4].Balance, -20);
  assert.strictEqual(byRow[5], undefined);
  assert.strictEqual(plan.auditRow['Old Opening Balance'], 100);
  assert.strictEqual(plan.auditRow['New Opening Balance'], -50);
  assert.strictEqual(plan.auditRow['Reason'], 'Correction');
});

test('opening balance apply validates ledger shape before the first accounting write', () => {
  const body = fnSource(read('OpeningBalance.gs'), 'applyOpeningBalanceCorrectionPlan_');
  const validateAt = body.indexOf("getSheetHeaders_(plan.ledgerSheet)");
  const masterWriteAt = body.indexOf("updateRowFields_(plan.masterSheet");
  assert(validateAt >= 0 && masterWriteAt >= 0 && validateAt < masterWriteAt,
    'ledger validation must happen before master balance mutation');
});

test('customer and supplier edits require special permission only when opening balance changes', () => {
  const cust = fnSource(read('Customer.gs'), 'updateCustomer');
  const sup = fnSource(read('Suppliers.gs'), 'updateSupplier');
  for (const body of [cust, sup]) {
    assert.match(body, /openingBalance/);
    assert.match(body, /openingBalanceReason/);
    assert.match(body, /requirePermission_\(token,\s*["']openingBalance["'],\s*["']edit["']\)/);
    assert.match(body, /buildOpeningBalanceCorrectionPlan_/);
    assert.match(body, /applyOpeningBalanceCorrectionPlan_/);
  }
});

test('new customer and supplier accept signed opening balance and write credit for negative opening', () => {
  const cust = fnSource(read('Customer.gs'), 'addCustomer_');
  const sup = fnSource(read('Suppliers.gs'), 'addSupplier');
  for (const body of [cust, sup]) {
    assert.match(body, /parseSignedOpeningBalance_/);
    assert.match(body, /openingBalanceLedgerAmounts_/);
    assert.doesNotMatch(body, /if\s*\(opening\s*>\s*0\)\s*\{\s*appendRow_/s);
  }
});

test('customer and supplier UIs unlock signed opening balance only with special permission and require reason on change', () => {
  const cust = read('customers.html');
  const sup = read('suppliers.html');
  for (const html of [cust, sup]) {
    assert.match(html, /openingBalance.*edit|openingBalance/i);
    assert.match(html, /Opening Balance.*Reason|Reason.*Opening Balance/is);
    assert.match(html, /userPermissions/);
    assert.match(html, /openingBalanceReason/);
    assert.doesNotMatch(html, /Opening Balance[^>]*<\/label><input[^>]*min="0"/i);
  }
});

test('product rows render one Actions trigger instead of five inline action buttons', () => {
  const html = read('products.html');
  const render = fnSource(html, 'prodRender');
  assert.match(render, />Actions/);
  assert.match(render, /data-act=["']menu["']/);
  assert.doesNotMatch(render, />Edit<\/button>/);
  assert.doesNotMatch(render, />Stock<\/button>/);
  assert.doesNotMatch(render, />Lots<\/button>/);
  assert.doesNotMatch(render, />Delete<\/button>/);
  assert.match(html, /id=["']prodActionMenu["']/);
  assert.match(html, /prodOpenActionMenu_/);
  assert.match(html, /Escape/);
  assert.match(html, /getBoundingClientRect/);
});

test('product rerender closes any detached action menu', () => {
  const render = fnSource(read('products.html'), 'prodRender');
  assert.match(render, /prodCloseActionMenu_\(\)/);
});

test('product action dropdown has fixed portal styles and destructive delete item', () => {
  const css = read('style.html');
  assert.match(css, /\.action-menu\s*\{/);
  assert.match(css, /position:\s*fixed/);
  assert.match(css, /\.action-menu-item\.danger|\.danger\.action-menu-item/);
});

let failed = 0;
for (const t of tests) {
  try { t.fn(); console.log('PASS', t.name); }
  catch (e) { failed++; console.error('FAIL', t.name); console.error(e.stack || e); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
if (failed) process.exit(1);
