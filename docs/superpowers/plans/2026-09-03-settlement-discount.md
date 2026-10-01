# Settlement Discount Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add audited settlement discounts to Customer Receivable and Supplier Payable payments while keeping actual Cash/Bank movement separate from non-cash discount settlement.

**Architecture:** Extend existing Customer/Supplier Payment ledger rows with additive payment/discount fields. Central helpers provide legacy-safe payment/discount/total values and validation; payment create/edit/cancel and Correction Engine use those helpers so party balance uses total settlement while Cash/Bank uses actual money only. Profit and Day Book read the same source rows without a new database sheet.

**Tech Stack:** Google Apps Script JavaScript, Google Sheets, HTML/vanilla JavaScript UI, Node-based regression tests.

**Spec:** `docs/superpowers/specs/2026-09-03-settlement-discount-design.md`

## Global Constraints
- Google Apps Script is the runtime and Google Sheets is the database.
- Schema changes must be additive and legacy rows must remain readable.
- No transaction logic may trust browser-calculated accounting values.
- Cash/Bank records actual money only.
- Discount must never silently create an advance.
- Existing Correction Engine, FIFO, return, permission, locking, recovery, and audit invariants remain authoritative.

---

### Task 1: Settlement model, schema, permission, and create flows

**Files:**
- Modify: `Config.gs`
- Modify: `UI.gs`
- Create: `SettlementDiscount.gs`
- Modify: `Customer.gs`
- Modify: `Suppliers.gs`
- Test: `tests/settlement_discount.test.js`

**Interfaces:**
- Produces: `settlementPaymentAmount_(row)`, `settlementDiscountAmount_(row)`, `settlementTotalAmount_(row)`, `validateSettlementDiscount_(token,moduleKey,currentDue,paymentAmount,discountAmount,discountReason)`.

- [ ] Step 1: Add failing tests proving additive ledger columns, edit-only Settlement Discount permission, legacy-safe helper semantics, validation rules, Customer receive flow, and Supplier pay flow.
- [ ] Step 2: Run `node tests/settlement_discount.test.js` and confirm failure is caused by the missing feature.
- [ ] Step 3: Add the schema/permission/helper code and wire Customer/Supplier create flows so `Credit = payment + discount`, `Payment Amount = payment`, and Cash/Bank uses payment only.
- [ ] Step 4: Run `node tests/settlement_discount.test.js` and confirm Task 1 checks pass.

### Task 2: Day Book and profit reporting

**Files:**
- Modify: `DayBook.gs`
- Modify: `Reports.gs`
- Modify: `reports.html`
- Test: `tests/settlement_discount.test.js`

**Interfaces:**
- Consumes Task 1 settlement helpers.
- Produces profit totals `customerSettlementDiscount`, `supplierSettlementDiscountReceived`, `settlementDiscountNetImpact`.

- [ ] Step 1: Extend failing tests so Day Book proves actual payment-only cash/bank movement and Profit proves customer discount decreases and supplier discount increases net profit.
- [ ] Step 2: Run the feature test and observe the new failures.
- [ ] Step 3: Implement Day Book and Profit changes and surface both settlement-discount totals on the Profit tab.
- [ ] Step 4: Run the feature test and confirm Task 2 checks pass.

### Task 3: Audited edit/cancel integration

**Files:**
- Modify: `DeleteEngine.gs`
- Modify: `CorrectionFinancialAdapters.gs`
- Modify: `CorrectionCancellation.gs`
- Test: `tests/settlement_discount.test.js`

**Interfaces:**
- Customer/Supplier Payment editable payload gains `amount`, `discountAmount`, `discountReason`.
- Party due delta uses old/new total settled; `postCorrectionMoneyEffects_` uses old/new actual payment.

- [ ] Step 1: Add failing tests for edit payloads, correction plan impacts, permission/discount validation, and cancellation restoring total settlement while reversing only actual money.
- [ ] Step 2: Run the feature test and confirm expected failures.
- [ ] Step 3: Implement legacy-safe edit, correction and cancellation behavior.
- [ ] Step 4: Run the feature test and existing correction suites.

### Task 4: Customer/Supplier UI

**Files:**
- Modify: `customers.html`
- Modify: `suppliers.html`
- Test: `tests/settlement_discount.test.js`

**Interfaces:**
- Create RPCs add trailing `discountAmount`, `discountReason` arguments.
- Correction payloads add `discountAmount`, `discountReason`.

- [ ] Step 1: Add failing UI contract tests for Discount Given/Received, required reason, live totals, Settle Full Balance, special-permission gating, RPC payloads, and edit modal fields.
- [ ] Step 2: Run feature test and confirm UI failures.
- [ ] Step 3: Implement both UI flows using server-authoritative validation.
- [ ] Step 4: Run feature test and UI/correction regression suites.

### Task 5: Final verification and packaging

**Files:**
- Modify: `PROJECT.md`
- Create final ZIP outside project tree.

**Interfaces:** None.

- [ ] Step 1: Document Settlement Discount behavior and deployment requirement to run `setupSystem_()`.
- [ ] Step 2: Run every `tests/*.test.js` file and require zero failures.
- [ ] Step 3: Run Apps Script syntax, HTML script syntax, RPC mapping, duplicate top-level function, and conflict-marker checks.
- [ ] Step 4: Package the full project ZIP, extract it to a clean directory, and repeat the full verification against the extracted artifact.
