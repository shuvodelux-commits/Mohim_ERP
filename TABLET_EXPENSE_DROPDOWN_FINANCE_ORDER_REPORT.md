# Tablet Expense Dropdown + Finance Borrower Order Patch

Date: 2026-09-16

## Production changes

Only these runtime files changed:
- `expense.html`
- `javascript.html`
- `finance.html`

## Expense tablet dropdown fix

`expCategory` and `expPayee` opt into a tablet-only scroll-stable touch-select policy. When the main `.content` scroller moves while either picker is open, the menu stays open and is re-anchored to its trigger. The option list itself remains independently scrollable. Other shared selects retain the existing close-on-page-scroll behavior.

## Finance transaction order

Only visible ordering changes. The Borrower group now renders:
1. Borrower Credit (`Borrower Repayment` stable key)
2. Borrower Debit (`Borrower Loan` stable key)

Stored transaction keys, balance effects, cash direction, edit/delete behavior, and Sheets data are unchanged.

## Verification

- New tablet Expense touch-select browser probe: 10/10 PASS
- Existing Expense Payee/History browser probe: 8/8 PASS
- Existing Party/Expense browser probe: 12/12 PASS
- Existing Finance multi-balance browser probe: 27/27 PASS, including browser verification that Borrower Credit renders above Borrower Debit
- Apps Script/inline HTML/RPC static gate: PASS
- Public RPC security: 183/183 audited
- Full Node suite: 234/243 PASS
- The 9 failures are the same pre-existing UI test files as the previous production build:
  - counter_acceptance.test.js
  - counter_customer_receive.test.js
  - counter_ui_primitives.test.js
  - mobile_pwa_ui.test.js
  - mockup_module_design.test.js
  - pos_tablet_exact_mockup.test.js
  - pos_tablet_recent_drafts.test.js
  - sidebar_grouped_collapse.test.js
  - tablet_responsive_shell.test.js
