/**
 * CustomerSettlement.gs
 * ---------------------------------------------------------------------
 * Reconstructs invoice settlement provenance from the authoritative customer
 * ledger. Historical Payment rows have a blank Allocated Invoice ID and are
 * therefore replayed oldest-due-first. New targeted payments store one invoice
 * ID on the existing ledger row; no second transactional allocation table is
 * required.
 *
 * This module is read-only except for callers that explicitly post through
 * Customer.gs. It never changes Current Due itself.
 * ---------------------------------------------------------------------
 */

function customerSettlementStableSortKey_(row) {
  const datePart = String(row && row['Date'] || '').slice(0, 10);
  return datePart + '|' + String(Number(row && row._rowIndex) || 0).padStart(12, '0') + '|' + String(row && row['Ledger ID'] || '');
}

function customerSettlementCashAdvanceTotal_(state) {
  return roundMoney_((state.cashAdvancePools || []).reduce(function (sum, pool) {
    return sum + (Number(pool.amount) || 0);
  }, 0));
}

function customerSettlementAdjustmentCreditTotal_(state) {
  return roundMoney_((state.adjustmentCreditPools || []).reduce(function (sum, pool) {
    return sum + (Number(pool.amount) || 0);
  }, 0));
}

function customerSettlementCustomerCreditTotal_(state) {
  return roundMoney_(
    (Number(state.storeCredit) || 0) +
    customerSettlementAdjustmentCreditTotal_(state) +
    customerSettlementCashAdvanceTotal_(state)
  );
}

function customerSettlementConsumeCustomerCredit_(state, amount) {
  let remaining = roundMoney_(Number(amount) || 0);
  let used = 0;
  if (remaining <= 0) return 0;

  const storeUsed = Math.min(remaining, Number(state.storeCredit) || 0);
  if (storeUsed > 0) {
    state.storeCredit = roundMoney_((Number(state.storeCredit) || 0) - storeUsed);
    remaining = roundMoney_(remaining - storeUsed);
    used = roundMoney_(used + storeUsed);
  }

  if (remaining > 0.004) {
    const adjustmentUsed = customerSettlementConsumeAdjustmentCredit_(state, remaining, '', '');
    remaining = roundMoney_(remaining - adjustmentUsed);
    used = roundMoney_(used + adjustmentUsed);
  }

  if (remaining > 0.004) {
    const advanceUsed = customerSettlementConsumeCashAdvance_(state, remaining, '');
    remaining = roundMoney_(remaining - advanceUsed);
    used = roundMoney_(used + advanceUsed);
  }
  return used;
}

function customerSettlementAddAdjustmentCredit_(state, invoiceId, amount) {
  const value = roundMoney_(Number(amount) || 0);
  if (value <= 0) return;
  state.adjustmentCreditPools.push({ invoiceId: invoiceId || '', amount: value });
}

function customerSettlementConsumeAdjustmentCredit_(state, amount, onlyInvoiceId, recordInvoiceId) {
  let remaining = roundMoney_(Number(amount) || 0);
  let used = 0;
  const requiredInvoiceId = String(onlyInvoiceId || '');
  for (let i = 0; i < state.adjustmentCreditPools.length && remaining > 0.004; i++) {
    const pool = state.adjustmentCreditPools[i];
    if (requiredInvoiceId && String(pool.invoiceId || '') !== requiredInvoiceId) continue;
    const take = Math.min(remaining, Number(pool.amount) || 0);
    if (take <= 0) continue;
    pool.amount = roundMoney_((Number(pool.amount) || 0) - take);
    remaining = roundMoney_(remaining - take);
    used = roundMoney_(used + take);
  }
  state.adjustmentCreditPools = state.adjustmentCreditPools.filter(function (pool) {
    return Number(pool.amount) > 0.004;
  });
  if (recordInvoiceId && used > 0) {
    customerSettlementRecordInvoiceCredit_(state, recordInvoiceId, used, true);
  }
  return used;
}

function customerSettlementAddCashAdvance_(state, sourceId, amount) {
  amount = roundMoney_(Number(amount) || 0);
  if (amount <= 0) return;
  state.cashAdvancePools.push({ sourceId: sourceId || '', amount: amount });
}

