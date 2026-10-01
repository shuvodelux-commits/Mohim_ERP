/**
 * PartyLedger.gs
 * ---------------------------------------------------------------------
 * Read-only Customer/Supplier ledger workspace engine.
 *
 * IMPORTANT: this module never posts, edits or deletes accounting data.
 * All mutations from customerLedger.html / supplierLedger.html route to
 * the existing native Customer/Supplier/Sales/Purchase/Return handlers.
 *
 * Google Sheets performance strategy:
 *  - scan only the narrow columns required for ordering/balance
 *  - recompute authoritative running balance server-side
 *  - fetch full row payloads only for the requested page (max 200)
 * ---------------------------------------------------------------------
 */

const PARTY_LEDGER_CONFIG_ = {
  customer: {
    permission: 'customers',
    masterSheet: 'CUSTOMERS',
    ledgerSheet: 'CUSTOMER_LEDGER',
    partyIdColumn: 'Customer ID',
    partyNameColumn: 'Customer Name',
    phoneColumn: 'Phone',
    addressColumn: 'Address',
    balanceColumn: 'Current Due',
    sourceSheet: 'SALES',
    sourceIdColumn: 'Invoice ID'
  },
  supplier: {
    permission: 'suppliers',
    masterSheet: 'SUPPLIERS',
    ledgerSheet: 'SUPPLIER_LEDGER',
    partyIdColumn: 'Supplier ID',
    partyNameColumn: 'Supplier Name',
    phoneColumn: 'Phone',
    addressColumn: 'Address',
    balanceColumn: 'Current Due',
    sourceSheet: 'PURCHASES',
    sourceIdColumn: 'Purchase ID'
  }
};

function partyLedgerConfig_(kind) {
  const cfg = PARTY_LEDGER_CONFIG_[kind];
  if (!cfg) throw new Error('Unknown ledger type.');
  return cfg;
}

function partyLedgerPageSize_(value) {
  const n = Number(value) || 50;
  if ([50, 100, 200].indexOf(n) === -1) throw new Error('Ledger page size must be 50, 100, or 200.');
  return n;
}

