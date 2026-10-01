# SherERP Touch Select 600px Tablet Upgrade Report

Date: 2026-09-16

## Scope

- Mobile bottom-sheet select behavior now applies only below 600px.
- Widths 600px and above use the anchored tablet/desktop select popup.
- Mobile select headers use human labels for Finance Person, Transaction Type, Expense Category, and Payee instead of raw element IDs.
- Expense Category and Payee keep their verified internal touch-scroll behavior on tablet.
- Borrower Credit remains above Borrower Debit; Finance accounting keys are unchanged.

## Runtime files changed

- expense.html
- finance.html
- javascript.html
- style.html

## Verification evidence before packaging

- New shared breakpoint/static tests: 3/3 PASS.
- Mobile/tablet real browser breakpoint probe: 22/22 PASS.
- Existing Expense tablet touch-scroll probe: 10/10 PASS.
- Existing Finance multibalance browser probe: 27/27 PASS.
- Focused Finance/Expense/static/RPC suite: 21/21 PASS.
- Full Node suite: 238/247 PASS.
- Previous production baseline: 235/244 PASS.
- The same 9 pre-existing failing UI test files remain; no new failing test file.

## Compatibility

No accounting keys, Google Sheets schemas, server posting rules, Finance balance formulas, Expense CRUD rules, or unrelated module runtime files changed.
