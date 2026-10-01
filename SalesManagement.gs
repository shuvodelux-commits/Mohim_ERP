/**
 * SalesManagement.gs
 * ---------------------------------------------------------------------
 * POS only creates sales. Everything that happens to a sale afterward —
 * searching, viewing, receiving a due payment, duplicating, jumping into
 * a return — lives here. The original Sale / Sale Items rows are never
 * edited by anything in this file; Returns are linked records layered
 * on top (see SalesReturn.gs), so the original invoice stays intact.
 *
 * Phase 4 (permission wiring): getSalesManagementList/getSaleDetail
 * check 'sales':'view'; getSaleForUpdate/updateSale check 'sales':'edit'
 * (Update Mode loads into POS but the record being edited belongs to
 * the Sales module, so it's gated the same way regardless of which
 * screen — Sales page, POS Sales History, or Day Book — triggered it).
 *
 * P3 drift (items 5 & 7): removed the commented-out duplicate of
 * getSalesManagementList's return object (dead code sitting directly
 * below the live one), re-indented the live object to match the file,
 * and moved updateSale's bank-account lookup to resolveBankAccount_()
 * in Utils.gs.
 *
 * Phase 8 (bank wiring): getSalesManagementList's return shape is a
 * bare array the client already depends on (smState.sales = data), so
 * bank accounts for the Receive Due Payment modal's dropdown are
 * fetched via the small dedicated function below instead of folding
 * them into that call — gated on 'sales':'view' (already required to
 * reach this page) rather than 'bank':'view', so receiving a payment
 * here never needs separate Bank module access. updateSale() also now
 * reconciles the Bank side of a paid-amount change the same way it
 * already reconciled Cash — a delta when the bank account doesn't
 * change, a full reverse+reapply when it does (same reasoning as
 * updateExpense()'s Bank Book reconciliation).
 * ---------------------------------------------------------------------
 */

/** Active bank accounts for the Receive Due Payment dropdown on this page. */
function getSalesManagementBankAccounts(token) {
  try {
    requirePermission_(token, 'sales', 'view');
    return ok_(getActiveBankAccountsForUI_());
  } catch (err) {
    logError_('getSalesManagementBankAccounts', err);
    return fail_(err.message);
  }
}

/**
 * Profit is internal cost information. Reuse the two existing rights that
 * already authorize profit/cost visibility instead of exposing it to every
 * Sales viewer: Reports View (profit report) or POS Purchase Price View.
 */
function canViewInvoiceProfit_(user) {
  return hasPermission_(user, 'reports', 'view') || hasPermission_(user, 'posCost', 'view');
}

/**
 * Per-invoice gross profit using the exact same cost evidence as Reports.gs:
 *   net sale after returns - FIFO SALE_ITEM_LOTS cost - active vendor sourcing cost.
 *
 * SALE_ITEM_LOTS.Quantity is already net of returns because stock restoration
 * decrements the consumed-lot row. Vendor-sourced quantities are costed from
 * VENDOR_SOURCING. `costComplete` mirrors the Profit report's coverage check
 * so old/imported invoices with incomplete cost evidence are never presented
 * as unquestionably exact. Duplicate invoice IDs are deliberately excluded.
 */
function buildSalesInvoiceProfitMetrics_(sales, saleItems, returnItems, duplicateIds) {
  sales = sales || [];
  saleItems = saleItems || [];
  returnItems = returnItems || [];
  duplicateIds = duplicateIds || {};

  const inScope = {}, saleByInvoice = {};
  sales.forEach(function (s) {
    const id = String(s['Invoice ID'] || '');
    if (!id || duplicateIds[id]) return;
    inScope[id] = true;
    saleByInvoice[id] = s;
  });

  const soldQty = {}, returnedQty = {}, coveredQty = {}, returnedAmount = {}, costByInvoice = {};
  function addQty_(map, invoiceId, productId, qty) {
    if (!map[invoiceId]) map[invoiceId] = {};
    map[invoiceId][productId] = (map[invoiceId][productId] || 0) + (Number(qty) || 0);
  }

  saleItems.forEach(function (si) {
    const id = String(si['Invoice ID'] || '');
    if (!inScope[id]) return;
    addQty_(soldQty, id, String(si['Product ID'] || ''), Number(si['Quantity']) || 0);
  });

  returnItems.forEach(function (ri) {
    const id = String(ri['Invoice ID'] || '');
    if (!inScope[id]) return;
    addQty_(returnedQty, id, String(ri['Product ID'] || ''), Number(ri['Return Quantity']) || 0);
    const parent = saleByInvoice[id];
    returnedAmount[id] = roundMoney_((returnedAmount[id] || 0) +
      economicReturnLineAmount_(ri, parent['Subtotal'], parent['Grand Total']));
  });

  getAllRows_('SALE_ITEM_LOTS').forEach(function (lot) {
    const id = String(lot['Invoice ID'] || '');
    if (!inScope[id]) return;
    const qty = Number(lot['Quantity']) || 0;
    costByInvoice[id] = roundMoney_((costByInvoice[id] || 0) + qty * (Number(lot['Unit Cost']) || 0));
    addQty_(coveredQty, id, String(lot['Product ID'] || ''), qty);
  });

  activeRows_('VENDOR_SOURCING').forEach(function (v) {
    const id = String(v['Invoice ID'] || '');
    if (!inScope[id]) return;
    const qty = Number(v['Quantity']) || 0;
    const rawTotal = v['Total Cost'];
    const lineCost = rawTotal !== '' && rawTotal !== null && rawTotal !== undefined && isValidNonNegativeNumber_(rawTotal)
      ? Number(rawTotal)
      : qty * (Number(v['Unit Cost']) || 0);
    costByInvoice[id] = roundMoney_((costByInvoice[id] || 0) + lineCost);
    addQty_(coveredQty, id, String(v['Product ID'] || ''), qty);
  });

  const out = {};
  Object.keys(inScope).forEach(function (id) {
    const sale = saleByInvoice[id];
    const netSale = roundMoney_((Number(sale['Grand Total']) || 0) - (returnedAmount[id] || 0));
    const cogs = roundMoney_(costByInvoice[id] || 0);
    const required = soldQty[id] || {};
    const productIds = Object.keys(required);
    const costComplete = productIds.length > 0 && productIds.every(function (productId) {
      const netQty = Math.max(0, (Number(required[productId]) || 0) - (Number((returnedQty[id] || {})[productId]) || 0));
      const costQty = Number((coveredQty[id] || {})[productId]) || 0;
      return costQty + 0.0000001 >= netQty;
    });
    const profit = roundMoney_(netSale - cogs);
    out[id] = {
      profit: profit,
      profitMarginPercent: netSale > 0 ? (profit / netSale) * 100 : 0,
      costComplete: costComplete
    };
  });
  return out;
}

