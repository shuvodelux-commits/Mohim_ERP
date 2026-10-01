/**
 * ExpenseSettings.gs
 * ---------------------------------------------------------------------
 * Master data for the Expense module: Expense Categories and Payees.
 * unique name, Active/Inactive status, never hard-deleted.
 *
 * Every client-reachable function requires the expense permission.
 * Expense Categories is a small master-data page under the Expenses module.
 * addExpenseCategory() is gated directly because it is called from the UI.
 * ---------------------------------------------------------------------
 */

/** Bootstrap for the Expense Categories page. */
function getExpenseSettingsBootstrap(token) {
  try {
    requirePermission_(token, 'expense', 'view');
    const categories = getAllRows_('EXPENSE_CATEGORIES');
    const payees = activeRows_('EXPENSE_PAYEES');
    return ok_({ categories: categories, payees: payees });
  } catch (err) {
    logError_('getExpenseSettingsBootstrap', err);
    return fail_(err.message);
  }
}

// ---------------- Expense Categories ----------------

function addExpenseCategory(token, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    requirePermission_(token, 'expense', 'add');
    const name = sanitizeInput_(payload.name);
    if (!name) return fail_('Category name is required.');

    const duplicate = getAllRows_('EXPENSE_CATEGORIES').some(function (c) {
      return String(c['Category Name']).toLowerCase() === name.toLowerCase();
    });
    if (duplicate) return fail_('A category with this name already exists.');

    const id = generateId_('EXPENSE_CATEGORIES');
    appendRow_('EXPENSE_CATEGORIES', {
      'Category ID': id, 'Category Name': name,
      'Description': sanitizeInput_(payload.description),
      'Status': 'Active', 'Created At': new Date()
    });
    return ok_({ id: id });
  } catch (err) {
    logError_('addExpenseCategory', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

function updateExpenseCategory(token, categoryId, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    requirePermission_(token, 'expense', 'edit');
    const rowIndex = findRowIndex_('EXPENSE_CATEGORIES', 'Category ID', categoryId);
    if (rowIndex === -1) return fail_('Category not found.');

    const name = sanitizeInput_(payload.name);
    if (!name) return fail_('Category name is required.');

    const duplicate = getAllRows_('EXPENSE_CATEGORIES').some(function (c) {
      return c['Category ID'] !== categoryId && String(c['Category Name']).toLowerCase() === name.toLowerCase();
    });
    if (duplicate) return fail_('A category with this name already exists.');

    updateRowFields_('EXPENSE_CATEGORIES', rowIndex, {
      'Category Name': name, 'Description': sanitizeInput_(payload.description)
    });
    return ok_({ id: categoryId });
  } catch (err) {
    logError_('updateExpenseCategory', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

function setExpenseCategoryStatus(token, categoryId, status) {
  try {
    requirePermission_(token, 'expense', 'edit');
    const rowIndex = findRowIndex_('EXPENSE_CATEGORIES', 'Category ID', categoryId);
    if (rowIndex === -1) return fail_('Category not found.');
    updateRowFields_('EXPENSE_CATEGORIES', rowIndex, { 'Status': status === 'Active' ? 'Active' : 'Inactive' });
    return ok_({ id: categoryId, status: status });
  } catch (err) {
    logError_('setExpenseCategoryStatus', err);
    return fail_(err.message);
  }
}

// ---------------- Expense Payees ----------------

/** Active payees shaped for Add/Edit Expense dropdowns. */
function getActiveExpensePayeesForUI_() {
  return activeRows_('EXPENSE_PAYEES')
    .filter(function (p) { return p['Status'] !== 'Inactive'; })
    .map(function (p) {
      return { id: p['Payee ID'], name: p['Payee Name'], phone: p['Phone'] || '' };
    })
    .sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
}

/** Quick-add a payee from the Add Expense screen. */
function addExpensePayee(token, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    requirePermission_(token, 'expense', 'add');
    payload = payload || {};
    const name = sanitizeInput_(payload.name);
    if (!name) return fail_('Payee name is required.');

    const duplicate = activeRows_('EXPENSE_PAYEES').some(function (p) {
      return String(p['Payee Name']).toLowerCase() === name.toLowerCase();
    });
    if (duplicate) return fail_('A payee with this name already exists.');

    const id = generateId_('EXPENSE_PAYEES');
    appendRow_('EXPENSE_PAYEES', {
      'Payee ID': id, 'Payee Name': name,
      'Phone': sanitizeInput_(payload.phone), 'Notes': sanitizeInput_(payload.notes),
      'Status': 'Active', 'Created At': new Date()
    });
    return ok_({ id: id, name: name });
  } catch (err) {
    logError_('addExpensePayee', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

/** All non-deleted payees for the Manage Payees dialog, including inactive rows. */
function getExpensePayeesManagement(token) {
  try {
    requirePermission_(token, 'expense', 'view');
    const rows = activeRows_('EXPENSE_PAYEES').map(function (p) {
      return {
        id: p['Payee ID'],
        name: p['Payee Name'],
        phone: p['Phone'] || '',
        notes: p['Notes'] || '',
        status: p['Status'] === 'Inactive' ? 'Inactive' : 'Active'
      };
    }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
    return ok_(rows);
  } catch (err) {
    logError_('getExpensePayeesManagement', err);
    return fail_(err.message);
  }
}

/** Edit payee master data only. Historical expense snapshots remain unchanged. */
function updateExpensePayee(token, payeeId, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    requirePermission_(token, 'expense', 'edit');
    payload = payload || {};
    const id = sanitizeInput_(payeeId);
    const row = getAllRows_('EXPENSE_PAYEES').filter(function (p) { return p['Payee ID'] === id; })[0];
    if (!row || isDeleted_(row)) return fail_('Payee not found.');
    const name = sanitizeInput_(payload.name);
    if (!name) return fail_('Payee name is required.');
    const duplicate = activeRows_('EXPENSE_PAYEES').some(function (p) {
      return p['Payee ID'] !== id && String(p['Payee Name']).toLowerCase() === name.toLowerCase();
    });
    if (duplicate) return fail_('A payee with this name already exists.');
    const rowIndex = row._rowIndex || findRowIndex_('EXPENSE_PAYEES', 'Payee ID', id);
    if (rowIndex === -1) return fail_('Payee not found.');
    updateRowFields_('EXPENSE_PAYEES', rowIndex, {
      'Payee Name': name,
      'Phone': sanitizeInput_(payload.phone),
      'Notes': sanitizeInput_(payload.notes)
    });
    return ok_({ id: id, name: name });
  } catch (err) {
    logError_('updateExpensePayee', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

/** Activate/deactivate a payee without affecting historical expenses. */
function setExpensePayeeStatus(token, payeeId, status) {
  try {
    requirePermission_(token, 'expense', 'edit');
    const id = sanitizeInput_(payeeId);
    const row = getAllRows_('EXPENSE_PAYEES').filter(function (p) { return p['Payee ID'] === id; })[0];
    if (!row || isDeleted_(row)) return fail_('Payee not found.');
    const rowIndex = row._rowIndex || findRowIndex_('EXPENSE_PAYEES', 'Payee ID', id);
    if (rowIndex === -1) return fail_('Payee not found.');
    const next = status === 'Active' ? 'Active' : 'Inactive';
    updateRowFields_('EXPENSE_PAYEES', rowIndex, { 'Status': next });
    return ok_({ id: id, status: next });
  } catch (err) {
    logError_('setExpensePayeeStatus', err);
    return fail_(err.message);
  }
}

/** Soft-delete a payee while preserving every historical expense row that references it. */
function deleteExpensePayee(token, payeeId, reason) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    const id = sanitizeInput_(payeeId);
    const why = sanitizeInput_(reason);
    if (!id) return fail_('No payee specified.');
    if (!why) return fail_('Enter a reason for deleting this payee.');
    const row = getAllRows_('EXPENSE_PAYEES').filter(function (p) { return p['Payee ID'] === id; })[0];
    if (!row || isDeleted_(row)) return fail_('Payee not found or already deleted.');
    const actingUser = requireDeletePermission_(token, 'expense', row['Created At'] || new Date());
    const rowIndex = row._rowIndex || findRowIndex_('EXPENSE_PAYEES', 'Payee ID', id);
    if (rowIndex === -1) return fail_('Payee not found.');
    markRowDeleted_('EXPENSE_PAYEES', rowIndex, actingUser, why, new Date());
    logDeletion_('expense', id, '', why, actingUser);
    return ok_({ id: id });
  } catch (err) {
    logError_('deleteExpensePayee', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

