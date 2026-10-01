# SherERP Business Finance Multi-Balance Upgrade Report

**Build date:** 2026-09-15  
**Source build:** `SherERP-PRODUCTION-FINAL-LEDGER-SEARCH-POS-COUNTER-STYLE-AUDITED-2026-09-09(2).zip`  
**Source SHA-256:** `bcde5fd43ab74823d1bb2be66ead2c72b974abb6c5ca568a30f758fc56c28cbb`

## Scope and isolation

This upgrade implements the approved Business Finance multi-balance design while preserving the rest of SherERP. The production diff is limited to these six existing runtime files:

- `Config.gs`
- `FinanceModule.gs`
- `DeleteEngine.gs`
- `DayBook.gs`
- `finance.html`
- `financeLedger.html`

No existing Sales, Purchase, Stock, Vendor, Customer/Supplier Settlement, Clean Ledger, or Return production source file was modified.

Nine new regression/E2E test files were added under `tests/`. No production file was removed.

## Schema compatibility

`FINANCE_PERSONS` receives one additive column: `Roles`, placed after the legacy `Person Type` column. No existing column is renamed or removed.

Compatibility behavior:

1. A populated `Roles` value is authoritative.
2. A blank `Roles` value falls back to legacy `Person Type`.
3. New people store canonical comma-separated roles and continue storing the first role in `Person Type` for old consumers.
4. Existing transaction rows remain unchanged. `FINANCE_TRANSACTIONS` receives no new column.

Canonical roles are `Owner`, `Lender`, and `Borrower`. One person can hold multiple roles.

## Finance transaction model

| Transaction type | Relationship account | Balance effect | Cash direction | Required role | Opening |
|---|---|---:|---|---|---|
| Owner Investment | owner | +1 | in | Owner | No |
| Owner Withdrawal | owner | -1 | out | Owner | No |
| Loan Received | loanPayable | +1 | in | Lender | No |
| Loan Repayment | loanPayable | -1 | out | Lender | No |
| Borrower Loan | borrowerReceivable | +1 | out | Borrower | No |
| Borrower Repayment | borrowerReceivable | -1 | in | Borrower | No |
| Opening Owner Capital | owner | +1 | none | Owner | Yes |
| Opening Loan | loanPayable | +1 | none | Lender | Yes |
| Opening Borrower Loan | borrowerReceivable | +1 | none | Borrower | Yes |

Normal Finance transactions retain their existing Cash/Bank behavior and active-cash-session rules. Opening transactions canonicalize Payment Method and Bank Account to blank, skip the active cash-session requirement, and never post to Cash Book or Bank Book.

Edit transitions are handled explicitly:

- normal -> normal: reverse old money movement and post the new movement;
- normal -> opening: reverse old movement and post no new money movement;
- opening -> normal: reverse no old movement and post the new movement;
- opening -> opening: no money-book movement.

Deleting an opening row soft-deletes only the Finance transaction. Deleting a normal Finance transaction preserves the existing reversal behavior.

## Balance engine

`FINANCE_TRANSACTIONS` remains the accounting source of truth. No authoritative balance cache was introduced.

For each person the engine maintains three independent signed relationship balances:

- `ownerNet = Opening Owner Capital + Owner Investment - Owner Withdrawal`
- `loanNet = Opening Loan + Loan Received - Loan Repayment`
- `borrowerNet = Opening Borrower Loan + Borrower Loan - Borrower Repayment`

The UI and API expose the positive and negative sides independently:

- Owner Capital = `max(ownerNet, 0)`
- Owner Advance = `max(-ownerNet, 0)`
- Outstanding Loan = `max(loanNet, 0)`
- Lender Credit = `max(-loanNet, 0)`
- Borrower Receivable = `max(borrowerNet, 0)`
- Borrower Credit = `max(-borrowerNet, 0)`

Business-wide summaries first calculate each person's signed account balance and only then sum positive/negative buckets. A payable for one person therefore never offsets a credit belonging to another person. Owner, lender, and borrower relationships for the same person also never cross-net.

Legacy Finance rows with blank `Person ID` use a stable normalized person-name key. When a current Finance Person with the same normalized name exists, the ledger aliases those legacy rows to that person so historical balances remain visible.

## Person-specific ledger correction

The old global running Owner/Loan totals were replaced with balances keyed by `person + relationship account`.

Each ledger row now exposes:

- `account`
- `accountLabel`
- its own person/account running `balance`

Historical running balances and current summary cards are calculated from complete active history before display filters are applied. Date, transaction type, and search filters therefore change only displayed rows. They do not change current balance cards.

