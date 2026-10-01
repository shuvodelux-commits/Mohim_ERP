/**
 * BankAccounts.gs
 * ---------------------------------------------------------------------
 * Phase 7 of the permissions/bank spec: master data for the shop's bank
 * accounts — CRUD + opening balance + disable, mirroring Suppliers.gs's
 * shape. No ledger and no payment/transfer functions yet — that's
 * Phase 8 (Bank Book, parallel to Cash Book) and Phase 9 (Bank
 * Transfer). "Current Balance" starts equal to Opening Balance and
 * isn't touched by anything in this file; Phase 8's addBankBookEntry_
 * will be the only writer to it from here on, same as Current Due on
 * Suppliers/Customers.
 *
 * Built already gated (module key 'bank') since this is a brand-new
 * module with no pre-existing unwired window to close, unlike the
 * modules wired in earlier phases.
 * ---------------------------------------------------------------------
 */

/** Bootstrap for the dedicated Bank Accounts page — mirrors getSuppliersBootstrap. */
function getBankAccountsBootstrap(token) {
  try {
    requirePermission_(token, 'bank', 'view');
    // Rows created before 'Account Type' existed read back '' for it —
    // normalize to 'Bank' here so the page never has to know about that.
    const bankAccounts = getAllRows_('BANK_ACCOUNTS').map(function (b) {
      b['Account Type'] = sanitizeAccountType_(b['Account Type']);
      return b;
    });
    const settings = getSettingsMap_();
    return ok_({
      bankAccounts: bankAccounts,
      currencySymbol: settings['Currency Symbol'] || ''
    });
  } catch (err) {
    logError_('getBankAccountsBootstrap', err);
    return fail_(err.message);
  }
}

/**
 * Only two values ever go in BANK_ACCOUNTS.'Account Type'. This is a
 * UI-only distinction (which dropdown an account shows up in) — nothing
 * ledger-related reads it, so it deliberately reuses the exact same list
 * as BANK_LIKE_PAYMENT_METHODS (Utils.gs) instead of declaring a second,
 * driftable copy.
 */
function sanitizeAccountType_(accountType) {
  return BANK_LIKE_PAYMENT_METHODS.indexOf(accountType) !== -1 ? accountType : 'Bank';
}

/**
 * payload = { name, bankName, accountNumber, openingBalance, notes, accountType }
 * 'name' is the account's display/nickname (e.g. "Main Account"),
 * distinct from 'bankName' (e.g. "Dutch-Bangla Bank"). 'accountType' is
 * 'Bank' (default) or 'Mobile Banking' — see sanitizeAccountType_.
 */
function addBankAccount(token, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    requirePermission_(token, 'bank', 'add');
    const name = sanitizeInput_(payload.name);
    if (!name) return fail_('Account name is required.');

    const duplicate = getAllRows_('BANK_ACCOUNTS').some(function (b) {
      return String(b['Account Name']).toLowerCase() === name.toLowerCase();
    });
    if (duplicate) return fail_('A bank account with this name already exists.');

    const opening = isValidNonNegativeNumber_(payload.openingBalance) ? Number(payload.openingBalance) : 0;
    if (opening > 0) requireActiveCashSession_();
    const id = generateId_('BANK_ACCOUNTS');
    const now = new Date();

    appendRow_('BANK_ACCOUNTS', {
      'Bank Account ID': id,
      'Account Name': name,
      'Bank Name': sanitizeInput_(payload.bankName),
      'Account Number': sanitizeInput_(payload.accountNumber),
      'Opening Balance': opening,
      'Current Balance': opening,
      'Notes': sanitizeInput_(payload.notes),
      'Status': 'Active',
      'Created At': now,
      'Account Type': sanitizeAccountType_(payload.accountType)
    });

    return ok_({ id: id });
  } catch (err) {
    logError_('addBankAccount', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

/** Edits name/bank/account number/notes/type only — Opening Balance and Current Balance are never editable here, same rule as Suppliers/Customers. */
function updateBankAccount(token, bankAccountId, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    requirePermission_(token, 'bank', 'edit');
    const rowIndex = findRowIndex_('BANK_ACCOUNTS', 'Bank Account ID', bankAccountId);
    if (rowIndex === -1) return fail_('Bank account not found.');
    const name = sanitizeInput_(payload.name);
    if (!name) return fail_('Account name is required.');

    const duplicate = getAllRows_('BANK_ACCOUNTS').some(function (b) {
      return b['Bank Account ID'] !== bankAccountId && String(b['Account Name']).toLowerCase() === name.toLowerCase();
    });
    if (duplicate) return fail_('A bank account with this name already exists.');

    updateRowFields_('BANK_ACCOUNTS', rowIndex, {
      'Account Name': name,
      'Bank Name': sanitizeInput_(payload.bankName),
      'Account Number': sanitizeInput_(payload.accountNumber),
      'Notes': sanitizeInput_(payload.notes),
      'Account Type': sanitizeAccountType_(payload.accountType)
    });
    return ok_({ id: bankAccountId });
  } catch (err) {
    logError_('updateBankAccount', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

/** Enable/disable — the "disable" from the spec. No delete function, same convention as Suppliers.gs. */
function setBankAccountStatus(token, bankAccountId, status) {
  try {
    requirePermission_(token, 'bank', 'edit');
    const rowIndex = findRowIndex_('BANK_ACCOUNTS', 'Bank Account ID', bankAccountId);
    if (rowIndex === -1) return fail_('Bank account not found.');
    updateRowFields_('BANK_ACCOUNTS', rowIndex, {
      'Status': status === 'Active' ? 'Active' : 'Inactive'
    });
    return ok_({ id: bankAccountId, status: status });
  } catch (err) {
    logError_('setBankAccountStatus', err);
    return fail_(err.message);
  }
}