/** Every invoice, enriched with returned amount and a derived return status. Client does the search/filter. */
function getSalesManagementList(token) {
  try {
    const actingUser = requirePermission_(token, 'sales', 'view');
    const showProfit = canViewInvoiceProfit_(actingUser);
    const sales = activeRows_('SALES');
    const duplicateIds = duplicateSalesInvoiceIdMap_(sales);
    const saleItems = getAllRows_('SALE_ITEMS');
    const returnItems = activeSalesReturnItems_();
    const sessions = getAllRows_('CASH_SESSIONS');

    // Later customer payments live in CUSTOMER_LEDGER, not in the original
    // at-sale Paid/Due columns. Read that ledger once for this list and reuse
    // one reconstructed settlement state per customer so the Sales screen
    // stays current without an Apps Script sheet read per invoice.
    const needsSettlement = sales.some(function (s) {
      return !duplicateIds[s['Invoice ID']] && !!s['Customer ID'] && (Number(s['Due Amount']) || 0) > 0.004;
    });
    const settlementLedgerRows = needsSettlement ? getAllRows_('CUSTOMER_LEDGER') : [];
    const settlementReturnRows = needsSettlement ? activeRows_('SALES_RETURN') : [];
    const settlementRowsByCustomer = {};
    settlementLedgerRows.forEach(function (row) {
      const customerId = String(row['Customer ID'] || '');
      if (!customerId) return;
      if (!settlementRowsByCustomer[customerId]) settlementRowsByCustomer[customerId] = [];
      settlementRowsByCustomer[customerId].push(row);
    });
    const settlementStateByCustomer = {};
    const profitByInvoice = showProfit
      ? buildSalesInvoiceProfitMetrics_(sales, saleItems, returnItems, duplicateIds)
      : {};

    const soldByInvoice = {};      // invoiceId -> { productId: qty }
    saleItems.forEach(function (si) {
      const inv = si['Invoice ID'];
      if (!soldByInvoice[inv]) soldByInvoice[inv] = {};
      soldByInvoice[inv][si['Product ID']] = (soldByInvoice[inv][si['Product ID']] || 0) + (Number(si['Quantity']) || 0);
    });

    const saleByInvoice = {};
    sales.forEach(function (s) { saleByInvoice[s['Invoice ID']] = s; });

    const returnedByInvoice = {};  // invoiceId -> { amount, byProduct: {productId: qty} }
    returnItems.forEach(function (ri) {
      const inv = ri['Invoice ID'];
      if (duplicateIds[inv]) return; // child rows cannot be assigned safely to one of two headers
      const parent = saleByInvoice[inv];
      if (!parent) return;
      if (!returnedByInvoice[inv]) returnedByInvoice[inv] = { amount: 0, byProduct: {} };
      returnedByInvoice[inv].amount += economicReturnLineAmount_(ri, parent['Subtotal'], parent['Grand Total']);
      returnedByInvoice[inv].byProduct[ri['Product ID']] =
        (returnedByInvoice[inv].byProduct[ri['Product ID']] || 0) + (Number(ri['Return Quantity']) || 0);
    });

    const list = sales.map(function (s) {
      const invId = s['Invoice ID'];
      const duplicateInvoiceId = !!duplicateIds[invId];
      const sold = soldByInvoice[invId] || {};
      const returned = duplicateInvoiceId ? { amount: null, byProduct: {} } : (returnedByInvoice[invId] || { amount: 0, byProduct: {} });
      const productIds = Object.keys(sold);

      let returnStatus = duplicateInvoiceId ? 'Integrity Error' : 'No Return';
      if (!duplicateInvoiceId && productIds.length && returned.amount > 0) {
        const allFullyReturned = productIds.every(function (pid) { return (returned.byProduct[pid] || 0) >= sold[pid]; });
        returnStatus = allFullyReturned ? 'Fully Returned' : 'Partially Returned';
      }
      const session = findSessionForTimestamp_(sessions, s['Created At']);
      const editable = !duplicateInvoiceId && !returnedByInvoice[invId] && !!session && session['Status'] === 'Open';

      let settlement = null;
      const customerId = String(s['Customer ID'] || '');
      if (!duplicateInvoiceId && customerId && (Number(s['Due Amount']) || 0) > 0.004) {
        if (!settlementStateByCustomer[customerId]) {
          settlementStateByCustomer[customerId] = customerSettlementState_(customerId, {
            ledgerRows: settlementRowsByCustomer[customerId] || [],
            returnRows: settlementReturnRows
          });
        }
        const settlementState = settlementStateByCustomer[customerId];
        settlement = customerInvoiceSettlementSnapshotFromState_(s, settlementState);
      }

      const out = {
        invoiceId: invId, date: safeDateOnly_(s['Date']), time: safeTimeOnly_(s['Time']),
        customerId: s['Customer ID'], customerName: s['Customer Name'], customerPhone: s['Customer Phone'],
        grandTotal: Number(s['Grand Total']) || 0,
        paidAmount: settlement ? settlement.paidAmount : (Number(s['Paid Amount']) || 0),
        dueAmount: settlement ? settlement.dueAmount : (Number(s['Due Amount']) || 0),
        customerCreditUsed: settlement ? settlement.customerCreditUsed : 0,
        returnedAmount: returned.amount,
        netSale: duplicateInvoiceId ? null : (Number(s['Grand Total']) || 0) - returned.amount,
        paymentStatus: settlement ? settlement.paymentStatus : s['Payment Status'],
        returnStatus: returnStatus, editable: editable,
        duplicateInvoiceId: duplicateInvoiceId
      };
      if (showProfit && !duplicateInvoiceId && profitByInvoice[invId]) {
        out.profit = profitByInvoice[invId].profit;
        out.profitMarginPercent = profitByInvoice[invId].profitMarginPercent;
        out.profitCostComplete = profitByInvoice[invId].costComplete;
      }
      return out;
    }).sort(function (a, b) { return String(b.date + ' ' + b.time).localeCompare(String(a.date + ' ' + a.time)); });

    return ok_(list);
  } catch (err) {
    logError_('getSalesManagementList', err);
    return fail_(err.message);
  }
}

