/**
 * SupplierSettlement.gs
 * ---------------------------------------------------------------------
 * Reconstructs purchase settlement provenance from the authoritative
 * Supplier Ledger. Purchase rows keep the amount paid at creation time;
 * later supplier payments/discounts/credits are replayed here so purchase
 * due/status and cash-refund eligibility stay aligned with Supplier.Current Due.
 *
 * Historical supplier payments are untargeted and therefore settle the oldest
 * outstanding purchase obligations first. Purchase Update and Purchase Return
 * Credit rows keep their source Purchase ID through Reference mapping and are
 * applied to that purchase first before any excess becomes Supplier Credit.
 * ---------------------------------------------------------------------
 */

function supplierSettlementStableSortKey_(row) {
  const datePart = String(row && row['Date'] || '').slice(0, 10);
  return datePart + '|' + String(Number(row && row._rowIndex) || 0).padStart(12, '0') + '|' + String(row && row['Ledger ID'] || '');
}

function supplierSettlementIsCashBackedMethod_(method) {
  const value = String(method || '').trim();
  // Historical blank methods predate explicit Payment Method and were posted
  // as cash. Bank and Mobile Banking are also verifiable money movements.
  return !value || value === 'Cash' || value === 'Bank' || value === 'Mobile Banking';
}

function supplierSettlementCashAdvanceTotal_(state) {
  return roundMoney_((state.cashAdvancePools || []).reduce(function (sum, pool) {
    return sum + (Number(pool.amount) || 0);
  }, 0));
}

function supplierSettlementSupplierCreditTotal_(state) {
  return roundMoney_((Number(state.storeCredit) || 0) + supplierSettlementCashAdvanceTotal_(state));
}

function supplierSettlementRecordPurchasePayment_(state, purchaseId, amount) {
  const value = roundMoney_(Number(amount) || 0);
  if (!purchaseId || value <= 0) return;
  state.paymentByPurchase[purchaseId] = roundMoney_((state.paymentByPurchase[purchaseId] || 0) + value);
}

function supplierSettlementRecordPurchaseCredit_(state, purchaseId, amount, nonCash) {
  const value = roundMoney_(Number(amount) || 0);
  if (!purchaseId || value <= 0) return;
  state.creditByPurchase[purchaseId] = roundMoney_((state.creditByPurchase[purchaseId] || 0) + value);
  if (nonCash) {
    state.nonCashCreditByPurchase[purchaseId] = roundMoney_((state.nonCashCreditByPurchase[purchaseId] || 0) + value);
  }
}

function supplierSettlementAddCashAdvance_(state, sourceId, amount) {
  const value = roundMoney_(Number(amount) || 0);
  if (value <= 0) return;
  state.cashAdvancePools.push({ sourceId: sourceId || '', amount: value });
}

function supplierSettlementConsumeCashAdvance_(state, amount, purchaseId) {
  let remaining = roundMoney_(Number(amount) || 0);
  let used = 0;
  for (let i = 0; i < state.cashAdvancePools.length && remaining > 0.004; i++) {
    const pool = state.cashAdvancePools[i];
    const take = Math.min(remaining, Number(pool.amount) || 0);
    if (take <= 0) continue;
    pool.amount = roundMoney_((Number(pool.amount) || 0) - take);
    remaining = roundMoney_(remaining - take);
    used = roundMoney_(used + take);
  }
  state.cashAdvancePools = state.cashAdvancePools.filter(function (pool) {
    return Number(pool.amount) > 0.004;
  });
  if (purchaseId && used > 0) {
    state.cashByPurchase[purchaseId] = roundMoney_((state.cashByPurchase[purchaseId] || 0) + used);
    supplierSettlementRecordPurchasePayment_(state, purchaseId, used);
    supplierSettlementRecordPurchaseCredit_(state, purchaseId, used, false);
  }
  return used;
}

