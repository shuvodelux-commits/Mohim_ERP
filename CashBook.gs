/**
 * CashBook.gs
 * ---------------------------------------------------------------------
 * Every real ERP action that moves physical cash — a cash/partial sale,
 * purchase payment, customer payment, expense, finance movement, etc. —
 * writes through addCashBookEntry_() so there is exactly one running
 * Balance, computed the same way every time.
 *
 * Cash Session is not a substitute for those transactions. The first-ever
 * session may establish the initial cash baseline once; later Session Open
 * rows are zero-value boundary markers. Opening/closing count differences are
 * explained by linking the real ERP transaction in Cash Reconciliation.
 *
 * Review item 6 / P0 #4: addCashBookEntry_ hardcoded 'Date': new Date(),
 * so a sale or expense dated last week posted its CASH side to TODAY.
 * That inflated today's open drawer (getCashSessionSummary counts every
 * Cash Book row since the session opened) and mis-placed the entry in
 * Day Book's running cash balance. It now takes an optional Date, and
 * the create paths pass their own transaction date through. Mirrors the
 * same change already made to addBankBookEntry_.
 *
 * Optional means optional: any caller that passes no Date still gets
 * now(), so nothing that wasn't updated changes behaviour.
 *
 * Note on the Balance column: it is a running total in POSTING order,
 * not date order. Once entries can be backdated those differ. The final
 * figure stays correct either way — each row is previous + delta, so the
 * last row reflects the balance when it was posted. Later soft-deletes
 * can invalidate stored balances, so getCashBalance_ sums live movements.
 * The intermediate per-row Balance values are non-chronological. Day Book already sorts by timestamp before
 * walking them, and the Cash & Bank report recomputes from opening.
 * ---------------------------------------------------------------------
 */

/**
 * Appends one Cash Book row and returns the new running balance.
 * fields: { Type, Reference, Description, Debit, Credit, PaymentMethod, Date }
 * Date is optional ('yyyy-MM-dd' or a Date); omit it for now().
 * preloadedBalance is optional for callers that already loaded CASH_BOOK;
 * using it avoids repeating the same sheet scan inside one locked operation.
 * Debit = cash going out, Credit = cash coming in. Pass '' (not 0) for
 * whichever side doesn't apply, so the sheet stays visually clean.
 */
function addCashBookEntry_(fields, preloadedBalance) {
  const hasPreloadedBalance = preloadedBalance !== undefined && preloadedBalance !== null;
  const lastBalance = hasPreloadedBalance ? roundMoney_(Number(preloadedBalance) || 0) : getCashBalance_();
  const debit = roundMoney_(Number(fields.Debit) || 0);
  const credit = roundMoney_(Number(fields.Credit) || 0);
  const newBalance = roundMoney_(lastBalance + credit - debit);

  appendRow_('CASH_BOOK', {
    'Entry ID': generateId_('CASH_BOOK'),
    // Transaction date. Defaults to now() so callers that pass nothing
    // behave exactly as before.
    'Date': fields.Date || new Date(),
    // Keep the business date above for backdated transactions, but preserve
    // the actual posting time for an accurate Day Book running balance.
    'Created At': fields.CreatedAt || new Date(),
    'Type': fields.Type || '',
    'Reference': fields.Reference || '',
    'Description': fields.Description || '',
    'Debit': fields.Debit === '' || fields.Debit === undefined ? '' : debit,
    'Credit': fields.Credit === '' || fields.Credit === undefined ? '' : credit,
    'Balance': newBalance,
    'Payment Method': fields.PaymentMethod || 'Cash'
  });

  return newBalance;
}

/** Current cash-on-hand, excluding voided entries even when later rows exist. */
function getCashBalance_(preloadedRows) {
  const rows = Array.isArray(preloadedRows) ? preloadedRows : activeRows_('CASH_BOOK');
  return roundMoney_(rows.reduce(function (balance, row) {
    return balance + (Number(row['Credit']) || 0) - (Number(row['Debit']) || 0);
  }, 0));
}