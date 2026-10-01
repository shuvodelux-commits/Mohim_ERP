/**
 * Utils.gs
 * ---------------------------------------------------------------------
 * Small, stateless helpers shared across every module. Nothing here
 * touches business logic — just IDs, text safety, dates, and the
 * common response shape used for every google.script.run call.
 *
 * MERGED FINAL VERSION. Two rounds of work are folded in here:
 *   1. Two shared helpers added at the bottom (resolveTransactionDate_,
 *      resolveBankAccount_) that seven and five modules respectively
 *      each carried their own copy of.
 *   2. generateId_ no longer takes its own script lock - see the long
 *      note on it below. Callers must hold one.
 * Everything else in this file is byte-identical to the original.
 *
 * P3 drift cleanup (items 6 & 7): resolveTransactionDate_ and
 * resolveBankAccount_ were added at the bottom of this file. Seven
 * modules had grown a near-identical copy of the same backdate preamble
 * and the same "if Bank, require an id, look it up, error if missing"
 * block; both are now defined once here. Nothing else in this file
 * changed.
 * ---------------------------------------------------------------------
 */

/**
 * Generates the next sequential ID for a CONFIG.ID_PREFIX key, e.g.
 * generateId_('PURCHASES') -> 'PUR-000001', then 'PUR-000002', etc.
 *
 * ---------------------------------------------------------------------
 * CALLER MUST HOLD THE SCRIPT LOCK. This function deliberately does NOT
 * take one, and that is the fix for review item 5 / P0 #2.
 *
 * It used to open its own script lock and release it in a finally block.
 * But it is called from inside functions that ALREADY hold that lock —
 * completeSale calls it once per consumed lot, addCashBookEntry_ calls it
 * on every money movement, and so on. Apps Script's script lock is not
 * reference-counted, so that nested releaseLock() dropped the caller's
 * lock outright, and completeSale then finished writing sale items, stock
 * deductions, lot updates and cash entries completely unprotected. Its own
 * releaseLock() in finally was a no-op by then.
 *
 * Removing the inner lock is safe: every path that reaches generateId_
 * was traced and each one terminates at a caller holding the script lock
 * (the transaction functions, and the menu-run seedDemoData / clearAllData
 * / setupSystem / syncIdCounters / migrateOpeningStockLots, which all lock).
 *
 * The change is also correct whichever way Apps Script actually behaves:
 * if the lock is NOT reentrant, this removes the release that was breaking
 * it; if it IS reference-counted, this removes a redundant acquisition.
 * Either way the read-modify-write below stays protected by the caller.
 *
 * If you ever add a caller that does not hold the lock, wrap it — two
 * concurrent executions would otherwise read the same counter value and
 * hand out the same ID.
 * ---------------------------------------------------------------------
 */
function generateId_(idKey) {
  const prefix = CONFIG.ID_PREFIX[idKey];
  if (!prefix) throw new Error('Unknown ID key: ' + idKey);

  const props = PropertiesService.getDocumentProperties();
  const propKey = 'ID_COUNTER_' + idKey;
  let current = Number(props.getProperty(propKey) || '0');
  if (!Number.isFinite(current) || current < 0 || !Number.isInteger(current)) current = 0;

  // DocumentProperties can lag behind the actual sheet after a project/data
  // migration, manual import, row deletion or counter reset. Row count is NOT
  // a safe proxy for the highest issued sequence (four rows can legitimately
  // contain IDs 1, 2, 3 and 16). Reconcile against the actual IDs once per
  // execution before issuing the first ID in this family. Callers already hold
  // the script lock, so the scan and counter write are serialized.
  const verified = generateId_._sheetFloorVerified || (generateId_._sheetFloorVerified = {});
  if (!verified[idKey] && CONFIG.HEADERS[idKey]) {
    const sheet = getSheet_(idKey);
    const lastRow = sheet.getLastRow();
    let maxExisting = current;
    if (lastRow > 1) {
      // Read only the ID column, not every column of the transaction sheet.
      // This keeps the stale-counter safety scan cheap even when SALES and
      // ledger-style sheets become wide and large.
      const idValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      idValues.forEach(function (cell) {
        const id = String(cell[0] || '');
        if (id.indexOf(prefix + '-') !== 0) return;
        const n = parseInt(id.slice(prefix.length + 1), 10);
        if (!isNaN(n) && n > maxExisting) maxExisting = n;
      });
    }
    current = maxExisting;
    verified[idKey] = true;
  }

  const next = current + 1;
  if (!Number.isSafeInteger(next)) throw new Error('ID counter exhausted its safe integer range: ' + idKey);
  props.setProperty(propKey, String(next));
  return prefix + '-' + String(next).padStart(CONFIG.ID_PAD_LENGTH, '0');
}

