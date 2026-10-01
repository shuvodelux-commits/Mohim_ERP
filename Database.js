/**
 * Database.gs
 * ---------------------------------------------------------------------
 * Thin data-access layer over Google Sheets. Every other module goes
 * through these helpers instead of calling SpreadsheetApp directly, so
 * reads/writes stay batched, header handling stays consistent, and every
 * module reuses the same few primitives instead of re-implementing sheet
 * plumbing.
 *
 * ---------------------------------------------------------------------
 * PERFORMANCE (review items 8 & 9) — what changed and why it is safe
 * ---------------------------------------------------------------------
 *
 * 1. PER-EXECUTION READ CACHE. getAllRows_, getSheet_ and
 *    getSheetHeaders_ now remember their result for the life of one
 *    execution. That matters because the codebase is full of this shape:
 *
 *        const i   = findRowIndex_('CUSTOMERS', 'Customer ID', id);
 *        const row = getAllRows_('CUSTOMERS').filter(...)[0];
 *
 *    — two full passes over the same sheet to locate one row, repeated at
 *    44 call sites. The review's fix was a findRow_ helper plus migrating
 *    every one of those sites. Caching here achieves the same thing with
 *    no caller changes at all, and also collapses the 183 getAllRows_
 *    calls scattered across the project down to one read per sheet per
 *    request.
 *
 *    THE CACHE IS DROPPED THE INSTANT THAT SHEET IS WRITTEN — see
 *    invalidateSheetCache_. Every write path in this file calls it, so a
 *    read after a write in the same execution always sees fresh data.
 *    completeSale depends on exactly that: resolveOrCreateCustomer_
 *    creates a customer, then the due block looks it up again.
 *
 *    One rule for callers: do not mutate a row object returned by
 *    getAllRows_ unless you also write that change to the sheet. The
 *    array is shared, not copied. (restoreStockToLots_ is the only place
 *    that mutates, and it writes first, which drops the cache anyway.)
 *
 *    Anything that writes to a sheet WITHOUT going through this file must
 *    call invalidateSheetCache_ itself. clearAllData in SeedData.gs is the
 *    only such place and it does.
 *
 * 2. BATCHED updateRowFields_. It used to issue one setValue per field —
 *    updateExpense passes 5 fields, updateSale 13, so a single logical
 *    update cost 5 or 13 round trips. It now reads the affected column
 *    span once, patches it in memory and writes it back once: 2 calls
 *    regardless of field count. A single-field update still uses one
 *    setValue, because 1 beats 2.
 * ---------------------------------------------------------------------
 */

// ---------------------------------------------------------------- caches
// Module-level, so they live exactly as long as one execution. Apps Script
// starts a fresh global scope per request, which is precisely the lifetime
// we want — no cross-request staleness is possible.
var SHEET_OBJ_CACHE_ = {};
var SHEET_ROW_CACHE_ = {};
var SHEET_HEADER_CACHE_ = {};
// Row 1 exactly as it physically is on the sheet. getAllRows_ and
// getSheetHeaders_ both need it, and without sharing it they each paid
// their own read — which is why findRowIndex_ followed by getAllRows_ used
// to cost three reads instead of two.
var SHEET_RAWHEADER_CACHE_ = {};

// Phone/mobile columns are identifiers and must never be auto-typed as numbers
// by Google Sheets. Formatting is applied once per sheet (persisted via Script
// Properties), while read/write normalization protects legacy rows that already
// lost the leading zero before this safeguard existed.
const PHONE_TEXT_COLUMNS_ = {
  CUSTOMERS: ['Phone'],
  SUPPLIERS: ['Phone'],
  VENDORS: ['Phone'],
  EXPENSE_PAYEES: ['Phone'],
  FINANCE_PERSONS: ['Phone'],
  SALES: ['Customer Phone'],
  SALES_DRAFTS: ['Customer Phone'],
  SALES_RETURN: ['Customer Phone'],
  USERS: ['Mobile Number'],
  SESSIONS: ['Mobile Number'],
  DELETE_LOG: ['Deleted By Mobile']
};
const PHONE_SETTING_KEYS_ = { 'Phone': true, 'Phone 1': true, 'Phone 2': true };

