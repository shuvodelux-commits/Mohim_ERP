# Production Confirmation Transaction Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce one production-ready SherERP ZIP in which every confirmation-modal transaction posts exactly the values shown to the user and preserves stock, party-ledger, cash/bank, return, and audit invariants.

**Architecture:** Treat confirmation dialogs as a presentation layer only. The authoritative transaction payload must be the same normalized payload used to render the confirmation and to execute the backend mutation. Audit every financial write path for stale-original-value reuse, ignored changed entity IDs, amount drift, and incorrect reversal/settlement classification. Preserve the Google Apps Script + Google Sheets architecture and existing soft-delete/audit model.

**Tech Stack:** Google Apps Script JavaScript, Google Sheets, HTML/JS frontend, Node.js regression tests.

**Spec:** User request and current production codebase; prior confirmed state-drift/customer/supplier identity fixes are cumulative baseline requirements.

## Global Constraints

- Google Apps Script is the runtime and Google Sheets is the database.
- No schema migration unless a proven accounting invariant cannot be maintained without it.
- Confirmation UI must never alter or reinterpret transaction values after the user confirms.
- Existing audit history must remain visible; correction rows must not masquerade as cash/payment settlement.
- Selected Customer/Supplier IDs are authoritative when explicitly selected; phone/name fallback must never silently choose among duplicates.
- Every production-code change requires a failing regression first, then a passing regression, then broad verification.
- Final delivery must be tested from a fresh extraction of the actual ZIP.

---

### Task 1: Build cumulative production baseline

**Files:**
- Base: `SherERP-PRODUCTION-HARDENED-v2-CustomerIdentity-2026-09-08.zip`
- Overlay: all subsequent verified production-only patches through Purchase Supplier Reassignment.

**Interfaces:**
- Consumes: prior verified patch ZIPs.
- Produces: one cumulative source tree used for all following tests.

- [ ] Verify each overlay contains only the expected production files.
- [ ] Apply overlays in chronological order and record file hashes.
- [ ] Run syntax/global-scope baseline checks before new audit work.

### Task 2: Inventory confirmation-modal transaction paths

**Files:**
- Inspect: `javascript.html`, `pos.html`, `purchase.html`, `counter.html`, `returns.html`, `sales.html`, `suppliers.html`, `customers.html`, `finance.html`, `bank.html`, related `.gs` mutation modules.
- Test: create `tests/confirmation_transaction_payload_integrity.test.js`.

**Interfaces:**
- Consumes: every UI confirmation action and its RPC/backend mutation.
- Produces: matrix mapping displayed confirmation fields -> submitted payload fields -> authoritative backend fields.

- [ ] Enumerate create/update/delete/payment/return/transfer/opening-balance/vendor/expense transaction confirmations.
- [ ] Flag any path where confirmation renders from one object but backend receives/reuses another object.
- [ ] Add static assertions preventing stale-original entity/amount reuse in known update paths.

### Task 3: Adversarial transaction identity and amount tests

**Files:**
- Test: `tests/confirmation_transaction_payload_integrity.test.js`
- Modify production files only when a failing case proves a bug.

**Interfaces:**
- Produces invariants for customer/supplier reassignment, amount changes, payment method changes, discounts, dates, and bank selection.

- [ ] Customer sale: change customer after loading/edit/draft; assert invoice + customer ledger use selected Customer ID.
- [ ] Purchase: change supplier; assert purchase + supplier ledger + lot provenance use selected Supplier ID.
- [ ] Sale/Purchase edit amount up/down; assert reversal and replacement amounts exactly match confirmed values.
- [ ] Payment/receipt edit: amount, discount, method, bank, party; assert cash/bank and party ledger agree.
- [ ] Expense edit: category/payee/amount/method/bank; assert daybook/cash-bank/audit agree.
- [ ] Sales/Purchase return: quantity/value/refund method; assert stock, party ledger, cash provenance, returned totals agree.
- [ ] Opening balance edit/delete: assert only intended party and balance change.
- [ ] Bank/finance transfer edit/delete where supported: assert both sides remain balanced.

### Task 4: Cross-ledger accounting invariants

**Files:**
- Extend: `tests/state_drift_accounting_invariants.test.js` or new audit test file.

**Interfaces:**
- Produces end-to-end invariants independent of UI labels.

- [ ] Customer current due = active debit obligations - valid settlement credits/payments.
- [ ] Supplier current payable = active purchase obligations - valid payments/returns/credits.
- [ ] Cash/Bank money movement equals only cash-backed transaction amounts, never correction credits.
- [ ] Stock movement reconciles with sales, purchases, returns, and deleted/edited documents.
- [ ] Invoice/Purchase Paid/Due/Status matches settlement reconstruction after repeated edits.
- [ ] Delete/reversal leaves zero active financial effect for the deleted document.

### Task 5: Confirmation-system regression suite and full verification

**Files:**
- Run all existing `tests/confirmation_*.test.js` plus financial/business-rule suites.

**Interfaces:**
- Produces production gate evidence.

- [ ] Run confirmation-specific tests.
- [ ] Run financial CRUD, settlement, return, dashboard, reports, identity, draft, and security suites.
- [ ] Run all repository Node tests and compare remaining failures with baseline.
- [ ] Parse every `.gs` file, all combined server globals, and inline HTML scripts.
- [ ] Scan for duplicate server function names and broken RPC references.

### Task 6: Package and verify final production ZIP

**Files:**
- Create final full ZIP and a changed-files-only ZIP.
- Include `PRODUCTION_CONFIRMATION_TRANSACTION_AUDIT.md`.

**Interfaces:**
- Produces deployable artifacts.

- [ ] Build final ZIP from the cumulative tested tree.
- [ ] Fresh-extract the final ZIP to a new directory.
- [ ] Re-run critical accounting/confirmation tests on the extracted delivery.
- [ ] Record SHA-256 hashes and exact known pre-existing failures, if any.