/** Escapes HTML-significant characters so user text is safe to render back into a page. */
function escapeHtml_(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Trims a user-supplied value to a plain string. Returns '' for null/undefined. */
function sanitizeInput_(str) {
  if (str === null || str === undefined) return '';
  return String(str).trim();
}

/**
 * Phone/mobile helpers. Phone numbers are identifiers, never quantities.
 * Google Sheets can coerce a Bangladesh mobile such as 01716303647 into the
 * number 1716303647 when the cell is left in General format. We repair only
 * that unambiguous 10-digit Bangladesh mobile shape for display/storage; other
 * formats are preserved exactly as entered.
 */
function normalizePhoneDisplay_(value) {
  const text = sanitizeInput_(value);
  if (/^1[3-9]\d{8}$/.test(text)) return '0' + text;
  return text;
}

/** Canonical digits used only for phone comparison/search, never for display. */
function normalizePhoneSearch_(value) {
  const display = normalizePhoneDisplay_(value);
  const bnDigits = '০১২৩৪৫৬৭৮৯';
  const asciiText = String(display || '').replace(/[০-৯]/g, function (d) {
    return String(bnDigits.indexOf(d));
  });
  let digits = asciiText.replace(/\D/g, '');
  if (/^8801[3-9]\d{8}$/.test(digits)) digits = '0' + digits.slice(3);
  else if (/^1[3-9]\d{8}$/.test(digits)) digits = '0' + digits;
  return digits;
}

function phoneNumbersEqual_(a, b) {
  const left = normalizePhoneSearch_(a);
  const right = normalizePhoneSearch_(b);
  return !!left && !!right && left === right;
}

function phoneMatchesSearch_(phoneValue, query) {
  const phone = normalizePhoneSearch_(phoneValue);
  const q = normalizePhoneSearch_(query);
  return !!phone && !!q && phone.indexOf(q) !== -1;
}

/** True only for finite, non-negative numbers — used for quantities, prices, stock, etc. */
function isValidNonNegativeNumber_(value) {
  const n = Number(value);
  return !isNaN(n) && isFinite(n) && n >= 0;
}

/** Currency-safe rounding for transaction totals that are stored in Sheets. */
function roundMoney_(value) {
  const n = Number(value) || 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Converts a line's catalogue/unit price into the economic unit price after
 * the parent invoice/purchase-level discount has been applied proportionally.
 *
 * Example: Subtotal 1,000, Grand Total 800 => factor 0.8, so a 100 unit-price
 * line carries an effective return value of 80 per unit.  New return rows store
 * this already-net value so refunds, ledgers and reports all use one amount.
 */
function effectiveTransactionUnitPrice_(unitPrice, subtotal, grandTotal) {
  const price = Number(unitPrice) || 0;
  const sub = Number(subtotal) || 0;
  const grand = Number(grandTotal) || 0;
  const factor = sub > 0 ? grand / sub : 1;
  return price * factor;
}

/**
 * Reads a return row's economic line value without breaking legacy rows.
 * New rows are stamped `NetAfterInvoiceDiscount`; old blank rows were stored
 * at the raw pre-discount line price and therefore still need the parent
 * invoice factor applied at read/report time.
 */
function economicReturnLineAmount_(returnRow, parentSubtotal, parentGrandTotal) {
  const raw = Number(returnRow && returnRow['Line Total']) || 0;
  if (returnRow && returnRow['Pricing Basis'] === 'NetAfterInvoiceDiscount') {
    return raw;
  }
  const sub = Number(parentSubtotal) || 0;
  const grand = Number(parentGrandTotal) || 0;
  const factor = sub > 0 ? grand / sub : 1;
  return raw * factor;
}

function activeReturnChildRows_(headerSheetKey, childSheetKey, idColumn) {
  const activeIds = {};
  activeRows_(headerSheetKey).forEach(function (row) {
    activeIds[row[idColumn]] = true;
  });
  return getAllRows_(childSheetKey).filter(function (row) {
    return !!activeIds[row[idColumn]];
  });
}

function activeSalesReturnItems_() {
  return activeReturnChildRows_('SALES_RETURN', 'SALES_RETURN_ITEMS', 'Return ID');
}

function activePurchaseReturnItems_() {
  return activeReturnChildRows_('PURCHASE_RETURN', 'PURCHASE_RETURN_ITEMS', 'Return ID');
}

/**
 * Editing an already-posted transaction should not silently bypass backdate
 * permission.  Unchanged dates are accepted without forcing the user to enter
 * a new backdate reason; an actual date change goes through the same shared
 * backdate policy as transaction creation.
 */
function resolveEditedTransactionDate_(token, moduleKey, requestedDate, existingDate, backdatedReason, label) {
  const existing = safeDateOnly_(existingDate);
  const requested = sanitizeInput_(requestedDate);
  if (!requested || requested === existing) return existing;
  return resolveTransactionDate_(token, moduleKey, requested, backdatedReason, label).dateStr;
}

/**
 * Is this Settings value switched on? Use this for every boolean setting
 * rather than comparing against a string.
 *
 * Settings booleans are WRITTEN as the literal strings 'true'/'false'
 * (SETTINGS_BOOLEAN_KEYS in Settings.gs) — but they do not necessarily
 * come back that way. Google Sheets auto-types a cell whose text looks
 * boolean, exactly as it re-types date-looking text (the same behavior
 * serializeCellValue_ in Database.gs exists to undo for Dates). So the
 * string 'true' goes into the cell and a real JavaScript boolean `true`
 * comes back out of getAllRows_, which makes the obvious
 * `value === 'true'` test FALSE for a setting that is genuinely on.
 *
 * Whether a given cell is coerced also depends on that cell's number
 * format, so both types are live possibilities on the same sheet — which
 * is why this normalizes instead of picking one.
 *
 * An explicit true/false in the cell is always honoured. Only an UNSET
 * value — blank cell, missing key, anything unrecognised — falls back to
 * defaultWhenUnset, which is off unless a caller passes true.
 *
 * Pass true only where the setting has always behaved as on-by-default
 * and an installation that predates it must keep working unchanged (the
 * invoice Bismillah/signature toggles). New settings should omit it and
 * fail closed.
 */
function isSettingEnabled_(settingValue, defaultWhenUnset) {
  if (settingValue === true) return true;
  if (settingValue === false) return false;
  const s = String(settingValue === null || settingValue === undefined ? '' : settingValue).trim().toLowerCase();
  if (s === 'true') return true;
  if (s === 'false') return false;
  return defaultWhenUnset === true;
}

function formatDate_(date, tz) {
  tz = tz || Session.getScriptTimeZone();
  return Utilities.formatDate(new Date(date), tz, 'yyyy-MM-dd');
}

function formatDateTime_(date, tz) {
  tz = tz || Session.getScriptTimeZone();
  return Utilities.formatDate(new Date(date), tz, 'yyyy-MM-dd HH:mm:ss');
}

/**
 * Re-normalizes a Date value read back from a sheet to a plain 'yyyy-MM-dd'
 * string, regardless of whether Sheets auto-typed the cell into a real
 * Date (in which case getAllRows_ hands back a full 'yyyy-MM-ddTHH:mm:ss'
 * timestamp instead of the plain date the code originally wrote — see the
 * serializeCellValue_ comment in Database.gs). Any code that stores a date
 * as text and later compares it against a plain 'yyyy-MM-dd' filter value
 * (date pickers, "today") MUST route through this first, or the comparison
 * silently breaks for same-day rows the moment that column gets auto-typed.
 */
function safeDateOnly_(value) {
  if (!value) return '';
  try { return formatDate_(value); } catch (e) { return String(value).slice(0, 10); }
}


/**
 * Normalizes a time cell read from Sheets to plain HH:mm:ss. Google Sheets
 * stores a time-only cell internally as a Date anchored to 1899-12-30, and
 * serializeCellValue_ therefore returns values such as
 * '1899-12-30T17:35:01'. UI/API callers must never expose that anchor date.
 */
function safeTimeOnly_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'HH:mm:ss');
  }
  const text = String(value).trim();
  const iso = text.match(/T(\d{2}:\d{2}:\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/);
  if (iso) return iso[1];
  const plain = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (plain) return String(plain[1]).padStart(2, '0') + ':' + plain[2] + ':' + (plain[3] || '00');
  return text;
}


