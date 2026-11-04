# Father / Husband Relationship Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement task-by-task. Test first; use checkpoint commits.

**Goal:** User quickly chooses Father or Husband in POS and Add/Edit Customer, saved and printed with correct type.
**Architecture:** Retain existing father-name-value fields for compatibility; add enum `relationType` and two additive invoice snapshot fields. Existing POS and Customer UI data paths unchanged other than the extra property.
**Tech Stack:** Apps Script HTML/CSS/JS, Google Sheets via Config header schema, Node test runner, mocked Playwright.
**Spec:** `docs/superpowers/specs/2026-11-04-pos-customer-father-husband.md`

## Constraints
- Do not change accounting or payment code; no new dependency.
- Type is `Father` or `Husband`, default `Father` for all legacy rows.
- Preserve existing field IDs (`posCustomerFatherName`, `custFatherName`) and column `Father Name`.
- Only separate TEST Apps Script deployment; production @70 unchanged.
- PR base `feat/pos-v2-compact-checkout-20261104` until PR #45 merged.

### Task 1: TDD RED
- [ ] Create unit/source contracts for UI selectors, field labeling, customer + draft + invoice storage, print formatting, and legacy default.
- [ ] Add mocked-browser flow for toggling POS and Customer Add/Edit; verify selection is present in payload and restoring drafts.
- [ ] Run tests to confirm failure before code.

### Task 2: Additive server persistence
- [ ] Add schema headers in `Config.gs` for CUSTOMERS / SALES / SALES_DRAFTS.
- [ ] Add relation normalization and persistence to `Customer.gs` add/update, due-only auto-create; expose it via `Sales.gs` bootstrap.
- [ ] Snapshot type+name on `Sales.gs` completeSale and `SalesManagement.gs` update sale.
- [ ] Persist relation type on drafts; restore in `DraftSales.gs` and POS.
- [ ] Add `Invoice.gs` invoice snapshots with legacy Customer fallback and print label change in `javascript.html`.

### Task 3: Compact UI & verification
- [ ] Add POS and Customer modal selector preserving name; labels update on change.
- [ ] Test old customer/draft without relation type defaults Father; new Husband persists.
- [ ] Full Node suite + browser mock; no customer data loss, account posts, or invoice changes except display label.

### Task 4: PR and TEST deploy
- [ ] Push stacked PR, wait for CI or run same browser gate locally.
- [ ] TEST-only Apps Script push + update existing URL. Verify prod unchanged.