function isPhoneTextColumn_(sheetKey, header) {
  const columns = PHONE_TEXT_COLUMNS_[sheetKey] || [];
  return columns.indexOf(header) !== -1;
}

function normalizeSheetValueForRead_(sheetKey, header, value) {
  const serialized = serializeCellValue_(value);
  return isPhoneTextColumn_(sheetKey, header) ? normalizePhoneDisplay_(serialized) : serialized;
}

function normalizeSheetValueForWrite_(sheetKey, header, value) {
  if (value === undefined || value === null) return '';
  return isPhoneTextColumn_(sheetKey, header) ? normalizePhoneDisplay_(value) : value;
}

function ensurePhoneTextColumnFormats_(sheetKey, sheet, headers) {
  const columns = PHONE_TEXT_COLUMNS_[sheetKey] || [];
  if (!columns.length) return;
  const props = PropertiesService.getScriptProperties();
  const propKey = 'db:phone-text-format:v1:' + sheetKey;
  if (props.getProperty(propKey) === '1') return;

  const rows = Math.max(1, sheet.getMaxRows() - 1);
  columns.forEach(function (header) {
    const col = headers.indexOf(header);
    if (col !== -1) sheet.getRange(2, col + 1, rows, 1).setNumberFormat('@');
  });
  props.setProperty(propKey, '1');
}

// Short cross-request cache for small/read-heavy reference sheets. Transaction
// sheets stay request-local because they change frequently. Writes call
// invalidateSheetCache_(), which also removes the cross-request entry.
const CROSS_REQUEST_CACHE_SECONDS_ = 30;
// Transaction sheets are also eligible for the short cross-request cache,
// but they use compressed payloads so normal-sized ERP histories fit under
// Apps Script CacheService's per-entry limit. Very large sheets simply fall
// back to the normal sheet read.
const COMPRESSED_CACHE_SHEETS_ = {
  SALES: true, SALE_ITEMS: true, SALE_ITEM_LOTS: true, SALES_RETURN: true, SALES_RETURN_ITEMS: true,
  PURCHASES: true, PURCHASE_ITEMS: true, PURCHASE_RETURN: true, PURCHASE_RETURN_ITEMS: true,
  STOCK_LOTS: true, STOCK_MOVEMENT: true, EXPENSES: true,
  CASH_BOOK: true, BANK_BOOK: true, BANK_TRANSFERS: true,
  CUSTOMER_LEDGER: true, SUPPLIER_LEDGER: true, VENDOR_LEDGER: true,
  VENDOR_SOURCING: true, VENDOR_RETURNS: true, VENDOR_ISSUES: true,
  FINANCE_TRANSACTIONS: true
};
const DERIVED_CACHE_SECONDS_ = 30;
const DERIVED_CACHE_KEYS_ = {
  PROFIT: 'db:v2:derived:profit:',
  INVENTORY_VALUE: 'db:v2:derived:inventory-value',
  DAYBOOK: 'db:v2:derived:daybook:'
};
const CROSS_REQUEST_CACHE_SHEETS_ = {
  SETTINGS: true,
  ROLES: true,
  PRODUCT_CATEGORIES: true,
  PRODUCT_UNITS: true,
  EXPENSE_CATEGORIES: true,
  BANK_ACCOUNTS: true,
  PRODUCTS: true,
  CUSTOMERS: true,
  SUPPLIERS: true,
  VENDORS: true
};
function crossRequestCacheKey_(sheetKey) { return 'db:v3:' + sheetKey; }
function crossRequestRowsGet_(sheetKey) {
  if (!CROSS_REQUEST_CACHE_SHEETS_[sheetKey] && !COMPRESSED_CACHE_SHEETS_[sheetKey]) return null;
  try {
    const raw = CacheService.getScriptCache().get(crossRequestCacheKey_(sheetKey));
    if (!raw) return null;
    if (raw.indexOf('gz1:') === 0) {
      const bytes = Utilities.base64Decode(raw.slice(4));
      const text = Utilities.ungzip(Utilities.newBlob(bytes)).getDataAsString();
      return JSON.parse(text);
    }
    return JSON.parse(raw);
  } catch (e) { return null; }
}
function crossRequestRowsPut_(sheetKey, rows) {
  if (!CROSS_REQUEST_CACHE_SHEETS_[sheetKey] && !COMPRESSED_CACHE_SHEETS_[sheetKey]) return;
  try {
    const raw = JSON.stringify(rows);
    if (CROSS_REQUEST_CACHE_SHEETS_[sheetKey] && raw.length <= 90000) {
      CacheService.getScriptCache().put(crossRequestCacheKey_(sheetKey), raw, CROSS_REQUEST_CACHE_SECONDS_);
      return;
    }
    if (COMPRESSED_CACHE_SHEETS_[sheetKey]) {
      const encoded = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(raw)).getBytes());
      // Leave a little headroom below the documented CacheService entry limit.
      if (encoded.length <= 90000) {
        CacheService.getScriptCache().put(crossRequestCacheKey_(sheetKey), 'gz1:' + encoded, CROSS_REQUEST_CACHE_SECONDS_);
      }
    }
  } catch (e) { /* fall back to sheet reads */ }
}

