/**
 * Expense.gs
 * ---------------------------------------------------------------------
 * Recording money spent by the shop (rent, salary, utilities, etc).
 * A Cash-paid expense posts a Debit through addCashBookEntry_ (the sole
 * Cash Book writer) — same rule as every other cash-moving feature.
 * Bank and Mobile Banking expenses both post through addBankBookEntry_
 * (isBankLikePaymentMethod_, Utils.gs) — Mobile Banking is just a
 * BANK_ACCOUNTS row with 'Account Type' = 'Mobile Banking', so it's
 * indistinguishable from a bank payment once resolveBankAccount_ has run.
 * 'Other' expenses are recorded on the Expenses row only and never touch
 * either book — deliberately out of scope, matching receivePayment() /
 * paySupplier()'s treatment of that same value.
 * An expense is never hard-deleted: cancelExpense() reverses the Cash
 * Book entry (if any) with a new linked Credit row and marks Status
 * Cancelled — the same "corrections are new linked records, never
 * silent edits" principle used by Sales/Purchase Returns.
 *
 * Every client-reachable function requires an authenticated expense
 * permission. Categories and Payees are maintained as master data. Each
 * expense stores the selected Payee in the existing Ledger ID / Ledger Name
 * columns so Day Book and Expense Ledger can show whose ledger it belongs to.
 *
 * Phase 8 (bank wiring): when Payment Method is Bank-like (Bank or
 * Mobile Banking), addExpense() now requires a bankAccountId and writes
 * through addBankBookEntry_ instead of doing nothing (which was the
 * previous behavior — the field existed before Bank Book did).
 * cancelExpense() reverses through the same book the original entry was
 * written to. 'Other' is untouched — out of scope by design.
 *
 * Review item 10: the client-reachable functions here now require a
 * session token. Apps Script exposes every global function without a
 * trailing underscore to google.script.run, so an ungated one is
 * reachable by anyone holding the web app URL.
 *
 * getExpenseDashboardStats exposed today's and this month's expense
 * totals broken down by category. No client calls it yet, so
 * gating it costs nothing today and closes the hole before something
 * does.
 *
 * Review item 6 / P0 #4: the Cash Book / Bank Book entry this function
 * writes now carries the transaction's own date instead of defaulting to
 * today, so a backdated entry no longer lands on today's cash drawer.
 *
 * Only addExpense() passes a date. updateExpense() and cancelExpense()
 * deliberately keep now(): reversing or amending an expense is something
 * that happens TODAY, and dating those corrections back into a period
 * that has already been reported on would be wrong.
 *
 * P3 drift (items 6 & 7): the backdate preamble is now
 * resolveTransactionDate_() in Utils.gs, and BOTH copies of the
 * bank-account lookup (addExpense and updateExpense had byte-identical
 * blocks) are now resolveBankAccount_().
 *
 * Backdated Entry (Tier 1): addExpense() already accepted an arbitrary
 * past date (Session 6's scoped exception) but never tracked or gated
 * it. Now computes Is Backdated/Backdated Days and requires
 * backdatedReason + a role's backdate-window permission when the date
 * is in the past, same rule as every other module. Deliberately NOT
 * applied to updateExpense() — changing an existing expense's date
 * after creation is Tier 2 (date-edit auditing) territory, out of
 * scope here; its Is Backdated/Backdated Days stay whatever they were
 * set to at creation even if the date is later edited.
 * ---------------------------------------------------------------------
 */

const EXPENSE_PAYMENT_METHODS = ['Cash', 'Bank', 'Mobile Banking', 'Other'];

/** Active Expense Payees shaped locally so Expense reads do not depend on ExpenseSettings.gs. */
function getExpensePayeesForUI_() {
  return activeRows_('EXPENSE_PAYEES')
    .filter(function (p) { return p['Status'] !== 'Inactive'; })
    .map(function (p) { return { id: p['Payee ID'], name: p['Payee Name'], phone: p['Phone'] || '' }; })
    .sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
}

