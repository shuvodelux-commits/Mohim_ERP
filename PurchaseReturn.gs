/**
 * PurchaseReturn.gs
 * ---------------------------------------------------------------------
 * Returning stock to a supplier: mirrors SalesReturn.gs — a return is a
 * new linked record (header in PURCHASE_RETURN, lines in
 * PURCHASE_RETURN_ITEMS), never an edit to the original Purchase. Stock
 * decreases (opposite of a Sales Return, which increases it) with a
 * logged Stock Movement row, and the refund either comes out of the
 * Cash Book (supplier hands cash back) or reduces what we owe them
 * (Supplier Ledger credit — mirrors paySupplier's sign convention, and
 * can push Current Due negative meaning the supplier now owes US).
 *
 * Phase 5 (permission wiring): every function here now requires a
 * session token and checks requirePermission_ against the 'purchase'
 * module (this flow lives inside purchase.html, the same nav module as
 * Purchase.gs, so it shares that module key rather than getting its own).
 *
 * Review item 6 / P0 #4: the Cash Book / Bank Book entry this function
 * writes now carries the transaction's own date instead of defaulting to
 * today, so a backdated entry no longer lands on today's cash drawer.
 *
 * P3 drift (item 6): the backdate preamble is now
 * resolveTransactionDate_() in Utils.gs — same checks, same messages.
 *
 * Backdated Entry (Tier 1): 'Date' is now an optional, user-supplied
 * value (defaults to today), stored as a 'yyyy-MM-dd' string — switched
 * from a raw Date object, same fix as Purchase.gs, for consistency with
 * every other backdatable module. The existing 'Reason' field is
 * unrelated (why the return happened) — 'Backdated Reason' is a
 * separate new column. Every sub-write this function triggers (Stock
 * Movement, Cash Book, Supplier Ledger, Stock Lots) keeps stamping the
 * real 'now', unchanged — only the Return's own header row date moves.
 * Backdate permission is checked under the 'purchase' module key, same
 * as everything else in this file.
 * ---------------------------------------------------------------------
 */

function searchPurchasesForReturn(token, query) {
  try {
    requirePermission_(token, 'purchase', 'view');
    const q = sanitizeInput_(query).toLowerCase();
    if (!q) return fail_('Type a purchase ID or a supplier name.');

    const matches = getAllRows_('PURCHASES')
      .filter(function (p) {
        return !isDeleted_(p) && (
          String(p['Purchase ID']).toLowerCase().indexOf(q) !== -1 ||
          String(p['Supplier Name']).toLowerCase().indexOf(q) !== -1
        );
      })
      .sort(function (a, b) { return String(b['Created At']).localeCompare(String(a['Created At'])); });

    const limited = matches.slice(0, 20);
    const needsSettlement = limited.some(function (p) {
      return String(p['Supplier ID'] || '') && (Number(p['Due Amount']) || 0) > 0.004;
    });
    const settlementReturnRows = needsSettlement ? activeRows_('PURCHASE_RETURN') : [];
    const ledgerBySupplier = {};
    if (needsSettlement) {
      getAllRows_('SUPPLIER_LEDGER').forEach(function (row) {
        const supplierId = String(row['Supplier ID'] || '');
        if (!ledgerBySupplier[supplierId]) ledgerBySupplier[supplierId] = [];
        ledgerBySupplier[supplierId].push(row);
      });
    }
    const stateBySupplier = {};

    return ok_(limited.map(function (p) {
      const supplierId = String(p['Supplier ID'] || '');
      let paymentStatus = p['Payment Status'];
      if (supplierId && (Number(p['Due Amount']) || 0) > 0.004 &&
          typeof supplierSettlementState_ === 'function' &&
          typeof supplierPurchaseSettlementSnapshotFromState_ === 'function') {
        if (!stateBySupplier[supplierId]) {
          stateBySupplier[supplierId] = supplierSettlementState_(supplierId, {
            ledgerRows: ledgerBySupplier[supplierId] || [],
            returnRows: settlementReturnRows
          });
        }
        const settlement = supplierPurchaseSettlementSnapshotFromState_(p, stateBySupplier[supplierId]);
        if (settlement) paymentStatus = settlement.paymentStatus;
      }
      return {
        purchaseId: p['Purchase ID'], date: safeDateOnly_(p['Date']), supplierName: p['Supplier Name'],
        grandTotal: p['Grand Total'], paymentStatus: paymentStatus
      };
    }));
  } catch (err) {
    logError_('searchPurchasesForReturn', err);
    return fail_(err.message);
  }
}

