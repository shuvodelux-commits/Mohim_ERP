# Products Table Compact UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans task-by-task using RED/GREEN checks.

**Goal:** Compact and clarify Product rows using their existing stock unit.
**Architecture:** Keep `products.html` renderer and `style.html` styles; preserve the existing data and interactions.
**Tech Stack:** Google Apps Script HTML, browser JavaScript, CSS, Node built-in test runner.
**Spec:** `docs/superpowers/specs/2026-11-04-products-compact-stock-unit-design.md`.

## Global Constraints
No backend changes; no new Unit column or fictitious multi-unit conversion; no change to product sort/filter/action logic, mobile cards, horizontal scrolling or pinned header; no production deployment.

## Review Focus
- Missing product Unit: no dangling slash.
- Stored 'pc', 'pcs', 'Kg' and custom units: human-readable without mutation.
- Inactive products with stock: remain Inactive rather than In stock.
- Bundles: use available sets, not physical stock/stock value; retain special action semantics.
- Existing sort headers and sticky cloned header stay aligned with new column order.

### Task 1: Product table markup and renderer
**Files:** `products.html`; tests `tests/products_compact_inventory_ui.test.js`.
**Interfaces:** Consume existing product fields `Current Stock`, `Minimum Stock`, `Unit`, `Brand`, `Selling Price`, `Status`, `Product Type`, `Available Sets`.
- [ ] Write failing source/format unit tests for column order, unit placement, stock minimum, status badges, no repeated unit beneath name.
- [ ] Verify RED against current `main` code.
- [ ] Modify renderer minimally, retaining Sort keys, action triggers, pinned-head builder and search logic.
- [ ] Verify GREEN with new tests and existing products scrolling tests.
- [ ] Commit.

### Task 2: Scoped row spacing and responsive safeguards
**Files:** `style.html`; tests `tests/products_compact_inventory_ui.test.js`.
- [ ] Add failing test for scoped row typography, two-line stock/prices and compact desktop spacing.
- [ ] Verify RED; add scoped CSS without changing mobile card or pinned-header rules.
- [ ] Verify GREEN and broader regression tests.
- [ ] Commit and submit review PR.

## Verification
`node --test tests/products_compact_inventory_ui.test.js tests/products_natural_scroll_sticky_header.test.js`
`node --test tests/*.test.js`
`node --check` on extracted `products.html` script.
Manual browser verification is required on deployed Apps Script preview; GitHub-only checks do not establish actual browser behavior.
