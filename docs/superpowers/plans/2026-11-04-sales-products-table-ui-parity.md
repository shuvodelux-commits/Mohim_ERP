# Sales & Products visual-parity implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or subagent-driven-development task-by-task. Test changes with RED/GREEN cycles.

**Goal:** Make Products and Sales visually identical in typography, header metrics, and icon-based Actions presentation, using Sales as the canonical style.
**Architecture:** Retain both existing renderers. Switch Products to the shared Sales/global menu and align module-scoped table CSS. Preserve the PR #42 top scrollbars and pinned headings.
**Tech Stack:** Google Apps Script HTML/CSS/JS, Node test runner and mocked Chromium integration gate.
**Spec:** `docs/superpowers/specs/2026-11-04-sales-products-table-ui-parity.md`

## Global Constraints
- Branch based on `feat/sticky-top-hscroll-sales-products-20261104`, which includes PR #40.
- No production deployment and no Apps Script edits.
- Do not drop Bundle, Stock/Lots, Activate/Deactivate, Delete, sorting, sticky header, mobile cards, or horizontal scroll.
- Match Sales table header 12px and body 14px, row/header padding and menu icon behavior; keep Products no-wrap only.

## Review Focus
1. Bundle menu lacks Stock/Lots but keeps Edit, Deactivate/Activate, Delete, with icon for every action.
2. Stock/Lots product actions still dispatch to original handlers and do not change persisted data.
3. Tablet 768px header, cloned heading, font size and icon/menu geometry match Sales.
4. Escape/ArrowDown/ArrowUp work and action focus returns to the trigger (Sales helper behavior).
5. Product long names stay one line; phone cards and sticky top scrollbar behavior do not regress.

### Task 1: Test the approved visual metrics and shared menu
**Files:** Create `tests/sales_products_table_visual_parity.test.js`; modify `tests/production_gate_browser.cjs`.
- [ ] Write tests that fail against existing Product typography/menu divergence.
- [ ] Verify RED in GitHub CI, including actual computed browser typography at tablet viewport.
- [ ] Commit.

### Task 2: Reuse shared Products action menu
**Files:** `products.html`, `javascript.html`.
- [ ] Replace old Product-only menu rendering/handlers with `openRowActionMenu_` and existing product callbacks.
- [ ] Keep all Product menu items, Bundle guard, status actions and focus conventions.
- [ ] Add trusted icons for `stock` and `lots`.
- [ ] Run focused tests and verify browser menu checks.

### Task 3: Apply identical table typography and heading treatments
**Files:** `style.html`.
- [ ] Scope shared Sales+Products heading/cell metrics at >=541px and match cloned headings.
- [ ] Remove Products-only smaller tablet font and row padding overrides; restore normal body weight.
- [ ] Preserve Product no-wrap ellipsis, accent for low stock, and phone card typography rules.
- [ ] Run static tests and full CI, inspect diff, mark PR review-ready only when green.

## Verification
Node all suites; mocked-browser Chromium gate; explicit Sales-to-Products style comparison at 768px.
