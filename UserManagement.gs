/**
 * UserManagement.gs
 * ---------------------------------------------------------------------
 * PERFORMANCE (review item 7): Auth.gs now caches resolved sessions and
 * role permissions for five minutes. Every function below that changes a
 * user calls bumpAuthCacheGeneration_(), which orphans every cached entry
 * at once - so deactivating someone, changing their role or resetting
 * their password takes effect on their very next request rather than
 * whenever the cache happens to expire.
 *
 * Role-permission controlled CRUD for the Users sheet. Every function here starts with
 * requireAdmin_(token) — the client-side nav hiding in javascript.html
 * is a UX nicety only, this is the real gate. Passwords are never
 * returned to the client in any function here (getUsersBootstrap strips
 * them out explicitly rather than passing the raw sheet row through).
 *
 * Business rules (spec: "Delete User subject to business rules"):
 *  - You can't delete your own account while logged in as it.
 *  - The last remaining Active Administrator can't be deleted,
 *    deactivated, or demoted to another role — the system must always
 *    have at least one way in.
 * ---------------------------------------------------------------------
 */

function getUsersBootstrap(token) {
  try {
    requirePermission_(token, 'users', 'view');
    const users = getAllRows_('USERS').map(function (u) {
      return {
        id: u['User ID'], name: u['Full Name'], mobile: u['Mobile Number'], role: u['Role'],
        status: u['Status'], createdBy: u['Created By'], createdAt: u['Created At'], lastLogin: u['Last Login']
      };
    });
    const roles = getAllRows_('ROLES').filter(function (r) { return r['Status'] !== 'Inactive'; })
      .map(function (r) { return { name: r['Role Name'] }; });
    return ok_({ users: users, roles: roles });
  } catch (err) {
    logError_('getUsersBootstrap', err);
    return fail_(err.message);
  }
}

