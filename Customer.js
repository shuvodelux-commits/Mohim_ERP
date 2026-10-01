/**
 * Customer.gs
 * ---------------------------------------------------------------------
 * Customer records exist to track who owes the shop money. Every due
 * change — a due sale, a payment received — is mirrored into Customer
 * Ledger so "Current Due" on the Customers sheet always has a full,
 * auditable trail behind it, never just an edited number.
 *
 * Review item 10: the client-reachable functions here now require a
 * session token. Apps Script exposes every global function without a
 * trailing underscore to google.script.run, so an ungated one is
 * reachable by anyone holding the web app URL.
 *
 * getCustomerDetail returned a customer's full profile and complete
 * ledger to anyone. It now checks 'customers':'view'.
 *
 * addCustomer was public but ungated. Its only caller is
 * addCustomerChecked (which IS gated), so it becomes the private
 * addCustomerLocked_ rather than gaining a token it doesn't need. The
 * three-way split now reads: addCustomerLocked_ (locks, private),
 * addCustomer_ (no lock, for callers already holding one), and
 * addCustomerChecked (the gated client entry point).
 *
 * Review item 6 / P0 #4: the Cash Book / Bank Book entry this function
 * writes now carries the transaction's own date instead of defaulting to
 * today, so a backdated entry no longer lands on today's cash drawer.
 *
 * Review item 5 / P0 #2: addCustomer used to take its own script lock,
 * and resolveOrCreateCustomer_ calls it from inside completeSale /
 * updateSale / completeReturn, which already hold that lock. The nested
 * release dropped the caller's lock mid-sale. It is now split: the
 * unlocked addCustomer_ does the work, and addCustomer stays as the
 * locked wrapper for the paths that genuinely arrive without one
 * (addCustomerChecked from the Customers page, and direct calls).
 *
 * Phase 2 (permission wiring): getCustomersBootstrap/updateCustomer/
 * deleteCustomer/receivePayment now require a session token and check
 * requirePermission_/requireDeletePermission_ before doing anything.
 * addCustomer() itself is deliberately left ungated — resolveOrCreateCustomer_
 * (the quick-create-on-sale path used by Sales.gs/SalesManagement.gs/
 * SalesReturn.gs) calls it directly mid-sale and must never require a
 * separate permission check there. The Customers page instead calls the
 * new addCustomerChecked() wrapper below.
 *
 * P3 drift (items 6, 7 & 9): the backdate preamble and the bank-account
 * lookup are now resolveTransactionDate_() / resolveBankAccount_() in
 * Utils.gs. deleteCustomer() also now refuses to delete a customer whose
 * Current Due isn't zero — the ledger rows survive by design, but
 * Current Due is what getDashboardStats sums for dueReceivable, so
 * deleting one silently erased a live receivable from the Dashboard.
 *
 * Phase 8 (bank wiring): receivePayment() now requires a bankAccountId
 * when method is 'Bank' and writes through addBankBookEntry_ instead of
 * doing nothing (previous behavior — Bank was already a selectable
 * method with no account to post to). Also now stamps Payment Method
 * onto the Customer Ledger row, which the column always supported but
 * nothing was writing.
 *
 * Also removed a stray leftover `Output;` that was sitting above this
 * comment block — dead code, not part of any real logic; flagging in
 * case it wasn't in the live copy.
 * ---------------------------------------------------------------------
 */

function getCustomersBootstrap(token) {
  try {
    requirePermission_(token, "customers", "view");
    const customers = activeRows_("CUSTOMERS");
    const bankAccounts = getActiveBankAccountsForUI_();
    const settings = getSettingsMap_();
    return ok_({
      customers: customers,
      bankAccounts: bankAccounts,
      currencySymbol: settings["Currency Symbol"] || "",
    });
  } catch (err) {
    logError_("getCustomersBootstrap", err);
    return fail_(err.message);
  }
}

/**
 * Resolves one customer account for a transaction. When the UI supplied a
 * Customer ID (for example a restored draft), that exact active customer is
 * authoritative. Denormalized name/phone snapshots are canonicalized by the
 * sale/edit caller from the Customer master, so the resolver never rejects a
 * valid selected ID because an old draft/invoice still carries stale phone text.
 * Without an ID, a unique
 * active phone match is reused; ambiguous duplicate-phone rows fail closed
 * instead of silently splitting the ledger. If no match exists, quick-create
 * keeps the existing POS behavior. Not permission-gated — see file header.
 */