/**
 * Returns one sale row for an invoice ID, but fails closed when legacy data
 * contains the same Invoice ID more than once. Invoice-linked update/delete/
 * return paths must never guess which duplicate row the user meant.
 */
function findUniqueSalesRow_(invoiceId) {
  const matches = findRows_('SALES', 'Invoice ID', invoiceId);
  if (matches.length > 1) {
    throw new Error('Duplicate invoice ID detected: ' + invoiceId + '. This invoice must be repaired before View, Update, Delete or Return actions can continue.');
  }
  return matches.length ? matches[0] : null;
}


/**
 * Fails closed when a collection of active Sales rows contains a duplicate
 * Invoice ID. Aggregate calculations keyed by Invoice ID cannot safely assign
 * returns, lot costs or other child rows when two different sale headers share
 * the same key, so reports must stop rather than publish incorrect accounting.
 */
function duplicateSalesInvoiceIdMap_(salesRows) {
  const counts = {};
  (salesRows || []).forEach(function (row) {
    const id = String(row['Invoice ID'] || '').trim();
    if (!id) return;
    counts[id] = (counts[id] || 0) + 1;
  });
  const duplicates = {};
  Object.keys(counts).forEach(function (id) { if (counts[id] > 1) duplicates[id] = true; });
  return duplicates;
}

