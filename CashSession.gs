/**
 * CashSession.gs
 * ---------------------------------------------------------------------
 * The "count the drawer at start and end of day" workflow. Only one
 * session can be open at a time. While a session is open, every business
 * transaction is allowed. Reconciliation differences never block the
 * session and are explained separately by linking the real ERP transaction.
 * Start Day retains a zero-value Cash Book marker only for session boundaries.
 * This file brackets the
 * business day with a start and an end so the ERP has one clear session
 * boundary before sales, purchases, payments, expenses, inventory
 * movements, returns, and other financial transactions are recorded.
 *
 * Review item 10: every function in this file that the browser can
 * reach now requires a session token. Apps Script exposes EVERY global
 * function without a trailing underscore to google.script.run, so an
 * ungated one is reachable by anyone holding the web app URL - no
 * login, no role, nothing.
 *
 * Anyone with the URL could previously open a cash session, close one,
 * or read the drawer total.
 *
 * getActiveCashSession is now getActiveCashSession_ - private. It has
 * six internal callers and zero client callers, so rather than bolt a
 * token onto something only the server uses, it left the public
 * surface entirely.
 * ---------------------------------------------------------------------
 */

/** Returns the current Open/Closing session, or null. Server-side only. */
function getActiveCashSession_(preloadedRows) {
  try {
    const rows = Array.isArray(preloadedRows) ? preloadedRows : getAllRows_('CASH_SESSIONS');
    // Closing remains discoverable so an interrupted close can be retried,
    // but requireActiveCashSession_ permits transaction posting only while
    // the status is exactly Open.
    const open = rows.filter(function (r) {
      return r['Status'] === 'Open' || r['Status'] === 'Closing';
    });
    return ok_(open.length ? open[open.length - 1] : null);
  } catch (err) {
    logError_('getActiveCashSession', err);
    return fail_(err.message);
  }
}

