# Mohim_ERP GAS — Stage B Task 5A: net-owned sale and unfunded return guard

**2026-11-20 · Original Google Apps Script ERP · Issue #55**
**Base:** Main promotion PR #58 (`main` presently only has Stage A PR #54).
**Scope:** live-code changes on an **isolated PR branch only**; no clasp deployment, spreadsheet migration, history rewrite, or posting of oversold purchase settlements.

## Verified source defects

1. Existing `StockLots.gs:planStockConsumption_` drew from the *gross* positive purchase lot when old `OVERSOLD` debt remained negative. Example -229 -2 +240 = net9 Foot, but previous plan would let a fresh 10-Foot sale draw 10 fully from the 240-Foot lot. That can cost the new sale against units already economically owed to old invoices.
2. Existing `planSaleReturnRestoration_` created an unrelated new positive RETURN lot for a sale sourced from a genuinely unfunded negative `OVERSOLD` lot, leaving the original negative quantity unchanged. Net on-hand could be right, but historical debt and FIFO/valuation were wrong.
3. Existing Sales Return Edit/Delete logic intentionally blocked a reversal that pushed stock below zero; a genuine return of an originally OVERSOLD sale instead must reverse the original negative lot and may re-open that *same evidenced debt*. However the guard for ordinary returned stock must not be weakened.

## Source-specific corrections

- **Read-only sale planning** reserves all verified outstanding negative `OVERSOLD` quantity against positive stock lots in *FIFO purchase date + Lot ID order*. If the negative debt is 231 and positive purchase lot shows 240, only 9 are physically available to the next sale; a 10-Foot sale draws 9 from that purchased lot, then creates a new 1-Foot `OVERSOLD` source-linked lot priced with the last genuine prior purchase cost (PR #56 rule). Applying the sale still writes Current Stock only once; no money is posted by reserving old debt.
- Reservation is virtual and **does not itself settle** or mutate old negative lots. `Products.Current Stock` must exactly match the signed lot sum when negative debt exists, otherwise reject the sale before any invoice/payment/stock writes. Invalid negative source, deleted/inactive/unpriced positive lots fail closed.
- Vendor-sourced shortages correctly see only net available owned units; they do not create a new owned oversold negative lot for the vendor portion.
- **Unfunded sale return** sourced from exactly the original negative OVERSOLD lot restores its **same** negative row toward zero. If zero, mark `Consumed`; if still negative, retain `Oversold`. Keep source `SALE_ITEM_LOTS` link and the existing single money refund path; no duplicate positive RESTORE lot.
- If any `STOCK_LOT_SETTLEMENTS` entry references that OVERSOLD lot, or its original quantity/status is invalid, reject the return with Needs Review until exact linked settlement reversal is implemented; never guess which funded purchase/COGS to reverse.
- **Return Edit/Delete** can undo and repost the original negative lot return under its existing ScriptLock and operation journal, even when total product stock becomes negative again, **only when every reversed movement for that product is a direct, verified, unfunded OVERSOLD source**, with `Original Quantity` bounds, source consumption link and no settlement events. For ordinary/other mixed returns, preserve the existing nonnegative stock and lot guards. Return money and lot changes remain exactly source-linked.
- Preserve the prior special case for a malformed historical `OVERSOLD` lot tagged `Active` with zero remaining: its old fallback RETURN-lot behavior and edit/delete remain intact only when **no** settlement history exists, as demanded by existing regression contract.

## Evidence and accounting gates

- RED: six specific sale-stock tests exposed gross positive allocation and stock-mismatch acceptance; new return tests exposed positive fallback-lot creation and unsafe funded-source reversal. Existing native return edit/delete test found the ordinary nonnegative guard; new direct-OVERSOLD-only exception is backed by actual in-memory source transaction tests.
- GREEN observed: **101/101 focused** when incorporating source return correction, **886/886 full Node suite** before the final deleted/unpriced positive-lot guards. The final full suite, exact commit CI and code review must still be independently verified before merge.
- Additional RED→GREEN tests block deleted/unpriced +240 units from sale and preserve source cost selection in inconsistent historical examples.
- No `Purchase.gs` changes, no actual new-purchase funding, no settlement journal execution, no COGS/profit mutation, and no automatic historical data repair. The current original sale COGS still shows provisional Unit Cost until a separate approved funding writer/reports calculation is built.
- Next **mandatory gates**: purchase return/edit/delete must respect purchased-lot reservation; native new purchase writer must have journal-based unknown-write recovery, whole-cart idempotency, accurate source-line cost allocations and return reversals; reconcile source-backed price and report profit; run isolated Apps Script/copy workbook fault-injection tests and owner-approved preview/live deployment. The real ledger history may not match screenshot assumptions.

## Illustrative example only

If and only if a complete source audit verifies -229 Foot and -2 Foot previous negative lots @৳68 and a +240 Foot purchase @৳64.75, net owned stock is 9 Foot and net projected stock value is ৳582.75. On a subsequent 10-Foot sale: sell 9 newly owned Foot at actual lot cost ৳64.75, create a new 1-Foot OVERSOLD provisional source @ the last purchased lot price ৳64.75; resulting net owned stock -1. Neither settlement nor the earlier old invoices' effective COGS changes yet. A screenshot containing only -229 and +240 yields 11 Foot, not 9.
