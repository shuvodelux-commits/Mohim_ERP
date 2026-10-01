'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('PASS', name); }
  catch (err) { fail++; console.error('FAIL', name); console.error(err.stack || err); }
}

const partySrc = read('PartyLedger.gs');
const salesReturn = read('SalesReturn.gs');
const purchaseReturn = read('PurchaseReturn.gs');
const salesManagement = read('SalesManagement.gs');
const returnsHtml = read('returns.html');

const ctx = {
  console,
  ledgerSortKey_: r => {
    const d = String(r.Date || '');
    const dp = d.slice(0, 10);
    let t = d.slice(11);
    if ((!t || t === '00:00:00') && r['Created At']) t = String(r['Created At']).slice(11);
    return dp + 'T' + (t || '00:00:00');
  },
  roundMoney_: v => Math.round((Number(v) || 0) * 100) / 100,
  isDeleted_: r => String(r['Is Deleted'] || '').toUpperCase() === 'TRUE',
  Utilities: {
    Charset: { UTF_8: 'UTF-8' },
    base64EncodeWebSafe: s => Buffer.from(String(s)).toString('base64url'),
    base64DecodeWebSafe: s => Array.from(Buffer.from(String(s), 'base64url')),
    newBlob: b => ({ getDataAsString: () => Buffer.from(b).toString() })
  }
};
vm.createContext(ctx);
vm.runInContext(partySrc, ctx);

test('legacy same-day customer return sorts after earlier sales by append order', () => {
  ctx.partyLedgerReadIndex_ = () => [
    {_rowIndex:10,'Customer ID':'C1','Customer Name':'A','Ledger ID':'L-SALE-1',Date:'2026-09-05','Created At':'2026-09-05T10:10:00',Type:'Sale',Debit:110,Credit:0,'Is Deleted':''},
    {_rowIndex:11,'Customer ID':'C1','Customer Name':'A','Ledger ID':'L-SALE-2',Date:'2026-09-05','Created At':'2026-09-05T10:20:00',Type:'Sale',Debit:178,Credit:0,'Is Deleted':''},
    // Existing live rows created by the old SalesReturn code have no Created At.
    {_rowIndex:12,'Customer ID':'C1','Customer Name':'A','Ledger ID':'L-RETURN',Date:'2026-09-05','Created At':'',Type:'Sales Return Credit',Debit:0,Credit:300,'Is Deleted':''}
  ];
  const asc = ctx.partyLedgerBuildAscendingIndex_('customer', 'C1');
  assert.deepEqual(asc.map(r => r['Ledger ID']), ['L-SALE-1','L-SALE-2','L-RETURN']);
  assert.deepEqual(asc.map(r => r._displayBalance), [110,288,-12]);
});

test('party ledger stable key uses business date then physical append order for same-day chronology', () => {
  const older = ctx.partyLedgerStableSortKey_({_rowIndex:40,'Ledger ID':'A',Date:'2026-09-05','Created At':'2026-09-05T23:59:59'});
  const newer = ctx.partyLedgerStableSortKey_({_rowIndex:41,'Ledger ID':'B',Date:'2026-09-05','Created At':''});
  assert.ok(older < newer, `${older} should sort before ${newer}`);
});

test('new sales return ledger credit records Created At for exact same-day ordering', () => {
  assert.match(salesReturn, /'Type': 'Sales Return Credit'[\s\S]{0,260}'Created At': now/);
});

test('sale update customer ledger correction rows record Created At', () => {
  const credit = /'Type': 'Sale Update Credit'[\s\S]{0,260}'Created At': now/;
  const debit = /'Type': 'Sale Update Debit'[\s\S]{0,260}'Created At': now/;
  assert.match(salesManagement, credit);
  assert.match(salesManagement, debit);
});

test('purchase return supplier ledger credit also records Created At', () => {
  assert.match(purchaseReturn, /'Type': 'Purchase Return Credit'[\s\S]{0,260}'Created At': now/);
});


test('cash refund capacity is paid amount minus prior cash refunds only', () => {
  const match = salesReturn.match(/function salesReturnCashRefundAvailable_\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
  assert.ok(match, 'cash-refund helper missing');
  const cashCtx = {
    roundMoney_: v => Math.round((Number(v) || 0) * 100) / 100,
    activeRows_: () => [
      {'Invoice ID':'INV-1','Refund Method':'Cash','Total Return Amount':120},
      {'Invoice ID':'INV-1','Refund Method':'Store Credit','Total Return Amount':90},
      {'Invoice ID':'INV-2','Refund Method':'Cash','Total Return Amount':50}
    ]
  };
  vm.createContext(cashCtx);
  vm.runInContext(match[0], cashCtx);
  assert.equal(cashCtx.salesReturnCashRefundAvailable_('INV-1', 500), 380);
  assert.equal(cashCtx.salesReturnCashRefundAvailable_('INV-1', 0), 0);
});

test('sales return bootstrap exposes remaining invoice cash-refund capacity', () => {
  assert.match(salesReturn, /cashRefundAvailable/);
  assert.match(salesReturn, /priorCashRefunds/);
});

test('return UI does not default to an impossible cash refund', () => {
  assert.match(returnsHtml, /id="rtCashRefundAvailable"/);
  assert.match(returnsHtml, /function\s+rtApplyRefundAvailability_\s*\(/);
  assert.match(returnsHtml, /cashRefundAvailable\s*<=\s*0/);
  assert.match(returnsHtml, /refundSelect\.value\s*=\s*'Store Credit'/);
  assert.match(returnsHtml, /cashOption\.disabled\s*=\s*cashRefundAvailable\s*<=\s*0/);
});

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
