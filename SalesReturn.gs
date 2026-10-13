/**
 * SalesReturn.gs
 * ---------------------------------------------------------------------
 * A return is never edited into the original invoice — it's a separate,
 * linked Sales Return record (header in SALES_RETURN, lines in
 * SALES_RETURN_ITEMS), so Available Qty = Sold Qty − everything already
 * returned across every prior return on that invoice. Server re-checks
 * that math on every submit; the client's numbers are a UI convenience,
 * never trusted for the actual write.
 *
 * Phase 5 (permission wiring): every function here now requires a
 * session token and checks requirePermission_ against the 'returns'
 * module before doing anything.
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
 * from a raw Date object, same as Purchase.gs's fix, for consistency
 * with every other backdatable module. The existing 'Reason' field is
 * unrelated (why the customer returned the item) — 'Backdated Reason'
 * is a separate new column. Every sub-write this function triggers
 * (Stock Movement, Cash Book, Customer Ledger) keeps stamping the real
 * 'now', unchanged — only the Return's own header row date moves.
 * ---------------------------------------------------------------------
 */

/** Exact gross line value for sale-return economics. New automatic
 * lot-priced sales can intentionally have a rounded visible Unit Price whose
 * Quantity x Unit Price differs by one paisa from the exact stored Line Total.
 * Legacy rows with no Line Total fall back to the old multiplication rule.
 */
function grossSaleItemLineTotal_(saleItem) {
  const raw = saleItem ? saleItem['Line Total'] : '';
  if (raw !== '' && raw !== null && raw !== undefined && isValidNonNegativeNumber_(raw)) {
    return Number(raw);
  }
  return (Number(saleItem['Quantity']) || 0) * (Number(saleItem['Unit Price']) || 0);
}

/**
 * Normalizes a requested return price and enforces the invoice's effective
 * per-unit sale price as the hard upper bound. Missing price preserves the
 * pre-editable-price behavior for a stale/open browser tab during deployment.
 */
function salesReturnRequestedUnitPrice_(requestedPrice, effectiveUnitPrice, productName) {
  const maxPrice = roundMoney_(effectiveUnitPrice);
  if (requestedPrice === undefined || requestedPrice === null || requestedPrice === '') return maxPrice;

  const numericPrice = Number(requestedPrice);
  if (!isFinite(numericPrice) || numericPrice < 0) {
    throw new Error((productName || 'Product') + ': return price must be zero or greater.');
  }

  const price = roundMoney_(numericPrice);
  if (price > maxPrice) {
    throw new Error(
      (productName || 'Product') + ': return price cannot exceed original sale price of ' + maxPrice + '.'
    );
  }
  return price;
}


/** Remaining amount that may be paid out as cash for this invoice. A cash
 * refund may never exceed actual money collected for this invoice: money paid
 * at the sale plus later customer payments attributed by CustomerSettlement,
 * less prior cash refunds for the same invoice. */
function salesReturnCashRefundAvailable_(invoiceId, paidAmount) {
  const collectedCash = typeof customerInvoiceCashCollected_ === 'function'
    ? customerInvoiceCashCollected_(invoiceId)
    : roundMoney_(Number(paidAmount) || 0);
  const priorCashRefunds = activeRows_('SALES_RETURN')
    .filter(function (r) {
      return r['Invoice ID'] === invoiceId && r['Refund Method'] === 'Cash';
    })
    .reduce(function (sum, r) { return sum + (Number(r['Total Return Amount']) || 0); }, 0);
  return Math.max(0, roundMoney_(collectedCash - priorCashRefunds));
}

function searchInvoicesForReturn(token, query) {
  try {
    requirePermission_(token, 'returns', 'view');
    const q = sanitizeInput_(query).toLowerCase();
    if (!q) return fail_('Type an invoice ID or a phone number.');

    const activeSales = activeRows_('SALES');
    const duplicateInvoiceIds = duplicateSalesInvoiceIdMap_(activeSales);
    const matches = activeSales
      .filter(function (s) {
        return String(s['Invoice ID']).toLowerCase().indexOf(q) !== -1 ||
          phoneMatchesSearch_(s['Customer Phone'], q);
      })
      .sort(function (a, b) { return String(b['Created At']).localeCompare(String(a['Created At'])); });

    const limited = matches.slice(0, 20);
    const needsSettlement = limited.some(function (s) {
      return String(s['Customer ID'] || '') && (Number(s['Due Amount']) || 0) > 0.004;
    });
    const settlementReturnRows = needsSettlement ? activeRows_('SALES_RETURN') : [];
    const ledgerByCustomer = {};
    if (needsSettlement) {
      getAllRows_('CUSTOMER_LEDGER').forEach(function (row) {
        const customerId = String(row['Customer ID'] || '');
        if (!ledgerByCustomer[customerId]) ledgerByCustomer[customerId] = [];
        ledgerByCustomer[customerId].push(row);
      });
    }
    const stateByCustomer = {};

    return ok_(limited.map(function (s) {
      const invoiceId = String(s['Invoice ID'] || '');
      const customerId = String(s['Customer ID'] || '');
      let paymentStatus = s['Payment Status'];
      if (customerId && (Number(s['Due Amount']) || 0) > 0.004 &&
          typeof customerSettlementState_ === 'function' &&
          typeof customerInvoiceSettlementSnapshotFromState_ === 'function') {
        if (!stateByCustomer[customerId]) {
          stateByCustomer[customerId] = customerSettlementState_(customerId, {
            ledgerRows: ledgerByCustomer[customerId] || [],
            returnRows: settlementReturnRows
          });
        }
        const settlement = customerInvoiceSettlementSnapshotFromState_(s, stateByCustomer[customerId]);
        if (settlement) paymentStatus = settlement.paymentStatus;
      }
      return {
        invoiceId: invoiceId, date: safeDateOnly_(s['Date']), customerId: customerId, customerName: s['Customer Name'],
        customerPhone: s['Customer Phone'], grandTotal: s['Grand Total'], paymentStatus: paymentStatus,
        duplicateInvoiceId: duplicateInvoiceIds[invoiceId] === true
      };
    }));
  } catch (err) {
    logError_('searchInvoicesForReturn', err);
    return fail_(err.message);
  }
}

