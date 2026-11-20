# Mohim_ERP GAS — Superpowers Task 5B: Purchase Return/Edit/Delete oversold reservation guards

**Date:** 2026-11-20 (Asia/Dhaka)
**Repository:** `shuvodelux-commits/Mohim_ERP`, original Google Apps Script + Google Sheets ERP
**Source main:** `838da75af3c87a4ca2487f5327034fb633862c9a` (PRs #58 and #59 verified merged into main)
**Scope:** server validation/read-only FIFO reservations; no automatic purchase funding or historical repair

## Source defect reproduced with failing tests

The existing `StockLots.gs:planPurchaseReturnLotReduction_` sees the raw positive remaining quantity of the selected purchase. Consider two purchase lots, A=20 Foot (older), B=30 Foot (newer), and a prior still-negative `OVERSOLD` lot of -20 Foot. The product net stock is +30 Foot. FIFO reserves **all of A** against that previous negative sale, while B has 30 Foot free.

Before this change, returning 1 Foot of A succeeded because product net stock was positive and A's raw remaining was 20. Purchase Edit could similarly reduce or change the cost/discount/supplier of A. Purchase Delete could remove all of A if another purchased lot kept the product net nonnegative. This lets a purchase already economically committed to old sales be reversed. It can lead to incorrect stock valuation and COGS when Stage 5C settles those lots.

## Implementation: original native GAS code, no new framework

- `StockLots.gs:planPurchaseLotOwnAvailability_(productId,lots,productRow)` is a pure read-only reservation calculation, using real FIFO purchased-lot order. It derives `reservedQty` and `freeQty` per positive lot without modifying original Stock Lots, invoices, Cash/Bank/Supplier/Party records or creating a settlement row.
- Under old negative debt, the helper verifies OVERSOLD source status, positive-lot source cost/status, unique lot IDs, finite quantities, and the exact match of `Products.Current Stock` to signed lot sum. Any ambiguous evidence fails with Needs Review.
- `planPurchaseReturnLotReduction_` uses only free quantity from that **exact source purchase's lots**. It still decrements the source lot's gross Remaining Quantity by the returned amount, preserving its reserved balance. No negative source gets consumed by a supplier return.
- `PurchaseReturn.gs:completePurchaseReturn` passes the real cached product to the planner under the existing ScriptLock and all-lines prewrite validation. Supplier Ledger/Cash/Bank writes run only after the stock plan succeeds.
- `PurchaseReturn.gs:getPurchaseForReturn` shows the purchase's truly free FIFO quantity as `availableQty` instead of bought-minus-returned gross quantity. For older purchases with no lot history, existing pre-FIFO behavior is retained unless negative debt makes the source ambiguous.
- `PurchaseManagement.gs:updatePurchaseInternal_` checks source-lot free quantity before reducing purchase quantity; blocks reserved-lot unit price edits, invoice discount edits that would revalue sold/owed stock, and supplier reassignment of reserved stock. Historic multiple source-lot rows in a purchase edit fail closed if an edit cannot safely identify the single source row. Ordinary independent payment/note edits retain existing behavior.
- `DeleteEngine.gs:deletePurchase` refuses deletion when any source lot of the purchase has positive FIFO-reserved quantity, even if net product stock appears high enough. Existing no-lot purchase delete compatibility is preserved for products without old negative debt.
- No edit to `Purchase.gs:createPurchase`: it **still does not automatically fund OVERSOLD debt**. Original old negative and positive lots remain physically unchanged until Task 5C.

## Numerical examples

**Example 1: Same purchase source, 240/231.** +240 Foot @৳64.75, verified old debt -231 Foot. The future owner-reviewed settlement is expected to fund 231, leave only 9 genuinely unallocated. Current Task 5B blocks returning 15 or reducing the purchased lot by 15. It permits return of 9 if other native return and supplier/cash constraints pass, leaving +231 -231 = 0 net stock. No COGS/posting change is implied yet.

**Example 2: Cross-purchase reservation.** A=20 Foot (older), B=30 Foot (newer), old debt -20. Net stock=30. A free=0, B free=30. Return/edit/delete of A's quantity or cost is blocked; returning B's 10 free Foot is permitted, reducing B's lot remaining to 20 and net product stock to 20.

These figures are synthetic regression fixtures, **not a verified audit of the user's live historical workbook**.

## Test-first evidence

- Superpowers RED → GREEN: 9 new focused pure reservations tests, source-integrated purchase-return, purchase-edit/delete, price/discount, supplier, combined invoice and historical duplicate-lot tests.
- RED originally allowed removal of owed inventory; tests rejected before any business-record writes.
- An additional RED found a historical purchase with two same-product stock-lot rows, where a last-row cost edit could bypass an older reserved row; it is now blocked.
- Full local `node --test tests/*.test.js`: **897 passed, 0 failed** from main-based worktree; `git diff --check` passed.
- The existing accounting state drift test fixture was updated to stub the new read-only helper, since that isolated test only loads the return handler and checks supplier settlement fields; separate true integration tests run the real stock helper.
- Exact GitHub Actions PR-head CI and independent reviewer approval remain required.

## Hard remaining gates — do not deploy Task 5B alone as final fix

1. **Task 5C:** Under the existing locked native `Purchase.gs:createPurchase`, atomically as possible reserve and journal the entire multi-item purchase intent, validate exact old sale-item provenance and allocate newly bought lot quantity against old negative stock *without an extra product stock movement*. Google Sheets cannot roll back partial writes: fault-inject every stage, block uncertain retries and provide source-row reconciliation.
2. **Accounting policy:** Repricing of each funded oversold portion from last purchased-lot provisional cost to the actual newly purchased lot cost must be source-linked in an immutable cost adjustment and profit report overlay. Preserve historical selling price, invoice, customer payment, supplier due, and source SALE_ITEM_LOTS evidence.
3. **Return/reversal policy:** If the future writer materializes a committed `STOCK_LOT_SETTLEMENTS` row, sale return and purchase correction must use its exact source-linked reversal. A remaining positive lot can be returned only to the extent not already funded; cost edits of funded purchases must still fail. This PR intentionally does not read uninitialized new journal sheets merely to add a preflight check, because `Database.gs:getSheet_` creates missing Sheets on read.
4. **Historical repair:** Full exported copy of the actual business Stock Lots/Sale Item Lots/Purchases/Returns, dry-run differences and human-reviewed reverse journal. Never infer an extra -2 Foot from screenshots.

No live Apps Script deployment, data backfill, settlement posting, transaction replay or PR merge is performed as part of this branch.