function resolveOrCreateCustomer_(name, phone, address, fatherName, preferredCustomerId) {
  const cleanPhone = normalizePhoneDisplay_(phone);
  const preferredId = sanitizeInput_(preferredCustomerId);
  const customers = getAllRows_("CUSTOMERS");

  // A selected Customer ID is the strongest identity signal. This matters for
  // drafts and sale edits: historical data may already contain duplicate phone
  // rows, and silently resolving by phone alone can post the transaction to a
  // different customer account than the operator selected.
  if (preferredId) {
    const selected = customers.filter(function (c) {
      return String(c["Customer ID"] || "") === preferredId;
    })[0];
    if (!selected) {
      throw new Error("Selected customer was not found. Re-select the customer before posting this transaction.");
    }
    if (isDeleted_(selected) || selected["Status"] === "Inactive") {
      throw new Error("This customer is inactive. Reactivate the customer before posting a new transaction.");
    }
    return selected["Customer ID"];
  }

  if (cleanPhone) {
    const matches = customers.filter(function (c) {
      return phoneNumbersEqual_(c["Phone"], cleanPhone);
    });
    const activeMatches = matches.filter(function (c) {
      return !isDeleted_(c) && c["Status"] !== "Inactive";
    });
    if (activeMatches.length === 1) return activeMatches[0]["Customer ID"];
    if (activeMatches.length > 1) {
      throw new Error("More than one active customer uses this phone number. Select the exact customer before posting this transaction.");
    }
    if (matches.length) {
      throw new Error("This customer is inactive. Reactivate the customer before posting a new transaction.");
    }
  }

  const cleanName = sanitizeInput_(name);
  if (!cleanName || cleanName === "Walk-in Customer") {
    throw new Error(
      "A customer name and phone are needed to track this against an account.",
    );
  }
  // addCustomer_ , not addCustomer: every caller of this helper
  // (completeSale, updateSale, completeReturn) already holds the lock.
  const created = addCustomer_({
    name: cleanName,
    phone: cleanPhone,
    address: sanitizeInput_(address),
    fatherName: sanitizeInput_(fatherName),
    openingBalance: 0,
  });
  if (!created.success) throw new Error(created.message);
  return created.data.id;
}

/**
 * Locked entry point. Private: the only caller is addCustomerChecked,
 * which does the permission check. Use addCustomer_ from a path that
 * already holds the script lock.
 */
function addCustomerLocked_(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    return addCustomer_(payload);
  } finally {
    lock.releaseLock();
  }
}

/** The actual work, with no lock of its own. Caller must hold the script lock. */
function addCustomer_(payload) {
  try {
    const name = sanitizeInput_(payload.name);
    const phone = normalizePhoneDisplay_(payload.phone);
    if (!name) return fail_("Customer name is required.");
    if (!phone) return fail_("Phone number is required.");

    const duplicate = getAllRows_("CUSTOMERS").some(function (c) {
      return phoneNumbersEqual_(c["Phone"], phone);
    });
    if (duplicate)
      return fail_("A customer with this phone number already exists.");

    const opening = parseSignedOpeningBalance_(payload.openingBalance);
    const id = generateId_("CUSTOMERS");
    const now = new Date();

    appendRow_("CUSTOMERS", {
      "Customer ID": id,
      "Customer Name": name,
      "Father Name": sanitizeInput_(payload.fatherName),
      Phone: phone,
      Address: sanitizeInput_(payload.address),
      "Opening Balance": opening,
      "Current Due": opening,
      Status: "Active",
      Notes: sanitizeInput_(payload.notes),
      "Created At": now,
    });

    if (opening !== 0) {
      const openingAmounts = openingBalanceLedgerAmounts_(opening);
      appendRow_("CUSTOMER_LEDGER", {
        "Ledger ID": generateId_("CUSTOMER_LEDGER"),
        Date: now,
        "Customer ID": id,
        "Customer Name": name,
        Type: "Opening Balance",
        Reference: id,
        Debit: openingAmounts.Debit,
        Credit: openingAmounts.Credit,
        Balance: opening,
        Notes: "",
        "Created At": now,
      });
    }

    return ok_({ id: id });
  } catch (err) {
    logError_("addCustomer_", err);
    return fail_(err.message);
  }
}

/** Client-facing, permission-checked entry point for creating a customer from the Customers page. See file header for why addCustomer() itself stays ungated. */
function addCustomerChecked(token, payload) {
  try {
    requirePermission_(token, "customers", "add");
    const opening = parseSignedOpeningBalance_(payload && payload.openingBalance);
    if (opening > 0) requireActiveCashSession_();
    return addCustomerLocked_(payload);
  } catch (err) {
    logError_("addCustomerChecked", err);
    return fail_(err.message);
  }
}