function supplierSettlementConsumePurchase_(state, purchaseId, amount, cashBacked, paymentBacked, creditBacked) {
  let remaining = roundMoney_(Number(amount) || 0);
  let used = 0;
  if (!purchaseId || remaining <= 0) return 0;
  state.obligations.forEach(function (ob) {
    if (remaining <= 0.004 || ob.purchaseId !== purchaseId || Number(ob.remaining) <= 0) return;
    const take = Math.min(remaining, Number(ob.remaining) || 0);
    ob.remaining = roundMoney_((Number(ob.remaining) || 0) - take);
    remaining = roundMoney_(remaining - take);
    used = roundMoney_(used + take);
    if (cashBacked && take > 0) state.cashByPurchase[purchaseId] = roundMoney_((state.cashByPurchase[purchaseId] || 0) + take);
    if (paymentBacked && take > 0) supplierSettlementRecordPurchasePayment_(state, purchaseId, take);
    if (creditBacked && take > 0) supplierSettlementRecordPurchaseCredit_(state, purchaseId, take, true);
  });
  return used;
}

function supplierSettlementConsumeOldest_(state, amount, cashBacked, paymentBacked, creditBacked) {
  let remaining = roundMoney_(Number(amount) || 0);
  let used = 0;
  state.obligations.forEach(function (ob) {
    if (remaining <= 0.004 || Number(ob.remaining) <= 0) return;
    const take = Math.min(remaining, Number(ob.remaining) || 0);
    ob.remaining = roundMoney_((Number(ob.remaining) || 0) - take);
    remaining = roundMoney_(remaining - take);
    used = roundMoney_(used + take);
    if (cashBacked && ob.purchaseId && take > 0) {
      state.cashByPurchase[ob.purchaseId] = roundMoney_((state.cashByPurchase[ob.purchaseId] || 0) + take);
    }
    if (paymentBacked && ob.purchaseId && take > 0) {
      supplierSettlementRecordPurchasePayment_(state, ob.purchaseId, take);
    }
    if (creditBacked && ob.purchaseId && take > 0) {
      supplierSettlementRecordPurchaseCredit_(state, ob.purchaseId, take, true);
    }
  });
  return used;
}

function supplierSettlementAddDebit_(state, amount, purchaseId, sourceId) {
  let remaining = roundMoney_(Number(amount) || 0);
  if (remaining <= 0) return;

  const storeUsed = Math.min(remaining, Number(state.storeCredit) || 0);
  state.storeCredit = roundMoney_((Number(state.storeCredit) || 0) - storeUsed);
  remaining = roundMoney_(remaining - storeUsed);
  if (purchaseId && storeUsed > 0) supplierSettlementRecordPurchaseCredit_(state, purchaseId, storeUsed, true);

  if (remaining > 0.004) {
    const advanceUsed = supplierSettlementConsumeCashAdvance_(state, remaining, purchaseId || '');
    remaining = roundMoney_(remaining - advanceUsed);
  }

  if (remaining > 0.004) {
    state.obligations.push({
      sourceId: sourceId || '',
      purchaseId: purchaseId || '',
      remaining: remaining
    });
  }
}

function supplierSettlementApplyNonCashCredit_(state, amount, purchaseId) {
  let remaining = roundMoney_(Number(amount) || 0);
  if (remaining <= 0) return;
  if (purchaseId) {
    remaining = roundMoney_(remaining - supplierSettlementConsumePurchase_(state, purchaseId, remaining, false, false, true));
  }
  if (remaining > 0.004) {
    remaining = roundMoney_(remaining - supplierSettlementConsumeOldest_(state, remaining, false, false, true));
  }
  if (remaining > 0.004) state.storeCredit = roundMoney_((Number(state.storeCredit) || 0) + remaining);
}

