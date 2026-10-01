/**
 * Auth.gs
 * ---------------------------------------------------------------------
 * Login, logout, session validation, and password hashing for the whole
 * app. Every protected server function checks "who is calling this, and
 * are they allowed to" by calling requireAuth_()/requireAdmin_() here
 * rather than reinventing its own check.
 *
 * Sessions are opaque random tokens stored in the SESSIONS sheet (not
 * JWTs — nothing here needs to be verified offline, and a sheet row is
 * trivially revocable, which a signed token isn't without a blocklist
 * anyway). The client persists its token in localStorage so a page
 * reload doesn't force a fresh login; every protected server call still
 * re-validates the token against the sheet on every single request — the
 * client never holds trust on its own, it just carries a receipt.
 *
 * PERFORMANCE (review item 7): every permission-checked request used to
 * cost THREE full sheet reads before doing any work — SESSIONS and USERS
 * in getSessionUser_, then ROLES in getUserPermissions_. Both are now
 * cached in CacheService for five minutes.
 *
 * Invalidation is a generation counter rather than key tracking: every
 * cache key embeds a number held in Script Properties, and anything that
 * changes a user or a role bumps it, which makes every existing entry
 * unreachable at once. Blunt, but user and role edits are rare and it is
 * impossible to miss a key this way.
 *
 * Session expiry is NOT left to the cache TTL — the cached entry carries
 * its own Expires At and that is re-checked on every hit, so a five-minute
 * cache can never extend a session past its real end.
 *
 * MERGED FINAL VERSION. Also: verifyPassword_ now compares
 * in constant time via timingSafeEquals_ below. Everything else in this
 * file - login, sessions, permissions, delete windows, backdate windows -
 * is byte-identical to the original.
 *
 * Passwords are hashed with salted SHA-256 (Utilities.computeDigest) —
 * Apps Script has no bcrypt/scrypt built in and no npm access. This is a
 * deliberate, scoped trade-off for a small internal-staff ERP, not a
 * public-facing consumer site; flagged the same way other scope calls
 * are flagged in context.md.
 * ---------------------------------------------------------------------
 */

const SESSION_DURATION_MS = 12 * 60 * 60 * 1000; // 12 hours (fallback if Settings has no valid override)

/** How long a resolved session/permission lookup may be reused. */
const AUTH_CACHE_SECONDS = 300;

/**
 * Cache keys embed this number. Bumping it orphans every entry at once,
 * which is how a user or role change takes effect immediately without
 * having to remember which keys exist.
 */
function authCacheGeneration_() {
  try {
    return PropertiesService.getScriptProperties().getProperty('AUTH_CACHE_GEN') || '1';
  } catch (e) {
    return '1';
  }
}

/** Call after ANY change to a user or a role. Cheap, and safe to over-call. */
function bumpAuthCacheGeneration_() {
  try {
    const props = PropertiesService.getScriptProperties();
    const next = Number(props.getProperty('AUTH_CACHE_GEN') || '1') + 1;
    props.setProperty('AUTH_CACHE_GEN', String(next));
  } catch (e) {
    // Losing a bump would serve stale permissions for up to five minutes,
    // which is bad but not worth failing the whole request over.
    logError_('bumpAuthCacheGeneration_', e);
  }
}

function authCacheGet_(key) {
  try {
    const raw = CacheService.getScriptCache().get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;   // cache unavailable — fall through to the sheets
  }
}

function authCachePut_(key, value) {
  try {
    CacheService.getScriptCache().put(key, JSON.stringify(value), AUTH_CACHE_SECONDS);
  } catch (e) {
    // Never let a caching problem break a request.
  }
}

function sessionCacheKey_(token) {
  // Hashed so a raw session token is never itself a cache key.
  return 'auth' + authCacheGeneration_() + ':u:' + sha256Hex_(token).slice(0, 32);
}

function forgetSessionCache_(token) {
  try { CacheService.getScriptCache().remove(sessionCacheKey_(token)); } catch (e) {}
}

/** Session length in ms, from Settings ('Session Timeout Hours') when set, else the 12-hour fallback above. */
function getSessionDurationMs_() {
  const hours = Number(getSettingsMap_()["Session Timeout Hours"]);
  if (!hours || hours <= 0) return SESSION_DURATION_MS;
  return hours * 60 * 60 * 1000;
}

// ---------------- Password hashing ----------------

function hashPassword_(password) {
  const salt = Utilities.getUuid();
  return { hash: sha256Hex_(password + salt), salt: salt };
}

