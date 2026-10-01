/**
 * Suppliers.gs
 * ---------------------------------------------------------------------
 * CRUD for the Suppliers sheet. Surfaced as its own page, and also via
 * quick-add from Products and Purchase (inline "+ New" supplier).
 *
 * Phase 3 (permission wiring): every function here now requires a
 * session token and checks requirePermission_ before doing anything.
 * addSupplier() is gated directly (not via a separate *Checked wrapper
 * like Customer.gs) because — unlike addCustomer(), which is also called
 * server-to-server mid-sale by resolveOrCreateCustomer_ — every caller of
 * addSupplier() is a direct client action (Suppliers page, Products
 * quick-add, Purchase quick-add), so gating it here covers all three.
 * No supplier delete function exists yet (status toggle only), so there's
 * no delete-window wiring in this file.
 *
 * MERGED FINAL VERSION: also adds setSupplierStatus at the bottom.
 * suppliers.html has always called it and it existed nowhere - clicking
 * Activate/Deactivate threw "Cannot read properties of undefined
 * (reading 'apply')".
 *
 * Review item 10: the client-reachable functions here now require a
 * session token. Apps Script exposes every global function without a
 * trailing underscore to google.script.run, so an ungated one is
 * reachable by anyone holding the web app URL.
 *
 * getSuppliers and getSupplierDetail were both ungated; the second
 * returned a supplier's full ledger. Nothing in the client calls
 * getSuppliers at all - suppliers.html uses getSuppliersBootstrap - so
 * if something in your live copy does call it, it will now fail loudly
 * rather than answer silently, which is the right way round.
 *
 * Review item 6 / P0 #4: the Cash Book / Bank Book entry this function
 * writes now carries the transaction's own date instead of defaulting to
 * today, so a backdated entry no longer lands on today's cash drawer.
 *
 * P3 drift (items 6 & 7): the backdate preamble and the bank-account
 * lookup are now resolveTransactionDate_() / resolveBankAccount_() in
 * Utils.gs — same checks, same user-facing messages.
 *
 * Phase 8 (bank wiring): paySupplier() now requires a bankAccountId when
 * method is 'Bank' and writes through addBankBookEntry_ instead of doing
 * nothing (previous behavior). Also now stamps Payment Method onto the
 * Supplier Ledger row, which the column always supported but nothing was
 * writing (same gap Customer Ledger had). Debit/Credit stay flipped from
 * Customer's receivePayment, same as the existing Cash Book convention —
 * paying a supplier is money going OUT of the account, not in.
 * ---------------------------------------------------------------------
 */

function getSuppliers(token) {
  try {
    requirePermission_(token, "suppliers", "view");
    return ok_(activeRows_("SUPPLIERS"));
  } catch (err) {
    logError_("getSuppliers", err);
    return fail_(err.message);
  }
}

/** Bootstrap for the dedicated Suppliers page — mirrors getCustomersBootstrap. */
function getSuppliersBootstrap(token) {
  try {
    requirePermission_(token, "suppliers", "view");
    const suppliers = activeRows_("SUPPLIERS");
    const bankAccounts = getActiveBankAccountsForUI_();
    const settings = getSettingsMap_();
    return ok_({
      suppliers: suppliers,
      bankAccounts: bankAccounts,
      currencySymbol: settings["Currency Symbol"] || "",
    });
  } catch (err) {
    logError_("getSuppliersBootstrap", err);
    return fail_(err.message);
  }
}

