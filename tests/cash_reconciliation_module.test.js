'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

const ui = read('UI.gs');
const index = read('index.html');
const js = read('javascript.html');
const config = read('Config.gs');
const source = read('CashReconciliation.gs');
const html = read('cashReconciliation.html');
const dayBook = read('DayBook.gs');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('PASS', name); }
  catch (err) { fail++; console.error('FAIL', name); console.error(err.stack || err); }
}

function runtime(seed) {
  const sheets = Object.fromEntries(Object.entries(seed || {}).map(([k,v]) => [k, v.map((x, i) => ({...x, _rowIndex: x._rowIndex || i + 2}))]));
  const writes = [];
  const ctx = {
    console,
    CONFIG: { LOCK_TIMEOUT_MS: 1000 },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    requirePermission_: () => ({ 'Full Name': 'Tester' }),
    getSettingsMap_: () => ({ 'Currency Symbol': '৳' }),
    getAllRows_: key => (sheets[key] || []).map(x => ({...x})),
    activeRows_: key => (sheets[key] || []).filter(x => String(x['Is Deleted'] || '').toUpperCase() !== 'TRUE').map(x => ({...x})),
    updateRowFields_: (key, rowIndex, fields) => {
      const row = (sheets[key] || []).find(x => Number(x._rowIndex) === Number(rowIndex));
      if (!row) throw new Error('Missing row ' + key + ':' + rowIndex);
      Object.assign(row, fields);
      writes.push({ key, rowIndex, fields: {...fields} });
    },
    roundMoney_: n => Math.round((Number(n) + Number.EPSILON) * 100) / 100,
    safeDateOnly_: value => String(value == null ? '' : value).slice(0, 10),
    sanitizeInput_: value => String(value || ''),
    ok_: data => ({ success: true, data }),
    fail_: message => ({ success: false, message: String(message) }),
    logError_: () => {}
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx, { filename: 'CashReconciliation.gs' });
  return { ctx, sheets, writes };
}

function closedSession(id, date, opening, counted, overrides = {}) {
  return Object.assign({
    'Session ID': id,
    Date: date,
    'Opened At': date + 'T08:00:00',
    'Opening Cash': opening,
    'Closed At': date + 'T20:00:00',
    'Expected Cash': counted,
    'Counted Cash': counted,
    Variance: 0,
    Status: 'Closed',
    Notes: ''
  }, overrides);
}

