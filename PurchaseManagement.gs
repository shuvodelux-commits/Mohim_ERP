/**
 * PurchaseManagement.gs
 * ---------------------------------------------------------------------
 * Everything that happens to a purchase after Purchase.gs creates it:
 * listing, viewing, and updating in place. Deliberately the mirror image
 * of SalesManagement.gs - same function shapes, same guards, same
 * reverse-and-reapply approach - so the two modules stay learnable as
 * one pattern rather than two.
 *
 * WHERE A PURCHASE DIFFERS FROM A SALE, AND WHY IT MATTERS
 *
 * A sale CONSUMES stock across however many FIFO lots it needs. A
 * purchase CREATES exactly one lot per product line. So updating a sale
 * means re-running FIFO, while updating a purchase means resizing that
 * one lot. That single difference drives everything below.
 *
 * Raising a line's quantity is always safe - the lot simply grows.
 * LOWERING it is not: some of those goods may already have been sold out
 * of that very lot. So a reduction is refused unless the lot still holds
 * at least that much unsold, naming the shortfall rather than letting
 * Remaining Quantity go negative and quietly corrupting FIFO costing.
 *
 * Everything else follows updateSale exactly: validate fully before
 * writing anything, diff old against new quantities so only real changes
 * move stock, then reconcile cash, bank and the supplier's balance by
 * delta where the payment method stayed put and by full reverse-and-
 * reapply where it changed.
 * ---------------------------------------------------------------------
 */

/** Active bank accounts for the purchase payment dropdown. */
function getPurchaseManagementBankAccounts(token) {
  try {
    requirePermission_(token, 'purchase', 'view');
    const accounts = getAllRows_('BANK_ACCOUNTS').filter(function (b) { return b['Status'] !== 'Inactive'; });
    return ok_(accounts.map(function (b) { return { id: b['Bank Account ID'], name: b['Account Name'] }; }));
  } catch (err) {
    logError_('getPurchaseManagementBankAccounts', err);
    return fail_(err.message);
  }
}

/** Every live purchase, with returned amount and a derived return status. */
function getPurchaseManagementList(token) {
  try {
    requirePermission_(token, 'purchase', 'view');
    const purchases = activeRows_('PURCHASES');
    const returns = activeRows_('PURCHASE_RETURN');

    const returnedByPurchase = {};
    returns.forEach(function (r) {
      const pid = r['Purchase ID'];
      returnedByPurchase[pid] = (returnedByPurchase[pid] || 0) + (Number(r['Total Return Amount']) || 0);
    });

    const needsSettlement = purchases.some(function (p) {
      return String(p['Supplier ID'] || '') && (Number(p['Due Amount']) || 0) > 0.004;
    });
    const ledgerBySupplier = {};
    if (needsSettlement) {
      getAllRows_('SUPPLIER_LEDGER').forEach(function (row) {
        const supplierId = String(row['Supplier ID'] || '');
        if (!ledgerBySupplier[supplierId]) ledgerBySupplier[supplierId] = [];
        ledgerBySupplier[supplierId].push(row);
      });
    }
    const stateBySupplier = {};

    const list = purchases.map(function (p) {
      const pid = p['Purchase ID'];
      const returned = returnedByPurchase[pid] || 0;
      const grand = Number(p['Grand Total']) || 0;
      const supplierId = String(p['Supplier ID'] || '');
      let settlement = null;
      if (supplierId && (Number(p['Due Amount']) || 0) > 0.004 &&
          typeof supplierSettlementState_ === 'function' &&
          typeof supplierPurchaseSettlementSnapshotFromState_ === 'function') {
        if (!stateBySupplier[supplierId]) {
          stateBySupplier[supplierId] = supplierSettlementState_(supplierId, {
            ledgerRows: ledgerBySupplier[supplierId] || [],
            returnRows: returns
          });
        }
        settlement = supplierPurchaseSettlementSnapshotFromState_(p, stateBySupplier[supplierId]);
      }
      const paidAmount = settlement ? Number(settlement.paidAmount) || 0 : Number(p['Paid Amount']) || 0;
      const dueAmount = settlement ? Number(settlement.dueAmount) || 0 : Number(p['Due Amount']) || 0;
      const paymentStatus = settlement ? settlement.paymentStatus : p['Payment Status'];
      return {
        purchaseId: pid, date: safeDateOnly_(p['Date']),
        supplierId: p['Supplier ID'], supplierName: p['Supplier Name'],
        grandTotal: grand, paidAmount: paidAmount,
        dueAmount: dueAmount,
        returnedAmount: returned, netPurchase: grand - returned,
        paymentStatus: paymentStatus,
        paymentMethod: p['Payment Method'] || 'Cash',
        returnStatus: returned > 0 ? (returned >= grand ? 'Fully Returned' : 'Partially Returned') : 'No Return',
        notes: p['Notes'] || '',
        editable: returned === 0
      };
    }).sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });

    return ok_(list);
  } catch (err) {
    logError_('getPurchaseManagementList', err);
    return fail_(err.message);
  }
}