/** Full invoice for the View popup, with Returned Amount / Net Sale added on top of the base invoice. */
function getSaleDetail(token, invoiceId) {
  try {
    const actingUser = requirePermission_(token, 'sales', 'view');
    const inv = buildInvoicePayload_(invoiceId);
    const returnItems = activeSalesReturnItems_().filter(function (ri) { return ri['Invoice ID'] === invoiceId; });
    let totalReturned = 0;
    returnItems.forEach(function (ri) {
      totalReturned += economicReturnLineAmount_(ri, inv.subtotal, inv.grandTotal);
    });
    inv.returnedAmount = totalReturned;
    inv.netSale = Number(inv.grandTotal) - totalReturned;

    if (canViewInvoiceProfit_(actingUser)) {
      const sale = findUniqueSalesRow_(invoiceId);
      const saleItems = getAllRows_('SALE_ITEMS').filter(function (si) { return si['Invoice ID'] === invoiceId; });
      const profitMap = buildSalesInvoiceProfitMetrics_(sale ? [sale] : [], saleItems, returnItems, {});
      const metric = profitMap[invoiceId];
      if (metric) {
        inv.profit = metric.profit;
        inv.profitMarginPercent = metric.profitMarginPercent;
        inv.profitCostComplete = metric.costComplete;
      }
    }
    return ok_(inv);
  } catch (err) {
    logError_('getSaleDetail', err);
    return fail_(err.message);
  }
}
/** Preserves an existing exact auto-priced line total when an edit leaves quantity and visible unit price unchanged. */
function saleUpdateLineTotal_(oldItem, newQty, newUnitPrice) {
  const qty = Number(newQty) || 0;
  const unitPrice = Number(newUnitPrice) || 0;
  if (oldItem) {
    const oldQty = Number(oldItem['Quantity']) || 0;
    const oldUnitPrice = Number(oldItem['Unit Price']) || 0;
    const rawLineTotal = oldItem['Line Total'];
    if (Math.abs(oldQty - qty) < 1e-9 &&
        Math.abs(oldUnitPrice - unitPrice) < 1e-9 &&
        rawLineTotal !== '' && rawLineTotal !== null && rawLineTotal !== undefined &&
        isValidNonNegativeNumber_(rawLineTotal)) {
      return Number(rawLineTotal);
    }
  }
  return roundMoney_(qty * unitPrice);
}


/**
 * Reclassifies part of an existing sale's stock effect to Vendor/Consignment
 * sourcing. Unlike a customer return, an OVERSOLD bookkeeping lot is simply
 * neutralized toward zero because no physical unit came back into the shop.
 * Real FIFO lots are restored normally. SALE_ITEM_LOTS evidence is reduced
 * in lock-step so later delete/return operations cannot reverse it twice.
 */
function restoreSaleStockEffectForVendorSourcing_(invoiceId, productId, productName, qty, fallbackReference) {
  let need = Number(qty) || 0;
  if (need <= 0) return [];

  const consumedRows = getAllRows_('SALE_ITEM_LOTS')
    .filter(function (r) {
      return r['Invoice ID'] === invoiceId && r['Product ID'] === productId && (Number(r['Quantity']) || 0) > 0;
    })
    .sort(function (a, b) { return b._rowIndex - a._rowIndex; });

  const lotsById = {};
  getAllRows_('STOCK_LOTS').forEach(function (l) { lotsById[l['Lot ID']] = l; });
  const restored = [];

  for (let i = 0; i < consumedRows.length && need > 0; i++) {
    const row = consumedRows[i];
    const outstanding = Number(row['Quantity']) || 0;
    const give = Math.min(outstanding, need);
    if (give <= 0) continue;

    const lot = lotsById[row['Lot ID']];
    let remainingGive = give;
    if (lot && lot['Purchase ID'] === 'OVERSOLD') {
      const currentRemaining = Number(lot['Remaining Quantity']) || 0;
      const neutralize = Math.min(remainingGive, Math.max(0, -currentRemaining));
      if (neutralize > 0) {
        const nextRemaining = currentRemaining + neutralize;
        updateRowFields_('STOCK_LOTS', lot._rowIndex, {
          'Remaining Quantity': nextRemaining,
          'Status': nextRemaining < 0 ? 'Oversold' : 'Resolved'
        });
        lot['Remaining Quantity'] = nextRemaining;
        restored.push({ lotId: row['Lot ID'], qty: neutralize });
        remainingGive -= neutralize;
      }
    } else if (lot && lot['Purchase ID'] !== 'LEGACY') {
      const nextRemaining = (Number(lot['Remaining Quantity']) || 0) + remainingGive;
      updateRowFields_('STOCK_LOTS', lot._rowIndex, { 'Remaining Quantity': nextRemaining, 'Status': 'Active' });
      lot['Remaining Quantity'] = nextRemaining;
      restored.push({ lotId: row['Lot ID'], qty: remainingGive });
      remainingGive = 0;
    }

    if (remainingGive > 0) {
      const product = getAllRows_('PRODUCTS').filter(function (p) { return p['Product ID'] === productId; })[0];
      const price = product ? Number(product['Purchase Price']) || 0 : 0;
      const lotId = createLot_(productId, productName, fallbackReference || 'SOURCE-RECLASS', new Date(), price, remainingGive);
      restored.push({ lotId: lotId, qty: remainingGive });
    }

    updateRowFields_('SALE_ITEM_LOTS', row._rowIndex, { 'Quantity': outstanding - give });
    need -= give;
  }

  if (need > 0) {
    const product = getAllRows_('PRODUCTS').filter(function (p) { return p['Product ID'] === productId; })[0];
    const price = product ? Number(product['Purchase Price']) || 0 : 0;
    const lotId = createLot_(productId, productName, fallbackReference || 'SOURCE-RECLASS', new Date(), price, need);
    restored.push({ lotId: lotId, qty: need });
  }
  return restored;
}

