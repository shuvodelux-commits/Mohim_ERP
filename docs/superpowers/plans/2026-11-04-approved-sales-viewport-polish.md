# Mohim ERP — Approved Sales List viewport polish (2026-11-04)

## Approved design / constraints
- Preserve the established Mohim ERP app (do not substitute the illustrative mockup's invented navbar, sales data or metrics).
- Sales invoice list: show the word Actions in the top-right table header, with the existing accessible three-dot trigger in every row.
- Right-pinned Actions must remain visible during horizontal tablet scrolling but look like a regular flat column: no added border-left / edge separator / shadow. Do not remove normal table row separators.
- Make the non-phone app topbar sticky within normal flow instead of fixed with extra content top margin; preserve the fixed sidebar and phone-specific layout.
- Compact Sales tabs/filters and scrollbar without hiding date, payment, return-status, refresh, search or profit controls. Use a grid at desktop/tablet, gracefully two rows on tablet.
- Make the Sales table viewport height responsive so more invoice rows are visible. Keep vertical and horizontal table scrolling, right-edge Actions, keyboard/accessibility, menu callbacks and print overflow safety.
- No backend or financial schema change. No GitHub main merge or production Apps Script deployment without separate approval.

## Test-first evidence / acceptance
- tests/sales_approved_polish.test.js started RED (5/5), then GREEN.
- Update baseline assertions for the old fixed topbar and three-dot Actions header: old assumptions no longer match approved UX.
- Full Node suite and mocked Chromium browser gate must pass; the new browser checks verify sticky topbar geometry, one-row desktop / compact two-row tablet filters, and action edge visuals.
- Deploy to the existing verified test Apps Script only after CI is green; PR #35 stays draft.
