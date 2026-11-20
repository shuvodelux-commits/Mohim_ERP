# Mohim_ERP GAS — Superpowers Task 5C1: whole-purchase settlement prewrite contract

**Date:** 2026-11-20 (Asia/Dhaka)
**Repository:** shuvodelux-commits/Mohim_ERP (original Google Apps Script + Sheets)
**Source baseline:** `fa0ec9f05194bb2dc84ce0bb8a451b510d0ed274`; PR #61 merged into `main`
**Status:** source-native pure settlement plan and immutable proposed offsets; **not a production writer, no deployment**
**Related:** issue #55; prior read-only planner PR #57 (promoted via #58), last-purchase oversold rule PR #56 and native purchase guards PR #61.

## The bug remains in the existing purchase writer

The original `Purchase.gs:createPurchase` increases `Products.Current Stock` by total purchased quantity, inserts a fresh positive purchase lot with gross quantity and books supplier/cash/bank effects. It **does not** transfer quantities from earlier negative `OVERSOLD` source lots to the new purchase lot. The previous PRs stop double-selling/invalid returns but do not finalize the sold stock's actual effective purchase cost or its profit.

## New functions and test-first contract

`PurchaseSettlement.gs` adds these three private Apps Script V8 helpers:

1. **`prepareOversoldPurchaseBatch_(snapshot)`** — accepts a trusted, server-prepared *whole purchase* and complete product/stock/sale evidence snapshot, not a browser-level ready-to-write request. Calls `StockLots.gs:planOversoldPurchaseSettlement_` for each distinct product; if **any** line fails provenance, stock-cache reconciliation, chronological sale/purchase date, money/unit precision, prior event identity, history scale, or journal state, returns the **entire batch** as `NEEDS_REVIEW` with no partial allocations. Valid lines produce integer quantity ticks, original sale/source links and signed cost variances. Uses original business sale date, not process timestamp. It does not change the source lots.
2. **`buildOversoldPurchaseOffsetSet_(batch,purchaseLotIds,sourceLots)`** — pure immutable proposed offsets: newly purchased lot original quantity **Q**, remaining available **Q − funded**, and each previously negative OVERSOLD lot moving **toward zero by funded**, with `Status` becoming `Consumed` only at zero. Events preserve original sale invoice/item provenance, original provisional cost, new source purchase lot, actual cost and favorable or unfavorable delta. Returns projected product stock changes **+Q exactly once**; `extraProductStockDeltaTicks=0` asserts settlement itself must never change Products.Current Stock a second time. Rejects missing/duplicate new lot IDs or stale old debt quantities.
3. **`buildPurchaseSettlementIntentHash_(intent)`** — canonical SHA-256 whole-cart hash using GAS `Utilities.computeDigest`. Order-insensitive product line map, stable operation ID and actor, supplier, business date/backdate reason, canonical quantity ticks/scale, purchase cost and selling price minor units, purchase discount, paid amount, payment method, bank account and notes all contribute. Changes to any economically or security-relevant field change the digest. Hash deliberately excludes the server-assigned Purchase ID (which must be recorded as a receipt/journal field). The **future native locked writer** must derive all hash arguments from the validated server request and authenticate the actor itself.

No new UI, RPC, sheet mutation, journal append, reservation, or DB transaction is performed. Every result sets `postable:false`. Future code must never interpret a preview's `READY` status as permission to post; it is a data-consistency preflight only.

## Numerical conservation example (synthetic)

If full source rows verify -229 Foot and -2 Foot genuinely sold on earlier dates at provisional ৳68 per Foot, a new 240 Foot purchase at entered real lot cost ৳64.75 can be planned as:

- Newly purchased source lot: **Original Q=240**, **Available remaining Q=9**.
- Old negative source lot A: -229 → 0; B: -2 → 0.
- Product net stock: -231 + 240 = **+9**, applied only once by the existing purchase.
- Signed provisional less final cost: **231 × (৳68 − ৳64.75) = +৳750.75** favorable cost variance.
- A second independent product purchased 5 units in the same invoice remains 5 units available; failure on its validation blocks the entire purchase prewrite plan.

**Do not infer the extra -2 Foot from a screenshot**. A +240 purchase and visible -229 debt alone leave 11 Foot if no other effects exist. Actual results depend on verified source SALE_ITEM_LOTS and historic STOCK_LOTS, not this example.

