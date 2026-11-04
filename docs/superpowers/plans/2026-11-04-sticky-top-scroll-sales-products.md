# Sticky Top Scrollbar: Sales and Products Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement each tested task with RED→GREEN before proceeding.

**Goal:** Make the existing Sales top scrollbar and new Products top scrollbar sticky above the mirrored table headers, synchronized with their local horizontal scroll containers.

**Architecture:** Retain the current Sales `smTopScroll` logic and existing sticky header mirrors. Add an analogous Products source bar, style both as a thin sticky native scrollbar, and offset the existing header mirrors by the visible scrollbar height. No new external scripts or modules.

**Tech Stack:** Google Apps Script HTML/CSS/vanilla JavaScript; Node built-in tests, Playwright mocked-Apps Script browser gate.

**Spec:** `docs/superpowers/specs/2026-11-04-sticky-top-scroll-sales-products.md`

## Global Constraints
- No production `clasp` calls, Google Sheets changes, or backend code.
- Preserve the Sales top-bar IDs/functions, bottom floating scrollbar and existing pinned-header/action semantics.
- Preserve Products PR #40 compact single-line tablet table; branch from PR #40 head rather than from `main`.
- Use existing document scroll container `#content`, and local horizontal `#smTableScroll` / `#prodTableScroll`; hide on phone/print.

## Review Focus
- Overflows only after rows render or viewport resize: bar appears and width becomes scrollWidth.
- No overflow: bar disappears and mirror offset returns to content top.
- On tablet vertical scroll: track remains above cloned heading, not below it or hidden.
- Both directions: top track scrolls table; table and cloned heading follow without feedback loops.
- Mobile cards and other pages: no stray bar or pinned mirror remains visible.

### Task 1: Tests (RED)
**Files:** Create `tests/sales_products_sticky_top_scroll.test.js`; modify `tests/production_gate_browser.cjs`.
- [ ] Write source-level expectations for both bars, sticky styling and pinned-header geometry.
- [ ] Add mocked browser checks for visible sticky bar above mirrored heading at tablet width and two-way synchronization.
- [ ] Run GitHub Actions on test-only commit and confirm expected assertions fail (not syntax errors).

### Task 2: Sales scrollbar stays sticky
**Files:** Modify `sales.html`, `style.html`.
- [ ] Keep existing `smTopScroll` and sync handlers; make its track sticky, style teal thumb.
- [ ] Offset the Sales header mirror when the top bar is visible; update its visibility measurement after each render.
- [ ] Run focused regression suite.

### Task 3: Products scrollbar and cross-module verification
**Files:** Modify `products.html`, `style.html`.
- [ ] Add one `prodTopScroll` above the existing table; measure overflow on data render and resize/navigation.
- [ ] Synchronize it in both directions with table `scrollLeft`; place Products header mirror just below the sticky track.
- [ ] Run entire GitHub regression workflow including the mocked browser gate and inspect PR; do not merge or deploy automatically.

## Verification
`node --test tests/sales_products_sticky_top_scroll.test.js tests/products_natural_scroll_sticky_header.test.js tests/sales_natural_scroll_pinned_header.test.js`
`node tests/sales_horizontal_scrollbar_ui.test.js`
`node tests/production_gate_browser.cjs` in CI with Playwright installed.
Full GitHub regression workflow before ready-for-review.