function verifyPassword_(password, hash, salt) {
  return timingSafeEquals_(sha256Hex_(password + salt), hash);
}

/**
 * Constant-time string compare. `===` on a hash short-circuits at the
 * first differing character, so response time leaks how much of a guess
 * was correct. Low risk behind a login form on an internal ERP, but the
 * fix is four lines. Both arguments here are fixed-length SHA-256 hex,
 * so the length check leaks nothing.
 */
function timingSafeEquals_(a, b) {
  const sa = String(a === null || a === undefined ? "" : a);
  const sb = String(b === null || b === undefined ? "" : b);
  if (sa.length !== sb.length) return false;
  let diff = 0;
  for (let i = 0; i < sa.length; i++) {
    diff |= sa.charCodeAt(i) ^ sb.charCodeAt(i);
  }
  return diff === 0;
}

function sha256Hex_(text) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    text,
    Utilities.Charset.UTF_8,
  );
  return bytes
    .map(function (b) {
      const v = (b < 0 ? b + 256 : b).toString(16);
      return v.length === 1 ? "0" + v : v;
    })
    .join("");
}

function generateToken_() {
  return (
    Utilities.getUuid().replace(/-/g, "") +
    Utilities.getUuid().replace(/-/g, "")
  );
}

// ---------------- Login throttling ----------------
// Cache-backed on purpose: it avoids unbounded persistent ScriptProperties
// growth from random mobile-number guesses. The login function holds the
// script lock while reading/updating this state, so concurrent failures for
// the same number cannot race past the threshold.
const LOGIN_FAILURE_LIMIT_ = 5;
const LOGIN_LOCKOUT_MS_ = 15 * 60 * 1000;
const LOGIN_THROTTLE_CACHE_SECONDS_ = 60 * 60;

function loginThrottleKey_(mobile) {
  return "auth:login-fail:" + sha256Hex_(normalizePhoneSearch_(mobile) || String(mobile || "")).slice(0, 32);
}

function readLoginThrottle_(mobile) {
  try {
    const raw = CacheService.getScriptCache().get(loginThrottleKey_(mobile));
    if (!raw) return { count: 0, lockedUntil: 0 };
    const parsed = JSON.parse(raw);
    return {
      count: Number(parsed.count) || 0,
      lockedUntil: Number(parsed.lockedUntil) || 0,
    };
  } catch (e) {
    return { count: 0, lockedUntil: 0 };
  }
}

function checkLoginThrottle_(mobile) {
  const state = readLoginThrottle_(mobile);
  if (state.lockedUntil > Date.now()) {
    return { blocked: true, lockedUntil: state.lockedUntil };
  }
  if (state.lockedUntil) clearLoginFailures_(mobile);
  return { blocked: false, lockedUntil: 0 };
}

function recordLoginFailure_(mobile) {
  const state = readLoginThrottle_(mobile);
  const count = state.count + 1;
  const lockedUntil = count >= LOGIN_FAILURE_LIMIT_
    ? Date.now() + LOGIN_LOCKOUT_MS_
    : 0;
  try {
    CacheService.getScriptCache().put(
      loginThrottleKey_(mobile),
      JSON.stringify({ count: count, lockedUntil: lockedUntil }),
      LOGIN_THROTTLE_CACHE_SECONDS_,
    );
  } catch (e) {}
  return { count: count, lockedUntil: lockedUntil };
}

function clearLoginFailures_(mobile) {
  try { CacheService.getScriptCache().remove(loginThrottleKey_(mobile)); } catch (e) {}
}

// ---------------- Login / logout ----------------

