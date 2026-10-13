const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function runtime(seed = {}, options = {}) {
  const sheets = clone(seed);
  const reads = {};
  const writes = [];
  let nextId = 1;
  let appendFailureUsed = false;
  let staleCashRows = null;

  function rowsFor(key) {
    reads[key] = (reads[key] || 0) + 1;
    if (options.failRead === key) throw new Error(`Unable to read ${key}`);
    if (!sheets[key]) sheets[key] = [];
    if (key === 'CASH_BOOK' && staleCashRows) return staleCashRows;
    return sheets[key];
  }

  const context = vm.createContext({
    console,
    CONFIG: { LOCK_TIMEOUT_MS: 1000 },
    LockService: {
      getScriptLock: () => ({ waitLock() {}, releaseLock() {} })
    },
    requirePermission_: () => ({ name: 'Tester' }),
    getAllRows_: rowsFor,
    activeRows_: key => rowsFor(key).filter(row => !context.isDeleted_(row)),
    isDeleted_: row => row['Is Deleted'] === true || String(row['Is Deleted']).toUpperCase() === 'TRUE',
    appendRow_: (key, row) => {
      if (!sheets[key]) sheets[key] = [];
      if (key === 'CASH_BOOK' && options.staleCashBookAfterUnknownWrite && !appendFailureUsed) {
        staleCashRows = clone(sheets[key]);
      }
      sheets[key].push(row);
      writes.push({ type: 'append', key, row });
      if (!appendFailureUsed && options.failAppendAfter === key) {
        appendFailureUsed = true;
        throw new Error(`Write result unknown for ${key}`);
      }
    },
    findRowIndex_: (key, header, value) => {
      const index = rowsFor(key).findIndex(row => row[header] === value);
      return index === -1 ? -1 : index + 2;
    },
    updateRowFields_: (key, rowIndex, fields) => {
      Object.assign(sheets[key][rowIndex - 2], fields);
      writes.push({ type: 'update', key, rowIndex, fields });
    },
    generateId_: key => `${key}-${nextId++}`,
    isValidNonNegativeNumber_: value => value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) >= 0,
    formatDate_: value => new Date(value).toISOString().slice(0, 10),
    sanitizeInput_: value => String(value || ''),
    roundMoney_: value => Math.round((Number(value) + Number.EPSILON) * 100) / 100,
    getActiveBankAccountsForUI_: () => [],
    getSettingsMap_: () => ({}),
    isSettingEnabled_: () => false,
    hasPermission_: () => false,
    buildLotPricingLadder_: () => ({ segments: [], fallbackSellPrice: 0, autoSellingPrice: 0 }),
    getActiveVendorsForUI_: () => [],
    getAllVendorsForUI_: () => [],
    invalidateSheetCache_: key => {
      if (key === 'CASH_BOOK') staleCashRows = null;
    },
    ok_: data => ({ success: true, data }),
    fail_: message => ({ success: false, message }),
    logError_: () => {}
  });

  vm.runInContext(fs.readFileSync(path.join(root, 'CashBook.gs'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'CashSession.gs'), 'utf8'), context);
  return {
    context, sheets, reads, writes,
    load: file => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context)
  };
}

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start === -1) return '';
  const brace = source.indexOf('{', start);
  let depth = 0;
  for (let index = brace; index < source.length; index++) {
    if (source[index] === '{') depth++;
    if (source[index] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return '';
}

function openSession(overrides = {}) {
  return Object.assign({
    'Session ID': 'CS-OPEN',
    Date: '2026-09-08',
    'Opened At': '2026-09-08T09:00:00.000Z',
    'Opening Cash': 0,
    Status: 'Open'
  }, overrides);
}

function sessionMarker(sessionId = 'CS-OPEN', overrides = {}) {
  return Object.assign({
    'Entry ID': 'CB-OPEN',
    Date: '2026-09-08T09:00:00.000Z',
    Type: 'Session Open',
    Reference: sessionId,
    Debit: '',
    Credit: '',
    Balance: 0
  }, overrides);
}

test('cash-session summary returns two-decimal currency totals', () => {
  const { context } = runtime({
    CASH_SESSIONS: [openSession()],
    CASH_BOOK: [
      sessionMarker(),
      { 'Entry ID': 'CB-1', Credit: 0.1, Debit: '' },
      { 'Entry ID': 'CB-2', Credit: 0.2, Debit: '' }
    ]
  });

  const result = context.getCashSessionSummary('TOKEN');

  assert.equal(result.success, true);
  assert.equal(result.data.cashIn, 0.3);
  assert.equal(result.data.cashOut, 0);
  assert.equal(result.data.expectedCash, 0.3);
});

test('closing a balanced fractional-currency session does not create a phantom adjustment', () => {
  const { context, sheets } = runtime({
    CASH_SESSIONS: [openSession({ 'Opening Cash': 0.1 })],
    CASH_BOOK: [
      sessionMarker('CS-OPEN', { Credit: 0.1, Balance: 0.1 }),
      { 'Entry ID': 'CB-1', Credit: 0.2, Debit: '', Balance: 0.3 }
    ]
  });
  const beforeCashRows = sheets.CASH_BOOK.length;

  const result = context.closeCashSession('TOKEN', 0.3, 'Balanced');

  assert.equal(result.success, true);
  assert.equal(result.data.expected, 0.3);
  assert.equal(result.data.variance, 0);
  assert.equal(sheets.CASH_BOOK.length, beforeCashRows);
});

test('session start does not write when the active-session read fails', () => {
  const { context, writes } = runtime({ CASH_SESSIONS: [], CASH_BOOK: [] }, { failRead: 'CASH_SESSIONS' });

  const result = context.startCashSession('TOKEN', 100, 'Opening');

  assert.equal(result.success, false);
  assert.equal(writes.length, 0);
});

test('a carried-cash mismatch stays visible and Start Day writes only a zero-value marker', () => {
  const { context, sheets } = runtime({
    CASH_SESSIONS: [{
      'Session ID': 'CS-CLOSED',
      Date: '2026-09-07',
      'Opened At': '2026-09-07T09:00:00.000Z',
      'Closed At': '2026-09-07T18:00:00.000Z',
      'Opening Cash': 100,
      'Counted Cash': 100,
      Status: 'Closed'
    }],
    CASH_BOOK: [{ 'Entry ID': 'CB-OLD', Credit: 100, Debit: '', Balance: 100 }]
  });

  const result = context.startCashSession('TOKEN', 80, 'Twenty short');

  assert.equal(result.success, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.data.cashMismatch)), {
    direction: 'less',
    amount: 20
  });
  const marker = sheets.CASH_BOOK.find(row => row.Type === 'Session Open' && row.Reference === result.data.sessionId);
  assert.ok(marker, 'Start Day must retain a Session Open boundary marker');
  assert.equal(Number(marker.Debit) || 0, 0);
  assert.equal(Number(marker.Credit) || 0, 0);
  assert.equal(context.getCashBalance_(), 100, 'Start Day must not manufacture a balancing cash movement');
});

