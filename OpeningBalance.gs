/**
 * OpeningBalance.gs
 * ---------------------------------------------------------------------
 * High-privilege corrections for Customer / Supplier opening balances.
 * Opening balance is a signed accounting baseline, not cash movement:
 *   Customer  + = customer owes us, - = customer advance/credit.
 *   Supplier  + = we owe supplier,   - = supplier advance/receivable.
 *
 * A correction changes the master Opening Balance and Current Due by the
 * same delta, rewrites (or creates) the Opening Balance ledger row, shifts
 * every active dependent ledger Balance by that delta, and writes a separate
 * immutable audit row. Cash Book and Bank Book are deliberately untouched.
 * ---------------------------------------------------------------------
 */

function parseSignedOpeningBalance_(value) {
  if (value === '' || value === null || value === undefined) return 0;
  const n = Number(value);
  if (!isFinite(n)) throw new Error('Enter a valid opening balance.');
  return roundMoney_(n);
}

function openingBalanceLedgerAmounts_(balance) {
  const amount = roundMoney_(balance);
  if (amount > 0) return { Debit: amount, Credit: '' };
  if (amount < 0) return { Debit: '', Credit: Math.abs(amount) };
  return { Debit: '', Credit: '' };
}

function openingBalanceEntityConfig_(entityType) {
  if (entityType === 'Customer') {
    return {
      masterSheet: 'CUSTOMERS',
      ledgerSheet: 'CUSTOMER_LEDGER',
      idColumn: 'Customer ID',
      nameColumn: 'Customer Name'
    };
  }
  if (entityType === 'Supplier') {
    return {
      masterSheet: 'SUPPLIERS',
      ledgerSheet: 'SUPPLIER_LEDGER',
      idColumn: 'Supplier ID',
      nameColumn: 'Supplier Name'
    };
  }
  throw new Error('Unsupported opening-balance entity type.');
}

/**
 * Pure planning step. No sheet/property mutation happens here, so every
 * permission/reason/number check can fail before the first accounting write.
 */
function buildOpeningBalanceCorrectionPlan_(entityType, masterRow, ledgerRows, newOpeningBalance, reason, actingUser, now) {
  const cfg = openingBalanceEntityConfig_(entityType);
  const newOpening = parseSignedOpeningBalance_(newOpeningBalance);
  const oldOpening = roundMoney_(Number(masterRow['Opening Balance']) || 0);
  const delta = roundMoney_(newOpening - oldOpening);
  const currentDue = roundMoney_(Number(masterRow['Current Due']) || 0);
  const entityId = masterRow[cfg.idColumn];
  const entityName = masterRow[cfg.nameColumn] || '';

  if (Math.abs(delta) < 0.005) {
    return {
      changed: false,
      entityType: entityType,
      masterSheet: cfg.masterSheet,
      masterRowIndex: masterRow._rowIndex,
      ledgerSheet: cfg.ledgerSheet,
      masterFields: {},
      ledgerUpdates: [],
      openingLedgerInsert: null,
      delta: 0,
      newDue: currentDue,
      auditRow: null
    };
  }

  const cleanReason = sanitizeInput_(reason);
  if (!cleanReason) throw new Error('Reason is required when changing an opening balance.');

  const newDue = roundMoney_(currentDue + delta);
  const openingAmounts = openingBalanceLedgerAmounts_(newOpening);
  const activeRows = (ledgerRows || []).filter(function (row) {
    return !isDeleted_(row) && String(row[cfg.idColumn]) === String(entityId);
  });
  // Legacy/demo rows sometimes used a non-entity Reference such as DEMO.
  // The party ID plus Type is the stable identity of the opening row.
  const openingRow = activeRows.filter(function (row) {
    return row['Type'] === 'Opening Balance';
  })[0] || null;

  const ledgerUpdates = [];
  activeRows.forEach(function (row) {
    if (openingRow && row._rowIndex === openingRow._rowIndex) {
      ledgerUpdates.push({
        rowIndex: row._rowIndex,
        fields: {
          Debit: openingAmounts.Debit,
          Credit: openingAmounts.Credit,
          Balance: newOpening
        }
      });
      return;
    }
    ledgerUpdates.push({
      rowIndex: row._rowIndex,
      fields: { Balance: roundMoney_((Number(row['Balance']) || 0) + delta) }
    });
  });

  let openingLedgerInsert = null;
  if (!openingRow) {
    openingLedgerInsert = {
      'Ledger ID': '',
      Date: masterRow['Created At'] || now,
      [cfg.idColumn]: entityId,
      [cfg.nameColumn]: entityName,
      Type: 'Opening Balance',
      Reference: entityId,
      Debit: openingAmounts.Debit,
      Credit: openingAmounts.Credit,
      Balance: newOpening,
      Notes: 'Opening balance correction',
      'Created By': actorName_(actingUser),
      'Created At': now
    };
  }

  return {
    changed: true,
    entityType: entityType,
    masterSheet: cfg.masterSheet,
    masterRowIndex: masterRow._rowIndex,
    ledgerSheet: cfg.ledgerSheet,
    masterFields: {
      'Opening Balance': newOpening,
      'Current Due': newDue
    },
    ledgerUpdates: ledgerUpdates,
    openingLedgerInsert: openingLedgerInsert,
    delta: delta,
    newDue: newDue,
    auditRow: {
      'Audit ID': '',
      'Changed At': now,
      'Entity Type': entityType,
      'Entity ID': entityId,
      'Entity Name': entityName,
      'Old Opening Balance': oldOpening,
      'New Opening Balance': newOpening,
      Delta: delta,
      'Current Due Before': currentDue,
      'Current Due After': newDue,
      Reason: cleanReason,
      'Changed By': actorName_(actingUser)
    }
  };
}