/** The only two fields the Login page collects. */
function login(mobile, password) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    const mobileClean = normalizePhoneDisplay_(mobile);
    const pass = String(password || "");
    if (!mobileClean || !pass)
      return fail_("Enter your mobile number and password.");

    const throttle = checkLoginThrottle_(mobileClean);
    if (throttle.blocked) {
      return fail_("Too many failed login attempts. Try again in a few minutes.");
    }

    const user = getAllRows_("USERS").filter(function (u) {
      return phoneNumbersEqual_(u["Mobile Number"], mobileClean);
    })[0];
    if (
      !user ||
      !verifyPassword_(pass, user["Password Hash"], user["Password Salt"])
    ) {
      recordLoginFailure_(mobileClean);
      return fail_("Invalid mobile number or password.");
    }
    if (user["Status"] !== "Active") {
      recordLoginFailure_(mobileClean);
      return fail_(
        "Your account is inactive. Please contact the administrator.",
      );
    }
    if (user["Role"] !== "Administrator") {
      const activeRole = getAllRows_("ROLES").filter(function (r) {
        return r["Role Name"] === user["Role"] && r["Status"] === "Active";
      })[0];
      if (!activeRole) {
        recordLoginFailure_(mobileClean);
        return fail_("Your role is inactive. Please contact the administrator.");
      }
    }

    clearLoginFailures_(mobileClean);
    const token = generateToken_();
    const now = new Date();
    appendRow_("SESSIONS", {
      Token: token,
      "User ID": user["User ID"],
      "Mobile Number": user["Mobile Number"],
      "Created At": now,
      "Expires At": new Date(now.getTime() + getSessionDurationMs_()),
      "Last Activity": now,
    });
    updateRowFields_(
      "USERS",
      findRowIndex_("USERS", "User ID", user["User ID"]),
      { "Last Login": now },
    );

    return ok_(buildAuthPayload_(user, token));
  } catch (err) {
    logError_("login", err);
    return fail_("Login failed. Please try again.");
  } finally {
    lock.releaseLock();
  }
}

function logout(token) {
  try {
    forgetSessionCache_(sanitizeInput_(token));
    const rowIndex = findRowIndex_("SESSIONS", "Token", sanitizeInput_(token));
    if (rowIndex !== -1) deleteRow_("SESSIONS", rowIndex);
    return ok_("logged out");
  } catch (err) {
    logError_("logout", err);
    return fail_(err.message);
  }
}

/** Called on every page load to silently restore a session from a stored token. */
function validateSession(token) {
  try {
    const user = getSessionUser_(token);
    const rowIndex = findRowIndex_("SESSIONS", "Token", sanitizeInput_(token));
    if (rowIndex !== -1)
      updateRowFields_("SESSIONS", rowIndex, { "Last Activity": new Date() });
    return ok_(buildAuthPayload_(user, token));
  } catch (err) {
    return fail_(err.message);
  }
}

function buildAuthPayload_(user, token) {
  let allowedModules = null; // null = Administrator = full access
  let permissions = null;
  if (user["Role"] !== "Administrator") {
    const role = getAllRows_("ROLES").filter(function (r) {
      return r["Role Name"] === user["Role"] && r["Status"] === "Active";
    })[0];
    if (!role) {
      throw new Error("Your role is inactive. Please contact the administrator.");
    }
    permissions = parseRolePermissions_(role);
    allowedModules = role
      ? String(role["Allowed Modules"] || "")
          .split(",")
          .map(function (s) {
            return s.trim();
          })
          .filter(Boolean)
      : [];
  }
  return {
    token: token,
    user: {
      id: user["User ID"],
      name: user["Full Name"],
      mobile: user["Mobile Number"],
      role: user["Role"],
    },
    allowedModules: allowedModules,
    permissions: permissions,
  };
}

// ---------------- Internal guards — every protected server function calls one of these first ----------------

/** Throws instead of returning a falsy value, so callers can just call this and keep going. */
function getSessionUser_(token) {
  const t = sanitizeInput_(token);
  if (!t) throw new Error("Not logged in. Please sign in again.");

  // Fast path: skip the SESSIONS and USERS reads entirely. Expiry is still
  // enforced from the cached value, so this can't keep a dead session alive.
  const cacheKey = sessionCacheKey_(t);
  const cached = authCacheGet_(cacheKey);
  if (cached) {
    if (!(new Date(cached.expiresAt).getTime() > Date.now())) {
      throw new Error("Session expired. Please sign in again.");
    }
    return cached.user;
  }

  const session = getAllRows_("SESSIONS").filter(function (s) {
    return s["Token"] === t;
  })[0];
  if (!session) throw new Error("Session expired. Please sign in again.");
  if (!(new Date(session["Expires At"]).getTime() > Date.now())) {
    throw new Error("Session expired. Please sign in again.");
  }
  const user = getAllRows_("USERS").filter(function (u) {
    return u["User ID"] === session["User ID"];
  })[0];
  if (!user || user["Status"] !== "Active") {
    throw new Error(
      "Your account is inactive. Please contact the administrator.",
    );
  }

  // _rowIndex is an internal bookkeeping field and would go stale as rows
  // move, so it is stripped rather than cached.
  const cacheable = {};
  Object.keys(user).forEach(function (k) { if (k !== "_rowIndex") cacheable[k] = user[k]; });
  authCachePut_(cacheKey, { user: cacheable, expiresAt: session["Expires At"] });

  return user;
}

function requireAuth_(token) {
  return getSessionUser_(token);
}

