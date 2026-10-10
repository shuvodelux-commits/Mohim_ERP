/**
 * DayBook.gs
 * ---------------------------------------------------------------------
 * THE UNIFIED TRANSACTION CENTRE. Every business transaction the ERP
 * records, from every module, in one chronological feed - cash and bank
 * alike.
 *
 * Still read-only. Nothing in this file writes business data. Open
 * Original, Edit and Delete all route back into the owning module's own
 * functions, so there remains exactly one piece of code that knows how
 * to change a sale, a purchase or an expense. That is what makes a
 * delete performed from this screen recalculate stock, ledgers and
 * balances identically to one performed from the source page.
 *
 * SOURCES AGGREGATED
 *   Sales, Sales Returns, Purchases, Purchase Returns, Expenses,
 *   Customer Payments, Supplier Payments, Bank deposits / withdrawals /
 *   charges / interest / bounced cheques / opening balances, Bank
 *   Transfers, and Stock Adjustments.
 *
 * CASH AND BANK. The old version tracked cashIn/cashOut only, so a
 * bank-paid invoice appeared with zero value and bank activity was
 * invisible. Every row now carries cashIn/cashOut AND bankIn/bankOut,
 * plus a signed `amount` for display. The running balance still follows
 * the cash drawer, because that is the figure that gets counted at
 * close of day; bank balances live in the Bank Ledger where they can be
 * shown per account.
 *
 * THE DOUBLE-COUNTING RULE. A bank-paid sale writes a SALES row and a
 * BANK_BOOK row. Listing both would show the same money twice. So bank
 * entries whose Reference belongs to a document already listed here are
 * skipped, and only standalone bank activity is emitted as its own row.
 * ownedReferences_ below is what enforces that.
 *
 * DELETED ROWS. Soft-deleted records drop out for everyone except an
 * Administrator, who can pass includeDeleted to see them marked
 * 'Deleted' with who removed them and why.
 *
 * ADDING A FUTURE TRANSACTION TYPE. Push another dayBookRow_ into rows[]
 * with a sourceModule the dispatcher understands. Nothing else changes.
 * ---------------------------------------------------------------------
 */

const DAY_BOOK_MODULES = [
  'Sales', 'Sales Return', 'Purchase', 'Purchase Return',
  'Customer Payment', 'Customer Advance Refund', 'Supplier Payment', 'Expense', 'Finance',
  'Bank', 'Bank Transfer', 'Stock Adjustment'
];

/**
 * Which module owns each Day Book row, and therefore whose delete
 * function runs. Keys match dayBookRow_'s sourceModule; values are the
 * moduleKey deleteDayBookEntry / requireDeletePermission_ expect.
 * A row whose sourceModule is absent here is not deletable from here.
 */
const DAY_BOOK_DELETE_MAP = {
  'Sales': 'sales',
  'Purchase': 'purchase',
  'Expense': 'expense',
  'Bank': 'bank',
  'Customer Payment': 'customer payment',
  'Supplier Payment': 'supplier payment',
  'Finance': 'finance'
};

/** Which client page Open Original should jump to for each source module. */
const DAY_BOOK_OPEN_MAP = {
  'Sales': 'sales',
  'Sales Return': 'returnHistory',
  'Purchase': 'purchase',
  'Purchase Return': 'returns',
  'Customer Payment': 'customers',
  'Customer Advance Refund': 'customerLedger',
  'Supplier Payment': 'suppliers',
  'Expense': 'expenseList',
  'Finance': 'financeLedger',
  'Bank': 'bank',
  'Bank Transfer': 'bank',
  'Stock Adjustment': 'products'
};

function getDayBookBootstrap(token) {
  try {
    const user = requirePermission_(token, 'daybook', 'view');
    const settings = getSettingsMap_();
    return ok_({
      currencySymbol: settings['Currency Symbol'] || '',
      editableDays: Number(settings['Day Book Editable Days']) || 0,
      modules: DAY_BOOK_MODULES,
      isAdmin: user['Role'] === 'Administrator'
    });
  } catch (err) {
    logError_('getDayBookBootstrap', err);
    return fail_(err.message);
  }
}