/** Purchase + every product with Bought / Previously Returned / Available quantities, for the Return Cart. */
function getPurchaseForReturn(token, purchaseId) {
  try {
    requirePermission_(token, 'purchase', 'view');
    const purchase = findFirstRow_('PURCHASES', 'Purchase ID', purchaseId);
    if (!purchase || isDeleted_(purchase)) return fail_('Purchase not found or has been deleted.');

    const purchaseItems = getAllRows_('PURCHASE_ITEMS').filter(function (i) { return i['Purchase ID'] === purchaseId; });
    const returnItems = activePurchaseReturnItems_().filter(function (i) { return i['Purchase ID'] === purchaseId; });
    const subtotal = Number(purchase['Subtotal']) || 0;
    const grandTotal = Number(purchase['Grand Total']) || 0;

    const returnedByProduct = {};
    let previouslyReturnedAmount = 0;
    returnItems.forEach(function (ri) {
      returnedByProduct[ri['Product ID']] = (returnedByProduct[ri['Product ID']] || 0) + (Number(ri['Return Quantity']) || 0);
      previouslyReturnedAmount += economicReturnLineAmount_(ri, subtotal, grandTotal);
    });

    // Aggregate historical duplicate product lines into one return-cart row.
    // New purchases reject duplicates, but old data may already contain them.
    const boughtByProduct = {};
    purchaseItems.forEach(function (pi) {
      const id = pi['Product ID'];
      if (!boughtByProduct[id]) {
        boughtByProduct[id] = { productId: id, name: pi['Product Name'], boughtQty: 0, grossValue: 0 };
      }
      const qty = Number(pi['Quantity']) || 0;
      boughtByProduct[id].boughtQty += qty;
      boughtByProduct[id].grossValue += qty * (Number(pi['Unit Price']) || 0);
    });

    const items = Object.keys(boughtByProduct).map(function (id) {
      const item = boughtByProduct[id];
      const already = returnedByProduct[id] || 0;
      const grossUnitPrice = item.boughtQty > 0 ? item.grossValue / item.boughtQty : 0;
      return {
        productId: id,
        name: item.name,
        unitPrice: roundMoney_(effectiveTransactionUnitPrice_(grossUnitPrice, subtotal, grandTotal)),
        boughtQty: item.boughtQty,
        previouslyReturnedQty: already,
        availableQty: Math.max(0, item.boughtQty - already)
      };
    });

    const settlement = typeof supplierPurchaseSettlementSnapshot_ === 'function'
      ? supplierPurchaseSettlementSnapshot_(purchaseId)
      : null;
    return ok_({
      purchaseId: purchase['Purchase ID'], date: safeDateOnly_(purchase['Date']), supplierId: purchase['Supplier ID'],
      supplierName: purchase['Supplier Name'], grandTotal: grandTotal,
      paidAmount: settlement ? Number(settlement.paidAmount) || 0 : Number(purchase['Paid Amount']) || 0,
      dueAmount: settlement ? Number(settlement.dueAmount) || 0 : Number(purchase['Due Amount']) || 0,
      previouslyReturnedAmount: previouslyReturnedAmount,
      netPurchase: grandTotal - previouslyReturnedAmount,
      items: items
    });
  } catch (err) {
    logError_('getPurchaseForReturn', err);
    return fail_(err.message);
  }
}

/**
 * payload = {
 *   purchaseId, items: [{ productId, name, qty }],
 *   refundMethod: 'Cash' | 'Supplier Credit', reason, notes,
 *   date (optional, 'yyyy-MM-dd' — defaults to today), backdatedReason
 *   (required only when date is in the past)
 * }
 */