function requireAdmin_(token) {
  const user = getSessionUser_(token);
  if (user["Role"] !== "Administrator")
    throw new Error("Only the Administrator can perform this action.");
  return user;
}

function countActiveAdmins_() {
  return getAllRows_("USERS").filter(function (u) {
    return u["Role"] === "Administrator" && u["Status"] === "Active";
  }).length;
}
/**
 * ---------------------------------------------------------------------
 * Permission system (Phase 1 extension — Roles & Permissions)
 * ---------------------------------------------------------------------
 * A role's 'Permissions' column (Config.gs -> HEADERS.ROLES) stores a
 * JSON object keyed by NAV_ITEMS module key:
 *   { view: bool, add: bool, edit: bool, delete: <windowCode> }
 * windowCode is one of DELETE_WINDOW_OPTIONS' keys below — carrying the
 * allowed delete window, not just a yes/no, per spec §2.
 *
 * Administrator never reads this JSON — the existing user.Role check
 * already gives it unrestricted access everywhere. A missing module key
 * or unparseable JSON defaults to NO access, never silently full access.
 *
 * DELIBERATELY NOT DONE YET (next phase, flagged the same way Session 7
 * flagged its own "step 8"): no existing business function
 * (completeSale, deleteCustomer, addProduct, receivePayment, etc.) calls
 * requirePermission_/requireDeletePermission_ yet. This phase only adds
 * the checking machinery + the Role Management UI to configure it, so
 * the next phase can wire it in module-by-module without redesigning
 * this part again.
 * ---------------------------------------------------------------------
 */

const DELETE_WINDOW_OPTIONS = [
  { key: "disabled", label: "Disabled" },
  { key: "same", label: "Same Day" },
  { key: "1", label: "1 Day" },
  { key: "3", label: "3 Days" },
  { key: "7", label: "7 Days" },
  { key: "15", label: "15 Days" },
  { key: "30", label: "30 Days" },
  { key: "unlimited", label: "Unlimited" },
];