test('cash-session summary excludes real transactions linked to an earlier reconciliation difference', () => {
  const { context } = runtime({
    CASH_SESSIONS: [
      openSession({
        'Session ID': 'CS-CLOSED',
        Status: 'Closed',
        'Counted Cash': 100,
        'Closing Explanation Entry IDs': '["CB-EXPLAIN"]'
      }),
      openSession({ 'Session ID': 'CS-OPEN', 'Opening Cash': 100 })
    ],
    CASH_BOOK: [
      sessionMarker('CS-OPEN', { 'Entry ID': 'CB-MARK' }),
      { 'Entry ID': 'CB-EXPLAIN', Type: 'Expense', Reference: 'EXP-OLD', Debit: 20, Credit: '' },
      { 'Entry ID': 'CB-CURRENT', Type: 'Sale', Reference: 'INV-NEW', Debit: '', Credit: 30 }
    ]
  });

  const result = context.getCashSessionSummary('TOKEN');

  assert.equal(result.success, true);
  assert.equal(result.data.cashOut, 0, 'catch-up transaction belongs to reconciliation, not the active session');
  assert.equal(result.data.cashIn, 30);
  assert.equal(result.data.expectedCash, 130);
});

test('cash-session summary reads each source sheet once regardless of ledger size', () => {
  const cashRows = [sessionMarker()];
  for (let index = 0; index < 500; index++) {
    cashRows.push({ 'Entry ID': `CB-${index}`, Credit: 1, Debit: '' });
  }
  const { context, reads } = runtime({
    CASH_SESSIONS: [
      openSession({ 'Session ID': 'CS-CLOSED', Status: 'Closed', 'Counted Cash': 0 }),
      openSession()
    ],
    CASH_BOOK: cashRows
  });

  context.getCashSessionSummary('TOKEN');

  assert.equal(reads.CASH_SESSIONS, 1);
  assert.equal(reads.CASH_BOOK, 1);
});

