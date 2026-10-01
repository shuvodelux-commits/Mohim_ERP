# Expense Tablet Dropdown Internal Scroll Fix

Date: 2026-09-16

## Scope

Corrects the Expense tablet Category and Payee dropdown behavior.

- Main page scrolling closes an open dropdown as before.
- Swiping inside the open Category or Payee option list scrolls that list itself.
- A swipe does not accidentally select an option or dismiss the list.
- Lower options remain selectable after scrolling.
- The behavior is scoped to Expense Category and Payee on tablet.
- Finance Borrower display order remains Borrower Credit before Borrower Debit from the previous approved build.

## Production files changed

- `expense.html`
- `javascript.html`

No accounting or server-side business logic changed.

## Verification

- Expense tablet real touch-swipe probe: 10/10 PASS.
- Expense Payee/History browser probe: 8/8 PASS.
- Party/Expense browser probe: 12/12 PASS.
- Finance multi-balance browser probe: 27/27 PASS.
- Static Apps Script/HTML/RPC/security gate: 20/20 PASS; 183 public functions audited.
- Full Node suite: 235/244 PASS. The same 9 pre-existing UI test files fail as in the prior production build; no new failing test file.
