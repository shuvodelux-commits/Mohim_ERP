# SherERP Production State-Drift Hardening Report

**Date:** 2026-09-08  
**Exact production base:** `SherERP-FINAL-2026-09-07-04 Only CustSettelmentUpdate.zip`  
**Base SHA-256:** `ee48d0c0eee0f9012af5ec82ccd56c6d38be96f611f1c14e94be76c24efe878c`

## Scope

This fix was applied to a fresh extraction of the exact production ZIP. No HTML/CSS/UI files, Config, sheet schemas, or database columns were changed. The accounting changes are limited to seven existing Apps Script files plus one new read-only settlement-reconstruction module.

### Production files changed

1. `CustomerSettlement.gs`
2. `DeleteEngine.gs`
3. `Invoice.gs`
4. `PurchaseManagement.gs`
5. `PurchaseReturn.gs`
6. `Reports.gs`
7. `SalesReturn.gs`
8. `SupplierSettlement.gs` **NEW — must be added to Apps Script**

## Confirmed defects fixed

### 1. Customer due and Customer Credit can cancel each other incorrectly

A targeted payment now attempts the selected invoice first, then applies any remaining real payment to other outstanding invoices before creating Customer Credit. Replay also handles an important production edge case: if a later-created backdated return/correction sorts before an existing targeted payment and has already settled that target, the old payment is reallocated to other due instead of recreating equal Due + Customer Credit.

New payment validation remains strict: a user cannot intentionally select a fully settled invoice just to route payment elsewhere.

### 2. `Other` method incorrectly creates refundable-cash provenance

Direct sale/purchase amounts using `Payment Method = Other` remain settlement value but are no longer considered verified refundable Cash/Bank/Mobile-Banking money. Customer payment context, sales cash-return cap, supplier purchase return cap, and settlement provenance now agree.

### 3. Supplier Current Due can disagree with purchase Paid/Due/status

Added `SupplierSettlement.gs`, which replays `SUPPLIER_LEDGER` oldest-first and reconstructs per-purchase settlement state using existing data only. It covers:

- purchase due
- later supplier payments
- supplier settlement discounts
- purchase updates
- purchase-return supplier credits
- supplier advances/credits
- refundable payment provenance

No new transactional allocation sheet or new Google Sheet columns are required.

### 4. Returns/reports/POS history can show stale original Paid/Due/status

Live settlement state is now used by:

- Purchase Management list/detail
- Purchase Return search/detail
- Sales Return search/detail
- Sales Report
- Purchase Report
- POS sales history by customer phone

Transaction-time audit views such as Day Book and edit forms intentionally continue to use the original stored transaction fields.

### 5. `Other` customer/supplier payments fail Edit/Delete

Edit/Delete reversal now checks whether the original payment method actually created a Cash/Bank book movement. `Other` correctly restores party due without demanding or voiding a nonexistent money-book row. Cash/Bank/Mobile-Banking behavior remains unchanged, including ambiguity protection for legacy rows.

### 6. Return/supplier credit was being counted as report money

A deeper invariant test found that a settlement snapshot's `paidAmount` intentionally includes non-cash credits for invoice/purchase status, but the report labels `Collected` and `Paid` represent actual payment value. Reports now:

- use settlement replay for current Due
- count original + later real Payment rows as Collected/Paid
- do **not** count Sales Return credit or Purchase Return supplier credit as money collected/paid
- keep returns reported separately

## Verification performed

### Targeted accounting regression suites

- Customer settlement: **15/15 passed**
- Supplier settlement: **5/5 passed**
- Live state-drift read paths: **5/5 passed**
- Accounting report invariants: **3/3 passed**
- Financial CRUD/reversal scenarios: **33/33 passed**
- Sales/stock/return native scenarios: **11/11 passed**
- Reports business logic: **11/11 passed**
- Settlement discount: **17/17 passed**
- Return ledger regressions: **8/8 passed**
- CRUD business-rule matrix: **43 critical mutation paths audited, PASS**

### Generated sequence / property checks

Deterministic generated histories were replayed through the real customer and supplier settlement engines:

- 300 customer histories: signed ledger balance identity + no stranded Due alongside Customer Credit
- 300 supplier histories: signed ledger balance identity + no stranded Payable alongside Supplier Credit
- 200 customer histories: cash provenance never exceeds actual cash-backed payment value
- 200 supplier histories: cash provenance never exceeds actual cash-backed payment value

All generated checks passed after the final replay correction.

### Full repository test matrix

`tests/*.test.js`: **61 test files**

- **50 passed**
- **11 failed**

The same 11 failing test files were already failing on the untouched production ZIP before this accounting work:

- `confirmation_spec_matrix.test.js`
- `counter_acceptance.test.js`
- `counter_customer_receive.test.js`
- `counter_ui_primitives.test.js`
- `deep_review_regressions.test.js`
- `mobile_pwa_ui.test.js`
- `mockup_module_design.test.js`
- `pos_tablet_exact_mockup.test.js`
- `pos_tablet_recent_drafts.test.js`
- `sidebar_grouped_collapse.test.js`
- `tablet_responsive_shell.test.js`

The first failing assertion/error in each of those 11 files also matches the untouched production baseline. They are pre-existing UI/static acceptance failures and were not introduced by this accounting patch.

### Apps Script source validation

- Individual `.gs` syntax: **44/44 passed**
- Combined Apps Script global-scope parse: **PASS**
- Duplicate named global functions: **0**

## Deployment

For the safest production update, replace only the seven modified `.gs` files and add the new `SupplierSettlement.gs`. Do not replace unrelated production HTML/UI files.

No Google Sheet migration is required.

After deployment, smoke-check these workflows with a backup/snapshot available:

1. Customer with multiple due invoices: full targeted payment leaves both Due and Customer Credit correct.
2. Supplier purchase due: later supplier payment updates Purchase Management and Purchase Return state.
3. Customer/Supplier `Other` payment: edit and delete restore due with no Cash/Bank movement.
4. Cash return on an `Other`-method sale/purchase is rejected as non-cash provenance.
5. Sales/Purchase reports show live Due while return credits are not counted as Collected/Paid money.