test('session start reuses its validation reads when writing the opening marker', () => {
  const { context, reads } = runtime({
    CASH_SESSIONS: [{
      'Session ID': 'CS-CLOSED',
      'Counted Cash': 100,
      Status: 'Closed'
    }],
    CASH_BOOK: [{ 'Entry ID': 'CB-OLD', Credit: 100, Debit: '', Balance: 100 }]
  });

  const result = context.startCashSession('TOKEN', 100, 'Opening');

  assert.equal(result.success, true);
  assert.equal(reads.CASH_SESSIONS, 1);
  assert.equal(reads.CASH_BOOK, 1);
});

test('an interrupted session start is not usable and retry completes it without duplicate rows', () => {
  const { context, sheets } = runtime({ CASH_SESSIONS: [], CASH_BOOK: [] }, {
    failAppendAfter: 'CASH_BOOK', staleCashBookAfterUnknownWrite: true
  });

  const interrupted = context.startCashSession('TOKEN', 100, 'Opening');

  assert.equal(interrupted.success, false);
  assert.equal(sheets.CASH_SESSIONS.length, 1);
  assert.equal(sheets.CASH_SESSIONS[0].Status, 'Starting');
  assert.equal(sheets.CASH_SESSIONS.some(row => row.Status === 'Open'), false);

  const changedRetry = context.startCashSession('TOKEN', 200, 'Changed opening');
  assert.equal(changedRetry.success, false);
  assert.match(changedRetry.message, /pending session.*different opening cash/i);
  assert.equal(sheets.CASH_SESSIONS[0].Status, 'Starting');

  const retry = context.startCashSession('TOKEN', 100, 'Confirmed retry note');
  assert.equal(retry.success, true);
  assert.equal(sheets.CASH_SESSIONS.length, 1);
  assert.equal(sheets.CASH_SESSIONS[0].Status, 'Open');
  assert.equal(sheets.CASH_SESSIONS[0].Notes, 'Confirmed retry note');
  assert.equal(sheets.CASH_BOOK.filter(row => row.Type === 'Session Open').length, 1);
  assert.equal(Number(sheets.CASH_BOOK[0].Debit) || 0, 0);
  assert.equal(Number(sheets.CASH_BOOK[0].Credit) || 0, 100, 'the first session establishes the initial cash baseline once');
});

test('a pending Close Day retry keeps the confirmed count and finishes without a synthetic adjustment', () => {
  const { context, sheets } = runtime({
    CASH_SESSIONS: [openSession({
      'Opening Cash': 100,
      Status: 'Closing',
      'Expected Cash': 100,
      'Counted Cash': 90,
      Variance: -10,
      Notes: 'Ten short'
    })],
    CASH_BOOK: [sessionMarker('CS-OPEN', { Credit: 100, Balance: 100 })]
  });

  const changedRetry = context.closeCashSession('TOKEN', 100, 'Changed count');
  assert.equal(changedRetry.success, false);
  assert.match(changedRetry.message, /pending close.*different counted cash/i);
  assert.equal(sheets.CASH_SESSIONS[0].Status, 'Closing');

  const retry = context.closeCashSession('TOKEN', 90, 'Confirmed retry note');
  assert.equal(retry.success, true);
  assert.equal(sheets.CASH_SESSIONS[0].Status, 'Closed');
  assert.equal(sheets.CASH_SESSIONS[0].Notes, 'Confirmed retry note');
  assert.equal(sheets.CASH_BOOK.some(row => row.Type === 'Day Close Adjustment'), false);
  assert.equal(context.getCashBalance_(), 100);
});

test('closing a cash-short session records the variance but creates no synthetic cash adjustment', () => {
  const { context, sheets } = runtime({
    CASH_SESSIONS: [openSession({ 'Opening Cash': 100 })],
    CASH_BOOK: [sessionMarker('CS-OPEN', { Credit: '', Debit: '', Balance: 100 })]
  });

  const result = context.closeCashSession('TOKEN', 90, 'Ten short');

  assert.equal(result.success, true);
  assert.equal(result.data.expected, 100);
  assert.equal(result.data.counted, 90);
  assert.equal(result.data.variance, -10);
  assert.equal(sheets.CASH_SESSIONS[0].Status, 'Closed');
  assert.equal(sheets.CASH_BOOK.some(row => row.Type === 'Day Close Adjustment'), false);
  assert.equal(context.getCashBalance_(), 0, 'Close Day must not manufacture a balancing cash movement');
});
test('cash-session guard propagates a repository outage instead of reporting a closed drawer', () => {
  const { context } = runtime({ CASH_SESSIONS: [] }, { failRead: 'CASH_SESSIONS' });

  assert.throws(() => context.requireActiveCashSession_(), /Unable to read CASH_SESSIONS/);
});