function getExpenseBootstrap(token) {
  try {
    requirePermission_(token, 'expense', 'view');
    const bankAccounts = getActiveBankAccountsForUI_();
    const categories = getAllRows_('EXPENSE_CATEGORIES').filter(function (c) { return c['Status'] !== 'Inactive'; });
    const payees = getExpensePayeesForUI_();
    const settings = getSettingsMap_();

    return ok_({
      categories: categories.map(function (c) { return { id: c['Category ID'], name: c['Category Name'] }; }),
      payees: payees,
      bankAccounts: bankAccounts,
      paymentMethods: EXPENSE_PAYMENT_METHODS,
      currencySymbol: settings['Currency Symbol'] || ''
    });
  } catch (err) {
    logError_('getExpenseBootstrap', err);
    return fail_(err.message);
  }
}

/**
 * payload = {
 *   date, categoryId, payeeId, amount, paymentMethod,
 *   bankAccountId (required when paymentMethod is 'Bank' or 'Mobile Banking'),
 *   description, referenceNo, notes,
 *   backdatedReason (required only when date is in the past)
 * }
 */
function addExpense(token, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    const actingUser = requirePermission_(token, 'expense', 'add');
    requireActiveCashSession_();
    if (!isValidNonNegativeNumber_(payload.amount) || Number(payload.amount) <= 0) return fail_('Enter a valid expense amount.');
    if (!payload.categoryId) return fail_('Choose an expense category.');
    if (!payload.payeeId) return fail_('Choose a payee.');
    const method = EXPENSE_PAYMENT_METHODS.indexOf(payload.paymentMethod) !== -1 ? payload.paymentMethod : '';
    if (!method) return fail_('Choose a valid payment method.');

    const category = getAllRows_('EXPENSE_CATEGORIES').filter(function (c) { return c['Category ID'] === payload.categoryId; })[0];
    if (!category) return fail_('Category not found.');
    const payee = getAllRows_('EXPENSE_PAYEES').filter(function (p) {
      return p['Payee ID'] === sanitizeInput_(payload.payeeId) && !isDeleted_(p) && p['Status'] !== 'Inactive';
    })[0];
    if (!payee) return fail_('Payee not found or inactive.');

    const bankAccount = resolveBankAccount_(method, payload.bankAccountId);
    const bankAccountId = bankAccount.id, bankAccountName = bankAccount.name;

    const amount = Number(payload.amount);
    const txDate = resolveTransactionDate_(token, 'expense', payload.date, payload.backdatedReason, 'Expense');
    const dateStr = txDate.dateStr;

    const id = generateId_('EXPENSES');
    const now = new Date();

    appendRow_('EXPENSES', {
      'Expense ID': id, 'Date': dateStr, 'Category ID': category['Category ID'], 'Category Name': category['Category Name'],
      'Ledger ID': payee['Payee ID'], 'Ledger Name': payee['Payee Name'],
      'Amount': amount, 'Payment Method': method,
      'Description': sanitizeInput_(payload.description), 'Reference No': sanitizeInput_(payload.referenceNo),
      'Notes': sanitizeInput_(payload.notes), 'Status': 'Active',
      'Created By': actorName_(actingUser), 'Created At': now,
      'Bank Account ID': bankAccountId, 'Bank Account Name': bankAccountName,
      'Is Backdated': txDate.isBackdated, 'Backdated Days': txDate.backdatedDays, 'Backdated Reason': txDate.reason
    });

    if (method === 'Cash') {
      addCashBookEntry_({
        Type: 'Expense', Reference: id,
        Description: category['Category Name'] + ' — ' + payee['Payee Name'] + (payload.description ? ' — ' + sanitizeInput_(payload.description) : ''),
        Debit: amount, Credit: '', PaymentMethod: 'Cash', Date: dateStr
      });
    } else if (isBankLikePaymentMethod_(method)) {
      addBankBookEntry_(bankAccountId, {
        Type: 'Expense', Reference: id,
        Description: category['Category Name'] + ' — ' + payee['Payee Name'] + (payload.description ? ' — ' + sanitizeInput_(payload.description) : ''),
        Debit: amount, Credit: '', Date: dateStr
      });
    }

    return ok_({ id: id });
  } catch (err) {
    logError_('addExpense', err);
    return fail_(err.message);
  } finally {
    if (lock) lock.releaseLock();
  }
}