Selecting a Finance Person switches all six cards to that person's complete-history balances. Clearing the person restores business-wide per-person bucket totals.

## Day Book

Day Book now consumes `cashDirection` rather than inferring all Finance entries as money in/out.

- Borrower Loan -> money out
- Borrower Repayment -> money in
- all three opening types -> zero Cash/Bank movement

Opening rows remain visible as Finance audit entries. Their displayed Payment Method is blank even if an old/forged row contains a stale method, preventing a non-cash opening entry from being visually misrepresented as Cash/Bank activity.

## Business Finance UI

The Business Finance page now provides:

- six relationship summary cards;
- grouped Owner / Loan / Borrower / Opening Balance transaction options;
- required-role filtering for Finance Persons;
- opening-balance hint and hidden/disabled money controls;
- multi-role Finance Person creation;
- role chips and confirmed Edit Roles action;
- quick-add that defaults to the transaction's required role;
- frozen confirmation payloads so the confirmed values are the submitted values.

## Finance Ledger UI

The Finance Ledger now provides:

- the existing POS/Counter-style controlled searchable person combobox;
- partial name/phone search, shared Bangla/English digit normalization, keyboard navigation, bounded results, and clear `x` behavior through the existing helper;
- all six current-balance cards;
- account-aware running balances and relationship labels;
- role-aware person choices when editing;
- opening-aware edit controls;
- selected-person identification in print output;
- all six summary balances in print and CSV output.

## API compatibility

`getFinanceBootstrap()` now exposes full transaction metadata, multi-role people, and a six-value `summary`. During the compatibility window it also retains the legacy top-level fields:

- `ownerCapital`
- `outstandingLoan`

No Finance permission key was changed. Existing `finance:view/add/edit/delete` authorization continues to apply. The new `setFinancePersonRoles` RPC uses Finance edit permission and was included in the public RPC security audit.

## Verification evidence

### Focused Finance release suite

Command covered the new Finance suites plus existing Finance/Day Book/financial CRUD/confirmation regressions.

**Result: 56/56 tests passed, 0 failed.**

### Static, syntax, RPC, and security gates

**Result: 20/20 tests passed.** The production gate reported:

- all Apps Script sources parse;
- all inline HTML scripts parse;
- top-level server functions are globally unique;
- every literal client RPC resolves to a server function;
- critical financial writes retain lock/authorization checks;
- `production_gate_static: PASS (44 GS files, 33 HTML files, 515 server functions)`;
- `public_rpc_security: PASS (178 published functions audited)`.

### Browser/E2E probes

Fresh pre-package probes passed:

- Finance multi-balance: 10/10
- existing Bank/Finance: 7/7
- POS/Sale: 11/11
- Purchase: 7/7
- Party/Expense: 12/12
- Returns: 7/7

**Total: 54/54 browser assertions passed.**

### Complete Node suite and baseline comparison

Source production baseline before this work:

- 186 tests
- 177 passed
- 9 failed

Current build after adding Finance coverage:

- 223 tests
- 214 passed
- 9 failed

The failing test files are exactly the same nine pre-existing UI files in both runs:

1. `tests/counter_acceptance.test.js`
2. `tests/counter_customer_receive.test.js`
3. `tests/counter_ui_primitives.test.js`
4. `tests/mobile_pwa_ui.test.js`
5. `tests/mockup_module_design.test.js`
6. `tests/pos_tablet_exact_mockup.test.js`
7. `tests/pos_tablet_recent_drafts.test.js`
8. `tests/sidebar_grouped_collapse.test.js`
9. `tests/tablet_responsive_shell.test.js`

No new failing test file was introduced by the Business Finance upgrade. These nine baseline failures were intentionally not changed because their production modules are outside this Finance scope.

## Deployment notes

1. Back up the production Google Sheet and Apps Script project.
2. Deploy the full audited package, or replace only the six production files listed in **Scope and isolation**.
3. From the bound Spreadsheet editor run private `setupSystem_()` once. The setup/schema path will add the missing `Roles` header without deleting or renaming existing Finance Person fields.
4. Update/redeploy the Web App and hard-refresh the client.
5. On a staging copy, verify one normal transaction and one opening transaction for each relationship family before production use.

## Runtime limitation

Local verification executes the real project source through Node VM/browser fixtures, but this environment cannot execute Google's live `SpreadsheetApp`, `LockService`, deployed `google.script.run`, or true concurrent Google Sheets writes. A staging-copy smoke test in the real Apps Script/Google Sheets runtime remains required before production deployment.