function supplierSettlementProcessPayment_(state, row) {
  const ledgerId = String(row['Ledger ID'] || '');
  const cashBacked = supplierSettlementIsCashBackedMethod_(row['Payment Method']);
  let payment = roundMoney_(settlementPaymentAmount_(row));
  let discount = roundMoney_(settlementDiscountAmount_(row));

  const appliedPayment = supplierSettlementConsumeOldest_(state, payment, cashBacked, true, false);
  payment = roundMoney_(payment - appliedPayment);
  const appliedDiscount = supplierSettlementConsumeOldest_(state, discount, false, false, false);
  discount = roundMoney_(discount - appliedDiscount);

  if (payment > 0.004) {
    if (cashBacked) supplierSettlementAddCashAdvance_(state, ledgerId, payment);
    else state.storeCredit = roundMoney_((Number(state.storeCredit) || 0) + payment);
  }

  state.paymentIssues[ledgerId] = {
    appliedPayment: appliedPayment,
    appliedCash: cashBacked ? appliedPayment : 0,
    appliedDiscount: appliedDiscount,
    cashAdvanceCreated: cashBacked && payment > 0.004 ? payment : 0,
    nonCashCreditCreated: !cashBacked && payment > 0.004 ? payment : 0,
    unappliedDiscount: discount > 0.004 ? discount : 0
  };
}

function supplierSettlementState_(supplierId, options) {
  const opts = options || {};
  const sid = String(supplierId || '');
  const excludeLedgerId = String(opts.excludeLedgerId || '');
  const extraRows = (opts.extraRows || []).slice();
  const returnPurchaseById = {};
  const returnRows = opts.returnRows || activeRows_('PURCHASE_RETURN');
  returnRows.forEach(function (r) {
    returnPurchaseById[String(r['Return ID'] || '')] = String(r['Purchase ID'] || '');
  });

  const ledgerRows = opts.ledgerRows || getAllRows_('SUPPLIER_LEDGER');
  let rows = ledgerRows.filter(function (row) {
    return String(row['Supplier ID'] || '') === sid && !isDeleted_(row) &&
      (!excludeLedgerId || String(row['Ledger ID'] || '') !== excludeLedgerId);
  });
  extraRows.forEach(function (row) {
    if (String(row['Supplier ID'] || '') === sid) rows.push(row);
  });
  rows.sort(function (a, b) {
    return supplierSettlementStableSortKey_(a).localeCompare(supplierSettlementStableSortKey_(b));
  });

  const state = {
    supplierId: sid,
    obligations: [],
    cashAdvancePools: [],
    storeCredit: 0,
    cashByPurchase: {},
    paymentByPurchase: {},
    creditByPurchase: {},
    nonCashCreditByPurchase: {},
    purchaseRemaining: {},
    paymentIssues: {},
    computedNetDue: 0,
    cashAdvance: 0,
    supplierCredit: 0
  };

  rows.forEach(function (row) {
    const type = String(row['Type'] || '');
    const debit = roundMoney_(Number(row['Debit']) || 0);
    const credit = roundMoney_(Number(row['Credit']) || 0);
    const reference = String(row['Reference'] || '');

    if (type === 'Payment') {
      supplierSettlementProcessPayment_(state, row);
      return;
    }

    if (type === 'Purchase') {
      supplierSettlementAddDebit_(state, debit, reference, String(row['Ledger ID'] || ''));
      return;
    }

    if (type === 'Purchase Update') {
      if (debit > 0) supplierSettlementAddDebit_(state, debit, reference, String(row['Ledger ID'] || ''));
      if (credit > 0) supplierSettlementApplyNonCashCredit_(state, credit, reference);
      return;
    }

    if (type === 'Purchase Return Credit') {
      supplierSettlementApplyNonCashCredit_(state, credit, returnPurchaseById[reference] || '');
      return;
    }

    if (type === 'Opening Balance') {
      if (debit > 0) supplierSettlementAddDebit_(state, debit, '', String(row['Ledger ID'] || ''));
      if (credit > 0) supplierSettlementApplyNonCashCredit_(state, credit, '');
      return;
    }

    // Fail-safe for legacy/unknown supplier-ledger rows: preserve their
    // accounting sign without inventing purchase or cash provenance.
    if (debit > 0) supplierSettlementAddDebit_(state, debit, '', String(row['Ledger ID'] || ''));
    if (credit > 0) supplierSettlementApplyNonCashCredit_(state, credit, '');
  });

  state.obligations.forEach(function (ob) {
    if (!ob.purchaseId || Number(ob.remaining) <= 0.004) return;
    state.purchaseRemaining[ob.purchaseId] = roundMoney_((state.purchaseRemaining[ob.purchaseId] || 0) + (Number(ob.remaining) || 0));
  });
  state.cashAdvance = supplierSettlementCashAdvanceTotal_(state);
  state.supplierCredit = supplierSettlementSupplierCreditTotal_(state);
  const outstanding = state.obligations.reduce(function (sum, ob) {
    return sum + (Number(ob.remaining) || 0);
  }, 0);
  state.computedNetDue = roundMoney_(outstanding - state.supplierCredit);
  return state;
}