/** Customer-first search for the multi-invoice return workflow. */
function searchCustomersForReturn(token, query) {
  try {
    requirePermission_(token, 'returns', 'view');
    const q = sanitizeInput_(query).toLowerCase();
    if (!q) return fail_('Type a customer name, phone number, or customer ID.');

    const matches = activeRows_('CUSTOMERS')
      .filter(function (c) {
        return String(c['Customer ID'] || '').toLowerCase().indexOf(q) !== -1 ||
          String(c['Customer Name'] || '').toLowerCase().indexOf(q) !== -1 ||
          phoneMatchesSearch_(c['Phone'], q);
      })
      .sort(function (a, b) {
        const byName = String(a['Customer Name'] || '').localeCompare(String(b['Customer Name'] || ''));
        return byName || String(a['Customer ID'] || '').localeCompare(String(b['Customer ID'] || ''));
      })
      .slice(0, 30)
      .map(function (c) {
        return {
          customerId: c['Customer ID'],
          customerName: c['Customer Name'],
          phone: c['Phone'] || '',
          address: c['Address'] || '',
          currentDue: Number(c['Current Due']) || 0,
          status: c['Status'] || 'Active'
        };
      });

    return ok_(matches);
  } catch (err) {
    logError_('searchCustomersForReturn', err);
    return fail_(err.message);
  }
}

/**
 * Sales-style invoice list for one exact Customer ID. This endpoint is scoped
 * to returns:view so a returns operator does not also need broad sales:view.
 */
function getCustomerInvoicesForReturn(token, customerId) {
  try {
    requirePermission_(token, 'returns', 'view');
    const id = sanitizeInput_(customerId);
    if (!id) return fail_('Select a customer.');

    const customer = activeRows_('CUSTOMERS').filter(function (c) {
      return String(c['Customer ID'] || '') === id;
    })[0];
    if (!customer) return fail_('Customer not found.');

    const allSales = getAllRows_('SALES');
    const duplicateInvoiceIds = duplicateSalesInvoiceIdMap_(allSales);
    const sales = allSales.filter(function (s) {
      return !isDeleted_(s) && String(s['Customer ID'] || '') === id;
    });
    const invoiceIds = {};
    sales.forEach(function (s) { invoiceIds[String(s['Invoice ID'] || '')] = true; });

    const soldByInvoice = {};
    getAllRows_('SALE_ITEMS').forEach(function (si) {
      const invoiceId = String(si['Invoice ID'] || '');
      if (!invoiceIds[invoiceId]) return;
      if (!soldByInvoice[invoiceId]) soldByInvoice[invoiceId] = {};
      const productId = String(si['Product ID'] || '');
      soldByInvoice[invoiceId][productId] = (soldByInvoice[invoiceId][productId] || 0) + (Number(si['Quantity']) || 0);
    });

    const saleByInvoice = {};
    sales.forEach(function (sale) { saleByInvoice[String(sale['Invoice ID'] || '')] = sale; });
    const returnedByInvoice = {};
    activeSalesReturnItems_().forEach(function (ri) {
      const invoiceId = String(ri['Invoice ID'] || '');
      if (!invoiceIds[invoiceId] || duplicateInvoiceIds[invoiceId]) return;
      const parent = saleByInvoice[invoiceId];
      if (!parent) return;
      if (!returnedByInvoice[invoiceId]) returnedByInvoice[invoiceId] = { amount: 0, byProduct: {} };
      returnedByInvoice[invoiceId].amount = roundMoney_(
        returnedByInvoice[invoiceId].amount + economicReturnLineAmount_(ri, parent['Subtotal'], parent['Grand Total'])
      );
      const productId = String(ri['Product ID'] || '');
      returnedByInvoice[invoiceId].byProduct[productId] =
        (returnedByInvoice[invoiceId].byProduct[productId] || 0) + (Number(ri['Return Quantity']) || 0);
    });

    const needsSettlement = sales.some(function (s) { return (Number(s['Due Amount']) || 0) > 0.004; });
    const settlementState = needsSettlement && typeof customerSettlementState_ === 'function'
      ? customerSettlementState_(id)
      : null;

    const list = sales.map(function (s) {
      const invoiceId = String(s['Invoice ID'] || '');
      const duplicateInvoiceId = duplicateInvoiceIds[invoiceId] === true;
      const sold = soldByInvoice[invoiceId] || {};
      const returned = duplicateInvoiceId ? { amount: null, byProduct: {} } :
        (returnedByInvoice[invoiceId] || { amount: 0, byProduct: {} });
      const productIds = Object.keys(sold);
      let returnStatus = duplicateInvoiceId ? 'Integrity Error' : 'No Return';
      if (!duplicateInvoiceId && productIds.length && returned.amount > 0) {
        const fullyReturned = productIds.every(function (productId) {
          return (returned.byProduct[productId] || 0) >= sold[productId];
        });
        returnStatus = fullyReturned ? 'Fully Returned' : 'Partially Returned';
      }

      const settlement = settlementState && typeof customerInvoiceSettlementSnapshotFromState_ === 'function'
        ? customerInvoiceSettlementSnapshotFromState_(s, settlementState)
        : null;
      const returnedAmount = duplicateInvoiceId ? null : roundMoney_(Number(returned.amount) || 0);
      return {
        invoiceId: invoiceId,
        date: safeDateOnly_(s['Date']),
        time: safeTimeOnly_(s['Time']),
        customerId: id,
        customerName: s['Customer Name'],
        customerPhone: s['Customer Phone'],
        grandTotal: Number(s['Grand Total']) || 0,
        paidAmount: settlement ? Number(settlement.paidAmount) || 0 : Number(s['Paid Amount']) || 0,
        dueAmount: settlement ? Number(settlement.dueAmount) || 0 : Number(s['Due Amount']) || 0,
        paymentStatus: settlement ? settlement.paymentStatus : s['Payment Status'],
        returnedAmount: returnedAmount,
        netSale: duplicateInvoiceId ? null : roundMoney_((Number(s['Grand Total']) || 0) - returnedAmount),
        returnStatus: returnStatus,
        duplicateInvoiceId: duplicateInvoiceId,
        selectable: !duplicateInvoiceId && returnStatus !== 'Fully Returned'
      };
    }).sort(function (a, b) {
      return String(b.date + ' ' + b.time).localeCompare(String(a.date + ' ' + a.time));
    });

    return ok_({
      customer: {
        customerId: customer['Customer ID'],
        customerName: customer['Customer Name'],
        phone: customer['Phone'] || '',
        address: customer['Address'] || '',
        currentDue: Number(customer['Current Due']) || 0,
        status: customer['Status'] || 'Active'
      },
      invoices: list
    });
  } catch (err) {
    logError_('getCustomerInvoicesForReturn', err);
    return fail_(err.message);
  }
}