function assertUniqueSalesInvoiceIds_(salesRows, context, allSalesRows) {
  const selected = {};
  (salesRows || []).forEach(function (row) {
    const id = String(row['Invoice ID'] || '').trim();
    if (id) selected[id] = true;
  });
  const duplicateMap = duplicateSalesInvoiceIdMap_(allSalesRows || salesRows);
  const ids = Object.keys(duplicateMap).filter(function (id) {
    return !allSalesRows || !!selected[id];
  }).sort();
  if (ids.length) {
    const where = context ? String(context) + ': ' : '';
    throw new Error(where + 'Duplicate invoice ID detected: ' + ids.join(', ') + '. Repair duplicate Sales invoice IDs before using invoice-linked accounting reports.');
  }
  return true;
}

/** Customer statements must not certify balances linked to ambiguous headers. */
function assertCustomerSalesIntegrity_(customerId) {
  const allSales = getAllRows_('SALES');
  const selected = allSales.filter(function (sale) {
    return String(sale['Customer ID'] || '') === String(customerId || '');
  });
  assertUniqueSalesInvoiceIds_(selected, 'Customer ledger', allSales);
}

/**
 * Chronological sort key for a Customer/Supplier Ledger row — the actual
 * transaction date/time, not when the row was entered into the system.
 *
 * The 'Date' column is what backdating rests on (a payment logged today for
 * three days ago must still sort under that earlier day), so it always wins
 * for the date part. But not every writer of this column gives it a real
 * time — Sales/Sales Return/Sale Update rows carry the full moment they
 * happened ('Date': now), while a Payment row's 'Date' is date-only (backdating
 * doesn't need time-of-day), which serializes back as midnight. Comparing
 * those two directly makes a same-day payment always sort before a same-day
 * sale regardless of which actually happened later. So when 'Date' has no
 * real time (midnight), the row's own 'Created At' — the real entry
 * timestamp every payment row carries — fills in just the time part, for a
 * same-day tiebreak that actually reflects the order things happened.
 */
