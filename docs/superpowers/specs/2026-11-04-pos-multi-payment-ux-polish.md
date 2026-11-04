# POS V2 Multi-Payment — Test-Only UX Polish

**Date:** 2026-11-04
**Source:** Mohim ERP current GitHub main (POS feature PR #34 already merged).
**Status:** UI refinement only, never an accounting-feature release.

## User goal
Polish the existing multi-payment checkout in POS V2 with compact, legible, consistent controls and smoother keyboard entry. Keep every existing settlement calculation, cash change, draft restoration, and permission gate intact. Production remains on deployment @70.

## Confirmed current gaps
- Changing payment method re-renders *all* payment rows, unnecessarily discarding other fields and keyboard focus.
- “Remaining” button is ambiguously labeled and its click causes focus loss.
- Removal uses a small × rather than the icon language used elsewhere in ERP.
- Multi-payment row text/buttons are smaller than the app's compact 36px controls, and the summary says “Total Received” although it actually reports *applied* funds, excluding returned cash change.

## Design
- Keep Cash/Bank/Mobile selections, bank-account choice, amounts, 20-row limit, max-one-Cash, checkout validation, and cash/session/draft logic unchanged.
- Account control updates **only its own row** when method changes, preserving the identity and entered values of other rows.
- A new row focuses its payment method. Changing method directs focus to its account selector (noncash) or amount (Cash); filling due restores focus to the affected amount. Do not steal focus on ordinary amount typing.
- Native account selectors and the existing touch-select enhancement remain authoritative.
- Replace “Remaining” with “Fill Due”; keep exact fill remaining logic. Replace visual × with a 16px SVG trash icon and keep the original accessible Remove label.
- Clear summary wording: “Paid Now / জমা” rather than “Total Received”; due stays red when positive, cash change is separated.
- 36px uniform row controls, 13px legible text and improved heading hierarchy. Keep compact mobile two-row layout.
- No new third-party libraries and no production feature-flag changes.

## Test and release safety
- Test-first source/runtime tests and mocked browser interactions, including focus, preservation of edited rows, cash-vs-noncash control, delete and fill behavior.
- Verify exact PR diff includes only POS UI/CSS/tests/docs.
- Deploy to the existing **TEST** Apps Script project only for visual review; do not enable the feature flag or post real test transactions on shared preview.
- The existing Phase 6 acceptance checklist requires a separate synthetic-data clone for transactional accounting release. This UI polish is not that sign-off.