/** Invoice + every line with Sold / Previously Returned / Available quantities, for the Return Cart. */
function getInvoiceForReturn(token, invoiceId) {
  try {
    requirePermission_(token, 'returns', 'view');
    const sale = findUniqueSalesRow_(invoiceId);
    if (!sale || isDeleted_(sale)) return fail_('Invoice not found or has been deleted.');

    const saleItems = getAllRows_('SALE_ITEMS').filter(function (i) { return i['Invoice ID'] === invoiceId; });
    const returnItems = activeSalesReturnItems_().filter(function (i) { return i['Invoice ID'] === invoiceId; });
    const subtotal = Number(sale['Subtotal']) || 0;
    const grandTotal = Number(sale['Grand Total']) || 0;

    const outstandingOwnQty = outstandingSaleOwnStockByProduct_(invoiceId, saleItems, returnItems);
    const bundleSnapshots = getSaleBundleSnapshot_(invoiceId, getAllRows_('SALE_BUNDLE_COMPONENTS'));

    const returnedByProduct = {};
    let previouslyReturnedAmount = 0;
    returnItems.forEach(function (ri) {
      const key = ri['Product ID'];
      returnedByProduct[key] = (returnedByProduct[key] || 0) + (Number(ri['Return Quantity']) || 0);
      previouslyReturnedAmount += economicReturnLineAmount_(ri, subtotal, grandTotal);
    });

    const soldByProduct = {};
    saleItems.forEach(function (si) {
      const key = si['Product ID'];
      if (!soldByProduct[key]) {
        soldByProduct[key] = {
          productId: si['Product ID'], name: si['Product Name'],
          unitPrice: Number(si['Unit Price']) || 0, soldQty: 0, grossValue: 0
        };
      }
      const qty = Number(si['Quantity']) || 0;
      soldByProduct[key].soldQty += qty;
      soldByProduct[key].grossValue += grossSaleItemLineTotal_(si);
    });

    const items = Object.keys(soldByProduct).map(function (key) {
      const si = soldByProduct[key];
      const already = returnedByProduct[key] || 0;
      const available = bundleSnapshots[key]
        ? Math.max(0, si.soldQty - already)
        : Math.min(Math.max(0, si.soldQty - already), outstandingOwnQty[key] || 0);
      const vendorSourced = Math.max(0, si.soldQty - already - available);
      const grossUnitPrice = si.soldQty > 0 ? si.grossValue / si.soldQty : si.unitPrice;
      const effectiveUnitPrice = effectiveTransactionUnitPrice_(grossUnitPrice, subtotal, grandTotal);
      return {
        productId: si.productId, name: si.name, unitPrice: roundMoney_(effectiveUnitPrice),
        soldQty: si.soldQty, vendorSourcedQty: vendorSourced,
        previouslyReturnedQty: already,
        availableQty: available
      };
    });
    const settlement = typeof customerInvoiceSettlementSnapshot_ === 'function'
      ? customerInvoiceSettlementSnapshot_(sale['Invoice ID'])
      : null;
    const paidAmount = settlement ? Number(settlement.paidAmount) || 0 : Number(sale['Paid Amount']) || 0;
    const dueAmount = settlement ? Number(settlement.dueAmount) || 0 : Number(sale['Due Amount']) || 0;
    return ok_({
      invoiceId: sale['Invoice ID'], date: safeDateOnly_(sale['Date']), customerId: sale['Customer ID'],
      customerName: sale['Customer Name'], customerPhone: sale['Customer Phone'], customerAddress: sale['Customer Address'],
      grandTotal: grandTotal, paidAmount: paidAmount,
      dueAmount: dueAmount, previouslyReturnedAmount: previouslyReturnedAmount,
      netSale: grandTotal - previouslyReturnedAmount,
      cashRefundAvailable: salesReturnCashRefundAvailable_(sale['Invoice ID'], paidAmount),
      items: items
    });
  } catch (err) {
    logError_('getInvoiceForReturn', err);
    return fail_(err.message);
  }
}