/** Validates editability and returns everything POS needs to load an invoice into Update Mode. */
function getSaleForUpdate(token, invoiceId) {
  try {
    requirePermission_(token, 'sales', 'edit');
    const sale = findUniqueSalesRow_(invoiceId);
    if (!sale) return fail_('Invoice not found.');
    if (isDeleted_(sale)) return fail_('This invoice has been deleted.');

    const hasReturn = activeSalesReturnItems_().some(function (ri) { return ri['Invoice ID'] === invoiceId; });
    if (hasReturn) return fail_('This invoice has Sales Return records and can no longer be updated. Use Sales Return for further corrections.');

    const sessions = getAllRows_('CASH_SESSIONS');
    const session = findSessionForTimestamp_(sessions, sale['Created At']);
    if (!session || session['Status'] !== 'Open') {
      return fail_('This invoice belongs to a closed Cash Session and can no longer be edited. Please use Sales Return to make corrections.');
    }

    const items = getAllRows_('SALE_ITEMS').filter(function (i) { return i['Invoice ID'] === invoiceId; });

    const vendorByKey = {};
    getAllRows_('VENDOR_SOURCING').filter(function (v) {
      return v['Invoice ID'] === invoiceId && !isDeleted_(v);
    }).forEach(function (v) { vendorByKey[v['Product ID']] = v; });

    return ok_({
      invoiceId: sale['Invoice ID'], date: safeDateOnly_(sale['Date']), time: safeTimeOnly_(sale['Time']),
      customerId: sale['Customer ID'], customerName: sale['Customer Name'],
      customerPhone: sale['Customer Phone'], customerAddress: sale['Customer Address'],
      discount: Number(sale['Discount']) || 0, paidAmount: Number(sale['Paid Amount']) || 0,
      paymentMethod: sale['Payment Method'] || (Number(sale['Paid Amount']) > 0 ? 'Cash' : ''),
      bankAccountId: sale['Bank Account ID'] || '',
      items: items.map(function (i) {
        const v = vendorByKey[i['Product ID']];
        return {
          productId: i['Product ID'], name: i['Product Name'], qty: Number(i['Quantity']) || 0, unitPrice: Number(i['Unit Price']) || 0,
          lineTotal: (i['Line Total'] !== '' && i['Line Total'] !== null && i['Line Total'] !== undefined && isValidNonNegativeNumber_(i['Line Total']))
            ? Number(i['Line Total']) : roundMoney_((Number(i['Quantity']) || 0) * (Number(i['Unit Price']) || 0)),
          vendorId: v ? v['Vendor ID'] : '', vendorName: v ? v['Vendor Name'] : '',
          vendorUnitCost: v ? Number(v['Unit Cost']) || 0 : 0, vendorQty: v ? Number(v['Quantity']) || 0 : 0
        };
      })
    });
  } catch (err) {
    logError_('getSaleForUpdate', err);
    return fail_(err.message);
  }
}

/**
 * Overwrites an existing invoice in place: same Invoice ID/Date/Time, new
 * items/discount/payment/customer. Re-validates editability independently
 * of getSaleForUpdate (never trust a stale client-side check). Diffs old vs
 * new quantities per product to compute the minimum stock movement, rewrites
 * SALE_ITEMS, reconciles Cash Book (paid amount delta) and Customer Ledger
 * (due delta, reversed on the old customer / applied to the new one), and
 * logs the change to INVOICE_EDIT_LOG. This mutates the original invoice on
 * purpose — same deliberate, gated exception used by deleteSaleLineItem.
 */
function updateSale(token, invoiceId, payload) {
  return updateSaleInternal_(token, invoiceId, payload, { lockHeld: false });
}