function parseRolePermissions_(roleRow) {
  if (!roleRow) return {};
  try {
    const parsed = JSON.parse(roleRow["Permissions"] || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    return {};
  }
}

/** null = unrestricted (Administrator). Otherwise the parsed per-module permission map for the user's role. */
function getUserPermissions_(user) {
  if (user["Role"] === "Administrator") return null;

  // Cached per ROLE, not per user — everyone sharing a role shares the entry.
  const cacheKey = "auth" + authCacheGeneration_() + ":p:" + sha256Hex_(String(user["Role"]));
  const cached = authCacheGet_(cacheKey);
  if (cached) return cached;

  const role = getAllRows_("ROLES").filter(function (r) {
    return r["Role Name"] === user["Role"] && r["Status"] === "Active";
  })[0];
  const permissions = parseRolePermissions_(role);
  authCachePut_(cacheKey, permissions);
  return permissions;
}

/** True if the user may perform 'view'|'add'|'edit' on a module. Administrator always true. */
function hasPermission_(user, moduleKey, action) {
  if (user["Role"] === "Administrator") return true;
  const perms = getUserPermissions_(user) || {};
  const modPerm = perms[moduleKey];
  if (!modPerm) return false;
  return !!modPerm[action];
}

/** Throws unless the session user may perform 'view'|'add'|'edit' on a module. Returns the user on success. */
function requirePermission_(token, moduleKey, action) {
  const user = getSessionUser_(token);
  if (!hasPermission_(user, moduleKey, action)) {
    throw new Error(
      "You do not have permission to " + action + " " + moduleKey + ".",
    );
  }
  return user;
}

/** Whole days between a record's date and today (0 = today). Unparseable dates are treated as far out of any window. */
function daysSinceRecordDate_(recordDateStr) {
  const recordDate = new Date(safeDateOnly_(recordDateStr) + "T00:00:00");
  const today = new Date(formatDate_(new Date()) + "T00:00:00");
  const diffMs = today.getTime() - recordDate.getTime();
  if (isNaN(diffMs)) return Infinity;
  return Math.round(diffMs / 86400000);
}

/** True if a delete-window code permits acting on a record dated recordDateStr today. */
function isWithinDeleteWindow_(windowCode, recordDateStr) {
  if (!windowCode || windowCode === "disabled") return false;
  if (windowCode === "unlimited") return true;
  const days = daysSinceRecordDate_(recordDateStr);
  if (windowCode === "same") return days === 0;
  const n = Number(windowCode);
  return !isNaN(n) && days >= 0 && days <= n;
}

/** Throws unless the session user may delete a record dated recordDateStr in this module. Returns the user on success. */
function requireDeletePermission_(token, moduleKey, recordDateStr) {
  const user = getSessionUser_(token);
  if (user["Role"] === "Administrator") return user;
  const perms = getUserPermissions_(user) || {};
  const modPerm = perms[moduleKey];
  const windowCode = modPerm ? modPerm.delete : "disabled";
  if (!isWithinDeleteWindow_(windowCode, recordDateStr)) {
    throw new Error(
      "You do not have permission to delete this record (outside the allowed " +
        moduleKey +
        " delete window, or delete is disabled for your role).",
    );
  }
  return user;
}

/** Management resources such as Users and Roles use a simple delete grant rather than a date window. */
function requireManagementDeletePermission_(token, moduleKey) {
  const user = getSessionUser_(token);
  if (user['Role'] === 'Administrator') return user;
  const perms = getUserPermissions_(user) || {};
  const p = perms[moduleKey];
  const allowed = !!(p && (p.delete === true || p.delete === 'unlimited'));
  if (!allowed) throw new Error('You do not have permission to delete ' + moduleKey + '.');
  return user;
}

/**
 * Writes one row to the Delete Log — call from every real delete or
 * soft-delete once a module is wired to the permission system (next
 * phase). Never a substitute for the delete itself.
 */
function logDeletion_(moduleKey, recordId, invoiceNo, reason, user) {
  const now = new Date();
  appendRow_("DELETE_LOG", {
    "Log ID": generateId_("DELETE_LOG"),
    Date: formatDate_(now),
    Time: Utilities.formatDate(now, Session.getScriptTimeZone(), "HH:mm:ss"),
    Module: moduleKey,
    "Record ID": recordId,
    "Invoice No": invoiceNo || "",
    Reason: sanitizeInput_(reason),
    "Deleted By": user ? user["Full Name"] || user["Mobile Number"] : "staff",
    "Deleted By Mobile": user ? user["Mobile Number"] : "",
  });
}
/**
 * ---------------------------------------------------------------------
 * Backdate window (Tier 1 of the Transaction Date / Backdated Entry
 * feature). Reuses DELETE_WINDOW_OPTIONS' exact codes for "how many
 * days back is this role allowed to date a NEW entry" — same day-count
 * math as the delete window, different question.
 *
 * Unlike delete (missing/invalid defaults to 'disabled', fail-closed),
 * a role with no 'backdate' key yet defaults to 'unlimited'. Deliberate:
 * Expense.gs has let every role backdate freely, unrestricted, since
 * Session 6. Defaulting an unset backdate key to 'disabled' would
 * silently break that already-relied-upon behavior for every role that
 * hasn't been re-saved on the Roles page yet. Admins can tighten any
 * role's backdate window explicitly once this is live.
 *
 * Callers must only check this when a transaction's Date is actually in
 * the past (computeBackdateInfo_(...).isBackdated) — a same-day entry
 * should never be gated by this, since 'disabled' (like the delete
 * window) blocks unconditionally if checked regardless of date.
 * ---------------------------------------------------------------------
 */

/** { isBackdated, backdatedDays } for a transaction dated dateStr, relative to today. A future date is never "backdated" here — each module separately rejects dates after today. */
function computeBackdateInfo_(dateStr) {
  const days = daysSinceRecordDate_(dateStr);
  return { isBackdated: days > 0, backdatedDays: days > 0 ? days : 0 };
}

/** Same day-window math as isWithinDeleteWindow_, named separately so the two concepts stay distinct at the call site. */
function isWithinBackdateWindow_(windowCode, transactionDateStr) {
  return isWithinDeleteWindow_(windowCode, transactionDateStr);
}

/**
 * Throws unless the session user may create a transaction dated
 * transactionDateStr in this module. Only call this when the date is
 * actually backdated — see note above. Administrator always allowed.
 * Returns the user on success.
 */
function requireBackdatePermission_(token, moduleKey, transactionDateStr) {
  const user = getSessionUser_(token);
  if (user["Role"] === "Administrator") return user;
  const perms = getUserPermissions_(user) || {};
  const modPerm = perms[moduleKey];
  const windowCode = modPerm && modPerm.backdate !== undefined ? modPerm.backdate : "unlimited";
  if (!isWithinBackdateWindow_(windowCode, transactionDateStr)) {
    throw new Error(
      "You do not have permission to date this " + moduleKey + " entry that far back (outside your role's backdate window).",
    );
  }
  return user;
}