function customerSettlementRecordInvoicePayment_(state, invoiceId, amount) {
  const value = roundMoney_(Number(amount) || 0);
  if (!invoiceId || value <= 0) return;
  state.paymentByInvoice[invoiceId] = roundMoney_((state.paymentByInvoice[invoiceId] || 0) + value);
}

function customerSettlementRecordInvoiceCredit_(state, invoiceId, amount, nonCash) {
  const value = roundMoney_(Number(amount) || 0);
  if (!invoiceId || value <= 0) return;
  state.creditByInvoice[invoiceId] = roundMoney_((state.creditByInvoice[invoiceId] || 0) + value);
  if (nonCash) {
    state.nonCashCreditByInvoice[invoiceId] = roundMoney_((state.nonCashCreditByInvoice[invoiceId] || 0) + value);
  }
}

function customerSettlementConsumeCashAdvance_(state, amount, invoiceId) {
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
  state.cashAdvancePools = state.cashAdvancePools.filter(function (pool) { return Number(pool.amount) > 0.004; });
  if (invoiceId && used > 0) {
    state.cashByInvoice[invoiceId] = roundMoney_((state.cashByInvoice[invoiceId] || 0) + used);
    customerSettlementRecordInvoicePayment_(state, invoiceId, used);
    customerSettlementRecordInvoiceCredit_(state, invoiceId, used, false);
  }
  return used;
}

function customerSettlementConsumeInvoice_(state, invoiceId, amount, cashBacked, paymentBacked, creditBacked) {
  let remaining = roundMoney_(Number(amount) || 0);
  let used = 0;
  if (!invoiceId || remaining <= 0) return 0;
  state.obligations.forEach(function (ob) {
    if (remaining <= 0.004 || ob.invoiceId !== invoiceId || Number(ob.remaining) <= 0) return;
    const take = Math.min(remaining, Number(ob.remaining) || 0);
    ob.remaining = roundMoney_((Number(ob.remaining) || 0) - take);
    remaining = roundMoney_(remaining - take);
    used = roundMoney_(used + take);
    if (cashBacked && take > 0) state.cashByInvoice[invoiceId] = roundMoney_((state.cashByInvoice[invoiceId] || 0) + take);
    if (paymentBacked && take > 0) customerSettlementRecordInvoicePayment_(state, invoiceId, take);
    if (creditBacked && take > 0) customerSettlementRecordInvoiceCredit_(state, invoiceId, take, true);
  });
  return used;
}

function customerSettlementConsumeOldest_(state, amount, cashBacked, paymentBacked, creditBacked) {
  let remaining = roundMoney_(Number(amount) || 0);
  let used = 0;
  state.obligations.forEach(function (ob) {
    if (remaining <= 0.004 || Number(ob.remaining) <= 0) return;
    const take = Math.min(remaining, Number(ob.remaining) || 0);
    ob.remaining = roundMoney_((Number(ob.remaining) || 0) - take);
    remaining = roundMoney_(remaining - take);
    used = roundMoney_(used + take);
    if (cashBacked && ob.invoiceId && take > 0) {
      state.cashByInvoice[ob.invoiceId] = roundMoney_((state.cashByInvoice[ob.invoiceId] || 0) + take);
    }
    if (paymentBacked && ob.invoiceId && take > 0) {
      customerSettlementRecordInvoicePayment_(state, ob.invoiceId, take);
    }
    if (creditBacked && ob.invoiceId && take > 0) {
      customerSettlementRecordInvoiceCredit_(state, ob.invoiceId, take, true);
    }
  });
  return used;
}

