/**
 * Settings.gs
 * ---------------------------------------------------------------------
 * Backend for the general Settings page — makes the values already
 * sitting in the Settings sheet (with defaults from CONFIG.DEFAULT_SETTINGS)
 * editable from the UI, plus three fields tied to other modules:
 *   - 'Default Bank Account': a Bank Account ID, offered as a dropdown of
 *     Active accounts (Phase 7's BANK_ACCOUNTS). Not consumed by any
 *     writer yet (Expense/Purchase/POS bank-payment flows still require
 *     an explicit account per transaction) — this just gives future
 *     "preselect the default" wiring a place to read from.
 *   - 'Session Timeout Hours': read by Auth.gs's getSessionDurationMs_()
 *     on every new login, falling back to its original 12-hour constant
 *     if unset/invalid. Existing sessions already issued keep their
 *     original Expires At — this only affects sessions created after
 *     the change.
 *   - 'POS Show Purchase Price': the shop-wide master switch for Purchase
 *     Price Visibility, read by getPosBootstrap in Sales.gs. It is the
 *     OUTER of two gates — with it on, a user still sees nothing unless
 *     their role also grants 'posCost' view on the Roles page. Off by
 *     default (CONFIG.DEFAULT_SETTINGS), so an existing installation
 *     gains nothing until an administrator deliberately enables it.
 *
 * Gated under module key 'settings' — already a base NAV_ITEMS entry
 * from Phase 1 setup (predates the permission system), so it's already
 * assignable on the Roles grid with no further wiring needed there.
 * 'view' for reading, 'edit' for saving (single record, no add/delete).
 * ---------------------------------------------------------------------
 */

/** Keys this page is allowed to write — never trust a client payload beyond this whitelist. */
const SETTINGS_EDITABLE_KEYS = [
  "Shop Name", "Shop Name Bangla", "Shop Description", "Address", "Phone 1", "Phone 2", "Email",
  "Currency Symbol", "Currency Code",
  "Tax Percent", "Default Discount", "Low Stock Threshold",
  "Invoice Payment Methods", "Invoice Terms",
  "Invoice Payment Terms Days", "Invoice Payment Terms Text",
  "Invoice Footer", "Invoice Proprietor Name", "Invoice Proprietor Paragraph", "Invoice Title",
  "Invoice Show Bismillah", "Invoice Bismillah Text", "Invoice Show Signature",
  "Drive Folder Id", "Timezone", "Receipt Size",
  "Delete Confirmation Key", "Day Book Editable Days",
  "Default Bank Account", "Session Timeout Hours",
  "POS Show Purchase Price"
];

const SETTINGS_NUMERIC_KEYS = [
  "Tax Percent", "Default Discount", "Low Stock Threshold",
  "Day Book Editable Days", "Session Timeout Hours", "Invoice Payment Terms Days"
];

/**
 * Booleans are WRITTEN as the literal strings 'true'/'false' — same
 * Settings K/V sheet, no schema change.
 *
 * They do not necessarily read back as strings: Sheets auto-types a
 * boolean-looking cell, so getSettingsMap_ can hand back a real boolean.
 * Always test one of these with isSettingEnabled_ (Utils.gs), never with
 * `=== 'true'`.
 */
const SETTINGS_BOOLEAN_KEYS = ["Invoice Show Bismillah", "Invoice Show Signature", "POS Show Purchase Price"];

/** Largest logo upload accepted, in decoded bytes — keeps the resulting data: URI (embedded in every invoice render) from bloating print/PDF output. */
const INVOICE_LOGO_MAX_BYTES = 1.5 * 1024 * 1024;
const INVOICE_LOGO_ALLOWED_MIME = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** Bootstrap for the Settings page: current values + Active bank accounts for the Default Bank Account dropdown. */
function getSettingsBootstrap(token) {
  try {
    requirePermission_(token, 'settings', 'view');
    const bankAccounts = getAllRows_('BANK_ACCOUNTS').filter(function (b) { return b['Status'] !== 'Inactive'; });
    return ok_({
      settings: getSettingsMap_(),
      bankAccounts: bankAccounts.map(function (b) {
        return { id: b['Bank Account ID'], name: b['Account Name'] };
      })
    });
  } catch (err) {
    logError_('getSettingsBootstrap', err);
    return fail_(err.message);
  }
}

/**
 * payload = { 'Shop Name': ..., 'Tax Percent': ..., ... } — a flat map of
 * Settings keys to new values. Only keys in SETTINGS_EDITABLE_KEYS are ever
 * written, and only keys actually present in payload are touched (a partial
 * payload never silently blanks fields it didn't include).
 */