/** Full purchase with its lines, for the View popup. */
function getPurchaseDetail(token, purchaseId) {
  try {
    requirePermission_(token, 'purchase', 'view');
    const p = findFirstRow_('PURCHASES', 'Purchase ID', purchaseId);
    if (!p) return fail_('Purchase not found.');
    if (isDeleted_(p)) return fail_('This purchase has been deleted.');

    const items = getAllRows_('PURCHASE_ITEMS').filter(function (i) { return i['Purchase ID'] === purchaseId; });
    const detailProductsById = {};
    getAllRows_('PRODUCTS').forEach(function (pr) { detailProductsById[pr['Product ID']] = pr; });
    const detailLotsByProduct = {};
    getAllRows_('STOCK_LOTS').forEach(function (lot) {
      if (lot['Purchase ID'] === purchaseId) detailLotsByProduct[lot['Product ID']] = lot;
    });
    let returned = 0;
    activeRows_('PURCHASE_RETURN').forEach(function (r) {
      if (r['Purchase ID'] === purchaseId) returned += Number(r['Total Return Amount']) || 0;
    });

    const settlement = typeof supplierPurchaseSettlementSnapshot_ === 'function'
      ? supplierPurchaseSettlementSnapshot_(purchaseId)
      : null;
    return ok_({
      purchaseId: p['Purchase ID'], date: safeDateOnly_(p['Date']),
      supplierId: p['Supplier ID'], supplierName: p['Supplier Name'],
      subtotal: Number(p['Subtotal']) || 0, discount: Number(p['Discount']) || 0,
      grandTotal: Number(p['Grand Total']) || 0,
      paidAmount: settlement ? Number(settlement.paidAmount) || 0 : Number(p['Paid Amount']) || 0,
      dueAmount: settlement ? Number(settlement.dueAmount) || 0 : Number(p['Due Amount']) || 0,
      paymentStatus: settlement ? settlement.paymentStatus : p['Payment Status'],
      paymentMethod: p['Payment Method'] || 'Cash',
      bankAccountName: p['Bank Account Name'] || '',
      notes: p['Notes'] || '', createdBy: p['Created By'] || '',
      returnedAmount: returned, netPurchase: (Number(p['Grand Total']) || 0) - returned,
      items: items.map(function (i) {
        return {
          productId: i['Product ID'], name: i['Product Name'],
          qty: Number(i['Quantity']) || 0, unitPrice: Number(i['Unit Price']) || 0,
          sellingPrice: (i['Sell Price'] !== '' && i['Sell Price'] !== undefined) ? Number(i['Sell Price']) || 0 : lotSellPrice_(detailLotsByProduct[i['Product ID']], detailProductsById[i['Product ID']]),
          lineTotal: Number(i['Line Total']) || 0
        };
      })
    });
  } catch (err) {
    logError_('getPurchaseDetail', err);
    return fail_(err.message);
  }
}

