# Production State-Drift Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the four remaining accounting state-drift classes in the exact production SherERP ZIP without changing unrelated production behavior.

**Architecture:** Keep CUSTOMER_LEDGER and SUPPLIER_LEDGER authoritative for later settlement activity. Reconstruct invoice/purchase settlement provenance from those ledgers, route all return/report read paths through the same reconstruction, and only reverse Cash/Bank book movements when the original payment method actually created one.

**Tech Stack:** Google Apps Script JavaScript, Google Sheets persistence, standalone Node.js regression tests.

**Spec:** `/mnt/data/SherERP-State-Drift-Audit-2026-09-08.md`

## Global Constraints

- Google Apps Script is the application runtime and Google Sheets is the database.
- Preserve existing sheet schema; no migration or new columns.
- Preserve the already-correct targeted customer-payment spillover behavior.
- Do not modify unrelated UI/responsive behavior.
- Every production change requires a regression test that fails on the production baseline and passes after the fix.

---

### Task 1: Customer refundable-cash provenance

**Files:**
- Modify: `CustomerSettlement.gs`
- Test: `tests/customer_settlement_business_logic.test.js`

- [x] Add regression for direct sale whose Payment Method is `Other`.
- [x] Verify production baseline returns refundable cash incorrectly.
- [ ] Count direct paid amount as refundable only for cash-backed methods.
- [ ] Re-run customer settlement tests.

### Task 2: Supplier settlement reconstruction

**Files:**
- Create: `SupplierSettlement.gs`
- Modify: `PurchaseManagement.gs`, `PurchaseReturn.gs`, `Reports.gs`
- Test: `tests/supplier_settlement_business_logic.test.js`, `tests/accounting_state_drift_read_paths.test.js`

- [x] Add tests for later payments, advance, discounts, returns, and `Other` provenance.
- [x] Verify baseline has no supplier settlement engine and stale read paths.
- [ ] Implement supplier ledger replay oldest-first with purchase-level provenance.
- [ ] Route purchase management/return/report reads through reconstructed state.
- [ ] Re-run supplier and read-path tests.

### Task 3: Customer return/report live settlement reads

**Files:**
- Modify: `SalesReturn.gs`, `Reports.gs`
- Test: `tests/accounting_state_drift_read_paths.test.js`

- [x] Verify baseline return/report paths show stale original Paid/Due values.
- [ ] Route search/detail/report calculations through customer settlement snapshots.
- [ ] Re-run read-path and report tests.

### Task 4: `Other` payment edit/delete reversals

**Files:**
- Modify: `DeleteEngine.gs`
- Test: `tests/audit_financial_crud.test.js`

- [x] Add customer/supplier `Other` edit/delete regression.
- [x] Verify baseline incorrectly demands Cash/Bank movement.
- [ ] Skip book reversal for methods that never created a book movement.
- [ ] Preserve legacy blank-method Cash/Bank fallback behavior.
- [ ] Re-run financial CRUD tests.

### Task 5: Production verification and packaging

**Files:**
- Test all `tests/*.test.js`
- Parse all `.gs` files individually and in Apps Script global scope.
- Package full fixed production ZIP and changed-files-only ZIP.

- [ ] Run targeted accounting suites.
- [ ] Run full Node test matrix and compare failures with untouched production baseline.
- [ ] Verify Apps Script syntax/global-scope parse.
- [ ] Fresh-extract final ZIP and rerun production gate tests.
- [ ] Generate SHA-256 hashes for deployment artifacts.