function updateCustomer(token, customerId, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    requirePermission_(token, "customers", "edit");
    const found = findRow_("CUSTOMERS", "Customer ID", customerId);
    if (!found) return fail_("Customer not found.");
    const customer = found.row;
    const name = sanitizeInput_(payload.name);
    if (!name) return fail_("Customer name is required.");

    const normalFields = {
      "Customer Name": name,
      "Father Name": sanitizeInput_(payload.fatherName),
      Phone: normalizePhoneDisplay_(payload.phone),
      Address: sanitizeInput_(payload.address),
      Notes: sanitizeInput_(payload.notes),
    };

    const requestedOpening = Object.prototype.hasOwnProperty.call(payload || {}, 'openingBalance')
      ? parseSignedOpeningBalance_(payload.openingBalance)
      : roundMoney_(Number(customer['Opening Balance']) || 0);
    const oldOpening = roundMoney_(Number(customer['Opening Balance']) || 0);

    if (Math.abs(requestedOpening - oldOpening) >= 0.005) {
      const openingUser = requirePermission_(token, "openingBalance", "edit");
      const ledgerRows = getAllRows_("CUSTOMER_LEDGER").filter(function (row) {
        return String(row['Customer ID']) === String(customerId);
      });
      const plan = buildOpeningBalanceCorrectionPlan_(
        'Customer', customer, ledgerRows, requestedOpening,
        payload.openingBalanceReason, openingUser, new Date()
      );
      applyOpeningBalanceCorrectionPlan_(plan, normalFields);
    } else {
      updateRowFields_("CUSTOMERS", found.rowIndex, normalFields);
    }
    return ok_({ id: customerId });
  } catch (err) {
    logError_("updateCustomer", err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

/** Customer profile + full ledger history, for the "view details" panel. */
function getCustomerDetail(token, customerId) {
  try {
    requirePermission_(token, "customers", "view");
    const customer = getAllRows_("CUSTOMERS").filter(function (c) {
      return c["Customer ID"] === customerId;
    })[0];
    if (!customer) return fail_("Customer not found.");
    assertCustomerSalesIntegrity_(customerId);
    const ledger = recalculateLedgerBalancesForDisplay_(
      getAllRows_("CUSTOMER_LEDGER").filter(function (l) {
        return l["Customer ID"] === customerId && !isDeleted_(l);
      }),
      "",
    );
    return ok_({ customer: customer, ledger: ledger });
  } catch (err) {
    logError_("getCustomerDetail", err);
    return fail_(err.message);
  }
}

/**
 * Permanently deletes a customer row. Gated behind BOTH the existing
 * 'Delete Confirmation Key' Settings entry (a "type the key to confirm"
 * guard against accidental deletes, not real access control) AND the
 * role-based delete-window check (requireDeletePermission_, using the
 * customer's Created At as its record date since customers don't have a
 * more natural transaction date). Now also writes a Delete Log row. Does
 * not touch Customer Ledger history — those rows stay as a record even
 * after the customer itself is gone.
 */
function deleteCustomer(token, customerId, confirmKey) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    const rowIndex = findRowIndex_("CUSTOMERS", "Customer ID", customerId);
    if (rowIndex === -1) return fail_("Customer not found.");
    const customer = getAllRows_("CUSTOMERS").filter(function (c) {
      return c["Customer ID"] === customerId;
    })[0];

    // A non-zero balance blocks the delete. Customer Ledger rows are kept on
    // purpose, but Current Due is the figure getDashboardStats sums into
    // dueReceivable — so deleting a customer who still owes money made a real
    // receivable disappear from the Dashboard with no trace.
    const outstandingDue = Number(customer["Current Due"]) || 0;
    if (outstandingDue !== 0) {
      return fail_(
        outstandingDue > 0
          ? "This customer still owes " +
              outstandingDue +
              ". Settle the due before deleting."
          : "This customer holds a store credit of " +
              Math.abs(outstandingDue) +
              ". Clear it before deleting.",
      );
    }

    const user = requireDeletePermission_(
      token,
      "customers",
      safeDateOnly_(customer["Created At"]),
    );

    const requiredKey = sanitizeInput_(
      getSettingsMap_()["Delete Confirmation Key"],
    );
    if (!requiredKey)
      return fail_(
        'No delete confirmation key is set. Add one in the Settings sheet ("Delete Confirmation Key") before deleting customers.',
      );
    if (sanitizeInput_(confirmKey) !== requiredKey)
      return fail_("Incorrect confirmation key.");

    deleteRow_("CUSTOMERS", rowIndex);
    logDeletion_(
      "customers",
      customerId,
      "",
      "Customer deleted via Customers page",
      user,
    );
    return ok_({ id: customerId });
  } catch (err) {
    logError_("deleteCustomer", err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Records a due payment: reduces Current Due, logs the ledger entry, and
 * puts the money into the Cash Book or Bank Book depending on method.
 * date (optional, 'yyyy-MM-dd' — defaults to today), backdatedReason
 * (required only when date is in the past).
 */
function receivePayment(token, customerId, amount, method, bankAccountId, notes, date, backdatedReason, discountAmount, discountReason, allocatedInvoiceId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    const actingUser = requirePermission_(token, "customers", "edit");
    requireActiveCashSession_();
    if (!isValidNonNegativeNumber_(amount) || Number(amount) <= 0)
      return fail_("Enter a valid payment amount.");

    const now = new Date();
    const txDate = resolveTransactionDate_(token, "customers", date, backdatedReason, "Payment");
    const dateStr = txDate.dateStr;

    const paymentMethod = method || "Cash";
    const resolvedBankAccountId = resolveBankAccount_(paymentMethod, bankAccountId).id;

    const rowIndex = findRowIndex_("CUSTOMERS", "Customer ID", customerId);
    if (rowIndex === -1) return fail_("Customer not found.");
    const customer = getAllRows_("CUSTOMERS").filter(function (c) {
      return c["Customer ID"] === customerId;
    })[0];
    if (!customer || isDeleted_(customer) || customer["Status"] === "Inactive") {
      return fail_("Customer not found or inactive.");
    }
    const currentDue = Number(customer["Current Due"]) || 0;
    const settlement = validateSettlementDiscount_(token, "customers", currentDue, amount, discountAmount, discountReason);
    const targetInvoiceId = sanitizeInput_(allocatedInvoiceId);

    // Validate invoice allocation before the first financial write. Blank means
    // normal oldest-due-first allocation; a selected invoice is settled only
    // up to its own remaining due. Only Cash/Bank/Mobile Banking excess is
    // cash-backed Customer Advance; untracked methods remain non-cash credit.
    customerPaymentPreview_(customerId, dateStr, settlement.payment, settlement.discount, targetInvoiceId, "", paymentMethod);

    // Overpayment/advance remains allowed when discount is zero. A discount,
    // however, is bounded by validateSettlementDiscount_ so it cannot create advance.
    const newDue = roundMoney_(currentDue - settlement.total);
    updateRowFields_("CUSTOMERS", rowIndex, { "Current Due": newDue });

    // Generated up front so the Cash/Bank entry below can carry it as its
    // Reference. That link is what lets one payment later be edited or
    // deleted with exactly its own money reversed and nothing else.
    const ledgerId = generateId_("CUSTOMER_LEDGER");

    appendRow_("CUSTOMER_LEDGER", {
      "Ledger ID": ledgerId,
      Date: dateStr,
      "Customer ID": customerId,
      "Customer Name": customer["Customer Name"],
      Type: "Payment",
      Reference: "PAYMENT",
      Debit: "",
      Credit: settlement.total,
      Balance: newDue,
      Notes: sanitizeInput_(notes),
      "Payment Method": paymentMethod,
      "Payment Amount": settlement.payment,
      "Discount Amount": settlement.discount || "",
      "Discount Reason": settlement.discount > 0 ? settlement.reason : "",
      "Allocated Invoice ID": targetInvoiceId,
      "Is Backdated": txDate.isBackdated,
      "Backdated Days": txDate.backdatedDays,
      "Backdated Reason": txDate.reason,
      "Created By": actorName_(actingUser),
      "Created At": now,
    });

    if (paymentMethod === "Cash") {
      addCashBookEntry_({
        Type: "Customer Payment",
        Reference: ledgerId,
        Description: "Due payment from " + customer["Customer Name"],
        Debit: "",
        Credit: settlement.payment,
        PaymentMethod: "Cash",
        Date: dateStr,
      });
    } else if (isBankLikePaymentMethod_(paymentMethod)) {
      addBankBookEntry_(resolvedBankAccountId, {
        Type: "Customer Payment",
        Reference: ledgerId,
        Description: "Due payment from " + customer["Customer Name"],
        Debit: "",
        Credit: settlement.payment,
        Date: dateStr,
      });
    }

    return ok_({
      newDue: newDue,
      paymentAmount: settlement.payment,
      discountAmount: settlement.discount,
      totalSettled: settlement.total,
      allocatedInvoiceId: targetInvoiceId
    });
  } catch (err) {
    logError_("receivePayment", err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Refunds available Customer Credit. The public function name is retained for
 * compatibility with existing deployed clients, but the user-facing model is
 * now one balance: overpayments/advance and Sales Return credit are both
 * refundable up to the customer's actual available credit.
 */
function refundCustomerAdvance(token, customerId, amount, method, bankAccountId, notes, date, backdatedReason) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    const actingUser = requirePermission_(token, "customers", "edit");
    requireActiveCashSession_();
    if (!isValidNonNegativeNumber_(amount) || Number(amount) <= 0) {
      return fail_("Enter a valid credit refund amount.");
    }

    const now = new Date();
    const txDate = resolveTransactionDate_(token, "customers", date, backdatedReason, "Credit Refund");
    const dateStr = txDate.dateStr;
    const paymentMethod = method || "Cash";
    if (["Cash", "Bank", "Mobile Banking"].indexOf(paymentMethod) === -1) {
      return fail_("Credit Refund must be paid from Cash, Bank, or Mobile Banking.");
    }
    const resolvedBankAccountId = resolveBankAccount_(paymentMethod, bankAccountId).id;

    const rowIndex = findRowIndex_("CUSTOMERS", "Customer ID", customerId);
    if (rowIndex === -1) return fail_("Customer not found.");
    const customer = getAllRows_("CUSTOMERS").filter(function (c) {
      return c["Customer ID"] === customerId;
    })[0];
    if (!customer || isDeleted_(customer) || customer["Status"] === "Inactive") {
      return fail_("Customer not found or inactive.");
    }

    const state = customerSettlementState_(customerId);
    const currentDue = roundMoney_(Number(customer["Current Due"]) || 0);
    if (Math.abs(roundMoney_(state.computedNetDue - currentDue)) > 0.01) {
      return fail_("Customer balance needs review before refunding credit.");
    }

    const refundAmount = roundMoney_(Number(amount));
    const previewState = customerCreditRefundPreview_(customerId, dateStr, refundAmount);
    if (refundAmount > roundMoney_(state.customerCredit) + 0.005) {
      return fail_("Credit refund is limited to " + roundMoney_(state.customerCredit) + " of available Customer Credit.");
    }

    const newDue = roundMoney_(currentDue + refundAmount);
    const ledgerId = generateId_("CUSTOMER_LEDGER");

    updateRowFields_("CUSTOMERS", rowIndex, { "Current Due": newDue });
    appendRow_("CUSTOMER_LEDGER", {
      "Ledger ID": ledgerId,
      Date: dateStr,
      "Customer ID": customerId,
      "Customer Name": customer["Customer Name"],
      // Retain historical type for compatibility with existing reports/audit.
      Type: "Advance Refund",
      Reference: "CREDIT REFUND",
      Debit: refundAmount,
      Credit: "",
      Balance: newDue,
      Notes: sanitizeInput_(notes),
      "Payment Method": paymentMethod,
      "Payment Amount": refundAmount,
      "Discount Amount": "",
      "Discount Reason": "",
      "Allocated Invoice ID": "",
      "Is Backdated": txDate.isBackdated,
      "Backdated Days": txDate.backdatedDays,
      "Backdated Reason": txDate.reason,
      "Created By": actorName_(actingUser),
      "Created At": now
    });

    if (paymentMethod === "Cash") {
      addCashBookEntry_({
        Type: "Customer Advance Refund",
        Reference: ledgerId,
        Description: "Credit refund to " + customer["Customer Name"],
        Debit: refundAmount,
        Credit: "",
        PaymentMethod: "Cash",
        Date: dateStr
      });
    } else if (isBankLikePaymentMethod_(paymentMethod)) {
      addBankBookEntry_(resolvedBankAccountId, {
        Type: "Customer Advance Refund",
        Reference: ledgerId,
        Description: "Credit refund to " + customer["Customer Name"],
        Debit: refundAmount,
        Credit: "",
        Date: dateStr
      });
    }

    return ok_({
      ledgerId: ledgerId,
      refundedAmount: refundAmount,
      newDue: newDue,
      customerCreditRemaining: roundMoney_(previewState.customerCredit),
      cashAdvanceRemaining: roundMoney_(previewState.cashAdvance)
    });
  } catch (err) {
    logError_("refundCustomerAdvance", err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}