/** Validates editability and returns everything the purchase form needs to load Update Mode. */
function getPurchaseForUpdate(token, purchaseId) {
  try {
    requirePermission_(token, 'purchase', 'edit');
    const p = findFirstRow_('PURCHASES', 'Purchase ID', purchaseId);
    if (!p) return fail_('Purchase not found.');
    if (isDeleted_(p)) return fail_('This purchase has been deleted.');

    const hasReturn = activeRows_('PURCHASE_RETURN').some(function (r) { return r['Purchase ID'] === purchaseId; });
    if (hasReturn) {
      return fail_('This purchase has Purchase Return records and can no longer be updated. Use Purchase Return for further corrections.');
    }

    const items = getAllRows_('PURCHASE_ITEMS').filter(function (i) { return i['Purchase ID'] === purchaseId; });
    const productsByIdForUpdate = {};
    getAllRows_('PRODUCTS').forEach(function (pr) { productsByIdForUpdate[pr['Product ID']] = pr; });
    const lotsByProductForUpdate = {};
    getAllRows_('STOCK_LOTS').forEach(function (lot) {
      if (lot['Purchase ID'] === purchaseId) lotsByProductForUpdate[lot['Product ID']] = lot;
    });

    return ok_({
      purchaseId: p['Purchase ID'], date: safeDateOnly_(p['Date']),
      supplierId: p['Supplier ID'], supplierName: p['Supplier Name'],
      discount: Number(p['Discount']) || 0, paidAmount: Number(p['Paid Amount']) || 0,
      paymentMethod: p['Payment Method'] || (Number(p['Paid Amount']) > 0 ? 'Cash' : ''),
      bankAccountId: p['Bank Account ID'] || '',
      notes: p['Notes'] || '',
      items: items.map(function (i) {
        const storedSell = i['Sell Price'];
        return {
          productId: i['Product ID'], name: i['Product Name'], qty: Number(i['Quantity']) || 0, unitPrice: Number(i['Unit Price']) || 0,
          sellingPrice: (storedSell !== '' && storedSell !== undefined && storedSell !== null)
            ? Number(storedSell) || 0
            : lotSellPrice_(lotsByProductForUpdate[i['Product ID']], productsByIdForUpdate[i['Product ID']])
        };
      })
    });
  } catch (err) {
    logError_('getPurchaseForUpdate', err);
    return fail_(err.message);
  }
}

/**
 * Overwrites an existing purchase in place: same Purchase ID and Date,
 * new lines / discount / payment. Re-validates editability independently
 * of getPurchaseForUpdate - never trust a stale client-side check.
 *
 * payload = { items:[{productId,name,qty,unitPrice}], discount, paidAmount,
 *             paymentMethod, bankAccountId, notes, reason }
 */
function updatePurchase(token, purchaseId, payload) {
  return updatePurchaseInternal_(token, purchaseId, payload, { lockHeld: false });
}

