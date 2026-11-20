# Mohim_ERP — Superpowers Task 5C3B1: Funded OVERSOLD Sales Return reversal plan

**Date:** 2026-11-20 (Asia/Dhaka)
**Repository:** `shuvodelux-commits/Mohim_ERP` (original Google Apps Script + Google Sheets)
**Source baseline:** `e2b6a2fb5d788e33b24b11d75d65e47c215c0cbc`, verified merged PR #64
**Scope:** Pure, source-linked and **NON-POSTABLE** refund stock/cost reversal proposal; no active sale return/refund writer.
**Release flag:** `CONFIG.PURCHASE_SETTLEMENT_WRITER_RELEASE_APPROVED=false` remains unchanged. No live data touched, no clasp deploy.

## Why the return is currently blocked

`StockLots.gs:planSaleReturnRestoration_` has an intentional guard: an original `OVERSOLD` source with **any** linked purchase-settlement record cannot be returned by the old generic fallback return path. The original sale has provisional `SALE_ITEM_LOTS.Unit Cost`, while actual purchase allocations now live in immutable `STOCK_LOT_SETTLEMENTS`. A naive return would increase stock in the wrong lot, make `SALE_ITEM_LOTS.Quantity` inconsistent with the committed allocation quantity, and generate incorrect actual COGS/returns.

PR #63 introduced the **disabled** purchase settlement writer and staged purchase receipt journal. PR #64 introduced the **read-only** original-sale-period effective COGS overlay, but intentionally does not handle funded sale-return reversal evidence yet.

## Implemented: `OversoldSaleReturnSettlement.gs`

One pure Apps Script V8 helper, **`planFundedOversoldSaleReturn_(snapshot)`**, accepts complete trusted original-sale product, sale consumption, current stock/lot, exact committed settlement/purchase/journal and prior reversal/receipt evidence. It performs no direct or indirect `SpreadsheetApp`, `getSheet_`, CashBook, Customer ledger or sales-return mutation and always returns `postable:false`.

1. Enforces unique stable operation and return identities; an existing receipt, event or journal operation ID cannot be silently reused. Pending Writing/Needs Review return or purchase journals block the proposal.
2. Verifies one exact original `SALE_ITEM_LOTS` invoice/physical-product/source-sale-product/OVERSOLD-lot lineage, original sale cost and returnable **net** quantity. Validates global relevant Lot ID uniqueness, stock-cache-to-signed-lots reconciliation, canonical 6-decimal integer quantity ticks, expected old lot status and row identity.
3. Validates each distinct committed purchase settlement event against its specific new purchase lot and cost, matching original sale source, purchase header with **zero purchase-wide discount**, committed journal/receipt, cost in integer paisa and COGS/variance conservation. Missing/duplicated/pending source evidence returns Needs Review with no partial proposal.
4. For a return of **R** base units: first reduce outstanding **unfunded** negative old debt toward zero by `min(R, outstandingNegative)`; this restores part of the exact negative source. Remaining returned units reverse **latest purchased allocation first** from committed events (LIFO by append order), restoring physical quantities to those **same actual purchase lots**, never an invented RETURN lot.
5. Preserves the **original immutable** `STOCK_LOT_SETTLEMENTS` event. Proposes additional source-linked reversal records: original committed settlement ID, source invoice/product, old negative and new purchase Lot IDs, return ID/operation ID, canonical reversed units, actual and provisional unit cost, exact returned COGS, and signed delta to cancel the relevant previously recognized actual-minus-provisional cost adjustment. It does **not** issue a reversal ID or write a row.
6. Computes partial-return paisa effects by the **difference of cumulatively rounded cost totals**: `round((previous reversed + new reversed) × unit cost) − round(previous reversed × unit cost)` for each original event. This avoids a cent of drift after many small fractional returns; all partial reversals sum back to the originally committed provisional/actual COGS when fully reversed.
7. Proposed new stock equals the original product net stock **plus returned quantity once**. The sum of physical old-debt reduction and purchased-lot restoration equals returned quantity. No extra stock adjustment for reversal itself. The real Sales Return writer remains responsible for one normal Stock Movement, refund/Store Credit, and the single product Current Stock update.