function customerSettlementAddDebit_(state, amount, invoiceId, sourceId, options) {
  let remaining = roundMoney_(Number(amount) || 0);
  if (remaining <= 0) return;
  const opts = options || {};

  // An invoice edit is represented in the ledger as a full reversal followed
  // by a replacement debit. Any carry created by reversing the previous
  // version of the SAME invoice must cancel the replacement debit first. It is
  // an internal correction, not a customer payment/credit settlement.
  if (opts.consumeMatchingAdjustmentFirst && invoiceId && remaining > 0.004) {
    const matchingAdjustmentUsed = customerSettlementConsumeAdjustmentCredit_(state, remaining, invoiceId, '');
    remaining = roundMoney_(remaining - matchingAdjustmentUsed);
  }

  const storeUsed = Math.min(remaining, Number(state.storeCredit) || 0);
  state.storeCredit = roundMoney_((Number(state.storeCredit) || 0) - storeUsed);
  remaining = roundMoney_(remaining - storeUsed);
  if (invoiceId && storeUsed > 0) customerSettlementRecordInvoiceCredit_(state, invoiceId, storeUsed, true);

  if (remaining > 0.004) {
    const adjustmentUsed = customerSettlementConsumeAdjustmentCredit_(state, remaining, '', invoiceId || '');
    remaining = roundMoney_(remaining - adjustmentUsed);
  }

  if (remaining > 0.004) {
    const advanceUsed = customerSettlementConsumeCashAdvance_(state, remaining, invoiceId || '');
    remaining = roundMoney_(remaining - advanceUsed);
  }

  if (remaining > 0.004) {
    state.obligations.push({
      sourceId: sourceId || '',
      invoiceId: invoiceId || '',
      remaining: remaining
    });
  }
}

function customerSettlementApplySaleUpdateCredit_(state, amount, invoiceId) {
  let remaining = roundMoney_(Number(amount) || 0);
  if (remaining <= 0) return;
  if (invoiceId) {
    remaining = roundMoney_(
      remaining - customerSettlementConsumeInvoice_(state, invoiceId, remaining, false, false, false)
    );
  }
  if (remaining > 0.004) {
    customerSettlementAddAdjustmentCredit_(state, invoiceId || '', remaining);
  }
}

function customerSettlementApplyNonCashCredit_(state, amount, invoiceId) {
  let remaining = roundMoney_(Number(amount) || 0);
  if (remaining <= 0) return;
  if (invoiceId) {
    remaining = roundMoney_(remaining - customerSettlementConsumeInvoice_(state, invoiceId, remaining, false, false, true));
  }
  if (remaining > 0.004) {
    remaining = roundMoney_(remaining - customerSettlementConsumeOldest_(state, remaining, false, false, true));
  }
  if (remaining > 0.004) state.storeCredit = roundMoney_((Number(state.storeCredit) || 0) + remaining);
}

function customerSettlementSettleRemainingAdjustmentCredits_(state) {
  if (!state.adjustmentCreditPools || !state.adjustmentCreditPools.length) return;
  state.adjustmentCreditPools.forEach(function (pool) {
    let remaining = roundMoney_(Number(pool.amount) || 0);
    if (remaining <= 0.004) return;
    const used = customerSettlementConsumeOldest_(state, remaining, false, false, true);
    pool.amount = roundMoney_(remaining - used);
  });
  state.adjustmentCreditPools = state.adjustmentCreditPools.filter(function (pool) {
    return Number(pool.amount) > 0.004;
  });
}

function customerSettlementIsCashBackedMethod_(method) {
  const value = String(method || '').trim();
  // Historical rows predate Payment Method and were cash collections. Only
  // methods that post to Cash Book / Bank Book create refundable provenance.
  return !value || value === 'Cash' || value === 'Bank' || value === 'Mobile Banking';
}

