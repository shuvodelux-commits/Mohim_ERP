# Products list - continuous page scrolling and sticky headings

## User acceptance
- User supplied a Products screenshot with a table whose inner vertical scroll is capped, and requested the same fix previously approved for Sales.
- The main Products list must scroll continuously with the module page. Its table headings pin directly below the application topbar only after the real heading scrolls above that boundary.
- Horizontal scrolling remains local, and a flat right-pinned Actions column remains visible on tablet. Use the compact three-dot trigger already established in Sales.
- Preserve Product, Category, Purchase Price, Selling Price, Stock Qty, Stock Value and Status sorting, keyboard/touch focus, current filters/search and original Edit, Adjust Stock, View Lots, Activate and Delete callbacks.
- Do not alter other Product dialogs, Stock Lots, financial data, product RPCs, mobile-card rendering, printing or production Apps Script.

## Implementation
- Scoped page-products / prodTableScroll CSS removes capped max-height and retains overflow-x.
- Conditional pinned header mirror follows the outer content scroll, clones actual column widths, and synchronizes horizontal position. Mirrored Product sort buttons delegate to existing prodSortKey_ and update after rerender; clone never duplicates source IDs.
- Hide mirrored header when Products inactive, on phones and in print.
- Pin Actions right using existing erp-sticky-action-col and compact accessible shared trigger; preserve prodOpenActionMenu_ handlers.

## Verification
- RED before changes, GREEN after: tests/products_natural_scroll_sticky_header.test.js.
- Mocked browser: continuous page scroll, heading boundary, horizontal alignment, sortable mirror, rightmost Actions, unchanged menu callbacks, phone cards, route transition.
- Local full Node: 635/635 pass; browser: 65/65 pass across 28 routes.
- CI required before test-only Apps Script deployment. Main remains unchanged pending PR acceptance, production script never pushed.