/** Every expense, newest first — client does search/filter (same pattern as getSalesManagementList). */
function getExpenseList(token) {
  try {
    requirePermission_(token, 'expense', 'view');
    const rows = activeRows_('EXPENSES')
      .sort(function (a, b) { return String(b['Date'] + ' ' + b['Created At']).localeCompare(String(a['Date'] + ' ' + a['Created At'])); });

    return ok_(rows.map(function (e) {
  return {
    expenseId: e['Expense ID'], date: safeDateOnly_(e['Date']), categoryId: e['Category ID'], category: e['Category Name'],
    payeeId: e['Ledger ID'] || '', payeeName: e['Ledger Name'] || '',
    amount: Number(e['Amount']) || 0,
    paymentMethod: e['Payment Method'], description: e['Description'], referenceNo: e['Reference No'],
    notes: e['Notes'], status: e['Status'] || 'Active',
    isBackdated: !!e['Is Backdated'], backdatedDays: Number(e['Backdated Days']) || 0, backdatedReason: e['Backdated Reason'] || ''
  };
}));
  } catch (err) {
    logError_('getExpenseList', err);
    return fail_(err.message);
  }
}

/**
 * Chronological Expense Ledger. This is a read-only accounting view over
 * the existing EXPENSES rows; it does not create a second ledger sheet or
 * duplicate any transaction writes. Running Total is calculated in true
 * chronological order across all non-deleted expenses. Cancelled expenses
 * remain visible for audit/history but contribute zero to the running total.
 */
function getExpenseLedger(token, filters) {
  try {
    requirePermission_(token, 'expense', 'view');
    filters = filters || {};

    const dateFrom = sanitizeInput_(filters.dateFrom);
    const dateTo = sanitizeInput_(filters.dateTo);
    const categoryId = sanitizeInput_(filters.categoryId);
    const payeeId = sanitizeInput_(filters.payeeId);
    const paymentMethod = sanitizeInput_(filters.paymentMethod);
    const status = sanitizeInput_(filters.status);
    const query = sanitizeInput_(filters.query).toLowerCase();

    const sorted = activeRows_('EXPENSES').slice().sort(function (a, b) {
      const byDate = safeDateOnly_(a['Date']).localeCompare(safeDateOnly_(b['Date']));
      return byDate !== 0 ? byDate : String(a['Expense ID']).localeCompare(String(b['Expense ID']));
    });

    let runningTotal = 0;
    const payeeRunningTotals = {};
    const shaped = sorted.map(function (e) {
      const rowStatus = e['Status'] || 'Active';
      const amount = Number(e['Amount']) || 0;
      const activeAmount = rowStatus === 'Cancelled' ? 0 : amount;
      runningTotal += activeAmount;
      const rowPayeeId = e['Ledger ID'] || '';
      payeeRunningTotals[rowPayeeId] = (payeeRunningTotals[rowPayeeId] || 0) + activeAmount;
      return {
        expenseId: e['Expense ID'],
        date: safeDateOnly_(e['Date']),
        categoryId: e['Category ID'] || '',
        category: e['Category Name'] || 'Uncategorized',
        payeeId: rowPayeeId,
        payeeName: e['Ledger Name'] || 'Unassigned',
        amount: amount,
        paymentMethod: e['Payment Method'] || '',
        bankAccountName: e['Bank Account Name'] || '',
        description: e['Description'] || '',
        referenceNo: e['Reference No'] || '',
        notes: e['Notes'] || '',
        status: rowStatus,
        runningTotal: runningTotal,
        payeeRunningTotal: payeeRunningTotals[rowPayeeId],
        createdBy: e['Created By'] || '',
        createdAt: e['Created At'] || '',
        isBackdated: !!e['Is Backdated'],
        backdatedDays: Number(e['Backdated Days']) || 0,
        backdatedReason: e['Backdated Reason'] || ''
      };
    });

    const filtered = shaped.filter(function (row) {
      if (dateFrom && row.date < dateFrom) return false;
      if (dateTo && row.date > dateTo) return false;
      if (categoryId && row.categoryId !== categoryId) return false;
      if (payeeId && row.payeeId !== payeeId) return false;
      if (paymentMethod && row.paymentMethod !== paymentMethod) return false;
      if (status && row.status !== status) return false;
      if (query) {
        const hay = (row.expenseId + ' ' + row.category + ' ' + row.payeeName + ' ' + row.description + ' ' +
          row.referenceNo + ' ' + row.notes + ' ' + row.paymentMethod + ' ' + row.createdBy).toLowerCase();
        if (hay.indexOf(query) === -1) return false;
      }
      return true;
    });

    const filteredTotal = filtered.reduce(function (sum, row) {
      return sum + (row.status === 'Cancelled' ? 0 : row.amount);
    }, 0);

    if (payeeId) {
      filtered.forEach(function (row) { row.runningTotal = row.payeeRunningTotal; });
    }

    const categoriesMap = {};
    shaped.forEach(function (row) {
      const key = row.categoryId || ('name:' + row.category);
      if (!categoriesMap[key]) categoriesMap[key] = { id: row.categoryId, name: row.category };
    });
    const categories = Object.keys(categoriesMap).map(function (key) { return categoriesMap[key]; })
      .sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });

    const payeesMap = {};
    shaped.forEach(function (row) {
      const key = row.payeeId || ('name:' + row.payeeName);
      if (!payeesMap[key]) payeesMap[key] = { id: row.payeeId, name: row.payeeName };
    });
    getExpensePayeesForUI_().forEach(function (p) {
      if (p.id && !payeesMap[p.id]) payeesMap[p.id] = { id: p.id, name: p.name };
    });
    const payees = Object.keys(payeesMap).map(function (key) { return payeesMap[key]; })
      .sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });

    filtered.reverse(); // newest first for reading; running totals stay chronological

    const settings = getSettingsMap_();
    return ok_({
      rows: filtered,
      totalExpense: runningTotal,
      filteredTotal: filteredTotal,
      categories: categories,
      payees: payees,
      paymentMethods: EXPENSE_PAYMENT_METHODS,
      currencySymbol: settings['Currency Symbol'] || ''
    });
  } catch (err) {
    logError_('getExpenseLedger', err);
    return fail_(err.message);
  }
}