function invalidateDerivedCachesForSheet_(sheetKey) {
  const cache = CacheService.getScriptCache();
  try {
    // Profit depends on these transaction sources.
    if ({SALES:true, SALE_ITEMS:true, SALE_ITEM_LOTS:true, VENDOR_SOURCING:true, SALES_RETURN:true, SALES_RETURN_ITEMS:true, EXPENSES:true, CUSTOMER_LEDGER:true, SUPPLIER_LEDGER:true}[sheetKey]) {
      // We cannot enumerate unknown date keys efficiently, so invalidate the
      // small fixed set of report ranges used by the dashboard plus any
      // caller-specific ranges through a generation token.
      cache.put('db:v2:derived:generation:profit', String(Date.now()), DERIVED_CACHE_SECONDS_);
    }
    if (sheetKey === 'STOCK_LOTS' || sheetKey === 'PRODUCTS') {
      cache.remove(DERIVED_CACHE_KEYS_.INVENTORY_VALUE);
    }
    if ({SALES:true, PURCHASES:true, EXPENSES:true, SALES_RETURN:true, PURCHASE_RETURN:true, CUSTOMER_LEDGER:true, SUPPLIER_LEDGER:true, FINANCE_TRANSACTIONS:true, CASH_BOOK:true, BANK_BOOK:true, BANK_TRANSFERS:true, STOCK_MOVEMENT:true}[sheetKey]) {
      cache.put('db:v2:derived:generation:daybook', String(Date.now()), DERIVED_CACHE_SECONDS_);
    }
  } catch (e) {}
}

/**
 * Drops cached data for one sheet, or for every sheet when called with no
 * argument. Called by every write path below; call it yourself if you ever
 * write to a sheet without going through this file.
 */
function invalidateSheetCache_(sheetKey) {
  if (sheetKey) {
    delete SHEET_ROW_CACHE_[sheetKey];
    delete SHEET_HEADER_CACHE_[sheetKey];
    delete SHEET_RAWHEADER_CACHE_[sheetKey];
    try { CacheService.getScriptCache().remove(crossRequestCacheKey_(sheetKey)); } catch (e) {}
    invalidateDerivedCachesForSheet_(sheetKey);
  } else {
    SHEET_ROW_CACHE_ = {};
    SHEET_HEADER_CACHE_ = {};
    SHEET_RAWHEADER_CACHE_ = {};
    SHEET_OBJ_CACHE_ = {};
    try {
      Object.keys(CROSS_REQUEST_CACHE_SHEETS_).concat(Object.keys(COMPRESSED_CACHE_SHEETS_)).forEach(function (k) {
        CacheService.getScriptCache().remove(crossRequestCacheKey_(k));
      });
      CacheService.getScriptCache().remove(DERIVED_CACHE_KEYS_.INVENTORY_VALUE);
      CacheService.getScriptCache().remove('db:v2:derived:generation:profit');
      CacheService.getScriptCache().remove('db:v2:derived:generation:daybook');
    } catch (e) {}
  }
}

