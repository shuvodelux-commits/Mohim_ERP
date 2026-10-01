# Customer/Supplier Ledger Search — POS/Counter Style

Date: 2026-09-09

## Scope
- Customer Ledger party picker
- Supplier Ledger party picker
- Shared party search result rendering
- Ledger-only popup styling

## Behavior
- Counter-style result cards: bold name, small phone underneath
- Bounded popup directly below input; maximum 20 matching results
- Blank focus stays closed; no full-party dump
- Bangla/English phone normalization preserved
- Partial/multi-word name matching preserved
- Arrow Up/Down, Enter and Escape preserved
- Existing ERP search-clear (×) preserved
- Selection closes popup immediately
- No ledger/accounting/settlement/print mutation logic changed

## Production files changed vs previous audited build
- customerLedger.html
- supplierLedger.html
- javascript.html
- style.html

## Verification
- New POS/Counter-style Ledger search acceptance: 4/4 PASS
- Party Ledger UI: 12/12 PASS
- Party Ledger workspace: 10/10 PASS
- Clean Ledger projection: 16/16 PASS
- Browser Party/Expense probe: 12/12 PASS
- Production static gate: PASS
- Full Node test-file suite: 59 PASS / 9 pre-existing UI/responsive FAIL (same exact failure set as previous audited build)