function updatePurchaseInternal_(token, purchaseId, payload, options) {
  const opts = options || {};
  const lock = opts.lockHeld ? null : LockService.getScriptLock();
  if (lock) lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    requirePermission_(token, 'purchase', 'edit');
    requireActiveCashSession_();
    if (!payload.items || !payload.items.length) return fail_('Add at least one product line.');
    if (!sanitizeInput_(payload.reason)) return fail_('Enter a reason for this update.');

    const purchase = findFirstRow_('PURCHASES', 'Purchase ID', purchaseId);
    if (!purchase) return fail_('Purchase not found.');
    if (isDeleted_(purchase)) return fail_('This purchase has been deleted.');
    const originalDate = safeDateOnly_(purchase['Date']);
    const dateStr = originalDate;
    const dateChanged = dateStr !== originalDate;
    

    const hasReturn = activeRows_('PURCHASE_RETURN').some(function (r) { return r['Purchase ID'] === purchaseId; });
    if (hasReturn) {
      return fail_('This purchase has Purchase Return records and can no longer be updated. Use Purchase Return for further corrections.');
    }

    // ================== VALIDATION PHASE - writes nothing ==================
    const oldItems = getAllRows_('PURCHASE_ITEMS').filter(function (i) { return i['Purchase ID'] === purchaseId; });
    const oldQtyByProduct = {};
    const oldPriceByProduct = {};
    const oldLineCountByProduct = {};
    oldItems.forEach(function (i) {
      const id = i['Product ID'];
      oldQtyByProduct[id] = (oldQtyByProduct[id] || 0) + (Number(i['Quantity']) || 0);
      oldPriceByProduct[id] = Number(i['Unit Price']) || 0;
      oldLineCountByProduct[id] = (oldLineCountByProduct[id] || 0) + 1;
    });
    const ambiguousOldProduct = Object.keys(oldLineCountByProduct).filter(function (id) { return oldLineCountByProduct[id] > 1; })[0];
    if (ambiguousOldProduct) {
      return fail_('This historical purchase contains the same product on multiple lines. It cannot be edited safely because those lines created separate stock lots. Use Purchase Return/correction instead.');
    }

    let subtotal = 0;
    const newQtyByProduct = {};
    const newPriceByProduct = {};
    const newSellPriceByProduct = {};
    const seenProduct = {};
    payload.items.forEach(function (item, i) {
      const qty = Number(item.qty), price = Number(item.unitPrice), sellPrice = Number(item.sellingPrice);
      if (!isValidNonNegativeNumber_(qty) || qty <= 0) throw new Error('Line ' + (i + 1) + ': quantity must be greater than zero.');
      if (!isValidNonNegativeNumber_(price)) throw new Error('Line ' + (i + 1) + ': unit price must be a valid number.');
      if (!isValidNonNegativeNumber_(sellPrice)) throw new Error('Line ' + (i + 1) + ': sell price must be a valid number.');
      if (seenProduct[item.productId]) throw new Error(item.name + ' appears more than once — combine it into one line.');
      seenProduct[item.productId] = true;
      newQtyByProduct[item.productId] = qty;
      newPriceByProduct[item.productId] = price;
      newSellPriceByProduct[item.productId] = sellPrice;
      subtotal += qty * price;
    });

    const productsById = {};
    getAllRows_('PRODUCTS').forEach(function (p) { productsById[p['Product ID']] = p; });

    const lotByProduct = {};
    getAllRows_('STOCK_LOTS').forEach(function (l) {
      if (l['Purchase ID'] === purchaseId) lotByProduct[l['Product ID']] = l;
    });

    // Cost changes affect future FIFO COGS. Once any unit from a purchase lot
    // has been sold, silently changing its unit cost would make the Purchase
    // report disagree with already-recorded SALE_ITEM_LOTS COGS, so block it.
    const costChanges = [];
    Object.keys(newPriceByProduct).forEach(function (productId) {
      if (oldPriceByProduct[productId] === undefined) return; // new line gets a new lot below
      const oldPrice = oldPriceByProduct[productId];
      const newPrice = newPriceByProduct[productId];
      if (Math.abs(oldPrice - newPrice) < 0.0000001) return;
      const lot = lotByProduct[productId];
      if (!lot) throw new Error('This purchase has no stock lot on file, so its unit price cannot be changed safely.');
      const original = Number(lot['Original Quantity']) || 0;
      const remaining = Number(lot['Remaining Quantity']) || 0;
      const consumed = Math.max(0, original - remaining);
      if (consumed > 0) {
        throw new Error('Purchase price cannot be changed after stock from this lot has already been sold. Use a cost adjustment/correction instead.');
      }
      costChanges.push({ lot: lot, newPrice: newPrice });
    });

    const allProductIds = {};
    Object.keys(oldQtyByProduct).forEach(function (id) { allProductIds[id] = true; });
    Object.keys(newQtyByProduct).forEach(function (id) { allProductIds[id] = true; });

    const stockChanges = [];
    Object.keys(allProductIds).forEach(function (productId) {
      const oldQty = oldQtyByProduct[productId] || 0;
      const newQty = newQtyByProduct[productId] || 0;
      const delta = newQty - oldQty;          // + = buying more, - = buying less

      const product = productsById[productId];
      if (!product || isDeleted_(product)) throw new Error('A product on this purchase no longer exists.');
      if (delta === 0) return;

      const currentStock = Number(product['Current Stock']) || 0;
      const newStock = currentStock + delta;

      // The lot guard - the part that has no equivalent in updateSale.
      // Checked BEFORE the general stock guard on purpose: both would refuse
      // the same edit, but this one can say WHY (how much of this particular
      // purchase is already sold), and the first error raised is the one the
      // user reads.
      const lot = lotByProduct[productId];
      if (delta < 0) {
        if (!lot) {
          throw new Error(product['Product Name'] + ': this purchase has no stock lot on file, so its quantity cannot be reduced. Use Purchase Return instead.');
        }
        const remaining = Number(lot['Remaining Quantity']) || 0;
        if (remaining < Math.abs(delta)) {
          throw new Error(
            product['Product Name'] + ': only ' + remaining + ' of the ' + (Number(lot['Original Quantity']) || 0) +
            ' bought on this purchase is still unsold, so the quantity cannot be reduced by ' + Math.abs(delta) + '.'
          );
        }
      }

      // Backstop for stock that moved for a reason outside this purchase.
      // Only relevant when reducing (delta < 0) — buying MORE (delta > 0)
      // can only move Current Stock toward positive and must never be
      // blocked here, even if it's still negative afterward (POS
      // deliberately allows selling past zero — see completeSale in
      // Sales.gs).
      if (delta < 0 && newStock < 0) {
        throw new Error(product['Product Name'] + ': reducing this line would take stock to ' + newStock + '. Some of it has already been sold.');
      }

      stockChanges.push({
        productId: productId, name: product['Product Name'], rowIndex: product._rowIndex,
        delta: delta, newStock: newStock, lot: lot || null,
        hasNewLine: newPriceByProduct[productId] !== undefined,
        linePrice: newPriceByProduct[productId] === undefined ? 0 : newPriceByProduct[productId],
        lineSellPrice: newSellPriceByProduct[productId] === undefined ? 0 : newSellPriceByProduct[productId]
      });
    });

    const discount = isValidNonNegativeNumber_(payload.discount) ? Number(payload.discount) : 0;
    const grandTotal = Math.max(0, subtotal - discount);
    let paidAmount = isValidNonNegativeNumber_(payload.paidAmount) ? Number(payload.paidAmount) : 0;
    if (paidAmount > grandTotal) paidAmount = grandTotal;
    const dueAmount = grandTotal - paidAmount;
    const paymentStatus = dueAmount <= 0 ? 'Paid' : (paidAmount > 0 ? 'Partial' : 'Due');

    const paymentMethod = paidAmount > 0 ? (payload.paymentMethod || 'Cash') : '';
    const bankAccount = resolveBankAccount_(paymentMethod, payload.bankAccountId);
    const bankAccountId = bankAccount.id, bankAccountName = bankAccount.name;

    const oldPaidAmount = Number(purchase['Paid Amount']) || 0;
    const oldDueAmount = Number(purchase['Due Amount']) || 0;
    const oldGrandTotal = Number(purchase['Grand Total']) || 0;
    const oldPaymentMethod = purchase['Payment Method'] || (oldPaidAmount > 0 ? 'Cash' : '');
    const oldBankAccountId = isBankLikePaymentMethod_(oldPaymentMethod) ? purchase['Bank Account ID'] : '';
    const oldSupplierId = String(purchase['Supplier ID'] || '');
    const oldSupplierName = String(purchase['Supplier Name'] || '');
    const supplierId = String(payload.supplierId || '');
    if (!supplierId) return fail_('Choose a supplier.');
    const supplierRow = activeRows_('SUPPLIERS').filter(function (row) {
      return String(row['Supplier ID'] || '') === supplierId && row['Status'] !== 'Inactive';
    })[0];
    if (!supplierRow) return fail_('Selected supplier was not found or is inactive.');
    const supplierName = String(supplierRow['Supplier Name'] || '');
    const supplierChanged = oldSupplierId !== supplierId;

    // Moving a purchase to another supplier after a later supplier payment or
    // supplier credit has already settled this purchase would require moving
    // that separate settlement transaction as well. Refuse that ambiguous
    // correction instead of silently corrupting either supplier ledger.
    if (supplierChanged && oldSupplierId && oldDueAmount > 0.004) {
      const oldSettlementState = supplierSettlementState_(oldSupplierId);
      const laterPayment = roundMoney_(Number(oldSettlementState.paymentByPurchase[purchaseId]) || 0);
      const appliedCredit = roundMoney_(Number(oldSettlementState.creditByPurchase[purchaseId]) || 0);
      if (laterPayment > 0.004 || appliedCredit > 0.004) {
        return fail_('Supplier cannot be changed after a later supplier payment or credit has settled this purchase. Reverse that settlement first, then change the supplier.');
      }
    }

    const oldSupplierRowIndex = oldSupplierId ? findRowIndex_('SUPPLIERS', 'Supplier ID', oldSupplierId) : -1;
    const oldSupplierRow = oldSupplierId ? getAllRows_('SUPPLIERS').filter(function (row) {
      return String(row['Supplier ID'] || '') === oldSupplierId;
    })[0] : null;
    if (supplierChanged && oldDueAmount > 0.004 && (!oldSupplierRow || oldSupplierRowIndex === -1)) {
      return fail_('Original supplier record was not found, so this payable cannot be reassigned safely.');
    }

    const cashOldAmount = oldPaymentMethod === 'Cash' ? oldPaidAmount : 0;
    const cashNewAmount = paymentMethod === 'Cash' ? paidAmount : 0;
    const cashDelta = cashNewAmount - cashOldAmount;
    // ======================== WRITE PHASE ========================
    // Nothing below here raises a validation error.
    const now = new Date();

    const oldRowIndexes = oldItems.map(function (i) { return i._rowIndex; }).sort(function (a, b) { return b - a; });
    oldRowIndexes.forEach(function (rowIndex) { deleteRow_('PURCHASE_ITEMS', rowIndex); });
    appendRows_('PURCHASE_ITEMS', payload.items.map(function (item) {
      const qty = Number(item.qty), price = Number(item.unitPrice), sellPrice = Number(item.sellingPrice);
      return {
        'Purchase ID': purchaseId, 'Product ID': item.productId, 'Product Name': item.name,
        'Quantity': qty, 'Unit Price': price, 'Sell Price': sellPrice, 'Line Total': qty * price
      };
    }));

    stockChanges.forEach(function (c) {
      updateRowFields_('PRODUCTS', c.rowIndex, { 'Current Stock': c.newStock, 'Updated At': now });

      const linePrice = c.linePrice;

      if (c.lot) {
        // Resize the lot this purchase created, keeping Original and
        // Remaining in step so FIFO costing and the "already sold" guard
        // both stay truthful.
        const original = Number(c.lot['Original Quantity']) || 0;
        const remaining = Number(c.lot['Remaining Quantity']) || 0;
        updateRowFields_('STOCK_LOTS', c.lot._rowIndex, {
          'Original Quantity': original + c.delta,
          'Remaining Quantity': remaining + c.delta,
          'Status': (remaining + c.delta) > 0 ? 'Active' : 'Consumed',
          'Purchase Price': c.hasNewLine ? linePrice : (Number(c.lot['Purchase Price']) || 0),
          'Sell Price': c.hasNewLine ? c.lineSellPrice : lotSellPrice_(c.lot, productsById[c.productId])
        });
      } else if (c.delta > 0) {
        // New product added to an existing purchase - it needs a lot of
        // its own, dated to the purchase so FIFO order stays right.
        createLot_(c.productId, c.name, purchaseId, dateStr, linePrice, c.delta, supplierId, supplierName, c.lineSellPrice);
      }

      appendRow_('STOCK_MOVEMENT', {
        'Movement ID': generateId_('STOCK_MOVEMENT'), 'Date': now, 'Product ID': c.productId,
        'Product Name': c.name, 'Type': 'Purchase Update', 'Reference': purchaseId,
        'Quantity In': c.delta > 0 ? c.delta : '', 'Quantity Out': c.delta < 0 ? Math.abs(c.delta) : '',
        'Balance Stock': c.newStock, 'Notes': 'Purchase updated', 'Lot ID': c.lot ? c.lot['Lot ID'] : ''
      });
    });

    // Price-only edits have delta === 0 and therefore are not in
    // stockChanges. Their validation happened above; now keep the unconsumed
    // lot's cost basis aligned with the edited Purchase Item price.
    costChanges.forEach(function (c) {
      updateRowFields_('STOCK_LOTS', c.lot._rowIndex, { 'Purchase Price': c.newPrice });
    });

    // Supplier is provenance of the purchase lot, not merely display text on
    // the purchase header. When correcting a wrong supplier, move every lot
    // created by this purchase (including fully consumed lots) to the selected
    // supplier so FIFO/vendor history stays consistent with the corrected
    // purchase record.
    if (supplierChanged) {
      Object.keys(lotByProduct).forEach(function (productId) {
        const lot = lotByProduct[productId];
        if (!lot) return;
        updateRowFields_('STOCK_LOTS', lot._rowIndex, {
          'Supplier ID': supplierId,
          'Supplier Name': supplierName
        });
      });
    }

    // Sell-price changes are safe even when some units from the lot have
    // already sold: historical invoices keep their stored final price, while
    // only the lot's remaining stock and the product's latest/default price
    // use the newly-entered value.
    Object.keys(newSellPriceByProduct).forEach(function (productId) {
      const product = productsById[productId];
      if (!product) return;
      const sellPrice = newSellPriceByProduct[productId];
      updateRowFields_('PRODUCTS', product._rowIndex, { 'Selling Price': sellPrice, 'Updated At': now });
      const lot = lotByProduct[productId];
      if (lot) updateRowFields_('STOCK_LOTS', lot._rowIndex, { 'Sell Price': sellPrice });
    });

    

    const editBackdate = computeBackdateInfo_(dateStr);
    updateRowFields_('PURCHASES', findRowIndex_('PURCHASES', 'Purchase ID', purchaseId), {
      'Date': dateStr,
      'Is Backdated': editBackdate.isBackdated, 'Backdated Days': editBackdate.backdatedDays,
      'Backdated Reason': purchase['Backdated Reason'] || '',
      'Supplier ID': supplierId, 'Supplier Name': supplierName,
      'Subtotal': subtotal, 'Discount': discount, 'Grand Total': grandTotal,
      'Paid Amount': paidAmount, 'Due Amount': dueAmount, 'Payment Status': paymentStatus,
      'Notes': sanitizeInput_(payload.notes),
      'Payment Method': paymentMethod, 'Bank Account ID': bankAccountId, 'Bank Account Name': bankAccountName
    });

    // ---- cash/bank reconciliation ----
    const bankOldAmount = isBankLikePaymentMethod_(oldPaymentMethod) ? oldPaidAmount : 0;
    const bankNewAmount = isBankLikePaymentMethod_(paymentMethod) ? paidAmount : 0;
    
      if (cashDelta > 0) {
        addCashBookEntry_({ Type: 'Purchase Update', Reference: purchaseId, Description: 'Additional payment from purchase update ' + purchaseId, Debit: cashDelta, Credit: '', PaymentMethod: 'Cash', Date: dateStr });
      } else if (cashDelta < 0) {
        addCashBookEntry_({ Type: 'Purchase Update', Reference: purchaseId, Description: 'Refund from purchase update ' + purchaseId, Debit: '', Credit: Math.abs(cashDelta), PaymentMethod: 'Cash', Date: dateStr });
      }
      if (oldBankAccountId && oldBankAccountId === bankAccountId) {
        const bankDelta = bankNewAmount - bankOldAmount;
        if (bankDelta > 0) addBankBookEntry_(bankAccountId, { Type: 'Purchase Update', Reference: purchaseId, Description: 'Additional payment from purchase update ' + purchaseId, Debit: bankDelta, Credit: '', Date: dateStr });
        else if (bankDelta < 0) addBankBookEntry_(bankAccountId, { Type: 'Purchase Update', Reference: purchaseId, Description: 'Refund from purchase update ' + purchaseId, Debit: '', Credit: Math.abs(bankDelta), Date: dateStr });
      } else {
        if (oldBankAccountId && bankOldAmount > 0) addBankBookEntry_(oldBankAccountId, { Type: 'Purchase Update', Reference: purchaseId, Description: 'Refund from purchase update ' + purchaseId, Debit: '', Credit: bankOldAmount, Date: dateStr });
        if (bankAccountId && bankNewAmount > 0) addBankBookEntry_(bankAccountId, { Type: 'Purchase Update', Reference: purchaseId, Description: 'Payment from purchase update ' + purchaseId, Debit: bankNewAmount, Credit: '', Date: dateStr });
      }
    

    // ---- supplier balance / supplier reassignment ----
    // A supplier change is not a simple due delta on one account. Reverse the
    // old purchase payable from the original supplier and apply the complete
    // edited payable to the selected supplier. Keep both rows as audit history.
    if (supplierChanged) {
      if (oldSupplierId && oldDueAmount > 0.004) {
        const oldBalance = roundMoney_((Number(oldSupplierRow['Current Due']) || 0) - oldDueAmount);
        updateRowFields_('SUPPLIERS', oldSupplierRowIndex, { 'Current Due': oldBalance });
        appendRow_('SUPPLIER_LEDGER', {
          'Ledger ID': generateId_('SUPPLIER_LEDGER'), 'Date': dateStr, 'Supplier ID': oldSupplierId,
          'Supplier Name': oldSupplierRow['Supplier Name'] || oldSupplierName, 'Type': 'Purchase Update', 'Reference': purchaseId,
          'Debit': '', 'Credit': oldDueAmount, 'Balance': oldBalance,
          'Notes': 'Purchase supplier corrected to ' + supplierName + ' — old payable reversed', 'Created At': now
        });
      }

      if (dueAmount > 0.004) {
        const newSupplierRowIndex = findRowIndex_('SUPPLIERS', 'Supplier ID', supplierId);
        const currentSelectedSupplier = getAllRows_('SUPPLIERS').filter(function (row) {
          return String(row['Supplier ID'] || '') === supplierId;
        })[0];
        const newBalance = roundMoney_((Number(currentSelectedSupplier['Current Due']) || 0) + dueAmount);
        updateRowFields_('SUPPLIERS', newSupplierRowIndex, { 'Current Due': newBalance });
        appendRow_('SUPPLIER_LEDGER', {
          'Ledger ID': generateId_('SUPPLIER_LEDGER'), 'Date': dateStr, 'Supplier ID': supplierId,
          'Supplier Name': supplierName, 'Type': 'Purchase Update', 'Reference': purchaseId,
          'Debit': dueAmount, 'Credit': '', 'Balance': newBalance,
          'Notes': 'Purchase supplier corrected from ' + (oldSupplierName || oldSupplierId) + ' — payable applied', 'Created At': now
        });
      }
    } else if (supplierId && (oldDueAmount !== dueAmount || dateChanged)) {
      const supRowIndex = findRowIndex_('SUPPLIERS', 'Supplier ID', supplierId);
      if (supRowIndex !== -1) {
        const supRow = getAllRows_('SUPPLIERS').filter(function (row) { return row['Supplier ID'] === supplierId; })[0];
        const newDue = (Number(supRow['Current Due']) || 0) - oldDueAmount + dueAmount;
        updateRowFields_('SUPPLIERS', supRowIndex, { 'Current Due': newDue });

        appendRow_('SUPPLIER_LEDGER', {
          'Ledger ID': generateId_('SUPPLIER_LEDGER'), 'Date': dateStr, 'Supplier ID': supplierId,
          'Supplier Name': supRow['Supplier Name'], 'Type': 'Purchase Update', 'Reference': purchaseId,
          'Debit': dueAmount > oldDueAmount ? (dueAmount - oldDueAmount) : '',
          'Credit': dueAmount < oldDueAmount ? (oldDueAmount - dueAmount) : '',
          'Balance': newDue, 'Notes': 'Purchase updated — due adjusted', 'Created At': now
        });
      }
    }

    appendRow_('INVOICE_EDIT_LOG', {
      'Log ID': generateId_('INVOICE_EDIT_LOG'), 'Invoice ID': purchaseId, 'Edit Date': now,
      'Reason': sanitizeInput_(payload.reason),
      'Before Grand Total': oldGrandTotal, 'After Grand Total': grandTotal
    });

    return ok_({ purchaseId: purchaseId, grandTotal: grandTotal, dueAmount: dueAmount });
  } catch (err) {
    logError_('updatePurchase', err);
    return fail_(err.message);
  } finally {
    if (lock) lock.releaseLock();
  }
}
