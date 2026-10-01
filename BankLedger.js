/**
 * BankLedger.gs
 * ---------------------------------------------------------------------
 * The audit view over BANK_BOOK, plus the manual entries that had no way
 * in before: bank charges, interest credited, a bounced cheque, and cash
 * moved between the drawer and the bank.
 *
 * Until now BANK_BOOK was write-only — sixteen write sites across six
 * modules and not one reader. Money could go in and out of a bank
 * account and there was no screen anywhere that would show you the
 * account's history.
 *
 * ---------------------------------------------------------------------
 * THREE DESIGN DECISIONS, and why
 * ---------------------------------------------------------------------
 *
 * 1. POSTED ENTRIES ARE NEVER EDITED. A mistake is corrected by
 *    reverseBankEntry(), which writes a NEW opposite entry linked back to
 *    the original and flags the original as Reversed. Both rows stay
 *    visible in the ledger forever.
 *
 *    This is not a limitation, it is the point — an audit trail you can
 *    silently edit is not an audit trail. It also matches the rule this
 *    codebase already follows everywhere else: "returns are always new
 *    linked records, never edits to originals".
 *
 * 2. THE RUNNING BALANCE IS COMPUTED IN DATE ORDER, NOT STORED ORDER.
 *    BANK_BOOK's own 'Balance' column is written by addBankBookEntry_ in
 *    posting order (it reads BANK_ACCOUNTS.'Current Balance', adds, writes
 *    back). That is correct only while every entry lands on today. As soon
 *    as one entry is backdated, stored Balance and true date-ordered
 *    balance diverge.
 *
 *    So the ledger ignores the stored column and recomputes the running
 *    balance in (Date, Entry ID) order. Entry IDs are zero-padded, so
 *    lexicographic order is posting order, which makes a stable tiebreak
 *    for same-day entries.
 *
 *    Totals are order-independent, so the final computed balance must
 *    always equal BANK_ACCOUNTS.'Current Balance'. getBankLedger returns
 *    an `integrity` block comparing the two; a mismatch means something
 *    wrote that column outside addBankBookEntry_, and the client shows it
 *    rather than hiding it.
 *
 * 3. THE OPENING BALANCE NEEDS ITS OWN LEDGER ROW. addBankAccount() sets
 *    Current Balance = Opening Balance but writes no BANK_BOOK row, so the
 *    ledger could never foot from zero up to the account balance. Customer
 *    and Supplier both write an "Opening Balance" ledger row on creation;
 *    Bank was the odd one out.
 *
 *    backfillBankOpeningEntries() (Sheet menu, safe to re-run) writes the
 *    missing row for every existing account. Until you run it, the ledger
 *    still balances — it falls back to the account's Opening Balance field
 *    as the starting figure — but there is no line item explaining where
 *    that figure came from.
 * ---------------------------------------------------------------------
 */

/**
 * The manual entry types, and which side of the ledger each lands on.
 *
 * direction 'debit'  = money leaving the bank account
 * direction 'credit' = money arriving in the bank account
 *
 * A bounced cheque needs both directions and they are NOT interchangeable:
 * a cheque you received and banked was credited when you deposited it, so
 * the bounce takes it back out (debit). A cheque you issued was debited
 * when you wrote it, so its bounce puts the money back (credit). Picking
 * the wrong one moves the balance the wrong way by twice the amount, which
 * is why they are two separate options rather than one with a toggle.
 *
 * contra 'cash' means the entry must also move the cash drawer, so it
 * writes a matching Cash Book row and requires an open cash session.
 */
const BANK_MANUAL_ENTRY_TYPES = [
  { key: 'Bank Charge',              label: 'Bank Charge / Fee',            direction: 'debit',  contra: null },
  { key: 'Interest Received',        label: 'Interest Received',            direction: 'credit', contra: null },
  { key: 'Cheque Bounced (Received)',label: 'Cheque Bounced — we received', direction: 'debit',  contra: null },
  { key: 'Cheque Bounced (Issued)',  label: 'Cheque Bounced — we issued',   direction: 'credit', contra: null },
  { key: 'Cash Deposit',             label: 'Cash Deposited into Bank',     direction: 'credit', contra: 'cash' },
  { key: 'Cash Withdrawal',          label: 'Cash Withdrawn from Bank',     direction: 'debit',  contra: 'cash' },
  { key: 'Bank Adjustment',          label: 'Other Adjustment',             direction: 'either', contra: null }
];

function bankManualType_(key) {
  return BANK_MANUAL_ENTRY_TYPES.filter(function (t) { return t.key === key; })[0] || null;
}

// ------------------------------------------------------------- bootstrap

