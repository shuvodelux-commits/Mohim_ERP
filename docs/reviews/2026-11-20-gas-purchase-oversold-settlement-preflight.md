# Mohim_ERP GAS — Stage B Task 4: oversold purchase-settlement preflight

**2026-11-20 · Original Google Apps Script + Google Sheets ERP · Issue #55**

**Status: planner and additive schema only, NOT a live stock/COGS fix.** This work is stacked on PR #54 (read-only FIFO display) and PR #56 (provisional oversold cost from last genuine historical purchase lot).

## Verified source behavior

- `Purchase.gs:createPurchase` currently increases `Products.Current Stock` by bought quantity Q once, creates one gross positive purchase lot Q, posts purchase items/movement and supplier/payment effects, but never settles prior negative `OVERSOLD` lots.
- `StockLots.gs:planStockConsumption_` can then incorrectly consume gross new positive stock even if part of it is needed to fund older debt.
- `Sales.gs` records `SALE_ITEM_LOTS` provenance. The original business sale date—not the OVERSOLD lot's processing timestamp—is the relevant chronology.
- Sheets operations across several rows cannot be rolled back atomically by Apps Script.

## Implemented pure contract

`planOversoldPurchaseSettlement_({ productId, product, purchase, stockLots, saleItemLots, sales, operationJournal, settlementHistory })` in `StockLots.gs` is a **read-only function** and always returns `postable:false`. It has no SpreadsheetApp calls.

- Strictly validate product Current Stock against the signed sum of all source lot balances. A discrepancy, missing original lot, invalid price, duplicate sale invoice, invalid negative lot or inconsistent return/settlement history fails with `NEEDS_REVIEW`.
- Require each remaining negative OVERSOLD lot to have one exact, same-product `SALE_ITEM_LOTS` link and source invoice. Verify original sale quantity = outstanding negative debt + committed funding history; no source date inference.
- Reject an old negative lot coexisting with positive other lots as historically ambiguous. Do not allocate a backdated purchase against a sale dated later than that purchase.
- Sort old OVERSOLD debt oldest **source sale business date** first, then stable Lot ID. Allocate the newly bought quantity only once. The resulting `newLotRemainingQtyTicks` is purchase Q minus funded oversold debt.
- Use explicit integer unit ticks, integer BDT paisa and half-up allocation-level money rounding. Compute provisional and actual COGS independently, then derive signed favorable variance as their difference.
- Detect same-operation committed replay (return immutable receipt), conflicting operation ID/Purchase ID, interrupted purchase/settlement journal, duplicate settlement events and numeric overflows. Any uncertain prior write requires review; never automatically reissue the purchase.
- Outputs are frozen proposal objects without sheet row indices, update statements, account journals, payment effects or write authorization.

**Illustrative only:** verified -229 Foot and -2 Foot at provisional ৳68, followed by a newly bought 240 Foot at ৳64.75 -> fund 231, leave 9, favorable COGS difference ৳750.75. The real screenshot's missing 2 Foot is **not** independently evidenced; 240 - 229 = 11, not 9, until full historical reconciliation.

Fractional-money example: 0.5 Foot × ৳64.75 = ৳32.375 -> ৳32.38 actual COGS, while provisional 0.5 Foot × ৳68 = ৳34.00 -> **৳1.62** difference, not an independently rounded ৳1.63. Whole-sale report rounding and later partial reversals still need an approved finance policy.

## Reserved additive Sheets schema — no live migration

- `STOCK_LOT_SETTLEMENTS`: append-only settlement ID, operation, product, new purchase and purchased lot, old OVERSOLD lot, original invoice/item lineage, canonical quantity ticks/scale, source provisional cost, funded actual cost, computed rounded amounts, signed variance, actor/state/time.
- `PURCHASE_SETTLEMENT_JOURNAL`: operation ID, purchase ID, product, server-calculated **full purchase payload** fingerprint, Writing/Needs Review/Committed state, last completed stage, receipt, actor/timestamps/error.
- `Setup.gs` already declares all configured sheets through `CONFIG.SHEETS`; `Database.gs` adds missing schema columns. No code here calls setup or writes to an active spreadsheet.

## Proposed native write and crash-recovery gate — not implemented

1. Under `LockService.getScriptLock()`, authenticate the actual ERP user and purchase module permission; enforce existing Cash Session; load products, all lots, sale provenance, source receipts and supplier/payment data once. Validate all cart lines, unit conversions, discounts, bank account and amount, stock and prior corrections before first business write.
2. Derive and verify a stable operation ID and **whole-purchase payload fingerprint** server-side (supplier, every line, date, unit prices, discounts, payments, actor), not merely the per-product snapshot fingerprint used by the pure planner. Reserve purchase and eventual lot IDs without triggering a partial business transaction.
3. **First write after validation:** append `PURCHASE_SETTLEMENT_JOURNAL` reservation with State=Writing. Unknown results must not be assumed to have failed; inspect source rows under lock.
4. Extend the existing `Purchase.gs` native flow, not create a parallel posting engine. Create the purchased lot and record only one +Q product stock change/movement and original supplier/payment entries. Apply negative-lot +funded quantities and purchased-lot -funded quantities, and append exact source-linked settlement events.
5. Track every irreversible write stage. If any Sheet operation errors after some writes, leave the operation Needs Review and block affected purchase, POS/stock and return writes until an authorized operator reconciles source IDs and receipt effects. **No blind retry or automatic rollback.**
6. Mark Committed only after verified readback of purchase, lot, movement, cash/bank/supplier entries and immutable settlement records. Return the original receipt for exact replay; conflict on changed intent.
7. Extend the **native** `SalesReturn.gs`, `PurchaseReturn.gs`, `PurchaseManagement.gs`, `SalesManagement.gs`, `DeleteEngine.gs` and bundle paths to respect previously funded source stock; reverse only exact linked transactions. Do not rewrite old `SALE_ITEM_LOTS.Unit Cost` or original invoices.

**Accounting release blocker:** Stage B needs a reviewed source-specific rule for effective final COGS/profit, source-date recognition, audit reporting, discounts, cumulative minor-unit rounding and partial sale/purchase returns. No Cash/Bank/Customer/Supplier ledger posting should be inferred from a stock-cost difference. New purchases in `Purchase.gs` currently use each line's entered Unit Price for the lot cost; header discounts are not silently redistributed by this plan.

## Superpowers RED → GREEN evidence and next steps

- Branch starting point (PRs #54 + #56): 851/851 baseline Node regression tests passed.
- RED: 17 new planner tests initially failed on missing function. Two further safety tests failed with an incomplete first implementation; two schema tests failed before schema declaration.
- GREEN: **20 planner + 3 schema-focused tests**, then full project suite **874/874 passing** locally; `git diff --check` clean.
- Node tests simulate source rows; these are **not** actual Google Sheets, LockService, Apps Script preview, supplier/payment integration or interrupted-write recovery tests.
- Next approval sequence: review PR #54 → review PR #56 → review this planner PR → Task 5 source-native writer with fault-injected GAS/Sheet tests and exact linked returns → signed finance policy → isolated clasp preview on a backed-up **copy** of the real workbook → owner-approved production deployment → separately approved historical repair.
