/**
 * CashReconciliation.gs
 * ---------------------------------------------------------------------
 * Dedicated audit/explanation view for cash-session opening/closing
 * differences.
 *
 * Cash Reconciliation never creates the real business cash transaction.
 * Users record the real transaction in its owning ERP module, then link the
 * resulting Cash Book entry (or entries) here.
 *
 * Legacy Session Open / Day Close Adjustment movements created by older
 * versions are neutralized only after a complete real explanation is linked.
 * ---------------------------------------------------------------------
 */

function cashReconciliationSigned_(row) {
  return roundMoney_((Number(row && row['Credit']) || 0) - (Number(row && row['Debit']) || 0));
}

function cashReconciliationIsDeleted_(row) {
  return !!row && (row['Is Deleted'] === true || String(row['Is Deleted'] || '').toUpperCase() === 'TRUE');
}

function cashReconciliationIsSynthetic_(row) {
  const type = String(row && row['Type'] || '');
  return type === 'Session Open' || type === 'Day Close Adjustment';
}

function cashReconciliationParseIds_(value) {
  if (Array.isArray(value)) {
    return value.map(String).map(function (id) { return id.trim(); }).filter(Boolean)
      .filter(function (id, index, all) { return all.indexOf(id) === index; });
  }
  const raw = String(value || '').trim();
  if (!raw) return [];
  let values = [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) values = parsed;
  } catch (e) {
    values = raw.split(/[\n,]+/);
  }
  return values.map(String).map(function (id) { return id.trim(); }).filter(Boolean)
    .filter(function (id, index, all) { return all.indexOf(id) === index; });
}

function cashReconciliationExplanationField_(phase) {
  if (phase === 'opening') return 'Opening Explanation Entry IDs';
  if (phase === 'closing') return 'Closing Explanation Entry IDs';
  return '';
}

function cashReconciliationRequiredDirection_(difference) {
  const diff = roundMoney_(Number(difference) || 0);
  if (diff < 0) return 'Cash Out';
  if (diff > 0) return 'Cash In';
  return '';
}

function cashReconciliationRowById_(cashRows) {
  const map = {};
  (cashRows || []).forEach(function (row) {
    const id = String(row['Entry ID'] || '');
    if (id) map[id] = row;
  });
  return map;
}

function cashReconciliationEvaluate_(difference, storedIds, cashRows, isBaseline) {
  const ids = cashReconciliationParseIds_(storedIds);
  if (isBaseline) {
    return {
      state: 'Baseline',
      requiredDirection: '',
      requiredAmount: 0,
      linkedAmount: 0,
      remainingAmount: 0,
      entryIds: ids
    };
  }

  const hasDifference = difference !== '' && difference !== null && difference !== undefined;
  if (!hasDifference) {
    return {
      state: 'Open',
      requiredDirection: '',
      requiredAmount: 0,
      linkedAmount: 0,
      remainingAmount: 0,
      entryIds: ids
    };
  }

  const diff = roundMoney_(Number(difference) || 0);
  const requiredDirection = cashReconciliationRequiredDirection_(diff);
  const requiredAmount = roundMoney_(Math.abs(diff));

  if (diff === 0) {
    return {
      state: ids.length ? 'Needs Review' : 'Balanced',
      requiredDirection: '',
      requiredAmount: 0,
      linkedAmount: 0,
      remainingAmount: 0,
      entryIds: ids
    };
  }

  if (!ids.length) {
    return {
      state: 'Unexplained',
      requiredDirection: requiredDirection,
      requiredAmount: requiredAmount,
      linkedAmount: 0,
      remainingAmount: requiredAmount,
      entryIds: []
    };
  }

  const byId = cashReconciliationRowById_(cashRows);
  let signedTotal = 0;
  let invalid = false;

  ids.forEach(function (id) {
    const row = byId[id];
    if (!row || cashReconciliationIsDeleted_(row) || cashReconciliationIsSynthetic_(row)) {
      invalid = true;
      return;
    }
    const signed = cashReconciliationSigned_(row);
    if (!signed || (diff < 0 && signed >= 0) || (diff > 0 && signed <= 0)) {
      invalid = true;
      return;
    }
    signedTotal = roundMoney_(signedTotal + signed);
  });

  const linkedAmount = roundMoney_(Math.abs(signedTotal));
  const remainingAmount = roundMoney_(Math.max(0, requiredAmount - linkedAmount));
  const exact = !invalid && roundMoney_(signedTotal - diff) === 0;

  return {
    state: exact ? 'Explained' : 'Needs Review',
    requiredDirection: requiredDirection,
    requiredAmount: requiredAmount,
    linkedAmount: linkedAmount,
    remainingAmount: exact ? 0 : remainingAmount,
    entryIds: ids
  };
}