function ledgerSortKey_(row) {
  const dateStr = String(row['Date'] || '');
  const datePart = dateStr.slice(0, 10);
  let timePart = dateStr.slice(11);
  if ((!timePart || timePart === '00:00:00') && row['Created At']) {
    const createdTime = String(row['Created At']).slice(11);
    if (createdTime) timePart = createdTime;
  }
  return datePart + 'T' + (timePart || '00:00:00');
}

/**
 * Rebuilds running balances for a ledger read model without rewriting Sheets.
 * Corrections can change an older source row or append a bounded correction
 * row, which intentionally leaves stored historical Balance cells untouched.
 * Recomputing only when one party ledger is opened keeps the journal accurate
 * for display while avoiding an O(history) write cascade during correction.
 *
 * balanceTypeColumn is blank for Customer/Supplier ledgers. Vendor Ledger
 * passes 'Balance Type' so Payable and Receivable run independently.
 */
function recalculateLedgerBalancesForDisplay_(rows, balanceTypeColumn) {
  const source = Array.isArray(rows) ? rows : [];
  const ascending = source.map(function (row) {
    return Object.assign({}, row);
  }).sort(function (a, b) {
    return ledgerSortKey_(a).localeCompare(ledgerSortKey_(b));
  });
  const balances = {};
  ascending.forEach(function (row) {
    const key = balanceTypeColumn ? String(row[balanceTypeColumn] || 'Payable') : '__default__';
    const delta = (Number(row['Debit']) || 0) - (Number(row['Credit']) || 0);
    balances[key] = roundMoney_((balances[key] || 0) + delta);
    row['Balance'] = balances[key];
  });
  return ascending.sort(function (a, b) {
    return ledgerSortKey_(b).localeCompare(ledgerSortKey_(a));
  });
}

/**
 * Every client-facing function should return ok_(data) or fail_(message)
 * so javascript.html's serverCall() helper can handle all responses the
 * same way, whether they came from Products.gs, Sales.gs, or here.
 */
function ok_(data) {
  return { success: true, data: data };
}

function fail_(message) {
  return { success: false, message: String(message) };
}

/** Writes a row to the Logs sheet instead of letting an error vanish into the execution log. */
function logError_(context, err) {
  try {
    appendRow_('LOGS', {
      'Timestamp': new Date(),
      'Context': context,
      'Message': (err && err.message) ? err.message : String(err)
    });
  } catch (e) {
    // Logs sheet itself isn't available yet (e.g. before first setup) — fall back silently.
    Logger.log(context + ': ' + err);
  }
}

/**
 * ---------------------------------------------------------------------
 * Shared transaction preambles (P3 drift items 6 & 7)
 * ---------------------------------------------------------------------
 * Both helpers below THROW rather than returning fail_(). Every caller
 * already runs inside a try/catch that ends in `return fail_(err.message)`,
 * so the message the user sees is byte-identical to before — the only
 * difference is that these now also land in the Logs sheet via logError_,
 * the same as the per-line validation errors completeSale/createPurchase
 * have always thrown.
 * ---------------------------------------------------------------------
 */

/**
 * The backdate preamble every backdatable module repeated: default the
 * date to today, reject a future date, work out whether it's backdated,
 * and — only if it is — check the role's backdate window and demand a
 * reason.
 *
 * label is only used to build the error text ('Sale date cannot be in
 * the future.'), so each module keeps the exact wording it had.
 *
 * Returns { dateStr, isBackdated, backdatedDays, reason }. Callers write
 * the last three onto their own row as 'Is Backdated' / 'Backdated Days' /
 * 'Backdated Reason' — those columns are defined in Config.gs.
 */
