/**
 * DeleteEngine.gs
 * ---------------------------------------------------------------------
 * The Delete System. One file, because every delete in this app has to
 * do the same four things in the same order and getting that order
 * wrong is how ledgers drift:
 *
 *   1. CHECK   - requireDeletePermission_ (role + module + day window)
 *   2. BLOCK   - refuse if reversing would corrupt something downstream
 *   3. REVERSE - stock, cash, bank, customer/supplier balances
 *   4. MARK    - soft-delete the header row, then write the Delete Log
 *
 * WHY SOFT DELETE. Nothing is ever physically removed. Each affected row
 * gets 'Is Deleted' = 'TRUE' plus who/when/why. Normal users stop seeing
 * it; an Administrator can still pull it up through getDeletedRecords().
 * An invoice number never silently vanishes from the sequence, and any
 * figure that ever looked wrong can be explained months later.
 *
 * WHY REVERSE BY HIDING, NOT BY POSTING COUNTER-ENTRIES. Both keep the
 * balances right. Posting counter-entries would also leave two extra
 * rows in the Day Book for every mistake, which is exactly the noise a
 * shop owner correcting a typo does not want to read. So the original
 * entries are soft-deleted instead and every balance reader filters them
 * out. The audit trail lives in the hidden rows and the Delete Log, not
 * in the working ledger. This is what makes "delete the wrong entry,
 * then key it in again properly" leave a clean book.
 *
 * THE ONE RULE FOR EVERY READER. Any function that sums money or counts
 * stock must read through activeRows_() rather than getAllRows_(). The
 * accompanying patches do that for Cash Book, Bank Ledger, Day Book,
 * Sales, Purchases, Expenses, Products, Suppliers and Customers.
 *
 * CHILD ROWS ARE NOT MARKED. Sale Items / Purchase Items are always read
 * by their parent's ID, so hiding the parent hides them. Marking them
 * too would be 20 extra writes per delete for no visible difference.
 *
 * BANK BOOK IS DIFFERENT. It already had a Status column ('Active' /
 * 'Reversed') from the Bank Ledger audit work, so bank entries are voided
 * through that existing mechanism instead of a second parallel one.
 * ---------------------------------------------------------------------
 */

/** Modules the delete system knows about. Used by the Roles grid and the Day Book dispatcher. */
var DELETABLE_MODULES = [
  { key: 'sales',     label: 'Sales Invoice' },
  { key: 'purchase',  label: 'Purchase' },
  { key: 'expense',   label: 'Expense' },
  { key: 'suppliers', label: 'Supplier' },
  { key: 'products',  label: 'Product' },
  { key: 'customers', label: 'Customer' },
  { key: 'bank',      label: 'Bank Transaction' },
  { key: 'finance',   label: 'Finance Transaction' },
  { key: 'vendors',   label: 'Vendor Transaction' }
];

// ------------------------------------------------------------------
// Soft-delete primitives
// ------------------------------------------------------------------

/**
 * True when a row has been soft-deleted. Sheets hands back a real boolean
 * for a cell someone typed as TRUE and the string 'TRUE' for one we wrote,
 * so both are accepted. Blank (every pre-existing row) is not deleted.
 */
function isDeleted_(row) {
  if (!row) return false;
  var v = row['Is Deleted'];
  if (v === true) return true;
  return String(v || '').toUpperCase() === 'TRUE';
}

/** getAllRows_ minus anything soft-deleted. Every balance/list reader should use this. */
function activeRows_(sheetKey) {
  return getAllRows_(sheetKey).filter(function (r) { return !isDeleted_(r); });
}

/** Display name for the Deleted By / Delete Log columns. */
function deleteActor_(user) {
  if (!user) return 'staff';
  return user['Full Name'] || user['Mobile Number'] || 'staff';
}

/** Stamps the four soft-delete columns on one row. */
function markRowDeleted_(sheetKey, rowIndex, user, reason, when) {
  updateRowFields_(sheetKey, rowIndex, {
    'Is Deleted': 'TRUE',
    'Deleted By': deleteActor_(user),
    'Deleted At': when || new Date(),
    'Delete Reason': sanitizeInput_(reason)
  });
}

/**
 * Soft-deletes every not-yet-deleted row a predicate matches.
 * Safe to iterate because soft delete never shifts row indexes -- the
 * reason the whole system is built this way rather than on deleteRow_.
 */
function markMatchingDeleted_(sheetKey, matchFn, user, reason, when) {
  var hits = getAllRows_(sheetKey).filter(function (r) {
    return !isDeleted_(r) && matchFn(r);
  });
  hits.forEach(function (r) { markRowDeleted_(sheetKey, r._rowIndex, user, reason, when); });
  return hits.length;
}

/**
 * Voids Bank Book entries pointing at a reference, using BANK_BOOK's own
 * Status column, and unwinds each one from the account's Current Balance.
 * A voided row stays visible in the audit ledger marked Reversed.
 */
/** Returns the active Bank Book row for a source transaction reference, newest first. */
function activeBankEntryForReference_(reference) {
  var rows = getAllRows_('BANK_BOOK').filter(function (e) {
    return e['Reference'] === reference && e['Status'] !== 'Reversed';
  });
  if (!rows.length) return null;
  rows.sort(function (a, b) { return (b._rowIndex || 0) - (a._rowIndex || 0); });
  return rows[0];
}

/** Resolves the bank/mobile account that an existing payment-like row actually used. */
function paymentAccountForReference_(row, reference) {
  if (!row || !isBankLikePaymentMethod_(row['Payment Method'])) return '';
  if (row['Bank Account ID']) return row['Bank Account ID'];
  var entry = activeBankEntryForReference_(reference);
  return entry ? (entry['Bank Account ID'] || '') : '';
}

function voidBankEntriesFor_(reference, user, reason) {
  var entries = getAllRows_('BANK_BOOK').filter(function (e) {
    return e['Reference'] === reference && e['Status'] !== 'Reversed';
  });
  entries.forEach(function (e) {
    unwindBankEntryFromBalance_(e);
    updateRowFields_('BANK_BOOK', e._rowIndex, {
      'Status': 'Reversed',
      'Notes': appendNote_(e['Notes'], 'Voided by ' + deleteActor_(user) + ': ' + sanitizeInput_(reason))
    });
  });
  return entries.length;
}

/** Takes one bank entry back out of its account's Current Balance. */
function unwindBankEntryFromBalance_(entry) {
  var accId = entry['Bank Account ID'];
  var idx = findRowIndex_('BANK_ACCOUNTS', 'Bank Account ID', accId);
  if (idx === -1) return;
  var acc = getAllRows_('BANK_ACCOUNTS').filter(function (b) { return b['Bank Account ID'] === accId; })[0];
  var debit = Number(entry['Debit']) || 0;
  var credit = Number(entry['Credit']) || 0;
  // addBankBookEntry_ applied (credit - debit); undo it.
  var restored = (Number(acc['Current Balance']) || 0) - credit + debit;
  updateRowFields_('BANK_ACCOUNTS', idx, { 'Current Balance': restored });
}

/** Appends a sentence to an existing note without losing what was there. */
function appendNote_(existing, addition) {
  var base = String(existing || '').trim();
  return base ? base + ' | ' + addition : addition;
}

/** Adds delta to a supplier's Current Due and returns the new figure. */
function adjustSupplierDue_(supplierId, delta) {
  var idx = findRowIndex_('SUPPLIERS', 'Supplier ID', supplierId);
  if (idx === -1) return null;
  var row = getAllRows_('SUPPLIERS').filter(function (s) { return s['Supplier ID'] === supplierId; })[0];
  var newDue = (Number(row['Current Due']) || 0) + delta;
  updateRowFields_('SUPPLIERS', idx, { 'Current Due': newDue });
  return newDue;
}

/** Adds delta to a customer's Current Due and returns the new figure. */
function adjustCustomerDue_(customerId, delta) {
  var idx = findRowIndex_('CUSTOMERS', 'Customer ID', customerId);
  if (idx === -1) return null;
  var row = getAllRows_('CUSTOMERS').filter(function (c) { return c['Customer ID'] === customerId; })[0];
  var newDue = (Number(row['Current Due']) || 0) + delta;
  updateRowFields_('CUSTOMERS', idx, { 'Current Due': newDue });
  return newDue;
}

/**
 * Adds delta to a product's Current Stock. Only a negative delta (removing
 * stock — reversing a purchase, DeleteEngine's deletePurchase) is guarded
 * against going below zero; a positive delta (giving stock back — reversing
 * a sale, deleteSalesInvoice) is always allowed, even when the product's
 * stock already sits negative from an unrelated oversell (POS deliberately
 * allows selling past zero — see completeSale in Sales.gs). Adding stock
 * back can only move the number toward positive, never cause a shortfall,
 * so it must never be blocked by this floor.
 */
function adjustProductStock_(productId, delta, productName) {
  var idx = findRowIndex_('PRODUCTS', 'Product ID', productId);
  if (idx === -1) throw new Error('Product ' + (productName || productId) + ' no longer exists.');
  var row = getAllRows_('PRODUCTS').filter(function (p) { return p['Product ID'] === productId; })[0];
  var next = (Number(row['Current Stock']) || 0) + delta;
  if (delta < 0 && next < 0) {
    throw new Error(
      (row['Product Name'] || productName) + ': stock would go negative (' + next + '). ' +
      'Some of these goods have already been sold or issued.'
    );
  }
  updateRowFields_('PRODUCTS', idx, { 'Current Stock': next, 'Updated At': new Date() });
  return next;
}

/** Records a Stock Movement row for a reversal. */
function logReversalMovement_(productId, productName, type, reference, qtyIn, qtyOut, balance, lotId, note) {
  appendRow_('STOCK_MOVEMENT', {
    'Movement ID': generateId_('STOCK_MOVEMENT'), 'Date': new Date(),
    'Product ID': productId, 'Product Name': productName, 'Type': type,
    'Reference': reference, 'Quantity In': qtyIn || '', 'Quantity Out': qtyOut || '',
    'Balance Stock': balance, 'Notes': note || '', 'Lot ID': lotId || ''
  });
}

// ------------------------------------------------------------------
// 1. Sales Invoice
// ------------------------------------------------------------------

/**
 * Soft-deletes a sales invoice and puts the goods and money back.
 * Blocked once a Sales Return exists against it -- the return already
 * moved some of the same stock and cash, so reversing the invoice on top
 * would double-count. Returns must be deleted first.
 */