function cashReconciliationSortKey_(value) {
  if (!value) return 0;
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? String(value) : parsed.getTime();
}

function cashReconciliationBuildRows_(sessionRows, cashRows) {
  const sessions = (sessionRows || []).slice().sort(function (a, b) {
    const aKey = cashReconciliationSortKey_(a['Opened At'] || a['Date'] || '');
    const bKey = cashReconciliationSortKey_(b['Opened At'] || b['Date'] || '');
    if (typeof aKey === 'number' && typeof bKey === 'number') return aKey - bKey;
    return String(aKey).localeCompare(String(bKey));
  });
  const cash = cashRows || [];
  let previousClosedCounted = null;

  return sessions.map(function (session) {
    const sessionId = String(session['Session ID'] || '');
    const status = String(session['Status'] || '');
    const openingCounted = roundMoney_(Number(session['Opening Cash']) || 0);
    const isBaseline = previousClosedCounted === null;
    const openingExpected = isBaseline ? '' : previousClosedCounted;
    const openingDifference = isBaseline ? '' : roundMoney_(openingCounted - openingExpected);
    const openingExplanation = cashReconciliationEvaluate_(
      openingDifference,
      session['Opening Explanation Entry IDs'],
      cash,
      isBaseline
    );

    const hasCloseExpected = session['Expected Cash'] !== '' && session['Expected Cash'] !== null && session['Expected Cash'] !== undefined;
    const hasCloseCounted = session['Counted Cash'] !== '' && session['Counted Cash'] !== null && session['Counted Cash'] !== undefined;
    const hasVariance = session['Variance'] !== '' && session['Variance'] !== null && session['Variance'] !== undefined;
    const closingExpected = hasCloseExpected ? roundMoney_(Number(session['Expected Cash']) || 0) : '';
    const closingCounted = hasCloseCounted ? roundMoney_(Number(session['Counted Cash']) || 0) : '';
    const closingDifference = hasVariance
      ? roundMoney_(Number(session['Variance']) || 0)
      : (hasCloseExpected && hasCloseCounted ? roundMoney_(closingCounted - closingExpected) : '');

    let closingExplanation;
    if (hasCloseExpected && hasCloseCounted) {
      closingExplanation = cashReconciliationEvaluate_(
        closingDifference,
        session['Closing Explanation Entry IDs'],
        cash,
        false
      );
    } else {
      closingExplanation = {
        state: status === 'Closed' ? 'Needs Review' : (status === 'Closing' ? 'Closing' : 'Open'),
        requiredDirection: '',
        requiredAmount: 0,
        linkedAmount: 0,
        remainingAmount: 0,
        entryIds: cashReconciliationParseIds_(session['Closing Explanation Entry IDs'])
      };
    }

    const phaseStates = [openingExplanation.state, closingExplanation.state];
    let reconciliationState = 'Balanced';
    if (phaseStates.indexOf('Needs Review') !== -1 || phaseStates.indexOf('Unexplained') !== -1) {
      reconciliationState = 'Needs Review';
    } else if (status !== 'Closed') {
      reconciliationState = status === 'Closing' ? 'Closing' : 'Open';
    } else if (phaseStates.indexOf('Explained') !== -1) {
      reconciliationState = 'Explained';
    }

    const row = {
      sessionId: sessionId,
      date: safeDateOnly_(session['Date'] || session['Opened At']),
      openedAt: session['Opened At'] || '',
      closedAt: session['Closed At'] || '',
      sessionStatus: status,

      openingExpected: openingExpected,
      openingCounted: openingCounted,
      openingDifference: openingDifference,
      openingState: openingExplanation.state,
      openingRequiredDirection: openingExplanation.requiredDirection,
      openingRequiredAmount: openingExplanation.requiredAmount,
      openingLinkedAmount: openingExplanation.linkedAmount,
      openingRemainingAmount: openingExplanation.remainingAmount,
      openingExplanationEntryIds: openingExplanation.entryIds,

      closingExpected: closingExpected,
      closingCounted: closingCounted,
      closingDifference: closingDifference,
      closingState: closingExplanation.state,
      closingRequiredDirection: closingExplanation.requiredDirection,
      closingRequiredAmount: closingExplanation.requiredAmount,
      closingLinkedAmount: closingExplanation.linkedAmount,
      closingRemainingAmount: closingExplanation.remainingAmount,
      closingExplanationEntryIds: closingExplanation.entryIds,

      reconciliationState: reconciliationState,
      needsReview: reconciliationState === 'Needs Review',
      notes: session['Notes'] || ''
    };

    if (status === 'Closed' && hasCloseCounted) previousClosedCounted = closingCounted;
    return row;
  });
}