function customerSettlementProcessPayment_(state, row) {
  const ledgerId = String(row['Ledger ID'] || '');
  const targetInvoiceId = sanitizeInput_(row['Allocated Invoice ID']);
  const cashBacked = customerSettlementIsCashBackedMethod_(row['Payment Method']);
  let payment = roundMoney_(settlementPaymentAmount_(row));
  let discount = roundMoney_(settlementDiscountAmount_(row));
  let appliedPayment = 0;
  let appliedCash = 0;
  let appliedDiscount = 0;
  let targetAppliedPayment = 0;
  let targetAppliedDiscount = 0;

  if (targetInvoiceId) {
    targetAppliedPayment = customerSettlementConsumeInvoice_(state, targetInvoiceId, payment, cashBacked, true, false);
    appliedPayment = targetAppliedPayment;
    if (cashBacked) appliedCash = targetAppliedPayment;
    payment = roundMoney_(payment - targetAppliedPayment);

    // A selected invoice is always attempted first, then any remaining real
    // payment settles the customer's other outstanding dues before it can
    // become Customer Credit. This also protects historical targeted rows if
    // a later backdated correction/return means the original target is already
    // settled when the ledger is replayed. New payments still validate that
    // the selected invoice itself had due via targetAppliedPayment below.
    if (payment > 0.004) {
      const spilloverPayment = customerSettlementConsumeOldest_(state, payment, cashBacked, true, false);
      appliedPayment = roundMoney_(appliedPayment + spilloverPayment);
      if (cashBacked) appliedCash = roundMoney_(appliedCash + spilloverPayment);
      payment = roundMoney_(payment - spilloverPayment);
    }

    targetAppliedDiscount = customerSettlementConsumeInvoice_(state, targetInvoiceId, discount, false, false, false);
    appliedDiscount = targetAppliedDiscount;
    discount = roundMoney_(discount - targetAppliedDiscount);
  } else {
    appliedPayment = customerSettlementConsumeOldest_(state, payment, cashBacked, true, false);
    if (cashBacked) appliedCash = appliedPayment;
    payment = roundMoney_(payment - appliedPayment);
    appliedDiscount = customerSettlementConsumeOldest_(state, discount, false, false, false);
    discount = roundMoney_(discount - appliedDiscount);
  }

  if (payment > 0.004) {
    if (cashBacked) customerSettlementAddCashAdvance_(state, ledgerId, payment);
    else state.storeCredit = roundMoney_((Number(state.storeCredit) || 0) + payment);
  }
  state.paymentIssues[ledgerId] = {
    targetInvoiceId: targetInvoiceId,
    targetAppliedPayment: targetAppliedPayment,
    targetAppliedDiscount: targetAppliedDiscount,
    appliedPayment: appliedPayment,
    appliedCash: appliedCash,
    appliedDiscount: appliedDiscount,
    cashAdvanceCreated: cashBacked && payment > 0.004 ? payment : 0,
    nonCashCreditCreated: !cashBacked && payment > 0.004 ? payment : 0,
    unappliedDiscount: discount > 0.004 ? discount : 0
  };
}