function startCashSession(token, openingCash, notes) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    requirePermission_(token, 'pos', 'add');
    if (!isValidNonNegativeNumber_(openingCash)) return fail_('Enter a valid opening cash amount.');
    const openingAmount = roundMoney_(Number(openingCash));

    // Read both sources before the first write. Besides avoiding repeated
    // full-sheet scans, a repository failure can no longer be mistaken for
    // "no active session" and followed by a partial session write.
    const sessionRows = getAllRows_('CASH_SESSIONS');
    const activeResult = getActiveCashSession_(sessionRows);
    if (!activeResult.success) return activeResult;
    if (activeResult.data) {
      return fail_(activeResult.data['Status'] === 'Closing'
        ? 'The previous cash session is still closing. Retry Close Day before starting another session.'
        : 'A cash session is already open. Close it before starting a new one.');
    }
    // A previous attempt may have written the session header or its marker
    // before a later Sheets call failed. Resume that exact operation under
    // the lock instead of creating duplicate sessions or cash movements.
    let sessionRow = null;
    for (let i = sessionRows.length - 1; i >= 0; i--) {
      if (sessionRows[i]['Status'] === 'Starting') { sessionRow = sessionRows[i]; break; }
    }
    if (sessionRow && roundMoney_(Number(sessionRow['Opening Cash']) || 0) !== openingAmount) {
      return fail_('The pending session has a different opening cash amount. Retry with the originally confirmed amount.');
    }
    if (sessionRow) invalidateSheetCache_('CASH_BOOK');
    const cashRows = activeRows_('CASH_BOOK');
    const currentCash = getCashBalance_(cashRows);

    let id;
    let sessionRowIndex;
    if (sessionRow) {
      id = sessionRow['Session ID'];
      sessionRowIndex = Number(sessionRow._rowIndex) || (sessionRows.indexOf(sessionRow) + 2);
    } else {
      id = generateId_('CASH_SESSIONS');
      const now = new Date();
      sessionRow = {
        'Session ID': id, 'Date': formatDate_(now), 'Opened At': now,
        'Opening Cash': openingAmount, 'Closed At': '', 'Expected Cash': '',
        'Counted Cash': '', 'Variance': '', 'Status': 'Starting',
        'Notes': sanitizeInput_(notes)
      };
      sessionRowIndex = appendRow_('CASH_SESSIONS', sessionRow);
      if (!sessionRowIndex) sessionRowIndex = sessionRows.indexOf(sessionRow) + 2;
    }

    const storedOpening = roundMoney_(Number(sessionRow['Opening Cash']) || 0);
    const existingMarker = cashRows.filter(function (row) {
      return row['Type'] === 'Session Open' && row['Reference'] === id;
    })[0] || null;
    const cashBeforeMarker = existingMarker
      ? roundMoney_(currentCash - (Number(existingMarker['Credit']) || 0) + (Number(existingMarker['Debit']) || 0))
      : currentCash;

    // Calculate this before the Session Open reconciliation moves the live
    // Cash Book to the counted opening value. Otherwise a real carry mismatch
    // is always hidden in the response.
    const mismatchRows = sessionRows.indexOf(sessionRow) === -1 ? sessionRows.concat([sessionRow]) : sessionRows;
    const cashMismatch = getCashMismatch_(sessionRow, mismatchRows, cashBeforeMarker);

    // Opening Cash is a physical count, not recurring daily income.
    // The first recorded cash session establishes the baseline cash asset.
    // Every later session keeps a zero-value boundary marker only; any carry
    // difference is explained by linking the real ERP transaction.
    if (!existingMarker) {
      const hasPreviousClosedSession = sessionRows.some(function (row) {
        return row !== sessionRow && row['Status'] === 'Closed';
      });
      const baselineDelta = hasPreviousClosedSession ? 0 : roundMoney_(storedOpening - currentCash);
      addCashBookEntry_({
        Type: 'Session Open', Reference: id,
        Description: hasPreviousClosedSession ? 'Cash session opening marker' : 'Initial cash session baseline',
        Debit: baselineDelta < 0 ? Math.abs(baselineDelta) : '',
        Credit: baselineDelta > 0 ? baselineDelta : '',
        PaymentMethod: 'Cash'
      }, currentCash);
    }

    updateRowFields_('CASH_SESSIONS', sessionRowIndex, {
      'Status': 'Open', 'Notes': sanitizeInput_(notes)
    });

    return ok_({ sessionId: id, cashMismatch: cashMismatch });
  } catch (err) {
    logError_('startCashSession', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Compares `session`'s Opening Cash to the Counted Cash the previous
 * session was closed with. They should normally match — nothing should
 * silently appear in or vanish from the drawer overnight. Returns
 * { direction: 'less'|'more', amount } if they differ and the Cash Book
 * hasn't yet been brought back in line with the opening figure (i.e. the
 * user still needs to log the transaction that explains the gap), or null
 * if there's nothing to flag (no previous session, they matched, or it's
 * already been reconciled).
 */
function getCashMismatch_(session, preloadedSessions, preloadedCashBalance) {
  const rows = Array.isArray(preloadedSessions) ? preloadedSessions : getAllRows_('CASH_SESSIONS');
  const idx = rows.findIndex(function (r) { return r['Session ID'] === session['Session ID']; });
  let previous = null;
  for (let i = idx - 1; i >= 0; i--) {
    if (rows[i]['Status'] === 'Closed') { previous = rows[i]; break; }
  }
  if (!previous) return null;

  const opening = roundMoney_(Number(session['Opening Cash']) || 0);
  const prevCounted = roundMoney_(Number(previous['Counted Cash']) || 0);
  if (opening === prevCounted) return null;
  const hasPreloadedCash = preloadedCashBalance !== undefined && preloadedCashBalance !== null;
  const currentCash = hasPreloadedCash ? roundMoney_(Number(preloadedCashBalance) || 0) : getCashBalance_();
  if (currentCash === opening) return null;

  return {
    direction: opening < prevCounted ? 'less' : 'more',
    amount: roundMoney_(Math.abs(opening - prevCounted))
  };
}

