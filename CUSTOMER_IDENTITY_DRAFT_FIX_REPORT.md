# SherERP Production Customer Identity / Draft Posting Fix

Date: 2026-09-08

## Incident reproduced

Production screenshots show two active Customer rows with the same displayed name/phone. One account carries an opening balance of 11,660; the other carries the 7,730 due from `INV-000029` posted from a draft invoice.

The code-level failure is reproducible in the production source:

1. POS/draft keeps a selected `customerId`.
2. `completeSale()` receives that ID.
3. For a due sale, the old code discarded the selected ID and called `resolveOrCreateCustomer_()` using only name/phone.
4. `resolveOrCreateCustomer_()` selected the first matching phone row (`[0]`).
5. If duplicate Customer rows already existed, sheet row order determined which Customer ID received the invoice and Customer Ledger debit.

This is an identity-routing defect. It can split one person's transactions across multiple Customer IDs even though the operator selected a specific customer.

## Important distinction

The current normal `addCustomer_()` path already rejects equivalent Bangladesh phone numbers, including Bangla digits and `+880`/local forms. The supplied source therefore does not prove that this exact current version originally created the second Customer master row. That duplicate may be historical data from an older deployment or another prior data state.

What is proven is that the current production code can silently route a draft/due sale to the wrong one of those duplicate Customer IDs.

## Production fix

### `Customer.gs`

`resolveOrCreateCustomer_()` now accepts an optional preferred Customer ID.

- If an ID was selected, that exact active customer is used after verifying the phone still matches.
- If the selected ID is missing, inactive/deleted, or its phone changed, the transaction is rejected before writes and the operator is told to re-select the customer.
- If no ID was selected and exactly one active customer matches the normalized phone, that customer is reused.
- If no ID was selected and multiple active customers match the same phone, posting fails closed instead of choosing a row arbitrarily.
- If no customer exists, existing quick-create behavior remains unchanged.

### `Sales.gs`

Due-sale posting now passes the POS/draft selected `customerId` into the resolver. A restored draft therefore preserves the exact Customer ID selected when the draft was saved/opened.

### `SalesManagement.gs`

Invoice editing passes the selected `customerId` into the same resolver. This is required to safely repair an invoice already attached to the wrong duplicate customer.

## Regression scenarios

### Before fix: exact duplicate-phone draft scenario

Seed state:

- `C-OLD`, phone `01754551449`, due `11,660`
- `C-DRAFT`, same phone, due `0`
- Draft payload explicitly selects `C-DRAFT`

Old production result:

- Sale posted to `C-OLD` because it appeared first in Customer rows.
- Selected Customer ID was ignored.

### After fix

- Sale header Customer ID = `C-DRAFT`
- Customer Ledger Customer ID = `C-DRAFT`
- `C-OLD` balance remains untouched
- `C-DRAFT` receives the new due

### Ambiguous draft with no selected ID

Two active customers share one normalized phone and draft has no Customer ID:

- Old: silently chose first row and posted.
- New: rejects before any sale, stock, cash/bank, or ledger write.

### Stale selected customer

Draft stores Customer ID but its phone no longer matches the current master:

- New: rejects before writes and requires re-selection.

### Existing-data repair path

A separate regression proves that editing `INV-000029` from the wrong duplicate Customer ID to the chosen canonical Customer ID:

- leaves sale amount unchanged,
- writes no Cash Book or Bank Book money movement,
- credits the old customer due,
- debits the correct customer due,
- updates the Sales header Customer ID,
- retains an auditable `Sale Update Credit` / `Sale Update Debit` trail.

For the screenshot amounts only, moving `7,730` onto the customer with `11,660` opening due would result in `19,390` due on the canonical account and `0` on the wrong duplicate, assuming there are no other transactions not shown in the screenshots.

## Safe live-data repair procedure

1. Deploy this code fix first.
2. Identify which Customer row is the canonical account. In the screenshot, the account containing the `11,660` Opening Balance appears to be the established account (`CUS-000017` is visible in its ledger).
3. Open `INV-000029` through the ERP's existing invoice Edit action.
4. Re-select the canonical customer from the POS customer picker. Do not merely type the same name/phone; make an explicit selection so the Customer ID is set.
5. Leave products, prices, discount, payment type, and amounts unchanged unless a separate legitimate correction is required.
6. Use a reason such as `Move invoice to correct duplicate customer account`.
7. Save and verify:
   - `INV-000029` appears under the canonical customer's ledger,
   - the wrong duplicate customer's Current Due becomes `0`,
   - the canonical customer receives the transferred due,
   - no Cash/Bank amount changes.
8. Only after verifying all history, decide whether to delete the zero-balance duplicate Customer row. Do not manually delete or move Customer Ledger rows in Google Sheets; the ERP-generated correction rows are the audit trail.

## Verification

Fresh regression tests added:

- `customer_identity_draft_regression.test.js`: 6/6 PASS
- `customer_identity_draft_integration.test.js`: 3/3 PASS
- `customer_identity_repair_flow.test.js`: 1/1 PASS

Relevant existing suites also pass except the same pre-existing unrelated UI/static failure already present in the production baseline (`deep_review_regressions` contains one return-UI assertion failure unrelated to these three changed `.gs` files).

Apps Script parse gate:

- 44/44 `.gs` files parse individually
- combined global-scope parse PASS
- duplicate global function names: 0

Full JS test-file matrix after this change is compared against the pre-fix production-hardened baseline before packaging. The customer-identity patch must introduce no new failing test files.
