# Sales Return + Customer Ledger Hotfix — 2026-09-05

## Reported issues

1. New Sales Return defaulted to Cash even when the selected invoice had no invoice-level paid amount, producing: `Cash refund is limited to 0...`.
2. A Sales Return was the latest customer activity, but same-day sales appeared above it in Customer Ledger.

## Root causes

- The cash-refund guard was accounting-correct, but the UI always defaulted to Cash and did not expose invoice-level refund capacity. A due-only invoice therefore led the user directly into an impossible refund path.
- `Sales Return Credit` and `Sale Update Credit/Debit` ledger rows were written without `Created At`. Party Ledger sorted same-day rows using timestamps when present, so legacy return/correction rows were treated as midnight and appeared older than sales that actually happened before them.

## Fixes

- Sales Return now returns `cashRefundAvailable = invoice Paid Amount - prior Cash refunds`.
- If cash availability is zero, Cash Refund is disabled and `Adjust to Customer Due (Store Credit)` is selected automatically.
- Return UI shows Cash Refund Available and explains why due adjustment/store credit is required.
- Server-side cash-refund limit remains authoritative and unchanged in accounting intent.
- Party Ledger same-day chronology now uses business date plus physical append order, which also fixes existing legacy rows with missing timestamps without rewriting the Sheet.
- New Sales Return, Sale Update and Purchase Return ledger correction rows now stamp `Created By` / `Created At` where applicable.

## Important accounting rule

Generic Customer Payment rows are not allocated to a specific invoice in the current data model. The system therefore does not guess that a later general customer payment belongs to a particular invoice for cash-refund eligibility. This avoids paying cash against an invoice that cannot be proven to have collected that money.

## Verification

- New focused regression test: `tests/return_ledger_regressions.test.js`
- Full Node/static suite: 47/47 test files pass
- Global confirmation matrix: 85/85 pass
- Real Chromium production E2E: 58/58 pass
