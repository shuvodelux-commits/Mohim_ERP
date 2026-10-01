# SherERP Stock Lot Purchase-Cost Correction — Review & Deployment Report

Date: 2026-09-22
Implementation base: pushed `main` restore point `647333b337f66e3e1f043d537f6a9aa8d74a480d`
Local feature branch: `feature/stock-lot-cost-correction`
Feature range in the reconstructed local worktree: `c9c776b..370c941`
GitHub status: **not pushed / no PR / no merge for this Stock Lot fix**

## Root cause

SherERP copies Product Purchase Price into an internal stock lot when positive Opening/Adjustment stock is created. If the Product Purchase Price was blank/0 at that moment, the new internal lot stored Purchase Price 0. Later correcting the Product master price did not rewrite the historical lot, which is correct for normal historical lot behavior but left the bad setup data unresolved.

The Products list already had a display valuation fallback for some zero-cost internal lots, so a product could appear to have a reasonable stock value while the underlying `STOCK_LOTS.Purchase Price` remained 0. FIFO sale consumption then copied that zero cost into `SALE_ITEM_LOTS.Unit Cost`, causing historical COGS to be understated and profit to be overstated.

## Implemented correction workflow

The Products module now supports both a single-lot **Correct Purchase Cost** action and a bulk **Unpriced Stock Lots** review workflow.

V1 correction is intentionally limited to blank/zero-cost internal sources:

- `OPENING`
- `OPENING-MIGRATION`
- `ADJUSTMENT`
- `LEGACY`
- `OPENING-*`
- `ADJUSTMENT-*`

Normal Purchase-origin lots remain protected and must continue to use Purchase Edit.

For an approved correction, the server updates only:

1. `STOCK_LOTS.Purchase Price` for the selected Lot ID.
2. `SALE_ITEM_LOTS.Unit Cost` where `SALE_ITEM_LOTS.Lot ID` exactly equals that Lot ID.
3. One append-only `Stock Lot Cost Corrections` audit row per corrected lot.

Historical linkage is never guessed from Product ID, sale date, current FIFO position, or blank Lot IDs.

## Accounting behavior

The correction does **not** change:

- Sales Invoice revenue
- sale quantity
- Paid/Due amounts
- Customer Due
- customer settlement allocation
- Cash Book / Bank Book
- Supplier Due
- Purchase Invoice
- stock quantity
- lot date or FIFO ordering
- Sales Return quantity/economics

It changes inventory cost evidence only. Existing invoice-profit and Profit Report code already reads `SALE_ITEM_LOTS.Unit Cost`, so historical profit recalculates from the corrected COGS without editing the sale transaction.

### Verified Tank example

The regression fixture mirrors the reported case for `LOT-000481`:

- Opening lot cost: 0
- corrected lot cost: 4,100
- one unit currently sold from that lot
- total invoice net sale: 4,980
- other COGS: 703

Before correction, invoice profit is 4,277.
After correcting the exact lot to 4,100, total COGS becomes 4,803 and gross profit becomes 177. The Profit Report produces the same COGS/profit while the sale header, line revenue, Paid amount and Due amount remain unchanged.

## Future prevention

The defect is blocked at all positive internal-stock entry points:

- Product creation: Opening Stock > 0 requires Purchase Price > 0.
- Product edit: increasing stock requires submitted Purchase Price > 0.
- Positive manual Stock Adjustment requires the Product Purchase Price > 0.
- Negative Stock Adjustment remains unchanged.
- Opening-lot migration skips and reports products that have positive stock but no Purchase Price.
- The low-level internal-lot creation path rejects positive OPENING/ADJUSTMENT/LEGACY-family stock with zero/blank cost as defense in depth.

The Products bootstrap also exposes unresolved unpriced internal lot count and quantity, while retaining the existing valuation fallback for backward compatibility.

## Audit schema

Run `setupSystem_()` after deploying the changed source files so the additive sheet/header schema is created/repaired.

New sheet: `Stock Lot Cost Corrections`

Columns:

- Correction ID
- Date
- Lot ID
- Product ID
- Product Name
- Source
- Old Purchase Price
- New Purchase Price
- Original Quantity
- Remaining Quantity
- Matched Historical Quantity
- Affected Invoice Count
- Historical COGS Delta
- Reason
- Corrected By
- Created At