function dayBookRow_(o) {
  const cashIn = o.cashIn || 0, cashOut = o.cashOut || 0;
  const bankIn = o.bankIn || 0, bankOut = o.bankOut || 0;
  return {
    ts: o.ts || '', date: o.date || '', time: o.time || '',
    referenceNo: o.referenceNo || '', module: o.module, transactionType: o.transactionType || '',
    party: o.party || '', description: o.description || '', paymentMethod: o.paymentMethod || '',
    cashIn: cashIn, cashOut: cashOut, bankIn: bankIn, bankOut: bankOut,
    // Signed headline figure: positive = money in, negative = money out.
    amount: (cashIn + bankIn) - (cashOut + bankOut),
    createdBy: o.createdBy || '', status: o.status || 'Active',
    isDeleted: !!o.isDeleted, deletedBy: o.deletedBy || '', deleteReason: o.deleteReason || '',
    isBackdated: !!o.isBackdated, backdatedDays: o.backdatedDays || 0, backdatedReason: o.backdatedReason || '',
    sourceModule: o.sourceModule, sourceId: o.sourceId,
    // Open Original: the page to show and the record to focus.
    openPage: DAY_BOOK_OPEN_MAP[o.sourceModule] || '',
    openId: o.openId || o.sourceId || '',
    // Delete: the module key whose delete function owns this row.
    deleteModule: DAY_BOOK_DELETE_MAP[o.sourceModule] || '',
    deleteId: o.deleteId || o.sourceId || ''
  };
}

/**
 * Extracts 'HH:mm:ss' straight from the 'yyyy-MM-ddTHH:mm:ss' string
 * getAllRows_ already produces - never re-parses via new Date(), which is
 * exactly the UTC/local day-shift trap this codebase already hit once
 * (see javascript.html's formatInvoiceDate_ comment).
 */
function dayBookTimeFromTs_(ts) {
  if (!ts) return '';
  const s = String(ts);
  const tIdx = s.indexOf('T');
  return tIdx !== -1 ? s.slice(tIdx + 1) : '';
}

/**
 * A sale's payment method. Blank means the row predates the Payment
 * Method column, and those were all cash.
 */
function dayBookSalePaymentMethod_(sale) {
  return sale['Payment Method'] || 'Cash';
}

/** True when a sale's collected amount really went into the cash drawer. */
function dayBookIsCashSale_(sale) {
  return dayBookSalePaymentMethod_(sale) === 'Cash';
}

/** Same inference for a purchase, now that PURCHASES carries a Payment Method. */
function dayBookPurchasePaymentMethod_(purchase) {
  return purchase['Payment Method'] || 'Cash';
}

/**
 * Every reference already represented by a document row, so the Bank Book
 * pass can skip its duplicates. Without this a bank-paid invoice would be
 * listed twice and the day's totals would double.
 */
function ownedReferences_(sales, purchases, expenses, custPayments, supPayments, financeTxns, bankTransfers) {
  const owned = {};
  sales.forEach(function (s) { owned[s['Invoice ID']] = true; });
  purchases.forEach(function (p) { owned[p['Purchase ID']] = true; });
  expenses.forEach(function (e) { owned[e['Expense ID']] = true; });
  custPayments.forEach(function (l) { owned[l['Ledger ID']] = true; if (l['Customer ID']) owned[l['Customer ID']] = true; });
  supPayments.forEach(function (l) { owned[l['Ledger ID']] = true; if (l['Supplier ID']) owned[l['Supplier ID']] = true; });
  (financeTxns || []).forEach(function (f) { owned[f['Finance ID']] = true; });
  (bankTransfers || []).forEach(function (t) { owned[t['Transfer ID']] = true; });
  return owned;
}

/**
 * filters = { dateFrom, dateTo, module, query, backdatedOnly,
 *             paymentMethod, includeDeleted } - all optional.
 */
