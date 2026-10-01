/**
 * BankBook.gs
 * ---------------------------------------------------------------------
 * Phase 8 of the permissions/bank spec: the Bank Book, parallel to
 * CashBook.gs. Every action that moves money through a bank account
 * writes through addBankBookEntry_() — this is the sole writer, same
 * rule as addCashBookEntry_() for cash.
 *
 * One real difference from Cash Book: there's only one cash drawer, so
 * addCashBookEntry_ can just read "the last row's Balance". There are
 * multiple bank accounts here, so the running balance lives on
 * BANK_ACCOUNTS.'Current Balance' per account (set at creation in
 * BankAccounts.gs, Phase 7) — this file reads/writes that field for
 * the specific bankAccountId passed in, and Bank Book rows are that
 * account's own transaction history, not a global ledger.
 *
 * This file only adds the writer + balance reader. Wiring Payment
 * Method (Cash/Bank) into the actual money-moving functions — Sales
 * collection, Customer/Supplier Payment, Expense — was the rest of
 * Phase 8 and is done (see Expense.gs, Customer.gs, Suppliers.gs,
 * Sales.gs, SalesManagement.gs).
 *
 * Phase 9 (Bank Transfer): transferBetweenBankAccounts() moves money
 * between two of the shop's own accounts. It writes a BANK_TRANSFERS
 * "header" row (Transfer ID) — the same pattern every other transaction
 * type uses (Purchase/Sale/Expense each get their own record, not just
 * book entries) — then two linked Bank Book rows via addBankBookEntry_:
 * a Debit on the source account, a Credit on the destination, both
 * carrying the Transfer ID as their Reference. Negative balances aren't
 * blocked here, same convention as everywhere else in the app (Cash
 * Book, Customer/Supplier Current Due) — this is a bookkeeping record,
 * not a live sync with an actual bank, so an entry someone forgot to
 * log elsewhere shouldn't be able to lock them out of recording this one.
 *
 * Bank Ledger (audit): addBankBookEntry_ now accepts several OPTIONAL
 * extra keys so BankLedger.gs can post manual entries and reversals
 * through the same single writer instead of going around it. Every one
 * of them is optional and defaults to exactly the old behaviour, so all
 * sixteen existing call sites are unaffected and unchanged:
 *
 *   Date            'yyyy-MM-dd' — defaults to now(). This also closes a
 *                   real gap: bank entries were hardcoded to new Date(),
 *                   so a backdated sale or expense posted its bank side
 *                   to TODAY. Callers that support backdating can now
 *                   pass their own dateStr. (Sales/Expense/Customer/
 *                   Suppliers still don't — a separate change, flagged
 *                   rather than done here, since this file's rule is not
 *                   to touch unrelated modules.)
 *   Notes           free text
 *   CreatedBy       who posted it — the app's own session user, not
 *                   Session.getActiveUser(), which returns '' in a web app
 *   ReversalOf      the Entry ID this reverses
 *   IsBackdated / BackdatedDays / BackdatedReason
 * ---------------------------------------------------------------------
 */

/**
 * Appends one Bank Book row for the given account and returns the new
 * running balance for that account.
 * fields: { Type, Reference, Description, Debit, Credit }
 * preloadedAccount is optional and lets a multi-account operation reuse one
 * BANK_ACCOUNTS read while preserving the existing two-argument API.
 * Debit = money going out of the bank account, Credit = money coming
 * in. Pass '' (not 0) for whichever side doesn't apply, so the sheet
 * stays visually clean (same convention as Cash Book).
 */
function addBankBookEntry_(bankAccountId, fields, preloadedAccount) {
  const suppliedAccount = preloadedAccount && preloadedAccount['Bank Account ID'] === bankAccountId
    ? preloadedAccount : null;
  const rowIndex = suppliedAccount && Number(suppliedAccount._rowIndex) > 0
    ? Number(suppliedAccount._rowIndex)
    : findRowIndex_('BANK_ACCOUNTS', 'Bank Account ID', bankAccountId);
  if (rowIndex === -1) throw new Error('Bank account not found.');
  const account = suppliedAccount || getAllRows_('BANK_ACCOUNTS').filter(function (b) { return b['Bank Account ID'] === bankAccountId; })[0];

  const lastBalance = Number(account['Current Balance']) || 0;
  const debit = roundMoney_(Number(fields.Debit) || 0);
  const credit = roundMoney_(Number(fields.Credit) || 0);
  const newBalance = roundMoney_(lastBalance + credit - debit);
  const now = new Date();

  appendRow_('BANK_BOOK', {
    'Entry ID': generateId_('BANK_BOOK'),
    // Transaction date. Defaults to now() so every existing caller behaves
    // exactly as before; a caller that knows the real date can pass it.
    'Date': fields.Date || now,
    'Bank Account ID': bankAccountId,
    'Bank Account Name': account['Account Name'],
    'Type': fields.Type || '',
    'Reference': fields.Reference || '',
    'Description': fields.Description || '',
    'Debit': fields.Debit === '' || fields.Debit === undefined ? '' : debit,
    'Credit': fields.Credit === '' || fields.Credit === undefined ? '' : credit,
    // Running balance in POSTING order. BankLedger.gs deliberately ignores
    // this column and recomputes in date order — see its header for why.
    'Balance': newBalance,
    'Notes': fields.Notes || '',
    'Status': 'Active',
    'Reversal Of': fields.ReversalOf || '',
    'Created By': fields.CreatedBy || '',
    // Real wall-clock time the row was written, kept separate from the
    // (backdatable) Date column above.
    'Created At': now,
    'Is Backdated': fields.IsBackdated === undefined ? '' : fields.IsBackdated,
    'Backdated Days': fields.BackdatedDays === undefined ? '' : fields.BackdatedDays,
    'Backdated Reason': fields.BackdatedReason || ''
  });

  updateRowFields_('BANK_ACCOUNTS', rowIndex, { 'Current Balance': newBalance });

  return newBalance;
}