/** Return date must preserve document chronology. */
function assertSalesReturnDateNotBeforeSale_(returnDateStr, sale) {
  const saleDate = safeDateOnly_(sale && sale['Date']);
  if (saleDate && returnDateStr < saleDate) {
    throw new Error('Return date cannot be before invoice date ' + saleDate + '.');
  }
}

/**
 * Read-only preparation for one Sales Return. All rejectable business rules
 * belong here so callers can validate a whole batch before the first write.
 * options may provide pre-read/indexed rows and shared virtual stock state.
 */
function prepareSalesReturn_(payload, options) {
  const opts = options || {};
  if (!payload || !payload.invoiceId) throw new Error('No invoice selected.');
  if (!payload.items || !payload.items.length) throw new Error('Select at least one product to return.');
  if (payload.refundMethod !== 'Cash' && payload.refundMethod !== 'Store Credit') throw new Error('Choose a refund method.');

  const txDate = opts.txDate;
  if (!txDate || !txDate.dateStr) throw new Error('Return date was not resolved.');
  const dateStr = txDate.dateStr;

  const sale = opts.sale || findUniqueSalesRow_(payload.invoiceId);
  if (!sale || isDeleted_(sale)) throw new Error('Invoice not found or has been deleted.');
  assertSalesReturnDateNotBeforeSale_(dateStr, sale);

  const saleItemsSource = opts.saleItems || getAllRows_('SALE_ITEMS');
  const returnItemsSource = opts.returnItems || activeSalesReturnItems_();
  const saleItems = saleItemsSource.filter(function (i) { return i['Invoice ID'] === payload.invoiceId; });
  const returnItemsSoFar = returnItemsSource.filter(function (i) { return i['Invoice ID'] === payload.invoiceId; });
  const saleSubtotal = Number(sale['Subtotal']) || 0;
  const saleGrandTotal = Number(sale['Grand Total']) || 0;
  const bundleSnapshots = getSaleBundleSnapshot_(payload.invoiceId, opts.bundleSnapshotRows || getAllRows_('SALE_BUNDLE_COMPONENTS'));

  const outstandingOwnQty = outstandingSaleOwnStockByProduct_(
    payload.invoiceId,
    saleItems,
    returnItemsSoFar,
    opts.consumptionRows,
    opts.vendorSourcingRows
  );

  const soldByProduct = {};
  saleItems.forEach(function (si) {
    const key = si['Product ID'];
    if (!soldByProduct[key]) {
      soldByProduct[key] = {
        productId: si['Product ID'], name: si['Product Name'],
        unitPrice: Number(si['Unit Price']) || 0, soldQty: 0, grossValue: 0
      };
    }
    const qty = Number(si['Quantity']) || 0;
    soldByProduct[key].soldQty += qty;
    soldByProduct[key].grossValue += grossSaleItemLineTotal_(si);
  });

  const returnedByProduct = {};
  const returnedValueByProduct = {};
  returnItemsSoFar.forEach(function (ri) {
    const productId = ri['Product ID'];
    returnedByProduct[productId] = (returnedByProduct[productId] || 0) + (Number(ri['Return Quantity']) || 0);
    returnedValueByProduct[productId] = roundMoney_(
      (returnedValueByProduct[productId] || 0) + economicReturnLineAmount_(ri, saleSubtotal, saleGrandTotal)
    );
  });

  let totalReturnAmount = 0;
  const seenProduct = {};
  const validated = payload.items.map(function (item, idx) {
    const qty = Number(item.qty);
    if (!isValidNonNegativeNumber_(qty) || qty <= 0) throw new Error('Line ' + (idx + 1) + ': quantity must be greater than zero.');
    if (seenProduct[item.productId]) throw new Error('Duplicate product in return. Combine it into one line.');
    seenProduct[item.productId] = true;

    const soldRow = soldByProduct[item.productId];
    if (!soldRow) throw new Error((item.name || item.productId) + ' was not part of this invoice.');

    const alreadyReturned = returnedByProduct[item.productId] || 0;
    if (bundleSnapshots[item.productId] && !Number.isSafeInteger(qty)) throw new Error('Bundle return quantity must be whole sets.');
    const available = bundleSnapshots[item.productId]
      ? Math.max(0, soldRow.soldQty - alreadyReturned)
      : Math.min(Math.max(0, soldRow.soldQty - alreadyReturned), outstandingOwnQty[item.productId] || 0);
    if (qty > available) throw new Error(soldRow.name + ': only ' + available + ' available to return.');

    const grossUnitPrice = soldRow.soldQty > 0 ? soldRow.grossValue / soldRow.soldQty : soldRow.unitPrice;
    const effectiveUnitPrice = effectiveTransactionUnitPrice_(grossUnitPrice, saleSubtotal, saleGrandTotal);
    const returnableQty = available + alreadyReturned;
    const maxReturnValue = roundMoney_(returnableQty * effectiveUnitPrice);
    const alreadyReturnedValue = returnedValueByProduct[item.productId] || 0;
    const remainingReturnValue = Math.max(0, roundMoney_(maxReturnValue - alreadyReturnedValue));
    // Return Price is operator-editable, but the source invoice remains the
    // accounting ceiling. The browser may request a lower price; the server
    // rejects negative/invalid values and anything above the invoice's
    // effective post-discount unit price.
    const requestedUnitPrice = salesReturnRequestedUnitPrice_(item.price, effectiveUnitPrice, soldRow.name);
    const requestedLineTotal = roundMoney_(qty * requestedUnitPrice);
    const lineTotal = Math.min(requestedLineTotal, remainingReturnValue);
    const storedUnitPrice = qty > 0 ? lineTotal / qty : 0;
    totalReturnAmount = roundMoney_(totalReturnAmount + lineTotal);
    return {
      productId: item.productId,
      name: soldRow.name,
      qty: qty,
      price: storedUnitPrice,
      lineTotal: lineTotal,
      productType: bundleSnapshots[item.productId] ? 'Bundle' : 'Standard'
    };
  });

  if (payload.refundMethod === 'Cash') {
    const maxCashRefund = opts.cashRefundAvailable !== undefined
      ? Number(opts.cashRefundAvailable) || 0
      : salesReturnCashRefundAvailable_(payload.invoiceId, sale['Paid Amount']);
    if (totalReturnAmount > maxCashRefund + 0.005) {
      throw new Error(
        'Cash refund is limited to ' + roundMoney_(maxCashRefund) +
        ' that is verifiably collected on this invoice. Use Store Credit for the remaining return value.'
      );
    }
  }

  const productsById = opts.productsById || (function () {
    const map = {};
    activeRows_('PRODUCTS').forEach(function (p) { map[p['Product ID']] = p; });
    return map;
  })();
  const virtualProductStockById = opts.virtualProductStockById || {};
  // Return a visible set only once in the financial return sheet, but
  // restore *each physical component* at its original sale recipe ratio.
  const physicalRestorations = [];
  validated.forEach(function(v) {
    if (v.productType === 'Bundle') {
      const snapshot = bundleSnapshots[v.productId];
      if (!snapshot || !snapshot.components.length) throw new Error('Original component details for this bundle cannot be found.');
      snapshot.components.forEach(function(c) {
        physicalRestorations.push({productId:c.productId,sourceSaleProductId:v.productId,qty:v.qty*c.qtyPerSet});
      });
    } else {
      physicalRestorations.push({productId:v.productId,sourceSaleProductId:v.productId,qty:v.qty});
    }
  });
  const stockChanges = physicalRestorations.map(function(v) {
    const product = productsById[v.productId];
    if (!product) throw new Error('Original physical component no longer exists: '+v.productId);
    if (!Object.prototype.hasOwnProperty.call(virtualProductStockById,v.productId)) {
      virtualProductStockById[v.productId] = Number(product['Current Stock']) || 0;
    }
    const newStock = (Number(virtualProductStockById[v.productId]) || 0) + v.qty;
    virtualProductStockById[v.productId] = newStock;
    return {productId:v.productId,name:product['Product Name'],qty:v.qty,
      sourceSaleProductId:v.sourceSaleProductId,rowIndex:product._rowIndex,newStock:newStock};
  });
  const restorationVirtualState = opts.restorationVirtualState || {};
  const restorationPlans = physicalRestorations.map(function(v){
    const product = productsById[v.productId];
    return planSaleReturnRestoration_(payload.invoiceId,v.productId,product['Product Name'],v.qty,{
      saleItemLots:opts.consumptionRows,stockLots:opts.stockLots,
      products:opts.products || Object.keys(productsById).map(function(k){return productsById[k];}),
      lotsById:opts.lotsById,virtualState:restorationVirtualState,
      sourceSaleProductId:v.sourceSaleProductId
    });
  });

  let customerId = sanitizeInput_(sale['Customer ID']);
  let creditCustomer = null;
  let needsCustomerResolution = false;
  if (payload.refundMethod === 'Store Credit') {
    if (!customerId) {
      if (opts.requireExistingCustomer) {
        throw new Error('Multi-invoice Store Credit requires an existing customer account.');
      }
      needsCustomerResolution = true;
    } else {
      const customers = opts.customers || getAllRows_('CUSTOMERS');
      creditCustomer = customers.filter(function (c) {
        return c['Customer ID'] === customerId && !isDeleted_(c);
      })[0];
      if (!creditCustomer || creditCustomer['Status'] === 'Inactive') {
        throw new Error('Customer not found or inactive. Reactivate the customer before issuing store credit.');
      }
    }
  }

  return {
    sale: sale,
    invoiceId: payload.invoiceId,
    customerId: customerId,
    creditCustomer: creditCustomer,
    needsCustomerResolution: needsCustomerResolution,
    refundMethod: payload.refundMethod,
    totalReturnAmount: totalReturnAmount,
    validatedItems: validated,
    stockChanges: stockChanges,
    dateStr: dateStr,
    txDate: txDate,
    reason: sanitizeInput_(payload.reason),
    notes: sanitizeInput_(payload.notes),
    restorationPlans: restorationPlans
  };
}

