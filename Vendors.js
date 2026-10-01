/**
 * Vendors.gs
 * ---------------------------------------------------------------------
 * Master data for POS's Vendor/Consignment Sourcing shortage chooser
 * (see Sales.gs completeSale / SalesManagement.gs updateSale), plus the
 * Vendor Ledger page (vendors.html) — view each vendor's full two-way
 * transaction history, pay/settle either direction, and give/receive
 * stock. A vendor here is deliberately NOT a Suppliers row — Suppliers
 * are who this shop buys inventory from on the books; a Vendor is a
 * separate, lighter-weight list for one-off shops, mirroring
 * FinanceModule.gs's FINANCE_PERSONS pattern: add + Active/Inactive,
 * with editable master contact details (name/phone/address), and soft delete
 * only after balances and open obligations are fully settled.
 *
 * Rides its own 'vendors' permission module (view/add/edit/delete) rather
 * than piggybacking on 'pos' — Vendor Ledger access (pay/settle/edit/
 * delete transactions) is a distinct, separately-grantable right from POS
 * itself, the same way Suppliers has its own permission separate from
 * Purchases.
 *
 * Two-way relationship, two separate stored running balances (never
 * netted into one signed number — the ledger shows both at once):
 *   'Current Due'        — Payable, what WE owe THEM.
 *     Sourcing (they give us stock, Debit) / Payment (we pay cash,
 *     Credit) / Return (we give stock back to settle, Credit).
 *   'Current Receivable' — Receivable, what THEY owe US.
 *     Issue (we give them stock, Debit) / Receipt (they pay us cash,
 *     Credit) / Return Received (they give stock back to settle,
 *     Credit).
 * Every function that changes either one goes through
 * adjustVendorDue_/adjustVendorReceivable_ (the raw additive-delta
 * writes) via postVendorLedgerEntry_ (which also appends the
 * VENDOR_LEDGER row, tagged with which Balance Type it affects, and
 * stamps its Balance), so the ledger and the stored balances can never
 * drift apart. The one exception is DeleteEngine.gs reversing/
 * soft-deleting a ledger row directly — see its own comments.
 *
 * Editing/deleting a Sourcing or Issue row (done in DeleteEngine.gs)
 * never reaches back into the original sale invoice or its stock/lots —
 * both are this shop's own bookkeeping record of a due; canceling or
 * correcting one only changes that fact, by design (kept deliberately
 * simple, per user request). Payment/Return/Receipt/Return Received rows
 * own real money or stock movement of their own, so their edit/delete
 * reverses that movement in full instead.
 * ---------------------------------------------------------------------
 */

/** Every vendor, active or not — the Manage list needs to see inactive ones too, so an already-used vendor is never silently dropped. */
function getAllVendorsForUI_() {
  return activeRows_('VENDORS').map(function (v) {
    return {
      id: v['Vendor ID'], name: v['Vendor Name'], phone: v['Phone'] || '', address: v['Address'] || '',
      currentDue: Number(v['Current Due']) || 0,
      currentReceivable: Number(v['Current Receivable']) || 0,
      status: v['Status'] || 'Active'
    };
  });
}

/** Active vendors only, shaped for POS's per-line vendor-sourcing dropdown. */
function getActiveVendorsForUI_() {
  return getAllVendorsForUI_().filter(function (v) { return v.status !== 'Inactive'; });
}

/** Looks up one vendor row by ID, or null. */
function findVendor_(vendorId) {
  return getAllRows_('VENDORS').filter(function (v) { return v['Vendor ID'] === vendorId; })[0] || null;
}