function updateSettings(token, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    requirePermission_(token, 'settings', 'edit');
    if (!payload || typeof payload !== 'object') return fail_('No settings data received.');

    if (payload['Shop Name'] !== undefined && !sanitizeInput_(payload['Shop Name'])) {
      return fail_('Shop Name is required.');
    }

    for (var i = 0; i < SETTINGS_NUMERIC_KEYS.length; i++) {
      var numKey = SETTINGS_NUMERIC_KEYS[i];
      if (payload[numKey] !== undefined && payload[numKey] !== '' && !isValidNonNegativeNumber_(payload[numKey])) {
        return fail_('"' + numKey + '" must be a valid non-negative number.');
      }
    }

    if (payload['Default Bank Account']) {
      var bankExists = getAllRows_('BANK_ACCOUNTS').some(function (b) {
        return b['Bank Account ID'] === payload['Default Bank Account'];
      });
      if (!bankExists) return fail_('Selected default bank account no longer exists.');
    }

    // Invoice Payment Methods / Terms are rendered on every invoice via
    // JSON.parse — reject bad JSON here so a typo shows up as a save error
    // instead of silently dropping the section off every future invoice.
    var jsonKeys = ['Invoice Payment Methods', 'Invoice Terms'];
    for (var j = 0; j < jsonKeys.length; j++) {
      var jsonKey = jsonKeys[j];
      var raw = payload[jsonKey];
      if (raw === undefined || sanitizeInput_(raw) === '') continue;
      try {
        var parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new Error('not an array');
      } catch (e) {
        return fail_('"' + jsonKey + '" must be valid JSON (an array), e.g. [{"label":"বিকাশ","value":"01711-234567"}].');
      }
    }

    SETTINGS_EDITABLE_KEYS.forEach(function (key) {
      if (payload[key] === undefined) return;
      var value;
      if (SETTINGS_NUMERIC_KEYS.indexOf(key) !== -1) {
        value = Number(payload[key] || 0);
      } else if (SETTINGS_BOOLEAN_KEYS.indexOf(key) !== -1) {
        value = (payload[key] === true || payload[key] === 'true') ? 'true' : 'false';
      } else {
        value = sanitizeInput_(payload[key]);
      }
      setSetting_(key, value);
    });

    return ok_('Settings saved.');
  } catch (err) {
    logError_('updateSettings', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

/** Bootstrap for Settings > Invoice Design: current settings + the logo (if any) already resolved to a data: URI so the page can preview it without a second round trip. */
function getInvoiceDesignBootstrap(token) {
  try {
    requirePermission_(token, 'settings', 'view');
    return ok_({
      settings: getSettingsMap_(),
      logoDataUri: resolveInvoiceLogoDataUri_()
    });
  } catch (err) {
    logError_('getInvoiceDesignBootstrap', err);
    return fail_(err.message);
  }
}

/**
 * Returns the Drive folder that holds invoice assets (currently just the
 * logo), creating it next to the spreadsheet on first use and remembering
 * its ID in the 'Drive Folder Id' setting — the same key the app already
 * reserved for this purpose but never wired up until now. If a previously
 * saved folder ID no longer resolves (deleted by hand in Drive), a fresh
 * one is created rather than failing the upload.
 */
function getOrCreateInvoiceAssetsFolder_() {
  var folderId = getSettingsMap_()['Drive Folder Id'];
  if (folderId) {
    try {
      return DriveApp.getFolderById(folderId);
    } catch (e) { /* folder was removed/moved out of reach — fall through and recreate */ }
  }
  var folder = DriveApp.createFolder('SherERP Invoice Assets');
  setSetting_('Drive Folder Id', folder.getId());
  return folder;
}

/**
 * Uploads (or replaces) the invoice logo. base64Data is the raw base64
 * payload only (no 'data:image/...;base64,' prefix — the caller strips
 * that client-side). Stores the file in Drive and remembers its File ID
 * in the 'Invoice Logo' setting; buildInvoicePayload_ resolves that ID
 * back into a data: URI at render time via resolveInvoiceLogoDataUri_.
 * Storing the ID rather than the raw image keeps the Settings sheet cell
 * small regardless of image size.
 */
function uploadInvoiceLogo(token, base64Data, mimeType) {
  var lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    requirePermission_(token, 'settings', 'edit');
    if (!base64Data) return fail_('No image data received.');
    if (INVOICE_LOGO_ALLOWED_MIME.indexOf(mimeType) === -1) {
      return fail_('Logo must be a PNG, JPEG, WEBP or GIF image.');
    }

    var bytes;
    try {
      bytes = Utilities.base64Decode(base64Data);
    } catch (e) {
      return fail_('Could not read the uploaded image.');
    }
    if (bytes.length > INVOICE_LOGO_MAX_BYTES) {
      return fail_('Logo is too large — please use an image under 1.5MB.');
    }

    var ext = mimeType.split('/')[1];
    var blob = Utilities.newBlob(bytes, mimeType, 'invoice-logo.' + ext);

    var oldFileId = getSettingsMap_()['Invoice Logo'];
    if (oldFileId) {
      try { DriveApp.getFileById(oldFileId).setTrashed(true); } catch (e) { /* already gone — nothing to clean up */ }
    }

    var folder = getOrCreateInvoiceAssetsFolder_();
    var file = folder.createFile(blob);
    setSetting_('Invoice Logo', file.getId());

    return ok_({ dataUri: 'data:' + mimeType + ';base64,' + base64Data });
  } catch (err) {
    logError_('uploadInvoiceLogo', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

/** Clears the invoice logo — trashes the Drive file and blanks the setting so the invoice header reclaims the space instead of showing a broken image. */
function removeInvoiceLogo(token) {
  var lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    requirePermission_(token, 'settings', 'edit');
    var fileId = getSettingsMap_()['Invoice Logo'];
    if (fileId) {
      try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) { /* already gone */ }
    }
    setSetting_('Invoice Logo', '');
    return ok_('Logo removed.');
  } catch (err) {
    logError_('removeInvoiceLogo', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}