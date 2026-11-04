# ERP-wide compact current-module topbar

**Date:** 2026-11-05
**Request:** Replace the breadcrumb-style topbar (e.g. `POS › POS V2`) on **all** modules with only the current module name, styled smaller and plainer like the user-supplied Purchases reference.

## Source of truth and scope

- `UI.gs` provides `NAV_ITEMS` with each group’s English label and short Bangla helper. `javascript.html` `goToPage()` currently builds `Parent › Child`; the shared header is `index.html #pageTitle`; CSS in `style.html` defines desktop/tablet/mobile rendering.
- Use **the module’s top-level NAV_ITEMS label and Bangla helper**, even while a child tab is active. In particular POS V2 becomes **POS**; Draft Invoices/Returns become **Sales**; ledgers display their parent (e.g. **Customers**, **Suppliers**); child tab itself remains visible and selected beneath the header. Do not rename any navigation item or alter `goToPage` routing.
- Show English title on first line, subtle Bangla helper on second line. No breadcrumb separators, tree, chevron, or version suffix.
- Compact sizing: **16px desktop/tablet**, **15px phone**, Bangla **11px desktop/tablet** and **10px phone**. Preserve existing topbar height (56px), global date, session status, calculator, refresh, sidebar toggle, all mobile controls.
- Use existing `escapeHtml()` for safe header content, and ellipsis/truncation when horizontal space is tight. Keep the original mobile blue topbar and white text with readable muted helper.
- Only modify shared title generation and shared scoped styles; do not alter module-specific content, navigation, permissions, tabs, page identifiers, customer/POS or accounting logic.

## Test and release
- Add failing Node/source contract before changing header code, and browser checks across every navigable route.
- Confirm on 1440px desktop, 768px tablet, and 375px phone: active group label, no breadcrumb, readable helper, header controls in viewport, no overlap with date/actions.
- Existing mocked-browser suite, full Node suite, accessibility and signed-in route tests must remain green.
- PR to GitHub; **TEST Apps Script only** for visual review. Keep existing production deployment `@71` and URL unchanged.