### Numerical synthetic proof

Original source invoice sold **229 Foot** provisionally costed at **৳68**. One real +240 Foot purchase @ **৳64.75** funded the 229 Foot; purchased lot has 9 remaining and old negative is zero.

**Returning 5 Foot** now proposes:
- Original sale-item lot net quantity **229 → 224**.
- New purchase lot remaining **9 → 14**; original OVERSOLD negative lot remains **0**, avoiding a second stock increase.
- Products Current Stock **9 → 14** once.
- One immutable event reversing **5 Foot** of the original settlement, with returned provisional cost **৳340.00**, returned actual cost **৳323.75**, and **+৳16.25** cost-overlay adjustment (cancels the earlier favorable COGS difference attributable to those now-returned units).
- Customer refund/store-credit amount is **NOT** decided by cost basis. It must use the original discounted sale return pricing/refund rules in `SalesReturn.gs`.

If original source had 129 Foot funded and 100 Foot still negative, returning 105 Foot proposes old debt `-100→0` plus a **5-Foot** reversal of funded actual purchase stock. A 100-Foot first purchase followed by a 129-Foot later purchase at a different actual cost is reversed **latest purchase allocation first**. Each purchase lot retains its own actual unit cost.

These are **source test fixtures, not observed live Google Sheets business data**.

## RED → GREEN and safety boundaries

- 15 initial tests RED on missing implementation, then GREEN; 3 more tests RED for cumulative actual cost rounding, return operation identity and exact source linking, then GREEN; further RED caught the same Lot ID illegally reused by another product, now guarded.
- Focused unit tests cover complete and partial funding, multiple cost batches, duplicate/reused operation or return IDs, interrupted prior journals/reversals, missing original source sale, invalid source cost, incorrect scale, wrong cached stock, no fabricated cost, and immutable read-only proposal.
- Full local regression suite: **1,012/1,012 Node tests passed** (zero failures), using a regular on-disk temp directory because the connected machine’s /tmp tmpfs is full. Exact-commit GitHub Actions and independent review remain to be verified from the PR head. An in-memory pure planner test does **not** prove that an actual Google Sheets multi-row refund is atomic.

## Remaining execution gates — NOT implemented here

**Task 5C3B2: actual funded Sales Return/Refund integration.** Add source-specific `STOCK_LOT_SETTLEMENT_REVERSALS` schema, strict staging and durable return operation journal before any physical/product/cash/customer write. Wire through `prepareSalesReturn_` / `commitPreparedSalesReturn_` and batch/correction/delete only after all child returns are prevalidated and linked. Write prior event reversal records with unique idempotency, preserve source lot and original sale cost evidence, verify refund and all stock/cost rows after unknown Spreadsheet errors. Never remove the existing block before that writer is proven.

**Task 5C3B3: immutable COGS reversal reporting.** `ProfitOversoldCosts.gs` in PR #64 does not read reversal rows. It MUST first be taught to deduct genuine, committed, source-verified reversible quantities and use cumulative rounded reversal paisa before enabling the active Sales Return reversal. Otherwise after a return `SALE_ITEM_LOTS.Quantity` would decrease while original committed event remains unchanged and Profit report will correctly fail Needs Review.

**Task 5C3C: interrupted-purchase cross-module quarantine** of POS, sales, returns and finance money effects while a purchase journal is Writing/Needs Review. Purchase journal currently blocks purchase only; user requires business calculations 100% right. This is a hard release gate, not optional polish.

**Deployment gate:** copied full backup of actual Sheets; explicit schema setup and real SpreadsheetApp fault-injection; independent accounting/super review; full GitHub CI; user-reviewed discount allocation policy; separately authorized code flag activation and clasp deployment. **No deployment and no historical data repair have occurred.**

**Result:** this PR narrows the exact reversal accounting contract but DOES NOT unlock the currently blocked funded Sales Return. The source-only planner can be merged safely after independent review without changing live business behavior.