function addSupplier(token, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    requirePermission_(token, "suppliers", "add");
    const name = sanitizeInput_(payload.name);
    if (!name) return fail_("Supplier name is required.");

    // activeRows_: a deleted supplier must not reserve its name forever.
    // Deletion is soft (markRowDeleted_), so the old row is still in the
    // sheet and getAllRows_ kept matching it — the name became unusable
    // even though the supplier was gone from every screen.
    //
    // Safe to let a deleted row and a live one share a name: every lookup
    // in the app keys off Supplier ID, nothing resolves a supplier by name.
    const duplicate = activeRows_("SUPPLIERS").some(function (s) {
      return String(s["Supplier Name"]).toLowerCase() === name.toLowerCase();
    });
    if (duplicate) return fail_("A supplier with this name already exists.");

    const opening = parseSignedOpeningBalance_(payload.openingBalance);
    if (opening > 0) requireActiveCashSession_();
    const id = generateId_("SUPPLIERS");
    const now = new Date();
    appendRow_("SUPPLIERS", {
      "Supplier ID": id,
      "Supplier Name": name,
      Phone: sanitizeInput_(payload.phone),
      Address: sanitizeInput_(payload.address),
      "Opening Balance": opening,
      "Current Due": opening,
      Notes: sanitizeInput_(payload.notes),
      Status: "Active",
      "Created At": now,
    });

    if (opening !== 0) {
      const openingAmounts = openingBalanceLedgerAmounts_(opening);
      appendRow_("SUPPLIER_LEDGER", {
        "Ledger ID": generateId_("SUPPLIER_LEDGER"),
        Date: now,
        "Supplier ID": id,
        "Supplier Name": name,
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
    logError_("addSupplier", err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

function updateSupplier(token, supplierId, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    requirePermission_(token, "suppliers", "edit");
    const found = findRow_("SUPPLIERS", "Supplier ID", supplierId);
    if (!found) return fail_("Supplier not found.");
    const supplier = found.row;
    const name = sanitizeInput_(payload.name);
    if (!name) return fail_("Supplier name is required.");

    const normalFields = {
      "Supplier Name": name,
      Phone: sanitizeInput_(payload.phone),
      Address: sanitizeInput_(payload.address),
      Notes: sanitizeInput_(payload.notes),
    };

    const requestedOpening = Object.prototype.hasOwnProperty.call(payload || {}, 'openingBalance')
      ? parseSignedOpeningBalance_(payload.openingBalance)
      : roundMoney_(Number(supplier['Opening Balance']) || 0);
    const oldOpening = roundMoney_(Number(supplier['Opening Balance']) || 0);

    if (Math.abs(requestedOpening - oldOpening) >= 0.005) {
      const openingUser = requirePermission_(token, "openingBalance", "edit");
      const ledgerRows = getAllRows_("SUPPLIER_LEDGER").filter(function (row) {
        return String(row['Supplier ID']) === String(supplierId);
      });
      const plan = buildOpeningBalanceCorrectionPlan_(
        'Supplier', supplier, ledgerRows, requestedOpening,
        payload.openingBalanceReason, openingUser, new Date()
      );
      applyOpeningBalanceCorrectionPlan_(plan, normalFields);
    } else {
      updateRowFields_("SUPPLIERS", found.rowIndex, normalFields);
    }
    return ok_({ id: supplierId });
  } catch (err) {
    logError_("updateSupplier", err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

/** Supplier profile + full ledger history, for the "view details" panel. */
function getSupplierDetail(token, supplierId) {
  try {
    requirePermission_(token, "suppliers", "view");
    const supplier = getAllRows_("SUPPLIERS").filter(function (s) {
      return s["Supplier ID"] === supplierId;
    })[0];
    if (!supplier) return fail_("Supplier not found.");
    const ledger = recalculateLedgerBalancesForDisplay_(
      getAllRows_("SUPPLIER_LEDGER").filter(function (l) {
        return l["Supplier ID"] === supplierId && !isDeleted_(l);
      }),
      "",
    );
    return ok_({ supplier: supplier, ledger: ledger });
  } catch (err) {
    logError_("getSupplierDetail", err);
    return fail_(err.message);
  }
}

/**
 * Records a payment made to a supplier: reduces Current Due, logs the
 * ledger entry, and pulls the money out of the Cash Book or Bank Book
 * depending on method. Mirrors Customer.gs's receivePayment with
 * Debit/Credit flipped, since paying a supplier is money going OUT —
 * including the Tier 1 backdate wiring: date/backdatedReason are new
 * trailing positional params (date optional, 'yyyy-MM-dd', defaults to
 * today), 'Date' on the Ledger row is now that value, and a new
 * 'Created At' column (added to SUPPLIER_LEDGER) keeps the real entry
 * time — same split every other backdatable module uses.
 */
function paySupplier(token, supplierId, amount, method, bankAccountId, notes, date, backdatedReason, discountAmount, discountReason) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    const actingUser = requirePermission_(token, "suppliers", "edit");
    requireActiveCashSession_();
    if (!isValidNonNegativeNumber_(amount) || Number(amount) <= 0)
      return fail_("Enter a valid payment amount.");

    const now = new Date();
    const txDate = resolveTransactionDate_(token, "suppliers", date, backdatedReason, "Payment");
    const dateStr = txDate.dateStr;

    const paymentMethod = method || "Cash";
    const resolvedBankAccountId = resolveBankAccount_(paymentMethod, bankAccountId).id;

    const rowIndex = findRowIndex_("SUPPLIERS", "Supplier ID", supplierId);
    if (rowIndex === -1) return fail_("Supplier not found.");
    const supplier = getAllRows_("SUPPLIERS").filter(function (s) {
      return s["Supplier ID"] === supplierId;
    })[0];
    if (!supplier || isDeleted_(supplier) || supplier["Status"] === "Inactive") {
      return fail_("Supplier not found or inactive.");
    }
    const currentDue = Number(supplier["Current Due"]) || 0;
    const settlement = validateSettlementDiscount_(token, "suppliers", currentDue, amount, discountAmount, discountReason);
    // Advance payment remains allowed when discount is zero. A discount cannot
    // cross the payable through zero because it is a settlement adjustment.
    const newDue = roundMoney_(currentDue - settlement.total);
    updateRowFields_("SUPPLIERS", rowIndex, { "Current Due": newDue });

    // The ledger ID is generated up front so the Cash/Bank entry can carry it
    // as its Reference. Without that link there is no way to tell which cash
    // row belongs to which payment, and editing or deleting one payment could
    // not find the money to reverse. (Older rows used the supplier ID here;
    // DeleteEngine.gs falls back to matching those on amount.)
    const ledgerId = generateId_("SUPPLIER_LEDGER");

    appendRow_("SUPPLIER_LEDGER", {
      "Ledger ID": ledgerId,
      Date: dateStr,
      "Supplier ID": supplierId,
      "Supplier Name": supplier["Supplier Name"],
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
      "Is Backdated": txDate.isBackdated,
      "Backdated Days": txDate.backdatedDays,
      "Backdated Reason": txDate.reason,
      "Created By": actorName_(actingUser),
      "Created At": now,
    });

    if (paymentMethod === "Cash") {
      addCashBookEntry_({
        Type: "Supplier Payment",
        Reference: ledgerId,
        Description: "Payment to " + supplier["Supplier Name"],
        Debit: settlement.payment,
        Credit: "",
        PaymentMethod: "Cash",
        Date: dateStr,
      });
    } else if (isBankLikePaymentMethod_(paymentMethod)) {
      addBankBookEntry_(resolvedBankAccountId, {
        Type: "Supplier Payment",
        Reference: ledgerId,
        Description: "Payment to " + supplier["Supplier Name"],
        Debit: settlement.payment,
        Credit: "",
        Date: dateStr,
      });
    }

    return ok_({ newDue: newDue, paymentAmount: settlement.payment, discountAmount: settlement.discount, totalSettled: settlement.total });
  } catch (err) {
    logError_("paySupplier", err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Activate / deactivate a supplier. There is no supplier delete - status
 * toggle only - so this is an 'edit' action, not a delete-window check,
 * the same tier as Products.gs's setProductStatus(). Note SUPPLIERS has
 * no 'Updated At' column, so none is written.
 */
function setSupplierStatus(token, supplierId, status) {
  try {
    requirePermission_(token, "suppliers", "edit");
    const rowIndex = findRowIndex_("SUPPLIERS", "Supplier ID", supplierId);
    if (rowIndex === -1) return fail_("Supplier not found.");

    const next = status === "Active" ? "Active" : "Inactive";
    updateRowFields_("SUPPLIERS", rowIndex, { Status: next });
    return ok_({ id: supplierId, status: next });
  } catch (err) {
    logError_("setSupplierStatus", err);
    return fail_(err.message);
  }
}