function completePurchaseReturn(token, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    const actingUser = requirePermission_(token, 'purchase', 'add');
    requireActiveCashSession_();
    if (!payload.purchaseId) return fail_('No purchase selected.');
    if (!payload.items || !payload.items.length) return fail_('Select at least one product to return.');
    if (payload.refundMethod !== 'Cash' && payload.refundMethod !== 'Supplier Credit') return fail_('Choose a refund method.');

    const now = new Date();
    const txDate = resolveTransactionDate_(token, 'purchase', payload.date, payload.backdatedReason, 'Return');
    const dateStr = txDate.dateStr;

    const purchase = findFirstRow_('PURCHASES', 'Purchase ID', payload.purchaseId);
    if (!purchase || isDeleted_(purchase)) return fail_('Purchase not found or has been deleted.');

    const purchaseItems = getAllRows_('PURCHASE_ITEMS').filter(function (i) { return i['Purchase ID'] === payload.purchaseId; });
    const returnItemsSoFar = activePurchaseReturnItems_().filter(function (i) { return i['Purchase ID'] === payload.purchaseId; });
    const purchaseSubtotal = Number(purchase['Subtotal']) || 0;
    const purchaseGrandTotal = Number(purchase['Grand Total']) || 0;

    const boughtByProduct = {};
    purchaseItems.forEach(function (pi) {
      const id = pi['Product ID'];
      if (!boughtByProduct[id]) {
        boughtByProduct[id] = { productId: id, name: pi['Product Name'], boughtQty: 0, grossValue: 0 };
      }
      const qty = Number(pi['Quantity']) || 0;
      boughtByProduct[id].boughtQty += qty;
      boughtByProduct[id].grossValue += qty * (Number(pi['Unit Price']) || 0);
    });

    const returnedByProduct = {};
    returnItemsSoFar.forEach(function (ri) {
      returnedByProduct[ri['Product ID']] = (returnedByProduct[ri['Product ID']] || 0) + (Number(ri['Return Quantity']) || 0);
    });

    let totalReturnAmount = 0;
    const seenProduct = {};
    const validated = payload.items.map(function (item, idx) {
      const qty = Number(item.qty);
      if (!isValidNonNegativeNumber_(qty) || qty <= 0) throw new Error('Line ' + (idx + 1) + ': quantity must be greater than zero.');
      if (seenProduct[item.productId]) throw new Error('Duplicate product in return. Combine it into one line.');
      seenProduct[item.productId] = true;

      const bought = boughtByProduct[item.productId];
      if (!bought) throw new Error((item.name || item.productId) + ' was not part of this purchase.');
      const alreadyReturned = returnedByProduct[item.productId] || 0;
      const available = bought.boughtQty - alreadyReturned;
      if (qty > available) throw new Error(bought.name + ': only ' + available + ' available to return.');

      const grossUnitPrice = bought.boughtQty > 0 ? bought.grossValue / bought.boughtQty : 0;
      const effectiveUnitPrice = effectiveTransactionUnitPrice_(grossUnitPrice, purchaseSubtotal, purchaseGrandTotal);
      const lineTotal = roundMoney_(qty * effectiveUnitPrice);
      const storedUnitPrice = qty > 0 ? lineTotal / qty : 0;
      totalReturnAmount = roundMoney_(totalReturnAmount + lineTotal);
      return { productId: item.productId, name: bought.name, qty: qty, price: storedUnitPrice, lineTotal: lineTotal };
    });

    // ================== VALIDATION / PLANNING PHASE — writes nothing ==================
    const productsById = {};
    getAllRows_('PRODUCTS').forEach(function (p) { productsById[p['Product ID']] = p; });
    const allLots = getAllRows_('STOCK_LOTS');
    const stockChanges = validated.map(function (v) {
      const product = productsById[v.productId];
      if (!product || isDeleted_(product)) throw new Error(v.name + ' no longer exists as a product.');
      const currentStock = Number(product['Current Stock']) || 0;
      const newStock = currentStock - v.qty;
      if (newStock < 0) throw new Error(v.name + ': only ' + currentStock + ' in stock — cannot return more than you have on hand.');
      const lotPlan = planPurchaseReturnLotReduction_(payload.purchaseId, v.productId, v.qty, allLots);
      return {
        productId: v.productId, name: v.name, rowIndex: product._rowIndex,
        qty: v.qty, newStock: newStock, lotPlan: lotPlan
      };
    });

    let supplierRow = null;
    if (payload.refundMethod === 'Supplier Credit') {
      supplierRow = getAllRows_('SUPPLIERS').filter(function (s) {
        return s['Supplier ID'] === purchase['Supplier ID'] && !isDeleted_(s);
      })[0];
      if (!supplierRow) throw new Error('Supplier no longer exists.');
    }

    if (payload.refundMethod === 'Cash') {
      const priorReturnIds = {};
      activeRows_('PURCHASE_RETURN').forEach(function (r) {
        if (r['Purchase ID'] === payload.purchaseId) priorReturnIds[r['Return ID']] = true;
      });
      const priorCashRefunds = activeRows_('CASH_BOOK')
        .filter(function (c) {
          return c['Type'] === 'Purchase Return' && priorReturnIds[c['Reference']];
        })
        .reduce(function (sum, c) { return sum + (Number(c['Credit']) || 0); }, 0);
      const verifiedPaid = typeof supplierPurchaseCashPaid_ === 'function'
        ? supplierPurchaseCashPaid_(payload.purchaseId)
        : (Number(purchase['Paid Amount']) || 0);
      const maxCashRefund = Math.max(0, verifiedPaid - priorCashRefunds);
      if (totalReturnAmount > maxCashRefund + 0.005) {
        throw new Error(
          'Cash refund is limited to ' + roundMoney_(maxCashRefund) +
          ' verifiably paid on this purchase. Use Supplier Credit for the remaining return value.'
        );
      }
    }

    // ======================== WRITE PHASE ========================
    const returnId = generateId_('PURCHASE_RETURN');

    appendRow_('PURCHASE_RETURN', {
      'Return ID': returnId, 'Date': dateStr, 'Purchase ID': payload.purchaseId,
      'Supplier ID': purchase['Supplier ID'], 'Supplier Name': purchase['Supplier Name'],
      'Refund Method': payload.refundMethod,
      'Total Return Amount': totalReturnAmount, 'Reason': sanitizeInput_(payload.reason),
      'Notes': sanitizeInput_(payload.notes), 'Processed By': actorName_(actingUser),
      'Created At': now,
      'Is Backdated': txDate.isBackdated, 'Backdated Days': txDate.backdatedDays, 'Backdated Reason': txDate.reason
    });

    const returnItemRows = [];
    const stockMovementRows = [];
    stockChanges.forEach(function (c) {
      updateRowFields_('PRODUCTS', c.rowIndex, { 'Current Stock': c.newStock, 'Updated At': now });
      const reduced = applyPurchaseReturnLotReduction_(c.lotPlan);
      reduced.forEach(function (r) {
        stockMovementRows.push({
          'Movement ID': generateId_('STOCK_MOVEMENT'), 'Date': now, 'Product ID': c.productId,
          'Product Name': c.name, 'Type': 'Purchase Return', 'Reference': returnId,
          'Quantity In': '', 'Quantity Out': r.qty, 'Balance Stock': c.newStock, 'Notes': '', 'Lot ID': r.lotId
        });
      });
    });
    validated.forEach(function (v) {
      returnItemRows.push({
        'Return ID': returnId, 'Purchase ID': payload.purchaseId, 'Product ID': v.productId,
        'Product Name': v.name, 'Return Quantity': v.qty, 'Return Price': v.price, 'Line Total': v.lineTotal,
        'Pricing Basis': 'NetAfterInvoiceDiscount'
      });
    });
    appendRows_('PURCHASE_RETURN_ITEMS', returnItemRows);
    appendRows_('STOCK_MOVEMENT', stockMovementRows);

    if (payload.refundMethod === 'Cash') {
      addCashBookEntry_({
        Type: 'Purchase Return', Reference: returnId, Description: 'Cash refund from ' + purchase['Supplier Name'],
        Debit: '', Credit: totalReturnAmount, PaymentMethod: 'Cash', Date: dateStr
      });
    } else {
      const newDue = (Number(supplierRow['Current Due']) || 0) - totalReturnAmount;
      updateRowFields_('SUPPLIERS', supplierRow._rowIndex, { 'Current Due': newDue });
      appendRow_('SUPPLIER_LEDGER', {
        'Ledger ID': generateId_('SUPPLIER_LEDGER'), 'Date': dateStr, 'Supplier ID': purchase['Supplier ID'],
        'Supplier Name': supplierRow['Supplier Name'], 'Type': 'Purchase Return Credit', 'Reference': returnId,
        'Debit': '', 'Credit': totalReturnAmount, 'Balance': newDue, 'Notes': 'Credit for return ' + returnId,
        'Created By': actorName_(actingUser), 'Created At': now
      });
    }

    return ok_({ returnId: returnId, totalReturnAmount: totalReturnAmount });
  } catch (err) {
    logError_('completePurchaseReturn', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

function getPurchaseReturnHistory(token) {
  try {
    requirePermission_(token, 'purchase', 'view');
    const returns = getAllRows_('PURCHASE_RETURN')
      .sort(function (a, b) { return String(b['Created At']).localeCompare(String(a['Created At'])); });
    return ok_(returns);
  } catch (err) {
    logError_('getPurchaseReturnHistory', err);
    return fail_(err.message);
  }
}

function getPurchaseReturnDetail(token, returnId) {
  try {
    requirePermission_(token, 'purchase', 'view');
    const header = getAllRows_('PURCHASE_RETURN').filter(function (r) { return r['Return ID'] === returnId; })[0];
    if (!header) return fail_('Return not found.');
    const items = getAllRows_('PURCHASE_RETURN_ITEMS').filter(function (i) { return i['Return ID'] === returnId; });
    return ok_({ header: header, items: items });
  } catch (err) {
    logError_('getPurchaseReturnDetail', err);
    return fail_(err.message);
  }
}