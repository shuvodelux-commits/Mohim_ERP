/**
 * Purchase.gs
 * ---------------------------------------------------------------------
 * Recording a purchase from a supplier: one or more product lines,
 * automatic stock increase with a logged Stock Movement row per line,
 * and — if anything was paid on the spot — a Cash Book debit (requires
 * an open cash session, same rule as POS cash sales). Any unpaid portion
 * (dueAmount) is posted to the supplier's Current Due and Supplier
 * Ledger, mirroring how Sales.gs handles a due sale for a customer.
 *
 * Phase 5 (permission wiring): getPurchaseBootstrap/createPurchase now
 * require a session token and check requirePermission_ against the
 * 'purchase' module before doing anything.
 *
 * Review item 12 / P0 #8: createPurchase now validates everything before
 * it writes anything. It used to append the PURCHASES row first and only
 * then, inside the write loop, check whether each product still existed —
 * so a deleted product on line 3 threw AFTER the purchase header was
 * saved and lines 1 and 2 had already had their stock raised and lots
 * created. Product existence and stock are resolved up front now, from a
 * single Products read rather than a findRowIndex_ plus a getRange per
 * line.
 *
 * Review items 6 & 11: the lot this purchase creates is now stamped
 * with the purchase's own date instead of now(), so a backdated purchase
 * takes its correct place in FIFO order rather than becoming the newest
 * lot. The Cash Book entry carries that date too, so a backdated
 * purchase no longer lands on today's cash drawer.
 *
 * P3 drift (item 6): the backdate preamble is now
 * resolveTransactionDate_() in Utils.gs — same checks, same messages.
 *
 * Backdated Entry (Tier 1): 'Date' is now an optional, user-supplied
 * value (defaults to today, same one-liner Expense.gs already uses),
 * stored as a 'yyyy-MM-dd' string like every other backdatable module —
 * previously stored as a raw Date object, the one inconsistency in this
 * file, switched here rather than left to drift further. Also gained
 * 'Created By' (the only transaction sheet with zero actor-tracking
 * before this). Every sub-write this function triggers (Stock Movement,
 * Cash Book, Supplier Ledger, Stock Lots) keeps stamping the real 'now',
 * unchanged — only the Purchase's own header row date moves.
 * ---------------------------------------------------------------------
 */

function getPurchaseBootstrap(token) {
  try {
    requirePermission_(token, 'purchase', 'view');
    const products = activeRows_('PRODUCTS').filter(function (p) { return p['Status'] !== 'Inactive'; });
    // activeRows_, not getAllRows_: deleting a supplier is a SOFT delete
    // (markRowDeleted_ stamps 'Is Deleted'), it does not set Status to
    // Inactive — so a Status-only filter left deleted suppliers in this
    // dropdown while the Suppliers page, which already used activeRows_,
    // correctly showed them gone. Deleted records must not reappear in
    // operational selectors.
    const suppliers = activeRows_('SUPPLIERS').filter(function (s) { return s['Status'] !== 'Inactive'; });
    // Category filter on New Purchase's Add Product picker. Same source and
    // same active-only rule as the Products page (getProductsBootstrap), so
    // one managed list drives both screens.
    const categories = getAllRows_('PRODUCT_CATEGORIES').filter(function (c) { return c['Status'] !== 'Inactive'; });
    const settings = getSettingsMap_();
    const bankAccounts = getActiveBankAccountsForUI_();

    return ok_({
      products: products.map(function (p) {
        // category is what the Add Product picker matches each product
        // against when a category is selected. The dropdown's own options
        // come from PRODUCT_CATEGORIES above, not from these values.
        return {
          id: p['Product ID'], name: p['Product Name'], brand: p['Brand'] || '',
          unit: p['Unit'], category: p['Category'] || '', barcode: p['Barcode'] || '',
          stock: Number(p['Current Stock']) || 0, purchasePrice: p['Purchase Price'], sellingPrice: p['Selling Price']
        };
      }),
      categories: categories.map(function (c) { return { id: c['Category ID'], name: c['Category Name'] }; }),
      suppliers: suppliers.map(function (s) { return { id: s['Supplier ID'], name: s['Supplier Name'] }; }),      // Purchase Invoice (the History tab) now gets its full, live-editable
      // list from getPurchaseManagementList instead of a capped last-15
      // snapshot here, the same split Sales already has between
      // getPurchaseBootstrap and getPurchaseManagementList/SalesManagement.gs.
      bankAccounts: bankAccounts,
      currencySymbol: settings['Currency Symbol'] || ''
    });
  } catch (err) {
    logError_('getPurchaseBootstrap', err);
    return fail_(err.message);
  }
}