function resolveTransactionDate_(token, moduleKey, rawDate, rawReason, label) {
  const noun = label || 'Transaction';
  const todayStr = formatDate_(new Date());
  const dateStr = sanitizeInput_(rawDate) || todayStr;

  // Guards against a malformed client value silently string-comparing its
  // way past the future-date check below.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error('Enter a valid ' + noun.toLowerCase() + ' date (yyyy-MM-dd).');
  }
  const calendarDate = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== dateStr) {
    throw new Error('Enter a valid ' + noun.toLowerCase() + ' date (yyyy-MM-dd).');
  }
  if (dateStr > todayStr) {
    throw new Error(noun + ' date cannot be in the future.');
  }

  const backdateInfo = computeBackdateInfo_(dateStr);
  let reason = '';
  if (backdateInfo.isBackdated) {
    requireBackdatePermission_(token, moduleKey, dateStr);
    reason = sanitizeInput_(rawReason);
    if (!reason) {
      throw new Error('A reason is required when dating this ' + noun.toLowerCase() + ' in the past.');
    }
  }

  return {
    dateStr: dateStr,
    isBackdated: backdateInfo.isBackdated,
    backdatedDays: backdateInfo.backdatedDays,
    reason: reason
  };
}

/**
 * Display name for a signed-in USERS row, for 'Created By' / 'Processed By'
 * columns. Every write path used to stamp Session.getActiveUser().getEmail()
 * instead — that is the Apps Script *deployment* account (always the same
 * one Google account, whoever is actually signed into the ERP), which is
 * why every transaction's Entry By showed the same address regardless of
 * which app user recorded it. Callers must pass the user row already
 * returned by requirePermission_/getSessionUser_, not re-derive it.
 */
function actorName_(user) {
  if (!user) return 'staff';
  return user['Full Name'] || user['Mobile Number'] || 'staff';
}

/**
 * Payment methods that resolve to a BANK_ACCOUNTS row and post through
 * addBankBookEntry_ / the Bank Ledger. Mobile Banking (bKash/Nagad/Rocket)
 * accounts are just BANK_ACCOUNTS rows with 'Account Type' = 'Mobile
 * Banking' — there is no separate ledger for them, so every module that
 * asks "is this a bank-ish payment" must go through this list rather than
 * literal-comparing against 'Bank', or Mobile Banking silently stops
 * posting anywhere (as it did before this list existed).
 */
const BANK_LIKE_PAYMENT_METHODS = ['Bank', 'Mobile Banking'];

function isBankLikePaymentMethod_(method) {
  return BANK_LIKE_PAYMENT_METHODS.indexOf(method) !== -1;
}

/**
 * Active BANK_ACCOUNTS rows shaped for a UI dropdown: { id, name, type }.
 * 'type' is 'Bank' or 'Mobile Banking' (see sanitizeAccountType_ in
 * BankAccounts.gs) — every bootstrap that feeds a payment-method screen
 * (POS, Expense, Customer, Supplier, Sales Management) used to carry its
 * own copy of this exact filter+map; centralized here so the 'type' field
 * only had to be added once, not six times.
 */
function getActiveBankAccountsForUI_() {
  return getAllRows_('BANK_ACCOUNTS')
    .filter(function (b) { return b['Status'] !== 'Inactive'; })
    .map(function (b) {
      return { id: b['Bank Account ID'], name: b['Account Name'], type: sanitizeAccountType_(b['Account Type']) };
    });
}

/**
 * The "if Bank-like, require an account id, look it up, error if missing"
 * block Sales / SalesManagement / Customer / Suppliers / Expense each
 * carried their own copy of.
 *
 * Returns { id, name } — both '' for any method that isn't bank-like
 * (see isBankLikePaymentMethod_), which is exactly what every caller wrote
 * into its 'Bank Account ID' / 'Bank Account Name' columns for non-bank
 * payments.
 *
 * Deliberately does NOT reject an Inactive account: updateExpense() and
 * updateSale() legitimately re-save older records whose account has since
 * been deactivated, and blocking that would be a behavior change, not a
 * refactor. The bootstrap calls already filter Inactive accounts out of
 * the dropdowns, which is where that belongs.
 */
function resolveBankAccount_(paymentMethod, bankAccountId) {
  if (!isBankLikePaymentMethod_(paymentMethod)) return { id: '', name: '' };

  const id = sanitizeInput_(bankAccountId);
  if (!id) throw new Error('Choose a bank account.');

  const account = getAllRows_('BANK_ACCOUNTS').filter(function (b) {
    return b['Bank Account ID'] === id;
  })[0];
  if (!account) throw new Error('Bank account not found.');

  return { id: account['Bank Account ID'], name: account['Account Name'] };
}