Correction ID prefix: `SLC`.

## Changed production files

- `Config.gs`
- `StockLots.gs`
- `Products.gs`
- `products.html`
- `PROJECT.md`
- `.github/workflows/regression-tests.yml`

New/changed tests:

- `tests/stock_lot_cost_correction_regressions.test.js`
- `tests/stock_lot_cost_correction_ui_static.test.js`

## Final verification

Fresh packaging verification was run against the exact local tree being packaged. All maintained CI steps passed, including:

- Multi-Invoice Sales Return: 26/26
- Sales/Stock audit: 25/25
- Stock Lot cost correction: 20/20
- Stock Lot correction UI/docs: 7/7
- Public RPC security: 194 published functions audited
- Production static gate: PASS
- Reports business logic: 11/11
- Settlement discount: 17/17
- Deep review regressions: PASS
- state-drift accounting/read-path suites: PASS
- customer settlement: PASS
- supplier settlement: PASS
- Cash Session business logic: 13/13

The verification run ended with `PACKAGING_VERIFICATION_PASS`.

An exhaustive run of every `tests/*.test.js` also exposes 12 non-CI failures. Each of those same 12 test files was rerun against the pre-feature baseline and also fails there (`baseline=1`, `feature=1`), so they are existing repository drift rather than regressions introduced by this Stock Lot feature:

1. `tests/confirmation_spec_matrix.test.js`
2. `tests/confirmation_transaction_payload_integrity.test.js`
3. `tests/counter_acceptance.test.js`
4. `tests/counter_customer_receive.test.js`
5. `tests/counter_ui_primitives.test.js`
6. `tests/lot_selling_price.test.js`
7. `tests/mobile_pwa_ui.test.js`
8. `tests/mockup_module_design.test.js`
9. `tests/pos_tablet_exact_mockup.test.js`
10. `tests/pos_tablet_recent_drafts.test.js`
11. `tests/sidebar_grouped_collapse.test.js`
12. `tests/tablet_responsive_shell.test.js`

## Review result

A whole-change self-review was performed because this harness did not provide a separate subagent reviewer. This is weaker than an independent fresh-context review, but the review specifically checked:

- exact Lot ID matching only
- validation of the entire batch before the first business write
- no direct Sheet writes bypassing database helpers
- no Cash/Bank/Customer/Supplier writes
- no stock quantity mutation
- Purchase-origin lot protection
- cache invalidation through existing database update helpers
- public RPC permission gates
- future zero-cost internal-lot prevention paths

No Critical or Important feature finding remained.

### Deferred minor

The browser bulk preview currently sums each selected lot's `Affected Invoice Count`. If one invoice consumed more than one selected corrected lot, that preview count can show the same invoice more than once. The server-side correction result de-duplicates invoice IDs, and this does not affect COGS, profit, writes, or any accounting amount. This is intentionally deferred as a minor UI-count polish item.

## Known limitations

- Historical rows with blank/ambiguous Lot IDs are never guessed or rewritten. They remain unresolved for manual investigation.
- Google Sheets does not provide SQL transaction rollback. SherERP validates all selected corrections before the first business write, but an external Apps Script/Sheets interruption during the physical write phase cannot be rolled back atomically.
- V1 repairs only currently blank/zero-cost internal lots; it is not a generic historical cost-edit engine for already-priced lots.

## Deployment / repair sequence

1. Take a backup of the live spreadsheet.
2. Apply the changed production files from the package.
3. Run `setupSystem_()` once to add/repair the audit sheet schema.
4. Open Products → **Unpriced Stock Lots**.
5. Review the suggested Product master Purchase Price for each lot; do not blindly apply values you have not verified.
6. Enter/fix Proposed Cost for rows whose Product master Purchase Price is still blank/0.
7. Select reviewed rows (or use **Select Ready**) and enter a correction reason.
8. Apply corrections in reviewed batches.
9. Verify Stock Lots valuation, the affected historical invoice profit, Profit Report, customer balances, cash/bank balances, and stock quantities.
10. Investigate any unresolved historical rows that lack exact Lot ID evidence separately; do not infer them automatically.

## Git status

No GitHub push, PR, merge, or remote mutation was performed for this Stock Lot fix. The feature remains local for user review.