test('POS bootstrap propagates an active-session repository outage', () => {
  const { context, load } = runtime({
    PRODUCTS: [], CUSTOMERS: [], STOCK_LOTS: [], CASH_SESSIONS: []
  }, { failRead: 'CASH_SESSIONS' });
  load('Bundles.gs');
  load('Sales.gs');

  const result = context.getPosBootstrap('TOKEN');

  assert.equal(result.success, false);
  assert.match(result.message, /Unable to read CASH_SESSIONS/);
});

test('POS displays the carried-cash mismatch returned by session start', async () => {
  const source = fs.readFileSync(path.join(root, 'pos.html'), 'utf8');
  const messageSource = functionSource(source, 'posCashMismatchMessage_');
  const handlerSource = functionSource(source, 'posHandleStartedSession_');
  assert.notEqual(messageSource, '', 'POS mismatch-message helper must exist');
  assert.notEqual(handlerSource, '', 'POS start-result handler must exist');
  assert.match(source, /serverCall\('startCashSession'[\s\S]{0,1800}\.then\(posHandleStartedSession_\)/);

  const rendered = [];
  const toasts = [];
  let loads = 0;
  const client = vm.createContext({
    posState: { openingCashMismatch: null },
    posRenderCashMismatchAlert_: mismatch => rendered.push(clone(mismatch)),
    showToast: (message, type) => toasts.push({ message, type }),
    posLoad: () => { loads++; return Promise.resolve(); },
    formatMoney: amount => String(amount)
  });
  vm.runInContext(`${messageSource}\n${handlerSource}`, client);

  await client.posHandleStartedSession_({
    sessionId: 'CS-NEW',
    cashMismatch: { direction: 'less', amount: 20 }
  });

  assert.deepEqual(JSON.parse(JSON.stringify(client.posState.openingCashMismatch)), {
    direction: 'less', amount: 20
  });
  assert.deepEqual(rendered, [{ direction: 'less', amount: 20 }]);
  assert.equal(loads, 1);
  assert.equal(toasts.at(-1).type, 'error');
  assert.doesNotMatch(toasts.at(-1).message, /automatically recorded/i);
  assert.match(toasts.at(-1).message, /Cash Reconciliation|actual transaction/i);
});

test('POS close retry defaults to the already-confirmed counted cash', () => {
  const source = fs.readFileSync(path.join(root, 'pos.html'), 'utf8');
  const helperSource = functionSource(source, 'posCloseCountedDefault_');
  const noteHelperSource = functionSource(source, 'posCloseNoteDefault_');
  assert.notEqual(helperSource, '', 'POS close default helper must exist');
  assert.notEqual(noteHelperSource, '', 'POS close note-default helper must exist');
  const client = vm.createContext({});
  vm.runInContext(`${helperSource}\n${noteHelperSource}`, client);

  assert.equal(client.posCloseCountedDefault_({
    status: 'Closing', expectedCash: 100, countedCash: 90
  }), 90);
  assert.equal(client.posCloseCountedDefault_({
    status: 'Open', expectedCash: 100, countedCash: ''
  }), 100);
  assert.equal(client.posCloseNoteDefault_({ status: 'Closing', notes: 'Ten short' }), 'Ten short');
  assert.equal(client.posCloseNoteDefault_({ status: 'Open', notes: 'Old' }), '');
});

test('repository invalidates a sheet cache when an append commits but reports an error', () => {
  const database = fs.readFileSync(path.join(root, 'Database.gs'), 'utf8');
  const db = vm.createContext({ console });
  vm.runInContext(database, db);
  vm.runInContext(`
    var invalidatedForTest = [];
    getSheet_ = function () {
      return {
        appendRow: function () { throw new Error('Write result unknown'); },
        getLastRow: function () { return 2; }
      };
    };
    getSheetHeaders_ = function () { return ['ID']; };
    normalizeSheetValueForWrite_ = function (key, header, value) { return value; };
    invalidateSheetCache_ = function (key) { invalidatedForTest.push(key); };
  `, db);

  assert.throws(() => db.appendRow_('CASH_BOOK', { ID: 'CB-1' }), /Write result unknown/);
  assert.deepEqual(Array.from(db.invalidatedForTest), ['CASH_BOOK']);
});
