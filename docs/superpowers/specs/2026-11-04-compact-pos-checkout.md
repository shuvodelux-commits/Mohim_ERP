# Mohim ERP POS V2: compact minimalist checkout

**Date:** 2026-11-04
**Reference:** User-approved POS minimal checkout design, refined by user's request that the entire checkout remains too tall.
**Source branch:** `main` @ `35aa0ef` (merged PR #44).

## Purpose and non-goals
Keep the current plain, no-card POS right-hand checkout, but make it substantially shorter vertically. Apply to customer identification, optional father/address, discount, multi/single payment, due and totals, and actions. Do not hide required inputs, reintroduce collapsible fields, remove Bangla helper labels, or change payment/customer business logic. Do not add the proposed Father/Husband type selector here: it is a separate unimplemented feature with database implications.

## Approved compactness rule
- Preserve clear hierarchy, white surface, 6px corner radius and blue Complete Sale/Grand Total emphasis.
- Customer section padding **14px 16px 12px** desktop; **12px 12px 10px** phone. Heading **15px**, title-to-fields margin **9px**.
- Customer name/phone input height **36px**, font **13px**; compact input gap **6px**; no border or clear icon removed.
- Outstanding Due margin **8px 0 7px**; unchanged color semantics.
- Always-visible Father and Address remain side-by-side desktop/tablet, stacked phone, input height **36px**, tighter label/gap.
- Sales History remains plain secondary text. Simple divider below optional fields, smaller vertical space.
- Discount remains **36px** readable control; margin before Payments **10px**, narrower input approx **110px**.
- Payments heading **14px** and Bangla helper small; Add payment ghost button height **28px**.
- Flat payment rows stay **36px per field**, 1px dividing line, reduced row padding **5px 0** desktop and **6px 0** when wrapped. Keep 5-column layout for wide panels and two-line container layout for narrow widths.
- Paid Now, Due and Cash Change use **6px summary gap**, **7px** top margin; Subtotal has simple divider with **8px** top padding.
- Grand Total stays prominent **18px**, but uses **9px** top margin and **10px 0 8px** padding.
- Checkout action buttons **40px** and same Save Draft / Complete Sale order, color, and functionality.
- Focus rings remain visible; phone fixed/sticky actions continue working; no text smaller than 11px except existing utility icons.
- Keep POS V2 desktop grid row isolation (cart stays fixed when optional customer fields grow).

## Verification
- Before implementation add failing style contracts and computed browser pixel-geometry tests.
- Verify at panel widths ~610px and narrow desktop sidebar, 768px tablet, 375px mobile; rows must not overflow.
- Run all Node regression suites, mocked browser gate including keyboard payment, customer lookup, due and drafts.
- Publish to separate PR and TEST Apps Script only, do not merge/deploy production without visual review. Production remains at @70.