function getDayBookTransactions(token, filters) {
  try {
    const user = requirePermission_(token, 'daybook', 'view');
    filters = filters || {};
    const dateFrom = sanitizeInput_(filters.dateFrom);
    const dateTo = sanitizeInput_(filters.dateTo);
    const moduleFilter = sanitizeInput_(filters.module);
    const methodFilter = sanitizeInput_(filters.paymentMethod);
    const query = sanitizeInput_(filters.query).toLowerCase();
    const backdatedOnly = !!filters.backdatedOnly;
    const isAdmin = user['Role'] === 'Administrator';
    const includeDeleted = isAdmin && !!filters.includeDeleted;
    const allSales = getAllRows_('SALES');
    const sales = allSales.filter(function (r) { return includeDeleted || !isDeleted_(r); });
    assertUniqueSalesInvoiceIds_(sales, 'Day Book', allSales);

    // Day Book is read-only. Cache the normalized result briefly because the
    // dashboard and transaction centre can request the same window repeatedly.
    // Permission is checked before this cache is used.
    const generation = (function () {
      try { return CacheService.getScriptCache().get('db:v2:derived:generation:daybook') || '0'; }
      catch (e) { return '0'; }
    })();
    const dayBookCacheKey = 'db:v2:derived:daybook:' + generation + ':' + [dateFrom, dateTo, moduleFilter, methodFilter, query, backdatedOnly, includeDeleted, isAdmin].join('|');
    try {
      const cached = CacheService.getScriptCache().get(dayBookCacheKey);
      if (cached) return ok_(JSON.parse(cached));
    } catch (e) {}

    // An Administrator asking for deleted rows gets everything; everyone
    // else only ever sees live records.
    const keep = function (r) { return includeDeleted || !isDeleted_(r); };

    const purchases = getAllRows_('PURCHASES').filter(keep);
    const expenses = getAllRows_('EXPENSES').filter(keep);
    const customerLedgerRows = getAllRows_('CUSTOMER_LEDGER');
    const custPayments = customerLedgerRows.filter(function (l) { return l['Type'] === 'Payment' && keep(l); });
    const custAdvanceRefunds = customerLedgerRows.filter(function (l) { return l['Type'] === 'Advance Refund' && keep(l); });
    const supplierLedgerRows = getAllRows_('SUPPLIER_LEDGER');
    const supPayments = supplierLedgerRows.filter(function (l) { return l['Type'] === 'Payment' && keep(l); });
    // Cash Book remains a supporting source for the running drawer balance.
    // Session opening/closing reconciliation is intentionally NOT emitted as
    // Day Book rows; that audit now lives in Cash Reconciliation.
    const cashBookRows = activeRows_('CASH_BOOK');

    const rows = [];
    const del = function (r) {
      return { isDeleted: isDeleted_(r), deletedBy: r['Deleted By'] || '', deleteReason: r['Delete Reason'] || '' };
    };

    // ---------------- Sales ----------------
    sales.forEach(function (s) {
      const method = dayBookSalePaymentMethod_(s);
      const paid = Number(s['Paid Amount']) || 0;
      const d = del(s);
      rows.push(dayBookRow_({
        ts: s['Created At'], date: safeDateOnly_(s['Date']), time: safeTimeOnly_(s['Time']),
        referenceNo: s['Invoice ID'], module: 'Sales',
        transactionType: (s['Payment Type'] || '') + ' Sale',
        party: s['Customer Name'],
        description: 'POS sale' + (s['Customer Phone'] ? ' — ' + s['Customer Phone'] : ''),
        paymentMethod: method,
        cashIn: method === 'Cash' ? paid : 0,
        bankIn: isBankLikePaymentMethod_(method) ? paid : 0,
        createdBy: s['Created By'], status: d.isDeleted ? 'Deleted' : s['Payment Status'],
        isDeleted: d.isDeleted, deletedBy: d.deletedBy, deleteReason: d.deleteReason,
        isBackdated: s['Is Backdated'], backdatedDays: Number(s['Backdated Days']) || 0, backdatedReason: s['Backdated Reason'] || '',
        sourceModule: 'Sales', sourceId: s['Invoice ID']
      }));
    });

    // ---------------- Sales Returns ----------------
    getAllRows_('SALES_RETURN').filter(keep).forEach(function (r) {
      const method = r['Refund Method'] || 'Cash';
      const amt = Number(r['Total Return Amount']) || 0;
      const d = del(r);
      rows.push(dayBookRow_({
        ts: r['Created At'], date: safeDateOnly_(r['Date']),
        referenceNo: r['Return ID'], module: 'Sales Return',
        transactionType: method + ' Refund', party: r['Customer Name'],
        description: 'Return against ' + r['Invoice ID'] + (r['Reason'] ? ' — ' + r['Reason'] : ''),
        paymentMethod: method === 'Cash' ? 'Cash' : (method === 'Bank' ? 'Bank' : 'Store Credit'),
        cashOut: method === 'Cash' ? amt : 0,
        bankOut: method === 'Bank' ? amt : 0,
        createdBy: r['Processed By'], status: d.isDeleted ? 'Deleted' : 'Active',
        isDeleted: d.isDeleted, deletedBy: d.deletedBy, deleteReason: d.deleteReason,
        isBackdated: r['Is Backdated'], backdatedDays: Number(r['Backdated Days']) || 0, backdatedReason: r['Backdated Reason'] || '',
        sourceModule: 'Sales Return', sourceId: r['Return ID'], openId: r['Invoice ID']
      }));
    });

    // ---------------- Purchases ----------------
    purchases.forEach(function (p) {
      const method = dayBookPurchasePaymentMethod_(p);
      const paid = Number(p['Paid Amount']) || 0;
      const d = del(p);
      rows.push(dayBookRow_({
        ts: p['Created At'], date: safeDateOnly_(p['Date']),
        referenceNo: p['Purchase ID'], module: 'Purchase',
        transactionType: (p['Payment Status'] || '') + ' Purchase',
        party: p['Supplier Name'], description: p['Notes'] || 'Stock purchase',
        paymentMethod: method,
        cashOut: method === 'Cash' ? paid : 0,
        bankOut: isBankLikePaymentMethod_(method) ? paid : 0,
        status: d.isDeleted ? 'Deleted' : p['Payment Status'], createdBy: p['Created By'],
        isDeleted: d.isDeleted, deletedBy: d.deletedBy, deleteReason: d.deleteReason,
        isBackdated: p['Is Backdated'], backdatedDays: Number(p['Backdated Days']) || 0, backdatedReason: p['Backdated Reason'] || '',
        sourceModule: 'Purchase', sourceId: p['Purchase ID']
      }));
    });

    // ---------------- Purchase Returns ----------------
    // No stored Refund Method column - inferred from whether a Supplier
    // Credit ledger entry exists, since completePurchaseReturn's two paths
    // are mutually exclusive and one of them always writes that row.
    const purchaseReturnCreditRefs = {};
    supplierLedgerRows.forEach(function (l) {
      if (l['Type'] === 'Purchase Return Credit') purchaseReturnCreditRefs[l['Reference']] = true;
    });
    getAllRows_('PURCHASE_RETURN').filter(keep).forEach(function (r) {
      const isCash = !purchaseReturnCreditRefs[r['Return ID']];
      const amt = Number(r['Total Return Amount']) || 0;
      const d = del(r);
      rows.push(dayBookRow_({
        ts: r['Created At'], date: safeDateOnly_(r['Date']),
        referenceNo: r['Return ID'], module: 'Purchase Return',
        transactionType: 'Purchase Return', party: r['Supplier Name'],
        description: 'Return against ' + r['Purchase ID'] + (r['Reason'] ? ' — ' + r['Reason'] : ''),
        paymentMethod: isCash ? 'Cash' : 'Supplier Credit',
        cashIn: isCash ? amt : 0,
        createdBy: r['Processed By'], status: d.isDeleted ? 'Deleted' : 'Active',
        isDeleted: d.isDeleted, deletedBy: d.deletedBy, deleteReason: d.deleteReason,
        isBackdated: r['Is Backdated'], backdatedDays: Number(r['Backdated Days']) || 0, backdatedReason: r['Backdated Reason'] || '',
        sourceModule: 'Purchase Return', sourceId: r['Return ID'], openId: r['Purchase ID']
      }));
    });

    // ---------------- Customer payments ----------------
    custPayments.forEach(function (l) {
      const method = l['Payment Method'] || 'Cash';
      const amt = settlementPaymentAmount_(l);
      const discount = settlementDiscountAmount_(l);
      const d = del(l);
      rows.push(dayBookRow_({
        ts: l['Created At'] || l['Date'], date: safeDateOnly_(l['Date']),
        referenceNo: l['Ledger ID'], module: 'Customer Payment',
        transactionType: 'Due Collection', party: l['Customer Name'],
        description: (l['Notes'] || 'Payment received') + (discount > 0 ? ' — Discount ' + discount : ''),
        paymentMethod: method,
        cashIn: method === 'Cash' ? amt : 0,
        bankIn: isBankLikePaymentMethod_(method) ? amt : 0,
        createdBy: l['Created By'],
        status: d.isDeleted ? 'Deleted' : 'Active',
        isDeleted: d.isDeleted, deletedBy: d.deletedBy, deleteReason: d.deleteReason,
        isBackdated: l['Is Backdated'], backdatedDays: Number(l['Backdated Days']) || 0, backdatedReason: l['Backdated Reason'] || '',
        sourceModule: 'Customer Payment', sourceId: l['Ledger ID'], openId: l['Customer ID']
      }));
    });

    // ---------------- Customer Advance Refunds ----------------
    custAdvanceRefunds.forEach(function (l) {
      const method = l['Payment Method'] || 'Cash';
      const amt = Number(l['Debit']) || Number(l['Payment Amount']) || 0;
      const d = del(l);
      rows.push(dayBookRow_({
        ts: l['Created At'] || l['Date'], date: safeDateOnly_(l['Date']),
        referenceNo: l['Ledger ID'], module: 'Customer Advance Refund',
        transactionType: 'Advance Refund', party: l['Customer Name'],
        description: l['Notes'] || 'Customer advance refunded',
        paymentMethod: method,
        cashOut: method === 'Cash' ? amt : 0,
        bankOut: isBankLikePaymentMethod_(method) ? amt : 0,
        createdBy: l['Created By'],
        status: d.isDeleted ? 'Deleted' : 'Active',
        isDeleted: d.isDeleted, deletedBy: d.deletedBy, deleteReason: d.deleteReason,
        isBackdated: l['Is Backdated'], backdatedDays: Number(l['Backdated Days']) || 0, backdatedReason: l['Backdated Reason'] || '',
        sourceModule: 'Customer Advance Refund', sourceId: l['Ledger ID'], openId: l['Customer ID']
      }));
    });

    // ---------------- Supplier payments ----------------
    supPayments.forEach(function (l) {
      const method = l['Payment Method'] || 'Cash';
      const amt = settlementPaymentAmount_(l);
      const discount = settlementDiscountAmount_(l);
      const d = del(l);
      rows.push(dayBookRow_({
        ts: l['Created At'] || l['Date'], date: safeDateOnly_(l['Date']),
        referenceNo: l['Ledger ID'], module: 'Supplier Payment',
        transactionType: 'Due Payment', party: l['Supplier Name'],
        description: (l['Notes'] || 'Payment made') + (discount > 0 ? ' — Discount ' + discount : ''),
        paymentMethod: method,
        cashOut: method === 'Cash' ? amt : 0,
        bankOut: isBankLikePaymentMethod_(method) ? amt : 0,
        createdBy: l['Created By'],
        status: d.isDeleted ? 'Deleted' : 'Active',
        isDeleted: d.isDeleted, deletedBy: d.deletedBy, deleteReason: d.deleteReason,
        isBackdated: l['Is Backdated'], backdatedDays: Number(l['Backdated Days']) || 0, backdatedReason: l['Backdated Reason'] || '',
        sourceModule: 'Supplier Payment', sourceId: l['Ledger ID'], openId: l['Supplier ID']
      }));
    });

    // ---------------- Expenses ----------------
    expenses.forEach(function (e) {
      const cancelled = e['Status'] === 'Cancelled';
      const method = e['Payment Method'] || 'Cash';
      const amt = Number(e['Amount']) || 0;
      const live = !cancelled && !isDeleted_(e);
      const d = del(e);
      rows.push(dayBookRow_({
        ts: e['Created At'], date: safeDateOnly_(e['Date']),
        referenceNo: e['Expense ID'], module: 'Expense',
        transactionType: e['Category Name'] || 'Expense',
        party: e['Ledger Name'] || '', description: e['Description'] || '',
        paymentMethod: method,
        cashOut: (live && method === 'Cash') ? amt : 0,
        bankOut: (live && isBankLikePaymentMethod_(method)) ? amt : 0,
        createdBy: e['Created By'],
        status: d.isDeleted ? 'Deleted' : (cancelled ? 'Cancelled' : 'Active'),
        isDeleted: d.isDeleted, deletedBy: d.deletedBy, deleteReason: d.deleteReason,
        isBackdated: e['Is Backdated'], backdatedDays: Number(e['Backdated Days']) || 0, backdatedReason: e['Backdated Reason'] || '',
        sourceModule: 'Expense', sourceId: e['Expense ID']
      }));
    });

    // ---------------- Finance (Business Finance: capital & loans) ----------------
    const financeTxns = getAllRows_('FINANCE_TRANSACTIONS').filter(keep);
    financeTxns.forEach(function (f) {
      const type = financeTransactionType_(f['Transaction Type']);
      const cashDirection = type ? type.cashDirection : 'none';
      const method = cashDirection === 'none' ? '' : (f['Payment Method'] || 'Cash');
      const amt = Number(f['Amount']) || 0;
      const isIn = cashDirection === 'in';
      const isOut = cashDirection === 'out';
      const d = del(f);
      rows.push(dayBookRow_({
        ts: f['Created At'] || f['Date'], date: safeDateOnly_(f['Date']),
        referenceNo: f['Finance ID'], module: 'Finance',
        transactionType: type ? type.label : f['Transaction Type'],
        party: f['Person'] || '',
        description: (f['Notes'] || (type ? type.label : 'Finance entry')) + (f['Reference No'] ? ' — ' + f['Reference No'] : ''),
        paymentMethod: method,
        cashIn: (method === 'Cash' && isIn) ? amt : 0,
        cashOut: (method === 'Cash' && isOut) ? amt : 0,
        bankIn: (isBankLikePaymentMethod_(method) && isIn) ? amt : 0,
        bankOut: (isBankLikePaymentMethod_(method) && isOut) ? amt : 0,
        createdBy: f['Created By'], status: d.isDeleted ? 'Deleted' : 'Active',
        isDeleted: d.isDeleted, deletedBy: d.deletedBy, deleteReason: d.deleteReason,
        isBackdated: f['Is Backdated'], backdatedDays: Number(f['Backdated Days']) || 0, backdatedReason: f['Backdated Reason'] || '',
        sourceModule: 'Finance', sourceId: f['Finance ID']
      }));
    });

    // ---------------- Standalone bank activity ----------------
    // Deposits, withdrawals, charges, interest, bounced cheques, opening
    // balances - anything in the Bank Book that no document above already
    // accounts for. Reversed entries are shown as Deleted, never counted.
    const bankTransfers = getAllRows_('BANK_TRANSFERS');
    const owned = ownedReferences_(sales, purchases, expenses, custPayments.concat(custAdvanceRefunds), supPayments, financeTxns, bankTransfers);
    const bankBookRows = getAllRows_('BANK_BOOK');
    const bankReversalTargets = {};
    bankBookRows.forEach(function (b) {
      if (b['Reversal Of']) bankReversalTargets[String(b['Reversal Of'])] = true;
    });
    bankBookRows.forEach(function (b) {
      const ref = String(b['Reference'] || '');
      if (ref && owned[ref]) return;                       // already listed by its document
      const manuallyReversed = b['Status'] === 'Reversed' && bankReversalTargets[String(b['Entry ID'] || '')];
      const deleteVoided = b['Status'] === 'Reversed' && !manuallyReversed;
      if (deleteVoided && !includeDeleted) return;
      const debit = Number(b['Debit']) || 0;
      const credit = Number(b['Credit']) || 0;
      rows.push(dayBookRow_({
        ts: b['Created At'] || b['Date'], date: safeDateOnly_(b['Date']),
        referenceNo: b['Entry ID'], module: 'Bank',
        transactionType: b['Type'] || 'Bank Entry',
        party: b['Bank Account Name'] || '',
        description: b['Description'] || '',
        paymentMethod: 'Bank',
        bankIn: deleteVoided ? 0 : credit,
        bankOut: deleteVoided ? 0 : debit,
        createdBy: b['Created By'], status: deleteVoided ? 'Deleted' : (manuallyReversed ? 'Reversed' : 'Active'),
        isDeleted: deleteVoided, deletedBy: '', deleteReason: b['Notes'] || '',
        isBackdated: b['Is Backdated'], backdatedDays: Number(b['Backdated Days']) || 0, backdatedReason: b['Backdated Reason'] || '',
        sourceModule: 'Bank', sourceId: b['Entry ID']
      }));
    });

    // ---------------- Bank transfers ----------------
    // One physical movement between two accounts. Shown as a single row so
    // the feed reads the way the owner thinks about it, with net zero
    // effect on the business - it is neither income nor expense.
    bankTransfers.forEach(function (t) {
      rows.push(dayBookRow_({
        ts: t['Created At'] || t['Date'], date: safeDateOnly_(t['Date']),
        referenceNo: t['Transfer ID'] || '', module: 'Bank Transfer',
        transactionType: 'Bank Transfer',
        party: (t['From Account Name'] || '') + ' → ' + (t['To Account Name'] || ''),
        description: t['Notes'] || 'Transfer between accounts',
        paymentMethod: 'Bank',
        createdBy: t['Created By'] || '', status: 'Active',
        sourceModule: 'Bank Transfer', sourceId: t['Transfer ID'] || ''
      }));
    });

    // ---------------- Stock adjustments ----------------
    // No money moves, but it is a business transaction the owner needs to
    // see next to everything else - which is the whole point of this page.
    getAllRows_('STOCK_MOVEMENT').filter(function (m) {
      return String(m['Type'] || '').indexOf('Adjust') !== -1;
    }).forEach(function (m) {
      const qtyIn = Number(m['Quantity In']) || 0;
      const qtyOut = Number(m['Quantity Out']) || 0;
      rows.push(dayBookRow_({
        ts: m['Date'], date: safeDateOnly_(m['Date']),
        referenceNo: m['Movement ID'], module: 'Stock Adjustment',
        transactionType: m['Type'] || 'Stock Adjustment',
        party: m['Product Name'] || '',
        description: (m['Notes'] || 'Stock adjusted') + ' (' + (qtyIn ? '+' + qtyIn : '-' + qtyOut) + ')',
        paymentMethod: '', status: 'Active',
        sourceModule: 'Stock Adjustment', sourceId: m['Product ID'] || ''
      }));
    });

    // ---- Running drawer balance: use Cash Book movements, not inferred UI amounts. ----
    // Cash Book's Date is a *business date*, often stored as YYYY-MM-DD
    // (or midnight after Sheets date serialization). It is NOT the posting
    // time. Treating it as a timestamp applied every day's cash movements
    // before the first transaction, producing the same balance on each row.
    rows.forEach(function (row) { row.ts = String(row.ts || ''); });
    rows.sort(function (a, b) { return a.ts.localeCompare(b.ts); });

    // For old Cash Book rows without Created At, the owning document provides
    // the best known timestamp. In one-second ties, attach the movement to
    // its own transaction rather than applying it to all rows at that second.
    const cashSources = {};
    rows.forEach(function (row, index) {
      if (row.referenceNo && row.ts && (row.cashIn || row.cashOut) && !row.isDeleted) {
        cashSources[String(row.referenceNo)] = { ts: row.ts, index: index };
      }
    });
    const cashBookSorted = cashBookRows.map(function (c) {
      const ref = String(c['Reference'] || '');
      const source = cashSources[ref];
      const postedAt = String(c['Created At'] || '');
      const businessDate = String(c['Date'] || '');
      const dateOnly = /^\\d{4}-\\d{2}-\\d{2}(?:T00:00:00)?$/.test(businessDate);
      // A new entry normally posts seconds after the parent row is written.
      // Group that same operation with its source; later correction entries
      // retain their own posting time instead of changing historical order.
      const nearSource = !!(postedAt && source &&
        Math.abs(new Date(postedAt).getTime() - new Date(source.ts).getTime()) <= 30000);
      const ts = nearSource ? source.ts : (postedAt || (dateOnly && source ? source.ts : businessDate));
      return {
        ts: ts,
        sourceIndex: source && source.ts === ts ? source.index : -1,
        delta: (Number(c['Credit']) || 0) - (Number(c['Debit']) || 0)
      };
    }).sort(function (a, b) {
      return a.ts.localeCompare(b.ts) || a.sourceIndex - b.sourceIndex;
    });

    let cbPointer = 0, currentBalance = null;
    rows.forEach(function (row, index) {
      while (cbPointer < cashBookSorted.length &&
        (cashBookSorted[cbPointer].ts < row.ts ||
          (cashBookSorted[cbPointer].ts === row.ts && cashBookSorted[cbPointer].sourceIndex <= index))) {
        currentBalance = roundMoney_((currentBalance === null ? 0 : currentBalance) + cashBookSorted[cbPointer].delta);
        cbPointer++;
      }
      row.runningCashBalance = currentBalance;
      if (!row.time) row.time = dayBookTimeFromTs_(row.ts);
    });

    const filtered = rows.filter(function (row) {
      if (dateFrom && row.date < dateFrom) return false;
      if (dateTo && row.date > dateTo) return false;
      if (moduleFilter && row.module !== moduleFilter) return false;
      if (methodFilter && row.paymentMethod !== methodFilter) return false;
      if (backdatedOnly && !row.isBackdated) return false;
      if (query) {
        const hay = (row.referenceNo + ' ' + row.party + ' ' + row.description + ' ' + row.transactionType).toLowerCase();
        if (hay.indexOf(query) === -1) return false;
      }
      return true;
    });

    filtered.sort(function (a, b) { return b.ts.localeCompare(a.ts); });

    // Totals for the filtered window, so the page can show a summary bar
    // that always matches the rows actually on screen.
    const totals = { cashIn: 0, cashOut: 0, bankIn: 0, bankOut: 0 };
    filtered.forEach(function (r) {
      if (r.isDeleted) return;
      totals.cashIn = roundMoney_(totals.cashIn + r.cashIn); totals.cashOut = roundMoney_(totals.cashOut + r.cashOut);
      totals.bankIn = roundMoney_(totals.bankIn + r.bankIn); totals.bankOut = roundMoney_(totals.bankOut + r.bankOut);
    });
    totals.netCash = roundMoney_(totals.cashIn - totals.cashOut);
    totals.netBank = roundMoney_(totals.bankIn - totals.bankOut);

    const result = { rows: filtered, totals: totals, isAdmin: isAdmin, count: filtered.length };
    try {
      const raw = JSON.stringify(result);
      if (raw.length <= 90000) CacheService.getScriptCache().put(dayBookCacheKey, raw, 15);
    } catch (e) {}
    return ok_(result);
  } catch (err) {
    logError_('getDayBookTransactions', err);
    return fail_(err.message);
  }
}