/** payload = { name, mobile, role, password } */
function createUser(token, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    const actor = requirePermission_(token, 'users', 'add');
    const name = sanitizeInput_(payload.name);
    const mobile = normalizePhoneDisplay_(payload.mobile);
    const role = sanitizeInput_(payload.role);
    const password = String(payload.password || '');

    if (!name) return fail_('Full name is required.');
    if (!mobile) return fail_('Mobile number is required.');
    if (!role) return fail_('Choose a role.');
    if (role === 'Administrator' && actor['Role'] !== 'Administrator') return fail_('Only an Administrator can assign the Administrator role.');
    if (password.length < 8) return fail_('Password must be at least 8 characters.');
    if (role !== 'Administrator') {
      const roleRow = getAllRows_('ROLES').filter(function (r) { return r['Role Name'] === role; })[0];
      if (!roleRow || roleRow['Status'] !== 'Active') return fail_('Choose an active role.');
    }

    const duplicate = getAllRows_('USERS').some(function (u) { return phoneNumbersEqual_(u['Mobile Number'], mobile); });
    if (duplicate) return fail_('A user with this mobile number already exists.');

    const hashed = hashPassword_(password);
    const id = generateId_('USERS');
    appendRow_('USERS', {
      'User ID': id, 'Full Name': name, 'Mobile Number': mobile,
      'Password Hash': hashed.hash, 'Password Salt': hashed.salt,
      'Role': role, 'Status': 'Active', 'Created By': actor['Full Name'] || actor['Mobile Number'],
      'Created At': new Date(), 'Last Login': ''
    });
    return ok_({ id: id });
  } catch (err) {
    logError_('createUser', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

/** payload = { name, mobile, role } — password is changed only via resetPassword(). */
function updateUser(token, userId, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    requirePermission_(token, 'users', 'edit');
    const rowIndex = findRowIndex_('USERS', 'User ID', userId);
    if (rowIndex === -1) return fail_('User not found.');
    const existing = getAllRows_('USERS').filter(function (u) { return u['User ID'] === userId; })[0];

    const name = sanitizeInput_(payload.name);
    const mobile = normalizePhoneDisplay_(payload.mobile);
    const role = sanitizeInput_(payload.role);
    if (!name) return fail_('Full name is required.');
    if (!mobile) return fail_('Mobile number is required.');
    if (!role) return fail_('Choose a role.');
    if (role === 'Administrator' && existing['Role'] !== 'Administrator' && getSessionUser_(token)['Role'] !== 'Administrator') return fail_('Only an Administrator can assign the Administrator role.');
    if (role !== 'Administrator') {
      const roleRow = getAllRows_('ROLES').filter(function (r) { return r['Role Name'] === role; })[0];
      if (!roleRow || roleRow['Status'] !== 'Active') return fail_('Choose an active role.');
    }

    const duplicate = getAllRows_('USERS').some(function (u) { return u['User ID'] !== userId && phoneNumbersEqual_(u['Mobile Number'], mobile); });
    if (duplicate) return fail_('A user with this mobile number already exists.');

    if (existing['Role'] === 'Administrator' && role !== 'Administrator' && countActiveAdmins_() <= 1) {
      return fail_('At least one active Administrator account must remain \u2014 make someone else an Administrator before changing this one\u2019s role.');
    }

    updateRowFields_('USERS', rowIndex, { 'Full Name': name, 'Mobile Number': mobile, 'Role': role });
    bumpAuthCacheGeneration_();   // the role may have changed
    return ok_({ id: userId });
  } catch (err) {
    logError_('updateUser', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

/** Admin sets a new password directly (there's no forgot-password flow — by design, per spec). */
function resetPassword(token, userId, newPassword) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    const actor = requirePermission_(token, 'users', 'edit');
    const rowIndex = findRowIndex_('USERS', 'User ID', userId);
    if (rowIndex === -1) return fail_('User not found.');
    const existing = findFirstRow_('USERS', 'User ID', userId);
    if (existing['Role'] === 'Administrator' && actor['Role'] !== 'Administrator') {
      return fail_('Only an Administrator can reset an Administrator password.');
    }

    const pass = String(newPassword || '');
    if (pass.length < 8) return fail_('Password must be at least 8 characters.');

    const hashed = hashPassword_(pass);
    updateRowFields_('USERS', rowIndex, { 'Password Hash': hashed.hash, 'Password Salt': hashed.salt });

    revokeUserSessions_(userId); // force re-login everywhere with the new password
    bumpAuthCacheGeneration_();
    return ok_({ id: userId });
  } catch (err) {
    logError_('resetPassword', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

function setUserStatus(token, userId, status) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    requirePermission_(token, 'users', 'edit');
    const rowIndex = findRowIndex_('USERS', 'User ID', userId);
    if (rowIndex === -1) return fail_('User not found.');
    const existing = getAllRows_('USERS').filter(function (u) { return u['User ID'] === userId; })[0];
    const next = status === 'Active' ? 'Active' : 'Inactive';

    if (next === 'Inactive' && existing['Role'] === 'Administrator' && countActiveAdmins_() <= 1) {
      return fail_('At least one active Administrator account must remain.');
    }

    updateRowFields_('USERS', rowIndex, { 'Status': next });
    if (next === 'Inactive') revokeUserSessions_(userId);
    bumpAuthCacheGeneration_();   // a deactivated user must be locked out now
    return ok_({ id: userId, status: next });
  } catch (err) {
    logError_('setUserStatus', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

function deleteUser(token, userId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    const actor = requireManagementDeletePermission_(token, 'users');
    if (actor['User ID'] === userId) return fail_('You cannot delete your own account while logged in.');

    const rowIndex = findRowIndex_('USERS', 'User ID', userId);
    if (rowIndex === -1) return fail_('User not found.');
    const existing = getAllRows_('USERS').filter(function (u) { return u['User ID'] === userId; })[0];

    if (existing['Role'] === 'Administrator' && countActiveAdmins_() <= 1) {
      return fail_('At least one active Administrator account must remain and cannot be deleted.');
    }

    deleteRow_('USERS', rowIndex);
    revokeUserSessions_(userId);
    bumpAuthCacheGeneration_();
    return ok_({ id: userId });
  } catch (err) {
    logError_('deleteUser', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

/** Deletes every live session row for a user — used after a password reset, deactivation, or deletion. */
function revokeUserSessions_(userId) {
  getAllRows_('SESSIONS').filter(function (s) { return s['User ID'] === userId; }).forEach(function (s) {
    const ri = findRowIndex_('SESSIONS', 'Token', s['Token']);
    if (ri !== -1) deleteRow_('SESSIONS', ri);
  });
}

/**
 * ---------------------------------------------------------------------
 * First-run bootstrap — creates the one Administrator that createUser()
 * cannot, because createUser() requires an Administrator to already be
 * logged in.
 *
 * Run it from the Google Sheet: "Hardware ERP" menu -> "Create First
 * Administrator". It is deliberately NOT usable from the web app: the
 * SpreadsheetApp.getUi() call on the first line throws outside the
 * Sheets UI, which is the same accidental-but-effective guard that
 * protects setupSystem() and clearAllData(). It also refuses outright
 * once any Administrator exists, so it can't be used to mint a second
 * back-door account later.
 * ---------------------------------------------------------------------
 */
function createFirstAdmin_() {
  const ui = SpreadsheetApp.getUi();
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    if (countActiveAdmins_() > 0) {
      ui.alert(
        'Already set up',
        'An active Administrator account already exists. Use the Users page inside the app to add more people.',
        ui.ButtonSet.OK
      );
      return fail_('An Administrator already exists.');
    }

    const nameResp = ui.prompt('Create first Administrator (1 of 3)', 'Full name:', ui.ButtonSet.OK_CANCEL);
    if (nameResp.getSelectedButton() !== ui.Button.OK) return fail_('Cancelled');
    const name = sanitizeInput_(nameResp.getResponseText());
    if (!name) { ui.alert('Full name is required.'); return fail_('Full name is required.'); }

    const mobileResp = ui.prompt('Create first Administrator (2 of 3)', 'Mobile number (this is the login ID):', ui.ButtonSet.OK_CANCEL);
    if (mobileResp.getSelectedButton() !== ui.Button.OK) return fail_('Cancelled');
    const mobile = normalizePhoneDisplay_(mobileResp.getResponseText());
    if (!mobile) { ui.alert('Mobile number is required.'); return fail_('Mobile number is required.'); }

    const passResp = ui.prompt('Create first Administrator (3 of 3)', 'Password (at least 8 characters):', ui.ButtonSet.OK_CANCEL);
    if (passResp.getSelectedButton() !== ui.Button.OK) return fail_('Cancelled');
    const password = String(passResp.getResponseText() || '');
    if (password.length < 8) { ui.alert('Password must be at least 8 characters.'); return fail_('Password too short.'); }

    const duplicate = getAllRows_('USERS').some(function (u) {
      return phoneNumbersEqual_(u['Mobile Number'], mobile);
    });
    if (duplicate) { ui.alert('A user with this mobile number already exists.'); return fail_('Duplicate mobile number.'); }

    const hashed = hashPassword_(password);
    const id = generateId_('USERS');
    appendRow_('USERS', {
      'User ID': id,
      'Full Name': name,
      'Mobile Number': mobile,
      'Password Hash': hashed.hash,
      'Password Salt': hashed.salt,
      'Role': 'Administrator',
      'Status': 'Active',
      'Created By': 'First-run bootstrap',
      'Created At': new Date(),
      'Last Login': ''
    });

    SpreadsheetApp.flush();
    ui.alert(
      'Administrator created',
      'Open the web app and sign in with mobile "' + mobile + '" and the password you just set.\n\n' +
      'Change that password from the Users page once you are in.',
      ui.ButtonSet.OK
    );
    return ok_({ id: id });
  } catch (err) {
    logError_('createFirstAdmin', err);
    SpreadsheetApp.getUi().alert('Something went wrong: ' + err.message);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}