function cashReconciliationLinkedUsage_(sessionRows) {
  const used = {};
  (sessionRows || []).forEach(function (session) {
    ['opening', 'closing'].forEach(function (phase) {
      const field = cashReconciliationExplanationField_(phase);
      cashReconciliationParseIds_(session[field]).forEach(function (entryId) {
        if (!used[entryId]) used[entryId] = [];
        used[entryId].push({
          sessionId: String(session['Session ID'] || ''),
          phase: phase
        });
      });
    });
  });
  return used;
}

function cashReconciliationFindSessionRow_(sessionRows, sessionId) {
  const wanted = String(sessionId || '');
  for (let i = 0; i < (sessionRows || []).length; i++) {
    if (String(sessionRows[i]['Session ID'] || '') === wanted) return sessionRows[i];
  }
  return null;
}

function cashReconciliationFindBuiltRow_(sessionRows, cashRows, sessionId) {
  const rows = cashReconciliationBuildRows_(sessionRows, cashRows);
  const wanted = String(sessionId || '');
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].sessionId === wanted) return rows[i];
  }
  return null;
}

function cashReconciliationPhaseMeta_(row, phase) {
  if (!row || (phase !== 'opening' && phase !== 'closing')) return null;
  return {
    difference: row[phase + 'Difference'],
    state: row[phase + 'State'],
    requiredDirection: row[phase + 'RequiredDirection'],
    requiredAmount: row[phase + 'RequiredAmount'],
    linkedAmount: row[phase + 'LinkedAmount'],
    remainingAmount: row[phase + 'RemainingAmount'],
    entryIds: row[phase + 'ExplanationEntryIds']
  };
}

