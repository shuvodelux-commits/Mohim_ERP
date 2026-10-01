/**
 * RoleManagement.gs
 * ---------------------------------------------------------------------
 * PERFORMANCE (review item 7): Auth.gs caches each role's parsed
 * permissions for five minutes, keyed by role name. Every function below
 * that changes a role calls bumpAuthCacheGeneration_(), so new rules apply
 * on the next request rather than after the cache expires.
 * ---------------------------------------------------------------------
 */

/**
 * The modules shown on the Roles page's permission grid.
 *
 * This used to be derived from NAV_ITEMS by excluding a few keys. That
 * broke as soon as a page moved: Returns is now a tab under Sales rather
 * than a sidebar entry, and filtering the sidebar would have silently
 * dropped 'returns' from the grid — revoking refund rights from every
 * non-admin role without anyone touching a permission.
 *
 * PERMISSION_MODULES in UI.gs is now the explicit source of truth, kept
 * deliberately separate from what the sidebar happens to show.
 */
function getAssignableModules_() {
  return PERMISSION_MODULES;
}

function getRolesBootstrap(token) {
  try {
    requirePermission_(token, 'roles', 'view');
    const roles = getAllRows_("ROLES");
    const moduleOptions = getAssignableModules_().map(function (n) {
      return { key: n.key, label: n.label, permissionMode: n.permissionMode || '' };
    });
    return ok_({
      roles: roles,
      moduleOptions: moduleOptions,
      deleteWindowOptions: DELETE_WINDOW_OPTIONS,
    });
  } catch (err) {
    logError_("getRolesBootstrap", err);
    return fail_(err.message);
  }
}



/** Filters/sanitizes a client-submitted { moduleKey: {view,add,edit,delete} } map down to only real modules and safe values — never trust it blindly. */
function sanitizePermissions_(rawPermissions) {
  const modules = getAssignableModules_();
  const validKeys = modules.map(function (n) {
    return n.key;
  });
  const moduleByKey = {};
  modules.forEach(function (n) { moduleByKey[n.key] = n; });
  const windowKeys = DELETE_WINDOW_OPTIONS.map(function (o) {
    return o.key;
  });
  const out = {};
  if (!rawPermissions || typeof rawPermissions !== "object") return out;
  validKeys.forEach(function (key) {
    const p = rawPermissions[key];
    if (!p) return;
    const moduleMeta = moduleByKey[key] || {};
    if (moduleMeta.permissionMode === 'editOnly') {
      if (p.edit) out[key] = { view: false, add: false, edit: true, delete: 'disabled', backdate: 'unlimited' };
      return;
    }
    const isManagementModule = key === 'users' || key === 'roles';
    const deleteValue = isManagementModule
      ? (p.delete === true || p.delete === 'unlimited')
      : (windowKeys.indexOf(p.delete) !== -1 ? p.delete : 'disabled');
    const entry = {
      view: !!p.view,
      add: !!p.add,
      edit: !!p.edit,
      delete: deleteValue,
      // Backdate defaults OPEN ('unlimited'), not closed like delete — see
      // Auth.gs's requireBackdatePermission_ comment for why.
      backdate: windowKeys.indexOf(p.backdate) !== -1 ? p.backdate : "unlimited",
    };
    if (entry.view || entry.add || entry.edit || (isManagementModule ? entry.delete === true : entry.delete !== 'disabled'))
      out[key] = entry;
  });
  return out;
}

