/**
 * FinanceModule.gs
 * ---------------------------------------------------------------------
 * Business Finance: owner capital and loans, kept deliberately small.
 * One sheet (FINANCE_TRANSACTIONS, see Config.gs), two pages (Business
 * Finance to record a transaction, Finance Ledger to browse/edit/delete
 * them) and four transaction types, plus two opening-balance variants
 * that behave identically to their non-opening counterpart — "opening"
 * is just a label so the ledger can show which entry seeded the figure,
 * exactly the way this codebase already lets a Bank Account's first
 * transaction be its own opening entry rather than building a second
 * opening-balance system.
 *
 * Owner Capital and Outstanding Loan are NEVER stored anywhere as their
 * own number. Every reader sums activeRows_('FINANCE_TRANSACTIONS')
 * fresh, the same "derived, not cached" convention Dashboard.gs and
 * Reports.gs already use for dueReceivable/supplierPayable/inventory
 * value. That is what makes edit and delete simple: correcting or
 * soft-deleting a row IS the recalculation. Only the Cash Book / Bank
 * Book side is real money that has to be explicitly reversed and
 * reapplied — see the "Finance transactions" section of DeleteEngine.gs
 * for that half, which mirrors updateSupplierPayment/deleteSupplierPayment
 * exactly (per CLAUDE.md's documented convention for ledger-style
 * payment records).
 * ---------------------------------------------------------------------
 */

/**
 * Explicit relationship-account and money-movement metadata for Business Finance.
 * `balanceEffect` changes the relationship balance while `cashDirection` controls
 * the real Cash/Bank side. Opening entries intentionally have no money movement.
 */
const FINANCE_TRANSACTION_TYPES = [
  { key:'Owner Investment', label:'Owner Credit', account:'owner', balanceEffect:1, cashDirection:'in', role:'Owner', isOpening:false },
  { key:'Owner Withdrawal', label:'Owner Debit', account:'owner', balanceEffect:-1, cashDirection:'out', role:'Owner', isOpening:false },
  { key:'Loan Received', label:'Lender Credit', account:'loanPayable', balanceEffect:1, cashDirection:'in', role:'Lender', isOpening:false },
  { key:'Loan Repayment', label:'Lender Debit', account:'loanPayable', balanceEffect:-1, cashDirection:'out', role:'Lender', isOpening:false },
  { key:'Borrower Loan', label:'Borrower Debit', account:'borrowerReceivable', balanceEffect:1, cashDirection:'out', role:'Borrower', isOpening:false },
  { key:'Borrower Repayment', label:'Borrower Credit', account:'borrowerReceivable', balanceEffect:-1, cashDirection:'in', role:'Borrower', isOpening:false },
  { key:'Opening Owner Capital', label:'Opening Owner Capital', account:'owner', balanceEffect:1, cashDirection:'none', role:'Owner', isOpening:true },
  { key:'Opening Loan', label:'Opening Loan', account:'loanPayable', balanceEffect:1, cashDirection:'none', role:'Lender', isOpening:true },
  { key:'Opening Borrower Loan', label:'Opening Borrower Loan', account:'borrowerReceivable', balanceEffect:1, cashDirection:'none', role:'Borrower', isOpening:true }
];

const FINANCE_PAYMENT_METHODS = ['Cash', 'Bank', 'Mobile Banking'];

function financeTransactionType_(key) {
  return FINANCE_TRANSACTION_TYPES.filter(function (t) { return t.key === key; })[0] || null;
}