function deleteSalesInvoice(token, invoiceId, reason) {
  var lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    if (!invoiceId) return fail_('No invoice specified.');
    if (!sanitizeInput_(reason)) return fail_('Enter a reason for deleting this invoice.');

    var sale = findUniqueSalesRow_(invoiceId);
    if (!sale) return fail_('Invoice not found.');
    if (isDeleted_(sale)) return fail_('This invoice is already deleted.');

    var user = requireDeletePermission_(token, 'sales', sale['Date']);
    requireActiveCashSession_();

    var hasReturn = activeRows_('SALES_RETURN').some(function (r) { return r['Invoice ID'] === invoiceId; });
    if (hasReturn) {
      return fail_('This invoice has a Sales Return against it. Delete the return first, then delete the invoice.');
    }

    var now = new Date();
    var items = getAllRows_('SALE_ITEMS').filter(function (i) { return i['Invoice ID'] === invoiceId; });
    if (!items.length) return fail_('This invoice has no item lines to reverse.');

    // Build and validate the complete stock reversal before the first write.
    // SALE_ITEM_LOTS is the authoritative record of owned stock consumed and
    // is already net of returns. Vendor sourcing rows may later be edited or
    // deleted, so their current quantities cannot safely reconstruct stock.
    var ownQtyByProduct = outstandingSaleOwnStockByProduct_(invoiceId, items, []);
    var itemByProduct = {};
    items.forEach(function (line) {
      if (!itemByProduct[line['Product ID']]) itemByProduct[line['Product ID']] = line;
    });
    var productsById = {};
    getAllRows_('PRODUCTS').forEach(function (product) { productsById[product['Product ID']] = product; });
    var stockRestorations = Object.keys(ownQtyByProduct).filter(function (productId) {
      return Number(ownQtyByProduct[productId]) > 0;
    }).map(function (productId) {
      var line = itemByProduct[productId];
      if (!line || !productsById[productId]) {
        throw new Error('A product on this invoice no longer exists. Repair the product reference before deleting the invoice.');
      }
      return { productId: productId, productName: line['Product Name'], qty: Number(ownQtyByProduct[productId]) };
    });

    // Vendor-sourced quantity never touched Current Stock/Stock Lots.
    var vendorRows = getAllRows_('VENDOR_SOURCING').filter(function (v) {
      return v['Invoice ID'] === invoiceId && !isDeleted_(v);
    });
    // --- stock back in, through the same lots it came out of
    stockRestorations.forEach(function (line) {
      var newStock = adjustProductStock_(line.productId, line.qty, line.productName);
      var restored = restoreStockToLots_(invoiceId, line.productId, line.productName, line.qty, invoiceId + '-DELETE');
      restored.forEach(function (r) {
        logReversalMovement_(line.productId, line.productName, 'Sale Deleted',
          invoiceId, r.qty, '', newStock, r.lotId, 'Invoice deleted');
      });
    });

    // --- vendor sourcing reversed: due back down, records soft-deleted
    // (both the VENDOR_SOURCING detail row and its VENDOR_LEDGER 'Sourcing'
    // entry, found via Reference = Sourcing ID)
    var vendorDueReversed = 0;
    vendorRows.forEach(function (v) {
      adjustVendorDue_(v['Vendor ID'], -(Number(v['Total Cost']) || 0));
      markRowDeleted_('VENDOR_SOURCING', v._rowIndex, user, reason, now);
      markMatchingDeleted_('VENDOR_LEDGER', function (l) {
        return l['Reference'] === v['Sourcing ID'] && l['Type'] === 'Sourcing';
      }, user, reason, now);
      vendorDueReversed += Number(v['Total Cost']) || 0;
    });

    // --- money back out
    markMatchingDeleted_('CASH_BOOK', function (c) { return c['Reference'] === invoiceId; }, user, reason, now);
    voidBankEntriesFor_(invoiceId, user, reason);

    // --- customer due unwound
    var due = Number(sale['Due Amount']) || 0;
    var customerId = sale['Customer ID'];
    if (customerId && due > 0) adjustCustomerDue_(customerId, -due);
    markMatchingDeleted_('CUSTOMER_LEDGER', function (l) { return l['Reference'] === invoiceId; }, user, reason, now);

    markRowDeleted_('SALES', sale._rowIndex, user, reason, now);
    logDeletion_('sales', invoiceId, invoiceId, reason, user);

    return ok_({ invoiceId: invoiceId, stockRestored: stockRestorations.length, dueReversed: due, vendorDueReversed: vendorDueReversed });
  } catch (err) {
    logError_('deleteSalesInvoice', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

// ------------------------------------------------------------------
// 2. Purchase
// ------------------------------------------------------------------

/**
 * Soft-deletes a purchase and takes the goods back out of stock.
 *
 * THE IMPORTANT GUARD. A purchase creates a stock lot. If any of that lot
 * has already been sold, removing it would leave sales costed against
 * stock that no longer exists, and Current Stock would go negative. So
 * every lot this purchase created is checked first and the delete is
 * refused -- naming the products -- rather than half-applied.
 */
function deletePurchase(token, purchaseId, reason) {
  var lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    if (!purchaseId) return fail_('No purchase specified.');
    if (!sanitizeInput_(reason)) return fail_('Enter a reason for deleting this purchase.');

    var purchase = findFirstRow_('PURCHASES', 'Purchase ID', purchaseId);
    if (!purchase) return fail_('Purchase not found.');
    if (isDeleted_(purchase)) return fail_('This purchase is already deleted.');

    var user = requireDeletePermission_(token, 'purchase', purchase['Date']);
    requireActiveCashSession_();

    var hasReturn = activeRows_('PURCHASE_RETURN').some(function (r) { return r['Purchase ID'] === purchaseId; });
    if (hasReturn) {
      return fail_('This purchase has a Purchase Return against it. Delete the return first, then delete the purchase.');
    }

    var items = getAllRows_('PURCHASE_ITEMS').filter(function (i) { return i['Purchase ID'] === purchaseId; });
    if (!items.length) return fail_('This purchase has no item lines to reverse.');

    // ---- BLOCK PHASE: refuse before touching anything ----
    var lots = getAllRows_('STOCK_LOTS').filter(function (l) { return l['Purchase ID'] === purchaseId; });
    var lotsByProduct = {};
    lots.forEach(function (l) {
      var pid = l['Product ID'];
      if (!lotsByProduct[pid]) lotsByProduct[pid] = [];
      lotsByProduct[pid].push(l);
    });

    var sold = [];
    var checkedProducts = {};
    items.forEach(function (line) {
      var pid = line['Product ID'];
      if (checkedProducts[pid]) return;
      checkedProducts[pid] = true;
      var productLots = lotsByProduct[pid] || [];
      if (!productLots.length) return; // predates the lot system; the stock check below still guards it
      var original = productLots.reduce(function (sum, lot) { return sum + (Number(lot['Original Quantity']) || 0); }, 0);
      var remaining = productLots.reduce(function (sum, lot) { return sum + (Number(lot['Remaining Quantity']) || 0); }, 0);
      var consumed = original - remaining;
      if (consumed > 0) {
        sold.push(line['Product Name'] + ' (' + consumed + ' of ' + original + ' already sold)');
      }
    });
    if (sold.length) {
      return fail_(
        'Cannot delete this purchase - stock from it has already been sold: ' + sold.join(', ') +
        '. Delete or return the sales that used this stock first, then delete the purchase.'
      );
    }

    var productsById = {};
    getAllRows_('PRODUCTS').forEach(function (p) { productsById[p['Product ID']] = p; });
    var shortfall = [];
    var wanted = {};
    items.forEach(function (line) {
      var qty = Number(line['Quantity']) || 0;
      wanted[line['Product ID']] = (wanted[line['Product ID']] || 0) + qty;
    });
    Object.keys(wanted).forEach(function (pid) {
      var p = productsById[pid];
      if (!p) { shortfall.push('a product on this purchase no longer exists'); return; }
      if ((Number(p['Current Stock']) || 0) < wanted[pid]) {
        shortfall.push(p['Product Name'] + ' (need ' + wanted[pid] + ', have ' + (Number(p['Current Stock']) || 0) + ')');
      }
    });
    if (shortfall.length) {
      return fail_('Cannot delete this purchase - stock would go negative: ' + shortfall.join(', ') + '.');
    }

    // ---- REVERSE PHASE: nothing below raises a validation error ----
    var now = new Date();

    Object.keys(wanted).forEach(function (pid) {
      var qty = wanted[pid] || 0;
      if (qty <= 0) return;
      var product = productsById[pid];
      var productName = product ? product['Product Name'] : pid;
      var newStock = adjustProductStock_(pid, -qty, productName);
      var productLots = lotsByProduct[pid] || [];
      productLots.forEach(function (lot) {
        updateRowFields_('STOCK_LOTS', lot._rowIndex, { 'Remaining Quantity': 0, 'Status': 'Deleted' });
      });
      logReversalMovement_(pid, productName, 'Purchase Deleted',
        purchaseId, '', qty, newStock, '', 'Purchase deleted; ' + productLots.length + ' lot(s) reversed');
    });

    markMatchingDeleted_('CASH_BOOK', function (c) { return c['Reference'] === purchaseId; }, user, reason, now);
    voidBankEntriesFor_(purchaseId, user, reason);

    var due = Number(purchase['Due Amount']) || 0;
    if (purchase['Supplier ID'] && due > 0) adjustSupplierDue_(purchase['Supplier ID'], -due);
    markMatchingDeleted_('SUPPLIER_LEDGER', function (l) { return l['Reference'] === purchaseId; }, user, reason, now);

    markRowDeleted_('PURCHASES', purchase._rowIndex, user, reason, now);
    logDeletion_('purchase', purchaseId, purchaseId, reason, user);

    return ok_({ purchaseId: purchaseId, linesReversed: items.length, dueReversed: due });
  } catch (err) {
    logError_('deletePurchase', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

// ------------------------------------------------------------------
// 3. Expense
// ------------------------------------------------------------------

/** Soft-deletes an expense and puts the cash or bank money back. */
function deleteExpense(token, expenseId, reason) {
  var lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    if (!expenseId) return fail_('No expense specified.');
    if (!sanitizeInput_(reason)) return fail_('Enter a reason for deleting this expense.');

    var exp = getAllRows_('EXPENSES').filter(function (e) { return e['Expense ID'] === expenseId; })[0];
    if (!exp) return fail_('Expense not found.');
    if (isDeleted_(exp)) return fail_('This expense is already deleted.');

    var user = requireDeletePermission_(token, 'expense', exp['Date']);
    requireActiveCashSession_();
    var now = new Date();

    markMatchingDeleted_('CASH_BOOK', function (c) { return c['Reference'] === expenseId; }, user, reason, now);
    voidBankEntriesFor_(expenseId, user, reason);

    markRowDeleted_('EXPENSES', exp._rowIndex, user, reason, now);
    logDeletion_('expense', expenseId, '', reason, user);

    return ok_({ expenseId: expenseId, amount: Number(exp['Amount']) || 0 });
  } catch (err) {
    logError_('deleteExpense', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

// ------------------------------------------------------------------
// 4. Supplier
// ------------------------------------------------------------------

/**
 * Soft-deletes a supplier. Refused while they still have live purchases
 * or a non-zero balance, because hiding them would strand those records
 * against a name nothing can look up. Deactivate is the right tool for
 * "stop using this supplier"; delete is for one keyed in by mistake.
 */
function deleteSupplier(token, supplierId, reason) {
  var lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    if (!supplierId) return fail_('No supplier specified.');
    if (!sanitizeInput_(reason)) return fail_('Enter a reason for deleting this supplier.');

    var sup = getAllRows_('SUPPLIERS').filter(function (s) { return s['Supplier ID'] === supplierId; })[0];
    if (!sup) return fail_('Supplier not found.');
    if (isDeleted_(sup)) return fail_('This supplier is already deleted.');

    var user = requireDeletePermission_(token, 'suppliers', sup['Created At'] || formatDate_(new Date()));

    var due = Number(sup['Current Due']) || 0;
    if (Math.abs(due) > 0.009) {
      return fail_('This supplier has an outstanding balance of ' + due + '. Settle it before deleting, or use Deactivate instead.');
    }
    var purchases = activeRows_('PURCHASES').filter(function (p) { return p['Supplier ID'] === supplierId; });
    if (purchases.length) {
      return fail_('This supplier has ' + purchases.length + ' purchase record(s) and cannot be deleted. Use Deactivate instead.');
    }

    var now = new Date();
    markMatchingDeleted_('SUPPLIER_LEDGER', function (l) { return l['Supplier ID'] === supplierId; }, user, reason, now);
    markRowDeleted_('SUPPLIERS', sup._rowIndex, user, reason, now);
    logDeletion_('suppliers', supplierId, '', reason, user);

    return ok_({ supplierId: supplierId });
  } catch (err) {
    logError_('deleteSupplier', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

// ------------------------------------------------------------------
// 5. Product
// ------------------------------------------------------------------

/**
 * Soft-deletes a product. Refused while it still holds stock or appears
 * on any live sale or purchase -- deleting it then would silently break
 * the costing behind those documents. Deactivate hides it from POS
 * without touching history.
 */
function deleteProduct(token, productId, reason) {
  var lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    if (!productId) return fail_('No product specified.');
    if (!sanitizeInput_(reason)) return fail_('Enter a reason for deleting this product.');

    var prod = getAllRows_('PRODUCTS').filter(function (p) { return p['Product ID'] === productId; })[0];
    if (!prod) return fail_('Product not found.');
    if (isDeleted_(prod)) return fail_('This product is already deleted.');

    var user = requireDeletePermission_(token, 'products', prod['Created At'] || formatDate_(new Date()));

    var stock = Number(prod['Current Stock']) || 0;
    if (Math.abs(stock) > 0.0001) {
      return fail_('This product still has ' + stock + ' in stock. Adjust it to zero first, or use Deactivate instead.');
    }

    var liveSales = {};
    activeRows_('SALES').forEach(function (s) { liveSales[s['Invoice ID']] = true; });
    var usedInSale = getAllRows_('SALE_ITEMS').some(function (i) {
      return i['Product ID'] === productId && liveSales[i['Invoice ID']];
    });
    var livePurchases = {};
    activeRows_('PURCHASES').forEach(function (p) { livePurchases[p['Purchase ID']] = true; });
    var usedInPurchase = getAllRows_('PURCHASE_ITEMS').some(function (i) {
      return i['Product ID'] === productId && livePurchases[i['Purchase ID']];
    });
    if (usedInSale || usedInPurchase) {
      return fail_('This product appears on existing sales or purchases and cannot be deleted. Use Deactivate instead.');
    }

    markRowDeleted_('PRODUCTS', prod._rowIndex, user, reason, new Date());
    logDeletion_('products', productId, '', reason, user);

    return ok_({ productId: productId });
  } catch (err) {
    logError_('deleteProduct', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

// ------------------------------------------------------------------
// 6. Bank transaction
// ------------------------------------------------------------------

/**
 * Voids one Bank Book entry and unwinds it from the account balance.
 * Entries that a sale/purchase/expense generated are refused here -- the
 * money belongs to that document, so it has to be deleted at the source
 * or the two records would disagree.
 */
function deleteBankTransaction(token, entryId, reason) {
  var lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    if (!entryId) return fail_('No bank entry specified.');
    if (!sanitizeInput_(reason)) return fail_('Enter a reason for deleting this transaction.');

    var entry = getAllRows_('BANK_BOOK').filter(function (e) { return e['Entry ID'] === entryId; })[0];
    if (!entry) return fail_('Bank transaction not found.');
    if (entry['Status'] === 'Reversed') return fail_('This transaction is already reversed.');

    var user = requireDeletePermission_(token, 'bank', entry['Date']);
    requireActiveCashSession_();

    var ref = String(entry['Reference'] || '');
    var ownedElsewhere = activeRows_('SALES').some(function (s) { return s['Invoice ID'] === ref; }) ||
                         activeRows_('PURCHASES').some(function (p) { return p['Purchase ID'] === ref; }) ||
                         activeRows_('EXPENSES').some(function (e) { return e['Expense ID'] === ref; });
    if (ownedElsewhere) {
      return fail_('This entry belongs to ' + ref + '. Delete that record instead so both stay consistent.');
    }

    unwindBankEntryFromBalance_(entry);
    updateRowFields_('BANK_BOOK', entry._rowIndex, {
      'Status': 'Reversed',
      'Notes': appendNote_(entry['Notes'], 'Deleted by ' + deleteActor_(user) + ': ' + sanitizeInput_(reason))
    });
    logDeletion_('bank', entryId, '', reason, user);

    return ok_({ entryId: entryId });
  } catch (err) {
    logError_('deleteBankTransaction', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

// ------------------------------------------------------------------
// 7. Day Book
// ------------------------------------------------------------------

/**
 * The Day Book is a view over the other sheets, not a sheet of its own,
 * so deleting a Day Book line means deleting whatever produced it. This
 * dispatches to the right module so the caller does not have to know,
 * and so the correct module permission and day window still apply.
 */
function deleteDayBookEntry(token, moduleKey, recordId, reason) {
  try {
    if (!moduleKey || !recordId) return fail_('Nothing selected to delete.');
    switch (String(moduleKey).toLowerCase()) {
      case 'sales':
      case 'sale':            return deleteSalesInvoice(token, recordId, reason);
      case 'purchase':        return deletePurchase(token, recordId, reason);
      case 'expense':         return deleteExpense(token, recordId, reason);
      case 'bank':            return deleteBankTransaction(token, recordId, reason);
      case 'supplier payment':
      case 'supplierpayment': return deleteSupplierPayment(token, recordId, reason);
      case 'customer payment':
      case 'customerpayment': return deleteCustomerPayment(token, recordId, reason);
      case 'finance':         return deleteFinanceTransaction(token, recordId, reason);
      default:
        return fail_('"' + moduleKey + '" entries cannot be deleted from the Day Book. Open that module to correct it.');
    }
  } catch (err) {
    logError_('deleteDayBookEntry', err);
    return fail_(err.message);
  }
}

// ------------------------------------------------------------------
// 8. Supplier payments - edit and delete
// ------------------------------------------------------------------

/** One supplier payment, shaped for the edit modal. */
function getSupplierPaymentForEdit(token, ledgerId) {
  try {
    requirePermission_(token, 'suppliers', 'edit');
    var row = getAllRows_('SUPPLIER_LEDGER').filter(function (l) { return l['Ledger ID'] === ledgerId; })[0];
    if (!row) return fail_('Payment not found.');
    if (isDeleted_(row)) return fail_('This payment has been deleted.');
    if (row['Type'] !== 'Payment') return fail_('Only payment rows can be edited here.');
    return ok_({
      ledgerId: row['Ledger ID'], supplierId: row['Supplier ID'], supplierName: row['Supplier Name'],
      date: safeDateOnly_(row['Date']), amount: settlementPaymentAmount_(row),
      discountAmount: settlementDiscountAmount_(row), discountReason: row['Discount Reason'] || '',
      method: row['Payment Method'] || 'Cash', bankAccountId: paymentAccountForReference_(row, ledgerId), notes: row['Notes'] || ''
    });
  } catch (err) {
    logError_('getSupplierPaymentForEdit', err);
    return fail_(err.message);
  }
}

/**
 * Reverses a supplier payment completely, then re-applies it with the new
 * figures. Reverse-then-reapply rather than patching in place: the method
 * can change from Cash to Bank, which moves the money between two
 * different books, and a delta patch cannot express that safely.
 */
function updateSupplierPayment(token, ledgerId, payload) {
  // Normal path: resolveEditedTransactionDate_(...) authorizes the requested date before updateRowFields_(...) in the trusted helper.
  return updateSupplierPaymentInternal_(token, ledgerId, payload, { lockHeld: false });
}

function updateSupplierPaymentInternal_(token, ledgerId, payload, options) {
  var opts = options || {};
  var lock = opts.lockHeld ? null : LockService.getScriptLock();
  if (lock) lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    requirePermission_(token, 'suppliers', 'edit');
    requireActiveCashSession_();
    var row = getAllRows_('SUPPLIER_LEDGER').filter(function (l) { return l['Ledger ID'] === ledgerId; })[0];
    if (!row) return fail_('Payment not found.');
    if (isDeleted_(row)) return fail_('This payment has been deleted.');
    if (row['Type'] !== 'Payment') return fail_('Only payment rows can be edited.');

    var user = getSessionUser_(token);
    var supplierId = row['Supplier ID'];
    var oldPayment = settlementPaymentAmount_(row);
    var oldDiscount = settlementDiscountAmount_(row);
    var oldTotal = settlementTotalAmount_(row);
    var now = new Date();
    var dateStr = resolveEditedTransactionDate_(token, 'suppliers', payload.date, row['Date'], payload.backdatedReason, 'Supplier Payment Edit');
    var priorDue = settlementBalanceBeforePayment_('SUPPLIER_LEDGER', 'Supplier ID', supplierId, ledgerId, dateStr);
    var settlement = validateSettlementDiscount_(token, 'suppliers', priorDue, payload.amount, payload.discountAmount, payload.discountReason, oldDiscount, row['Discount Reason'] || '');
    var method = payload.method || row['Payment Method'] || 'Cash';
    var bank = resolveBankAccount_(method, payload.bankAccountId);

    var oldBankAccountId = paymentAccountForReference_(row, ledgerId);
    var newDue;
    
      reverseSupplierPaymentMoney_(ledgerId, supplierId, oldPayment, oldTotal, row['Payment Method'], user, 'Payment edited', now);
      newDue = adjustSupplierDue_(supplierId, -settlement.total);
      updateRowFields_('SUPPLIER_LEDGER', row._rowIndex, {
        'Date': dateStr, 'Credit': settlement.total, 'Balance': newDue,
        'Payment Method': method, 'Payment Amount': settlement.payment,
        'Discount Amount': settlement.discount || '', 'Discount Reason': settlement.discount > 0 ? settlement.reason : '',
        'Notes': sanitizeInput_(payload.notes)
      });
      if (method === 'Cash') {
        addCashBookEntry_({Type:'Supplier Payment',Reference:ledgerId,Description:'Payment to '+row['Supplier Name']+' (edited)',Debit:settlement.payment,Credit:'',PaymentMethod:'Cash',Date:dateStr});
      } else if (isBankLikePaymentMethod_(method)) {
        addBankBookEntry_(bank.id,{Type:'Supplier Payment',Reference:ledgerId,Description:'Payment to '+row['Supplier Name']+' (edited)',Debit:settlement.payment,Credit:'',Date:dateStr});
      }
    
    return ok_({ ledgerId: ledgerId, newDue: newDue, paymentAmount: settlement.payment, discountAmount: settlement.discount, totalSettled: settlement.total });
  } catch (err) {
    logError_('updateSupplierPayment', err);
    return fail_(err.message);
  } finally {
    if (lock) lock.releaseLock();
  }
}
/** A blank historical method predates the Payment Method column and was
 * recorded through a money book. 'Other' intentionally creates no Cash/Bank
 * movement, so edit/delete must not demand or void one. */
function paymentMethodCreatesBookMovement_(method) {
  var value = String(method || '').trim();
  return !value || value === 'Cash' || isBankLikePaymentMethod_(value);
}

/**
 * Undoes a supplier payment's money movement: due goes back up, and the
 * cash/bank entries are voided only when the original payment method created
 * one. Matches on the ledger ID, and also on the older Reference=supplierId
 * shape so payments recorded before this release can still be corrected.
 */
function reverseSupplierPaymentMoney_(ledgerId, supplierId, paymentAmount, totalSettled, paymentMethod, user, reason, when) {
  var hasBookMovement = paymentMethodCreatesBookMovement_(paymentMethod);
  if (hasBookMovement) {
    assertUniqueLegacyPaymentMovement_(ledgerId, supplierId, paymentAmount, 'Supplier Payment', 'Debit');
  }
  adjustSupplierDue_(supplierId, totalSettled);
  if (!hasBookMovement) return;
  var voided = markMatchingDeleted_('CASH_BOOK', function (c) {
    return c['Reference'] === ledgerId;
  }, user, reason, when);
  if (!voided) {
    // legacy rows: Reference was the supplier ID, so match on amount too
    markMatchingDeleted_('CASH_BOOK', function (c) {
      return c['Reference'] === supplierId && c['Type'] === 'Supplier Payment' &&
             Math.abs((Number(c['Debit']) || 0) - paymentAmount) < 0.005;
    }, user, reason, when);
  }
  if (!voidBankEntriesFor_(ledgerId, user, reason)) {
    getAllRows_('BANK_BOOK').filter(function (e) {
      return e['Reference'] === supplierId && e['Type'] === 'Supplier Payment' &&
             e['Status'] !== 'Reversed' && Math.abs((Number(e['Debit']) || 0) - paymentAmount) < 0.005;
    }).forEach(function (e) {
      unwindBankEntryFromBalance_(e);
      updateRowFields_('BANK_BOOK', e._rowIndex, {
        'Status': 'Reversed', 'Notes': appendNote_(e['Notes'], reason)
      });
    });
  }
}

/** Soft-deletes a supplier payment and puts the due back. */
function deleteSupplierPayment(token, ledgerId, reason) {
  var lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    if (!ledgerId) return fail_('No payment specified.');
    if (!sanitizeInput_(reason)) return fail_('Enter a reason for deleting this payment.');

    var row = getAllRows_('SUPPLIER_LEDGER').filter(function (l) { return l['Ledger ID'] === ledgerId; })[0];
    if (!row) return fail_('Payment not found.');
    if (isDeleted_(row)) return fail_('This payment is already deleted.');
    if (row['Type'] !== 'Payment') return fail_('Only payment rows can be deleted here.');

    var user = requireDeletePermission_(token, 'suppliers', row['Date']);
    requireActiveCashSession_();
    var now = new Date();
    var paymentAmount = settlementPaymentAmount_(row);
    var totalSettled = settlementTotalAmount_(row);

    reverseSupplierPaymentMoney_(ledgerId, row['Supplier ID'], paymentAmount, totalSettled, row['Payment Method'], user, reason, now);
    markRowDeleted_('SUPPLIER_LEDGER', row._rowIndex, user, reason, now);
    logDeletion_('suppliers', ledgerId, '', reason, user);

    return ok_({ ledgerId: ledgerId, amount: paymentAmount, totalSettled: totalSettled });
  } catch (err) {
    logError_('deleteSupplierPayment', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

// ------------------------------------------------------------------
// 9. Customer payments - edit and delete
// ------------------------------------------------------------------

/** One customer payment, shaped for the edit modal. */
function getCustomerPaymentForEdit(token, ledgerId) {
  try {
    requirePermission_(token, 'customers', 'edit');
    var row = getAllRows_('CUSTOMER_LEDGER').filter(function (l) { return l['Ledger ID'] === ledgerId; })[0];
    if (!row) return fail_('Payment not found.');
    if (isDeleted_(row)) return fail_('This payment has been deleted.');
    if (row['Type'] !== 'Payment') return fail_('Only payment rows can be edited here.');
    return ok_({
      ledgerId: row['Ledger ID'], customerId: row['Customer ID'], customerName: row['Customer Name'],
      date: safeDateOnly_(row['Date']), amount: settlementPaymentAmount_(row),
      discountAmount: settlementDiscountAmount_(row), discountReason: row['Discount Reason'] || '',
      allocatedInvoiceId: row['Allocated Invoice ID'] || '',
      method: row['Payment Method'] || 'Cash', bankAccountId: paymentAccountForReference_(row, ledgerId), notes: row['Notes'] || ''
    });
  } catch (err) {
    logError_('getCustomerPaymentForEdit', err);
    return fail_(err.message);
  }
}

/** Undoes a customer payment's money movement. 'Other' payments affect due
 * but intentionally have no Cash/Bank entry to reverse. */
function reverseCustomerPaymentMoney_(ledgerId, customerId, paymentAmount, totalSettled, paymentMethod, user, reason, when) {
  var hasBookMovement = paymentMethodCreatesBookMovement_(paymentMethod);
  if (hasBookMovement) {
    assertUniqueLegacyPaymentMovement_(ledgerId, customerId, paymentAmount, 'Customer Payment', 'Credit');
  }
  adjustCustomerDue_(customerId, totalSettled);
  if (!hasBookMovement) return;
  var voided = markMatchingDeleted_('CASH_BOOK', function (c) {
    return c['Reference'] === ledgerId;
  }, user, reason, when);
  if (!voided) {
    markMatchingDeleted_('CASH_BOOK', function (c) {
      return c['Reference'] === customerId && c['Type'] === 'Customer Payment' &&
             Math.abs((Number(c['Credit']) || 0) - paymentAmount) < 0.005;
    }, user, reason, when);
  }
  if (!voidBankEntriesFor_(ledgerId, user, reason)) {
    getAllRows_('BANK_BOOK').filter(function (e) {
      return e['Reference'] === customerId && e['Type'] === 'Customer Payment' &&
             e['Status'] !== 'Reversed' && Math.abs((Number(e['Credit']) || 0) - paymentAmount) < 0.005;
    }).forEach(function (e) {
      unwindBankEntryFromBalance_(e);
      updateRowFields_('BANK_BOOK', e._rowIndex, {
        'Status': 'Reversed', 'Notes': appendNote_(e['Notes'], reason)
      });
    });
  }
}

/**
 * Old payment-book rows used the party ID instead of the ledger ID. If two
 * same-value legacy payments exist, there is no reliable key that says which
 * movement belongs to the selected ledger row. Refuse before changing party
 * due rather than voiding both (or guessing one).
 */
function assertUniqueLegacyPaymentMovement_(ledgerId, partyId, paymentAmount, type, amountColumn) {
  if (!(Number(paymentAmount) > 0)) return;
  var directCash = activeRows_('CASH_BOOK').some(function (entry) {
    return entry['Reference'] === ledgerId;
  });
  var directBank = getAllRows_('BANK_BOOK').some(function (entry) {
    return entry['Reference'] === ledgerId && entry['Status'] !== 'Reversed';
  });
  if (directCash || directBank) return;

  var legacyCash = activeRows_('CASH_BOOK').filter(function (entry) {
    return entry['Reference'] === partyId && entry['Type'] === type &&
      Math.abs((Number(entry[amountColumn]) || 0) - Number(paymentAmount)) < 0.005;
  });
  var legacyBank = getAllRows_('BANK_BOOK').filter(function (entry) {
    return entry['Reference'] === partyId && entry['Type'] === type && entry['Status'] !== 'Reversed' &&
      Math.abs((Number(entry[amountColumn]) || 0) - Number(paymentAmount)) < 0.005;
  });
  if (legacyCash.length + legacyBank.length !== 1) {
    throw new Error('This legacy payment has an ambiguous money movement. Repair its reference before editing or deleting it.');
  }
}

/** Reverses a customer payment then re-applies it with the new figures. */
function updateCustomerPayment(token, ledgerId, payload) {
  // Normal path: resolveEditedTransactionDate_(...) authorizes the requested date before updateRowFields_(...) in the trusted helper.
  return updateCustomerPaymentInternal_(token, ledgerId, payload, { lockHeld: false });
}

function updateCustomerPaymentInternal_(token, ledgerId, payload, options) {
  var opts = options || {};
  var lock = opts.lockHeld ? null : LockService.getScriptLock();
  if (lock) lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    requirePermission_(token, 'customers', 'edit');
    requireActiveCashSession_();
    var row = getAllRows_('CUSTOMER_LEDGER').filter(function (l) { return l['Ledger ID'] === ledgerId; })[0];
    if (!row) return fail_('Payment not found.');
    if (isDeleted_(row)) return fail_('This payment has been deleted.');
    if (row['Type'] !== 'Payment') return fail_('Only payment rows can be edited.');

    var user = getSessionUser_(token);
    var customerId = row['Customer ID'];
    var oldPayment = settlementPaymentAmount_(row);
    var oldDiscount = settlementDiscountAmount_(row);
    var oldTotal = settlementTotalAmount_(row);
    var now = new Date();
    var dateStr = resolveEditedTransactionDate_(token, 'customers', payload.date, row['Date'], payload.backdatedReason, 'Customer Payment Edit');
    var priorDue = settlementBalanceBeforePayment_('CUSTOMER_LEDGER', 'Customer ID', customerId, ledgerId, dateStr);
    var settlement = validateSettlementDiscount_(token, 'customers', priorDue, payload.amount, payload.discountAmount, payload.discountReason, oldDiscount, row['Discount Reason'] || '');
    var allocatedInvoiceId = sanitizeInput_(row['Allocated Invoice ID']);
    var method = payload.method || row['Payment Method'] || 'Cash';
    // Validate the edited figures against the original allocation target before
    // reversing any money. Historical blank targets remain oldest-due-first.
    customerPaymentPreview_(customerId, dateStr, settlement.payment, settlement.discount, allocatedInvoiceId, ledgerId, method);
    var bank = resolveBankAccount_(method, payload.bankAccountId);

    var oldBankAccountId = paymentAccountForReference_(row, ledgerId);
    var newDue;
    
      reverseCustomerPaymentMoney_(ledgerId, customerId, oldPayment, oldTotal, row['Payment Method'], user, 'Payment edited', now);
      newDue = adjustCustomerDue_(customerId, -settlement.total);
      updateRowFields_('CUSTOMER_LEDGER', row._rowIndex, {
        'Date': dateStr, 'Credit': settlement.total, 'Balance': newDue,
        'Payment Method': method, 'Payment Amount': settlement.payment,
        'Discount Amount': settlement.discount || '', 'Discount Reason': settlement.discount > 0 ? settlement.reason : '',
        'Allocated Invoice ID': allocatedInvoiceId,
        'Notes': sanitizeInput_(payload.notes)
      });
      if (method === 'Cash') {
        addCashBookEntry_({Type:'Customer Payment',Reference:ledgerId,Description:'Payment from '+row['Customer Name']+' (edited)',Debit:'',Credit:settlement.payment,PaymentMethod:'Cash',Date:dateStr});
      } else if (isBankLikePaymentMethod_(method)) {
        addBankBookEntry_(bank.id,{Type:'Customer Payment',Reference:ledgerId,Description:'Payment from '+row['Customer Name']+' (edited)',Debit:'',Credit:settlement.payment,Date:dateStr});
      }
    
    return ok_({ ledgerId: ledgerId, newDue: newDue, paymentAmount: settlement.payment, discountAmount: settlement.discount, totalSettled: settlement.total });
  } catch (err) {
    logError_('updateCustomerPayment', err);
    return fail_(err.message);
  } finally {
    if (lock) lock.releaseLock();
  }
}
/** Soft-deletes a customer payment and puts the due back. */
function deleteCustomerPayment(token, ledgerId, reason) {
  var lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    if (!ledgerId) return fail_('No payment specified.');
    if (!sanitizeInput_(reason)) return fail_('Enter a reason for deleting this payment.');

    var row = getAllRows_('CUSTOMER_LEDGER').filter(function (l) { return l['Ledger ID'] === ledgerId; })[0];
    if (!row) return fail_('Payment not found.');
    if (isDeleted_(row)) return fail_('This payment is already deleted.');
    if (row['Type'] !== 'Payment') return fail_('Only payment rows can be deleted here.');

    var user = requireDeletePermission_(token, 'customers', row['Date']);
    requireActiveCashSession_();
    var now = new Date();
    var paymentAmount = settlementPaymentAmount_(row);
    var totalSettled = settlementTotalAmount_(row);

    reverseCustomerPaymentMoney_(ledgerId, row['Customer ID'], paymentAmount, totalSettled, row['Payment Method'], user, reason, now);
    markRowDeleted_('CUSTOMER_LEDGER', row._rowIndex, user, reason, now);
    logDeletion_('customers', ledgerId, '', reason, user);

    return ok_({ ledgerId: ledgerId, amount: paymentAmount, totalSettled: totalSettled });
  } catch (err) {
    logError_('deleteCustomerPayment', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

// ------------------------------------------------------------------
// 10. Finance transactions (Business Finance) - edit and delete
// ------------------------------------------------------------------
// Same shape as Supplier/Customer payments above: a finance transaction
// is a single-amount ledger row, so a correction reverses the old Cash
// Book / Bank Book entries completely and reapplies fresh ones rather
// than patching a delta. Owner Capital / Outstanding Loan need no
// explicit reversal at all -- they are summed live from this sheet's
// active rows (FinanceModule.gs), so updating or soft-deleting the row
// here IS the recalculation.

/** One finance transaction, shaped for the edit modal. */
function getFinanceTransactionForEdit(token, financeId) {
  try {
    requirePermission_(token, 'finance', 'edit');
    var row = getAllRows_('FINANCE_TRANSACTIONS').filter(function (f) { return f['Finance ID'] === financeId; })[0];
    if (!row) return fail_('Transaction not found.');
    if (isDeleted_(row)) return fail_('This transaction has been deleted.');
    return ok_({
      financeId: row['Finance ID'], date: safeDateOnly_(row['Date']),
      transactionType: row['Transaction Type'], personId: row['Person ID'] || '', person: row['Person'],
      paymentMethod: row['Payment Method'] || '',
      bankAccountId: row['Bank Account ID'] || '', bankAccountName: row['Bank Account Name'] || '',
      amount: Number(row['Amount']) || 0, referenceNo: row['Reference No'] || '', notes: row['Notes'] || ''
    });
  } catch (err) {
    logError_('getFinanceTransactionForEdit', err);
    return fail_(err.message);
  }
}

/** Undoes a finance transaction's money movement: void whichever book its Reference points at. */
function reverseFinanceTransactionMoney_(financeId, user, reason, when) {
  markMatchingDeleted_('CASH_BOOK', function (c) { return c['Reference'] === financeId; }, user, reason, when);
  voidBankEntriesFor_(financeId, user, reason);
}

/**
 * Reverses a finance transaction completely, then re-applies it with the
 * new figures. Reverse-then-reapply rather than a delta, same reason as
 * updateSupplierPayment: the payment method (and therefore which book the
 * money lives in) can change, and a delta can't span two different books.
 */
function updateFinanceTransaction(token, financeId, payload) {
  // Normal path: resolveEditedTransactionDate_(...) authorizes the requested date before updateRowFields_(...) in the trusted helper.
  return updateFinanceTransactionInternal_(token, financeId, payload, { lockHeld: false });
}

function updateFinanceTransactionInternal_(token, financeId, payload, options) {
  var opts = options || {};
  var lock = opts.lockHeld ? null : LockService.getScriptLock();
  if (lock) lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    var user = requirePermission_(token, 'finance', 'edit');
    payload = payload || {};
    var row = getAllRows_('FINANCE_TRANSACTIONS').filter(function (f) { return f['Finance ID'] === financeId; })[0];
    if (!row) return fail_('Transaction not found.');
    if (isDeleted_(row)) return fail_('This transaction has been deleted.');

    var oldType = financeTransactionType_(row['Transaction Type']);
    var type = financeTransactionType_(sanitizeInput_(payload.transactionType));
    if (!type) return fail_('Choose a valid transaction type.');
    if (!isValidNonNegativeNumber_(payload.amount) || Number(payload.amount) <= 0) return fail_('Enter a valid amount.');
    var amount = roundMoney_(Number(payload.amount));
    if (amount <= 0) return fail_('Enter a valid amount of at least 0.01.');
    var personId = sanitizeInput_(payload.personId);
    if (!personId) return fail_('Choose a finance person.');
    var personRow = findFinancePerson_(personId);
    if (!personRow) return fail_('Person not found.');
    if (personRow['Status'] === 'Inactive') return fail_('Person is inactive.');
    if (!financePersonHasRole_(personRow, type.role)) return fail_('Selected person must have the ' + type.role + ' role.');
    var personName = personRow['Person Name'];

    var oldMovesMoney = financeTypeHasMoneyMovement_(oldType);
    var newMovesMoney = financeTypeHasMoneyMovement_(type);
    if (oldMovesMoney || newMovesMoney) requireActiveCashSession_();

    var method = '';
    var bank = { id: '', name: '' };
    if (newMovesMoney) {
      method = FINANCE_PAYMENT_METHODS.indexOf(payload.paymentMethod) !== -1 ? payload.paymentMethod : '';
      if (!method) return fail_('Choose a valid payment method.');
      bank = resolveBankAccount_(method, payload.bankAccountId);
    }

    var now = new Date();
    var dateStr = resolveEditedTransactionDate_(token, 'finance', payload.date, row['Date'], payload.backdatedReason, 'Finance Transaction Edit');

    if (oldMovesMoney) reverseFinanceTransactionMoney_(financeId, user, 'Finance entry edited', now);

    updateRowFields_('FINANCE_TRANSACTIONS', row._rowIndex, {
      'Date': dateStr, 'Transaction Type': type.key, 'Person ID': personId, 'Person': personName, 'Payment Method': method,
      'Bank Account ID': bank.id, 'Bank Account Name': bank.name, 'Amount': amount,
      'Reference No': sanitizeInput_(payload.referenceNo), 'Notes': sanitizeInput_(payload.notes)
    });
    if (newMovesMoney) postFinanceTransactionMoney_(financeId, type, method, bank.id, amount, personName, dateStr, user);

    return ok_({ financeId: financeId, ownerCapital: getOwnerCapital_(), outstandingLoan: getOutstandingLoan_() });
  } catch (err) {
    logError_('updateFinanceTransaction', err);
    return fail_(err.message);
  } finally {
    if (lock) lock.releaseLock();
  }
}
/** Soft-deletes a finance transaction and reverses whichever book it moved money through. */
function deleteFinanceTransaction(token, financeId, reason) {
  var lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    if (!financeId) return fail_('No transaction specified.');
    if (!sanitizeInput_(reason)) return fail_('Enter a reason for deleting this transaction.');

    var row = getAllRows_('FINANCE_TRANSACTIONS').filter(function (f) { return f['Finance ID'] === financeId; })[0];
    if (!row) return fail_('Transaction not found.');
    if (isDeleted_(row)) return fail_('This transaction is already deleted.');

    var user = requireDeletePermission_(token, 'finance', row['Date']);
    var type = financeTransactionType_(row['Transaction Type']);
    var movesMoney = financeTypeHasMoneyMovement_(type);
    if (movesMoney) requireActiveCashSession_();
    var now = new Date();
    var amount = Number(row['Amount']) || 0;

    if (movesMoney) reverseFinanceTransactionMoney_(financeId, user, reason, now);
    markRowDeleted_('FINANCE_TRANSACTIONS', row._rowIndex, user, reason, now);
    logDeletion_('finance', financeId, '', reason, user);

    return ok_({ financeId: financeId, amount: amount, ownerCapital: getOwnerCapital_(), outstandingLoan: getOutstandingLoan_() });
  } catch (err) {
    logError_('deleteFinanceTransaction', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

// ------------------------------------------------------------------
// 11. Vendor Ledger - edit and delete (Payment, Return, Sourcing)
// ------------------------------------------------------------------
// Three row types, three shapes of reversal:
//   Payment  - pure money, mirrors Supplier Payment above exactly.
//   Return   - money + stock (settled a due with stock instead of cash),
//              reverse-then-reapply for both sides.
//   Sourcing - due only, deliberately never touches the original sale
//              invoice or its stock (see Vendors.gs's header comment) —
//              canceling/correcting one only changes this shop's own
//              bookkeeping record of what it owes the vendor. Blocked
//              once a Return has been recorded against it (settle that
//              first), same "reverse the more specific thing first" rule
//              Sales Invoice deletion already uses.
// All three keep the VENDOR_LEDGER row (Reference = the record's own ID)
// in step with the detail sheet (VENDOR_SOURCING / VENDOR_RETURNS) they
// summarize, and go through adjustVendorDue_/postVendorLedgerEntry_ —
// the only functions that ever change a vendor's Current Due.

/** One vendor payment, shaped for the edit modal. */
function getVendorPaymentForEdit(token, ledgerId) {
  try {
    requirePermission_(token, 'vendors', 'edit');
    var row = getAllRows_('VENDOR_LEDGER').filter(function (l) { return l['Ledger ID'] === ledgerId; })[0];
    if (!row) return fail_('Payment not found.');
    if (isDeleted_(row)) return fail_('This payment has been deleted.');
    if (row['Type'] !== 'Payment') return fail_('Only payment rows can be edited here.');
    return ok_({
      ledgerId: row['Ledger ID'], vendorId: row['Vendor ID'], vendorName: row['Vendor Name'],
      date: safeDateOnly_(row['Date']), amount: Number(row['Credit']) || 0,
      method: row['Payment Method'] || 'Cash', bankAccountId: paymentAccountForReference_(row, ledgerId), notes: row['Notes'] || ''
    });
  } catch (err) {
    logError_('getVendorPaymentForEdit', err);
    return fail_(err.message);
  }
}

/** Undoes a vendor payment's money movement: due goes back up, cash/bank entries voided. */
function reverseVendorPaymentMoney_(ledgerId, vendorId, amount, user, reason, when) {
  adjustVendorDue_(vendorId, amount);
  markMatchingDeleted_('CASH_BOOK', function (c) { return c['Reference'] === ledgerId; }, user, reason, when);
  voidBankEntriesFor_(ledgerId, user, reason);
}

/** Reverses a vendor payment completely, then re-applies it with the new figures — same shape as updateSupplierPayment. */
function updateVendorPayment(token, ledgerId, payload) {
  // Normal path: resolveEditedTransactionDate_(...) authorizes the requested date before updateRowFields_(...) in the trusted helper.
  return updateVendorPaymentInternal_(token, ledgerId, payload, { lockHeld: false });
}

function updateVendorPaymentInternal_(token, ledgerId, payload, options) {
  var opts = options || {};
  var lock = opts.lockHeld ? null : LockService.getScriptLock();
  if (lock) lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    requirePermission_(token, 'vendors', 'edit');
    requireActiveCashSession_();
    var row = getAllRows_('VENDOR_LEDGER').filter(function (l) { return l['Ledger ID'] === ledgerId; })[0];
    if (!row) return fail_('Payment not found.');
    if (isDeleted_(row)) return fail_('This payment has been deleted.');
    if (row['Type'] !== 'Payment') return fail_('Only payment rows can be edited.');

    var newAmount = Number(payload.amount);
    if (!isValidNonNegativeNumber_(newAmount) || newAmount <= 0) return fail_('Enter a valid payment amount.');

    var user = getSessionUser_(token);
    var vendorId = row['Vendor ID'];
    var oldAmount = Number(row['Credit']) || 0;
    var now = new Date();
    var dateStr = resolveEditedTransactionDate_(token, 'vendors', payload.date, row['Date'], payload.backdatedReason, 'Vendor Payment Edit');
    var method = payload.method || row['Payment Method'] || 'Cash';
    var bank = resolveBankAccount_(method, payload.bankAccountId);

    var oldBankAccountId = paymentAccountForReference_(row, ledgerId);
    var newDue;
    
      reverseVendorPaymentMoney_(ledgerId, vendorId, oldAmount, user, 'Payment edited', now);

      newDue = adjustVendorDue_(vendorId, -newAmount);
      updateRowFields_('VENDOR_LEDGER', row._rowIndex, {
        'Date': dateStr, 'Credit': newAmount, 'Balance': newDue,
        'Payment Method': method, 'Notes': sanitizeInput_(payload.notes)
      });

      if (method === 'Cash') {
        addCashBookEntry_({
          Type: 'Vendor Payment', Reference: ledgerId,
          Description: 'Payment to ' + row['Vendor Name'] + ' (edited)',
          Debit: newAmount, Credit: '', PaymentMethod: 'Cash', Date: dateStr
        });
      } else if (isBankLikePaymentMethod_(method)) {
        addBankBookEntry_(bank.id, {
          Type: 'Vendor Payment', Reference: ledgerId,
          Description: 'Payment to ' + row['Vendor Name'] + ' (edited)',
          Debit: newAmount, Credit: '', Date: dateStr
        });
      }
    

    return ok_({ ledgerId: ledgerId, newDue: newDue });
  } catch (err) {
    logError_('updateVendorPayment', err);
    return fail_(err.message);
  } finally {
    if (lock) lock.releaseLock();
  }
}
/** Soft-deletes a vendor payment and puts the due back. */
function deleteVendorPayment(token, ledgerId, reason) {
  var lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    if (!ledgerId) return fail_('No payment specified.');
    if (!sanitizeInput_(reason)) return fail_('Enter a reason for deleting this payment.');

    var row = getAllRows_('VENDOR_LEDGER').filter(function (l) { return l['Ledger ID'] === ledgerId; })[0];
    if (!row) return fail_('Payment not found.');
    if (isDeleted_(row)) return fail_('This payment is already deleted.');
    if (row['Type'] !== 'Payment') return fail_('Only payment rows can be deleted here.');

    var user = requireDeletePermission_(token, 'vendors', row['Date']);
    requireActiveCashSession_();
    var now = new Date();
    var amount = Number(row['Credit']) || 0;

    reverseVendorPaymentMoney_(ledgerId, row['Vendor ID'], amount, user, reason, now);
    markRowDeleted_('VENDOR_LEDGER', row._rowIndex, user, reason, now);
    logDeletion_('vendors', ledgerId, '', reason, user);

    return ok_({ ledgerId: ledgerId, amount: amount });
  } catch (err) {
    logError_('deleteVendorPayment', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

/** One vendor return, shaped for the edit modal. */
function getVendorReturnForEdit(token, returnId) {
  try {
    requirePermission_(token, 'vendors', 'edit');
    var row = getAllRows_('VENDOR_RETURNS').filter(function (r) { return r['Return ID'] === returnId; })[0];
    if (!row) return fail_('Return not found.');
    if (isDeleted_(row)) return fail_('This return has been deleted.');
    return ok_({
      returnId: row['Return ID'], vendorId: row['Vendor ID'], sourcingId: row['Sourcing ID'],
      productId: row['Product ID'], productName: row['Product Name'],
      date: safeDateOnly_(row['Date']), quantity: Number(row['Quantity']) || 0,
      unitCost: Number(row['Unit Cost']) || 0, notes: row['Notes'] || ''
    });
  } catch (err) {
    logError_('getVendorReturnForEdit', err);
    return fail_(err.message);
  }
}

/**
 * Undoes a Vendor Return's stock + due effect. Gives the quantity back as
 * a fresh lot rather than hunting for the exact lot(s) it was drawn from
 * (a return isn't tied to one invoice's SALE_ITEM_LOTS trail the way a
 * Sales Return is — reduceLotForPurchaseReturn_/restoreStockToLots_'s own
 * fallback branches use the same "fresh lot" approach when precise lot
 * tracing isn't available).
 */
function reverseVendorReturnStockAndDue_(row, user, reason, when) {
  var qty = Number(row['Quantity']) || 0;
  var unitCost = Number(row['Unit Cost']) || 0;
  var newStock = adjustProductStock_(row['Product ID'], qty, row['Product Name']);
  var lot = createLot_(row['Product ID'], row['Product Name'], 'VENDOR-RETURN-REVERSAL', when, unitCost, qty);
  logReversalMovement_(row['Product ID'], row['Product Name'], 'Vendor Return Reversed',
    row['Return ID'], qty, '', newStock, lot, reason);
  adjustVendorDue_(row['Vendor ID'], qty * unitCost);
}

/** Reverses a vendor return fully, then re-applies it with the new figures. */
function updateVendorReturn(token, returnId, payload) {
  // Normal path: resolveEditedTransactionDate_(...) authorizes the requested date before updateRowFields_(...) in the trusted helper. Quantity changes are applied as stockDelta only; the full historical stock effect is never reversed first.
  return updateVendorReturnInternal_(token, returnId, payload, { lockHeld: false });
}

function updateVendorReturnInternal_(token, returnId, payload, options) {
  var opts = options || {};
  var lock = opts.lockHeld ? null : LockService.getScriptLock();
  if (lock) lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    requirePermission_(token, 'vendors', 'edit');
    requireActiveCashSession_();
    var row = getAllRows_('VENDOR_RETURNS').filter(function (r) { return r['Return ID'] === returnId; })[0];
    if (!row) return fail_('Return not found.');
    if (isDeleted_(row)) return fail_('This return has been deleted.');

    var newQty = Number(payload.quantity);
    if (!isValidNonNegativeNumber_(newQty) || newQty <= 0) return fail_('Enter a valid quantity.');
    var newUnitCost = Number(payload.unitCost);
    if (!isValidNonNegativeNumber_(newUnitCost)) return fail_('Enter a valid unit cost.');

    var sourcing = getAllRows_('VENDOR_SOURCING').filter(function (s) { return s['Sourcing ID'] === row['Sourcing ID']; })[0];
    if (!sourcing) return fail_('Original sourcing transaction no longer exists.');
    var otherReturned = activeRows_('VENDOR_RETURNS')
      .filter(function (r) { return r['Sourcing ID'] === row['Sourcing ID'] && r['Return ID'] !== returnId; })
      .reduce(function (sum, r) { return sum + (Number(r['Quantity']) || 0); }, 0);
    var remaining = (Number(sourcing['Quantity']) || 0) - otherReturned;
    if (newQty > remaining) return fail_('Only ' + remaining + ' unit(s) can be settled on this sourcing transaction.');

    var user = getSessionUser_(token);
    var now = new Date();
    var dateStr = resolveEditedTransactionDate_(token, 'vendors', payload.date, row['Date'], payload.backdatedReason, 'Vendor Return Edit');

    // Plan only the quantity DIFFERENCE. Reversing the full old return before
    // validating the replacement can corrupt stock if the replacement is
    // rejected. The existing return's stock effect is already real history.
    var product = getAllRows_('PRODUCTS').filter(function (p) { return p['Product ID'] === row['Product ID']; })[0];
    if (!product) return fail_('Product no longer exists.');
    var oldQty = Number(row['Quantity']) || 0;
    var stockDelta = newQty - oldQty;
    var currentStock = Number(product['Current Stock']) || 0;
    var extraPlan = null;
    if (stockDelta > 0) {
      if (currentStock < stockDelta) {
        return fail_('Not enough stock on hand to increase this return by ' + stockDelta + ' unit(s) — only ' + currentStock + ' available.');
      }
      extraPlan = planStockConsumption_(row['Product ID'], stockDelta, null);
      if (extraPlan.shortfall > 0) return fail_('Stock lots do not contain enough physical stock for this return adjustment.');
    }

    var oldTotal = Number(row['Total Value']);
    if (!isFinite(oldTotal)) oldTotal = oldQty * (Number(row['Unit Cost']) || 0);
    var newTotal = newQty * newUnitCost;

    // ---------------- write phase ----------------
    var newStock = currentStock;
    if (stockDelta > 0) {
      var consumption = applyStockConsumption_(extraPlan);
      newStock = adjustProductStock_(row['Product ID'], -stockDelta, row['Product Name']);
      consumption.forEach(function (c) {
        appendRow_('STOCK_MOVEMENT', {
          'Movement ID': generateId_('STOCK_MOVEMENT'), 'Date': now, 'Product ID': row['Product ID'],
          'Product Name': row['Product Name'], 'Type': 'Vendor Return Edit', 'Reference': returnId,
          'Quantity In': '', 'Quantity Out': c.qty, 'Balance Stock': newStock,
          'Notes': 'Additional quantity returned to ' + row['Vendor Name'], 'Lot ID': c.lotId
        });
      });
    } else if (stockDelta < 0) {
      var giveBack = Math.abs(stockDelta);
      newStock = adjustProductStock_(row['Product ID'], giveBack, row['Product Name']);
      var reversalLot = createLot_(row['Product ID'], row['Product Name'], 'VENDOR-RETURN-EDIT-REVERSAL', now, Number(row['Unit Cost']) || 0, giveBack);
      logReversalMovement_(row['Product ID'], row['Product Name'], 'Vendor Return Edit Reversal', returnId,
        giveBack, '', newStock, reversalLot, 'Return quantity reduced');
    }

    // Undo only the changed monetary effect. Correction mode keeps the historical
    // Vendor Ledger row and appends bounded delta/reversal rows instead.
    var vendorBalance;
    updateRowFields_('VENDOR_RETURNS', row._rowIndex, {
      'Date': dateStr, 'Quantity': newQty, 'Unit Cost': newUnitCost, 'Total Value': newTotal,
      'Notes': sanitizeInput_(payload.notes)
    });
    
      adjustVendorDue_(row['Vendor ID'], oldTotal);
      markMatchingDeleted_('VENDOR_LEDGER', function (l) {
        return l['Reference'] === returnId && l['Type'] === 'Return';
      }, user, 'Return edited', now);
      postVendorLedgerEntry_({
        vendorId: row['Vendor ID'], vendorName: row['Vendor Name'], date: dateStr, type: 'Return',
        reference: returnId, credit: newTotal,
        notes: 'Returned ' + newQty + ' x ' + row['Product Name'] + ' (Sourcing ' + row['Sourcing ID'] + ', edited)',
        createdBy: actorName_(user)
      });
    

    var vendorAfter = findVendor_(row['Vendor ID']);
    return ok_({ returnId: returnId, newStock: newStock, newDue: vendorAfter ? Number(vendorAfter['Current Due']) || 0 : 0 });
  } catch (err) {
    logError_('updateVendorReturn', err);
    return fail_(err.message);
  } finally {
    if (lock) lock.releaseLock();
  }
}
function deleteVendorReturn(token, returnId, reason) {
  var lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    if (!returnId) return fail_('No return specified.');
    if (!sanitizeInput_(reason)) return fail_('Enter a reason for deleting this return.');

    var row = getAllRows_('VENDOR_RETURNS').filter(function (r) { return r['Return ID'] === returnId; })[0];
    if (!row) return fail_('Return not found.');
    if (isDeleted_(row)) return fail_('This return is already deleted.');

    var user = requireDeletePermission_(token, 'vendors', row['Date']);
    requireActiveCashSession_();
    var now = new Date();

    reverseVendorReturnStockAndDue_(row, user, reason, now);
    markRowDeleted_('VENDOR_RETURNS', row._rowIndex, user, reason, now);
    markMatchingDeleted_('VENDOR_LEDGER', function (l) {
      return l['Reference'] === returnId && l['Type'] === 'Return';
    }, user, reason, now);
    logDeletion_('vendors', returnId, '', reason, user);

    return ok_({ returnId: returnId });
  } catch (err) {
    logError_('deleteVendorReturn', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

/** One vendor sourcing transaction, shaped for the edit modal. */
function getVendorSourcingForEdit(token, sourcingId) {
  try {
    requirePermission_(token, 'vendors', 'edit');
    var row = getAllRows_('VENDOR_SOURCING').filter(function (s) { return s['Sourcing ID'] === sourcingId; })[0];
    if (!row) return fail_('Sourcing transaction not found.');
    if (isDeleted_(row)) return fail_('This transaction has been deleted.');
    return ok_({
      sourcingId: row['Sourcing ID'], vendorId: row['Vendor ID'], invoiceId: row['Invoice ID'],
      productId: row['Product ID'], productName: row['Product Name'],
      date: safeDateOnly_(row['Date']), quantity: Number(row['Quantity']) || 0,
      unitCost: Number(row['Unit Cost']) || 0
    });
  } catch (err) {
    logError_('getVendorSourcingForEdit', err);
    return fail_(err.message);
  }
}

/**
 * Edits a Sourcing transaction's quantity/unit cost directly from Vendor
 * Ledger — due-only, by design (see Vendors.gs's header comment): never
 * reaches back into the sale invoice or its stock. Reverse-then-reapply,
 * same convention as every other ledger edit in this file.
 */
function updateVendorSourcing(token, sourcingId, payload) {
  // Normal path: resolveEditedTransactionDate_(...) authorizes the requested date before updateRowFields_(...) in the trusted helper.
  return updateVendorSourcingInternal_(token, sourcingId, payload, { lockHeld: false });
}

function updateVendorSourcingInternal_(token, sourcingId, payload, options) {
  var opts = options || {};
  var lock = opts.lockHeld ? null : LockService.getScriptLock();
  if (lock) lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    requirePermission_(token, 'vendors', 'edit');
    requireActiveCashSession_();
    var row = getAllRows_('VENDOR_SOURCING').filter(function (s) { return s['Sourcing ID'] === sourcingId; })[0];
    if (!row) return fail_('Sourcing transaction not found.');
    if (isDeleted_(row)) return fail_('This transaction has been deleted.');

    var newQty = Number(payload.quantity);
    if (!isValidNonNegativeNumber_(newQty) || newQty <= 0) return fail_('Enter a valid quantity.');
    var newUnitCost = Number(payload.unitCost);
    if (!isValidNonNegativeNumber_(newUnitCost)) return fail_('Enter a valid unit cost.');

    var alreadyReturned = activeRows_('VENDOR_RETURNS')
      .filter(function (r) { return r['Sourcing ID'] === sourcingId; })
      .reduce(function (sum, r) { return sum + (Number(r['Quantity']) || 0); }, 0);
    if (newQty < alreadyReturned) {
      return fail_(alreadyReturned + ' unit(s) have already been returned against this transaction — quantity cannot go below that.');
    }

    var user = getSessionUser_(token);
    var now = new Date();
    var oldTotal = Number(row['Total Cost']) || 0;
    var newTotal = newQty * newUnitCost;
    var dateStr = resolveEditedTransactionDate_(token, 'vendors', payload.date, row['Date'], payload.backdatedReason, 'Vendor Sourcing Edit');

    // write phase starts only after date authorization and value validation.
    updateRowFields_('VENDOR_SOURCING', row._rowIndex, {
      'Date': dateStr, 'Quantity': newQty, 'Unit Cost': newUnitCost, 'Total Cost': newTotal
    });
    
      adjustVendorDue_(row['Vendor ID'], -oldTotal); // undo old Debit
      markMatchingDeleted_('VENDOR_LEDGER', function (l) {
        return l['Reference'] === sourcingId && l['Type'] === 'Sourcing';
      }, user, 'Sourcing edited', now);
      postVendorLedgerEntry_({
        vendorId: row['Vendor ID'], vendorName: row['Vendor Name'], date: dateStr, type: 'Sourcing',
        reference: sourcingId, debit: newTotal,
        notes: 'Sourced ' + newQty + ' x ' + row['Product Name'] + ' for Invoice ' + row['Invoice ID'] + ' (edited)',
        createdBy: actorName_(user)
      });
    

    var vendorAfter = findVendor_(row['Vendor ID']);
    return ok_({ sourcingId: sourcingId, newDue: vendorAfter ? Number(vendorAfter['Current Due']) || 0 : 0 });
  } catch (err) {
    logError_('updateVendorSourcing', err);
    return fail_(err.message);
  } finally {
    if (lock) lock.releaseLock();
  }
}
/**
 * Cancels a Sourcing transaction directly from Vendor Ledger — due-only
 * reversal, no stock/invoice touch (see Vendors.gs's header comment):
 * this row is this shop's own bookkeeping fact of "we owe the vendor for
 * this," not a physical event, so undoing it only means the vendor is no
 * longer owed. Blocked once a Return has been recorded against it.
 */
function deleteVendorSourcing(token, sourcingId, reason) {
  var lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    if (!sourcingId) return fail_('No transaction specified.');
    if (!sanitizeInput_(reason)) return fail_('Enter a reason for deleting this transaction.');

    var row = getAllRows_('VENDOR_SOURCING').filter(function (s) { return s['Sourcing ID'] === sourcingId; })[0];
    if (!row) return fail_('Sourcing transaction not found.');
    if (isDeleted_(row)) return fail_('This transaction is already deleted.');

    var hasReturn = activeRows_('VENDOR_RETURNS').some(function (r) { return r['Sourcing ID'] === sourcingId; });
    if (hasReturn) return fail_('This transaction has Return records against it. Delete those first.');

    var user = requireDeletePermission_(token, 'vendors', row['Date']);
    requireActiveCashSession_();
    var now = new Date();
    var totalCost = Number(row['Total Cost']) || 0;

    adjustVendorDue_(row['Vendor ID'], -totalCost);
    markRowDeleted_('VENDOR_SOURCING', row._rowIndex, user, reason, now);
    markMatchingDeleted_('VENDOR_LEDGER', function (l) {
      return l['Reference'] === sourcingId && l['Type'] === 'Sourcing';
    }, user, reason, now);
    logDeletion_('vendors', sourcingId, row['Invoice ID'], reason, user);

    return ok_({ sourcingId: sourcingId, amount: totalCost });
  } catch (err) {
    logError_('deleteVendorSourcing', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

// ------------------------------------------------------------------
// 12. Vendor Ledger (Receivable side) - edit and delete
//     (Issue, Receipt, Return Received)
// ------------------------------------------------------------------
// The mirror image of section 11, one level of asymmetry per type:
//   Issue           - real stock left immediately at creation (mirrors
//                     Return, not Sourcing), so edit/delete reverses
//                     stock + Receivable together, reverse-then-reapply.
//   Receipt         - pure money, mirrors Payment exactly with Credit/
//                     Debit flipped (cash coming IN, not out).
//   Return Received - real stock came back in at creation; edit/delete
//                     must take it back OUT, which can legitimately fail
//                     if that stock has since been sold on — same
//                     accepted risk deletePurchase already carries.
// All three keep VENDOR_LEDGER (Reference = the record's own ID) in step
// with its detail sheet, same as section 11.

/** One vendor issue transaction, shaped for the edit modal. */
function getVendorIssueForEdit(token, issueId) {
  try {
    requirePermission_(token, 'vendors', 'edit');
    var row = getAllRows_('VENDOR_ISSUES').filter(function (s) { return s['Issue ID'] === issueId; })[0];
    if (!row) return fail_('Issue transaction not found.');
    if (isDeleted_(row)) return fail_('This transaction has been deleted.');
    return ok_({
      issueId: row['Issue ID'], vendorId: row['Vendor ID'],
      productId: row['Product ID'], productName: row['Product Name'],
      date: safeDateOnly_(row['Date']), quantity: Number(row['Quantity']) || 0,
      unitValue: Number(row['Unit Value']) || 0, notes: row['Notes'] || ''
    });
  } catch (err) {
    logError_('getVendorIssueForEdit', err);
    return fail_(err.message);
  }
}

/** One complete vendor-issue memo, grouped by Memo ID (legacy single issues use Issue ID as their memo ID). */
function getVendorIssueMemoForEdit(token, memoId) {
  try {
    requirePermission_(token, 'vendors', 'edit');
    memoId = String(memoId || '').trim();
    if (!memoId) return fail_('Memo not found.');
    var rows = activeRows_('VENDOR_ISSUES').filter(function (row) {
      return String(row['Memo ID'] || row['Issue ID']) === memoId;
    });
    if (!rows.length) return fail_('Vendor memo not found.');

    var returnedByIssue = {};
    activeRows_('VENDOR_RETURNS_RECEIVED').forEach(function (r) {
      returnedByIssue[r['Issue ID']] = (returnedByIssue[r['Issue ID']] || 0) + (Number(r['Quantity']) || 0);
    });
    return ok_({
      memoId: memoId,
      vendorId: rows[0]['Vendor ID'],
      vendorName: rows[0]['Vendor Name'],
      date: safeDateOnly_(rows[0]['Date']),
      notes: rows[0]['Notes'] || '',
      items: rows.map(function (row) {
        return {
          issueId: row['Issue ID'], productId: row['Product ID'], productName: row['Product Name'],
          quantity: Number(row['Quantity']) || 0, unitValue: Number(row['Unit Value']) || 0,
          returnedQty: returnedByIssue[row['Issue ID']] || 0
        };
      })
    });
  } catch (err) {
    logError_('getVendorIssueMemoForEdit', err);
    return fail_(err.message);
  }
}

/** Undoes a Vendor Issue's stock + Receivable effect: stock back (fresh lot), Receivable back down. */
function reverseVendorIssueStockAndReceivable_(row, user, reason, when) {
  var qty = Number(row['Quantity']) || 0;
  var unitValue = Number(row['Unit Value']) || 0;
  var newStock = adjustProductStock_(row['Product ID'], qty, row['Product Name']);
  var lot = createLot_(row['Product ID'], row['Product Name'], 'VENDOR-ISSUE-REVERSAL', when, unitValue, qty);
  logReversalMovement_(row['Product ID'], row['Product Name'], 'Vendor Issue Reversed',
    row['Issue ID'], qty, '', newStock, lot, reason);
  adjustVendorReceivable_(row['Vendor ID'], -(qty * unitValue));
}

/** Reverses a vendor issue fully, then re-applies it with the new figures. */
function updateVendorIssue(token, issueId, payload) {
  // Normal path: resolveEditedTransactionDate_(...) authorizes the requested date before updateRowFields_(...) in the trusted helper. Quantity changes are applied as stockDelta only; the full historical stock effect is never reversed first.
  return updateVendorIssueInternal_(token, issueId, payload, { lockHeld: false });
}

function updateVendorIssueInternal_(token, issueId, payload, options) {
  var opts = options || {};
  var lock = opts.lockHeld ? null : LockService.getScriptLock();
  if (lock) lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    requirePermission_(token, 'vendors', 'edit');
    requireActiveCashSession_();
    var row = getAllRows_('VENDOR_ISSUES').filter(function (s) { return s['Issue ID'] === issueId; })[0];
    if (!row) return fail_('Issue transaction not found.');
    if (isDeleted_(row)) return fail_('This transaction has been deleted.');

    var newQty = Number(payload.quantity);
    if (!isValidNonNegativeNumber_(newQty) || newQty <= 0) return fail_('Enter a valid quantity.');
    var newUnitValue = Number(payload.unitValue);
    if (!isValidNonNegativeNumber_(newUnitValue)) return fail_('Enter a valid unit value.');

    var alreadyReturned = activeRows_('VENDOR_RETURNS_RECEIVED')
      .filter(function (r) { return r['Issue ID'] === issueId; })
      .reduce(function (sum, r) { return sum + (Number(r['Quantity']) || 0); }, 0);
    if (newQty < alreadyReturned) {
      return fail_(alreadyReturned + ' unit(s) have already been received back against this transaction — quantity cannot go below that.');
    }

    var user = getSessionUser_(token);
    var now = new Date();
    var dateStr = resolveEditedTransactionDate_(token, 'vendors', payload.date, row['Date'], payload.backdatedReason, 'Vendor Issue Edit');

    var product = getAllRows_('PRODUCTS').filter(function (p) { return p['Product ID'] === row['Product ID']; })[0];
    if (!product) return fail_('Product no longer exists.');
    var oldQty = Number(row['Quantity']) || 0;
    var stockDelta = newQty - oldQty;
    var currentStock = Number(product['Current Stock']) || 0;
    var extraPlan = null;
    if (stockDelta > 0) {
      if (currentStock < stockDelta) {
        return fail_('Not enough stock on hand to increase this issue by ' + stockDelta + ' unit(s) — only ' + currentStock + ' available.');
      }
      extraPlan = planStockConsumption_(row['Product ID'], stockDelta, null);
      if (extraPlan.shortfall > 0) return fail_('Stock lots do not contain enough physical stock for this issue adjustment.');
    }

    var oldTotal = Number(row['Total Value']);
    if (!isFinite(oldTotal)) oldTotal = oldQty * (Number(row['Unit Value']) || 0);
    var newTotal = newQty * newUnitValue;

    // ---------------- write phase ----------------
    var newStock = currentStock;
    if (stockDelta > 0) {
      var consumption = applyStockConsumption_(extraPlan);
      newStock = adjustProductStock_(row['Product ID'], -stockDelta, row['Product Name']);
      consumption.forEach(function (c) {
        appendRow_('STOCK_MOVEMENT', {
          'Movement ID': generateId_('STOCK_MOVEMENT'), 'Date': now, 'Product ID': row['Product ID'],
          'Product Name': row['Product Name'], 'Type': 'Vendor Issue Edit', 'Reference': issueId,
          'Quantity In': '', 'Quantity Out': c.qty, 'Balance Stock': newStock,
          'Notes': 'Additional quantity given to ' + row['Vendor Name'], 'Lot ID': c.lotId
        });
      });
    } else if (stockDelta < 0) {
      var giveBack = Math.abs(stockDelta);
      newStock = adjustProductStock_(row['Product ID'], giveBack, row['Product Name']);
      var reversalLot = createLot_(row['Product ID'], row['Product Name'], 'VENDOR-ISSUE-EDIT-REVERSAL', now, Number(row['Unit Value']) || 0, giveBack);
      logReversalMovement_(row['Product ID'], row['Product Name'], 'Vendor Issue Edit Reversal', issueId,
        giveBack, '', newStock, reversalLot, 'Issue quantity reduced');
    }

    updateRowFields_('VENDOR_ISSUES', row._rowIndex, {
      'Date': dateStr, 'Quantity': newQty, 'Unit Value': newUnitValue, 'Total Value': newTotal,
      'Notes': sanitizeInput_(payload.notes)
    });
    
      adjustVendorReceivable_(row['Vendor ID'], -oldTotal);
      markMatchingDeleted_('VENDOR_LEDGER', function (l) {
        return l['Reference'] === issueId && l['Type'] === 'Issue';
      }, user, 'Issue edited', now);
      postVendorLedgerEntry_({
        vendorId: row['Vendor ID'], vendorName: row['Vendor Name'], date: dateStr, type: 'Issue',
        reference: issueId, debit: newTotal, balanceType: 'Receivable',
        notes: 'Memo ' + (row['Memo ID'] || row['Issue ID']) + ' — Gave ' + newQty + ' x ' + row['Product Name'] + ' (edited)' + (sanitizeInput_(payload.notes) ? ' — ' + sanitizeInput_(payload.notes) : ''),
        createdBy: actorName_(user)
      });
    

    var vendorAfter = findVendor_(row['Vendor ID']);
    return ok_({ issueId: issueId, newStock: newStock, newReceivable: vendorAfter ? Number(vendorAfter['Current Receivable']) || 0 : 0 });
  } catch (err) {
    logError_('updateVendorIssue', err);
    return fail_(err.message);
  } finally {
    if (lock) lock.releaseLock();
  }
}
function deleteVendorIssue(token, issueId, reason) {
  var lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    if (!issueId) return fail_('No transaction specified.');
    if (!sanitizeInput_(reason)) return fail_('Enter a reason for deleting this transaction.');

    var row = getAllRows_('VENDOR_ISSUES').filter(function (s) { return s['Issue ID'] === issueId; })[0];
    if (!row) return fail_('Issue transaction not found.');
    if (isDeleted_(row)) return fail_('This transaction is already deleted.');

    var hasReturn = activeRows_('VENDOR_RETURNS_RECEIVED').some(function (r) { return r['Issue ID'] === issueId; });
    if (hasReturn) return fail_('This transaction has Return Received records against it. Delete those first.');

    var user = requireDeletePermission_(token, 'vendors', row['Date']);
    requireActiveCashSession_();
    var now = new Date();

    reverseVendorIssueStockAndReceivable_(row, user, reason, now);
    markRowDeleted_('VENDOR_ISSUES', row._rowIndex, user, reason, now);
    markMatchingDeleted_('VENDOR_LEDGER', function (l) {
      return l['Reference'] === issueId && l['Type'] === 'Issue';
    }, user, reason, now);
    logDeletion_('vendors', issueId, '', reason, user);

    return ok_({ issueId: issueId });
  } catch (err) {
    logError_('deleteVendorIssue', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Update all lines of one posted vendor memo together. Product identity is
 * intentionally fixed after posting; quantity, unit value, date and memo note
 * stay editable. This reuses the native per-Issue edit engine after validating
 * every line first, so stock/receivable behavior remains identical.
 */
function updateVendorIssueMemo(token, memoId, payload) {
  var lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    requirePermission_(token, 'vendors', 'edit');
    requireActiveCashSession_();
    payload = payload || {};
    memoId = String(memoId || '').trim();
    var rows = activeRows_('VENDOR_ISSUES').filter(function (row) {
      return String(row['Memo ID'] || row['Issue ID']) === memoId;
    });
    if (!rows.length) return fail_('Vendor memo not found.');

    var requested = Array.isArray(payload.items) ? payload.items : [];
    if (requested.length !== rows.length) return fail_('Every product line in the memo must be included when editing.');
    var requestedByIssue = {};
    requested.forEach(function (item) {
      var issueId = String((item || {}).issueId || '').trim();
      if (issueId) requestedByIssue[issueId] = item;
    });
    if (Object.keys(requestedByIssue).length !== rows.length) return fail_('Memo product lines are invalid or duplicated.');

    var productsById = {};
    getAllRows_('PRODUCTS').forEach(function (p) { productsById[p['Product ID']] = p; });
    var returnedByIssue = {};
    activeRows_('VENDOR_RETURNS_RECEIVED').forEach(function (r) {
      returnedByIssue[r['Issue ID']] = (returnedByIssue[r['Issue ID']] || 0) + (Number(r['Quantity']) || 0);
    });

    // Full validation before the first mutation.
    rows.forEach(function (row) {
      var item = requestedByIssue[row['Issue ID']];
      if (!item) throw new Error('Memo line ' + row['Issue ID'] + ' is missing.');
      var newQty = Number(item.quantity);
      var newUnitValue = Number(item.unitValue);
      if (!isValidNonNegativeNumber_(newQty) || newQty <= 0) throw new Error('Enter a valid quantity for ' + row['Product Name'] + '.');
      if (!isValidNonNegativeNumber_(newUnitValue)) throw new Error('Enter a valid unit value for ' + row['Product Name'] + '.');
      var returned = returnedByIssue[row['Issue ID']] || 0;
      if (newQty < returned) throw new Error(returned + ' unit(s) of ' + row['Product Name'] + ' have already been received back; quantity cannot go below that.');
      var oldQty = Number(row['Quantity']) || 0;
      var increase = newQty - oldQty;
      if (increase > 0) {
        var product = productsById[row['Product ID']];
        if (!product || isDeleted_(product)) throw new Error(row['Product Name'] + ' no longer exists.');
        var currentStock = Number(product['Current Stock']) || 0;
        if (currentStock < increase) throw new Error('Not enough stock to increase ' + row['Product Name'] + ' by ' + increase + ' unit(s); only ' + currentStock + ' available.');
        var plan = planStockConsumption_(row['Product ID'], increase, null);
        if (plan.shortfall > 0) throw new Error('Stock lots do not contain enough physical stock for ' + row['Product Name'] + '.');
      }
      // Authorize every requested date before any line is changed.
      resolveEditedTransactionDate_(token, 'vendors', payload.date, row['Date'], payload.backdatedReason, 'Vendor Memo Edit');
    });

    var commonNote = sanitizeInput_(payload.notes);
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var item = requestedByIssue[row['Issue ID']];
      var result = updateVendorIssueInternal_(token, row['Issue ID'], {
        date: payload.date,
        quantity: item.quantity,
        unitValue: item.unitValue,
        notes: commonNote,
        backdatedReason: payload.backdatedReason
      }, { lockHeld: true });
      if (!result || !result.success) throw new Error(result && result.message ? result.message : 'Could not update vendor memo.');
    }
    return ok_({ memoId: memoId, lineCount: rows.length });
  } catch (err) {
    logError_('updateVendorIssueMemo', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

/** Delete an entire vendor issue memo as one user action. */
function deleteVendorIssueMemo(token, memoId, reason) {
  var lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    memoId = String(memoId || '').trim();
    reason = sanitizeInput_(reason);
    if (!memoId) return fail_('No memo specified.');
    if (!reason) return fail_('Enter a reason for deleting this memo.');
    var rows = activeRows_('VENDOR_ISSUES').filter(function (row) {
      return String(row['Memo ID'] || row['Issue ID']) === memoId;
    });
    if (!rows.length) return fail_('Vendor memo not found or already deleted.');

    var returnIssueIds = {};
    activeRows_('VENDOR_RETURNS_RECEIVED').forEach(function (r) { returnIssueIds[r['Issue ID']] = true; });
    rows.forEach(function (row) {
      if (returnIssueIds[row['Issue ID']]) throw new Error('Memo ' + memoId + ' has products already received back. Delete those Return Received records first.');
    });

    var user = null;
    rows.forEach(function (row) {
      var checkedUser = requireDeletePermission_(token, 'vendors', row['Date']);
      if (!user) user = checkedUser;
    });
    requireActiveCashSession_();
    var now = new Date();

    rows.forEach(function (row) {
      reverseVendorIssueStockAndReceivable_(row, user, reason, now);
      markRowDeleted_('VENDOR_ISSUES', row._rowIndex, user, reason, now);
      markMatchingDeleted_('VENDOR_LEDGER', function (l) {
        return l['Reference'] === row['Issue ID'] && l['Type'] === 'Issue';
      }, user, reason, now);
      logDeletion_('vendors', row['Issue ID'], '', 'Memo ' + memoId + ': ' + reason, user);
    });
    return ok_({ memoId: memoId, deletedLines: rows.length });
  } catch (err) {
    logError_('deleteVendorIssueMemo', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

/** One vendor receipt, shaped for the edit modal. */
function getVendorReceiptForEdit(token, ledgerId) {
  try {
    requirePermission_(token, 'vendors', 'edit');
    var row = getAllRows_('VENDOR_LEDGER').filter(function (l) { return l['Ledger ID'] === ledgerId; })[0];
    if (!row) return fail_('Receipt not found.');
    if (isDeleted_(row)) return fail_('This receipt has been deleted.');
    if (row['Type'] !== 'Receipt') return fail_('Only receipt rows can be edited here.');
    return ok_({
      ledgerId: row['Ledger ID'], vendorId: row['Vendor ID'], vendorName: row['Vendor Name'],
      date: safeDateOnly_(row['Date']), amount: Number(row['Credit']) || 0,
      method: row['Payment Method'] || 'Cash', bankAccountId: paymentAccountForReference_(row, ledgerId), notes: row['Notes'] || ''
    });
  } catch (err) {
    logError_('getVendorReceiptForEdit', err);
    return fail_(err.message);
  }
}

/** Undoes a vendor receipt's money movement: Receivable goes back up, cash/bank entries voided. */
function reverseVendorReceiptMoney_(ledgerId, vendorId, amount, user, reason, when) {
  adjustVendorReceivable_(vendorId, amount);
  markMatchingDeleted_('CASH_BOOK', function (c) { return c['Reference'] === ledgerId; }, user, reason, when);
  voidBankEntriesFor_(ledgerId, user, reason);
}

/** Reverses a vendor receipt completely, then re-applies it with the new figures. */
function updateVendorReceipt(token, ledgerId, payload) {
  // Normal path: resolveEditedTransactionDate_(...) authorizes the requested date before updateRowFields_(...) in the trusted helper.
  return updateVendorReceiptInternal_(token, ledgerId, payload, { lockHeld: false });
}

function updateVendorReceiptInternal_(token, ledgerId, payload, options) {
  var opts = options || {};
  var lock = opts.lockHeld ? null : LockService.getScriptLock();
  if (lock) lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    requirePermission_(token, 'vendors', 'edit');
    requireActiveCashSession_();
    var row = getAllRows_('VENDOR_LEDGER').filter(function (l) { return l['Ledger ID'] === ledgerId; })[0];
    if (!row) return fail_('Receipt not found.');
    if (isDeleted_(row)) return fail_('This receipt has been deleted.');
    if (row['Type'] !== 'Receipt') return fail_('Only receipt rows can be edited.');

    var newAmount = Number(payload.amount);
    if (!isValidNonNegativeNumber_(newAmount) || newAmount <= 0) return fail_('Enter a valid amount.');

    var user = getSessionUser_(token);
    var vendorId = row['Vendor ID'];
    var oldAmount = Number(row['Credit']) || 0;
    var now = new Date();
    var dateStr = resolveEditedTransactionDate_(token, 'vendors', payload.date, row['Date'], payload.backdatedReason, 'Vendor Receipt Edit');
    var method = payload.method || row['Payment Method'] || 'Cash';
    var bank = resolveBankAccount_(method, payload.bankAccountId);

    var oldBankAccountId = paymentAccountForReference_(row, ledgerId);
    var newReceivable;
    
      reverseVendorReceiptMoney_(ledgerId, vendorId, oldAmount, user, 'Receipt edited', now);

      newReceivable = adjustVendorReceivable_(vendorId, -newAmount);
      updateRowFields_('VENDOR_LEDGER', row._rowIndex, {
        'Date': dateStr, 'Credit': newAmount, 'Balance': newReceivable,
        'Payment Method': method, 'Notes': sanitizeInput_(payload.notes)
      });

      if (method === 'Cash') {
        addCashBookEntry_({
          Type: 'Vendor Receipt', Reference: ledgerId,
          Description: 'Received from ' + row['Vendor Name'] + ' (edited)',
          Debit: '', Credit: newAmount, PaymentMethod: 'Cash', Date: dateStr
        });
      } else if (isBankLikePaymentMethod_(method)) {
        addBankBookEntry_(bank.id, {
          Type: 'Vendor Receipt', Reference: ledgerId,
          Description: 'Received from ' + row['Vendor Name'] + ' (edited)',
          Debit: '', Credit: newAmount, Date: dateStr
        });
      }
    

    return ok_({ ledgerId: ledgerId, newReceivable: newReceivable });
  } catch (err) {
    logError_('updateVendorReceipt', err);
    return fail_(err.message);
  } finally {
    if (lock) lock.releaseLock();
  }
}
/** Soft-deletes a vendor receipt and puts the Receivable back up. */
function deleteVendorReceipt(token, ledgerId, reason) {
  var lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    if (!ledgerId) return fail_('No receipt specified.');
    if (!sanitizeInput_(reason)) return fail_('Enter a reason for deleting this receipt.');

    var row = getAllRows_('VENDOR_LEDGER').filter(function (l) { return l['Ledger ID'] === ledgerId; })[0];
    if (!row) return fail_('Receipt not found.');
    if (isDeleted_(row)) return fail_('This receipt is already deleted.');
    if (row['Type'] !== 'Receipt') return fail_('Only receipt rows can be deleted here.');

    var user = requireDeletePermission_(token, 'vendors', row['Date']);
    requireActiveCashSession_();
    var now = new Date();
    var amount = Number(row['Credit']) || 0;

    reverseVendorReceiptMoney_(ledgerId, row['Vendor ID'], amount, user, reason, now);
    markRowDeleted_('VENDOR_LEDGER', row._rowIndex, user, reason, now);
    logDeletion_('vendors', ledgerId, '', reason, user);

    return ok_({ ledgerId: ledgerId, amount: amount });
  } catch (err) {
    logError_('deleteVendorReceipt', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

/** One vendor return-received transaction, shaped for the edit modal. */
function getVendorReturnReceivedForEdit(token, returnId) {
  try {
    requirePermission_(token, 'vendors', 'edit');
    var row = getAllRows_('VENDOR_RETURNS_RECEIVED').filter(function (r) { return r['Return ID'] === returnId; })[0];
    if (!row) return fail_('Return not found.');
    if (isDeleted_(row)) return fail_('This return has been deleted.');
    return ok_({
      returnId: row['Return ID'], vendorId: row['Vendor ID'], issueId: row['Issue ID'],
      productId: row['Product ID'], productName: row['Product Name'],
      date: safeDateOnly_(row['Date']), quantity: Number(row['Quantity']) || 0,
      unitValue: Number(row['Unit Value']) || 0, notes: row['Notes'] || ''
    });
  } catch (err) {
    logError_('getVendorReturnReceivedForEdit', err);
    return fail_(err.message);
  }
}

/**
 * Undoes a Return Received's stock + Receivable effect: takes the
 * quantity back out (FIFO, same as any other stock-out reversal — the
 * fresh lot the original creation added may have already been partly
 * consumed by other sales in the meantime, so this can legitimately fail
 * if not enough remains — same accepted risk deletePurchase carries),
 * Receivable back up.
 */
function reverseVendorReturnReceivedStockAndReceivable_(row, user, reason, when) {
  var qty = Number(row['Quantity']) || 0;
  var unitValue = Number(row['Unit Value']) || 0;
  var plan = planStockConsumption_(row['Product ID'], qty, null);
  var consumption = applyStockConsumption_(plan);
  var newStock = adjustProductStock_(row['Product ID'], -qty, row['Product Name']);
  consumption.forEach(function (c) {
    logReversalMovement_(row['Product ID'], row['Product Name'], 'Vendor Return Received Reversed',
      row['Return ID'], '', c.qty, newStock, c.lotId, reason);
  });
  adjustVendorReceivable_(row['Vendor ID'], qty * unitValue);
}

/** Reverses a return-received fully, then re-applies it with the new figures. */
function updateVendorReturnReceived(token, returnId, payload) {
  // Normal path: resolveEditedTransactionDate_(...) authorizes the requested date before updateRowFields_(...) in the trusted helper. Quantity changes are applied as stockDelta only; the full historical stock effect is never reversed first.
  return updateVendorReturnReceivedInternal_(token, returnId, payload, { lockHeld: false });
}

function updateVendorReturnReceivedInternal_(token, returnId, payload, options) {
  var opts = options || {};
  var lock = opts.lockHeld ? null : LockService.getScriptLock();
  if (lock) lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    requirePermission_(token, 'vendors', 'edit');
    requireActiveCashSession_();
    var row = getAllRows_('VENDOR_RETURNS_RECEIVED').filter(function (r) { return r['Return ID'] === returnId; })[0];
    if (!row) return fail_('Return not found.');
    if (isDeleted_(row)) return fail_('This return has been deleted.');

    var newQty = Number(payload.quantity);
    if (!isValidNonNegativeNumber_(newQty) || newQty <= 0) return fail_('Enter a valid quantity.');
    var newUnitValue = Number(payload.unitValue);
    if (!isValidNonNegativeNumber_(newUnitValue)) return fail_('Enter a valid unit value.');

    var issue = getAllRows_('VENDOR_ISSUES').filter(function (s) { return s['Issue ID'] === row['Issue ID']; })[0];
    if (!issue) return fail_('Original issue transaction no longer exists.');
    var otherReturned = activeRows_('VENDOR_RETURNS_RECEIVED')
      .filter(function (r) { return r['Issue ID'] === row['Issue ID'] && r['Return ID'] !== returnId; })
      .reduce(function (sum, r) { return sum + (Number(r['Quantity']) || 0); }, 0);
    var remaining = (Number(issue['Quantity']) || 0) - otherReturned;
    if (newQty > remaining) return fail_('Only ' + remaining + ' unit(s) can be settled on this issue transaction.');

    var user = getSessionUser_(token);
    var now = new Date();
    var dateStr = resolveEditedTransactionDate_(token, 'vendors', payload.date, row['Date'], payload.backdatedReason, 'Vendor Return Received Edit');

    var product = getAllRows_('PRODUCTS').filter(function (p) { return p['Product ID'] === row['Product ID']; })[0];
    if (!product) return fail_('Product no longer exists.');
    var oldQty = Number(row['Quantity']) || 0;
    var stockDelta = newQty - oldQty;
    var currentStock = Number(product['Current Stock']) || 0;
    var removalPlan = null;
    if (stockDelta < 0) {
      var removeQty = Math.abs(stockDelta);
      if (currentStock < removeQty) {
        return fail_('Not enough stock remains to reduce this receipt by ' + removeQty + ' unit(s) — only ' + currentStock + ' available.');
      }
      removalPlan = planStockConsumption_(row['Product ID'], removeQty, null);
      if (removalPlan.shortfall > 0) return fail_('Stock lots do not contain enough physical stock for this receipt adjustment.');
    }

    var oldTotal = Number(row['Total Value']);
    if (!isFinite(oldTotal)) oldTotal = oldQty * (Number(row['Unit Value']) || 0);
    var newTotal = newQty * newUnitValue;

    // ---------------- write phase ----------------
    var newStock = currentStock;
    if (stockDelta > 0) {
      newStock = adjustProductStock_(row['Product ID'], stockDelta, row['Product Name']);
      var lotId = createLot_(row['Product ID'], row['Product Name'], 'VENDOR-RETURN-RECEIVED-EDIT', now, newUnitValue, stockDelta);
      logReversalMovement_(row['Product ID'], row['Product Name'], 'Vendor Return Received Edit', returnId,
        stockDelta, '', newStock, lotId, 'Receipt quantity increased');
    } else if (stockDelta < 0) {
      var consumption = applyStockConsumption_(removalPlan);
      newStock = adjustProductStock_(row['Product ID'], stockDelta, row['Product Name']);
      consumption.forEach(function (c) {
        logReversalMovement_(row['Product ID'], row['Product Name'], 'Vendor Return Received Edit', returnId,
          '', c.qty, newStock, c.lotId, 'Receipt quantity reduced');
      });
    }

    updateRowFields_('VENDOR_RETURNS_RECEIVED', row._rowIndex, {
      'Date': dateStr, 'Quantity': newQty, 'Unit Value': newUnitValue, 'Total Value': newTotal,
      'Notes': sanitizeInput_(payload.notes)
    });
    
      adjustVendorReceivable_(row['Vendor ID'], oldTotal);
      markMatchingDeleted_('VENDOR_LEDGER', function (l) {
        return l['Reference'] === returnId && l['Type'] === 'Return Received';
      }, user, 'Return edited', now);
      postVendorLedgerEntry_({
        vendorId: row['Vendor ID'], vendorName: row['Vendor Name'], date: dateStr, type: 'Return Received',
        reference: returnId, credit: newTotal, balanceType: 'Receivable',
        notes: 'Received back ' + newQty + ' x ' + row['Product Name'] + ' (Issue ' + row['Issue ID'] + ', edited)',
        createdBy: actorName_(user)
      });
    

    var vendorAfter = findVendor_(row['Vendor ID']);
    return ok_({ returnId: returnId, newStock: newStock, newReceivable: vendorAfter ? Number(vendorAfter['Current Receivable']) || 0 : 0 });
  } catch (err) {
    logError_('updateVendorReturnReceived', err);
    return fail_(err.message);
  } finally {
    if (lock) lock.releaseLock();
  }
}
function deleteVendorReturnReceived(token, returnId, reason) {
  var lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    if (!returnId) return fail_('No return specified.');
    if (!sanitizeInput_(reason)) return fail_('Enter a reason for deleting this return.');

    var row = getAllRows_('VENDOR_RETURNS_RECEIVED').filter(function (r) { return r['Return ID'] === returnId; })[0];
    if (!row) return fail_('Return not found.');
    if (isDeleted_(row)) return fail_('This return is already deleted.');

    var user = requireDeletePermission_(token, 'vendors', row['Date']);
    requireActiveCashSession_();
    var now = new Date();

    reverseVendorReturnReceivedStockAndReceivable_(row, user, reason, now);
    markRowDeleted_('VENDOR_RETURNS_RECEIVED', row._rowIndex, user, reason, now);
    markMatchingDeleted_('VENDOR_LEDGER', function (l) {
      return l['Reference'] === returnId && l['Type'] === 'Return Received';
    }, user, reason, now);
    logDeletion_('vendors', returnId, '', reason, user);

    return ok_({ returnId: returnId });
  } catch (err) {
    logError_('deleteVendorReturnReceived', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

// ------------------------------------------------------------------
// 13. Administrator view of deleted records
// ------------------------------------------------------------------

/** Sheet + id column behind each deletable module, for the admin recycle view. */
var DELETED_VIEW_SOURCES_ = {
  sales:     { sheet: 'SALES',           id: 'Invoice ID',  label: 'Date', amount: 'Grand Total' },
  purchase:  { sheet: 'PURCHASES',       id: 'Purchase ID', label: 'Date', amount: 'Grand Total' },
  expense:   { sheet: 'EXPENSES',        id: 'Expense ID',  label: 'Date', amount: 'Amount' },
  suppliers: { sheet: 'SUPPLIERS',       id: 'Supplier ID', label: 'Created At', amount: 'Current Due' },
  products:  { sheet: 'PRODUCTS',        id: 'Product ID',  label: 'Created At', amount: 'Selling Price' },
  customers: { sheet: 'CUSTOMERS',       id: 'Customer ID', label: 'Created At', amount: 'Current Due' },
  finance:   { sheet: 'FINANCE_TRANSACTIONS', id: 'Finance ID', label: 'Date', amount: 'Amount' }
};

/**
 * Everything soft-deleted, for Administrators only. Deliberately admin-gated
 * rather than permission-gated: the whole point of hiding a deleted row is
 * that ordinary users do not see it, and a "can view deleted" permission
 * would just be a second way to grant that.
 */
function getDeletedRecords(token, moduleKey) {
  try {
    requireAdmin_(token);
    var keys = moduleKey && DELETED_VIEW_SOURCES_[moduleKey] ? [moduleKey] : Object.keys(DELETED_VIEW_SOURCES_);
    var out = [];
    keys.forEach(function (k) {
      var src = DELETED_VIEW_SOURCES_[k];
      getAllRows_(src.sheet).filter(isDeleted_).forEach(function (r) {
        out.push({
          module: k,
          recordId: r[src.id],
          date: safeDateOnly_(r[src.label]),
          amount: Number(r[src.amount]) || 0,
          name: r['Customer Name'] || r['Supplier Name'] || r['Product Name'] || r['Description'] || r['Person'] || '',
          deletedBy: r['Deleted By'] || '',
          deletedAt: r['Deleted At'] || '',
          reason: r['Delete Reason'] || ''
        });
      });
    });
    out.sort(function (a, b) { return String(b.deletedAt).localeCompare(String(a.deletedAt)); });
    return ok_(out);
  } catch (err) {
    logError_('getDeletedRecords', err);
    return fail_(err.message);
  }
}

/** The delete-permission matrix as the Roles page needs it. */
function getDeletableModules(token) {
  try {
    requireAdmin_(token);
    return ok_({ modules: DELETABLE_MODULES, windows: DELETE_WINDOW_OPTIONS });
  } catch (err) {
    logError_('getDeletableModules', err);
    return fail_(err.message);
  }
}