/** Apply a prepared native Sales Return. No business validation belongs here. */
function commitPreparedSalesReturn_(prepared, options) {
  const opts = options || {};
  const returnId = opts.returnId;
  if (!returnId) throw new Error('Return ID is required.');
  const now = opts.now || new Date();
  const actingUser = opts.actingUser;
  let customerId = prepared.customerId;
  let creditCustomer = prepared.creditCustomer;

  // Preserve legacy single-return behavior: a Store Credit return from a
  // named/phone walk-in can create/resolve a customer, but do it before the
  // return header and stock writes.
  if (prepared.refundMethod === 'Store Credit' && !customerId) {
    customerId = resolveOrCreateCustomer_(
      prepared.sale['Customer Name'], prepared.sale['Customer Phone'], prepared.sale['Customer Address']
    );
    creditCustomer = getAllRows_('CUSTOMERS').filter(function (c) {
      return c['Customer ID'] === customerId && !isDeleted_(c);
    })[0];
    if (!creditCustomer || creditCustomer['Status'] === 'Inactive') {
      throw new Error('Customer not found or inactive. Reactivate the customer before issuing store credit.');
    }
  }

  appendRow_('SALES_RETURN', {
    'Return ID': returnId,
    'Date': prepared.dateStr,
    'Invoice ID': prepared.invoiceId,
    'Customer ID': customerId,
    'Customer Name': prepared.sale['Customer Name'],
    'Customer Phone': prepared.sale['Customer Phone'],
    'Refund Method': prepared.refundMethod,
    'Total Return Amount': prepared.totalReturnAmount,
    'Reason': prepared.reason,
    'Notes': prepared.notes,
    'Processed By': actorName_(actingUser),
    'Created At': now,
    'Is Backdated': prepared.txDate.isBackdated,
    'Backdated Days': prepared.txDate.backdatedDays,
    'Backdated Reason': prepared.txDate.reason,
    'Batch ID': opts.batchId || ''
  });

  const returnItemRows = prepared.validatedItems.map(function (v) {
    return {
      'Return ID': returnId,
      'Invoice ID': prepared.invoiceId,
      'Product ID': v.productId,
      'Product Name': v.name,
      'Return Quantity': v.qty,
      'Return Price': v.price,
      'Line Total': v.lineTotal,
      'Pricing Basis': 'NetAfterInvoiceDiscount',
      'Sold Product Type': v.productType || 'Standard'
    };
  });
  const stockMovementRows = [];

  prepared.stockChanges.forEach(function (c, idx) {
    updateRowFields_('PRODUCTS', c.rowIndex, { 'Current Stock': c.newStock, 'Updated At': now });
    const plan = prepared.restorationPlans && prepared.restorationPlans[idx];
    const restored = plan
      ? applySaleReturnRestorationPlan_(plan, returnId)
      : restoreStockToLots_(prepared.invoiceId, c.productId, c.name, c.qty, returnId);
    restored.forEach(function (r) {
      stockMovementRows.push({
        'Movement ID': generateId_('STOCK_MOVEMENT'), 'Date': now, 'Product ID': c.productId,
        'Product Name': c.name, 'Type': 'Sales Return', 'Reference': returnId,
        'Quantity In': r.qty, 'Quantity Out': '', 'Balance Stock': c.newStock,
        'Notes': opts.batchId ? ('Batch ' + opts.batchId) : '', 'Lot ID': r.lotId,
          'Source Sale Product ID': c.sourceSaleProductId
      });
    });
  });
  appendRows_('SALES_RETURN_ITEMS', returnItemRows);
  appendRows_('STOCK_MOVEMENT', stockMovementRows);

  let newDue = null;
  if (prepared.refundMethod === 'Cash') {
    addCashBookEntry_({
      Type: 'Sales Return', Reference: returnId, Description: 'Cash refund for ' + prepared.invoiceId,
      Debit: prepared.totalReturnAmount, Credit: '', PaymentMethod: 'Cash', Date: prepared.dateStr
    });
  } else {
    newDue = opts.storeCreditBalanceAfter !== undefined
      ? roundMoney_(opts.storeCreditBalanceAfter)
      : roundMoney_((Number(creditCustomer['Current Due']) || 0) - prepared.totalReturnAmount);
    updateRowFields_('CUSTOMERS', creditCustomer._rowIndex, { 'Current Due': newDue });
    appendRow_('CUSTOMER_LEDGER', {
      'Ledger ID': generateId_('CUSTOMER_LEDGER'), 'Date': prepared.dateStr, 'Customer ID': customerId,
      'Customer Name': creditCustomer['Customer Name'], 'Type': 'Sales Return Credit', 'Reference': returnId,
      'Debit': '', 'Credit': prepared.totalReturnAmount, 'Balance': newDue,
      'Notes': 'Store credit for return ' + returnId + (opts.batchId ? ' (Batch ' + opts.batchId + ')' : ''),
      'Created By': actorName_(actingUser), 'Created At': now
    });
  }

  return { returnId: returnId, totalReturnAmount: prepared.totalReturnAmount, customerId: customerId, newDue: newDue };
}