function financeTxnPersonKey_(row, personNameToId) {
  const id = String(row && row['Person ID'] || '').trim();
  if (id) return 'id:' + id;
  const name = String(row && row['Person'] || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (name && personNameToId && personNameToId[name]) return 'id:' + personNameToId[name];
  return 'name:' + name;
}

/**
 * Returns signed relationship balances keyed by stable person identity.
 * Legacy rows without Person ID are grouped by normalized Person name.
 */
function financeSignedBalances_(rows, personId, personNameToId) {
  const wantedId = String(personId || '').trim();
  const balances = {};
  (rows || []).forEach(function (row) {
    const rowPersonId = String(row['Person ID'] || '').trim();
    const key = financeTxnPersonKey_(row, personNameToId);
    if (wantedId && key !== 'id:' + wantedId) return;
    const type = financeTransactionType_(row['Transaction Type']);
    if (!type) return;
    if (!balances[key]) {
      balances[key] = {
        personId: rowPersonId,
        person: String(row['Person'] || '').trim(),
        owner: 0,
        loanPayable: 0,
        borrowerReceivable: 0
      };
    }
    const amount = Number(row['Amount']) || 0;
    balances[key][type.account] = roundMoney_(balances[key][type.account] + amount * type.balanceEffect);
  });
  return balances;
}

/** Split signed per-person nets into non-netted positive and Credit/Advance buckets. */
function financeBalanceSummary_(rows, personId, personNameToId) {
  const summary = {
    ownerCapital: 0,
    ownerAdvance: 0,
    outstandingLoan: 0,
    lenderCredit: 0,
    borrowerReceivable: 0,
    borrowerCredit: 0
  };
  const balances = financeSignedBalances_(rows, personId, personNameToId);
  Object.keys(balances).forEach(function (key) {
    const b = balances[key];
    if (b.owner >= 0) summary.ownerCapital += b.owner;
    else summary.ownerAdvance += -b.owner;
    if (b.loanPayable >= 0) summary.outstandingLoan += b.loanPayable;
    else summary.lenderCredit += -b.loanPayable;
    if (b.borrowerReceivable >= 0) summary.borrowerReceivable += b.borrowerReceivable;
    else summary.borrowerCredit += -b.borrowerReceivable;
  });
  Object.keys(summary).forEach(function (key) { summary[key] = roundMoney_(summary[key]); });
  return summary;
}

/** Compatibility wrapper retained for existing dashboard/UI consumers. */
function getOwnerCapital_() {
  return financeBalanceSummary_(activeRows_('FINANCE_TRANSACTIONS')).ownerCapital;
}

/** Compatibility wrapper retained for existing dashboard/UI consumers. */
function getOutstandingLoan_() {
  return financeBalanceSummary_(activeRows_('FINANCE_TRANSACTIONS')).outstandingLoan;
}

function getFinanceBootstrap(token) {
  try {
    requirePermission_(token, 'finance', 'view');
    const settings = getSettingsMap_();
    const summary = financeBalanceSummary_(activeRows_('FINANCE_TRANSACTIONS'));
    return ok_({
      transactionTypes: FINANCE_TRANSACTION_TYPES.map(function (t) {
        return {
          key: t.key, label: t.label, account: t.account, balanceEffect: t.balanceEffect,
          cashDirection: t.cashDirection, role: t.role, isOpening: t.isOpening
        };
      }),
      paymentMethods: FINANCE_PAYMENT_METHODS,
      bankAccounts: getActiveBankAccountsForUI_(),
      persons: getActiveFinancePersonsForUI_(),
      personsAll: getAllFinancePersonsForUI_(),
      summary: summary,
      ownerCapital: summary.ownerCapital,
      ownerAdvance: summary.ownerAdvance,
      outstandingLoan: summary.outstandingLoan,
      lenderCredit: summary.lenderCredit,
      borrowerReceivable: summary.borrowerReceivable,
      borrowerCredit: summary.borrowerCredit,
      currencySymbol: settings['Currency Symbol'] || '',
      today: formatDate_(new Date())
    });
  } catch (err) {
    logError_('getFinanceBootstrap', err);
    return fail_(err.message);
  }
}

/**
 * ---------------------------------------------------------------------
 * Finance Persons (Owner/Lender/Borrower multi-role master data)
 * ---------------------------------------------------------------------
 * Finance Person is master data with stable Person ID, editable name/phone/
 * description/roles, and Active/Inactive status. Historical transactions keep
 * their Person ID, so master-data edits do not rewrite accounting history.
 * Never hard-deleted. Feeds the Person dropdown on finance.html and
 * financeLedger.html instead of a free-text field.
 *
 * 'Roles' is authoritative when populated and is enforced server-side for
 * Finance transactions. Legacy 'Person Type' remains as a compatibility
 * fallback when Roles is blank. One person may hold any combination of
 * Owner, Lender, and Borrower roles without duplicate master rows.
 * ---------------------------------------------------------------------
 */

const FINANCE_PERSON_ROLES = ['Owner', 'Lender', 'Borrower'];

function financeCanonicalRoles_(roles) {
  const supplied = Array.isArray(roles) ? roles : String(roles || '').split(',');
  const wanted = {};
  supplied.forEach(function (role) {
    const value = String(role || '').trim();
    if (FINANCE_PERSON_ROLES.indexOf(value) !== -1) wanted[value] = true;
  });
  return FINANCE_PERSON_ROLES.filter(function (role) { return !!wanted[role]; });
}

/** Canonical roles from additive Roles column, falling back to legacy Person Type. */
function financePersonRoles_(row) {
  row = row || {};
  const explicit = financeCanonicalRoles_(row['Roles']);
  if (explicit.length) return explicit;
  const legacy = financeCanonicalRoles_([row['Person Type']]);
  return legacy.length ? legacy : ['Owner'];
}

function financePersonHasRole_(row, role) {
  return financePersonRoles_(row).indexOf(role) !== -1;
}

/** Every person, active or not — legacy type plus canonical roles and master-data details. */
function getAllFinancePersonsForUI_() {
  return getAllRows_('FINANCE_PERSONS').map(function (p) {
    return {
      id: p['Person ID'],
      name: p['Person Name'],
      type: p['Person Type'] || financePersonRoles_(p)[0] || 'Owner',
      roles: financePersonRoles_(p),
      status: p['Status'] || 'Active',
      phone: p['Phone'] || '',
      description: p['Description'] || p['Notes'] || ''
    };
  });
}

/** Active persons only; retain roles so transaction dropdowns can filter safely. */
function getActiveFinancePersonsForUI_() {
  return getAllFinancePersonsForUI_()
    .filter(function (p) { return p.status !== 'Inactive'; })
    .map(function (p) { return { id: p.id, name: p.name, type: p.type, roles: p.roles, phone: p.phone, description: p.description || '' }; });
}

/** Looks up one person row by ID, or null. */
function findFinancePerson_(personId) {
  return getAllRows_('FINANCE_PERSONS').filter(function (p) { return p['Person ID'] === personId; })[0] || null;
}

/** payload = { name, roles:['Owner'|'Lender'|'Borrower'], phone, description } */
function addFinancePerson(token, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    requirePermission_(token, 'finance', 'add');
    payload = payload || {};
    const name = sanitizeInput_(payload.name);
    if (!name) return fail_('Person name is required.');
    const roles = financeCanonicalRoles_(payload.roles);
    if (!roles.length) return fail_('Choose at least one finance role.');

    const duplicate = getAllRows_('FINANCE_PERSONS').some(function (p) {
      return String(p['Person Name']).toLowerCase() === name.toLowerCase();
    });
    if (duplicate) return fail_('A person with this name already exists.');

    const id = generateId_('FINANCE_PERSONS');
    appendRow_('FINANCE_PERSONS', {
      'Person ID': id, 'Person Name': name, 'Person Type': roles[0], 'Roles': roles.join(','),
      'Phone': sanitizeInput_(payload.phone), 'Description': sanitizeInput_(payload.description),
      'Notes': sanitizeInput_(payload.notes),
      'Status': 'Active', 'Created At': new Date()
    });
    return ok_({ id: id, roles: roles });
  } catch (err) {
    logError_('addFinancePerson', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

function updateFinancePerson(token, personId, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    requirePermission_(token, 'finance', 'edit');
    payload = payload || {};
    const row = findFinancePerson_(personId);
    if (!row) return fail_('Person not found.');

    const name = sanitizeInput_(payload.name);
    if (!name) return fail_('Person name is required.');
    const roles = financeCanonicalRoles_(payload.roles);
    if (!roles.length) return fail_('Choose at least one finance role.');

    const duplicate = getAllRows_('FINANCE_PERSONS').some(function (p) {
      return p['Person ID'] !== personId && String(p['Person Name'] || '').toLowerCase() === name.toLowerCase();
    });
    if (duplicate) return fail_('A person with this name already exists.');

    updateRowFields_('FINANCE_PERSONS', row._rowIndex, {
      'Person Name': name,
      'Person Type': roles[0],
      'Roles': roles.join(','),
      'Phone': sanitizeInput_(payload.phone),
      'Description': sanitizeInput_(payload.description)
    });
    return ok_({
      id: personId, name: name, type: roles[0], roles: roles,
      phone: sanitizeInput_(payload.phone), description: sanitizeInput_(payload.description),
      status: row['Status'] || 'Active'
    });
  } catch (err) {
    logError_('updateFinancePerson', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

function setFinancePersonRoles(token, personId, roles) {
  try {
    requirePermission_(token, 'finance', 'edit');
    const row = findFinancePerson_(personId);
    if (!row) return fail_('Person not found.');
    if (row['Status'] === 'Inactive') return fail_('Person is inactive.');
    const canonical = financeCanonicalRoles_(roles);
    if (!canonical.length) return fail_('Choose at least one finance role.');
    updateRowFields_('FINANCE_PERSONS', row._rowIndex, {
      'Roles': canonical.join(','),
      'Person Type': canonical[0]
    });
    return ok_({ id: personId, roles: canonical });
  } catch (err) {
    logError_('setFinancePersonRoles', err);
    return fail_(err.message);
  }
}

function setFinancePersonStatus(token, personId, status) {
  try {
    requirePermission_(token, 'finance', 'edit');
    const rowIndex = findRowIndex_('FINANCE_PERSONS', 'Person ID', personId);
    if (rowIndex === -1) return fail_('Person not found.');
    updateRowFields_('FINANCE_PERSONS', rowIndex, { 'Status': status === 'Active' ? 'Active' : 'Inactive' });
    return ok_({ id: personId, status: status });
  } catch (err) {
    logError_('setFinancePersonStatus', err);
    return fail_(err.message);
  }
}

function financeTypeHasMoneyMovement_(type) {
  return !!type && (type.cashDirection === 'in' || type.cashDirection === 'out');
}

/**
 * Posts the Cash Book / Bank Book side of one finance transaction. Shared
 * by addFinanceTransaction() here and updateFinanceTransaction() in
 * DeleteEngine.gs, so the "which book, which side, what description" logic
 * exists exactly once.
 */
function postFinanceTransactionMoney_(financeId, type, method, bankAccountId, amount, person, dateStr, actingUser) {
  if (!financeTypeHasMoneyMovement_(type)) return;
  const description = type.label + (person ? ' — ' + person : '');
  if (method === 'Cash') {
    addCashBookEntry_({
      Type: type.key, Reference: financeId, Description: description,
      Debit: type.cashDirection === 'out' ? amount : '', Credit: type.cashDirection === 'in' ? amount : '',
      PaymentMethod: 'Cash', Date: dateStr
    });
  } else if (isBankLikePaymentMethod_(method)) {
    addBankBookEntry_(bankAccountId, {
      Type: type.key, Reference: financeId, Description: description,
      Debit: type.cashDirection === 'out' ? amount : '', Credit: type.cashDirection === 'in' ? amount : '',
      Date: dateStr, CreatedBy: actorName_(actingUser)
    });
  }
}

/**
 * payload = {
 *   date, transactionType, personId, paymentMethod,
 *   bankAccountId (required when paymentMethod is 'Bank' or 'Mobile Banking'),
 *   amount, referenceNo, notes,
 *   backdatedReason (required only when date is in the past)
 * }
 */
function addFinanceTransaction(token, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    const actingUser = requirePermission_(token, 'finance', 'add');
    payload = payload || {};

    const type = financeTransactionType_(sanitizeInput_(payload.transactionType));
    if (!type) return fail_('Choose a valid transaction type.');
    if (financeTypeHasMoneyMovement_(type)) requireActiveCashSession_();

    if (!isValidNonNegativeNumber_(payload.amount) || Number(payload.amount) <= 0) return fail_('Enter a valid amount.');
    const amount = roundMoney_(Number(payload.amount));
    if (amount <= 0) return fail_('Enter a valid amount of at least 0.01.');

    const personId = sanitizeInput_(payload.personId);
    if (!personId) return fail_('Choose a finance person.');
    const personRow = findFinancePerson_(personId);
    if (!personRow) return fail_('Person not found.');
    if (personRow['Status'] === 'Inactive') return fail_('Person is inactive.');
    if (!financePersonHasRole_(personRow, type.role)) return fail_('Selected person must have the ' + type.role + ' role.');
    const personName = personRow['Person Name'];

    let method = '';
    let bank = { id: '', name: '' };
    if (financeTypeHasMoneyMovement_(type)) {
      method = FINANCE_PAYMENT_METHODS.indexOf(payload.paymentMethod) !== -1 ? payload.paymentMethod : '';
      if (!method) return fail_('Choose a valid payment method.');
      bank = resolveBankAccount_(method, payload.bankAccountId);
    }

    const txDate = resolveTransactionDate_(token, 'finance', payload.date, payload.backdatedReason, 'Finance entry');
    const id = generateId_('FINANCE_TRANSACTIONS');
    const now = new Date();

    appendRow_('FINANCE_TRANSACTIONS', {
      'Finance ID': id, 'Date': txDate.dateStr, 'Transaction Type': type.key,
      'Person ID': personId, 'Person': personName,
      'Payment Method': method, 'Bank Account ID': bank.id, 'Bank Account Name': bank.name,
      'Amount': amount, 'Reference No': sanitizeInput_(payload.referenceNo), 'Notes': sanitizeInput_(payload.notes),
      'Created By': actorName_(actingUser), 'Created At': now,
      'Is Backdated': txDate.isBackdated, 'Backdated Days': txDate.backdatedDays, 'Backdated Reason': txDate.reason
    });

    postFinanceTransactionMoney_(id, type, method, bank.id, amount, personName, txDate.dateStr, actingUser);

    return ok_({ id: id, ownerCapital: getOwnerCapital_(), outstandingLoan: getOutstandingLoan_() });
  } catch (err) {
    logError_('addFinanceTransaction', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

function financeAccountLabel_(account) {
  if (account === 'owner') return 'Owner Balance';
  if (account === 'loanPayable') return 'Lender Balance';
  if (account === 'borrowerReceivable') return 'Borrower Balance';
  return '';
}

function financePersonNameAliasMap_(persons) {
  const aliases = {};
  (persons || []).forEach(function (person) {
    const name = String(person.name || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (name && person.id) aliases[name] = person.id;
  });
  return aliases;
}

/**
 * filters = { dateFrom, dateTo, transactionType, personId, query } - all optional.
 *
 * Running balance walks every active row in chronological (Date, then
 * Finance ID) order once and keeps a separate signed balance for each
 * person + relationship account (owner, loanPayable, borrowerReceivable).
 * Display filters are applied afterwards, so historical balances and the
 * current summary remain correct after filtering or backdating.
 */
function getFinanceLedger(token, filters) {
  try {
    requirePermission_(token, 'finance', 'view');
    filters = filters || {};
    const dateFrom = sanitizeInput_(filters.dateFrom);
    const dateTo = sanitizeInput_(filters.dateTo);
    const typeFilter = sanitizeInput_(filters.transactionType);
    const personIdFilter = sanitizeInput_(filters.personId);
    const query = sanitizeInput_(filters.query).toLowerCase();

    const personsAll = getAllFinancePersonsForUI_();
    const personNameToId = financePersonNameAliasMap_(personsAll);
    const selectedPerson = personIdFilter
      ? personsAll.filter(function (person) { return person.id === personIdFilter; })[0] || null
      : null;

    const sorted = activeRows_('FINANCE_TRANSACTIONS').slice().sort(function (a, b) {
      const d = safeDateOnly_(a['Date']).localeCompare(safeDateOnly_(b['Date']));
      return d !== 0 ? d : String(a['Finance ID']).localeCompare(String(b['Finance ID']));
    });

    const running = {};
    const shaped = sorted.map(function (f) {
      const type = financeTransactionType_(f['Transaction Type']);
      const amount = Number(f['Amount']) || 0;
      const personKey = financeTxnPersonKey_(f, personNameToId);
      if (!running[personKey]) running[personKey] = { owner: 0, loanPayable: 0, borrowerReceivable: 0 };
      let balance = 0;
      if (type) {
        running[personKey][type.account] = roundMoney_(running[personKey][type.account] + amount * type.balanceEffect);
        balance = running[personKey][type.account];
      }

      return {
        financeId: f['Finance ID'], date: safeDateOnly_(f['Date']),
        transactionType: f['Transaction Type'], transactionTypeLabel: type ? type.label : f['Transaction Type'],
        account: type ? type.account : '', accountLabel: type ? financeAccountLabel_(type.account) : '',
        personKey: personKey, personId: f['Person ID'] || '', person: f['Person'] || '',
        paymentMethod: f['Payment Method'] || '',
        bankAccountId: f['Bank Account ID'] || '', bankAccountName: f['Bank Account Name'] || '',
        amount: amount,
        debit: type && type.cashDirection === 'out' ? amount : 0,
        credit: type && type.cashDirection === 'in' ? amount : 0,
        balance: balance,
        referenceNo: f['Reference No'] || '', notes: f['Notes'] || '',
        createdBy: f['Created By'] || '', createdAt: f['Created At'] || '',
        isBackdated: !!f['Is Backdated'], backdatedDays: Number(f['Backdated Days']) || 0, backdatedReason: f['Backdated Reason'] || ''
      };
    });

    const selectedKey = personIdFilter ? 'id:' + personIdFilter : '';
    const filtered = shaped.filter(function (row) {
      if (selectedKey && row.personKey !== selectedKey) return false;
      if (dateFrom && row.date < dateFrom) return false;
      if (dateTo && row.date > dateTo) return false;
      if (typeFilter && row.transactionType !== typeFilter) return false;
      if (query) {
        const hay = (row.financeId + ' ' + row.person + ' ' + row.referenceNo + ' ' + row.notes + ' ' + row.transactionType + ' ' + row.transactionTypeLabel + ' ' + row.accountLabel).toLowerCase();
        if (hay.indexOf(query) === -1) return false;
      }
      return true;
    });

    filtered.reverse();
    const summary = financeBalanceSummary_(sorted, personIdFilter, personNameToId);
    const settings = getSettingsMap_();
    return ok_({
      rows: filtered,
      summary: summary,
      selectedPerson: selectedPerson,
      ownerCapital: summary.ownerCapital,
      outstandingLoan: summary.outstandingLoan,
      transactionTypes: FINANCE_TRANSACTION_TYPES.map(function (t) {
        return {
          key: t.key, label: t.label, account: t.account, balanceEffect: t.balanceEffect,
          cashDirection: t.cashDirection, role: t.role, isOpening: t.isOpening
        };
      }),
      currencySymbol: settings['Currency Symbol'] || ''
    });
  } catch (err) {
    logError_('getFinanceLedger', err);
    return fail_(err.message);
  }
}