function getSpreadsheet_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

/**
 * Returns the Sheet object for a CONFIG.SHEETS key (e.g. 'PRODUCTS'),
 * creating it with a bold, frozen header row if it doesn't exist yet.
 *
 * The Sheet object is memoized: getSheetByName is an API call, and this
 * used to run on every single appendRow_/findRowIndex_/updateRowFields_.
 */
function getSheet_(sheetKey) {
  if (SHEET_OBJ_CACHE_[sheetKey]) return SHEET_OBJ_CACHE_[sheetKey];

  const name = CONFIG.SHEETS[sheetKey];
  const headers = CONFIG.HEADERS[sheetKey];
  if (!name) throw new Error('Unknown sheet key: ' + sheetKey);

  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headers && headers.length) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, headers.length)
        .setFontWeight('bold')
        .setBackground('#eaf1ff');
      sheet.autoResizeColumns(1, headers.length);
    }
  }
  SHEET_OBJ_CACHE_[sheetKey] = sheet;
  return sheet;
}

/** Row 1 of a sheet, exactly as stored. Shared by getAllRows_ and getSheetHeaders_ so only one of them pays for it. */
function readRawHeaders_(sheetKey) {
  if (SHEET_RAWHEADER_CACHE_[sheetKey]) return SHEET_RAWHEADER_CACHE_[sheetKey];
  const sheet = getSheet_(sheetKey);
  const lastCol = sheet.getLastColumn();
  const raw = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  SHEET_RAWHEADER_CACHE_[sheetKey] = raw;
  return raw;
}

/**
 * Reads every data row of a sheet into an array of plain objects, keyed by
 * header. Cached for the rest of this execution; any write to this sheet
 * drops the cache.
 */
function getAllRows_(sheetKey) {
  if (SHEET_ROW_CACHE_[sheetKey]) return SHEET_ROW_CACHE_[sheetKey];

  const crossCached = crossRequestRowsGet_(sheetKey);
  if (crossCached) {
    SHEET_ROW_CACHE_[sheetKey] = crossCached;
    return crossCached;
  }

  const sheet = getSheet_(sheetKey);
  const headers = readRawHeaders_(sheetKey);
  const lastRow = sheet.getLastRow();
  const lastCol = headers.length;
  if (lastRow < 2 || lastCol < 1) {
    SHEET_ROW_CACHE_[sheetKey] = [];
    return SHEET_ROW_CACHE_[sheetKey];
  }

  const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  const rows = values.map(function (row, i) {
    const obj = {};
    headers.forEach(function (h, c) { obj[h] = normalizeSheetValueForRead_(sheetKey, h, row[c]); });
    if (sheetKey === 'SETTINGS' && PHONE_SETTING_KEYS_[String(obj['Key'] || '')]) {
      obj['Value'] = normalizePhoneDisplay_(obj['Value']);
    }
    obj._rowIndex = i + 2; // 1-based sheet row number, handy for later updates
    return obj;
  });
  SHEET_ROW_CACHE_[sheetKey] = rows;
  crossRequestRowsPut_(sheetKey, rows);
  return rows;
}

/**
 * Sheets returns native Date objects for any date-formatted cell — including
 * ones we wrote as plain strings, since Sheets auto-detects and re-types
 * date-looking text. A raw Date object can fail to serialize when a server
 * function returns it to the browser via google.script.run, and Apps Script
 * silently sends the browser `null` instead of raising an error. So: every
 * Date leaving a sheet gets turned into a plain ISO-style string here, once,
 * centrally — nothing downstream ever has to worry about it again.
 */
function serializeCellValue_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
  }
  return value;
}

