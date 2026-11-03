# Mohim ERP POS multi-payment — Phase 6 clone acceptance and release gate

**Status:** Isolated QA tooling and static/mock regression tests are implemented on draft PR #34. **Live Google Sheets + Apps Script clone E2E has NOT yet been executed.** Do not merge, deploy, change the setting, or claim production readiness until the signed results below are attached.

## 1. Scope and source of truth

- GitHub repository: `shuvodelux-commits/Mohim_ERP`
- Draft PR: https://github.com/shuvodelux-commits/Mohim_ERP/pull/34
- Branch: `feature/pos-multi-payment-20261103`
- Production `.clasp.json` points to a live Apps Script project. **Never run `clasp push` from this repository root.**
- `POS Multi Payment Enabled` must stay `false` for existing businesses until this release gate is approved. Do not enable it in live production.
- Existing shared preview script is **not** an isolated test target.

## 2. Create disposable clone (never touch source)

1. In Google Drive, identify the currently bound production spreadsheet by verifying its Apps Script binding and currently deployed source, **not by its title**. Several "Sher ERP" sheets may exist. Document the confirmed source IDs **privately**; do not commit private spreadsheet IDs to GitHub.
   **Read-only identity check:** In each candidate Google Sheet, use **Extensions → Apps Script → Project Settings → Script ID**. The script ID must exactly equal the known production project ID recorded in the repository's production `.clasp.json`. If it does not, that sheet is not proven to be the live bound source. Do not run setup, add functions, copy its contents, or deploy merely to verify the ID. No Drive listing/title alone proves the binding. If no candidate matches, stop source-clone work and use a **fresh synthetic QA workbook** instead.
2. **Prefer a new blank, private QA spreadsheet with entirely synthetic business data** to avoid copying real customer information. If a copy of the verified source is essential to preserve schema, sanitize it in the controlled test environment before any broad sharing or testing; do not log or commit real customer data. Confirm the original workbook remains unchanged and keep the clone private. A historical workbook selected by title is not acceptable identity evidence.
3. Create/verify a **new, separate** container-bound Apps Script project for this QA workbook. Obtain both *clone* IDs (script ID and spreadsheet ID). Neither can be the production or existing shared preview script.
4. Check out the reviewed PR branch locally. Prepare a **detached** package (this only writes local files):

   ```bash
   bash scripts/phase6_prepare_clone.sh CLONE_SCRIPT_ID CLONE_SPREADSHEET_ID
   ```

   The command prints a temporary directory containing the branch's root Apps Script sources, a clone-only `.clasp.json` and `Phase6CloneAudit.gs`. It does **not** invoke clasp or write to Drive. Verify the generated IDs and source SHA before continuing.
5. Only from the generated directory, run `clasp status`. After the IDs and OAuth account are independently verified against the **disposable** project, explicitly run `clasp push`. Do **not** deploy or modify production.
6. In the **disposable, bound** Apps Script project only, initialize the new spreadsheet's schema with the existing `setupSystem_()` menu operation if its configured tabs or headers are absent. This initialization **does write to the test spreadsheet**; never execute it in production as part of QA. Create a synthetic admin, synthetic Bank/Mobile accounts, products and open Cash Session through the normal test workflow. In the clone SETTINGS only, enable `POS Multi Payment Enabled` when running split-payment scenarios; revert it afterward. Verify only synthetic customer details are used.
7. In that clone's Apps Script editor, run `phase6CloneAudit_` and save its log output with the test evidence. The function checks both IDs **before reading**; it reads directly from existing Sheets without schema creation and refuses production.

### Important limitations of this read-only clone audit

- This scan checks invoice payment allocations, Cash/Bank source-book movements, **Bank Account master balances against all Bank Book movements (including opening-balance backfills, manual reversal mirrors and deleted entries)**, child row ownership, operation journal state, duplicate IDs and orphaned active Sales Returns.
- It does **not** create a sale, alter an invoice, actually move money, verify user roles, or exercise receipt printing. These require the functional tests in Section 3.
- It does not prove subsequent Customer Settlement allocation or Cash Session balance; those reconciliation checks must be performed separately on the clone.
- It refuses workbooks with more than 15,000 rows in any scanned sheet. Use an appropriately sized disposable clone.
- It **fails**, rather than reporting a misleading green audit, when there are no active split-payment invoices or no test bank accounts. First post synthetic payment fixtures through the real clone workflows, then rerun it.
- Do not publish a public /exec deployment with customer data. For a clone browser test, use entirely synthetic data and limit access appropriately.
- `tests/phase6_clone_audit.gs` is excluded by `.claspignore` from the normal production upload; the detached package deliberately includes it ONLY in the clone.

## 3. Functional acceptance matrix on clone