function updateSaleInternal_(token, invoiceId, payload, options) {
  const opts = options || {};
  const lock = opts.lockHeld ? null : LockService.getScriptLock();
  if (lock) lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    const user = requirePermission_(token, 'sales', 'edit');
    requireActiveCashSession_();
    if (!payload.items || !payload.items.length) return fail_('Cart is empty.');
    if (!sanitizeInput_(payload.reason)) return fail_('Enter a reason for this update.');

    const sale = findUniqueSalesRow_(invoiceId);
    if (!sale) return fail_('Invoice not found.');
    if (isDeleted_(sale)) return fail_('This invoice has been deleted.');
    const originalDate = safeDateOnly_(sale['Date']);
    const editDate = originalDate;
    const dateChanged = editDate !== originalDate;
    

    const hasReturn = activeSalesReturnItems_().some(function (ri) { return ri['Invoice ID'] === invoiceId; });
    if (hasReturn) return fail_('This invoice has Sales Return records and can no longer be updated. Use Sales Return for further corrections.');

    
      const sessions = getAllRows_('CASH_SESSIONS');
      const session = findSessionForTimestamp_(sessions, sale['Created At']);
      if (!session || session['Status'] !== 'Open') {
        return fail_('This invoice belongs to a closed Cash Session and can no longer be edited. Please use Sales Return to make corrections.');
      }
    

    const nameInput = sanitizeInput_(payload.customerName);
    const phoneInput = sanitizeInput_(payload.customerPhone);
    if (!nameInput || !phoneInput) return fail_('Customer name and phone are required for every sale.');

    // Keyed by Product ID. A product can appear only once on an invoice.
    const oldItems = getAllRows_('SALE_ITEMS').filter(function (i) { return i['Invoice ID'] === invoiceId; });
    const oldQtyByKey = {};
    const oldItemByKey = {};
    oldItems.forEach(function (i) {
      const key = i['Product ID'];
      oldQtyByKey[key] = (oldQtyByKey[key] || 0) + (Number(i['Quantity']) || 0);
      if (!oldItemByKey[key]) oldItemByKey[key] = i;
    });

    // SALE_ITEM_LOTS is the immutable accounting evidence for how much of
    // each line actually touched this shop's stock. Vendor sourcing rows are
    // mutable from the Vendor ledger, so deriving old own-stock usage from
    // them can become stale before a later invoice edit.
    const oldConsumptionRows = getAllRows_('SALE_ITEM_LOTS').filter(function (l) {
      return l['Invoice ID'] === invoiceId;
    });
    const oldOwnQtyByKey = outstandingSaleOwnStockByProduct_(invoiceId, oldItems, [], oldConsumptionRows);

    const vendorsById = {};
    getAllRows_('VENDORS').forEach(function (v) { vendorsById[v['Vendor ID']] = v; });

    let subtotal = 0;
    const newQtyByKey = {};
    const newLineTotalByKey = {};
    const keyInfo = {}; // key -> { productId, name, vendorId, vendorUnitCost }
    payload.items.forEach(function (item, i) {
      const qty = Number(item.qty), price = Number(item.unitPrice);
      if (!isValidNonNegativeNumber_(qty) || qty <= 0) throw new Error('Line ' + (i + 1) + ': quantity must be greater than zero.');
      if (!isValidNonNegativeNumber_(price)) throw new Error('Line ' + (i + 1) + ': price must be a valid number.');
      const key = item.productId;
      if (newQtyByKey[key] !== undefined) throw new Error(item.name + ' appears more than once — combine it into one line.');
      newQtyByKey[key] = qty;
      const lineTotal = saleUpdateLineTotal_(oldItemByKey[key], qty, price);
      newLineTotalByKey[key] = lineTotal;
      keyInfo[key] = {
        productId: item.productId, name: item.name,
        shortageResolution: item.shortageResolution,
        vendorId: item.vendorId, vendorUnitCost: item.vendorUnitCost
      };
      subtotal = roundMoney_(subtotal + lineTotal);
    });

    const allKeys = {};
    Object.keys(oldQtyByKey).forEach(function (k) { allKeys[k] = true; });
    Object.keys(newQtyByKey).forEach(function (k) { allKeys[k] = true; });

    const allLots = getAllRows_('STOCK_LOTS');
    const planningLots = allLots;
    const productsById = {};
    getAllRows_('PRODUCTS').forEach(function (p) { productsById[p['Product ID']] = p; });

    // Existing active vendor sourcing on this invoice, keyed the same way —
    // at most one active row per key by construction (completeSale/
    // updateSale create ≤1 per line's whole shortfall, never split).
    const vendorRowByKey = {};
    getAllRows_('VENDOR_SOURCING').filter(function (v) {
      return v['Invoice ID'] === invoiceId && !isDeleted_(v);
    }).forEach(function (v) { vendorRowByKey[v['Product ID']] = v; });

    const stockChanges = [];
    const vendorReversals = []; // { vendorId, totalCost, rowIndex } — old vendor sourcing being undone
    const vendorCreations = []; // { productId, name, vendorId, vendorName, qty, unitCost, totalCost }
    const vendorReturnBySourcingId = {};
    activeRows_('VENDOR_RETURNS').forEach(function (r) {
      if (r['Sourcing ID']) vendorReturnBySourcingId[r['Sourcing ID']] = true;
    });

    function queueVendorReversal_(oldVendorRow, lineName) {
      if (!oldVendorRow) return;
      const sourcingId = oldVendorRow['Sourcing ID'];
      if (vendorReturnBySourcingId[sourcingId]) {
        throw new Error(lineName + ': this vendor sourcing already has a Vendor Return. Reverse that settlement before changing the sale sourcing.');
      }
      const vendorId = oldVendorRow['Vendor ID'];
      const vendor = vendorsById[vendorId];
      if (!vendor || isDeleted_(vendor)) throw new Error(lineName + ': the original vendor no longer exists.');
      const totalCost = Number(oldVendorRow['Total Cost']) || ((Number(oldVendorRow['Quantity']) || 0) * (Number(oldVendorRow['Unit Cost']) || 0));
      const currentDue = Number(vendor['Current Due']) || 0;
      if (currentDue + 0.0001 < totalCost) {
        throw new Error(lineName + ': the original vendor payable has already been settled or paid down. Reverse the vendor settlement before changing this sourcing.');
      }
      vendorReversals.push({
        vendorId: vendorId, totalCost: totalCost,
        rowIndex: oldVendorRow._rowIndex, sourcingId: sourcingId
      });
    }

    Object.keys(allKeys).forEach(function (key) {
      const oldQty = oldQtyByKey[key] || 0;
      const newQty = newQtyByKey[key] || 0;
      const totalDelta = newQty - oldQty;

      // A key present only in oldItems (line removed/reduced to zero) has
      // no keyInfo from the payload loop — recover the product
      // from the key itself and the original SALE_ITEMS row for the name.
      const info = keyInfo[key] || (function () {
        var oldRow = oldItems.filter(function (i) { return i['Product ID'] === key; })[0];
        return { productId: key, name: oldRow ? oldRow['Product Name'] : key };
      })();

      const product = productsById[info.productId];
      if (!product) throw new Error('A product on this invoice no longer exists.');

      const oldVendorRow = vendorRowByKey[key];
      const oldOwnQty = oldOwnQtyByKey[key] || 0;
      const requestedVendorId = info.vendorId ? sanitizeInput_(info.vendorId) : '';
      const explicitResolution = sanitizeInput_(info.shortageResolution).toLowerCase();
      const requestedResolution = explicitResolution === 'vendor' || explicitResolution === 'negative'
        ? explicitResolution
        : (requestedVendorId ? 'vendor' : (oldVendorRow ? 'vendor' : 'negative'));

      // Quantity can stay exactly the same while the economic source changes.
      // The old implementation returned here and therefore left vendor debt,
      // stock and OVERSOLD evidence untouched. Reconcile same-quantity source
      // changes explicitly; unchanged sourcing still remains a no-op.
      if (totalDelta === 0) {
        const currentStock = Number(product['Current Stock']) || 0;
        const oldVendorQty = oldVendorRow ? (Number(oldVendorRow['Quantity']) || 0) : 0;
        const oldVendorCost = oldVendorRow ? (Number(oldVendorRow['Unit Cost']) || 0) : 0;

        if (oldVendorRow && requestedResolution === 'vendor') {
          const effectiveVendorId = requestedVendorId || oldVendorRow['Vendor ID'];
          const hasSubmittedCost = info.vendorUnitCost !== '' && info.vendorUnitCost !== null && info.vendorUnitCost !== undefined;
          const effectiveVendorCost = hasSubmittedCost ? Number(info.vendorUnitCost) : oldVendorCost;
          const vendorIdentityChanged = effectiveVendorId !== oldVendorRow['Vendor ID'];
          const vendorCostChanged = Math.abs(effectiveVendorCost - oldVendorCost) > 0.0001;
          if (!vendorIdentityChanged && !vendorCostChanged) return;

          const newVendor = vendorsById[effectiveVendorId];
          if (!newVendor || isDeleted_(newVendor) || newVendor['Status'] === 'Inactive') {
            throw new Error(info.name + ': vendor not found or inactive.');
          }
          if (!isValidNonNegativeNumber_(effectiveVendorCost)) throw new Error(info.name + ': enter a valid vendor unit cost.');
          queueVendorReversal_(oldVendorRow, info.name);
          if (oldVendorQty > 0) {
            vendorCreations.push({
              productId: info.productId, name: product['Product Name'],
              vendorId: effectiveVendorId, vendorName: newVendor['Vendor Name'],
              qty: oldVendorQty, unitCost: effectiveVendorCost, totalCost: oldVendorQty * effectiveVendorCost
            });
          }
          return;
        }

        if (oldVendorRow && requestedResolution === 'negative') {
          queueVendorReversal_(oldVendorRow, info.name);
          if (oldVendorQty > 0) {
            const plan = planStockConsumption_(info.productId, oldVendorQty, planningLots, product);
            stockChanges.push({
              productId: info.productId, name: product['Product Name'], rowIndex: product._rowIndex,
              delta: oldVendorQty, newStock: currentStock - oldVendorQty, plan: plan
            });
          }
          return;
        }

        if (!oldVendorRow && requestedResolution === 'vendor') {
          if (!requestedVendorId) throw new Error(info.name + ': choose a vendor for the shortage.');
          const newVendor = vendorsById[requestedVendorId];
          if (!newVendor || isDeleted_(newVendor) || newVendor['Status'] === 'Inactive') {
            throw new Error(info.name + ': vendor not found or inactive.');
          }
          const vendorUnitCost = Number(info.vendorUnitCost);
          if (!isValidNonNegativeNumber_(vendorUnitCost)) throw new Error(info.name + ': enter a valid vendor unit cost.');

          // Releasing this invoice's existing stock effect tells us how much
          // of the unchanged quantity is genuinely short and can move to the
          // vendor. Clamp at zero so unrelated negative stock cannot source
          // more units than this sale line actually contains.
          const availableIfReleased = Math.max(0, currentStock + oldOwnQty);
          const vendorQty = Math.min(newQty, Math.max(0, newQty - availableIfReleased));
          if (vendorQty <= 0) throw new Error(info.name + ': there is no shortage on this line to source from a vendor.');

          vendorCreations.push({
            productId: info.productId, name: product['Product Name'],
            vendorId: requestedVendorId, vendorName: newVendor['Vendor Name'],
            qty: vendorQty, unitCost: vendorUnitCost, totalCost: vendorQty * vendorUnitCost
          });
          stockChanges.push({
            productId: info.productId, name: product['Product Name'], rowIndex: product._rowIndex,
            delta: -vendorQty, newStock: currentStock + vendorQty, plan: null, restoreForVendorSourcing: true
          });
          return;
        }

        return; // quantity and sourcing are both unchanged
      }

      // Any currently-active vendor sourcing on this key is reversed in FULL
      // whenever quantity changes, then a fresh arrangement (if needed) is
      // computed below. The old stock effect comes from SALE_ITEM_LOTS, never
      // from the mutable vendor sourcing quantity.
      if (oldVendorRow) queueVendorReversal_(oldVendorRow, info.name);

      // How much MORE (or less) real stock this edit needs, relative to
      // what was already really consumed — never re-claims oldOwnQty from
      // lots that are already booked against it.
      const lotDelta = newQty - oldOwnQty;

      let plan = null;
      let newVendorQty = 0, newVendorUnitCost = 0, newVendorTotalCost = 0, vendorRow = null;
      if (lotDelta > 0) {
        // Increasing real stock need — planned now (writes nothing), same as completeSale.
        plan = requestedVendorId
          ? planSaleVendorConsumption_(info.productId, lotDelta, planningLots, product)
          : planStockConsumption_(info.productId, lotDelta, planningLots, product);
        if (requestedVendorId) {
          if (plan.shortfall <= 0) throw new Error(info.name + ': there is no shortage on this line to source from a vendor.');
          vendorRow = vendorsById[requestedVendorId];
          if (!vendorRow || isDeleted_(vendorRow) || vendorRow['Status'] === 'Inactive') {
            throw new Error(info.name + ': vendor not found or inactive.');
          }
          newVendorUnitCost = Number(info.vendorUnitCost);
          if (!isValidNonNegativeNumber_(newVendorUnitCost)) throw new Error(info.name + ': enter a valid vendor unit cost.');
          newVendorQty = plan.shortfall; // the whole shortfall, never partial
          newVendorTotalCost = newVendorQty * newVendorUnitCost;
          plan.shortfall = 0; // neutralized — see completeSale in Sales.gs
        }
        // else: leave plan.shortfall as-is — becomes an OVERSOLD lot (Negative Stock Sale), same as completeSale's default
      } else if (requestedVendorId) {
        throw new Error(info.name + ': there is no shortage on this line to source from a vendor.');
      }

      if (newVendorQty > 0) {
        vendorCreations.push({
          productId: info.productId, name: product['Product Name'],
          vendorId: requestedVendorId, vendorName: vendorRow['Vendor Name'],
          qty: newVendorQty, unitCost: newVendorUnitCost, totalCost: newVendorTotalCost
        });
      }

      // Only the portion actually drawn from own/OVERSOLD lots moves Current
      // Stock. Vendor-sourced qty never touches it.
      const ownDelta = lotDelta - newVendorQty;
      const currentStock = Number(product['Current Stock']) || 0;
      const newStock = currentStock - ownDelta;

      stockChanges.push({
        productId: info.productId, name: product['Product Name'], rowIndex: product._rowIndex,
        delta: ownDelta, newStock: newStock, plan: (lotDelta > 0 ? plan : null)
      });
    });

    const discount = isValidNonNegativeNumber_(payload.discount) ? Number(payload.discount) : 0;
    const grandTotal = Math.max(0, subtotal - discount);

    let paidAmount, dueAmount;
    const paymentType = payload.paymentType;
    if (paymentType === 'Cash') {
      paidAmount = grandTotal; dueAmount = 0;
    } else if (paymentType === 'Due') {
      paidAmount = 0; dueAmount = grandTotal;
    } else if (paymentType === 'Partial') {
      paidAmount = isValidNonNegativeNumber_(payload.paidAmount) ? Number(payload.paidAmount) : 0;
      if (paidAmount <= 0 || paidAmount >= grandTotal) throw new Error('Partial payment must be more than 0 and less than the grand total.');
      dueAmount = grandTotal - paidAmount;
    } else {
      throw new Error('Choose a payment type.');
    }
    const paymentStatus = dueAmount <= 0 ? 'Paid' : (paidAmount > 0 ? 'Partial' : 'Due');

    const paymentMethod = paidAmount > 0 ? (payload.paymentMethod || 'Cash') : '';
    const bankAccount = resolveBankAccount_(paymentMethod, payload.bankAccountId);
    const bankAccountId = bankAccount.id, bankAccountName = bankAccount.name;

    const oldPaidAmount = Number(sale['Paid Amount']) || 0;
    const oldDueAmount = Number(sale['Due Amount']) || 0;
    const oldCustomerId = sanitizeInput_(sale['Customer ID']);
    const oldGrandTotal = Number(sale['Grand Total']) || 0;
    const oldPaymentMethod = sale['Payment Method'] || (oldPaidAmount > 0 ? 'Cash' : '');
    const oldBankAccountId = isBankLikePaymentMethod_(oldPaymentMethod) ? sale['Bank Account ID'] : '';

    const cashOldAmount = oldPaymentMethod === 'Cash' ? oldPaidAmount : 0;
    const cashNewAmount = paymentMethod === 'Cash' ? paidAmount : 0;
    const cashDelta = cashNewAmount - cashOldAmount;
    let newCustomerId = '';
    let customerNameForSale = nameInput;
    let customerPhoneForSale = phoneInput;
    if (dueAmount > 0) {
      const preferredCustomerId = sanitizeInput_(payload.customerId);
      if (preferredCustomerId) {
        // Invoice correction may intentionally move an old sale to another
        // existing customer. Use the selected customer's canonical phone for
        // the shared identity resolver so a stale phone snapshot from the old
        // invoice cannot block the correction. New sales/drafts still pass the
        // entered phone directly and retain the strict mismatch guard.
        const selectedCustomer = getAllRows_('CUSTOMERS').filter(function (c) {
          return String(c['Customer ID'] || '') === preferredCustomerId;
        })[0];
        const canonicalPhone = selectedCustomer ? normalizePhoneDisplay_(selectedCustomer['Phone']) : phoneInput;
        newCustomerId = resolveOrCreateCustomer_(
          nameInput,
          canonicalPhone,
          sanitizeInput_(payload.customerAddress),
          sanitizeInput_(payload.customerFatherName),
          sanitizeInput_(payload.customerId)
        );
        if (selectedCustomer) {
          customerNameForSale = sanitizeInput_(selectedCustomer['Customer Name']) || nameInput;
          customerPhoneForSale = canonicalPhone;
        }
      } else {
        newCustomerId = resolveOrCreateCustomer_(nameInput, phoneInput, sanitizeInput_(payload.customerAddress), sanitizeInput_(payload.customerFatherName), '');
      }
    }

    // ---- validation passed — write everything ----
    const now = new Date();

    // Seed missing pre-lot evidence once before applying a legacy edit. The
    // blank Lot ID uses the existing restoration fallback, and preserves the
    // original own-stock quantity across subsequent increases/reductions.
    stockChanges.forEach(function (c) {
      const oldOwnQty = oldOwnQtyByKey[c.productId] || 0;
      if (oldOwnQty <= 0 || oldConsumptionRows.some(function (l) { return l['Product ID'] === c.productId; })) return;
      appendRow_('SALE_ITEM_LOTS', {
        'Invoice ID': invoiceId, 'Product ID': c.productId, 'Lot ID': '',
        'Quantity': oldOwnQty, 'Unit Cost': Number(productsById[c.productId]['Purchase Price']) || 0,
        'Created At': now
      });
    });

    const oldRowIndexes = oldItems.map(function (i) { return i._rowIndex; }).sort(function (a, b) { return b - a; });
    oldRowIndexes.forEach(function (rowIndex) { deleteRow_('SALE_ITEMS', rowIndex); });
    appendRows_('SALE_ITEMS', payload.items.map(function (item) {
      const qty = Number(item.qty), price = Number(item.unitPrice);
      return {
        'Invoice ID': invoiceId, 'Product ID': item.productId, 'Product Name': item.name,
        'Quantity': qty, 'Unit Price': price, 'Line Total': newLineTotalByKey[item.productId]
      };
    }));

    stockChanges.forEach(function (c) {
      updateRowFields_('PRODUCTS', c.rowIndex, { 'Current Stock': c.newStock, 'Updated At': now });

      if (c.delta > 0) {
        // The plan was decided during validation; this only writes it —
        // same split as completeSale, so a shortfall can never surface
        // after SALE_ITEMS has already been rewritten.
        const consumption = applyStockConsumption_(c.plan);
        consumption.forEach(function (cons) {
          appendRow_('STOCK_MOVEMENT', {
            'Movement ID': generateId_('STOCK_MOVEMENT'), 'Date': now, 'Product ID': c.productId,
            'Product Name': c.name, 'Type': 'Sale Update', 'Reference': invoiceId,
            'Quantity In': '', 'Quantity Out': cons.qty, 'Balance Stock': c.newStock, 'Notes': 'Invoice updated', 'Lot ID': cons.lotId
          });
          appendRow_('SALE_ITEM_LOTS', {
            'Invoice ID': invoiceId, 'Product ID': c.productId, 'Lot ID': cons.lotId,
            'Quantity': cons.qty, 'Unit Cost': cons.unitCost, 'Unit Sell Price': cons.unitSellPrice, 'Created At': now
          });
        });
      } else {
        const restored = c.restoreForVendorSourcing
          ? restoreSaleStockEffectForVendorSourcing_(invoiceId, c.productId, c.name, Math.abs(c.delta), invoiceId + '-SOURCE-RECLASS')
          : restoreStockToLots_(invoiceId, c.productId, c.name, Math.abs(c.delta), invoiceId + '-UPDATE');
        restored.forEach(function (r) {
          appendRow_('STOCK_MOVEMENT', {
            'Movement ID': generateId_('STOCK_MOVEMENT'), 'Date': now, 'Product ID': c.productId,
            'Product Name': c.name, 'Type': 'Sale Update', 'Reference': invoiceId,
            'Quantity In': r.qty, 'Quantity Out': '', 'Balance Stock': c.newStock, 'Notes': 'Invoice updated', 'Lot ID': r.lotId
          });
        });
      }
    });

    // Vendor/Consignment Sourcing: reverse any old arrangement a changed
    // line carried, then post any freshly-decided one — reverse-then-
    // reapply, never a partial diff (see the per-key loop above). Both the
    // VENDOR_SOURCING detail row and its matching VENDOR_LEDGER 'Sourcing'
    // entry (found via Reference = Sourcing ID) are kept in step.
    vendorReversals.forEach(function (v) {
      adjustVendorDue_(v.vendorId, -v.totalCost);
      markRowDeleted_('VENDOR_SOURCING', v.rowIndex, user, sanitizeInput_(payload.reason), now);
      markMatchingDeleted_('VENDOR_LEDGER', function (l) {
        return l['Reference'] === v.sourcingId && l['Type'] === 'Sourcing';
      }, user, sanitizeInput_(payload.reason), now);
    });
    vendorCreations.forEach(function (v) {
      const sourcingId = generateId_('VENDOR_SOURCING');
      appendRow_('VENDOR_SOURCING', {
        'Sourcing ID': sourcingId, 'Date': editDate, 'Invoice ID': invoiceId,
        'Product ID': v.productId, 'Product Name': v.name,
        'Vendor ID': v.vendorId, 'Vendor Name': v.vendorName,
        'Quantity': v.qty, 'Unit Cost': v.unitCost, 'Total Cost': v.totalCost,
        'Created By': actorName_(user), 'Created At': now
      });
      postVendorLedgerEntry_({
        vendorId: v.vendorId, vendorName: v.vendorName, date: editDate, type: 'Sourcing',
        reference: sourcingId, debit: v.totalCost,
        notes: 'Sourced ' + v.qty + ' x ' + v.name + ' for Invoice ' + invoiceId + ' (edited)',
        createdBy: actorName_(user)
      });
    });

    const editBackdate = computeBackdateInfo_(editDate);
    updateRowFields_('SALES', findRowIndex_('SALES', 'Invoice ID', invoiceId), {
      'Date': editDate,
      'Is Backdated': editBackdate.isBackdated, 'Backdated Days': editBackdate.backdatedDays,
      'Backdated Reason': sale['Backdated Reason'] || '',
      'Customer ID': newCustomerId, 'Customer Name': customerNameForSale, 'Customer Phone': customerPhoneForSale,
      'Customer Address': sanitizeInput_(payload.customerAddress),
      'Subtotal': subtotal, 'Discount': discount, 'Grand Total': grandTotal,
      'Paid Amount': paidAmount, 'Due Amount': dueAmount, 'Payment Type': paymentType,
      'Payment Status': paymentStatus,
      'Payment Method': paymentMethod, 'Bank Account ID': bankAccountId, 'Bank Account Name': bankAccountName
    });

    const bankOldAmount = isBankLikePaymentMethod_(oldPaymentMethod) ? oldPaidAmount : 0;
    const bankNewAmount = isBankLikePaymentMethod_(paymentMethod) ? paidAmount : 0;
    
      if (cashDelta > 0) {
        addCashBookEntry_({ Type: 'Sale Update', Reference: invoiceId, Description: 'Additional payment from invoice update ' + invoiceId, Debit: '', Credit: cashDelta, PaymentMethod: 'Cash', Date: editDate });
      } else if (cashDelta < 0) {
        addCashBookEntry_({ Type: 'Sale Update', Reference: invoiceId, Description: 'Refund from invoice update ' + invoiceId, Debit: Math.abs(cashDelta), Credit: '', PaymentMethod: 'Cash', Date: editDate });
      }
      if (oldBankAccountId && oldBankAccountId === bankAccountId) {
        const bankDelta = bankNewAmount - bankOldAmount;
        if (bankDelta > 0) {
          addBankBookEntry_(bankAccountId, { Type: 'Sale Update', Reference: invoiceId, Description: 'Additional payment from invoice update ' + invoiceId, Debit: '', Credit: bankDelta, Date: editDate });
        } else if (bankDelta < 0) {
          addBankBookEntry_(bankAccountId, { Type: 'Sale Update', Reference: invoiceId, Description: 'Refund from invoice update ' + invoiceId, Debit: Math.abs(bankDelta), Credit: '', Date: editDate });
        }
      } else {
        if (oldBankAccountId) addBankBookEntry_(oldBankAccountId, { Type: 'Sale Update', Reference: invoiceId, Description: 'Refund from invoice update ' + invoiceId, Debit: bankOldAmount, Credit: '', Date: editDate });
        if (bankAccountId && bankNewAmount > 0) addBankBookEntry_(bankAccountId, { Type: 'Sale Update', Reference: invoiceId, Description: 'Additional payment from invoice update ' + invoiceId, Debit: '', Credit: bankNewAmount, Date: editDate });
      }
    

    if (oldCustomerId && oldDueAmount > 0) {
      const oldCustRowIndex = findRowIndex_('CUSTOMERS', 'Customer ID', oldCustomerId);
      if (oldCustRowIndex !== -1) {
        const oldCustRow = getAllRows_('CUSTOMERS').filter(function (c) { return c['Customer ID'] === oldCustomerId; })[0];
        const revertedDue = (Number(oldCustRow['Current Due']) || 0) - oldDueAmount;
        updateRowFields_('CUSTOMERS', oldCustRowIndex, { 'Current Due': revertedDue });
        appendRow_('CUSTOMER_LEDGER', {
          'Ledger ID': generateId_('CUSTOMER_LEDGER'), 'Date': dateChanged ? originalDate : editDate, 'Customer ID': oldCustomerId,
          'Customer Name': oldCustRow['Customer Name'], 'Type': 'Sale Update Credit', 'Reference': invoiceId,
          'Debit': '', 'Credit': oldDueAmount, 'Balance': revertedDue, 'Notes': 'Invoice updated — previous due reversed',
          'Created By': actorName_(user), 'Created At': now
        });
      }
    }
    if (newCustomerId && dueAmount > 0) {
      const newCustRowIndex = findRowIndex_('CUSTOMERS', 'Customer ID', newCustomerId);
      const newCustRow = getAllRows_('CUSTOMERS').filter(function (c) { return c['Customer ID'] === newCustomerId; })[0];
      const appliedDue = (Number(newCustRow['Current Due']) || 0) + dueAmount;
      updateRowFields_('CUSTOMERS', newCustRowIndex, { 'Current Due': appliedDue });
      appendRow_('CUSTOMER_LEDGER', {
        'Ledger ID': generateId_('CUSTOMER_LEDGER'), 'Date': editDate, 'Customer ID': newCustomerId,
        'Customer Name': newCustRow['Customer Name'], 'Type': 'Sale Update Debit', 'Reference': invoiceId,
        'Debit': dueAmount, 'Credit': '', 'Balance': appliedDue, 'Notes': 'Invoice updated — new due applied',
        'Created By': actorName_(user), 'Created At': now
      });
    }

    appendRow_('INVOICE_EDIT_LOG', {
      'Log ID': generateId_('INVOICE_EDIT_LOG'), 'Invoice ID': invoiceId, 'Edit Date': now,
      'Reason': sanitizeInput_(payload.reason), 'Before Grand Total': oldGrandTotal, 'After Grand Total': grandTotal
    });

    return ok_(buildInvoicePayload_(invoiceId));
  } catch (err) {
    logError_('updateSale', err);
    return fail_(err.message);
  } finally {
    if (lock) lock.releaseLock();
  }
}
