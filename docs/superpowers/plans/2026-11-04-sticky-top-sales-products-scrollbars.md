# Pinned top scrollbar implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans; use test-driven development and verification gates.

**Goal:** Put an interactive horizontal scrollbar immediately above the fixed Sales and Products headings.
**Architecture:** Each module owns a fixed sibling scrollbar synchronized to the existing horizontally scrolling table and in-flow top scrollbar. Reuse the current cloned fixed headers and layout measurement logic; no framework or extra state service.
**Tech Stack:** Apps Script HTML/JS/CSS, Node test runner, mocked Playwright production gate.
**Spec:** `docs/superpowers/specs/2026-11-04-sticky-top-sales-products-scrollbars.md`

## Global Constraints
- Rebase target: PR #40 branch `fix/products-tablet-single-line-20261104`.
- No production deploy; no unrelated table/ledger changes.
- No inner vertical scrolling and no duplicate IDs in mirrored headings.
- No changes to data or sale/inventory calculations.

## Review Focus
1. Horizontal overflow is absent: no empty fixed slider and no shifted heading.
2. Narrow tablet: fixed slider appears and its thumb scrolls all table columns bidirectionally while Actions remain pinned.
3. Header not yet pinned, page hidden, or mobile card viewport: fixed slider is hidden.
4. Re-render/resize or column width changes: slider thumb width and offset recompute.
5. Fixed slider must not obscure cloned header, topbar or touch/keyboard interactions.

### Task 1: Regression contracts and browser tests
**Files:** `tests/sticky_top_sales_products_scrollbar.test.js`, `tests/production_gate_browser.cjs`.
- [ ] Add failing tests for fixed bars, original Products bar, synchronization, visibility, geometry, and desktop/tablet interaction.
- [ ] Run RED in CI from draft PR.

### Task 2: Implement Sales fixed scrollbar
**Files:** `sales.html`, `style.html`.
- [ ] Create a single keyboard-focusable fixed scroll track outside the table overflow container, next to `smPinnedSalesHeader`.
- [ ] When pinned and overflowing, place it immediately above the cloned heading; keep `smTopScroll` and the actual table synchronized both directions.
- [ ] Update the relevant Sales browser assertion for measured top bar height.

### Task 3: Implement Products fixed + in-flow scrollbar
**Files:** `products.html`, `style.html`.
- [ ] Insert original top track above `prodTableScroll`, and add its synchronization on render/resize.
- [ ] Add the equivalent fixed track above `prodPinnedHeader`, synchronized with table and in-flow track.
- [ ] Preserve sort, actions, no-wrap tablet columns, and phone card layout.

### Task 4: Verify and review
- [ ] Run new Node tests and product/Sales pinned header tests; run full CI including 65+ mocked browser checks.
- [ ] Verify PR diff is limited to planned files and document preview deployment steps (no automatic push).
