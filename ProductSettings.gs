/**
 * ProductSettings.gs
 * ---------------------------------------------------------------------
 * Master data for the Products module: Product Categories and Product
 * Units — the options offered in the Add/Edit Product dropdowns.
 * Categories and Units are permanently deleted when the user removes them.
 * This allows deleted names (for example "kg") to be created again without
 * a duplicate-name conflict. Existing products that store these values as
 * plain text are not changed by deleting the master row.
 *
 * Gated on the 'products' permission (view/add/edit) — there's no
 * separate permission tier for this module's master data vs. the
 * products themselves, same as Expense Categories riding on 'expense'.
 * ---------------------------------------------------------------------
 */

// ---------------- Product Categories ----------------

function addProductCategory(token, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    requirePermission_(token, 'products', 'add');
    const name = sanitizeInput_(payload.name);
    if (!name) return fail_('Category name is required.');

    const categoryRows = getAllRows_('PRODUCT_CATEGORIES');
    const sameName = categoryRows.filter(function (c) {
      return String(c['Category Name']).trim().toLowerCase() === name.toLowerCase();
    });

    // Active categories are true duplicates. Legacy inactive rows are
    // permanently removed so the deleted category name can be recreated.
    const activeDuplicate = sameName.some(function (c) {
      return String(c['Status'] || 'Active').toLowerCase() === 'active';
    });
    if (activeDuplicate) return fail_('A category with this name already exists.');

    sameName.forEach(function (c) {
      const oldRowIndex = findRowIndex_('PRODUCT_CATEGORIES', 'Category ID', c['Category ID']);
      if (oldRowIndex !== -1) deleteRow_('PRODUCT_CATEGORIES', oldRowIndex);
    });

    const id = generateId_('PRODUCT_CATEGORIES');
    appendRow_('PRODUCT_CATEGORIES', {
      'Category ID': id, 'Category Name': name, 'Status': 'Active', 'Created At': new Date()
    });
    return ok_({ id: id, name: name });
  } catch (err) {
    logError_('addProductCategory', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

function setProductCategoryStatus(token, categoryId, status) {
  try {
    requirePermission_(token, 'products', 'edit');
    const rowIndex = findRowIndex_('PRODUCT_CATEGORIES', 'Category ID', categoryId);
    if (rowIndex === -1) return fail_('Category not found.');
    if (status !== 'Active') {
      // Categories are master-data labels, like Units. Permanently remove
      // the master row so the same category name can be created again.
      // Existing products keep their plain-text Category value.
      deleteRow_('PRODUCT_CATEGORIES', rowIndex);
      return ok_({ id: categoryId, deleted: true });
    }

    updateRowFields_('PRODUCT_CATEGORIES', rowIndex, { 'Status': 'Active' });
    return ok_({ id: categoryId, status: 'Active' });
  } catch (err) {
    logError_('setProductCategoryStatus', err);
    return fail_(err.message);
  }
}

// ---------------- Product Units ----------------

function addProductUnit(token, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    requirePermission_(token, 'products', 'add');
    const name = sanitizeInput_(payload.name);
    if (!name) return fail_('Unit name is required.');

    const unitRows = getAllRows_('PRODUCT_UNITS');
    const sameName = unitRows.filter(function (u) {
      return String(u['Unit Name']).trim().toLowerCase() === name.toLowerCase();
    });

    // Active units are true duplicates. Legacy inactive rows are removed
    // permanently so an old deleted unit can be recreated.
    const activeDuplicate = sameName.some(function (u) {
      return String(u['Status'] || 'Active').toLowerCase() === 'active';
    });
    if (activeDuplicate) return fail_('A unit with this name already exists.');

    sameName.forEach(function (u) {
      const oldRowIndex = findRowIndex_('PRODUCT_UNITS', 'Unit ID', u['Unit ID']);
      if (oldRowIndex !== -1) deleteRow_('PRODUCT_UNITS', oldRowIndex);
    });

    const id = generateId_('PRODUCT_UNITS');
    appendRow_('PRODUCT_UNITS', {
      'Unit ID': id, 'Unit Name': name, 'Status': 'Active', 'Created At': new Date()
    });
    return ok_({ id: id, name: name });
  } catch (err) {
    logError_('addProductUnit', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

function setProductUnitStatus(token, unitId, status) {
  try {
    requirePermission_(token, 'products', 'edit');
    const rowIndex = findRowIndex_('PRODUCT_UNITS', 'Unit ID', unitId);
    if (rowIndex === -1) return fail_('Unit not found.');

    if (status !== 'Active') {
      // Units are master-data labels, not transaction records. Permanently
      // remove the master row so the same name can be created again. Existing
      // products keep their plain-text Unit value and are not modified.
      deleteRow_('PRODUCT_UNITS', rowIndex);
      return ok_({ id: unitId, deleted: true });
    }

    updateRowFields_('PRODUCT_UNITS', rowIndex, { 'Status': 'Active' });
    return ok_({ id: unitId, status: 'Active' });
  } catch (err) {
    logError_('setProductUnitStatus', err);
    return fail_(err.message);
  }
}