function getBankLedgerBootstrap(token) {
  try {
    requirePermission_(token, 'bank', 'view');
    const settings = getSettingsMap_();
    const today = formatDate_(new Date());
    return ok_({
      accounts: getAllRows_('BANK_ACCOUNTS')
        .filter(function (b) { return b['Status'] !== 'Inactive'; })
        .map(function (b) {
          return {
            id: b['Bank Account ID'],
            name: b['Account Name'],
            bankName: b['Bank Name'] || '',
            currentBalance: Number(b['Current Balance']) || 0,
            type: sanitizeAccountType_(b['Account Type'])
          };
        }),
      entryTypes: BANK_MANUAL_ENTRY_TYPES.map(function (t) {
        return { key: t.key, label: t.label, direction: t.direction, contra: t.contra };
      }),
      currencySymbol: settings['Currency Symbol'] || '',
      defaultFrom: today.slice(0, 8) + '01',
      defaultTo: today
    });
  } catch (err) {
    logError_('getBankLedgerBootstrap', err);
    return fail_(err.message);
  }
}

// ---------------------------------------------------------- the ledger

/**
 * filters = { bankAccountId (required), from, to }
 *
 * Returns the account's statement for the range: an opening figure, every
 * entry in date order with a recomputed running balance, and a closing
 * figure that must reconcile to BANK_ACCOUNTS.'Current Balance'.
 */
function getBankLedger(token, filters) {
  try {
    requirePermission_(token, 'bank', 'view');
    filters = filters || {};

    const accountId = sanitizeInput_(filters.bankAccountId);
    if (!accountId) return fail_('Choose a bank account.');
    const account = getAllRows_('BANK_ACCOUNTS').filter(function (b) {
      return b['Bank Account ID'] === accountId;
    })[0];
    if (!account) return fail_('Bank account not found.');

    const today = formatDate_(new Date());
    let from = sanitizeInput_(filters.from);
    let to = sanitizeInput_(filters.to);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) from = today.slice(0, 8) + '01';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) to = today;
    if (from > to) { const swap = from; from = to; to = swap; }

    // Entries the Delete System voided (DeleteEngine.gs's voidBankEntriesFor_ /
    // deleteBankTransaction) flip Status to 'Reversed' directly on the
    // original row and adjust Current Balance in the same step — no mirror
    // row is posted. That is NOT the same as reverseBankEntry()'s manual
    // correction, which posts a linked opposite entry (its 'Reversal Of'
    // pointing back at the original) and deliberately keeps both rows as an
    // audit trail. Only entries with such a mirror are that audit-trail
    // case; every other 'Reversed' row was deleted and must disappear from
    // the ledger — and its running balance — completely, the same rule
    // every other ledger in the app follows for soft-deleted rows.
    const accountBankBook_ = getAllRows_('BANK_BOOK').filter(function (r) { return r['Bank Account ID'] === accountId; });
    const bankReversalTargets_ = {};
    accountBankBook_.forEach(function (r) { if (r['Reversal Of']) bankReversalTargets_[r['Reversal Of']] = true; });

    // Date order, with Entry ID as a stable tiebreak for same-day rows.
    // Entry IDs are zero-padded (BB-000001), so string order is posting order.
    const rows = accountBankBook_
      .filter(function (r) { return r['Status'] !== 'Reversed' || bankReversalTargets_[r['Entry ID']]; })
      .map(function (r) {
        return {
          entryId: r['Entry ID'],
          date: safeDateOnly_(r['Date']),
          type: r['Type'] || '',
          reference: r['Reference'] || '',
          description: r['Description'] || '',
          debit: Number(r['Debit']) || 0,
          credit: Number(r['Credit']) || 0,
          notes: r['Notes'] || '',
          createdBy: r['Created By'] || '',
          createdAt: r['Created At'] || '',
          status: r['Status'] || 'Active',
          reversalOf: r['Reversal Of'] || '',
          isBackdated: !!r['Is Backdated'],
          backdatedDays: Number(r['Backdated Days']) || 0,
          backdatedReason: r['Backdated Reason'] || ''
        };
      })
      .sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        return String(a.entryId).localeCompare(String(b.entryId));
      });

    // If the opening-balance backfill hasn't been run there is no ledger row
    // explaining the account's starting figure, so fall back to the field on
    // the account itself. Once backfilled, that row carries it instead and
    // this term goes to zero — never both, never neither.
    const hasOpeningRow = rows.some(function (r) { return r.type === 'Opening Balance'; });
    let running = hasOpeningRow ? 0 : (Number(account['Opening Balance']) || 0);

    let openingBalance = running;
    const inRange = [];
    let totalDebit = 0, totalCredit = 0;

    rows.forEach(function (r) {
      // Delete-voided rows are already gone from `rows` by this point (see
      // the filter above). What's left and still marked 'Reversed' is only
      // the reverseBankEntry() audit-trail case: the original moved money at
      // the time, and its mirror row moves it back, so both must stay in the
      // running balance — excluding either would break the arithmetic.
      running += r.credit - r.debit;
      if (r.date < from) {
        openingBalance = running;
      } else if (r.date <= to) {
        r.balance = running;
        totalDebit += r.debit;
        totalCredit += r.credit;
        inRange.push(r);
      }
    });

    const closingBalance = inRange.length ? inRange[inRange.length - 1].balance : openingBalance;
    const currentBalance = Number(account['Current Balance']) || 0;
    // running is now the balance after EVERY entry, which must equal the
    // account's stored Current Balance. Sub-cent tolerance for float drift.
    const drift = running - currentBalance;

    return ok_({
      account: {
        id: account['Bank Account ID'],
        name: account['Account Name'],
        bankName: account['Bank Name'] || '',
        accountNumber: account['Account Number'] || '',
        openingBalance: Number(account['Opening Balance']) || 0,
        currentBalance: currentBalance
      },
      range: { from: from, to: to },
      openingBalance: openingBalance,
      closingBalance: closingBalance,
      totalDebit: totalDebit,
      totalCredit: totalCredit,
      entries: inRange.reverse(),   // newest first for reading; balances already computed
      entryCount: inRange.length,
      integrity: {
        computedBalance: running,
        storedBalance: currentBalance,
        drift: drift,
        balanced: Math.abs(drift) < 0.005,
        hasOpeningRow: hasOpeningRow
      }
    });
  } catch (err) {
    logError_('getBankLedger', err);
    return fail_(err.message);
  }
}

