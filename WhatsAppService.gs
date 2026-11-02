/**
 * Phase 1 WhatsApp sharing foundation.
 * Read-only with respect to all ERP accounting data. Never sends messages.
 */

/** Canonical Bangladesh mobile number for an eventual wa.me handoff. */
function whatsAppNormalizePhone_(raw) {
  const input = String(raw == null ? '' : raw).trim();
  if (!input) throw new Error('Enter a Bangladesh mobile phone number.');
  const ascii = input
    .replace(/[০-৯]/g, function (digit) { return String(digit.charCodeAt(0) - 0x09E6); })
    .replace(/[٠-٩]/g, function (digit) { return String(digit.charCodeAt(0) - 0x0660); })
    .replace(/[۰-۹]/g, function (digit) { return String(digit.charCodeAt(0) - 0x06F0); });
  const compact = ascii.replace(/[\s().-]/g, '');
  if (!/^\+?\d+$/.test(compact)) throw new Error('Invalid Bangladesh mobile phone number.');

  let digits = '';
  if (/^01[3-9]\d{8}$/.test(compact)) digits = '88' + compact;
  else if (/^8801[3-9]\d{8}$/.test(compact)) digits = compact;
  else if (/^\+8801[3-9]\d{8}$/.test(compact)) digits = compact.slice(1);
  else throw new Error('Enter a valid Bangladesh mobile phone number, starting with 01 or +8801.');
  return { digits: digits, display: '+' + digits };
}

/**
 * An operator-entered recipient override is not persisted to customer,
 * supplier, or finance person master data.
 */
function whatsAppResolveRecipient_(storedPhone, recipientOverride, confirmOverride) {
  const alternate = String(recipientOverride == null ? '' : recipientOverride).trim();
  if (!alternate) return Object.assign({ overridden: false }, whatsAppNormalizePhone_(storedPhone));
  const normalized = whatsAppNormalizePhone_(alternate);
  let original = null;
  try { original = whatsAppNormalizePhone_(storedPhone); }
  catch (ignore) { /* A missing stored number permits a confirmed replacement. */ }
  const changed = !original || original.digits !== normalized.digits;
  if (changed && confirmOverride !== true) {
    throw new Error('Confirm the changed WhatsApp recipient phone number before opening WhatsApp.');
  }
  return Object.assign({ overridden: changed }, normalized);
}

/**
 * Require the separate share permission and view permission for the
 * requested source. IDs and Finance Person account roles are authoritative.
 */
function whatsAppAuthorize_(token, source, entityId, accountRole) {
  const sources = {
    customer: { module: 'customers', sheet: 'CUSTOMERS', idKey: 'Customer ID' },
    supplier: { module: 'suppliers', sheet: 'SUPPLIERS', idKey: 'Supplier ID' },
    financePerson: { module: 'finance', sheet: 'FINANCE_PERSONS', idKey: 'Person ID' }
  };
  const cfg = sources[source];
  if (!cfg) throw new Error('Unknown WhatsApp sharing source.');
  const id = String(entityId == null ? '' : entityId).trim();
  if (!id || id.length > 128) throw new Error('Choose a valid person or party before sharing.');

  const actor = requirePermission_(token, 'whatsappShare', 'edit');
  requirePermission_(token, cfg.module, 'view');

  const matches = getAllRows_(cfg.sheet).filter(function (row) {
    return String(row[cfg.idKey] || '') === id && !isDeleted_(row);
  });
  if (matches.length !== 1) throw new Error('WhatsApp recipient account not found or unavailable.');

  if (source === 'financePerson') {
    const role = String(accountRole == null ? '' : accountRole).trim();
    if (['Owner', 'Lender', 'Borrower'].indexOf(role) === -1) {
      throw new Error('Select a valid Finance Person account role.');
    }
    if (financePersonRoles_(matches[0]).indexOf(role) === -1) {
      throw new Error('This Finance Person does not have the selected account role.');
    }
  } else if (accountRole != null && String(accountRole).trim()) {
    throw new Error('Account role is only valid for a Finance Person.');
  }
  return actor;
}


/**
 * Version of the EXACT displayed ledger entry, not its sheet row number.
 * Task 6 passes this value for every selected ID to reject stale snapshots.
 */
function whatsAppPartyRowVersion_(row) {
  return JSON.stringify([
    String(row['Ledger ID'] || ''), String(row['Date'] || '').slice(0, 10),
    String(row['Type'] || ''), String(row['Reference'] || ''),
    Number(row['Debit']) || 0, Number(row['Credit']) || 0,
    Number(row['Balance']) || 0
  ]);
}

/** Do not forward raw, unresolved accounting correction history. */
function whatsAppPartyAssertSafeRows_(kind, entityId, rows) {
  const idField = kind === 'customer' ? 'Customer ID' : 'Supplier ID';
  (rows || []).forEach(function (row) {
    if (String(row[idField] || '') !== entityId) {
      throw new Error('Party ledger account mismatch. Refresh the ledger before sharing.');
    }
    const type = String(row['Type'] || '');
    if (kind === 'customer' ? /^(Sale Update Credit|Sale Update Debit)$/.test(type)
        : type === 'Purchase Update') {
      throw new Error('The ledger contains an unresolved correction. Review the ledger before sharing.');
    }
    if (!String(row['Ledger ID'] || '')) {
      throw new Error('Ledger entry is missing an ID; refresh the ledger before sharing.');
    }
  });
}