/**
 * payload = {
 *   supplierId, items: [{ productId, name, qty, unitPrice, sellingPrice }],
 *   discount, paidAmount, notes,
 *   date (optional, 'yyyy-MM-dd' — defaults to today), backdatedReason
 *   (required only when date is in the past)
 * }
 * item.sellingPrice is required; it becomes this purchase lot's sell price and the product's latest/default selling price.
 */
function createPurchase(token, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    const actingUser = requirePermission_(token, 'purchase', 'add');
    requireActiveCashSession_();
    if (!payload.supplierId) return fail_('Choose a supplier.');
    if (!payload.items || !payload.items.length) return fail_('Add at least one product line.');

    const now = new Date();
    const txDate = resolveTransactionDate_(token, 'purchase', payload.date, payload.backdatedReason, 'Purchase');
    const dateStr = txDate.dateStr;

    // activeRows_ so a page that was already open when the supplier was
    // deleted cannot still post a purchase against it — fixing the dropdown
    // alone would only hide the option, not refuse the write.
    const supplierRow = activeRows_('SUPPLIERS').filter(function (s) { return s['Supplier ID'] === payload.supplierId; })[0];
    if (!supplierRow || supplierRow['Status'] === 'Inactive') return fail_('Supplier not found or inactive.');

    // ================== VALIDATION PHASE — writes nothing ==================
    // One read for the whole basket. Product existence is checked HERE,
    // not inside the write loop where it used to throw after the purchase
    // row had already been saved.
    const productsById = {};
    getAllRows_('PRODUCTS').forEach(function (pr) { productsById[pr['Product ID']] = pr; });

    let subtotal = 0;
    const lines = [];
    const seenProduct = {};
    payload.items.forEach(function (item, i) {
      const qty = Number(item.qty), price = Number(item.unitPrice), sellPrice = Number(item.sellingPrice);
      if (!isValidNonNegativeNumber_(qty) || qty <= 0) throw new Error('Line ' + (i + 1) + ': quantity must be greater than zero.');
      if (!isValidNonNegativeNumber_(price)) throw new Error('Line ' + (i + 1) + ': unit price must be a valid number.');
      if (!isValidNonNegativeNumber_(sellPrice)) throw new Error('Line ' + (i + 1) + ': sell price must be a valid number.');
      if (seenProduct[item.productId]) throw new Error(item.name + ' appears more than once — combine it into one line.');
      seenProduct[item.productId] = true;

      const product = productsById[item.productId];
      if (!product || isDeleted_(product)) throw new Error('Product ' + item.name + ' no longer exists.');

      const currentStock = Number(product['Current Stock']) || 0;

      lines.push({
        productId: item.productId, name: item.name, qty: qty, price: price, sellPrice: sellPrice,
        rowIndex: product._rowIndex, newStock: currentStock + qty,
      });
      subtotal += qty * price;
    });

    const discount = isValidNonNegativeNumber_(payload.discount) ? Number(payload.discount) : 0;
    const grandTotal = Math.max(0, subtotal - discount);
    let paidAmount = isValidNonNegativeNumber_(payload.paidAmount) ? Number(payload.paidAmount) : 0;
    if (paidAmount > grandTotal) paidAmount = grandTotal;
    const dueAmount = grandTotal - paidAmount;
    const paymentStatus = dueAmount <= 0 ? 'Paid' : (paidAmount > 0 ? 'Partial' : 'Due');

    // Bank payment on a purchase. Purchases were cash-only before, which is
    // why the Day Book had to assume 'Cash' for every purchase row. Resolved
    // here in the validation phase so a bad/missing bank account is rejected
    // before anything is written, exactly like completeSale does it.
    const paymentMethod = paidAmount > 0 ? (payload.paymentMethod || 'Cash') : '';
    const bankAccount = resolveBankAccount_(paymentMethod, payload.bankAccountId);
    const bankAccountId = bankAccount.id, bankAccountName = bankAccount.name;

    // ======================== WRITE PHASE ========================
    // Nothing below here raises a validation error.
    const purchaseId = generateId_('PURCHASES');

    appendRow_('PURCHASES', {
      'Purchase ID': purchaseId, 'Date': dateStr, 'Supplier ID': payload.supplierId,
      'Supplier Name': supplierRow['Supplier Name'], 'Subtotal': subtotal, 'Discount': discount,
      'Grand Total': grandTotal, 'Paid Amount': paidAmount, 'Due Amount': dueAmount,
      'Payment Status': paymentStatus, 'Notes': sanitizeInput_(payload.notes),
      'Payment Method': paymentMethod, 'Bank Account ID': bankAccountId, 'Bank Account Name': bankAccountName,
      'Created By': actorName_(actingUser), 'Created At': now,
      'Is Backdated': txDate.isBackdated, 'Backdated Days': txDate.backdatedDays, 'Backdated Reason': txDate.reason
    });

    const purchaseItemRows = [];
    const stockMovementRows = [];

    lines.forEach(function (line) {
      purchaseItemRows.push({
        'Purchase ID': purchaseId, 'Product ID': line.productId, 'Product Name': line.name,
        'Quantity': line.qty, 'Unit Price': line.price, 'Sell Price': line.sellPrice, 'Line Total': line.qty * line.price
      });

      updateRowFields_('PRODUCTS', line.rowIndex, { 'Current Stock': line.newStock, 'Selling Price': line.sellPrice, 'Updated At': now });

      // dateStr, not now() — a backdated purchase must take its correct
      // place in FIFO order (review item 11).
      const lotId = createLot_(line.productId, line.name, purchaseId, dateStr, line.price, line.qty, payload.supplierId, supplierRow['Supplier Name'], line.sellPrice);
      stockMovementRows.push({
        'Movement ID': generateId_('STOCK_MOVEMENT'), 'Date': now, 'Product ID': line.productId,
        'Product Name': line.name, 'Type': 'Purchase', 'Reference': purchaseId,
        'Quantity In': line.qty, 'Quantity Out': '', 'Balance Stock': line.newStock, 'Notes': '', 'Lot ID': lotId
      });
    });

    appendRows_('PURCHASE_ITEMS', purchaseItemRows);
    appendRows_('STOCK_MOVEMENT', stockMovementRows);

    if (paidAmount > 0 && isBankLikePaymentMethod_(paymentMethod)) {
      // Bank money never touches the cash drawer, so no cash session is
      // required -- the same rule completeSale and addExpense already follow.
      addBankBookEntry_(bankAccountId, {
        Type: 'Purchase Payment', Reference: purchaseId,
        Description: 'Payment to ' + supplierRow['Supplier Name'],
        Debit: paidAmount, Credit: '', Date: dateStr
      });
    } else if (paidAmount > 0) {
      addCashBookEntry_({
        Type: 'Purchase Payment', Reference: purchaseId,
        Description: 'Payment to ' + supplierRow['Supplier Name'],
        Debit: paidAmount, Credit: '', PaymentMethod: 'Cash', Date: dateStr
      });
    }

    if (dueAmount > 0) {
      const supRowIndex = findRowIndex_('SUPPLIERS', 'Supplier ID', payload.supplierId);
      const supRow = getAllRows_('SUPPLIERS').filter(function (s) { return s['Supplier ID'] === payload.supplierId; })[0];
      const newDue = (Number(supRow['Current Due']) || 0) + dueAmount;
      updateRowFields_('SUPPLIERS', supRowIndex, { 'Current Due': newDue });
      appendRow_('SUPPLIER_LEDGER', {
        'Ledger ID': generateId_('SUPPLIER_LEDGER'), 'Date': dateStr, 'Supplier ID': payload.supplierId,
        'Supplier Name': supRow['Supplier Name'], 'Type': 'Purchase', 'Reference': purchaseId,
        'Debit': dueAmount, 'Credit': '', 'Balance': newDue, 'Notes': '',
        'Is Backdated': txDate.isBackdated, 'Backdated Days': txDate.backdatedDays,
        'Backdated Reason': txDate.reason, 'Created By': actorName_(actingUser), 'Created At': now
      });
    }

    return ok_({ purchaseId: purchaseId, grandTotal: grandTotal, dueAmount: dueAmount });
  } catch (err) {
    logError_('createPurchase', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}
