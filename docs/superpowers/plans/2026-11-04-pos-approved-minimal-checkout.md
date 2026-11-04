# POS V2 approved minimal checkout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development task-by-task. Steps use checkbox syntax; practice TDD.

**Goal:** Replace POS V2 customer/payment card styling with the exact approved minimal HTML/CSS preview while retaining all real data and workflows.
**Architecture:** Preserve pos.html IDs and real event handlers; modify only approved presentation markup and add end-of-sheet scoped CSS in posv2.html. Use CSS container queries for available-width-responsive payment rows.
**Tech Stack:** Apps Script HTML, CSS, vanilla JS, Node test runner, Playwright mocked browser.
**Spec:** `docs/superpowers/specs/2026-11-04-pos-approved-minimal-checkout.md`

## Global Constraints
- Base: reviewed PR #44 branch `feat/pos-multi-payment-ux-polish-20261104` at `aeae20f`.
- No changes to `Sales.gs`, `SalePayments.gs`, `Config.gs`, split amount calculation or feature availability.
- No production push/deployment, no synthetic-accounting test transactions in shared preview.

## Review Focus
- 300px sidebar while desktop viewport >1023px must not overflow payment controls.
- 375px phone in Payment tab retains sticky save/complete action and no clipping.
- 768px tablet preserves customer-first checkout orientation and no two-column overlap.
- 610px panel retains five-column flat payments like the approved reference.
- Existing Customer Due and Cash Change conditional state must not be forced visible.

### Task 1 — RED visual contracts
**Files:** Create `tests/pos_minimal_checkout_parity.test.js`; modify `tests/production_gate_browser.cjs`.
- [ ] Assert exact styling tokens and flat rows, heading links, approved labels, summary order.
- [ ] Browser computed styles and bounding geometry at desktop/tablet/phone and narrow sidebar.
- [ ] Run RED before implementation.

### Task 2 — Replace presentation
**Files:** `pos.html`, `posv2.html`.
- [ ] Mark up Payments heading as standalone title + Bangla subtitle, change Add Payment into ghost action.
- [ ] Replace old boxed payment rows / totals / customer section styling with flat reference styles, preserving DOM identity.
- [ ] Add `container-type:inline-size` and @container layout for narrower actual panel widths; avoid horizontal overflow.
- [ ] Keep existing customer/draft/business logic unchanged.

### Task 3 — Verify and release test-only
- [ ] Run focused tests and full Node suite; verify mocked Playwright gate (all breakpoints).
- [ ] Confirm diff limited to POS markup/CSS/tests/docs.
- [ ] Push tested branch, update PR #44 and existing TEST Apps Script `/exec` deployment; verify production @70 unchanged.