function whatsAppPartyBalanceKind_(kind, balance) {
  if (Math.abs(balance) < 0.005) return 'settled';
  if (kind === 'customer') return balance > 0 ? 'customer_due' : 'customer_credit';
  return balance > 0 ? 'supplier_payable' : 'supplier_advance';
}

/**
 * Source snapshot ONLY: no message delivery, UI, or financial writes.
 * Periods use the canonical statement method; selected rows use the same
 * clean projection as the existing Customer/Supplier ledger pages.
 */
function whatsAppBuildPartySource_(token, request) {
  request = request || {};
  const kind = request.source;
  if (kind !== 'customer' && kind !== 'supplier') throw new Error('Unknown party ledger source.');
  const entityId = String(request.entityId == null ? '' : request.entityId).trim();
  whatsAppAuthorize_(token, kind, entityId, request.accountRole);

  const mode = String(request.mode || '');
  if (['due', 'single', 'selected', 'period'].indexOf(mode) === -1) {
    throw new Error('Unknown WhatsApp party sharing mode.');
  }
  if (kind === 'customer') assertCustomerSalesIntegrity_(entityId);

  const rowIds = request.rowIds == null ? [] : request.rowIds;
  if (!Array.isArray(rowIds)) throw new Error('Select valid ledger row IDs.');
  if ((mode === 'due' || mode === 'period') && rowIds.length) {
    throw new Error('Row IDs are not valid for this sharing mode.');
  }

  let rows = [], business, party, period = null;
  let openingBalance = null, closingBalance = null;
  let totalDebit = 0, totalCredit = 0, summaryLabel;

  if (mode === 'period') {
    // Retains the existing ERP's inclusive date validation and
    // authoritative opening/closing balance calculation.
    const statement = getPartyLedgerStatement_(kind, token, entityId, request.from, request.to);
    party = statement.party;
    business = statement.business;
    period = statement.period;
    rows = statement.rows || [];
    whatsAppPartyAssertSafeRows_(kind, entityId, rows);
    openingBalance = Number(statement.openingBalance) || 0;
    closingBalance = Number(statement.closingBalance) || 0;
    totalDebit = Number(statement.periodDebit) || 0;
    totalCredit = Number(statement.periodCredit) || 0;
    summaryLabel = 'Period statement';
  } else {
    const index = partyLedgerBuildDisplayIndex_(kind, entityId, false);
    whatsAppPartyAssertSafeRows_(kind, entityId, index);
    party = partyLedgerSelectedParty_(kind, entityId, index);
    business = partyLedgerBusinessIdentity_();
    if (mode === 'due') {
      summaryLabel = 'Current balance';
    } else {
      if (mode === 'single' && rowIds.length !== 1) {
        throw new Error('Choose exactly one ledger entry.');
      }
      if (mode === 'selected' && (!rowIds.length || rowIds.length > 25)) {
        throw new Error('Select between 1 and 25 ledger entries.');
      }
      const chosen = new Set();
      rowIds.forEach(function (id) {
        if (typeof id !== 'string' || !id.trim()) throw new Error('Invalid ledger row ID.');
        if (chosen.has(id)) throw new Error('Duplicate ledger row IDs are not allowed.');
        chosen.add(id);
      });
      const matching = index.filter(function (row) {
        return chosen.has(String(row['Ledger ID'] || ''));
      });
      const found = {};
      matching.forEach(function (row) {
        const id = String(row['Ledger ID'] || '');
        if (found[id]) throw new Error('Duplicate authoritative ledger ID; cannot share this entry.');
        found[id] = true;
      });
      if (matching.length !== rowIds.length) {
        throw new Error('A selected ledger entry is missing or has changed. Refresh and reselect.');
      }
      rows = partyLedgerNormalizeFullRows_(kind, matching);
      whatsAppPartyAssertSafeRows_(kind, entityId, rows);
      const versions = request.rowVersions;
      if (!versions || typeof versions !== 'object' || Array.isArray(versions)) {
        throw new Error('Selected ledger row versions are required. Refresh and reselect.');
      }
      rows.forEach(function (row) {
        const id = String(row['Ledger ID'] || '');
        if (!Object.prototype.hasOwnProperty.call(versions, id) ||
            String(versions[id]) !== whatsAppPartyRowVersion_(row)) {
          throw new Error('Selected ledger entry changed since display. Refresh and reselect.');
        }
      });
      rows.forEach(function (row) {
        totalDebit = Math.round((totalDebit + (Number(row['Debit']) || 0)) * 100) / 100;
        totalCredit = Math.round((totalCredit + (Number(row['Credit']) || 0)) * 100) / 100;
      });
      // Non-contiguous selection is NOT a reconciled date-range statement.
      summaryLabel = mode === 'single' ? 'Ledger entry' : 'Selected entries';
    }
  }

  if (!party || String(party.id || '') !== entityId) {
    throw new Error('Party ledger account mismatch or missing account.');
  }
  const currentBalance = Number(party.balance) || 0;
  return {
    source: kind, entityId: entityId, mode: mode, party: party,
    business: business, period: period, rows: rows, rowCount: rows.length,
    currentBalance: currentBalance,
    balanceKind: whatsAppPartyBalanceKind_(kind, currentBalance),
    summaryLabel: summaryLabel, openingBalance: openingBalance,
    closingBalance: closingBalance, totalDebit: totalDebit, totalCredit: totalCredit
  };
}