function supplierPurchaseSettlementSnapshotFromState_(purchase, state) {
  if (!purchase || isDeleted_(purchase)) return null;

  const directPaid = roundMoney_(Number(purchase['Paid Amount']) || 0);
  const originalDue = roundMoney_(Number(purchase['Due Amount']) || 0);
  const supplierId = String(purchase['Supplier ID'] || '');
  if (!supplierId || originalDue <= 0.004 || !state) {
    return {
      paidAmount: directPaid,
      dueAmount: originalDue,
      supplierCreditUsed: 0,
      paymentStatus: purchase['Payment Status'] || (originalDue <= 0.004 ? 'Paid' : (directPaid > 0 ? 'Partial' : 'Due'))
    };
  }

  const purchaseId = String(purchase['Purchase ID'] || '');
  const laterPaid = roundMoney_(Number(state.paymentByPurchase[purchaseId]) || 0);
  const nonCashCreditUsed = roundMoney_(Number(state.nonCashCreditByPurchase[purchaseId]) || 0);
  const supplierCreditUsed = roundMoney_(Number(state.creditByPurchase[purchaseId]) || 0);
  const dueAmount = roundMoney_(Number(state.purchaseRemaining[purchaseId]) || 0);
  const paidAmount = roundMoney_(directPaid + laterPaid + nonCashCreditUsed);
  const paymentStatus = dueAmount <= 0.004 ? 'Paid' : (paidAmount > 0.004 ? 'Partial' : 'Due');

  return {
    paidAmount: paidAmount,
    dueAmount: dueAmount,
    supplierCreditUsed: supplierCreditUsed,
    paymentStatus: paymentStatus
  };
}

function supplierPurchaseSettlementSnapshot_(purchaseId) {
  const purchase = findFirstRow_('PURCHASES', 'Purchase ID', purchaseId);
  if (!purchase || isDeleted_(purchase)) return null;
  const supplierId = String(purchase['Supplier ID'] || '');
  const originalDue = roundMoney_(Number(purchase['Due Amount']) || 0);
  const state = supplierId && originalDue > 0.004 ? supplierSettlementState_(supplierId) : null;
  return supplierPurchaseSettlementSnapshotFromState_(purchase, state);
}

function supplierPurchaseCashPaidFromState_(purchase, state) {
  if (!purchase || isDeleted_(purchase)) return 0;
  const directPaid = supplierSettlementIsCashBackedMethod_(purchase['Payment Method'])
    ? roundMoney_(Number(purchase['Paid Amount']) || 0)
    : 0;
  if (!state) return directPaid;
  const purchaseId = String(purchase['Purchase ID'] || '');
  return roundMoney_(directPaid + (Number(state.cashByPurchase[purchaseId]) || 0));
}

function supplierPurchaseCashPaid_(purchaseId) {
  const purchase = findFirstRow_('PURCHASES', 'Purchase ID', purchaseId);
  if (!purchase || isDeleted_(purchase)) return 0;
  const supplierId = String(purchase['Supplier ID'] || '');
  const originalDue = roundMoney_(Number(purchase['Due Amount']) || 0);
  const state = supplierId && originalDue > 0.004 ? supplierSettlementState_(supplierId) : null;
  return supplierPurchaseCashPaidFromState_(purchase, state);
}