/** payload = { name, permissions: { moduleKey: {view,add,edit,delete} } } */
function addRole(token, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    requirePermission_(token, 'roles', 'add');
    const name = sanitizeInput_(payload.name);
    if (!name) return fail_("Role name is required.");
    if (name.toLowerCase() === "administrator")
      return fail_(
        '"Administrator" is a built-in role and can\u2019t be created here.',
      );

    const duplicate = getAllRows_("ROLES").some(function (r) {
      return String(r["Role Name"]).toLowerCase() === name.toLowerCase();
    });
    if (duplicate) return fail_("A role with this name already exists.");

    const permissions = sanitizePermissions_(payload.permissions);
    const allowedModules = Object.keys(permissions).filter(function (k) {
      return permissions[k].view;
    });

    const id = generateId_("ROLES");
    appendRow_("ROLES", {
      "Role ID": id,
      "Role Name": name,
      "Allowed Modules": allowedModules.join(","),
      Permissions: JSON.stringify(permissions),
      Status: "Active",
      "Created At": new Date(),
    });
    return ok_({ id: id });
  } catch (err) {
    logError_("addRole", err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

function updateRole(token, roleId, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    requirePermission_(token, 'roles', 'edit');
    const rowIndex = findRowIndex_("ROLES", "Role ID", roleId);
    if (rowIndex === -1) return fail_("Role not found.");

    const name = sanitizeInput_(payload.name);
    if (!name) return fail_("Role name is required.");
    if (name.toLowerCase() === "administrator")
      return fail_(
        '"Administrator" is a built-in role and can\u2019t be renamed to that.',
      );

    const duplicate = getAllRows_("ROLES").some(function (r) {
      return (
        r["Role ID"] !== roleId &&
        String(r["Role Name"]).toLowerCase() === name.toLowerCase()
      );
    });
    if (duplicate) return fail_("A role with this name already exists.");

    const existing = getAllRows_("ROLES").filter(function (r) {
      return r["Role ID"] === roleId;
    })[0];
    const oldName = existing["Role Name"];
    const permissions = sanitizePermissions_(payload.permissions);
    const allowedModules = Object.keys(permissions).filter(function (k) {
      return permissions[k].view;
    });

    updateRowFields_("ROLES", rowIndex, {
      "Role Name": name,
      "Allowed Modules": allowedModules.join(","),
      Permissions: JSON.stringify(permissions),
    });

    if (oldName !== name) {
      getAllRows_("USERS")
        .filter(function (u) {
          return u["Role"] === oldName;
        })
        .forEach(function (u) {
          updateRowFields_(
            "USERS",
            findRowIndex_("USERS", "User ID", u["User ID"]),
            { Role: name },
          );
        });
    }

    bumpAuthCacheGeneration_();   // permissions changed
    return ok_({ id: roleId });
  } catch (err) {
    logError_("updateRole", err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

function setRoleStatus(token, roleId, status) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    requirePermission_(token, 'roles', 'edit');
    const role = getAllRows_("ROLES").filter(function (r) { return r["Role ID"] === roleId; })[0];
    if (!role) return fail_("Role not found.");
    const next = status === "Active" ? "Active" : "Inactive";

    updateRowFields_("ROLES", role._rowIndex, { Status: next });

    if (next === "Inactive") {
      getAllRows_("USERS").filter(function (u) {
        return u["Role"] === role["Role Name"] && u["Status"] === "Active";
      }).forEach(function (u) {
        revokeUserSessions_(u["User ID"]);
      });
    }

    bumpAuthCacheGeneration_();
    return ok_({ id: roleId, status: next });
  } catch (err) {
    logError_("setRoleStatus", err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

function deleteRole(token, roleId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    requireManagementDeletePermission_(token, 'roles');
    const role = getAllRows_("ROLES").filter(function (r) { return r["Role ID"] === roleId; })[0];
    if (!role) return fail_("Role not found.");

    const inUse = getAllRows_("USERS").some(function (u) { return u["Role"] === role["Role Name"]; });
    if (inUse) return fail_("This role is assigned to one or more users and can\u2019t be deleted. Deactivate it instead, or reassign those users first.");

    deleteRow_("ROLES", findRowIndex_("ROLES", "Role ID", roleId));
    bumpAuthCacheGeneration_();
    return ok_({ id: roleId });
  } catch (err) {
    logError_("deleteRole", err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}