function getExpenseDetail(token, expenseId) {
  try {
    requirePermission_(token, 'expense', 'view');
    const e = getAllRows_('EXPENSES').filter(function (r) { return r['Expense ID'] === expenseId; })[0];
    if (!e) return fail_('Expense not found.');
    return ok_(e);
  } catch (err) {
    logError_('getExpenseDetail', err);
    return fail_(err.message);
  }
}

/**
 * Overwrites an expense in place — the same deliberate direct-edit
 * exception used by updateSale() / deleteSaleLineItem(). Blocked once
 * cancelled. Reconciles Cash Book on the cash delta (old-Cash-amount vs
 * new-Cash-amount) same as before. Bank side follows the same delta
 * idea when the bank account itself doesn't change; if the account
 * being paid from changes (or Bank switches to/from another method),
 * the old account is fully reversed and the new account gets a fresh
 * entry instead, since a single "delta" can't span two accounts.
 */
function updateExpense(token, expenseId, payload) {
  // Normal edit policy: a posted expense date cannot be changed; updateExpenseInternal_ enforces this before any write.
  return updateExpenseInternal_(token, expenseId, payload, { lockHeld: false });
}

function updateExpenseInternal_(token, expenseId, payload, options) {
  const opts = options || {};
  const lock = opts.lockHeld ? null : LockService.getScriptLock();
  if (lock) lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    requirePermission_(token, 'expense', 'edit');
    requireActiveCashSession_();
    const rowIndex = findRowIndex_('EXPENSES', 'Expense ID', expenseId);
    if (rowIndex === -1) return fail_('Expense not found.');
    const existing = getAllRows_('EXPENSES').filter(function (r) { return r['Expense ID'] === expenseId; })[0];
    if (isDeleted_(existing)) return fail_('This expense has been deleted.');
    if (existing['Status'] === 'Cancelled') return fail_('This expense is cancelled and can no longer be edited.');

    if (!isValidNonNegativeNumber_(payload.amount) || Number(payload.amount) <= 0) return fail_('Enter a valid expense amount.');
    if (!payload.categoryId) return fail_('Choose an expense category.');
    if (!payload.payeeId) return fail_('Choose a payee.');
    const method = EXPENSE_PAYMENT_METHODS.indexOf(payload.paymentMethod) !== -1 ? payload.paymentMethod : '';
    if (!method) return fail_('Choose a valid payment method.');

    const category = getAllRows_('EXPENSE_CATEGORIES').filter(function (c) { return c['Category ID'] === payload.categoryId; })[0];
    if (!category) return fail_('Category not found.');
    const payee = getAllRows_('EXPENSE_PAYEES').filter(function (p) {
      return p['Payee ID'] === sanitizeInput_(payload.payeeId) && !isDeleted_(p) && p['Status'] !== 'Inactive';
    })[0];
    if (!payee) return fail_('Payee not found or inactive.');

    const bankAccount = resolveBankAccount_(method, payload.bankAccountId);
    const bankAccountId = bankAccount.id, bankAccountName = bankAccount.name;

    const amount = Number(payload.amount);
    const originalDate = safeDateOnly_(existing['Date']);
    const dateStr = originalDate;
    const dateChanged = dateStr !== originalDate;
    const requestedDate = sanitizeInput_(payload.date);
    if (requestedDate && requestedDate !== dateStr) {
      return fail_('A posted expense date cannot be changed. Cancel/reverse the expense and enter a new one on the correct date.');
    }

    const oldMethod = existing['Payment Method'] || 'Cash';
    const oldAmount = Number(existing['Amount']) || 0;
    const oldBankAccountId = paymentAccountForReference_(existing, expenseId);

    updateRowFields_('EXPENSES', rowIndex, {
      'Date': dateStr, 'Category ID': category['Category ID'], 'Category Name': category['Category Name'],
      'Ledger ID': payee['Payee ID'], 'Ledger Name': payee['Payee Name'],
      'Amount': amount, 'Payment Method': method,
      'Description': sanitizeInput_(payload.description), 'Reference No': sanitizeInput_(payload.referenceNo),
      'Notes': sanitizeInput_(payload.notes),
      'Bank Account ID': bankAccountId, 'Bank Account Name': bankAccountName
    });

    
      const oldCashAmount = oldMethod === 'Cash' ? oldAmount : 0;
      const newCashAmount = method === 'Cash' ? amount : 0;
      const cashDelta = newCashAmount - oldCashAmount;
      if (cashDelta > 0) {
        addCashBookEntry_({ Type: 'Expense Update', Reference: expenseId, Description: 'Additional cash for expense update ' + expenseId, Debit: cashDelta, Credit: '', PaymentMethod: 'Cash', Date: dateStr });
      } else if (cashDelta < 0) {
        addCashBookEntry_({ Type: 'Expense Update', Reference: expenseId, Description: 'Cash reversed from expense update ' + expenseId, Debit: '', Credit: Math.abs(cashDelta), PaymentMethod: 'Cash', Date: dateStr });
      }

      const oldBankAmount = isBankLikePaymentMethod_(oldMethod) ? oldAmount : 0;
      const newBankAccountId = isBankLikePaymentMethod_(method) ? bankAccountId : '';
      const newBankAmount = isBankLikePaymentMethod_(method) ? amount : 0;
      if (oldBankAccountId && oldBankAccountId === newBankAccountId) {
        const bankDelta = newBankAmount - oldBankAmount;
        if (bankDelta > 0) {
          addBankBookEntry_(newBankAccountId, { Type: 'Expense Update', Reference: expenseId, Description: 'Additional funds for expense update ' + expenseId, Debit: bankDelta, Credit: '', Date: dateStr });
        } else if (bankDelta < 0) {
          addBankBookEntry_(newBankAccountId, { Type: 'Expense Update', Reference: expenseId, Description: 'Funds reversed from expense update ' + expenseId, Debit: '', Credit: Math.abs(bankDelta), Date: dateStr });
        }
      } else {
        if (oldBankAccountId) {
          addBankBookEntry_(oldBankAccountId, { Type: 'Expense Update', Reference: expenseId, Description: 'Funds reversed from expense update ' + expenseId, Debit: '', Credit: oldBankAmount, Date: dateStr });
        }
        if (newBankAccountId) {
          addBankBookEntry_(newBankAccountId, { Type: 'Expense Update', Reference: expenseId, Description: 'Additional funds for expense update ' + expenseId, Debit: newBankAmount, Credit: '', Date: dateStr });
        }
      }
    

    return ok_({ id: expenseId });
  } catch (err) {
    logError_('updateExpense', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Soft-cancels an expense — never deletes the row. If the original was
 * paid in Cash or Bank, reverses it with a linked Credit in the
 * matching book. Blocks re-cancelling an already-cancelled expense.
 */
function cancelExpense(token, expenseId, reason) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    requirePermission_(token, 'expense', 'edit');
    requireActiveCashSession_();
    const rowIndex = findRowIndex_('EXPENSES', 'Expense ID', expenseId);
    if (rowIndex === -1) return fail_('Expense not found.');
    const existing = getAllRows_('EXPENSES').filter(function (r) { return r['Expense ID'] === expenseId; })[0];
    if (isDeleted_(existing)) return fail_('This expense has been deleted.');
    if (existing['Status'] === 'Cancelled') return fail_('This expense is already cancelled.');
    if (!sanitizeInput_(reason)) return fail_('Enter a reason for cancelling this expense.');

    updateRowFields_('EXPENSES', rowIndex, {
      'Status': 'Cancelled',
      'Notes': (existing['Notes'] ? existing['Notes'] + ' | ' : '') + 'Cancelled: ' + sanitizeInput_(reason)
    });

    if (existing['Payment Method'] === 'Cash') {
      addCashBookEntry_({
        Type: 'Expense Cancelled', Reference: expenseId,
        Description: 'Reversal for cancelled expense ' + expenseId,
        Debit: '', Credit: Number(existing['Amount']) || 0, PaymentMethod: 'Cash'
      });
    } else if (isBankLikePaymentMethod_(existing['Payment Method']) && existing['Bank Account ID']) {
      addBankBookEntry_(existing['Bank Account ID'], {
        Type: 'Expense Cancelled', Reference: expenseId,
        Description: 'Reversal for cancelled expense ' + expenseId,
        Debit: '', Credit: Number(existing['Amount']) || 0
      });
    }

    return ok_({ id: expenseId });
  } catch (err) {
    logError_('cancelExpense', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Aggregates for future Dashboard integration (spec §8). Not wired into
 * Dashboard.gs/dashboard.html yet on purpose — the spec explicitly says
 * not to redesign the Dashboard now; this just exposes the numbers so a
 * later change can call it without touching Expense.gs again.
 */
function getExpenseDashboardStats(token) {
  try {
    requirePermission_(token, 'expense', 'view');
    const today = formatDate_(new Date());
    const thisMonth = today.slice(0, 7); // 'yyyy-MM'
    const rows = activeRows_('EXPENSES').filter(function (e) { return e['Status'] !== 'Cancelled'; });

    const todayExpense = rows.filter(function (e) { return safeDateOnly_(e['Date']) === today; })
  .reduce(function (s, e) { return s + (Number(e['Amount']) || 0); }, 0);
const monthlyExpense = rows.filter(function (e) { return safeDateOnly_(e['Date']).slice(0, 7) === thisMonth; })
  .reduce(function (s, e) { return s + (Number(e['Amount']) || 0); }, 0);

    const byCategory = {};
    rows.forEach(function (e) {
      const cat = e['Category Name'] || 'Uncategorized';
      byCategory[cat] = (byCategory[cat] || 0) + (Number(e['Amount']) || 0);
    });

    return ok_({ todayExpense: todayExpense, monthlyExpense: monthlyExpense, byCategory: byCategory });
  } catch (err) {
    logError_('getExpenseDashboardStats', err);
    return fail_(err.message);
  }
}