function customerSettlementState_(customerId, options) {
  const opts = options || {};
  const pid = String(customerId || '');
  const excludeLedgerId = String(opts.excludeLedgerId || '');
  const extraRows = (opts.extraRows || []).slice();
  const returnInvoiceById = {};
  const returnRows = opts.returnRows || activeRows_('SALES_RETURN');
  returnRows.forEach(function (r) {
    returnInvoiceById[String(r['Return ID'] || '')] = String(r['Invoice ID'] || '');
  });

  const ledgerRows = opts.ledgerRows || getAllRows_('CUSTOMER_LEDGER');
  let rows = ledgerRows.filter(function (row) {
    return String(row['Customer ID'] || '') === pid && !isDeleted_(row) && (!excludeLedgerId || String(row['Ledger ID'] || '') !== excludeLedgerId);
  });
  extraRows.forEach(function (row) {
    if (String(row['Customer ID'] || '') === pid) rows.push(row);
  });
  rows.sort(function (a, b) { return customerSettlementStableSortKey_(a).localeCompare(customerSettlementStableSortKey_(b)); });

  const state = {
    customerId: pid,
    obligations: [],
    cashAdvancePools: [],
    adjustmentCreditPools: [],
    storeCredit: 0,
    cashByInvoice: {},
    paymentByInvoice: {},
    creditByInvoice: {},
    nonCashCreditByInvoice: {},
    invoiceRemaining: {},
    paymentIssues: {},
    advanceRefundIssues: {},
    creditRefundIssues: {},
    computedNetDue: 0,
    cashAdvance: 0,
    customerCredit: 0
  };

  rows.forEach(function (row) {
    const type = String(row['Type'] || '');
    const debit = roundMoney_(Number(row['Debit']) || 0);
    const credit = roundMoney_(Number(row['Credit']) || 0);
    const reference = String(row['Reference'] || '');

    if (type === 'Payment') {
      customerSettlementProcessPayment_(state, row);
      return;
    }

    if (type === 'Advance Refund') {
      // Historical transaction type retained for audit compatibility. Under
      // the simplified model it refunds any currently available Customer
      // Credit, whether created by overpayment or Sales Return credit.
      const used = customerSettlementConsumeCustomerCredit_(state, debit);
      const shortfall = roundMoney_(debit - used);
      const ledgerId = String(row['Ledger ID'] || '');
      state.advanceRefundIssues[ledgerId] = shortfall > 0.004 ? shortfall : 0;
      state.creditRefundIssues[ledgerId] = shortfall > 0.004 ? shortfall : 0;
      return;
    }

    if (type === 'Sale') {
      customerSettlementAddDebit_(state, debit, reference, String(row['Ledger ID'] || ''));
      return;
    }

    if (type === 'Sale Update Debit') {
      customerSettlementAddDebit_(state, debit, reference, String(row['Ledger ID'] || ''), {
        consumeMatchingAdjustmentFirst: true
      });
      return;
    }

    if (type === 'Sales Return Credit') {
      customerSettlementApplyNonCashCredit_(state, credit, returnInvoiceById[reference] || '');
      return;
    }

    if (type === 'Sale Update Credit') {
      customerSettlementApplySaleUpdateCredit_(state, credit, reference);
      return;
    }

    if (type === 'Opening Balance') {
      if (debit > 0) customerSettlementAddDebit_(state, debit, '', String(row['Ledger ID'] || ''));
      if (credit > 0) customerSettlementApplyNonCashCredit_(state, credit, '');
      return;
    }

    // Fail-safe for any legacy customer-ledger type not known to this module:
    // preserve its accounting sign without inventing cash provenance.
    if (debit > 0) customerSettlementAddDebit_(state, debit, '', String(row['Ledger ID'] || ''));
    if (credit > 0) customerSettlementApplyNonCashCredit_(state, credit, '');
  });

  // Any correction carry that was not consumed by a later replacement debit
  // is now ordinary customer credit. Before exposing it as a standalone credit,
  // net it against any remaining receivable so due and credit cannot coexist.
  customerSettlementSettleRemainingAdjustmentCredits_(state);

  state.obligations.forEach(function (ob) {
    if (!ob.invoiceId || Number(ob.remaining) <= 0.004) return;
    state.invoiceRemaining[ob.invoiceId] = roundMoney_((state.invoiceRemaining[ob.invoiceId] || 0) + (Number(ob.remaining) || 0));
  });
  state.cashAdvance = customerSettlementCashAdvanceTotal_(state);
  state.customerCredit = customerSettlementCustomerCreditTotal_(state);
  const outstanding = state.obligations.reduce(function (sum, ob) { return sum + (Number(ob.remaining) || 0); }, 0);
  state.computedNetDue = roundMoney_(outstanding - state.customerCredit);
  return state;
}

function customerPaymentPreview_(customerId, dateStr, payment, discount, allocatedInvoiceId, excludeLedgerId, paymentMethod) {
  const targetInvoiceId = sanitizeInput_(allocatedInvoiceId);
  if (targetInvoiceId) {
    const sale = findUniqueSalesRow_(targetInvoiceId);
    if (!sale || isDeleted_(sale)) throw new Error('Selected invoice was not found.');
    if (String(sale['Customer ID'] || '') !== String(customerId || '')) throw new Error('Selected invoice belongs to a different customer.');
    if (safeDateOnly_(sale['Date']) > safeDateOnly_(dateStr)) throw new Error('Payment date cannot be before the selected invoice date.');
  }

  const previewId = '__PAYMENT_PREVIEW__';
  const previewRow = {
    _rowIndex: 999999999999,
    'Ledger ID': previewId,
    'Date': dateStr,
    'Customer ID': customerId,
    'Type': 'Payment',
    'Reference': 'PAYMENT',
    'Debit': '',
    'Credit': roundMoney_((Number(payment) || 0) + (Number(discount) || 0)),
    'Payment Amount': roundMoney_(Number(payment) || 0),
    'Discount Amount': roundMoney_(Number(discount) || 0),
    'Allocated Invoice ID': targetInvoiceId,
    'Payment Method': paymentMethod || 'Cash',
    'Is Deleted': ''
  };
  const state = customerSettlementState_(customerId, { excludeLedgerId: excludeLedgerId || '', extraRows: [previewRow] });
  const issue = state.paymentIssues[previewId] || {
    targetAppliedPayment: 0, targetAppliedDiscount: 0, appliedPayment: 0, appliedCash: 0,
    appliedDiscount: 0, unappliedDiscount: 0, cashAdvanceCreated: 0
  };
  if (issue.unappliedDiscount > 0.004) throw new Error('Discount cannot exceed the due that this payment settles.');
  if (targetInvoiceId && roundMoney_((issue.targetAppliedPayment || 0) + (issue.targetAppliedDiscount || 0)) <= 0) {
    throw new Error('The selected invoice has no outstanding due on this payment date.');
  }
  return { state: state, issue: issue };
}