/** payload = { name, phone, address }. */
function addVendor(token, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    requirePermission_(token, 'vendors', 'add');
    payload = payload || {};
    const name = sanitizeInput_(payload.name);
    if (!name) return fail_('Vendor name is required.');

    const duplicate = activeRows_('VENDORS').some(function (v) {
      return String(v['Vendor Name']).toLowerCase() === name.toLowerCase();
    });
    if (duplicate) return fail_('A vendor with this name already exists.');

    const id = generateId_('VENDORS');
    appendRow_('VENDORS', {
      'Vendor ID': id, 'Vendor Name': name, 'Phone': sanitizeInput_(payload.phone), 'Address': sanitizeInput_(payload.address),
      'Current Due': 0, 'Current Receivable': 0, 'Status': 'Active', 'Created At': new Date()
    });
    return ok_({ id: id });
  } catch (err) {
    logError_('addVendor', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}


/** Update vendor master contact details without rewriting historical transaction snapshots. */
function updateVendor(token, vendorId, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    requirePermission_(token, 'vendors', 'edit');
    payload = payload || {};
    const vendor = findVendor_(vendorId);
    if (!vendor || isDeleted_(vendor)) return fail_('Vendor not found.');
    const name = sanitizeInput_(payload.name);
    if (!name) return fail_('Vendor name is required.');

    const duplicate = activeRows_('VENDORS').some(function (v) {
      return v['Vendor ID'] !== vendorId && String(v['Vendor Name']).toLowerCase() === name.toLowerCase();
    });
    if (duplicate) return fail_('A vendor with this name already exists.');

    const rowIndex = vendor._rowIndex || findRowIndex_('VENDORS', 'Vendor ID', vendorId);
    if (rowIndex === -1) return fail_('Vendor not found.');
    updateRowFields_('VENDORS', rowIndex, {
      'Vendor Name': name,
      'Phone': sanitizeInput_(payload.phone),
      'Address': sanitizeInput_(payload.address)
    });
    return ok_({ id: vendorId });
  } catch (err) {
    logError_('updateVendor', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

/** Activate/deactivate a vendor. No lock — matches setFinancePersonStatus's precedent exactly (a single-field status flip). */
function setVendorStatus(token, vendorId, status) {
  try {
    requirePermission_(token, 'vendors', 'edit');
    const vendor = findVendor_(vendorId);
    if (!vendor || isDeleted_(vendor)) return fail_('Vendor not found.');
    const rowIndex = vendor._rowIndex || findRowIndex_('VENDORS', 'Vendor ID', vendorId);
    if (rowIndex === -1) return fail_('Vendor not found.');
    updateRowFields_('VENDORS', rowIndex, { 'Status': status === 'Active' ? 'Active' : 'Inactive' });
    return ok_({ id: vendorId, status: status });
  } catch (err) {
    logError_('setVendorStatus', err);
    return fail_(err.message);
  }
}


/** Soft-delete a settled vendor while preserving every historical transaction. */
function deleteVendor(token, vendorId, reason) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    reason = sanitizeInput_(reason);
    if (!vendorId) return fail_('No vendor specified.');
    if (!reason) return fail_('Enter a reason for deleting this vendor.');
    const vendor = findVendor_(vendorId);
    if (!vendor || isDeleted_(vendor)) return fail_('Vendor not found or already deleted.');
    const actingUser = requireDeletePermission_(token, 'vendors', vendor['Created At'] || formatDate_(new Date()));

    const due = Number(vendor['Current Due']) || 0;
    const receivable = Number(vendor['Current Receivable']) || 0;
    if (Math.abs(due) > 0.009) return fail_('Settle the vendor payable balance before deleting this vendor.');
    if (Math.abs(receivable) > 0.009) return fail_('Settle the vendor receivable balance before deleting this vendor.');

    const obligations = getVendorOpenObligations_(vendorId);
    const openSourcing = obligations.openSourcing;
    const openIssues = obligations.openIssues;
    if (openSourcing.length) return fail_('This vendor still has open sourced-product obligations. Settle them before deleting.');
    if (openIssues.length) return fail_('This vendor still has open issued-product obligations. Settle them before deleting.');

    // First write only after every eligibility check above has passed.
    const rowIndex = vendor._rowIndex || findRowIndex_('VENDORS', 'Vendor ID', vendorId);
    if (rowIndex === -1) return fail_('Vendor not found.');
    const now = new Date();
    markRowDeleted_('VENDORS', rowIndex, actingUser, reason, now);
    logDeletion_('vendors', vendorId, '', reason, actingUser);
    return ok_({ vendorId: vendorId });
  } catch (err) {
    logError_('deleteVendor', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Adds delta to a vendor's Current Due and returns the new figure. Positive
 * delta posts a new vendor-sourcing cost (completeSale/updateSale);
 * negative delta reverses one (deleteSalesInvoice, updateSale on a
 * reduced/removed line). Returns null if the vendor row is gone (should
 * never happen in practice — a vendor is only deactivated, never deleted).
 */
function adjustVendorDue_(vendorId, delta) {
  const idx = findRowIndex_('VENDORS', 'Vendor ID', vendorId);
  if (idx === -1) return null;
  const row = getAllRows_('VENDORS').filter(function (v) { return v['Vendor ID'] === vendorId; })[0];
  const newDue = (Number(row['Current Due']) || 0) + delta;
  updateRowFields_('VENDORS', idx, { 'Current Due': newDue });
  return newDue;
}

/**
 * Same shape as adjustVendorDue_ but for the other direction — what the
 * vendor owes US (Issue/Receipt/Return Received). Two separate stored
 * numbers on purpose, never netted — see VENDORS header comment in
 * Config.gs.
 */
function adjustVendorReceivable_(vendorId, delta) {
  const idx = findRowIndex_('VENDORS', 'Vendor ID', vendorId);
  if (idx === -1) return null;
  const row = getAllRows_('VENDORS').filter(function (v) { return v['Vendor ID'] === vendorId; })[0];
  const newReceivable = (Number(row['Current Receivable']) || 0) + delta;
  updateRowFields_('VENDORS', idx, { 'Current Receivable': newReceivable });
  return newReceivable;
}

/**
 * The one place a VENDOR_LEDGER row gets written on creation (Sourcing,
 * Payment, Return, Issue, Receipt, Return Received). Applies the balance
 * delta — via adjustVendorDue_ for Payable rows, adjustVendorReceivable_
 * for Receivable rows — then appends the ledger row stamped with the
 * resulting Balance. Mirrors Suppliers.gs's paySupplier inline pattern,
 * just factored out since every creation call site (Sales.gs,
 * SalesManagement.gs, here) needs it.
 * fields: { vendorId, vendorName, date (yyyy-MM-dd), type, reference,
 * debit, credit, notes, paymentMethod, balanceType ('Payable' — default —
 * or 'Receivable'), backdate (resolveTransactionDate_ result, optional),
 * createdBy }. Returns the new Ledger ID.
 */
function postVendorLedgerEntry_(fields) {
  const balanceType = fields.balanceType || 'Payable';
  const delta = (Number(fields.debit) || 0) - (Number(fields.credit) || 0);
  const newBalance = balanceType === 'Receivable'
    ? adjustVendorReceivable_(fields.vendorId, delta)
    : adjustVendorDue_(fields.vendorId, delta);
  const ledgerId = generateId_('VENDOR_LEDGER');
  const bd = fields.backdate || { isBackdated: false, backdatedDays: 0, reason: '' };
  appendRow_('VENDOR_LEDGER', {
    'Ledger ID': ledgerId, 'Date': fields.date, 'Vendor ID': fields.vendorId,
    'Vendor Name': fields.vendorName, 'Type': fields.type, 'Reference': fields.reference,
    'Debit': fields.debit || '', 'Credit': fields.credit || '', 'Balance': newBalance,
    'Notes': fields.notes || '', 'Payment Method': fields.paymentMethod || '',
    'Is Backdated': bd.isBackdated, 'Backdated Days': bd.backdatedDays, 'Backdated Reason': bd.reason,
    'Created By': fields.createdBy || '', 'Created At': new Date(), 'Balance Type': balanceType
  });
  return ledgerId;
}

/** Bootstrap for vendors.html — mirrors getSuppliersBootstrap. Products are the minimal shape 'Give Products to Vendor' needs to pick from. */
function getVendorsBootstrap(token) {
  try {
    requirePermission_(token, 'vendors', 'view');
    const settings = getSettingsMap_();
    const products = activeRows_('PRODUCTS').map(function (p) {
      return {
        id: p['Product ID'], name: p['Product Name'], brand: p['Brand'] || '',
        category: p['Category'] || '', unit: p['Unit'] || '', barcode: p['Barcode'] || '',
        stock: Number(p['Current Stock']) || 0, currentStock: Number(p['Current Stock']) || 0,
        purchasePrice: Number(p['Purchase Price']) || 0
      };
    });
    return ok_({
      vendors: getAllVendorsForUI_(),
      bankAccounts: getActiveBankAccountsForUI_(),
      products: products,
      currencySymbol: settings['Currency Symbol'] || ''
    });
  } catch (err) {
    logError_('getVendorsBootstrap', err);
    return fail_(err.message);
  }
}

function getVendorOpenObligations_(vendorId) {
  const returnedQtyBySourcing = {};
  activeRows_('VENDOR_RETURNS').forEach(function (r) {
    returnedQtyBySourcing[r['Sourcing ID']] = (returnedQtyBySourcing[r['Sourcing ID']] || 0) + (Number(r['Quantity']) || 0);
  });
  const openSourcing = activeRows_('VENDOR_SOURCING')
    .filter(function (row) { return row['Vendor ID'] === vendorId; })
    .map(function (row) {
      const qty = Number(row['Quantity']) || 0;
      const returned = returnedQtyBySourcing[row['Sourcing ID']] || 0;
      return {
        sourcingId: row['Sourcing ID'], date: safeDateOnly_(row['Date']), invoiceId: row['Invoice ID'],
        productId: row['Product ID'], productName: row['Product Name'], quantity: qty,
        unitCost: Number(row['Unit Cost']) || 0, returnedQty: returned, remainingQty: Math.max(0, qty - returned)
      };
    }).filter(function (row) { return row.remainingQty > 0.0001; });

  const returnedQtyByIssue = {};
  activeRows_('VENDOR_RETURNS_RECEIVED').forEach(function (r) {
    returnedQtyByIssue[r['Issue ID']] = (returnedQtyByIssue[r['Issue ID']] || 0) + (Number(r['Quantity']) || 0);
  });
  const openIssues = activeRows_('VENDOR_ISSUES')
    .filter(function (row) { return row['Vendor ID'] === vendorId; })
    .map(function (row) {
      const qty = Number(row['Quantity']) || 0;
      const returned = returnedQtyByIssue[row['Issue ID']] || 0;
      return {
        issueId: row['Issue ID'], memoId: row['Memo ID'] || row['Issue ID'], date: safeDateOnly_(row['Date']), productId: row['Product ID'],
        productName: row['Product Name'], quantity: qty, unitValue: Number(row['Unit Value']) || 0,
        returnedQty: returned, remainingQty: Math.max(0, qty - returned)
      };
    }).filter(function (row) { return row.remainingQty > 0.0001; });
  return { openSourcing: openSourcing, openIssues: openIssues };
}

/**
 * One vendor's profile + full ledger + open obligations for Vendor Workspace.
 */
function getVendorDetail(token, vendorId) {
  try {
    requirePermission_(token, 'vendors', 'view');
    const vendor = getAllRows_('VENDORS').filter(function (v) { return v['Vendor ID'] === vendorId; })[0];
    if (!vendor || isDeleted_(vendor)) return fail_('Vendor not found.');

    const ledger = recalculateLedgerBalancesForDisplay_(
      activeRows_('VENDOR_LEDGER').filter(function (l) { return l['Vendor ID'] === vendorId; }),
      'Balance Type'
    );
    const issueMemoById = {};
    activeRows_('VENDOR_ISSUES').filter(function (row) { return row['Vendor ID'] === vendorId; }).forEach(function (row) {
      issueMemoById[row['Issue ID']] = row['Memo ID'] || row['Issue ID'];
    });
    ledger.forEach(function (row) {
      if (row['Type'] === 'Issue' && issueMemoById[row['Reference']]) row['Memo ID'] = issueMemoById[row['Reference']];
    });

    const obligations = getVendorOpenObligations_(vendorId);
    const openSourcing = obligations.openSourcing;
    const openIssues = obligations.openIssues;

    return ok_({
      vendor: {
        id: vendor['Vendor ID'], name: vendor['Vendor Name'], phone: vendor['Phone'] || '', address: vendor['Address'] || '',
        currentDue: Number(vendor['Current Due']) || 0,
        currentReceivable: Number(vendor['Current Receivable']) || 0,
        status: vendor['Status'] || 'Active'
      },
      ledger: ledger,
      openSourcing: openSourcing,
      openIssues: openIssues
    });
  } catch (err) {
    logError_('getVendorDetail', err);
    return fail_(err.message);
  }
}

/**
 * Records a cash/bank payment to a vendor — mirrors Suppliers.gs's
 * paySupplier exactly, Vendor Ledger instead of Supplier Ledger.
 */
function payVendor(token, vendorId, amount, method, bankAccountId, notes, date, backdatedReason) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    const actingUser = requirePermission_(token, 'vendors', 'edit');
    requireActiveCashSession_();
    if (!isValidNonNegativeNumber_(amount) || Number(amount) <= 0) return fail_('Enter a valid payment amount.');

    const vendor = getAllRows_('VENDORS').filter(function (v) { return v['Vendor ID'] === vendorId; })[0];
    if (!vendor || isDeleted_(vendor) || vendor['Status'] === 'Inactive') return fail_('Vendor not found or inactive.');

    const now = new Date();
    const txDate = resolveTransactionDate_(token, 'vendors', date, backdatedReason, 'Payment');
    const dateStr = txDate.dateStr;
    const paymentMethod = method || 'Cash';
    const resolvedBankAccountId = resolveBankAccount_(paymentMethod, bankAccountId).id;
    const amt = Number(amount);

    const ledgerId = postVendorLedgerEntry_({
      vendorId: vendorId, vendorName: vendor['Vendor Name'], date: dateStr, type: 'Payment',
      reference: 'PAYMENT', credit: amt, notes: sanitizeInput_(notes), paymentMethod: paymentMethod,
      backdate: { isBackdated: txDate.isBackdated, backdatedDays: txDate.backdatedDays, reason: txDate.reason },
      createdBy: actorName_(actingUser)
    });

    if (paymentMethod === 'Cash') {
      addCashBookEntry_({
        Type: 'Vendor Payment', Reference: ledgerId, Description: 'Payment to ' + vendor['Vendor Name'],
        Debit: amt, Credit: '', PaymentMethod: 'Cash', Date: dateStr
      });
    } else if (isBankLikePaymentMethod_(paymentMethod)) {
      addBankBookEntry_(resolvedBankAccountId, {
        Type: 'Vendor Payment', Reference: ledgerId, Description: 'Payment to ' + vendor['Vendor Name'],
        Debit: amt, Credit: '', Date: dateStr
      });
    }

    const newDue = (Number(vendor['Current Due']) || 0) - amt;
    return ok_({ ledgerId: ledgerId, newDue: newDue });
  } catch (err) {
    logError_('payVendor', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Settles part or all of a vendor's due by handing over stock instead of
 * cash — the Purchase Return analog for Vendors (see the user's own
 * example: goods sourced from the vendor today, matching stock arrives
 * tomorrow, hand that stock back to the vendor to settle the debt).
 * Always linked to the original VENDOR_SOURCING row: the returnable
 * quantity is capped at what's left unsettled on it (its own Quantity
 * minus whatever's already been returned against it).
 *
 * Deliberately requires enough real stock on hand — unlike a customer
 * sale (money already committed, allowed to go negative), you cannot
 * physically hand over stock that doesn't exist yet. adjustProductStock_
 * enforces this (throws if it would go negative); the plain fail_ here
 * gives an earlier, clearer message before any lot writes happen.
 */
function returnProductsToVendor(token, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    const actingUser = requirePermission_(token, 'vendors', 'edit');
    requireActiveCashSession_();
    payload = payload || {};

    const vendor = getAllRows_('VENDORS').filter(function (v) { return v['Vendor ID'] === payload.vendorId; })[0];
    if (!vendor || isDeleted_(vendor) || vendor['Status'] === 'Inactive') return fail_('Vendor not found or inactive.');

    const sourcing = getAllRows_('VENDOR_SOURCING').filter(function (s) {
      return s['Sourcing ID'] === payload.sourcingId && !isDeleted_(s);
    })[0];
    if (!sourcing) return fail_('Sourcing transaction not found.');
    if (sourcing['Vendor ID'] !== payload.vendorId) return fail_('This sourcing transaction does not belong to this vendor.');

    const alreadyReturned = activeRows_('VENDOR_RETURNS')
      .filter(function (r) { return r['Sourcing ID'] === sourcing['Sourcing ID']; })
      .reduce(function (sum, r) { return sum + (Number(r['Quantity']) || 0); }, 0);
    const remaining = (Number(sourcing['Quantity']) || 0) - alreadyReturned;

    const qty = Number(payload.quantity);
    if (!isValidNonNegativeNumber_(qty) || qty <= 0) return fail_('Enter a valid quantity.');
    if (qty > remaining) return fail_('Only ' + remaining + ' unit(s) are left unsettled on this sourcing transaction.');

    const unitCost = payload.unitCost !== undefined && payload.unitCost !== '' && payload.unitCost !== null
      ? Number(payload.unitCost) : Number(sourcing['Unit Cost']) || 0;
    if (!isValidNonNegativeNumber_(unitCost)) return fail_('Enter a valid unit cost.');

    const product = getAllRows_('PRODUCTS').filter(function (p) { return p['Product ID'] === sourcing['Product ID']; })[0];
    if (!product) return fail_('Product no longer exists.');
    const currentStock = Number(product['Current Stock']) || 0;
    if (currentStock < qty) {
      return fail_('Not enough stock on hand to return ' + qty + ' unit(s) — only ' + currentStock + ' available.');
    }

    const now = new Date();
    const txDate = resolveTransactionDate_(token, 'vendors', payload.date, payload.backdatedReason, 'Return');
    const dateStr = txDate.dateStr;

    const plan = planStockConsumption_(sourcing['Product ID'], qty, null);
    const consumption = applyStockConsumption_(plan);
    const newStock = adjustProductStock_(sourcing['Product ID'], -qty, sourcing['Product Name']);
    consumption.forEach(function (c) {
      appendRow_('STOCK_MOVEMENT', {
        'Movement ID': generateId_('STOCK_MOVEMENT'), 'Date': now, 'Product ID': sourcing['Product ID'],
        'Product Name': sourcing['Product Name'], 'Type': 'Vendor Return', 'Reference': sourcing['Sourcing ID'],
        'Quantity In': '', 'Quantity Out': c.qty, 'Balance Stock': newStock, 'Notes': 'Returned to ' + vendor['Vendor Name'], 'Lot ID': c.lotId
      });
    });

    const totalValue = qty * unitCost;
    const returnId = generateId_('VENDOR_RETURNS');
    appendRow_('VENDOR_RETURNS', {
      'Return ID': returnId, 'Date': dateStr, 'Vendor ID': vendor['Vendor ID'], 'Vendor Name': vendor['Vendor Name'],
      'Sourcing ID': sourcing['Sourcing ID'], 'Product ID': sourcing['Product ID'], 'Product Name': sourcing['Product Name'],
      'Quantity': qty, 'Unit Cost': unitCost, 'Total Value': totalValue,
      'Notes': sanitizeInput_(payload.notes), 'Created By': actorName_(actingUser), 'Created At': now
    });

    const ledgerId = postVendorLedgerEntry_({
      vendorId: vendor['Vendor ID'], vendorName: vendor['Vendor Name'], date: dateStr, type: 'Return',
      reference: returnId, credit: totalValue,
      notes: 'Returned ' + qty + ' x ' + sourcing['Product Name'] + ' (Sourcing ' + sourcing['Sourcing ID'] + ')',
      backdate: { isBackdated: txDate.isBackdated, backdatedDays: txDate.backdatedDays, reason: txDate.reason },
      createdBy: actorName_(actingUser)
    });

    return ok_({ returnId: returnId, ledgerId: ledgerId, newStock: newStock });
  } catch (err) {
    logError_('returnProductsToVendor', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

/**
 * The other direction of Vendor/Consignment Sourcing: we hand the vendor
 * OUR stock directly (not tied to a customer sale/shortfall — a standalone
 * action from the Vendor Ledger page), creating a Receivable instead of
 * settling a Payable. Real stock leaves immediately, so — same reasoning
 * as returnProductsToVendor — this requires enough stock on hand and is
 * blocked otherwise.
 */
function giveProductsToVendor(token, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    const actingUser = requirePermission_(token, 'vendors', 'edit');
    requireActiveCashSession_();
    payload = payload || {};

    const vendor = getAllRows_('VENDORS').filter(function (v) { return v['Vendor ID'] === payload.vendorId; })[0];
    if (!vendor || isDeleted_(vendor) || vendor['Status'] === 'Inactive') return fail_('Vendor not found or inactive.');

    // Backward-compatible: older clients can still send one product, while
    // the Vendor Workspace now sends a multi-line memo in payload.items.
    let rawItems = Array.isArray(payload.items) ? payload.items.slice() : [];
    if (!rawItems.length && payload.productId) {
      rawItems = [{
        productId: payload.productId,
        quantity: payload.quantity,
        unitValue: payload.unitValue
      }];
    }
    if (!rawItems.length) return fail_('Add at least one product to the memo.');
    if (rawItems.length > 50) return fail_('A vendor memo can contain up to 50 products.');

    const products = getAllRows_('PRODUCTS');
    const productsById = {};
    products.forEach(function (p) { productsById[p['Product ID']] = p; });
    const seen = {};
    const items = [];
    let memoTotal = 0;

    // Validate the entire memo before any stock or accounting write happens.
    for (let i = 0; i < rawItems.length; i++) {
      const src = rawItems[i] || {};
      const productId = String(src.productId || '').trim();
      const product = productsById[productId];
      if (!product || isDeleted_(product)) return fail_('Product not found on memo line ' + (i + 1) + '.');
      if (seen[productId]) return fail_(product['Product Name'] + ' is added more than once. Keep one line per product.');
      seen[productId] = true;

      const qty = Number(src.quantity);
      if (!isValidNonNegativeNumber_(qty) || qty <= 0) return fail_('Enter a valid quantity for ' + product['Product Name'] + '.');
      const unitValue = Number(src.unitValue);
      if (!isValidNonNegativeNumber_(unitValue)) return fail_('Enter a valid unit value for ' + product['Product Name'] + '.');

      const currentStock = Number(product['Current Stock']) || 0;
      if (currentStock < qty) {
        return fail_('Not enough stock for ' + product['Product Name'] + ': requested ' + qty + ', available ' + currentStock + '.');
      }

      const stockPlan = planStockConsumption_(productId, qty, null, product);
      if (stockPlan.shortfall > 0) {
        return fail_('Stock lots do not contain enough physical stock for ' + product['Product Name'] + '.');
      }

      const lineTotal = qty * unitValue;
      items.push({ product: product, quantity: qty, unitValue: unitValue, lineTotal: lineTotal, stockPlan: stockPlan });
      memoTotal += lineTotal;
    }

    const now = new Date();
    const txDate = resolveTransactionDate_(token, 'vendors', payload.date, payload.backdatedReason, 'Issue');
    const dateStr = txDate.dateStr;
    // Pre-allocate one normal Issue ID per line. The first Issue ID is also
    // the memo number shared by every line, so no separate counter/sheet is
    // needed and existing ID-counter maintenance remains fully compatible.
    const issueIds = items.map(function () { return generateId_('VENDOR_ISSUES'); });
    const memoId = issueIds[0];
    const memoNote = sanitizeInput_(payload.notes);
    const ledgerIds = [];
    const stockByProduct = {};

    // Each product keeps its own Issue ID so existing edit/delete/return flows
    // remain safe, while Memo ID groups all lines from this one Give action.
    items.forEach(function (item, itemIndex) {
      const product = item.product;
      const qty = item.quantity;
      const consumption = applyStockConsumption_(item.stockPlan);
      const newStock = adjustProductStock_(product['Product ID'], -qty, product['Product Name']);
      stockByProduct[product['Product ID']] = newStock;

      consumption.forEach(function (c) {
        appendRow_('STOCK_MOVEMENT', {
          'Movement ID': generateId_('STOCK_MOVEMENT'), 'Date': now, 'Product ID': product['Product ID'],
          'Product Name': product['Product Name'], 'Type': 'Vendor Issue', 'Reference': vendor['Vendor ID'],
          'Quantity In': '', 'Quantity Out': c.qty, 'Balance Stock': newStock,
          'Notes': 'Given to ' + vendor['Vendor Name'] + ' — Memo ' + memoId, 'Lot ID': c.lotId
        });
      });

      const issueId = issueIds[itemIndex];
      appendRow_('VENDOR_ISSUES', {
        'Issue ID': issueId, 'Memo ID': memoId, 'Date': dateStr,
        'Vendor ID': vendor['Vendor ID'], 'Vendor Name': vendor['Vendor Name'],
        'Product ID': product['Product ID'], 'Product Name': product['Product Name'],
        'Quantity': qty, 'Unit Value': item.unitValue, 'Total Value': item.lineTotal,
        'Notes': memoNote, 'Created By': actorName_(actingUser), 'Created At': now
      });

      // Keep one ledger row per Issue ID for compatibility with the existing
      // per-line edit/delete/return engine; the shared Memo ID is carried in
      // the note and in VENDOR_ISSUES so the lines still belong to one memo.
      const ledgerId = postVendorLedgerEntry_({
        vendorId: vendor['Vendor ID'], vendorName: vendor['Vendor Name'], date: dateStr, type: 'Issue',
        reference: issueId, debit: item.lineTotal, balanceType: 'Receivable',
        notes: 'Memo ' + memoId + ' — Gave ' + qty + ' x ' + product['Product Name'] + (memoNote ? ' — ' + memoNote : ''),
        backdate: { isBackdated: txDate.isBackdated, backdatedDays: txDate.backdatedDays, reason: txDate.reason },
        createdBy: actorName_(actingUser)
      });
      ledgerIds.push(ledgerId);
    });

    return ok_({
      memoId: memoId,
      issueIds: issueIds,
      ledgerIds: ledgerIds,
      totalValue: memoTotal,
      stockByProduct: stockByProduct
    });
  } catch (err) {
    logError_('giveProductsToVendor', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Records a cash/bank payment FROM a vendor — the Receivable-side mirror
 * of payVendor, Cash Book/Bank Book Credit instead of Debit (money coming
 * IN), same convention Customer.gs's receivePayment uses.
 */
function receiveVendorPayment(token, vendorId, amount, method, bankAccountId, notes, date, backdatedReason) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    const actingUser = requirePermission_(token, 'vendors', 'edit');
    requireActiveCashSession_();
    if (!isValidNonNegativeNumber_(amount) || Number(amount) <= 0) return fail_('Enter a valid amount.');

    const vendor = getAllRows_('VENDORS').filter(function (v) { return v['Vendor ID'] === vendorId; })[0];
    if (!vendor || isDeleted_(vendor) || vendor['Status'] === 'Inactive') return fail_('Vendor not found or inactive.');

    const now = new Date();
    const txDate = resolveTransactionDate_(token, 'vendors', date, backdatedReason, 'Receipt');
    const dateStr = txDate.dateStr;
    const paymentMethod = method || 'Cash';
    const resolvedBankAccountId = resolveBankAccount_(paymentMethod, bankAccountId).id;
    const amt = Number(amount);

    const ledgerId = postVendorLedgerEntry_({
      vendorId: vendorId, vendorName: vendor['Vendor Name'], date: dateStr, type: 'Receipt',
      reference: 'RECEIPT', credit: amt, balanceType: 'Receivable',
      notes: sanitizeInput_(notes), paymentMethod: paymentMethod,
      backdate: { isBackdated: txDate.isBackdated, backdatedDays: txDate.backdatedDays, reason: txDate.reason },
      createdBy: actorName_(actingUser)
    });

    if (paymentMethod === 'Cash') {
      addCashBookEntry_({
        Type: 'Vendor Receipt', Reference: ledgerId, Description: 'Received from ' + vendor['Vendor Name'],
        Debit: '', Credit: amt, PaymentMethod: 'Cash', Date: dateStr
      });
    } else if (isBankLikePaymentMethod_(paymentMethod)) {
      addBankBookEntry_(resolvedBankAccountId, {
        Type: 'Vendor Receipt', Reference: ledgerId, Description: 'Received from ' + vendor['Vendor Name'],
        Debit: '', Credit: amt, Date: dateStr
      });
    }

    const newReceivable = (Number(vendor['Current Receivable']) || 0) - amt;
    return ok_({ ledgerId: ledgerId, newReceivable: newReceivable });
  } catch (err) {
    logError_('receiveVendorPayment', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Settles part or all of a Receivable with stock instead of cash — the
 * vendor brings products back to us (see the user's own two-way example).
 * Always linked to the original VENDOR_ISSUES row, capped the same way
 * returnProductsToVendor caps against VENDOR_SOURCING. Stock only
 * increases here, so — unlike giveProductsToVendor/returnProductsToVendor
 * — there is no "enough stock on hand" question; adjustProductStock_'s
 * positive-delta path is always allowed.
 */
function receiveProductsFromVendor(token, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    const actingUser = requirePermission_(token, 'vendors', 'edit');
    requireActiveCashSession_();
    payload = payload || {};

    const vendor = getAllRows_('VENDORS').filter(function (v) { return v['Vendor ID'] === payload.vendorId; })[0];
    if (!vendor || isDeleted_(vendor) || vendor['Status'] === 'Inactive') return fail_('Vendor not found or inactive.');

    const issue = getAllRows_('VENDOR_ISSUES').filter(function (s) {
      return s['Issue ID'] === payload.issueId && !isDeleted_(s);
    })[0];
    if (!issue) return fail_('Issue transaction not found.');
    if (issue['Vendor ID'] !== payload.vendorId) return fail_('This issue transaction does not belong to this vendor.');

    const alreadyReturned = activeRows_('VENDOR_RETURNS_RECEIVED')
      .filter(function (r) { return r['Issue ID'] === issue['Issue ID']; })
      .reduce(function (sum, r) { return sum + (Number(r['Quantity']) || 0); }, 0);
    const remaining = (Number(issue['Quantity']) || 0) - alreadyReturned;

    const qty = Number(payload.quantity);
    if (!isValidNonNegativeNumber_(qty) || qty <= 0) return fail_('Enter a valid quantity.');
    if (qty > remaining) return fail_('Only ' + remaining + ' unit(s) are left unsettled on this issue transaction.');

    const unitValue = payload.unitValue !== undefined && payload.unitValue !== '' && payload.unitValue !== null
      ? Number(payload.unitValue) : Number(issue['Unit Value']) || 0;
    if (!isValidNonNegativeNumber_(unitValue)) return fail_('Enter a valid unit value.');

    const now = new Date();
    const txDate = resolveTransactionDate_(token, 'vendors', payload.date, payload.backdatedReason, 'Return');
    const dateStr = txDate.dateStr;

    const newStock = adjustProductStock_(issue['Product ID'], qty, issue['Product Name']);
    const lotId = createLot_(issue['Product ID'], issue['Product Name'], 'VENDOR-RETURN-RECEIVED', now, unitValue, qty);
    appendRow_('STOCK_MOVEMENT', {
      'Movement ID': generateId_('STOCK_MOVEMENT'), 'Date': now, 'Product ID': issue['Product ID'],
      'Product Name': issue['Product Name'], 'Type': 'Vendor Return Received', 'Reference': issue['Issue ID'],
      'Quantity In': qty, 'Quantity Out': '', 'Balance Stock': newStock, 'Notes': 'Received back from ' + vendor['Vendor Name'], 'Lot ID': lotId
    });

    const totalValue = qty * unitValue;
    const returnId = generateId_('VENDOR_RETURNS_RECEIVED');
    appendRow_('VENDOR_RETURNS_RECEIVED', {
      'Return ID': returnId, 'Date': dateStr, 'Vendor ID': vendor['Vendor ID'], 'Vendor Name': vendor['Vendor Name'],
      'Issue ID': issue['Issue ID'], 'Product ID': issue['Product ID'], 'Product Name': issue['Product Name'],
      'Quantity': qty, 'Unit Value': unitValue, 'Total Value': totalValue,
      'Notes': sanitizeInput_(payload.notes), 'Created By': actorName_(actingUser), 'Created At': now
    });

    const ledgerId = postVendorLedgerEntry_({
      vendorId: vendor['Vendor ID'], vendorName: vendor['Vendor Name'], date: dateStr, type: 'Return Received',
      reference: returnId, credit: totalValue, balanceType: 'Receivable',
      notes: 'Received back ' + qty + ' x ' + issue['Product Name'] + ' (Issue ' + issue['Issue ID'] + ')',
      backdate: { isBackdated: txDate.isBackdated, backdatedDays: txDate.backdatedDays, reason: txDate.reason },
      createdBy: actorName_(actingUser)
    });

    return ok_({ returnId: returnId, ledgerId: ledgerId, newStock: newStock });
  } catch (err) {
    logError_('receiveProductsFromVendor', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}
