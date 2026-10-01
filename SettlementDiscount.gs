/**
 * SettlementDiscount.gs
 * ---------------------------------------------------------------------
 * Shared accounting helpers for negotiated Customer/Supplier settlement.
 * Party ledgers use Credit = payment + discount, while Cash/Bank receives
 * only Payment Amount. Legacy payment rows have blank Payment Amount and
 * therefore fall back to their historical Credit value with zero discount.
 */

function settlementPaymentAmount_(row) {
  row = row || {};
  var raw = row['Payment Amount'];
  if (raw === '' || raw === null || raw === undefined) raw = row['Credit'];
  return roundMoney_(Number(raw) || 0);
}

function settlementDiscountAmount_(row) {
  row = row || {};
  return roundMoney_(Number(row['Discount Amount']) || 0);
}

function settlementTotalAmount_(row) {
  return roundMoney_(settlementPaymentAmount_(row) + settlementDiscountAmount_(row));
}

function validateSettlementDiscount_(token, moduleKey, currentDue, paymentAmount, discountAmount, discountReason, existingDiscountAmount, existingDiscountReason) {
  var payment = roundMoney_(Number(paymentAmount));
  var discount = discountAmount === '' || discountAmount === null || discountAmount === undefined
    ? 0 : roundMoney_(Number(discountAmount));
  var reason = sanitizeInput_(discountReason);
  var balance = roundMoney_(Number(currentDue) || 0);
  var hasExistingDiscount = existingDiscountAmount !== undefined || existingDiscountReason !== undefined;
  var oldDiscount = hasExistingDiscount ? roundMoney_(Number(existingDiscountAmount) || 0) : 0;
  var oldReason = hasExistingDiscount ? sanitizeInput_(existingDiscountReason) : '';

  if (!isValidNonNegativeNumber_(payment) || payment <= 0) throw new Error('Enter a valid payment amount.');
  if (!isValidNonNegativeNumber_(discount) || discount < 0) throw new Error('Discount cannot be negative.');

  var total = roundMoney_(payment + discount);
  var discountChanged = hasExistingDiscount
    ? (Math.abs(discount - oldDiscount) > 0.004 || (discount > 0 && reason !== oldReason))
    : discount > 0;
  if (discountChanged) requirePermission_(token, 'settlementDiscount', 'edit');

  if (discount > 0) {
    if (balance <= 0) throw new Error('Settlement discount is available only when there is a positive due balance.');
    if (!reason) throw new Error('Discount Reason is required when a settlement discount is used.');
    if (total - balance > 0.004) throw new Error('Payment plus discount cannot exceed the current due. Reduce the discount or payment amount.');
  }

  return { moduleKey: moduleKey || '', payment: payment, discount: discount, total: total, reason: reason, currentDue: balance };
}

function computeSettlementDiscountProfit_(range) {
  var customerDiscountGiven = 0;
  var supplierDiscountReceived = 0;
  activeRows_('CUSTOMER_LEDGER').forEach(function (row) {
    if (row['Type'] !== 'Payment') return;
    if (!inRange_(safeDateOnly_(row['Date']), range)) return;
    customerDiscountGiven += settlementDiscountAmount_(row);
  });
  activeRows_('SUPPLIER_LEDGER').forEach(function (row) {
    if (row['Type'] !== 'Payment') return;
    if (!inRange_(safeDateOnly_(row['Date']), range)) return;
    supplierDiscountReceived += settlementDiscountAmount_(row);
  });
  customerDiscountGiven = roundMoney_(customerDiscountGiven);
  supplierDiscountReceived = roundMoney_(supplierDiscountReceived);
  return {
    customerDiscountGiven: customerDiscountGiven,
    supplierDiscountReceived: supplierDiscountReceived,
    netProfitImpact: roundMoney_(supplierDiscountReceived - customerDiscountGiven)
  };
}

/**
 * Replays one party ledger up to the position immediately before a payment.
 * proposedDate lets correction validation test the balance at a newly chosen
 * Business Date without rewriting any historical running-balance cells.
 */
function settlementBalanceBeforePayment_(sheetKey, partyIdColumn, partyId, ledgerId, proposedDate) {
  var rows = activeRows_(sheetKey).filter(function (row) {
    return String(row[partyIdColumn] || '') === String(partyId || '');
  });
  var target = rows.filter(function (row) { return String(row['Ledger ID'] || '') === String(ledgerId || ''); })[0];
  if (!target) throw new Error('Payment not found for settlement validation.');
  var candidate = Object.assign({}, target);
  if (proposedDate) candidate['Date'] = proposedDate;
  var candidateKey = ledgerSortKey_(candidate);
  var candidateRowIndex = Number(target._rowIndex) || Number.MAX_SAFE_INTEGER;
  var balance = 0;
  rows.filter(function (row) { return String(row['Ledger ID'] || '') !== String(ledgerId || ''); })
    .sort(function (a, b) {
      var ak = ledgerSortKey_(a), bk = ledgerSortKey_(b);
      if (ak !== bk) return ak.localeCompare(bk);
      return (Number(a._rowIndex) || 0) - (Number(b._rowIndex) || 0);
    })
    .forEach(function (row) {
      var key = ledgerSortKey_(row);
      var rowIndex = Number(row._rowIndex) || 0;
      if (key > candidateKey || (key === candidateKey && rowIndex >= candidateRowIndex)) return;
      balance = roundMoney_(balance + (Number(row['Debit']) || 0) - (Number(row['Credit']) || 0));
    });
  return roundMoney_(balance);
}