function customerCreditRefundPreview_(customerId, dateStr, amount) {
  const refundAmount = roundMoney_(Number(amount) || 0);
  const previewId = '__CREDIT_REFUND_PREVIEW__';
  const previewRow = {
    _rowIndex: 999999999999,
    'Ledger ID': previewId,
    'Date': dateStr,
    'Customer ID': customerId,
    // Keep the historical ledger type so existing reports/audit rules remain
    // compatible while the user-facing workflow is simply "Refund Credit".
    'Type': 'Advance Refund',
    'Reference': 'CREDIT REFUND',
    'Debit': refundAmount,
    'Credit': '',
    'Payment Amount': refundAmount,
    'Payment Method': 'Cash',
    'Is Deleted': ''
  };
  const state = customerSettlementState_(customerId, { extraRows: [previewRow] });
  const shortfall = roundMoney_(Number(state.creditRefundIssues[previewId]) || 0);
  if (shortfall > 0.004) {
    throw new Error('Customer did not have enough available Customer Credit on the selected refund date.');
  }
  return state;
}

function customerInvoiceSettlementSnapshotFromState_(sale, state) {
  if (!sale || isDeleted_(sale)) return null;

  const directPaid = roundMoney_(Number(sale['Paid Amount']) || 0);
  const originalDue = roundMoney_(Number(sale['Due Amount']) || 0);
  const customerId = String(sale['Customer ID'] || '');
  if (!customerId || originalDue <= 0.004 || !state) {
    return {
      paidAmount: directPaid,
      dueAmount: originalDue,
      customerCreditUsed: 0,
      paymentStatus: sale['Payment Status'] || (originalDue <= 0.004 ? 'Paid' : (directPaid > 0 ? 'Partial' : 'Due')),
      paymentType: sale['Payment Type'] || (originalDue <= 0.004 ? 'Cash' : (directPaid > 0 ? 'Partial' : 'Due'))
    };
  }

  const invoiceId = String(sale['Invoice ID'] || '');
  const laterPaid = roundMoney_(Number(state.paymentByInvoice[invoiceId]) || 0);
  const nonCashCreditUsed = roundMoney_(Number(state.nonCashCreditByInvoice[invoiceId]) || 0);
  const customerCreditUsed = roundMoney_(Number(state.creditByInvoice[invoiceId]) || 0);
  const dueAmount = roundMoney_(Number(state.invoiceRemaining[invoiceId]) || 0);
  // Paid/Settled intentionally includes Customer Credit applied to this invoice,
  // but excludes settlement discounts. Cash-refund eligibility remains isolated
  // in cashByInvoice/customerInvoiceCashCollected_.
  const rawPaidAmount = roundMoney_(directPaid + laterPaid + nonCashCreditUsed);
  const invoiceTotal = roundMoney_((Number(sale['Grand Total']) || 0) || (directPaid + originalDue));
  const paidAmount = invoiceTotal > 0 ? Math.min(rawPaidAmount, invoiceTotal) : rawPaidAmount;
  const paymentStatus = dueAmount <= 0.004 ? 'Paid' : (paidAmount > 0.004 ? 'Partial' : 'Due');

  return {
    paidAmount: paidAmount,
    dueAmount: dueAmount,
    customerCreditUsed: customerCreditUsed,
    paymentStatus: paymentStatus,
    paymentType: paymentStatus === 'Due' ? 'Due' : (paymentStatus === 'Partial' ? 'Partial' : (sale['Payment Type'] === 'Cash' ? 'Cash' : 'Paid'))
  };
}

