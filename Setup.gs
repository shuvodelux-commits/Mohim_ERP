/**
 * Setup.gs
 * ---------------------------------------------------------------------
 * Run setupSystem() once — via the "Hardware ERP" menu in the Google
 * Sheet, or from the Apps Script editor — to create every sheet, header
 * row, and default setting the app needs. Safe to re-run any time: it
 * only fills in what's missing and never touches existing data.
 * ---------------------------------------------------------------------
 */

function setupSystem_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    Object.keys(CONFIG.SHEETS).forEach(function (sheetKey) {
      getSheet_(sheetKey); // creates the sheet with headers if it's missing
    });

    seedDefaultSettings_();
    seedProductCategoriesAndUnits_();
    migrateStockLotSellPrices_();
    initIdCounters_();

    SpreadsheetApp.flush();

    const ui = SpreadsheetApp.getUi();
    ui.alert('Setup complete', 'All sheets and default settings are ready. Reload the app tab to see it.', ui.ButtonSet.OK);
    return ok_('System setup complete.');
  } catch (err) {
    logError_('setupSystem', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

/** Fills in any DEFAULT_SETTINGS key that isn't already present, without overwriting existing values. */
function seedDefaultSettings_() {
  const existing = getSettingsMap_();
  Object.keys(CONFIG.DEFAULT_SETTINGS).forEach(function (key) {
    if (existing[key] === undefined || existing[key] === '') {
      setSetting_(key, CONFIG.DEFAULT_SETTINGS[key]);
    }
  });
}

/**
 * One-time bootstrap for existing installs: seeds Product Categories /
 * Product Units from whatever distinct Category/Unit text already exists
 * on Products, so the new managed dropdowns start non-empty instead of
 * forcing every existing value to be re-typed by hand. Only runs while the
 * respective sheet is still empty — once a category/unit has been added or
 * deleted through the app, re-running Setup must never re-seed on top of
 * that.
 */
function seedProductCategoriesAndUnits_() {
  const products = getAllRows_('PRODUCTS');

  if (getAllRows_('PRODUCT_CATEGORIES').length === 0) {
    const names = Array.from(new Set(products.map(function (p) { return sanitizeInput_(p['Category']); }).filter(Boolean)));
    names.forEach(function (name) {
      appendRow_('PRODUCT_CATEGORIES', { 'Category ID': generateId_('PRODUCT_CATEGORIES'), 'Category Name': name, 'Status': 'Active', 'Created At': new Date() });
    });
  }

  if (getAllRows_('PRODUCT_UNITS').length === 0) {
    const names = Array.from(new Set(products.map(function (p) { return sanitizeInput_(p['Unit']); }).filter(Boolean)));
    names.forEach(function (name) {
      appendRow_('PRODUCT_UNITS', { 'Unit ID': generateId_('PRODUCT_UNITS'), 'Unit Name': name, 'Status': 'Active', 'Created At': new Date() });
    });
  }
}

/** Seeds the PropertiesService counters used by generateId_() if they're not already set. */
function initIdCounters_() {
  const props = PropertiesService.getDocumentProperties();
  Object.keys(CONFIG.ID_PREFIX).forEach(function (key) {
    const propKey = 'ID_COUNTER_' + key;
    if (props.getProperty(propKey) === null) {
      props.setProperty(propKey, '0');
    }
  });
}

/**
 * Scans every ID column for the highest number already used and pushes
 * each counter up to match. Run this after typing rows in by hand (or
 * pasting data) with IDs like PRD-000012, so the next auto-generated ID
 * from generateId_() continues from there instead of colliding.
 */
function syncIdCounters_() {
  const ui = SpreadsheetApp.getUi();
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    const props = PropertiesService.getDocumentProperties();
    Object.keys(CONFIG.ID_PREFIX).forEach(function (key) {
      const prefix = CONFIG.ID_PREFIX[key];
      const idColumn = CONFIG.HEADERS[key][0]; // ID is always the first column
      const rows = getAllRows_(key);
      let maxN = 0;
      rows.forEach(function (r) {
        const id = String(r[idColumn] || '');
        if (id.indexOf(prefix + '-') === 0) {
          const n = parseInt(id.slice(prefix.length + 1), 10);
          if (!isNaN(n) && n > maxN) maxN = n;
        }
      });
      const propKey = 'ID_COUNTER_' + key;
      const current = Number(props.getProperty(propKey) || '0');
      if (maxN > current) props.setProperty(propKey, String(maxN));
    });
    ui.alert('ID counters synced', 'Future auto-generated IDs will continue after the highest ID currently in each sheet.', ui.ButtonSet.OK);
    return ok_('synced');
  } catch (err) {
    logError_('syncIdCounters', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}