function getCashReconciliationCandidates(token, sessionId, phase, query) {
  try {
    requirePermission_(token, 'cashReconciliation', 'view');
    phase = String(phase || '').toLowerCase();
    if (phase !== 'opening' && phase !== 'closing') return fail_('Choose opening or closing reconciliation.');

    const sessions = getAllRows_('CASH_SESSIONS');
    const cashRows = getAllRows_('CASH_BOOK');
    const built = cashReconciliationFindBuiltRow_(sessions, cashRows, sessionId);
    if (!built) return fail_('Cash session not found.');

    const meta = cashReconciliationPhaseMeta_(built, phase);
    if (!meta || meta.difference === '' || Number(meta.requiredAmount) <= 0) {
      return fail_('This cash-session phase has no difference to explain.');
    }

    const storedSelectedIds = cashReconciliationParseIds_(meta.entryIds);
    const usage = cashReconciliationLinkedUsage_(sessions);
    const byId = cashReconciliationRowById_(cashRows);
    const selectedIds = [];
    const staleEntryIds = [];

    storedSelectedIds.forEach(function (entryId) {
      const row = byId[entryId];
      const signed = row ? cashReconciliationSigned_(row) : 0;
      const otherUses = (usage[entryId] || []).filter(function (use) {
        return !(use.sessionId === String(sessionId || '') && use.phase === phase);
      });
      const directionOk = row && signed &&
        ((meta.difference < 0 && signed < 0) || (meta.difference > 0 && signed > 0));
      if (row && !cashReconciliationIsDeleted_(row) && !cashReconciliationIsSynthetic_(row) &&
          directionOk && !otherUses.length) {
        selectedIds.push(entryId);
      } else {
        staleEntryIds.push(entryId);
      }
    });

    const selectedMap = {};
    selectedIds.forEach(function (id) { selectedMap[id] = true; });
    const q = String(query || '').trim().toLowerCase();

    const candidates = cashRows.filter(function (row) {
      const entryId = String(row['Entry ID'] || '');
      if (!entryId || cashReconciliationIsDeleted_(row) || cashReconciliationIsSynthetic_(row)) return false;

      const signed = cashReconciliationSigned_(row);
      if (!signed) return false;
      if (meta.difference < 0 && signed >= 0) return false;
      if (meta.difference > 0 && signed <= 0) return false;

      const otherUses = (usage[entryId] || []).filter(function (use) {
        return !(use.sessionId === String(sessionId || '') && use.phase === phase);
      });
      if (otherUses.length && !selectedMap[entryId]) return false;

      if (q) {
        const haystack = [
          entryId, row['Date'], row['Type'], row['Reference'], row['Description']
        ].join(' ').toLowerCase();
        if (haystack.indexOf(q) === -1) return false;
      }
      return true;
    }).sort(function (a, b) {
      const aKey = cashReconciliationSortKey_(a['Date']);
      const bKey = cashReconciliationSortKey_(b['Date']);
      if (typeof aKey === 'number' && typeof bKey === 'number' && aKey !== bKey) return bKey - aKey;
      return (Number(b._rowIndex) || 0) - (Number(a._rowIndex) || 0);
    }).slice(0, 250).map(function (row) {
      const signed = cashReconciliationSigned_(row);
      return {
        entryId: String(row['Entry ID'] || ''),
        date: safeDateOnly_(row['Date']),
        type: row['Type'] || '',
        reference: row['Reference'] || '',
        description: row['Description'] || '',
        direction: signed < 0 ? 'Cash Out' : 'Cash In',
        amount: roundMoney_(Math.abs(signed)),
        selected: !!selectedMap[String(row['Entry ID'] || '')]
      };
    });

    return ok_({
      sessionId: built.sessionId,
      phase: phase,
      difference: meta.difference,
      requiredDirection: meta.requiredDirection,
      requiredAmount: meta.requiredAmount,
      selectedEntryIds: selectedIds,
      staleEntryIds: staleEntryIds,
      candidates: candidates
    });
  } catch (err) {
    logError_('getCashReconciliationCandidates', err);
    return fail_(err.message);
  }
}

