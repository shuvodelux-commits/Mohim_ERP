'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('discount settlement allows blank note/reason but keeps permission and overpayment guards', () => {
  const src = read('SettlementDiscount.gs');
  const start = src.indexOf('function validateSettlementDiscount_(');
  const end = src.indexOf('function computeSettlementDiscountProfit_(', start);
  assert.ok(start >= 0 && end > start);
  const permissions = [];
  const ctx = vm.createContext({
    roundMoney_: n => Math.round(Number(n) * 100) / 100,
    sanitizeInput_: s => String(s || '').trim(),
    isValidNonNegativeNumber_: n => Number.isFinite(Number(n)) && Number(n) >= 0,
    requirePermission_: (...args) => permissions.push(args)
  });
  vm.runInContext(src.slice(start,end), ctx);
  const settled = ctx.validateSettlementDiscount_('token','suppliers',100,85,15,'');
  assert.equal(settled.total,100);
  assert.equal(settled.discount,15);
  assert.equal(settled.reason,'');
  assert.equal(permissions.length,1);
  assert.equal(permissions[0][1],'settlementDiscount');
  assert.throws(() => ctx.validateSettlementDiscount_('token','suppliers',100,95,15,''), /cannot exceed/);
  assert.throws(() => ctx.validateSettlementDiscount_('token','suppliers',0,20,10,''), /positive due/);
});

test('customer and supplier settlement UIs allow discount with no reason', () => {
  const paths = ['customers.html', 'suppliers.html', 'counter.html', 'customerLedger.html', 'supplierLedger.html'];
  for (const p of paths) {
    const src = read(p);
    assert.doesNotMatch(src, /if\s*\(\s*(?:discountAmount|discount)\s*>\s*0\s*&&\s*!discountReason\)/, p);
    assert.doesNotMatch(src, /Discount Reason \*/i, p);
  }
});

test('delete reason is optional without losing authorization, soft deletion and audit logging', () => {
  const js = read('javascript.html');
  const start = js.indexOf('  function confirmDelete(opts)');
  const end = js.indexOf('  // ---------------- Date-range printing',start);
  assert.ok(start >= 0 && end > start);
  const confirmation = js.slice(start,end);
  assert.match(confirmation, /required:\s*false/);
  assert.match(confirmation, /visible:\s*true/);
  assert.match(js, /reasonRow\.hidden\s*=\s*!o\.reason\.visible/);

  const deleteEngine = read('DeleteEngine.gs');
  assert.doesNotMatch(deleteEngine, /if\s*\(!sanitizeInput_\(reason\)\)\s*return fail_\('Enter a reason/);
  assert.doesNotMatch(deleteEngine, /if\s*\(!reason\)\s*return fail_\('Enter a reason/);
  assert.match(deleteEngine, /requireDeletePermission_/);
  assert.match(deleteEngine, /logDeletion_/);
  assert.match(deleteEngine, /markRowDeleted_/);
  const draft = read('DraftSales.gs');
  assert.doesNotMatch(draft, /if\(!why\) throw new Error\('Reason is required/);
  assert.match(read('posv2.html'), /reason:\s*\{\s*required:\s*false/);
});

test('deletion time windows and backdated/opening-balance audit requirements remain protected', () => {
  const auth = read('Auth.gs'), date = read('Utils.gs'), opening = read('OpeningBalance.gs');
  assert.match(auth,/function requireDeletePermission_/);
  assert.match(auth,/isWithinDeleteWindow_/);
  assert.match(date,/requireBackdatePermission_/);
  assert.match(date,/A reason is required when dating/);
  assert.match(opening,/Reason is required when changing an opening balance/);
});
