# Products single-line tablet table implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:executing-plans with RED→GREEN checks.

**Goal:** Deliver the approved Products tablet screenshot behavior without extra product metadata or row wrapping.
**Architecture:** Update only the existing `products.html` renderer, scoped `style.html`, and current product regression tests. Maintain present stock/price data and table interaction wiring.
**Tech Stack:** HTML, Apps Script browser JS, CSS, Node test runner.
**Spec:** `docs/superpowers/specs/2026-11-04-products-tablet-single-line-design.md`

## Global Constraints
- No server modifications, production deployment, new dependencies or data-model changes.
- Keep search/filter/sort, bundle stock, action menu, pinned-header mirror, and horizontal overflow behavior.
- Preserve small-phone mobile cards.

## Review Focus
- Long names with spaces: stay in a single table cell line; full name available via tooltip.
- Custom/missing Unit: display a real unit only, never invent conversions or leave dangling slash.
- Bundle: computed Available Sets suffixed with `sets`; no visible badge in Product cell.
- Low/out of stock: visible numeric emphasis and accessible tooltip, while Status remains Active/Inactive.
- Narrow tablets: scroll sideways instead of wrapping or clipping Actions; pinned header still tracks widths.

### Task 1: Product row and column rendering
**Files:** Modify `products.html`, `tests/products_compact_inventory_ui.test.js`.
- [ ] Rewrite tests for approved one-line product/stock/price and new column order.
- [ ] Observe red test state before changes.
- [ ] Update `prodRender`: only product name in Product; inline stock unit and stock alert tooltip; no minimum stock subline or selling suffix; preserve existing row action wiring.
- [ ] Run focused tests green.

### Task 2: Tablet-specific no-wrap compact layout
**Files:** Modify `style.html`, `tests/products_compact_inventory_ui.test.js`.
- [ ] Test CSS for one-line desktop/tablet cells, minimum scrollable table width, no phone card changes.
- [ ] Observe red test state; apply module-scoped CSS and preserve product pinned header.
- [ ] Run targeted and full Node GitHub CI, then inspect PR patch and report merge readiness.

## Verification
`node --test tests/products_compact_inventory_ui.test.js tests/products_natural_scroll_sticky_header.test.js`, full `node --test tests/*.test.js`, and mocked browser gate.
Actual Apps Script preview deployment and device screenshots are separate checks and should not be claimed unless performed.