function cashReconciliationRecalculateClosedSession_(session, sessionRows, cashRows) {
  if (!session || (session['Status'] !== 'Closed' && session['Status'] !== 'Closing')) return null;

  const sessionId = String(session['Session ID'] || '');
  const markerIndex = (cashRows || []).findIndex(function (row) {
    return String(row['Type'] || '') === 'Session Open' &&
      String(row['Reference'] || '') === sessionId;
  });
  if (markerIndex === -1) return null;

  let nextMarkerIndex = (cashRows || []).length;
  for (let i = markerIndex + 1; i < (cashRows || []).length; i++) {
    if (String(cashRows[i]['Type'] || '') === 'Session Open') {
      nextMarkerIndex = i;
      break;
    }
  }

  const usage = cashReconciliationLinkedUsage_(sessionRows);
  const openingIds = cashReconciliationParseIds_(session['Opening Explanation Entry IDs']);
  const closingIds = cashReconciliationParseIds_(session['Closing Explanation Entry IDs']);
  const openingMap = {};
  const closingMap = {};
  openingIds.forEach(function (id) { openingMap[id] = true; });
  closingIds.forEach(function (id) { closingMap[id] = true; });

  let movement = 0;
  const countedClosingIds = {};

  for (let i = markerIndex + 1; i < nextMarkerIndex; i++) {
    const row = cashRows[i];
    if (!row || cashReconciliationIsDeleted_(row) || cashReconciliationIsSynthetic_(row)) continue;

    const entryId = String(row['Entry ID'] || '');
    if (entryId && openingMap[entryId]) continue;

    if (entryId) {
      const uses = usage[entryId] || [];
      const belongsToThisClosing = !!closingMap[entryId];
      const belongsElsewhere = uses.some(function (use) {
        return !(use.sessionId === sessionId && use.phase === 'closing');
      });
      if (belongsElsewhere && !belongsToThisClosing) continue;
      if (belongsToThisClosing) countedClosingIds[entryId] = true;
    }

    movement = roundMoney_(movement + cashReconciliationSigned_(row));
  }

  // A closing explanation can be recorded after a later Session Open marker.
  // Attribute it back to the session it explains exactly once.
  const byId = cashReconciliationRowById_(cashRows);
  closingIds.forEach(function (entryId) {
    if (countedClosingIds[entryId]) return;
    const row = byId[entryId];
    if (!row || cashReconciliationIsDeleted_(row) || cashReconciliationIsSynthetic_(row)) return;
    movement = roundMoney_(movement + cashReconciliationSigned_(row));
  });

  const expected = roundMoney_((Number(session['Opening Cash']) || 0) + movement);
  const hasCounted = session['Counted Cash'] !== '' &&
    session['Counted Cash'] !== null &&
    session['Counted Cash'] !== undefined;
  const variance = hasCounted
    ? roundMoney_((Number(session['Counted Cash']) || 0) - expected)
    : '';

  return { expected: expected, variance: variance };
}

function cashReconciliationRetireLegacyAdjustment_(cashRows, sessionId, phase) {
  const type = phase === 'opening' ? 'Session Open' : 'Day Close Adjustment';
  (cashRows || []).forEach(function (row, index) {
    if (cashReconciliationIsDeleted_(row)) return;
    if (String(row['Type'] || '') !== type || String(row['Reference'] || '') !== String(sessionId || '')) return;
    if (cashReconciliationSigned_(row) === 0) return;

    const rowIndex = Number(row._rowIndex) || index + 2;
    const currentDescription = String(row['Description'] || '').trim();
    const retiredText = 'legacy automatic adjustment retired by Cash Reconciliation';
    updateRowFields_('CASH_BOOK', rowIndex, {
      'Debit': '',
      'Credit': '',
      'Description': currentDescription
        ? currentDescription + ' — ' + retiredText
        : retiredText
    });
  });
}