test('Day Book does not expose reconciliation markers as business transaction rows', () => {
  assert.doesNotMatch(dayBook, /DAY_BOOK_MODULES\s*=\s*\[[\s\S]*['"]Cash Session['"]/);
  assert.doesNotMatch(dayBook, /module:\s*['"]Cash Session['"]/);
});

test('Cash Reconciliation remains a first-class navigation and permission module', () => {
  assert.match(ui, /key:\s*['"]cashReconciliation['"][\s\S]*label:\s*['"]Cash Reconciliation['"]/);
  assert.match(index, /id="page-cashReconciliation"[\s\S]*include\(['"]cashReconciliation['"]\)/);
  assert.match(js, /cashReconciliation:\s*['"]cashRecLoad['"]/);
});

test('cash-session schema stores opening and closing explanation entry IDs', () => {
  const block = config.slice(config.indexOf('CASH_SESSIONS: ['), config.indexOf('INVOICE_EDIT_LOG:', config.indexOf('CASH_SESSIONS: [')));
  assert.match(block, /Opening Explanation Entry IDs/);
  assert.match(block, /Closing Explanation Entry IDs/);
});

test('CS-000004 style opening shortage asks for the real Cash Out transaction instead of treating a session marker as reconciliation', () => {
  const { ctx } = runtime({
    CASH_SESSIONS: [
      closedSession('CS-000003', '2026-09-26', 20000, 20000),
      closedSession('CS-000004', '2026-09-27', 10000, 10000)
    ],
    CASH_BOOK: [
      { 'Entry ID':'CB-OLD', Type:'Session Open', Reference:'CS-000004', Debit:10000, Credit:'', 'Is Deleted':'' }
    ]
  });

  const rows = ctx.cashReconciliationBuildRows_(ctx.getAllRows_('CASH_SESSIONS'), ctx.getAllRows_('CASH_BOOK'));
  const row = rows[1];

  assert.equal(row.openingExpected, 20000);
  assert.equal(row.openingCounted, 10000);
  assert.equal(row.openingDifference, -10000);
  assert.equal(row.openingState, 'Unexplained');
  assert.equal(row.openingRequiredDirection, 'Cash Out');
  assert.equal(row.openingRequiredAmount, 10000);
  assert.equal(row.openingRemainingAmount, 10000);
});

test('multiple linked real Cash Out entries explain one opening difference exactly', () => {
  const { ctx } = runtime({
    CASH_SESSIONS: [
      closedSession('CS-1', '2026-09-26', 10000, 10000),
      closedSession('CS-2', '2026-09-27', 6000, 6000, {
        'Opening Explanation Entry IDs': '["CB-1","CB-2"]'
      })
    ],
    CASH_BOOK: [
      { 'Entry ID':'CB-1', Date:'2026-09-27', Type:'Expense', Reference:'EXP-1', Debit:2500, Credit:'', Description:'Shop expense' },
      { 'Entry ID':'CB-2', Date:'2026-09-27', Type:'Owner Withdrawal', Reference:'FIN-1', Debit:1500, Credit:'', Description:'Owner withdrawal' }
    ]
  });

  const rows = ctx.cashReconciliationBuildRows_(ctx.getAllRows_('CASH_SESSIONS'), ctx.getAllRows_('CASH_BOOK'));
  assert.equal(rows[1].openingDifference, -4000);
  assert.equal(rows[1].openingLinkedAmount, 4000);
  assert.equal(rows[1].openingRemainingAmount, 0);
  assert.equal(rows[1].openingState, 'Explained');
});

test('edited, deleted, wrong-direction or missing linked entries move the explanation to Needs Review', () => {
  const { ctx } = runtime({
    CASH_SESSIONS: [
      closedSession('CS-1', '2026-09-26', 10000, 10000),
      closedSession('CS-2', '2026-09-27', 6000, 6000, {
        'Opening Explanation Entry IDs': '["CB-1","CB-2"]'
      })
    ],
    CASH_BOOK: [
      { 'Entry ID':'CB-1', Type:'Expense', Reference:'EXP-1', Debit:2500, Credit:'' },
      { 'Entry ID':'CB-2', Type:'Customer Payment', Reference:'PAY-1', Debit:'', Credit:1500, 'Is Deleted':'TRUE' }
    ]
  });

  const row = ctx.cashReconciliationBuildRows_(ctx.getAllRows_('CASH_SESSIONS'), ctx.getAllRows_('CASH_BOOK'))[1];
  assert.equal(row.openingState, 'Needs Review');
});

test('a Closed session missing closing count evidence stays Needs Review', () => {
  const { ctx } = runtime({
    CASH_SESSIONS: [
      closedSession('CS-1', '2026-09-26', 10000, 10000),
      {
        'Session ID':'CS-2',
        Date:'2026-09-27',
        'Opened At':'2026-09-27T08:00:00',
        'Opening Cash':10000,
        'Closed At':'2026-09-27T20:00:00',
        'Expected Cash':'',
        'Counted Cash':'',
        'Variance':'',
        Status:'Closed'
      }
    ],
    CASH_BOOK: []
  });

  const row = ctx.cashReconciliationBuildRows_(ctx.getAllRows_('CASH_SESSIONS'), ctx.getAllRows_('CASH_BOOK'))[1];
  assert.equal(row.closingState, 'Needs Review');
  assert.equal(row.reconciliationState, 'Needs Review');
});

test('saving an exact explanation stores multiple IDs and retires a legacy synthetic opening adjustment without deleting the marker', () => {
  const { ctx, sheets } = runtime({
    CASH_SESSIONS: [
      closedSession('CS-1', '2026-09-26', 10000, 10000),
      closedSession('CS-2', '2026-09-27', 6000, 6000)
    ],
    CASH_BOOK: [
      { 'Entry ID':'CB-MARK', Type:'Session Open', Reference:'CS-2', Debit:4000, Credit:'', Description:'Opening cash for the day' },
      { 'Entry ID':'CB-1', Type:'Expense', Reference:'EXP-1', Debit:2500, Credit:'', Description:'Shop expense' },
      { 'Entry ID':'CB-2', Type:'Owner Withdrawal', Reference:'FIN-1', Debit:1500, Credit:'', Description:'Owner withdrawal' }
    ]
  });

  const result = ctx.saveCashReconciliationExplanation('TOKEN', 'CS-2', 'opening', ['CB-1','CB-2']);

  assert.equal(result.success, true);
  assert.deepEqual(JSON.parse(sheets.CASH_SESSIONS[1]['Opening Explanation Entry IDs']), ['CB-1','CB-2']);
  assert.equal(Number(sheets.CASH_BOOK[0].Debit) || 0, 0);
  assert.equal(Number(sheets.CASH_BOOK[0].Credit) || 0, 0);
  assert.match(sheets.CASH_BOOK[0].Description, /retired/i);
});

test('save rejects an explanation unless selected real transactions exactly match direction and total', () => {
  const { ctx, sheets } = runtime({
    CASH_SESSIONS: [
      closedSession('CS-1', '2026-09-26', 10000, 10000),
      closedSession('CS-2', '2026-09-27', 6000, 6000)
    ],
    CASH_BOOK: [
      { 'Entry ID':'CB-1', Type:'Expense', Reference:'EXP-1', Debit:2500, Credit:'' },
      { 'Entry ID':'CB-2', Type:'Customer Payment', Reference:'PAY-1', Debit:'', Credit:1500 }
    ]
  });

  const partial = ctx.saveCashReconciliationExplanation('TOKEN', 'CS-2', 'opening', ['CB-1']);
  assert.equal(partial.success, false);
  assert.match(partial.message, /exactly|4,?000|4000/i);
  assert.equal(sheets.CASH_SESSIONS[1]['Opening Explanation Entry IDs'] || '', '');

  const wrongDirection = ctx.saveCashReconciliationExplanation('TOKEN', 'CS-2', 'opening', ['CB-1','CB-2']);
  assert.equal(wrongDirection.success, false);
  assert.match(wrongDirection.message, /Cash Out|direction/i);
});

test('one Cash Book entry cannot explain two reconciliation differences', () => {
  const { ctx } = runtime({
    CASH_SESSIONS: [
      closedSession('CS-1', '2026-09-25', 10000, 10000),
      closedSession('CS-2', '2026-09-26', 6000, 6000, { 'Opening Explanation Entry IDs': '["CB-1"]' }),
      closedSession('CS-3', '2026-09-27', 2000, 2000)
    ],
    CASH_BOOK: [
      { 'Entry ID':'CB-1', Type:'Expense', Reference:'EXP-1', Debit:4000, Credit:'' }
    ]
  });

  const result = ctx.saveCashReconciliationExplanation('TOKEN', 'CS-3', 'opening', ['CB-1']);
  assert.equal(result.success, false);
  assert.match(result.message, /already linked/i);
});

test('candidate endpoint drops stale linked IDs so the user can replace a broken explanation', () => {
  const { ctx } = runtime({
    CASH_SESSIONS: [
      closedSession('CS-1', '2026-09-26', 10000, 10000),
      closedSession('CS-2', '2026-09-27', 6000, 6000, {
        'Opening Explanation Entry IDs': '["CB-DELETED"]'
      })
    ],
    CASH_BOOK: [
      { 'Entry ID':'CB-DELETED', Type:'Expense', Reference:'EXP-OLD', Debit:4000, Credit:'', 'Is Deleted':'TRUE' },
      { 'Entry ID':'CB-NEW', Type:'Expense', Reference:'EXP-NEW', Debit:4000, Credit:'', Description:'Replacement' }
    ]
  });

  const result = ctx.getCashReconciliationCandidates('TOKEN', 'CS-2', 'opening', '');

  assert.equal(result.success, true);
  assert.deepEqual(result.data.selectedEntryIds, []);
  assert.deepEqual(result.data.staleEntryIds, ['CB-DELETED']);
  assert.deepEqual(result.data.candidates.map(x => x.entryId), ['CB-NEW']);
});

test('linking a catch-up transaction after Close Day recalculates the affected closed session expected cash', () => {
  const { ctx, sheets } = runtime({
    CASH_SESSIONS: [
      closedSession('CS-1', '2026-09-26', 20000, 20000),
      closedSession('CS-2', '2026-09-27', 10000, 12000, {
        'Expected Cash': 2000,
        'Variance': 10000
      })
    ],
    CASH_BOOK: [
      { 'Entry ID':'CB-MARK', Date:'2026-09-27', Type:'Session Open', Reference:'CS-2', Debit:'', Credit:'' },
      { 'Entry ID':'CB-EXP', Date:'2026-09-27', Type:'Expense', Reference:'EXP-1', Debit:10000, Credit:'', Description:'Late-recorded prior cash out' },
      { 'Entry ID':'CB-SALE', Date:'2026-09-27', Type:'Sale', Reference:'INV-1', Debit:'', Credit:2000, Description:'Current session sale' }
    ]
  });

  const result = ctx.saveCashReconciliationExplanation('TOKEN', 'CS-2', 'opening', ['CB-EXP']);

  assert.equal(result.success, true);
  assert.equal(sheets.CASH_SESSIONS[1]['Expected Cash'], 12000);
  assert.equal(sheets.CASH_SESSIONS[1]['Variance'], 0);
});

test('candidate endpoint returns only real active cash movements in the required direction and keeps current selections visible', () => {
  const { ctx } = runtime({
    CASH_SESSIONS: [
      closedSession('CS-1', '2026-09-26', 10000, 10000),
      closedSession('CS-2', '2026-09-27', 6000, 6000, { 'Opening Explanation Entry IDs': '["CB-1"]' })
    ],
    CASH_BOOK: [
      { 'Entry ID':'CB-1', Date:'2026-09-27', Type:'Expense', Reference:'EXP-1', Debit:4000, Credit:'', Description:'Expense' },
      { 'Entry ID':'CB-IN', Date:'2026-09-27', Type:'Customer Payment', Reference:'PAY-1', Debit:'', Credit:4000 },
      { 'Entry ID':'CB-SYN', Date:'2026-09-27', Type:'Session Open', Reference:'CS-2', Debit:4000, Credit:'' },
      { 'Entry ID':'CB-DEL', Date:'2026-09-27', Type:'Expense', Reference:'EXP-2', Debit:4000, Credit:'', 'Is Deleted':'TRUE' }
    ]
  });

  const result = ctx.getCashReconciliationCandidates('TOKEN', 'CS-2', 'opening', '');
  assert.equal(result.success, true);
  assert.deepEqual(result.data.candidates.map(x => x.entryId), ['CB-1']);
  assert.equal(result.data.candidates[0].selected, true);
  assert.equal(result.data.requiredDirection, 'Cash Out');
  assert.equal(result.data.requiredAmount, 4000);
});

test('cash reconciliation UI uses short explanation statuses and a link-transaction modal, never creates cash itself', () => {
  assert.match(html, /Previous Close/);
  assert.match(html, /Opening Count/);
  assert.match(html, /Explanation Status/);
  assert.match(html, /Record Cash Out/);
  assert.match(html, /Record Cash In/);
  assert.match(html, /Explained/);
  assert.match(html, /id="cashRecExplainModal"/);
  assert.match(html, /select[^<]*real ERP transaction|real ERP transaction/i);
  assert.match(html, /getCashReconciliationCandidates/);
  assert.match(html, /saveCashReconciliationExplanation/);
  assert.doesNotMatch(html, /serverCall\(\s*['"]addCashBookEntry/);
});

console.log('\n' + pass + '/' + (pass + fail) + ' passed');
if (fail) process.exit(1);
