# SherERP Mobile PWA-Style Responsive UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Implement the approved mobile/PWA-style SherERP interface without changing accounting or server behavior.

**Architecture:** Extend the existing shared shell (`index.html`, `javascript.html`, `style.html`) with one adaptive mobile layer. Reuse the existing page/table DOM and navigation source, adding opt-in mobile-card table classes and shared client enhancement so modules do not duplicate data or business logic.

**Tech Stack:** Google Apps Script HTML Service, vanilla HTML/CSS/JavaScript, Google Sheets backend.

**Spec:** `docs/superpowers/specs/2026-09-03-mobile-pwa-responsive-ui-design.md`

## Global Constraints

- Google Apps Script remains the application runtime.
- Google Sheets remains the database and accounting source of truth.
- No service worker or offline transactional cache in this pass.
- No server API or accounting behavior changes are required.
- Desktop behavior above 860px must remain usable and high-density.
- Phone behavior is optimized at <=640px.
- Permissions remain server-authoritative and navigation remains filtered from `NAV_ITEMS`.

---

### Task 1: Shared mobile shell

**Files:**
- Modify: `index.html`
- Modify: `javascript.html`
- Modify: `style.html`
- Test: `tests/mobile_pwa_ui.test.js`

**Interfaces:**
- Consumes: existing `NAV_ITEMS`, `goToPage`, `navGroupFor_`, `filterNavByRole_`.
- Produces: `buildMobileNav_`, `syncMobileNavigation_`, `openMobileMore_`, `closeMobileMore_` and mobile shell markup.

- [x] Write tests asserting viewport meta, five-item bottom navigation, More sheet, and desktop/sidebar preservation.
- [x] Run the mobile UI test and confirm failure because the shell does not exist.
- [x] Add mobile shell markup, navigation functions and responsive CSS.
- [x] Run the test and confirm it passes.

### Task 2: Shared mobile interaction primitives

**Files:**
- Modify: `javascript.html`
- Modify: `style.html`
- Test: `tests/mobile_pwa_ui.test.js`

**Interfaces:**
- Consumes: existing DOM tables and `.action-menu` implementation.
- Produces: `enhanceMobileCardTables_` and responsive bottom-sheet styling for action menus/modals.

- [x] Add failing assertions for card-label enhancement, bottom-sheet action menus, full-screen phone modals, stacked toolbars and 44px touch targets.
- [x] Run test and confirm failure.
- [x] Implement table-header label assignment via shared enhancer/MutationObserver and CSS primitives.
- [x] Run test and confirm pass.

### Task 3: Dashboard mobile experience

**Files:**
- Modify: `dashboard.html`
- Modify: `style.html`
- Test: `tests/mobile_pwa_ui.test.js`

**Interfaces:**
- Consumes: existing Dashboard data and `goToPage`.
- Produces: mobile Quick Actions and marked dashboard card tables.

- [x] Add failing assertions for Quick Actions, compact two-column stats and dashboard card-table classes.
- [x] Run test and confirm failure.
- [x] Add mobile-only Quick Actions and mark suitable dashboard tables.
- [x] Run test and confirm pass.

### Task 4: High-frequency operational lists

**Files:**
- Modify: `sales.html`
- Modify: `purchase.html`
- Modify: `customers.html`
- Modify: `suppliers.html`
- Modify: `products.html`
- Modify: `vendors.html`
- Modify: `expenseList.html`
- Modify: `financeLedger.html`
- Test: `tests/mobile_pwa_ui.test.js`

**Interfaces:**
- Consumes: existing table rows/renderers and Actions handlers.
- Produces: `.mobile-card-table` opt-in on primary operational lists only.

- [x] Add failing assertions that each primary list opts into mobile cards while complex ledgers/detail tables are not globally forced into card mode.
- [x] Run test and confirm failure.
- [x] Mark only the primary operational tables.
- [x] Run test and confirm pass.

### Task 5: Payment, POS and Purchase phone ergonomics

**Files:**
- Modify: `customers.html`
- Modify: `suppliers.html`
- Modify: `pos.html`
- Modify: `purchase.html`
- Modify: `style.html`
- Test: `tests/mobile_pwa_ui.test.js`

**Interfaces:**
- Consumes: existing settlement-discount, POS and purchase state/functions.
- Produces: presentation-only mobile wrappers/classes.

- [x] Add failing assertions for payment summary/mobile class hooks, POS mobile layout and Purchase touch/line-entry rules.
- [x] Run test and confirm failure.
- [x] Add semantic mobile classes and CSS without changing submit payloads or calculations.
- [x] Run test and confirm pass.

### Task 6: Regression and packaging

**Files:**
- Update: `PROJECT.md`
- Verify: all `tests/*.test.js` plus `tests/vendor_workspace_actions_expense_test.js`

**Interfaces:**
- Produces: production ZIP verified from a fresh extraction.

- [x] Run the full test suite from project root.
- [x] Run Apps Script and HTML JavaScript syntax checks.
- [x] Run RPC target mapping and duplicate top-level function checks.
- [x] Package the full project ZIP.
- [x] Extract ZIP into a fresh directory and rerun the same verification against the exact artifact.