function customerInvoiceSettlementSnapshot_(invoiceId) {
  const sale = findUniqueSalesRow_(invoiceId);
  if (!sale || isDeleted_(sale)) return null;
  const customerId = String(sale['Customer ID'] || '');
  const originalDue = roundMoney_(Number(sale['Due Amount']) || 0);
  const state = customerId && originalDue > 0.004 ? customerSettlementState_(customerId) : null;
  return customerInvoiceSettlementSnapshotFromState_(sale, state);
}

function customerInvoiceCashCollected_(invoiceId) {
  const sale = findUniqueSalesRow_(invoiceId);
  if (!sale || isDeleted_(sale)) return 0;
  const directPaid = customerSettlementIsCashBackedMethod_(sale['Payment Method'])
    ? roundMoney_(Number(sale['Paid Amount']) || 0)
    : 0;
  const customerId = String(sale['Customer ID'] || '');
  if (!customerId) return directPaid;
  const state = customerSettlementState_(customerId);
  return roundMoney_(directPaid + (Number(state.cashByInvoice[invoiceId]) || 0));
}

function getCustomerPaymentContext(token, customerId) {
  try {
    requirePermission_(token, 'customers', 'edit');
    const customer = activeRows_('CUSTOMERS').filter(function (c) { return String(c['Customer ID'] || '') === String(customerId || ''); })[0];
    if (!customer || customer['Status'] === 'Inactive') return fail_('Customer not found or inactive.');
    const state = customerSettlementState_(customerId);
    const sales = activeRows_('SALES').filter(function (s) { return String(s['Customer ID'] || '') === String(customerId || ''); });
    const invoices = sales.map(function (s) {
      const invoiceId = String(s['Invoice ID'] || '');
      const remaining = roundMoney_(Number(state.invoiceRemaining[invoiceId]) || 0);
      return {
        invoiceId: invoiceId,
        date: safeDateOnly_(s['Date']),
        grandTotal: roundMoney_(Number(s['Grand Total']) || 0),
        remainingDue: remaining,
        cashCollected: roundMoney_(
          (customerSettlementIsCashBackedMethod_(s['Payment Method']) ? (Number(s['Paid Amount']) || 0) : 0) +
          (Number(state.cashByInvoice[invoiceId]) || 0)
        )
      };
    }).filter(function (x) { return x.remainingDue > 0.004; })
      .sort(function (a, b) { return (a.date + '|' + a.invoiceId).localeCompare(b.date + '|' + b.invoiceId); });
    return ok_({
      customerId: customerId,
      currentDue: roundMoney_(Number(customer['Current Due']) || 0),
      computedNetDue: state.computedNetDue,
      cashAdvance: state.cashAdvance,
      customerCredit: state.customerCredit,
      invoices: invoices
    });
  } catch (err) {
    logError_('getCustomerPaymentContext', err);
    return fail_(err.message);
  }
}

function getInvoicePaymentContext(token, invoiceId) {
  try {
    requirePermission_(token, 'customers', 'edit');
    const sale = findUniqueSalesRow_(invoiceId);
    if (!sale || isDeleted_(sale)) return fail_('Invoice not found.');
    const customerId = String(sale['Customer ID'] || '');
    if (!customerId) return fail_('This invoice has no linked customer.');
    const customer = activeRows_('CUSTOMERS').filter(function (c) { return String(c['Customer ID'] || '') === customerId; })[0];
    if (!customer || customer['Status'] === 'Inactive') return fail_('Customer not found or inactive.');
    const state = customerSettlementState_(customerId);
    return ok_({
      invoiceId: invoiceId,
      customerId: customerId,
      customerDue: roundMoney_(Number(customer['Current Due']) || 0),
      invoiceRemainingDue: roundMoney_(Number(state.invoiceRemaining[invoiceId]) || 0),
      cashAdvance: state.cashAdvance,
      customerCredit: state.customerCredit,
      cashCollected: customerInvoiceCashCollected_(invoiceId)
    });
  } catch (err) {
    logError_('getInvoicePaymentContext', err);
    return fail_(err.message);
  }
}
