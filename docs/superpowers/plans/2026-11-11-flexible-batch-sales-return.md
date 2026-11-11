# Flexible Batch Sales Return Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow returns from any participating subset of opened customer invoices, independent of invoice payment status, without losing stock/ledger integrity.

**Architecture:** Reuse `returns.html` UI and the existing `completeReturn`, `completeReturnBatch`, `prepareSalesReturn_`, and `commitPreparedSalesReturn_` handlers; no new return ledger. Select contributing invoices as the payload source of truth. Remove cash-provenance gates but preserve actual cash/credit postings and all transaction validators.

**Tech Stack:** Apps Script V8, browser JavaScript, Google Sheets, Node `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-11-flexible-batch-sales-return-design.md`

## Global Constraints
- Github main is canonical; use isolated test branch, never deploy production.
- Cash refund of an unpaid invoice leaves existing customer due unchanged.
- One child Return ID per invoice with actual returned quantity, no empty records.
- Preserve split-payment journal idempotency; do not bypass validation.

## Review Focus
- Three opened invoices with one unused, two contributing: only two child returns.
- Three opened invoices with only one contributing: invoke native single-return RPC.
- Cash refund from fully-due invoice posts cash but does not mutate customer due.
- Store Credit from fully-due invoice adjusts due; no Cash Book entry.
- Failure on an invalid remaining quantity rejects before writes.

### Task 1: Regression tests for payment freedom
**Files:** `tests/multi_invoice_sales_return_regressions.test.js`, `tests/sales_return_correction_integration.test.js`, `tests/return_ledger_regressions.test.js`.
**Interfaces:** `completeReturn(token,payload)`, `completeReturnBatch(token,payload)`, `updateSalesReturn(token,payload)`.

- [ ] Add tests asserting Cash batch succeeds with one wholly unpaid child and leaves `CUSTOMERS.Current Due` unchanged; Stock, Returns and Cash Book updated.
- [ ] Add tests for Cash single return and cash method correction on unpaid invoice.
- [ ] Run red CI and establish expected failures.
- [ ] Remove cash provenance gate from `prepareSalesReturn_` and `returns.html`, edit validation paths; keep current provenance values as informational.
- [ ] Run focused and full regressions green; commit.

### Task 2: Skip unused invoice groups
**Files:** `returns.html`, `tests/multi_invoice_sales_return_regressions.test.js`.
**Interfaces:** `rtSelectedBatchPayload_()` returns only nonempty invoice children, `completeReturn` for one child, `completeReturnBatch` for 2+.

- [ ] Add executable UI tests for three opened, two/one contributing, date checks and no-quantity guard.
- [ ] Verify red; implement participant-based submit + native single-return delegation.
- [ ] Run regression green; commit.

### Task 3: Release verification and history
**Files:** Existing test files, `PROJECT.md` where useful.
- [ ] Run CI all Node tests, Playwright mocked production gate, and examine changed diff.
- [ ] Confirm cash-session, permissions, FIFO, duplicate invoice, quantity ceiling, Store Credit and return edit/delete still work.
- [ ] Open PR; leave unmerged and not deployed.