/**
 * Applies one already-validated plan while the caller holds ScriptLock.
 * extraMasterFields lets Customer/Supplier profile edits and balance
 * correction share one master-row write, reducing partial-write exposure.
 */
function applyOpeningBalanceCorrectionPlan_(plan, extraMasterFields) {
  if (!plan || !plan.changed) return;

  // Validate/self-heal every required schema and read the target ledger range
  // before the first accounting mutation. Apps Script has no rollback.
  getSheetHeaders_('OPENING_BALANCE_EDIT_LOG');

  let ledgerRange = null;
  let ledgerValues = null;
  let ledgerHeaders = null;
  let ledgerMinRow = 0;
  let ledgerMinCol = 0;
  if (plan.ledgerUpdates && plan.ledgerUpdates.length) {
    const sheet = getSheet_(plan.ledgerSheet);
    ledgerHeaders = getSheetHeaders_(plan.ledgerSheet);
    const debitCol = ledgerHeaders.indexOf('Debit');
    const creditCol = ledgerHeaders.indexOf('Credit');
    const balanceCol = ledgerHeaders.indexOf('Balance');
    if (debitCol < 0 || creditCol < 0 || balanceCol < 0) {
      throw new Error('Ledger columns are missing. Run Setup / Repair System.');
    }

    const rowIndexes = plan.ledgerUpdates.map(function (u) { return u.rowIndex; });
    ledgerMinRow = Math.min.apply(null, rowIndexes);
    const maxRow = Math.max.apply(null, rowIndexes);
    ledgerMinCol = Math.min(debitCol, creditCol, balanceCol);
    const maxCol = Math.max(debitCol, creditCol, balanceCol);
    ledgerRange = sheet.getRange(ledgerMinRow, ledgerMinCol + 1, maxRow - ledgerMinRow + 1, maxCol - ledgerMinCol + 1);
    ledgerValues = ledgerRange.getValues();

    // Prepare the in-memory batch while still before the first write.
    plan.ledgerUpdates.forEach(function (update) {
      const target = ledgerValues[update.rowIndex - ledgerMinRow];
      Object.keys(update.fields).forEach(function (field) {
        const col = ledgerHeaders.indexOf(field);
        if (col >= ledgerMinCol && col <= maxCol) target[col - ledgerMinCol] = update.fields[field];
      });
    });
  }

  const masterFields = Object.assign({}, extraMasterFields || {}, plan.masterFields || {});
  updateRowFields_(plan.masterSheet, plan.masterRowIndex, masterFields);

  if (ledgerRange) {
    ledgerRange.setValues(ledgerValues);
    invalidateSheetCache_(plan.ledgerSheet);
  }

  if (plan.openingLedgerInsert) {
    const row = Object.assign({}, plan.openingLedgerInsert);
    row['Ledger ID'] = generateId_(plan.ledgerSheet);
    appendRow_(plan.ledgerSheet, row);
  }

  const auditRow = Object.assign({}, plan.auditRow);
  auditRow['Audit ID'] = generateId_('OPENING_BALANCE_EDIT_LOG');
  appendRow_('OPENING_BALANCE_EDIT_LOG', auditRow);
}