function saveCashReconciliationExplanation(token, sessionId, phase, entryIds) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    requirePermission_(token, 'cashReconciliation', 'edit');
    phase = String(phase || '').toLowerCase();
    if (phase !== 'opening' && phase !== 'closing') return fail_('Choose opening or closing reconciliation.');

    const ids = cashReconciliationParseIds_(entryIds);
    if (!ids.length) return fail_('Select the real ERP transaction that explains this difference.');

    const sessions = getAllRows_('CASH_SESSIONS');
    const cashRows = getAllRows_('CASH_BOOK');
    const session = cashReconciliationFindSessionRow_(sessions, sessionId);
    if (!session) return fail_('Cash session not found.');

    const built = cashReconciliationFindBuiltRow_(sessions, cashRows, sessionId);
    const meta = cashReconciliationPhaseMeta_(built, phase);
    if (!meta || meta.difference === '' || Number(meta.requiredAmount) <= 0) {
      return fail_('This cash-session phase has no difference to explain.');
    }

    const usage = cashReconciliationLinkedUsage_(sessions);
    const byId = cashReconciliationRowById_(cashRows);
    let signedTotal = 0;

    for (let i = 0; i < ids.length; i++) {
      const entryId = ids[i];
      const otherUses = (usage[entryId] || []).filter(function (use) {
        return !(use.sessionId === String(sessionId || '') && use.phase === phase);
      });
      if (otherUses.length) return fail_('Cash Book entry ' + entryId + ' is already linked to another reconciliation.');

      const row = byId[entryId];
      if (!row || cashReconciliationIsDeleted_(row)) {
        return fail_('Cash Book entry ' + entryId + ' is missing or deleted.');
      }
      if (cashReconciliationIsSynthetic_(row)) {
        return fail_('Choose a real ERP transaction, not a cash-session adjustment.');
      }

      const signed = cashReconciliationSigned_(row);
      if (!signed ||
          (meta.difference < 0 && signed >= 0) ||
          (meta.difference > 0 && signed <= 0)) {
        return fail_('Selected transactions must all match the required ' + meta.requiredDirection + ' direction.');
      }
      signedTotal = roundMoney_(signedTotal + signed);
    }

    if (roundMoney_(signedTotal - Number(meta.difference)) !== 0) {
      return fail_('Selected transactions must total exactly ' + meta.requiredDirection + ' ' + meta.requiredAmount + '.');
    }

    // Retire old synthetic balancing movement first. If the following session
    // link write fails, accounting is already safe and the user can retry the
    // link without double-counting the real transaction.
    cashReconciliationRetireLegacyAdjustment_(cashRows, sessionId, phase);

    const field = cashReconciliationExplanationField_(phase);
    const sessionIndex = Number(session._rowIndex) || sessions.indexOf(session) + 2;
    const update = {};
    update[field] = JSON.stringify(ids);

    // Rebuild the closed-session expected cash with the new attribution before
    // persisting. Opening explanations are excluded from that session; closing
    // explanations are attributed back to it even when posted later.
    session[field] = update[field];
    const recalculated = cashReconciliationRecalculateClosedSession_(session, sessions, cashRows);
    if (recalculated) {
      update['Expected Cash'] = recalculated.expected;
      update['Variance'] = recalculated.variance;
      session['Expected Cash'] = recalculated.expected;
      session['Variance'] = recalculated.variance;
    }

    updateRowFields_('CASH_SESSIONS', sessionIndex, update);

    return ok_({
      sessionId: String(sessionId || ''),
      phase: phase,
      state: 'Explained',
      entryIds: ids,
      requiredDirection: meta.requiredDirection,
      requiredAmount: meta.requiredAmount
    });
  } catch (err) {
    logError_('saveCashReconciliationExplanation', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

function getCashReconciliationRows(token, filters) {
  try {
    requirePermission_(token, 'cashReconciliation', 'view');
    filters = filters || {};

    const sessions = getAllRows_('CASH_SESSIONS');
    const cashRows = getAllRows_('CASH_BOOK');
    let rows = cashReconciliationBuildRows_(sessions, cashRows);

    const dateFrom = String(filters.dateFrom || '');
    const dateTo = String(filters.dateTo || '');
    const status = String(filters.status || '');
    const query = String(filters.query || '').trim().toLowerCase();

    rows = rows.filter(function (row) {
      if (dateFrom && row.date < dateFrom) return false;
      if (dateTo && row.date > dateTo) return false;
      if (status && row.reconciliationState !== status) return false;
      if (query) {
        const haystack = [
          row.sessionId, row.date, row.sessionStatus, row.reconciliationState,
          row.openingState, row.openingRequiredDirection,
          row.closingState, row.closingRequiredDirection, row.notes
        ].join(' ').toLowerCase();
        if (haystack.indexOf(query) === -1) return false;
      }
      return true;
    });

    rows.sort(function (a, b) {
      const aKey = cashReconciliationSortKey_(a.openedAt || a.date);
      const bKey = cashReconciliationSortKey_(b.openedAt || b.date);
      if (typeof aKey === 'number' && typeof bKey === 'number') return bKey - aKey;
      return String(bKey).localeCompare(String(aKey));
    });

    const totals = {
      sessions: rows.length,
      balanced: rows.filter(function (r) { return r.reconciliationState === 'Balanced'; }).length,
      explained: rows.filter(function (r) { return r.reconciliationState === 'Explained'; }).length,
      reconciled: rows.filter(function (r) { return r.reconciliationState === 'Explained'; }).length,
      needsReview: rows.filter(function (r) { return r.reconciliationState === 'Needs Review'; }).length
    };

    return ok_({
      rows: rows,
      totals: totals,
      currencySymbol: getSettingsMap_()['Currency Symbol'] || ''
    });
  } catch (err) {
    logError_('getCashReconciliationRows', err);
    return fail_(err.message);
  }
}