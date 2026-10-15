# Finance Person Ledger — Approved Design

**Date:** 2026-10-14
**Status:** Approved; implementation in isolated PR.
**Base:** `shuvodelux-commits/Mohim_ERP` `main`.

## Goal
Extend the existing Finance Ledger to show a dedicated person statement for finance Owners, Lenders, and Borrowers, visually matching `customerLedger.html`. Preserve all existing Finance transactions, historical cash baseline behavior, roles, edits, deletes, permissions, opening balances, and Cash/Bank posting.

## UX layout lock
- Retain the existing All Transactions Finance Ledger in its entirety and as the default view.
- Add an unobtrusive `All Transactions | Person Ledger` switch *inside* the existing `financeLedger.html` page; no new navigation route.
- Person Ledger MUST use the same component structure as `customerLedger.html`: `.party-ledger-toolbar` with one searchable person selector, Record Transaction and Print Ledger actions; `.party-ledger-party-card` with one complete-history balance; `.party-ledger-list-card` transaction table and 50/100/200 pagination; compact mobile cards and standard row Actions menu.
- Reuse the single existing `finLedPersonSearch` combobox and its `createPartySearchCombobox_` handlers rather than implementing another search input.
- For multi-role people show compact Owner / Lender / Borrower role selectors *within* the person card. Only the selected relationship balance and transactions are displayed; do not net relationships.
- Keep the user in the original Business Finance form to post transactions, with the existing `addFinanceTransaction` RPC. Preselect the active finance person when navigating from a person ledger.
- Existing inactive people are readable, but not eligible for a new transaction.
- Print and CSV must show the relationship statement amounts with period opening and closing. All Transactions print/export behavior remains unchanged.
- Preserve current UI tokens and Bangla helpers; no new cards for unrelated finance dashboard KPIs.

## Read-only relationship statement debit/credit
Finance's existing `getFinanceLedger` API returns cash-direction `debit` and `credit`. Do not change these, because they are already used by All Transactions and other reports. Project a *display-only* person statement from the returned original `amount`, `balance`, `account`, and the already-exposed `FINANCE_TRANSACTION_TYPES` metadata:

| Stored type | Relationship debit | Relationship credit |
|---|---|---|
| Opening Owner Capital | — | amount |
| Owner Investment | — | amount |
| Owner Withdrawal | amount | — |
| Opening Loan | — | amount |
| Loan Received | — | amount |
| Loan Repayment | amount | — |
| Opening Borrower Loan | amount | — |
| Borrower Loan | amount | — |
| Borrower Repayment | — | amount |

For owner and lender liabilities: signed closing = opening + credit − debit. For borrower receivables: signed closing = opening + debit − credit. Existing per-person `row.balance` is authoritative; never recalculate a financial posting or change money books.

## Period and identity rules
- Obtain complete person history through the *existing* permission-checked `getFinanceLedger(token,filters)` using personId. Do not date-filter before constructing statement opening/closing.
- Project account-specific transactions client-side; date and pagination affect display only.
- Period opening = last chronological account balance strictly before From Date (zero if no earlier entries); closing = last account balance up to To Date (or current complete history when To Date is blank). An empty period may have nonzero opening and closing.
- A finance person may be inactive and retain readable history. Person ID rather than a display name remains the selection key. Known legacy name-to-ID alias semantics in `financeTxnPersonKey_` remain unchanged; ambiguous legacy records must be reviewed separately, never silently reassigned in this UI feature.
- Display color follows relationship meaning (lender payable red, borrower receivable green, etc.). Opening rows never imply current-session cash movement.
- Mobile layout must inherit Customer Ledger styles; no additional stylesheet/UI architecture.

## Hard constraints
- No changes to `FinanceModule.gs`, `DeleteEngine.gs`, `PartyLedger.gs`, Google Sheets schema, lock/session rules, permissions or public RPCs.
- Prefer existing `finLedLoad`, `finLedRender_`, `finLedOpenView_`, `finLedOpenEdit_`, `finLedDelete_`, `finLoad`, `printLedgerRange`, `exportRowsToCsv`, `openRowActionMenu_`.
- Allow small UI-only mode switching, rendering and statement projection helpers only because the original Finance Ledger uses different columns and cash-direction numbers.
- Regression and responsive visual checks required before merge; no merge/deploy without separate authorization.
