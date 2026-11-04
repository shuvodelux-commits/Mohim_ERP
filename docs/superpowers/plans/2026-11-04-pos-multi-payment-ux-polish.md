# POS V2 Multi-Payment UX Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development task-by-task, test first.

**Goal:** Improve the compact POS V2 multiple-payment controls and keyboard flow without changing accounting.
**Architecture:** Keep `posState.paymentRows` and `posMultiPaymentTerms_` intact; isolate account-control rendering in `posMultiPaymentAccountHtml_` and preserve focus for row actions. Style only `posv2.html` CSS selectors.
**Tech Stack:** Apps Script HTML, vanilla JavaScript, CSS, Node test runner, mocked Chromium.
**Spec:** `docs/superpowers/specs/2026-11-04-pos-multi-payment-ux-polish.md`

## Global Constraints
- Start from GitHub `main` @ `728e0d1`; create feature PR, do not merge it without review.
- No changes to `SalePayments.gs`, `Sales.gs`, `Config.gs`, other accounting files, or production deployment.
- Keep the flag `POS Multi Payment Enabled` disabled by default.
- Actual cash/bank posting tests must use an isolated synthetic-data clone, not the shared preview script.

## Review Focus
- Bank→Cash and Cash→Bank selector changes leave unrelated amount inputs intact.
- Custom touch-select adapter still works at tablet width.
- Adding/removing rows preserves 20-row limit and cash uniqueness.
- Fill Due never changes any other row and focuses only its selected amount.
- Cash change and Due numbers remain server-validated and distinct.

### Task 1 — RED regression tests
**Files:** Add `tests/pos_multi_payment_ux_polish.test.js`; extend `tests/production_gate_browser.cjs`.
- [ ] Assert markup, focus and row-preserving method-change contracts, icon semantics, clear paid summary, compact CSS.
- [ ] Add mocked browser tests of multiple rows and focus without any network payment posting.
- [ ] Run and confirm RED for new requirements.

### Task 2 — Focus-safe client UX
**Files:** Modify `pos.html`.
- [ ] Extract `posMultiPaymentAccountHtml_(row,label)` to reuse account markup on render/change.
- [ ] Handle method changes by replacing only `.pos-multi-account` inside selected row, not the entire list; enhance new select and focus it (or amount for Cash).
- [ ] Focus new row method on Add; focus row amount after Fill Due; use trusted trash SVG for Remove and `Fill Due` label.
- [ ] Preserve old row action semantics and revalidate on every edit.

### Task 3 — Compact consistent visual styling
**Files:** Modify `posv2.html`.
- [ ] Align row buttons and inputs to 36px, 13px text and consistent icon styles.
- [ ] Make Paid Now/Due/Change summary readable, keep phone wrapping.
- [ ] Run focused, full Node, and mocked browser tests. Open a review PR; no production deploy.