function cashSessionExplanationIds_(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  const raw = String(value || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch (e) {
    return raw.split(/[\n,]+/).map(function (id) { return id.trim(); }).filter(Boolean);
  }
}

function cashSessionLinkedReconciliationEntryIds_(sessionRows) {
  const linked = {};
  (sessionRows || []).forEach(function (row) {
    cashSessionExplanationIds_(row['Opening Explanation Entry IDs'])
      .concat(cashSessionExplanationIds_(row['Closing Explanation Entry IDs']))
      .forEach(function (entryId) { linked[String(entryId)] = true; });
  });
  return linked;
}

/** Builds one open-session snapshot entirely from already-loaded sheet rows. */
function cashSessionSummaryFromRows_(session, sessionRows, cashRows) {
  const foundIndex = cashRows.findIndex(function (r) {
    return r['Type'] === 'Session Open' && r['Reference'] === session['Session ID'];
  });
  const startIndex = foundIndex === -1 ? cashRows.length : foundIndex + 1;
  const reconciliationEntries = cashSessionLinkedReconciliationEntryIds_(sessionRows);
  let cashIn = 0, cashOut = 0;
  for (let i = startIndex; i < cashRows.length; i++) {
    const entryId = String(cashRows[i]['Entry ID'] || '');
    if (entryId && reconciliationEntries[entryId]) continue;
    if (session['Status'] === 'Closing' &&
        cashRows[i]['Type'] === 'Day Close Adjustment' &&
        cashRows[i]['Reference'] === session['Session ID']) continue;
    cashIn = roundMoney_(cashIn + (Number(cashRows[i]['Credit']) || 0));
    cashOut = roundMoney_(cashOut + (Number(cashRows[i]['Debit']) || 0));
  }

  const openingCash = roundMoney_(Number(session['Opening Cash']) || 0);
  const currentCash = getCashBalance_(cashRows);
  const calculatedExpected = roundMoney_(openingCash + cashIn - cashOut);
  const expectedCash = session['Status'] === 'Closing' && session['Expected Cash'] !== ''
    ? roundMoney_(Number(session['Expected Cash']) || 0)
    : calculatedExpected;
  return {
    sessionId: session['Session ID'],
    status: session['Status'],
    openedAt: session['Opened At'],
    openingCash: openingCash,
    cashIn: cashIn,
    cashOut: cashOut,
    expectedCash: expectedCash,
    countedCash: session['Status'] === 'Closing'
      ? roundMoney_(Number(session['Counted Cash']) || 0)
      : '',
    notes: session['Notes'] || '',
    cashMismatch: getCashMismatch_(session, sessionRows, currentCash)
  };
}

/** Live totals for the open session: what came in, what went out, what should be in the drawer right now. */
function getCashSessionSummary(token) {
  try {
    requirePermission_(token, 'pos', 'view');
    const sessionRows = getAllRows_('CASH_SESSIONS');
    const activeResult = getActiveCashSession_(sessionRows);
    const session = activeResult.data;
    if (!session) return ok_(null);

    // activeRows_, not getAllRows_ — deleting a payment/expense/etc. from Day
    // Book soft-deletes its Cash Book row rather than removing or reversing
    // it, so a raw getAllRows_ here would keep counting a deleted entry's
    // Credit/Debit toward this session's totals forever.
    const rows = activeRows_('CASH_BOOK');
    // Cutting off by sheet position (where this session's own opening entry
    // landed) rather than by comparing Date values. Sales/expenses/etc. post
    // a date-only string ('yyyy-MM-dd') as their Cash Book Date, while
    // 'Opened At' is a full timestamp — new Date('2026-08-07') parses as UTC
    // midnight, which sorts before a same-day session opened later in the
    // day, so a timestamp comparison silently dropped same-day activity from
    // cashIn/cashOut. Row order is always true chronological order (rows are
    // only ever appended), so this cutoff can't be fooled the same way.
    // Scoped to this session only — the builder adds Opening Cash to only
    // the movements after this session's marker. It uses the same preloaded
    // rows for mismatch checking, so each source sheet is read once.
    return ok_(cashSessionSummaryFromRows_(session, sessionRows, rows));
  } catch (err) {
    logError_('getCashSessionSummary', err);
    return fail_(err.message);
  }
}

function closeCashSession(token, countedCash, notes) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    requirePermission_(token, 'pos', 'add');
    if (!isValidNonNegativeNumber_(countedCash)) return fail_('Enter a valid counted cash amount.');
    const countedAmount = roundMoney_(Number(countedCash));

    const sessionRows = getAllRows_('CASH_SESSIONS');
    const activeResult = getActiveCashSession_(sessionRows);
    if (!activeResult.success) return activeResult;
    const session = activeResult.data;
    if (!session) return fail_('No cash session is open.');
    if (session['Status'] === 'Closing' &&
        roundMoney_(Number(session['Counted Cash']) || 0) !== countedAmount) {
      return fail_('The pending close has a different counted cash amount. Retry with the originally confirmed amount.');
    }
    if (session['Status'] === 'Closing') invalidateSheetCache_('CASH_BOOK');

    const cashRows = activeRows_('CASH_BOOK');
    const rowIndex = Number(session._rowIndex) || (sessionRows.indexOf(session) + 2);
    let expected;
    let finalCounted;
    let variance;
    if (session['Status'] === 'Closing') {
      expected = roundMoney_(Number(session['Expected Cash']) || 0);
      finalCounted = roundMoney_(Number(session['Counted Cash']) || 0);
      variance = roundMoney_(Number(session['Variance']) || 0);
    } else {
      const summary = cashSessionSummaryFromRows_(session, sessionRows, cashRows);
      expected = summary.expectedCash;
      finalCounted = countedAmount;
      variance = roundMoney_(finalCounted - expected);
      updateRowFields_('CASH_SESSIONS', rowIndex, {
        'Closed At': new Date(), 'Expected Cash': expected, 'Counted Cash': finalCounted,
        'Variance': variance, 'Status': 'Closing', 'Notes': sanitizeInput_(notes)
      });
    }

    // A close variance is an audit difference, not a synthetic cash movement.
    // Close Day remains non-blocking. The real transaction is recorded in its
    // owning ERP module and linked later from Cash Reconciliation.

    updateRowFields_('CASH_SESSIONS', rowIndex, {
      'Status': 'Closed', 'Notes': sanitizeInput_(notes)
    });

    return ok_({ expected: expected, counted: finalCounted, variance: variance });
  } catch (err) {
    logError_('closeCashSession', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

/** Throws a friendly error if there's no open session — call before recording any cash-in/cash-out. */
function requireActiveCashSession_() {
  const result = getActiveCashSession_();
  if (!result.success) {
    throw new Error(result.message || 'Unable to verify the active cash session.');
  }
  if (!result.data) {
    throw new Error('Start your cash session first (top bar \u2192 Cash Session \u2192 Start Day) before recording any transaction.');
  }
  if (result.data['Status'] !== 'Open') {
    throw new Error('The cash session is closing. Finish Close Day before recording another transaction.');
  }
  return result.data;
}

/**
 * Finds which cash session was active at a given timestamp — the session
 * with the latest 'Opened At' that is still <= the timestamp. Sessions
 * never overlap (only one can be open at a time), so this unambiguously
 * identifies "the session this invoice was created under" even though
 * SALES rows don't store a Session ID directly. Returns null if none match.
 */
function findSessionForTimestamp_(sessions, timestamp) {
  const t = new Date(timestamp).getTime();
  let match = null;
  sessions.forEach(function (s) {
    const openedTime = new Date(s['Opened At']).getTime();
    if (openedTime <= t && (!match || openedTime > new Date(match['Opened At']).getTime())) {
      match = s;
    }
  });
  return match;
}