/** Current balance of one bank account (0 if not found — mirrors getCashBalance_'s "0 if empty" fallback). */
function getBankBalance_(bankAccountId) {
  const account = getAllRows_('BANK_ACCOUNTS').filter(function (b) { return b['Bank Account ID'] === bankAccountId; })[0];
  return account ? roundMoney_(Number(account['Current Balance']) || 0) : 0;
}

/** Combined balance across every Active bank account, for dashboard-style "Total Bank Balance" figures. */
function getTotalBankBalance_() {
  return roundMoney_(getAllRows_('BANK_ACCOUNTS')
    .filter(function (b) { return b['Status'] !== 'Inactive'; })
    .reduce(function (sum, b) { return sum + (Number(b['Current Balance']) || 0); }, 0));
}

/** payload = { fromAccountId, toAccountId, amount, notes } */
function transferBetweenBankAccounts(token, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    const actingUser = requirePermission_(token, 'bank', 'add');
    requireActiveCashSession_();
    if (!payload.fromAccountId || !payload.toAccountId) return fail_('Choose both a from and to account.');
    if (payload.fromAccountId === payload.toAccountId) return fail_('Choose two different bank accounts.');
    if (!isValidNonNegativeNumber_(payload.amount) || Number(payload.amount) <= 0) return fail_('Enter a valid transfer amount.');

    const bankAccounts = getAllRows_('BANK_ACCOUNTS');
    const fromAccount = bankAccounts.filter(function (b) { return b['Bank Account ID'] === payload.fromAccountId; })[0];
    if (!fromAccount) return fail_('From account not found.');
    if (fromAccount['Status'] === 'Inactive') return fail_('From account is inactive.');
    const toAccount = bankAccounts.filter(function (b) { return b['Bank Account ID'] === payload.toAccountId; })[0];
    if (!toAccount) return fail_('To account not found.');
    if (toAccount['Status'] === 'Inactive') return fail_('To account is inactive.');

    const amount = roundMoney_(Number(payload.amount));
    if (amount <= 0) return fail_('Enter a valid transfer amount.');
    const id = generateId_('BANK_TRANSFERS');
    const now = new Date();

    appendRow_('BANK_TRANSFERS', {
      'Transfer ID': id,
      'Date': now,
      'From Account ID': fromAccount['Bank Account ID'],
      'From Account Name': fromAccount['Account Name'],
      'To Account ID': toAccount['Bank Account ID'],
      'To Account Name': toAccount['Account Name'],
      'Amount': amount,
      'Notes': sanitizeInput_(payload.notes),
      'Created By': actorName_(actingUser),
      'Created At': now
    });

    addBankBookEntry_(fromAccount['Bank Account ID'], {
      Type: 'Transfer Out', Reference: id,
      Description: 'Transfer to ' + toAccount['Account Name'],
      Debit: amount, Credit: ''
    }, fromAccount);
    addBankBookEntry_(toAccount['Bank Account ID'], {
      Type: 'Transfer In', Reference: id,
      Description: 'Transfer from ' + fromAccount['Account Name'],
      Debit: '', Credit: amount
    }, toAccount);

    return ok_({ id: id });
  } catch (err) {
    logError_('transferBetweenBankAccounts', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

/** Transfer history, newest first, for the Bank page. */
function getBankTransferHistory(token) {
  try {
    requirePermission_(token, 'bank', 'view');
    const transfers = activeRows_('BANK_TRANSFERS').sort(function (a, b) {
      return new Date(b['Date']) - new Date(a['Date']);
    });
    return ok_(transfers);
  } catch (err) {
    logError_('getBankTransferHistory', err);
    return fail_(err.message);
  }
}