// ------------------------------------------------------- manual entries

/**
 * payload = {
 *   bankAccountId, entryType (a BANK_MANUAL_ENTRY_TYPES key), amount,
 *   date (optional 'yyyy-MM-dd'), reference, description, notes,
 *   direction ('debit' | 'credit', required only for 'Bank Adjustment'),
 *   backdatedReason (required when date is in the past)
 * }
 */
function addBankManualEntry(token, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    const user = requirePermission_(token, 'bank', 'add');
    requireActiveCashSession_();
    payload = payload || {};

    const type = bankManualType_(sanitizeInput_(payload.entryType));
    if (!type) return fail_('Choose a valid entry type.');

    if (!isValidNonNegativeNumber_(payload.amount) || Number(payload.amount) <= 0) {
      return fail_('Enter a valid amount greater than zero.');
    }
    const amount = Number(payload.amount);

    const account = getAllRows_('BANK_ACCOUNTS').filter(function (b) {
      return b['Bank Account ID'] === sanitizeInput_(payload.bankAccountId);
    })[0];
    if (!account) return fail_('Bank account not found.');
    if (account['Status'] === 'Inactive') return fail_('That bank account is inactive.');

    // 'Bank Adjustment' is the only type that doesn't know its own direction.
    let direction = type.direction;
    if (direction === 'either') {
      direction = sanitizeInput_(payload.direction);
      if (direction !== 'debit' && direction !== 'credit') {
        return fail_('Choose whether this adjustment adds to or subtracts from the account.');
      }
    }

    const txDate = resolveTransactionDate_(token, 'bank', payload.date, payload.backdatedReason, 'Entry');
    const description = sanitizeInput_(payload.description) || type.label;
    const actor = user['Full Name'] || user['Mobile Number'] || 'staff';

    // Cash deposits and withdrawals move the drawer too, so they need an open
    // session for exactly the same reason a cash sale does.
    const newBalance = addBankBookEntry_(account['Bank Account ID'], {
      Type: type.key,
      Reference: sanitizeInput_(payload.reference),
      Description: description,
      Debit: direction === 'debit' ? amount : '',
      Credit: direction === 'credit' ? amount : '',
      Date: txDate.dateStr,
      Notes: sanitizeInput_(payload.notes),
      CreatedBy: actor,
      IsBackdated: txDate.isBackdated,
      BackdatedDays: txDate.backdatedDays,
      BackdatedReason: txDate.reason
    });

    // Contra leg: cash into the bank leaves the drawer, and vice versa.
    if (type.contra === 'cash') {
      addCashBookEntry_({
        Type: type.key,
        Reference: account['Bank Account ID'],
        Description: description + ' — ' + account['Account Name'],
        Debit: type.key === 'Cash Deposit' ? amount : '',
        Credit: type.key === 'Cash Withdrawal' ? amount : '',
        PaymentMethod: 'Cash',
        Date: txDate.dateStr
      });
    }

    return ok_({ bankAccountId: account['Bank Account ID'], newBalance: newBalance });
  } catch (err) {
    logError_('addBankManualEntry', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Corrects a posted entry by writing its mirror image, rather than editing
 * or deleting anything. The original keeps its amounts and gains
 * Status = 'Reversed'; the new row carries Reversal Of = the original's
 * Entry ID. Both remain in the ledger.
 *
 * The reversal is dated TODAY, not the original's date. That is
 * deliberate: the money genuinely moved on the original date and moved
 * back today, and a period that has already been reported on should not
 * change retroactively.
 *
 * Refuses to reverse a reversal, or to reverse the same entry twice.
 */
function reverseBankEntry(token, entryId, reason) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    const user = requirePermission_(token, 'bank', 'edit');
    requireActiveCashSession_();

    const id = sanitizeInput_(entryId);
    if (!id) return fail_('No entry selected.');
    const cleanReason = sanitizeInput_(reason);
    if (!cleanReason) return fail_('Enter a reason for reversing this entry.');

    const all = getAllRows_('BANK_BOOK');
    const original = all.filter(function (r) { return r['Entry ID'] === id; })[0];
    if (!original) return fail_('Entry not found.');
    if (original['Status'] === 'Reversed') return fail_('This entry has already been reversed.');
    if (original['Reversal Of']) return fail_('This entry is itself a reversal and cannot be reversed again.');

    const alreadyReversed = all.some(function (r) { return r['Reversal Of'] === id; });
    if (alreadyReversed) return fail_('A reversal already exists for this entry.');

    const debit = Number(original['Debit']) || 0;
    const credit = Number(original['Credit']) || 0;
    if (debit === 0 && credit === 0) return fail_('This entry has no amount to reverse.');

    const actor = user['Full Name'] || user['Mobile Number'] || 'staff';

    // Mirror image: the original's debit becomes the reversal's credit.
    addBankBookEntry_(original['Bank Account ID'], {
      Type: 'Reversal',
      Reference: id,
      Description: 'Reversal of ' + id + ' — ' + cleanReason,
      Debit: credit > 0 ? credit : '',
      Credit: debit > 0 ? debit : '',
      Notes: cleanReason,
      CreatedBy: actor,
      ReversalOf: id
    });

    const rowIndex = findRowIndex_('BANK_BOOK', 'Entry ID', id);
    if (rowIndex !== -1) {
      updateRowFields_('BANK_BOOK', rowIndex, { 'Status': 'Reversed' });
    }

    return ok_({ entryId: id });
  } catch (err) {
    logError_('reverseBankEntry', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

// --------------------------------------------------------- backfill

/**
 * Writes the missing "Opening Balance" ledger row for every bank account
 * that doesn't have one, so the ledger can foot from zero.
 *
 * Run from the Google Sheet: "Hardware ERP" -> "Backfill Bank Opening
 * Balances". Safe to re-run — accounts that already have an opening row
 * are skipped.
 *
 * IMPORTANT: this writes the row directly rather than through
 * addBankBookEntry_, because addBankBookEntry_ would also ADD the amount
 * to Current Balance — and Current Balance already includes the opening
 * balance from addBankAccount(). Going through the normal writer would
 * double it. The row's Balance column is set to the opening amount, which
 * is what the running balance is at that point in the account's life.
 */
function backfillBankOpeningEntries_() {
  const ui = SpreadsheetApp.getUi();
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    const accounts = getAllRows_('BANK_ACCOUNTS');
    const existing = {};
    getAllRows_('BANK_BOOK').forEach(function (r) {
      if (r['Type'] === 'Opening Balance') existing[r['Bank Account ID']] = true;
    });

    let created = 0, skipped = 0;
    accounts.forEach(function (a) {
      const id = a['Bank Account ID'];
      if (existing[id]) { skipped++; return; }
      const opening = Number(a['Opening Balance']) || 0;

      appendRow_('BANK_BOOK', {
        'Entry ID': generateId_('BANK_BOOK'),
        'Date': safeDateOnly_(a['Created At']) || formatDate_(new Date()),
        'Bank Account ID': id,
        'Bank Account Name': a['Account Name'],
        'Type': 'Opening Balance',
        'Reference': id,
        'Description': 'Opening balance on account creation',
        'Debit': opening < 0 ? Math.abs(opening) : '',
        'Credit': opening >= 0 ? opening : '',
        'Balance': opening,
        'Status': 'Active',
        'Created By': 'Opening balance backfill',
        'Created At': new Date()
      });
      created++;
    });

    SpreadsheetApp.flush();
    ui.alert(
      'Bank opening balances backfilled',
      created + ' opening entr(ies) created, ' + skipped + ' account(s) already had one.\n\n' +
      'Current Balance on each account is unchanged — it already included the opening figure. ' +
      'This only adds the missing ledger line that explains where it came from.',
      ui.ButtonSet.OK
    );
    return ok_({ created: created, skipped: skipped });
  } catch (err) {
    logError_('backfillBankOpeningEntries', err);
    SpreadsheetApp.getUi().alert('Something went wrong: ' + err.message);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}