function partyLedgerColumnA1_(n) {
  let out = '';
  let x = Number(n) || 0;
  while (x > 0) {
    const r = (x - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    x = Math.floor((x - 1) / 26);
  }
  return out;
}

/** Narrow read used for ordering/balances; no full-history object normalization. */
function partyLedgerReadIndex_(kind) {
  const cfg = partyLedgerConfig_(kind);
  const sheetKey = cfg.ledgerSheet;
  const sheet = getSheet_(sheetKey);
  // Ensure additive schema columns exist on older live sheets before reading.
  const headers = getSheetHeaders_(sheetKey).slice();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const needed = ['Ledger ID', 'Date', cfg.partyIdColumn, cfg.partyNameColumn, 'Type', 'Reference', 'Debit', 'Credit', 'Created At', 'Is Deleted'];
  const colByHeader = {};
  headers.forEach(function (h, i) { colByHeader[h] = i + 1; });
  needed.forEach(function (h) {
    if (!colByHeader[h]) throw new Error(sheetKey + ' missing required header: ' + h);
  });

  const a1s = needed.map(function (h) {
    const col = partyLedgerColumnA1_(colByHeader[h]);
    return col + '2:' + col + lastRow;
  });
  const ranges = sheet.getRangeList(a1s).getRanges();
  const cols = ranges.map(function (r) { return r.getValues(); });
  const rows = [];
  for (let i = 0; i < lastRow - 1; i++) {
    const row = { _rowIndex: i + 2 };
    needed.forEach(function (h, c) { row[h] = serializeCellValue_(cols[c][i][0]); });
    rows.push(row);
  }
  return rows;
}

function partyLedgerStableSortKey_(row) {
  // The ledger Date is the business date. Within one business day the Sheet
  // row order is the most reliable chronology because older live rows from
  // Sale Update / Return writers may legitimately have no Created At value.
  // Using Created At as the primary same-day key pushed those legacy rows to
  // midnight and made earlier sales appear newer than the return that was
  // actually appended afterwards.
  const datePart = String(row['Date'] || '').slice(0, 10);
  return datePart + '|' + String(row._rowIndex || 0).padStart(10, '0') + '|' + String(row['Ledger ID'] || '');
}

function partyLedgerIsCorrectionChainRow_(kind, row) {
  const type = String(row && row['Type'] || '');
  if (kind === 'customer') {
    return type === 'Sale' || type === 'Sale Update Credit' || type === 'Sale Update Debit';
  }
  return type === 'Purchase' || type === 'Purchase Update';
}

function partyLedgerRebalanceDisplayRows_(rows) {
  let balance = 0;
  return (rows || []).slice().sort(function (a, b) {
    return partyLedgerStableSortKey_(a).localeCompare(partyLedgerStableSortKey_(b));
  }).map(function (row) {
    const out = Object.assign({}, row);
    out._stableKey = partyLedgerStableSortKey_(out);
    balance = roundMoney_(balance + (Number(out['Debit']) || 0) - (Number(out['Credit']) || 0));
    out._displayBalance = balance;
    return out;
  });
}

/**
 * Business-facing projection. Internal Sale/Purchase update chains are
 * collapsed to the current economic obligation for that reference while all
 * genuine external transactions (payments, returns, opening balances, etc.)
 * remain untouched. Unknown or anomalous chains fail closed by remaining raw.
 */

function partyLedgerUserCanViewCorrections_(user) {
  const role = String(user && user['Role'] || '').toLowerCase();
  return role === 'administrator' || role === 'owner' || role === 'manager';
}

function partyLedgerResolveCorrectionsMode_(user, requested) {
  if (!requested) return false;
  if (!partyLedgerUserCanViewCorrections_(user)) {
    throw new Error('Correction history is restricted to Administrator/Owner/Manager roles.');
  }
  return true;
}

function partyLedgerSourceDateMap_(kind, rawAsc) {
  const cfg = partyLedgerConfig_(kind);
  const refs = {};
  (rawAsc || []).forEach(function (row) {
    const ref = String(row['Reference'] || '');
    if (ref && partyLedgerIsCorrectionChainRow_(kind, row)) refs[ref] = true;
  });
  const wanted = Object.keys(refs);
  if (!wanted.length) return {};

  const sheet = getSheet_(cfg.sourceSheet);
  const headers = getSheetHeaders_(cfg.sourceSheet).slice();
  const idCol = headers.indexOf(cfg.sourceIdColumn) + 1;
  const dateCol = headers.indexOf('Date') + 1;
  const lastRow = sheet.getLastRow();
  if (!idCol || !dateCol || lastRow < 2) return {};

  const idA1 = partyLedgerColumnA1_(idCol) + '2:' + partyLedgerColumnA1_(idCol) + lastRow;
  const dateA1 = partyLedgerColumnA1_(dateCol) + '2:' + partyLedgerColumnA1_(dateCol) + lastRow;
  const ranges = sheet.getRangeList([idA1, dateA1]).getRanges();
  const ids = ranges[0].getValues();
  const dates = ranges[1].getValues();
  const out = {};
  for (let i = 0; i < ids.length; i++) {
    const id = String(serializeCellValue_(ids[i][0]) || '');
    if (refs[id]) out[id] = safeDateOnly_(serializeCellValue_(dates[i][0]));
  }
  return out;
}

function partyLedgerBuildDisplayIndex_(kind, partyId, includeCorrections) {
  const raw = partyLedgerBuildAscendingIndex_(kind, partyId);
  if (includeCorrections) return raw;
  return partyLedgerProjectClean_(kind, raw, partyLedgerSourceDateMap_(kind, raw));
}

function partyLedgerProjectClean_(kind, rawAsc, sourceDateMap) {
  const rows = (rawAsc || []).slice();
  const sourceDates = sourceDateMap || {};
  const groups = {};
  const passthrough = [];

  rows.forEach(function (row) {
    const ref = String(row['Reference'] || '');
    if (!partyLedgerIsCorrectionChainRow_(kind, row) || !ref) {
      passthrough.push(Object.assign({}, row));
      return;
    }
    if (!groups[ref]) groups[ref] = [];
    groups[ref].push(row);
  });

  Object.keys(groups).forEach(function (ref) {
    const chain = groups[ref].slice().sort(function (a, b) {
      return partyLedgerStableSortKey_(a).localeCompare(partyLedgerStableSortKey_(b));
    });
    const baseType = kind === 'customer' ? 'Sale' : 'Purchase';
    const baseCount = chain.filter(function (row) { return String(row['Type'] || '') === baseType; }).length;
    if (baseCount > 1) {
      chain.forEach(function (row) { passthrough.push(Object.assign({}, row)); });
      return;
    }
    const net = roundMoney_(chain.reduce(function (sum, row) {
      return sum + (Number(row['Debit']) || 0) - (Number(row['Credit']) || 0);
    }, 0));

    if (net < -0.004) {
      chain.forEach(function (row) { passthrough.push(Object.assign({}, row)); });
      return;
    }
    if (Math.abs(net) <= 0.004) return;

    const latest = chain[chain.length - 1];
    const baseRow = chain.filter(function (row) { return String(row['Type'] || '') === baseType; })[0] || null;
    const maxRowIndex = chain.reduce(function (m, row) { return Math.max(m, Number(row._rowIndex) || 0); }, 0);
    const date = String(sourceDates[ref] || latest['Date'] || '').slice(0, 10);
    const synthetic = Object.assign({}, latest);
    synthetic._synthetic = true;
    // Keep the original same-day position when the party owns the base
    // transaction. Otherwise (reassigned-in history) use the latest audit row
    // as the deterministic cursor anchor.
    synthetic._rowIndex = baseRow ? (Number(baseRow._rowIndex) || maxRowIndex) : maxRowIndex;
    synthetic['Ledger ID'] = 'CLEAN|' + kind + '|' + ref;
    synthetic['Date'] = date;
    synthetic['Type'] = kind === 'customer' ? 'Sale' : 'Purchase';
    synthetic['Reference'] = ref;
    synthetic['Debit'] = net;
    synthetic['Credit'] = '';
    synthetic['Notes'] = '';
    passthrough.push(synthetic);
  });

  const clean = partyLedgerRebalanceDisplayRows_(passthrough);
  const rawClosing = roundMoney_(rows.reduce(function (sum, row) {
    return sum + (Number(row['Debit']) || 0) - (Number(row['Credit']) || 0);
  }, 0));
  const cleanClosing = clean.length ? Number(clean[clean.length - 1]._displayBalance) || 0 : 0;
  if (Math.abs(roundMoney_(rawClosing - cleanClosing)) > 0.004) {
    throw new Error('Clean ledger projection does not reconcile with the accounting ledger.');
  }
  return clean;
}

/** Returns active party rows oldest->newest, with authoritative _displayBalance. */
function partyLedgerBuildAscendingIndex_(kind, partyId) {
  const cfg = partyLedgerConfig_(kind);
  const pid = String(partyId || '');
  let balance = 0;
  const rows = partyLedgerReadIndex_(kind).filter(function (r) {
    return String(r[cfg.partyIdColumn] || '') === pid && !isDeleted_(r);
  }).sort(function (a, b) {
    return partyLedgerStableSortKey_(a).localeCompare(partyLedgerStableSortKey_(b));
  });
  rows.forEach(function (r) {
    balance = roundMoney_(balance + (Number(r['Debit']) || 0) - (Number(r['Credit']) || 0));
    r._displayBalance = balance;
    r._stableKey = partyLedgerStableSortKey_(r);
  });
  return rows;
}

function partyLedgerEncodeCursor_(entry) {
  if (!entry) return '';
  const raw = JSON.stringify({ k: String(entry._stableKey || ''), r: Number(entry._rowIndex) || 0 });
  return Utilities.base64EncodeWebSafe(raw, Utilities.Charset.UTF_8).replace(/=+$/g, '');
}

function partyLedgerDecodeCursor_(cursor) {
  if (!cursor) return null;
  try {
    const bytes = Utilities.base64DecodeWebSafe(String(cursor));
    const raw = Utilities.newBlob(bytes).getDataAsString('UTF-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.k !== 'string' || !parsed.k || !Number(parsed.r)) throw new Error('bad cursor');
    return { k: parsed.k, r: Number(parsed.r) };
  } catch (e) {
    throw new Error('Invalid ledger cursor.');
  }
}

function partyLedgerNormalizeFullRows_(kind, selectedIndexEntries) {
  if (!selectedIndexEntries.length) return [];
  const cfg = partyLedgerConfig_(kind);
  const rawEntries = selectedIndexEntries.filter(function (entry) { return !entry._synthetic; });
  const rawByRowIndex = {};

  if (rawEntries.length) {
    const sheet = getSheet_(cfg.ledgerSheet);
    const headers = getSheetHeaders_(cfg.ledgerSheet).slice();
    const lastCol = headers.length;
    const rowA1s = rawEntries.map(function (entry) {
      return 'A' + entry._rowIndex + ':' + partyLedgerColumnA1_(lastCol) + entry._rowIndex;
    });
    const ranges = sheet.getRangeList(rowA1s).getRanges();
    ranges.forEach(function (range, i) {
      const values = range.getValues()[0];
      const row = {};
      headers.forEach(function (h, c) { row[h] = serializeCellValue_(values[c]); });
      rawByRowIndex[String(rawEntries[i]._rowIndex)] = row;
    });
  }

  return selectedIndexEntries.map(function (entry) {
    const row = entry._synthetic
      ? Object.assign({}, entry)
      : Object.assign({}, rawByRowIndex[String(entry._rowIndex)] || {});
    row._rowIndex = entry._rowIndex;
    row['Balance'] = entry._displayBalance;
    partyLedgerAttachSourceMetadata_(kind, row);
    return row;
  });
}

function partyLedgerAttachSourceMetadata_(kind, row) {
  const type = String(row['Type'] || '');
  const ref = String(row['Reference'] || '');
  const ledgerId = String(row['Ledger ID'] || '');
  let sourceModule = '';
  let sourceId = '';
  let actions = [];

  if (kind === 'customer') {
    if (type === 'Sale' || type === 'Sale Update Credit' || type === 'Sale Update Debit') {
      sourceModule = 'sales'; sourceId = ref; actions = ['view', 'print', 'edit', 'return', 'delete'];
    } else if (type === 'Payment') {
      sourceModule = 'customerPayment'; sourceId = ledgerId; actions = ['edit', 'delete'];
    } else if (type === 'Sales Return Credit') {
      sourceModule = 'salesReturn'; sourceId = ref; actions = ['view'];
    } else if (type === 'Opening Balance') {
      sourceModule = 'customerOpeningBalance'; sourceId = String(row['Customer ID'] || ''); actions = ['edit'];
    }
  } else {
    if (type === 'Purchase' || type === 'Purchase Update') {
      sourceModule = 'purchase'; sourceId = ref; actions = ['view', 'edit', 'return', 'delete'];
    } else if (type === 'Payment') {
      sourceModule = 'supplierPayment'; sourceId = ledgerId; actions = ['edit', 'delete'];
    } else if (type === 'Purchase Return Credit') {
      sourceModule = 'purchaseReturn'; sourceId = ref; actions = ['view'];
    } else if (type === 'Opening Balance') {
      sourceModule = 'supplierOpeningBalance'; sourceId = String(row['Supplier ID'] || ''); actions = ['edit'];
    }
  }
  row.sourceModule = sourceModule;
  row.sourceId = sourceId;
  row.availableActions = actions;
  return row;
}

function partyLedgerPageFromAscending_(kind, asc, pageSize, cursor) {
  const size = partyLedgerPageSize_(pageSize);
  const desc = (asc || []).slice().reverse();
  const decoded = partyLedgerDecodeCursor_(cursor);
  let start = 0;
  if (decoded) {
    start = desc.findIndex(function (r) { return r._stableKey === decoded.k && Number(r._rowIndex) === Number(decoded.r); });
    if (start >= 0) {
      start += 1;
    } else {
      start = desc.findIndex(function (r) { return r._stableKey.localeCompare(decoded.k) < 0; });
      if (start < 0) start = desc.length;
    }
  }
  const selected = desc.slice(start, start + size);
  const rows = partyLedgerNormalizeFullRows_(kind, selected);
  const end = start + selected.length;
  const hasOlder = end < desc.length;
  return {
    rows: rows,
    page: {
      pageSize: size,
      hasOlder: hasOlder,
      olderCursor: hasOlder && selected.length ? partyLedgerEncodeCursor_(selected[selected.length - 1]) : '',
      hasNewer: !!decoded
    }
  };
}

function getPartyLedgerPage_(kind, token, partyId, pageSize, cursor, includeCorrections) {
  const cfg = partyLedgerConfig_(kind);
  const user = requirePermission_(token, cfg.permission, 'view');
  const showCorrections = partyLedgerResolveCorrectionsMode_(user, !!includeCorrections);
  const size = partyLedgerPageSize_(pageSize);
  const pid = sanitizeInput_(partyId);
  if (!pid) return { rows: [], page: { pageSize: size, hasOlder: false, olderCursor: '', hasNewer: false } };
  if (kind === 'customer') assertCustomerSalesIntegrity_(pid);
  const asc = partyLedgerBuildDisplayIndex_(kind, pid, showCorrections);
  return partyLedgerPageFromAscending_(kind, asc, size, cursor);
}

function getCustomerLedgerPage(token, customerId, pageSize, cursor, includeCorrections) {
  try { return ok_(getPartyLedgerPage_('customer', token, customerId, pageSize, cursor, includeCorrections)); }
  catch (err) { logError_('getCustomerLedgerPage', err); return fail_(err.message); }
}

function getSupplierLedgerPage(token, supplierId, pageSize, cursor, includeCorrections) {
  try { return ok_(getPartyLedgerPage_('supplier', token, supplierId, pageSize, cursor, includeCorrections)); }
  catch (err) { logError_('getSupplierLedgerPage', err); return fail_(err.message); }
}

function partyLedgerMasterRows_(kind) {
  const cfg = partyLedgerConfig_(kind);
  return getAllRows_(cfg.masterSheet).filter(function (row) { return !isDeleted_(row); });
}

function partyLedgerSelectorParties_(kind) {
  const cfg = partyLedgerConfig_(kind);
  return partyLedgerMasterRows_(kind).map(function (row) {
    return {
      id: String(row[cfg.partyIdColumn] || ''),
      name: String(row[cfg.partyNameColumn] || ''),
      phone: String(row[cfg.phoneColumn] || ''),
      address: String(row[cfg.addressColumn] || ''),
      status: String(row['Status'] || 'Active') || 'Active'
    };
  }).filter(function (p) { return !!p.id; });
}

function partyLedgerSelectedParty_(kind, partyId, ascIndex) {
  const cfg = partyLedgerConfig_(kind);
  const pid = String(partyId || '');
  if (!pid) return null;
  const allMasters = getAllRows_(cfg.masterSheet);
  const master = allMasters.filter(function (row) { return String(row[cfg.partyIdColumn] || '') === pid; })[0] || null;
  const latestIndex = ascIndex.length ? ascIndex[ascIndex.length - 1] : null;
  if (!master && !latestIndex) return null;

  const deleted = master ? isDeleted_(master) : true;
  const status = master ? (String(master['Status'] || 'Active') || 'Active') : 'History Only';
  const ledgerName = latestIndex ? String(latestIndex[cfg.partyNameColumn] || '') : '';
  return {
    id: pid,
    name: master ? String(master[cfg.partyNameColumn] || ledgerName) : ledgerName,
    phone: master ? String(master[cfg.phoneColumn] || '') : '',
    address: master ? String(master[cfg.addressColumn] || '') : '',
    status: deleted ? 'History Only' : status,
    balance: latestIndex ? Number(latestIndex._displayBalance) || 0 : (master ? Number(master[cfg.balanceColumn]) || 0 : 0),
    canPay: !!master && !deleted && status !== 'Inactive'
  };
}

function getPartyLedgerWorkspaceBootstrap_(kind, token, partyId, pageSize, includeCorrections) {
  const cfg = partyLedgerConfig_(kind);
  const user = requirePermission_(token, cfg.permission, 'view');
  const showCorrections = partyLedgerResolveCorrectionsMode_(user, !!includeCorrections);
  const size = partyLedgerPageSize_(pageSize);
  const pid = sanitizeInput_(partyId);
  if (pid && kind === 'customer') assertCustomerSalesIntegrity_(pid);
  const asc = pid ? partyLedgerBuildDisplayIndex_(kind, pid, showCorrections) : [];
  const selectedParty = pid ? partyLedgerSelectedParty_(kind, pid, asc) : null;
  const page = selectedParty ? partyLedgerPageFromAscending_(kind, asc, size, '') : {
    rows: [], page: { pageSize: size, hasOlder: false, olderCursor: '', hasNewer: false }
  };
  const settings = getSettingsMap_();
  return {
    parties: partyLedgerSelectorParties_(kind),
    bankAccounts: getActiveBankAccountsForUI_(),
    currencySymbol: settings['Currency Symbol'] || '',
    party: selectedParty,
    page: page,
    canViewCorrections: partyLedgerUserCanViewCorrections_(user),
    showCorrections: showCorrections
  };
}

function getCustomerLedgerWorkspaceBootstrap(token, customerId, pageSize, includeCorrections) {
  try { return ok_(getPartyLedgerWorkspaceBootstrap_('customer', token, customerId, pageSize, includeCorrections)); }
  catch (err) { logError_('getCustomerLedgerWorkspaceBootstrap', err); return fail_(err.message); }
}

function getSupplierLedgerWorkspaceBootstrap(token, supplierId, pageSize, includeCorrections) {
  try { return ok_(getPartyLedgerWorkspaceBootstrap_('supplier', token, supplierId, pageSize, includeCorrections)); }
  catch (err) { logError_('getSupplierLedgerWorkspaceBootstrap', err); return fail_(err.message); }
}

function partyLedgerValidateStatementDates_(fromDate, toDate) {
  const from = safeDateOnly_(fromDate);
  const to = safeDateOnly_(toDate);
  if (!from || !to) throw new Error('Choose both From Date and To Date.');
  if (from > to) throw new Error('From Date cannot be after To Date.');
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  if (to > today) throw new Error('To Date cannot be in the future.');
  return { from: from, to: to };
}

function partyLedgerBusinessIdentity_() {
  const settings = getSettingsMap_();
  return {
    name: settings['Shop Name'] || CONFIG.APP_NAME || '',
    nameBangla: settings['Shop Name Bangla'] || '',
    address: settings['Address'] || '',
    phone1: settings['Phone 1'] || '',
    phone2: settings['Phone 2'] || ''
  };
}

function getPartyLedgerStatement_(kind, token, partyId, fromDate, toDate) {
  const cfg = partyLedgerConfig_(kind);
  requirePermission_(token, cfg.permission, 'view');
  const pid = sanitizeInput_(partyId);
  if (!pid) throw new Error(kind === 'customer' ? 'Choose a customer.' : 'Choose a supplier.');
  if (kind === 'customer') assertCustomerSalesIntegrity_(pid);
  const period = partyLedgerValidateStatementDates_(fromDate, toDate);
  const asc = partyLedgerBuildDisplayIndex_(kind, pid, false);
  const party = partyLedgerSelectedParty_(kind, pid, asc);
  if (!party) throw new Error(kind === 'customer' ? 'Customer not found.' : 'Supplier not found.');

  let opening = 0;
  const periodEntries = [];
  asc.forEach(function (entry) {
    const d = safeDateOnly_(entry['Date']);
    if (d < period.from) opening = Number(entry._displayBalance) || 0;
    if (d >= period.from && d <= period.to) periodEntries.push(entry);
  });
  const rows = partyLedgerNormalizeFullRows_(kind, periodEntries);
  let debit = 0;
  let credit = 0;
  rows.forEach(function (row) {
    debit = roundMoney_(debit + (Number(row['Debit']) || 0));
    credit = roundMoney_(credit + (Number(row['Credit']) || 0));
  });
  const closing = roundMoney_(opening + debit - credit);
  return {
    kind: kind,
    business: partyLedgerBusinessIdentity_(),
    party: party,
    period: period,
    openingBalance: roundMoney_(opening),
    periodDebit: debit,
    periodCredit: credit,
    closingBalance: closing,
    rows: rows,
    printedAt: formatDateTime_(new Date(), Session.getScriptTimeZone())
  };
}

function getCustomerLedgerStatement(token, customerId, fromDate, toDate) {
  try { return ok_(getPartyLedgerStatement_('customer', token, customerId, fromDate, toDate)); }
  catch (err) { logError_('getCustomerLedgerStatement', err); return fail_(err.message); }
}

function getSupplierLedgerStatement(token, supplierId, fromDate, toDate) {
  try { return ok_(getPartyLedgerStatement_('supplier', token, supplierId, fromDate, toDate)); }
  catch (err) { logError_('getSupplierLedgerStatement', err); return fail_(err.message); }
}