| ID | Operation | Invariants / observations |
|---|---|---|
| QA-01 | Cash only, exact tender | Invoice paid, one Cash Book credit, no Bank Book |
| QA-02 | Cash tender with change | Receipt shows full tender/change; Cash Book receives applied amount only |
| QA-03 | Cash + Bank + Mobile Banking | One payment detail per method; bank/mobile go to correct account; `Paid + Due = Grand Total` |
| QA-04 | Partially paid split | Customer Due and Customer Ledger increase exactly once |
| QA-05 | Fully Due, zero payment rows | Versioned paid=0 sale remains legitimate without phantom Cash |
| QA-06 | Save draft, reopen, duplicate | Original methods/accounts/tenders preserved; duplicate has new invoice and operation ID |
| QA-07 | Edit split payment allocations | Previous children marked Reversed, new revision active; Cash/Bank books reflect only exact net differences |
| QA-08 | Change invoice items and payment together | FIFO stock, bundles, invoice grand total and all payment books reconcile |
| QA-09 | Delete split invoice | Stock restored, Cash source rows soft-voided, Bank Book entries voided and account master unwound exactly once |
| QA-10 | Cash Sales Return of split invoice | Only refundable collected amount allowed; resulting Cash Book debit and return stock movement correct |
| QA-11 | Store Credit return | Customer ledger credit and stock restoration correct; no Cash/Bank debit |
| QA-12 | Return batch containing split invoice | Refused without writes (intentionally blocked) |
| QA-13 | Close cash session then try edit | Edit rejected with no writes |
| QA-14 | Unprivileged operator edit/delete/return | Appropriate permission failure with no writes |
| QA-15 | 58mm / 80mm thermal and A4/JPG invoice | Payment breakdown legible, Cash change not counted as revenue; no clipping across 1–20 rows |
| QA-16 | View historical invoice after later Customer payment | Original checkout payment rows still immutable; later settlement shown separately |

For every transaction, record **before/after**: `SALES`, `SALE_PAYMENTS`, `SALE_POSTING_JOURNAL`, `CASH_BOOK`, `BANK_BOOK`, `BANK_ACCOUNTS`, `CUSTOMER_LEDGER`, `CUSTOMERS`, `STOCK_MOVEMENT`, and affected stock lots. Independently reconcile every affected account and the grand total using integer paisa. Do not infer correctness from UI totals alone.

## 4. Fault-injection cases (disposable clone ONLY)

- Kill/throw after: posting journal reservation, SALES header, SALE_ITEMS, stock movements, payment child append, Cash Book posting, each Bank/Mobile Book posting, customer ledger posting, journal commit.
- Repeat for: create, edit, delete and single-invoice Cash/Store Credit return.
- For each interruption, assert `SALE_POSTING_JOURNAL` is Writing/Needs Review (unless already committed), review incomplete rows, and retry with exactly the same operation ID/payload. A non-committed operation **must not repost**. A fully committed retry must not double stock, customer due, Cash, Bank or refund.
- If an audit or business-rule check fails, stop rather than manually clearing a journal state. Manual repair requires a written, reviewed reconciliation procedure with before/after evidence.
- Verify duplicate operation ID with changed payload is rejected, and duplicate active payment IDs/rows or tampered tender/change values are detected by readback.

## 5. Financial/accounting release invariants

1. `Applied Cash + Applied Bank + Applied Mobile = Sales.Paid Amount`, to the paisa.
2. `Sales.Paid Amount + Sales.Due Amount = Sales.Grand Total`, to the paisa.
3. `Cash Tendered = Cash Applied + Cash Change` (for checkout Cash only).
4. Active book movement attributable to the invoice equals the **current** per-account applied allocation; `Sale Update` amounts are differences, not duplicate full payments.
5. Cash/Bank reversals affect precisely their original booked amounts; a delete never wipes later unrelated customer payments.
6. Subsequent customer settlements stay separate from the original invoice checkout; Sales Returns cannot return more collectible Cash than verified collected funds.
7. A versioned payment header always has at most **one active revision**, unique row IDs and orders, and permitted Cash/Bank/Mobile account semantics.
8. `SALE_POSTING_JOURNAL` is unique by operation ID; ambiguous operations remain Needs Review and require a documented manual resolution.
9. Date, cash session, permissions and feature flag are verified server-side, not inferred from disabled UI controls.
10. Cloned source and data differ from production. No original spreadsheet, original Apps Script project or shared preview is modified.

## 6. Sign-off decision

**Release = NO** unless all are true:

- GitHub full regression and mocked browser suite green at the **exact release SHA**.
- Clone identity audit `PASS`, plus all 16 live clone scenarios signed off with account and stock evidence.
- Fault injection results documented; Needs Review recovery procedure approved and tested.
- No unresolved accounting integrity findings, role/permission bypass or receipt clipping.
- Production backup and rollback plan reviewed, including how to disable the feature without orphaning already-posted split invoices.
- Explicit owner approval to merge/deploy and a *separate* approval to enable multi-payment feature in production.

Current design restriction: split-payment **batch returns** and direct Bank/Mobile Banking refund disbursement are intentionally not implemented. Release approval must either explicitly accept these restrictions or require additional implementation and tests first.
