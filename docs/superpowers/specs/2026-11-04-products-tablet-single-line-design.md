# Mohim ERP Products: single-line tablet table (2026-11-04)

## User-approved visual outcome
Follow the last tablet UI mockup in the conversation, not the older multi-line Product rendering.
- **Only the Product Name** in the Product cell: remove visible brand, unit, bundle badge, and unpriced-lots badges from that cell. Do not rewrite or hide any product name text in the data model.
- Stock renders as one inline quantity + visible unit, including `80 pcs`, `8 sets`, and `2 pcs`. Units come from existing product Unit; bundle stock uses computed Available Sets.
- No secondary minimum-stock line or selling unit suffix in this compact table. Keep existing price calculations untouched.
- Product, Category, Purchase, Selling, Stock, Stock Value, Status, Actions columns, as in the latest reference mockup.
- **Every tablet row is one visual line**. At viewport >=541px use a no-wrap table; permit horizontal scrolling if columns cannot fit without wrapping. Preserve the right-hand Actions cell and the conditional pinned table header. Long product names may truncate visually with a native title tooltip, but must remain fully available through their normal product actions.
- Keep existing small-phone (<541px) mobile card behavior, filtering, sorting, menu, accessibility, opening stock, inventory calculations, bundle logic, and Apps Script integration intact. Preserve low/out-of-stock indication through stock emphasis and tooltip; keep Status showing Active/Inactive as in the approved screenshot.
- No backend changes, new unit-conversion semantics, unrelated layout redesign, or production clasp push.

## Alternatives
A. **Chosen:** adapt the existing renderer and apply scoped CSS to `#page-products #prodTable`; test only this behavior.
B. Rebuild the table/grid from scratch: rejected (risk to sorting, scroll, action menu).
C. Hide columns to fit narrow tablets: rejected (loses purchase/stock-value information).