/**
 * Returns a sheet's real header row, auto-adding (at the end, existing
 * columns/data untouched) any column CONFIG.HEADERS defines that the
 * sheet doesn't have yet. This is what lets us add a new column to
 * CONFIG later — like Sales getting 'Customer Address' — without
 * corrupting sheets that were created before that column existed.
 *
 * Memoized per execution. When it appends missing columns it refreshes
 * the memo itself, so the very next call sees the widened header row.
 */
function getSheetHeaders_(sheetKey) {
  if (SHEET_HEADER_CACHE_[sheetKey]) return SHEET_HEADER_CACHE_[sheetKey];

  const sheet = getSheet_(sheetKey);
  const configHeaders = CONFIG.HEADERS[sheetKey];
  let actual = readRawHeaders_(sheetKey).slice();

  const missing = configHeaders.filter(function (h) { return actual.indexOf(h) === -1; });
  if (missing.length) {
    const startCol = actual.length + 1;
    sheet.getRange(1, startCol, 1, missing.length).setValues([missing]);
    sheet.getRange(1, startCol, 1, missing.length).setFontWeight('bold').setBackground('#eaf1ff');
    actual = actual.concat(missing);
    // The sheet just got wider, so the cached raw header row and any cached
    // row objects are the old, narrower shape.
    delete SHEET_ROW_CACHE_[sheetKey];
    SHEET_RAWHEADER_CACHE_[sheetKey] = actual.slice();
  }
  ensurePhoneTextColumnFormats_(sheetKey, sheet, actual);
  SHEET_HEADER_CACHE_[sheetKey] = actual;
  return actual;
}

/** Appends one row, mapping an object's keys onto the sheet's real headers (see getSheetHeaders_). */
function appendRow_(sheetKey, rowObj) {
  const sheet = getSheet_(sheetKey);
  const headers = getSheetHeaders_(sheetKey);
  const row = headers.map(function (h) {
    return normalizeSheetValueForWrite_(sheetKey, h, rowObj[h]);
  });
  try {
    sheet.appendRow(row);
    return sheet.getLastRow();
  } finally {
    // Apps Script can report an unknown write result after Sheets committed
    // the append. Always invalidate so an idempotent retry cannot reuse a
    // cached pre-write snapshot and append the same movement twice.
    invalidateSheetCache_(sheetKey);
  }
}

/** Appends many rows in a single batched write call. */
function appendRows_(sheetKey, rowObjs) {
  if (!rowObjs || !rowObjs.length) return;
  const sheet = getSheet_(sheetKey);
  const headers = getSheetHeaders_(sheetKey);
  const rows = rowObjs.map(function (rowObj) {
    return headers.map(function (h) {
      return normalizeSheetValueForWrite_(sheetKey, h, rowObj[h]);
    });
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
  invalidateSheetCache_(sheetKey);
}

/**
 * Finds the sheet row (1-based, including the header) whose column matches
 * value. Returns -1 if not found.
 *
 * Now answered from the cached rows rather than its own getRange read, so
 * the very common "findRowIndex_ then getAllRows_ to fetch the same row"
 * pair costs one sheet read between them instead of two.
 */
function findRowIndex_(sheetKey, columnName, value) {
  const headers = getSheetHeaders_(sheetKey);
  if (headers.indexOf(columnName) === -1) throw new Error('Column not found: ' + columnName);

  const rows = getAllRows_(sheetKey);
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][columnName]) === String(value)) return rows[i]._rowIndex;
  }
  return -1;
}

/**
 * Convenience for the pattern findRowIndex_ + getAllRows_().filter() used
 * all over the codebase: returns { row, rowIndex } for the first match, or
 * null. Both come from the same cached read.
 */
function findRow_(sheetKey, columnName, value) {
  const rows = getAllRows_(sheetKey);
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][columnName]) === String(value)) {
      return { row: rows[i], rowIndex: rows[i]._rowIndex };
    }
  }
  return null;
}

/**
 * Returns all rows matching an exact value. The lookup uses the same
 * execution/cross-request row cache as getAllRows_, so the expensive Sheet
 * read happens at most once and repeated ID lookups become a small indexed
 * JavaScript operation.
 */