## Existing source limitations / explicit rulings

- Prior `planOversoldPurchaseSettlement_` requires **no gross positive lot to coexist with an unresolved negative OVERSOLD lot**. If old stock is already mixed, it yields Needs Review; automatic historical repair is outside this branch. This is deliberate because blindly funding only newly bought lots could double-fund previous sold stock.
- Historical committed settlement records are normalized from the reserved schema `STOCK_LOT_SETTLEMENTS`, with globally unique immutable settlement IDs, original invoice/product/old/new lot identities, positive integer quantities, consistent canonical quantity scales and minor-unit costs. Prior interrupted events block posting. A second actual purchase at another unit cost can fund remaining negative quantity without changing the first purchase's previous allocation.
- `prepareOversoldPurchaseBatch_` intentionally **rejects all existing operation-ID replays**, even a committed one. A future writer must separately validate complete SHA-256 equality, original reserved Purchase ID, committed receipt, source cash/supplier/movements, lots and all events before returning a replay. It may not run a second write merely because a timeout occurred.
- Existing source `Purchase.gs` stores the entered **gross Unit Price** as `StockLots.Purchase Price`; invoice-level discount is separate. The user-approved rule is last genuine purchased-lot cost at sale time, then actual purchase lot cost when replenished. Whether a purchase-wide discount should be allocated to funded unit cost, the finance journal recognition date and cumulative partial reversals must receive **separate explicit accounting signoff**. This branch only uses the line's provided unit cost; it does not silently redistribute discounts.
- Quantity scale (base unit ticks) must be derived authoritatively by the future writer from validated product/unit configuration. The user may sell in Box/Pcs/Sqft or other multi-units, but this planner cannot infer their conversion rule. Invalid scale or fraction fails closed.
- Google Sheets multi-row writes are not atomic. `Database.gs:getSheet_` can create missing sheets *on read*. The next phase must use explicit schema setup/repair on a copied workbook, not treat a read as a guaranteed zero-side-effect preflight.

## Superpowers RED → GREEN evidence

- Starting branch `main` has prior Task 5B implemented and merged; local baseline tests remain intact.
- **RED:** 13 new pure prewrite cases initially failed because the new functions did not exist. Two subsequent safety tests detected mismatched history quantity scale and globally duplicate settlement IDs. Two intent-hash tests confirmed complete-cart idempotency was absent.
- **GREEN:** 17 focused tests passed after implementation. SHA-256 test adapter uses Node crypto only in tests; shipped GAS code uses first-party `Utilities.computeDigest`.
- Full suite, exact GitHub Actions CI and review evidence are recorded in this PR's verification comments, not inferred from the focused test result.

## Next execution gates (Task 5C2 / 5C3)

1. **5C2 — real journalled writer:** Under `LockService.getScriptLock`, require valid user purchase permission, active Cash Session, supplier/product status, canonical unit conversions, bank/cash amounts, whole-payload fingerprint and original source Sale Item Lots. Preflight all cart lines before any business mutation. Reserve operation and server-generated purchase ID in `PURCHASE_SETTLEMENT_JOURNAL` with `Writing` state. Never treat a failed/timeout append or stage update as guaranteed not committed. In a copied workbook, fault-inject every stage, including unknown append results.
2. Integrate exactly the **existing** purchase header, items, single +Q Current Stock movement and normal supplier payment/ledger path. Create new lot at Q, apply -funded against its remaining, +funded against each old OVERSOLD debt, append source-linked immutable `STOCK_LOT_SETTLEMENTS` rows, and verify all row effects and net stock on readback before marking committed. Separate `Needs Review` for partial writes; no blind retry or automatic rollback.
3. **5C3 — return/finance overlay:** Purchased stock already allocated to oversold sales is not returnable; source-linked sale returns and corrections must reverse only their original purchased allocation, purchase return/edit/delete must guard funded links, and cost delta must appear exactly once in effective COGS/profit reporting and audit. Never edit original invoice selling prices, customer payments or supplier due just to change COGS. Complete copied-sheet preview and owner accounting review before any live deployment/historical reconciliation.

**Release status:** The user-facing new-purchase auto-settlement/profit bug remains **NOT YET FIXED** by this PR. This is its exact source-linked prewrite and idempotency foundation only.
