# SherERP Mobile PWA-Style Responsive UI Design

**Date:** 2026-09-03  
**Status:** Approved  
**Reference:** User-approved four-screen SherERP mobile mockup  
**Runtime:** Google Apps Script  
**Database:** Google Sheets

## Goal

Make SherERP feel like a native mobile business app on phones while preserving the current high-density desktop ERP. This is a presentation and interaction redesign only: existing accounting, stock, permissions, correction, reporting, server APIs, and Google Sheets data remain authoritative.

## Breakpoints

- Phone: `<= 640px`
- Tablet / compact desktop: `641px-860px`
- Desktop: `> 860px`

## Mobile Shell

- Add a correct mobile viewport meta tag with safe-area support.
- Keep a sticky blue app bar on phones with menu, page title, refresh and calculator controls.
- Add a fixed bottom navigation with Dashboard, POS, Sales, Purchase, More.
- More opens an app-style full module sheet containing all role-visible modules not already represented as primary bottom destinations.
- Keep the existing desktop sidebar and grouped sub-navigation behavior unchanged above the mobile breakpoint.
- Page navigation, permission filtering and active state continue to use `NAV_ITEMS` as the single source of truth.

## Mobile Page Patterns

- Content padding becomes compact and bottom-padded so the fixed navigation never hides content.
- Touch targets are at least 44px where practical.
- Toolbars stack, search inputs become full width and primary actions remain easy to reach.
- Standard forms become one-column.
- Shared dialogs become nearly full-screen on phones, with sticky headers/footers and safe-area padding.
- Existing action menus become bottom sheets on phones.
- Tabs remain horizontal and scrollable.

## Mobile Lists

High-frequency operational tables should become card-like records on phones. The desktop table DOM remains the source so there is no duplicate server load or duplicated accounting logic. A shared client enhancer assigns column labels from table headers, and CSS renders marked tables as cards.

Initial card-table targets:
- Sales invoice list
- Purchase invoice list
- Customers
- Suppliers
- Products
- Vendors
- Expense list
- Finance ledger
- Dashboard recent activity, top products, expense summary, debtors, bank and low-stock lists

Complex accounting/report/detail tables remain horizontal-scroll tables rather than losing column relationships.

## Dashboard

- Phone stat cards use a compact two-column grid.
- Add a mobile-only Quick Actions row for POS, Sales, Purchase and Customer Payment/Customers.
- Recent activity and other compact dashboard lists use card presentation.

## Customer / Supplier Payment

- Payment areas become one-column mobile cards.
- Settlement Discount fields, Total Settled, Balance After and Settle Full Balance remain visible and touch-friendly.
- Detail/ledger dialogs use full-screen mobile presentation with sticky actions.

## POS / Purchase

- Preserve current business logic and item calculations.
- Stack the POS layout on phone and improve touch sizing/spacing.
- Purchase form and line-entry sections become compact one-column/scroll-safe mobile layouts.
- Do not create a separate mobile API or duplicate transaction state.

## PWA Feeling vs Offline Behavior

This pass intentionally does not add service-worker/offline transaction caching. Google Sheets and Apps Script remain the live authority, avoiding stale stock, due and accounting state. The result should look and behave like an installable mobile app, but transactional screens remain online-authoritative.

## Acceptance Criteria

1. Phone viewport renders at device width without desktop-scale zoom.
2. Bottom nav matches the approved mockup pattern and respects permissions.
3. More menu exposes all visible ERP modules.
4. Desktop sidebar remains unchanged above 860px.
5. High-frequency lists render as touch-friendly cards at <=640px and normal tables on desktop.
6. Action menus render as phone bottom sheets without breaking desktop positioning.
7. Shared modals are full-screen/near-full-screen and usable with the on-screen keyboard.
8. Dashboard is compact with a two-column overview and Quick Actions.
9. Customer/Supplier settlement-discount workflows remain fully usable on phone.
10. Existing accounting/server behavior and the complete regression suite remain green.