function findRows_(sheetKey, columnName, value) {
  const rows = getAllRows_(sheetKey);
  const wanted = String(value);
  const result = [];
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][columnName]) === wanted) result.push(rows[i]);
  }
  return result;
}

function findFirstRow_(sheetKey, columnName, value) {
  const rows = getAllRows_(sheetKey);
  const wanted = String(value);
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][columnName]) === wanted) return rows[i];
  }
  return null;
}

/**
 * Updates specific fields (by header name) on a given sheet row, leaving
 * other columns untouched.
 *
 * One field  -> a single setValue (1 API call).
 * Several    -> read the affected column span once, patch it, write once
 *               (2 API calls, however many fields there are). The read is
 *               needed because the span can contain columns we must not
 *               disturb.
 */
function updateRowFields_(sheetKey, rowIndex, fields) {
  const sheet = getSheet_(sheetKey);
  const headers = getSheetHeaders_(sheetKey);

  const targets = [];
  Object.keys(fields).forEach(function (key) {
    const colIndex = headers.indexOf(key);
    if (colIndex !== -1) targets.push({ col: colIndex, value: normalizeSheetValueForWrite_(sheetKey, key, fields[key]), header: key });
  });
  if (!targets.length) return;

  if (targets.length === 1) {
    sheet.getRange(rowIndex, targets[0].col + 1).setValue(targets[0].value);
    invalidateSheetCache_(sheetKey);
    return;
  }

  let minCol = targets[0].col, maxCol = targets[0].col;
  targets.forEach(function (t) {
    if (t.col < minCol) minCol = t.col;
    if (t.col > maxCol) maxCol = t.col;
  });

  const range = sheet.getRange(rowIndex, minCol + 1, 1, maxCol - minCol + 1);
  const row = range.getValues()[0];
  targets.forEach(function (t) { row[t.col - minCol] = t.value; });
  range.setValues([row]);
  invalidateSheetCache_(sheetKey);
}

/** Deletes a single sheet row (1-based, including the header offset — same rowIndex shape findRowIndex_ returns). */
function deleteRow_(sheetKey, rowIndex) {
  const sheet = getSheet_(sheetKey);
  if (rowIndex < 2 || rowIndex > sheet.getLastRow()) throw new Error('Invalid row to delete.');
  sheet.deleteRow(rowIndex);
  // Every row below this one just shifted up, so cached _rowIndex values
  // are wrong. Dropping the cache is the only safe answer.
  invalidateSheetCache_(sheetKey);
}

/** Reads the Settings sheet into a plain { key: value } map. */
function getSettingsMap_() {
  const rows = getAllRows_('SETTINGS');
  const map = {};
  rows.forEach(function (r) { map[r['Key']] = r['Value']; });
  return map;
}

/** Writes (or overwrites) a single Settings key. */
function setSetting_(key, value) {
  const isPhoneSetting = PHONE_SETTING_KEYS_[String(key || '')] === true;
  if (isPhoneSetting) value = normalizePhoneDisplay_(value);

  const rowIndex = findRowIndex_('SETTINGS', 'Key', key);
  if (rowIndex === -1) {
    if (isPhoneSetting) {
      const sheet = getSheet_('SETTINGS');
      const headers = getSheetHeaders_('SETTINGS');
      const valueCol = headers.indexOf('Value');
      if (valueCol !== -1) sheet.getRange(sheet.getLastRow() + 1, valueCol + 1).setNumberFormat('@');
    }
    appendRow_('SETTINGS', { 'Key': key, 'Value': value });
  } else {
    if (isPhoneSetting) {
      const sheet = getSheet_('SETTINGS');
      const headers = getSheetHeaders_('SETTINGS');
      const valueCol = headers.indexOf('Value');
      if (valueCol !== -1) sheet.getRange(rowIndex, valueCol + 1).setNumberFormat('@');
    }
    updateRowFields_('SETTINGS', rowIndex, { 'Value': value });
  }
}