/**
 * payload = {
 *   invoiceId, items: [{ productId, name, qty, price }],
 *   refundMethod: 'Cash' | 'Store Credit', reason, notes,
 *   date (optional, 'yyyy-MM-dd'), backdatedReason
 * }
 */
function completeReturn(token, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    const actingUser = requirePermission_(token, 'returns', 'add');
    requireActiveCashSession_();
    const txDate = resolveTransactionDate_(token, 'returns', payload && payload.date, payload && payload.backdatedReason, 'Return');
    const prepared = prepareSalesReturn_(payload, { txDate: txDate });
    const returnId = generateId_('SALES_RETURN');
    return ok_(commitPreparedSalesReturn_(prepared, {
      returnId: returnId,
      batchId: '',
      actingUser: actingUser,
      now: new Date()
    }));
  } catch (err) {
    logError_('completeReturn', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}


/** Derive a readable grouping ID without introducing a second counter. */
function deriveSalesReturnBatchId_(firstReturnId) {
  const match = String(firstReturnId || '').match(/(\d+)$/);
  if (!match) throw new Error('Unable to derive Sales Return Batch ID.');
  return 'SRB-' + match[1];
}

/**
 * One operator action spanning several source invoices for the same customer.
 * Every child is still a normal native Sales Return; Batch ID is metadata only.
 */
function completeReturnBatch(token, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  let batchId = '';
  const completedReturnIds = [];
  try {
    const actingUser = requirePermission_(token, 'returns', 'add');
    requireActiveCashSession_();

    const invoiceReturns = payload && Array.isArray(payload.invoiceReturns) ? payload.invoiceReturns : [];
    if (invoiceReturns.length < 2 || invoiceReturns.length > 20) {
      throw new Error('Select between 2 and 20 invoices for a batch return.');
    }
    if (payload.refundMethod !== 'Cash' && payload.refundMethod !== 'Store Credit') {
      throw new Error('Choose a refund method.');
    }

    let lineCount = 0;
    const seenInvoice = {};
    invoiceReturns.forEach(function (child, idx) {
      const invoiceId = sanitizeInput_(child && child.invoiceId);
      if (!invoiceId) throw new Error('Batch line ' + (idx + 1) + ': invoice is required.');
      if (seenInvoice[invoiceId]) throw new Error('Duplicate invoice in batch: ' + invoiceId + '.');
      seenInvoice[invoiceId] = true;
      if (!child.items || !child.items.length) throw new Error(invoiceId + ': select at least one product to return.');
      lineCount += child.items.length;
    });
    if (lineCount > 100) throw new Error('A batch return can contain at most 100 product lines.');

    const txDate = resolveTransactionDate_(token, 'returns', payload.date, payload.backdatedReason, 'Return');

    // Read once, index once. This keeps multi-invoice validation bounded and
    // lets every child share the same virtual stock/restoration state.
    const allSales = getAllRows_('SALES');
    const salesById = {};
    allSales.forEach(function (row) {
      const id = String(row['Invoice ID'] || '');
      if (!salesById[id]) salesById[id] = [];
      salesById[id].push(row);
    });
    const allSaleItems = getAllRows_('SALE_ITEMS');
    const allReturnItems = activeSalesReturnItems_();
    const activeProducts = activeRows_('PRODUCTS');
    const productsById = {};
    activeProducts.forEach(function (row) { productsById[row['Product ID']] = row; });
    const consumptionRows = getAllRows_('SALE_ITEM_LOTS');
    const stockLots = getAllRows_('STOCK_LOTS');
    const vendorSourcingRows = getAllRows_('VENDOR_SOURCING');
    const lotsById = {};
    stockLots.forEach(function (row) { lotsById[row['Lot ID']] = row; });
    const customers = payload.refundMethod === 'Store Credit' ? getAllRows_('CUSTOMERS') : [];

    let commonCustomerId = '';
    const salesForChildren = [];
    invoiceReturns.forEach(function (child) {
      const invoiceId = sanitizeInput_(child.invoiceId);
      const matches = salesById[invoiceId] || [];
      if (matches.length > 1) {
        throw new Error('Duplicate invoice ID detected: ' + invoiceId + '. This invoice must be repaired before Return actions can continue.');
      }
      const sale = matches[0];
      if (!sale || isDeleted_(sale)) throw new Error(invoiceId + ': invoice not found or has been deleted.');
      const customerId = sanitizeInput_(sale['Customer ID']);
      if (!customerId) {
        throw new Error('Multi-invoice returns require a customer account. Walk-in invoices must be returned one invoice at a time.');
      }
      if (!commonCustomerId) commonCustomerId = customerId;
      if (customerId !== commonCustomerId) throw new Error('All selected invoices must belong to the same customer.');
      salesForChildren.push(sale);
    });

    if (payload.refundMethod === 'Store Credit') {
      const customer = customers.filter(function (row) {
        return row['Customer ID'] === commonCustomerId && !isDeleted_(row);
      })[0];
      if (!customer || customer['Status'] === 'Inactive') {
        throw new Error('Customer not found or inactive. Reactivate the customer before issuing store credit.');
      }
    }

    const virtualProductStockById = {};
    const restorationVirtualState = {};
    const preparedChildren = invoiceReturns.map(function (child, idx) {
      return prepareSalesReturn_({
        invoiceId: sanitizeInput_(child.invoiceId),
        items: child.items,
        refundMethod: payload.refundMethod,
        reason: payload.reason,
        notes: payload.notes
      }, {
        txDate: txDate,
        sale: salesForChildren[idx],
        saleItems: allSaleItems,
        returnItems: allReturnItems,
        productsById: productsById,
        products: activeProducts,
        virtualProductStockById: virtualProductStockById,
        restorationVirtualState: restorationVirtualState,
        consumptionRows: consumptionRows,
        stockLots: stockLots,
        lotsById: lotsById,
        vendorSourcingRows: vendorSourcingRows,
        customers: customers,
        requireExistingCustomer: true
      });
    });

    // ID allocation happens only after every rejectable validation has passed.
    const returnIds = preparedChildren.map(function () { return generateId_('SALES_RETURN'); });
    batchId = deriveSalesReturnBatchId_(returnIds[0]);
    const now = new Date();
    let runningDue = null;
    if (payload.refundMethod === 'Store Credit') {
      const customer = preparedChildren[0].creditCustomer;
      runningDue = roundMoney_(Number(customer['Current Due']) || 0);
    }

    let totalReturnAmount = 0;
    const childResults = [];
    preparedChildren.forEach(function (prepared, idx) {
      const commitOptions = {
        returnId: returnIds[idx],
        batchId: batchId,
        actingUser: actingUser,
        now: now
      };
      if (prepared.refundMethod === 'Store Credit') {
        runningDue = roundMoney_(runningDue - prepared.totalReturnAmount);
        commitOptions.storeCreditBalanceAfter = runningDue;
      }
      const childResult = commitPreparedSalesReturn_(prepared, commitOptions);
      completedReturnIds.push(childResult.returnId);
      totalReturnAmount = roundMoney_(totalReturnAmount + prepared.totalReturnAmount);
      childResults.push({
        returnId: childResult.returnId,
        invoiceId: prepared.invoiceId,
        totalReturnAmount: prepared.totalReturnAmount
      });
    });

    return ok_({
      batchId: batchId,
      returnIds: returnIds,
      totalReturnAmount: totalReturnAmount,
      childReturns: childResults
    });
  } catch (err) {
    let message = err.message;
    if (batchId) {
      message += ' Batch ' + batchId + ' write phase did not complete normally.';
      if (completedReturnIds.length) message += ' Completed child returns: ' + completedReturnIds.join(', ') + '.';
      message += ' Review the batch before retrying.';
    }
    logError_('completeReturnBatch', err);
    return fail_(message);
  } finally {
    lock.releaseLock();
  }
}

function getReturnBatchDetail(token, batchId) {
  try {
    requirePermission_(token, 'returns', 'view');
    const id = sanitizeInput_(batchId);
    if (!id) return fail_('Batch ID is required.');
    const headers = getAllRows_('SALES_RETURN').filter(function (row) {
      return !isDeleted_(row) && String(row['Batch ID'] || '') === id;
    });
    if (!headers.length) return fail_('Return batch not found.');
    headers.sort(function (a, b) { return String(a['Created At']).localeCompare(String(b['Created At'])); });
    const headerIds = {};
    headers.forEach(function (row) { headerIds[row['Return ID']] = true; });
    const allItems = activeSalesReturnItems_().filter(function (row) { return !!headerIds[row['Return ID']]; });
    const children = headers.map(function (header) {
      return {
        header: header,
        items: allItems.filter(function (item) { return item['Return ID'] === header['Return ID']; })
      };
    });
    const batchTotal = headers.reduce(function (sum, row) {
      return roundMoney_(sum + (Number(row['Total Return Amount']) || 0));
    }, 0);
    return ok_({
      batchId: id,
      customerId: headers[0]['Customer ID'] || '',
      customerName: headers[0]['Customer Name'] || '',
      customerPhone: headers[0]['Customer Phone'] || '',
      date: safeDateOnly_(headers[0]['Date']),
      refundMethod: headers[0]['Refund Method'] || '',
      reason: headers[0]['Reason'] || '',
      notes: headers[0]['Notes'] || '',
      batchTotal: batchTotal,
      children: children
    });
  } catch (err) {
    logError_('getReturnBatchDetail', err);
    return fail_(err.message);
  }
}

function getReturnHistory(token) {
  try {
    requirePermission_(token, 'returns', 'view');
    const returns = getAllRows_('SALES_RETURN')
      .sort(function (a, b) { return String(b['Created At']).localeCompare(String(a['Created At'])); });
    return ok_(returns);
  } catch (err) {
    logError_('getReturnHistory', err);
    return fail_(err.message);
  }
}

function getReturnDetail(token, returnId) {
  try {
    requirePermission_(token, 'returns', 'view');
    const header = getAllRows_('SALES_RETURN').filter(function (r) { return r['Return ID'] === returnId; })[0];
    if (!header) return fail_('Return not found.');
    const items = getAllRows_('SALES_RETURN_ITEMS').filter(function (i) { return i['Return ID'] === returnId; });
    return ok_({ header: header, items: items });
  } catch (err) {
    logError_('getReturnDetail', err);
    return fail_(err.message);
  }
}
