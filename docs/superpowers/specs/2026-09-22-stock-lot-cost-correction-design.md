# SherERP — Opening/Adjustment Stock Lot Cost Correction Design

Date: 2026-09-22
Status: Proposed written specification for user review
Project: SHER-ERP-MOHIM
Scope: Google Apps Script + Google Sheets

## 1. Problem

SherERP has historical internal stock lots whose `STOCK_LOTS.Purchase Price` is blank or 0 even though the Product master later contains the correct purchase cost.

Observed example:

- Product: Tank N.M Black 500 L
- Product master Purchase Price: ৳4,100
- Lot: `LOT-000481`
- Lot source: `OPENING`
- Lot Purchase Price: ৳0
- Original Quantity: 2
- Remaining Quantity: 1
- One unit was already sold

When the sale consumed that lot, SherERP copied the lot Purchase Price into `SALE_ITEM_LOTS.Unit Cost`. Because the lot cost was 0, the historical sale recorded 0 COGS for that unit and its Gross Profit became overstated.

The uploaded Stock Lots data shows this is not isolated. Multiple `OPENING` and `ADJUSTMENT` lots have zero cost.

## 2. Root Cause

Current lot creation is source-based:

### Opening stock

`Products.addProduct()` creates an `OPENING` lot using the Product Purchase Price that existed at the moment the product was created.

If Product Purchase Price was 0 at that moment, the opening lot was permanently created at 0.

Later editing `PRODUCTS.Purchase Price` does not rewrite existing lots, because lots are historical inventory-cost records.

### Positive stock adjustment

`Products.adjustStock()` and positive stock changes through `updateProduct()` create an `ADJUSTMENT` lot using the Product master Purchase Price at the time of the adjustment.

If Product Purchase Price is 0 at that time, the new adjustment lot receives Purchase Price 0.

### Profit impact

FIFO sale consumption stores the consumed lot cost in:

`SALE_ITEM_LOTS.Unit Cost`

Profit calculations intentionally use this recorded lot-consumption evidence. Therefore a zero-cost lot causes historical COGS to be understated and profit to be overstated.

### Display masking

The Products list already contains a fallback that values certain zero-cost internal lots using the current Product Purchase Price. This makes the Products screen look correct even when the underlying lot is still 0.

That fallback affects display valuation only. It does not repair the actual lot cost or historical `SALE_ITEM_LOTS.Unit Cost`.

## 3. Design Goals

The feature must:

1. Repair existing zero/blank-cost internal stock lots safely.
2. Repair historical COGS only where exact lot lineage proves the relationship.
3. Correct remaining inventory valuation.
4. Ensure future sales from the repaired lot use the corrected cost.
5. Prevent new accidental zero-cost opening/adjustment lots.
6. Preserve sales revenue, customer balances, cash, bank, supplier balances, quantities, and FIFO chronology.
7. Provide a clear audit trail for every correction.
8. Support both one-lot correction and efficient bulk correction for many affected products.

## 4. Non-Goals

This feature must NOT:

- change Product Selling Price
- change Sales Invoice revenue
- change Sales Invoice quantity
- change Sales Invoice payment/settlement
- change Customer Due
- create Cash/Bank entries
- change Supplier Due
- edit a Purchase Invoice
- change stock quantity
- change lot Purchase Date
- change FIFO ordering
- change vendor-sourced COGS
- infer historical lot linkage when `SALE_ITEM_LOTS.Lot ID` is blank or does not match exactly
- provide a generic historical accounting rewrite engine

## 5. Eligible Lot Sources

V1 correction is intentionally limited to internal/non-purchase-origin lots.

Eligible source values:

- `OPENING`
- `OPENING-MIGRATION`
- `ADJUSTMENT`
- `LEGACY`
- values beginning with `OPENING-`
- values beginning with `ADJUSTMENT-`

The correction applies only when the stored lot Purchase Price is blank or 0.

Normal purchase-origin lots remain protected. Their cost must continue to be corrected through the native Purchase Edit workflow.

## 6. Accounting Model

For each corrected lot:

### Remaining inventory

Update only:

`STOCK_LOTS.Purchase Price`

The lot's remaining inventory value therefore becomes:

`Remaining Quantity × corrected Purchase Price`

No quantity changes.

### Historical sold quantity

Find `SALE_ITEM_LOTS` rows where:

`SALE_ITEM_LOTS.Lot ID == corrected STOCK_LOTS.Lot ID`

and update only:

`SALE_ITEM_LOTS.Unit Cost`

to the corrected lot Purchase Price.

Because Sales Invoice and Profit reports already compute owned-stock COGS from `SALE_ITEM_LOTS.Quantity × Unit Cost`, historical profit automatically recalculates correctly.

### Returned quantities

Sales Return lot restoration decrements `SALE_ITEM_LOTS.Quantity`. Therefore the current Quantity in `SALE_ITEM_LOTS` already represents sold quantity that remains economically sold.

Updating Unit Cost while keeping Quantity unchanged preserves the current return-aware COGS model.

Rows with Quantity = 0 may also be updated for lineage consistency, but they have no current profit effect.

### No financial ledger entry

A cost-data correction changes inventory valuation and COGS evidence but does not move money.

Therefore no Cash Book, Bank Book, Customer Ledger, Supplier Ledger, or Day Book money entry is created.

## 7. Exact-Lineage Rule

Historical COGS is repaired only through exact Lot ID matching.

Safe:

`LOT-000481 -> SALE_ITEM_LOTS rows with Lot ID = LOT-000481`

Unsafe and prohibited:

- guessing by Product ID
- guessing by invoice date
- reconstructing FIFO from today's state
- assigning blank Lot ID rows to a lot
- choosing a lot because it is the only currently remaining lot

If a historical `SALE_ITEM_LOTS` row has no usable Lot ID, this feature leaves it unchanged and reports it as unresolved rather than guessing.

## 8. Suggested Cost

For an eligible zero-cost lot, the UI suggests:

`PRODUCTS.Purchase Price`

as the proposed correction value.

The suggestion is not automatically trusted.

The user must review the value before saving.

If the Product master Purchase Price is also 0 or blank, the correction row is marked `Needs Cost` and requires manual input.

The accepted new cost must be a finite number greater than 0.

V1 does not use 0 as a corrected internal-stock cost because the feature exists specifically to repair accidental unpriced stock.

## 9. Single-Lot Correction UI

Existing path:

`Products -> Stock Lots -> selected product`

For an eligible zero-cost internal lot, show a button:

`Correct Purchase Cost`

The correction dialog shows:

- Lot ID
- Product
- Source
- Purchase/lot date
- Original Quantity
- Remaining Quantity
- Already Consumed Quantity
- Current Lot Cost
- Product Master Purchase Price
- Suggested New Cost
- Historical matched sale quantity
- Historical affected invoice count
- New Purchase Cost
- Correction Reason

`Correction Reason` is required.

Before confirmation, show a summary:

- remaining stock valuation increase/decrease
- historical COGS adjustment amount
- affected invoice count
- explicit notice that sale totals, payments, and stock quantity will not change

## 10. Bulk Correction UI

Because many lots are affected, Products gets a dedicated action:

`Unpriced Stock Lots`

This opens a review table containing all eligible zero/blank-cost internal lots.

Columns:

- Select
- Lot ID
- Product
- Source
- Date
- Original Qty
- Remaining Qty
- Consumed Qty
- Current Cost
- Product Purchase Price
- Proposed Cost
- Historical Invoice Count
- Historical COGS Impact
- Status

Statuses include:

- `Ready`
- `Needs Cost`
- `No Exact Historical Match`
- `Not Eligible`

The operator can:

- select individual rows
- select all `Ready` rows
- edit Proposed Cost per lot
- enter one required batch correction reason
- preview totals
- apply selected corrections

There is no automatic "fix everything without review" operation.

## 11. Server APIs

Conceptual public APIs:

`getUnpricedInternalStockLots(token)`

Returns read-only correction candidates and impact preview.

`correctInternalStockLotCost(token, payload)`

Corrects one lot.

`correctInternalStockLotCosts(token, payload)`

Corrects multiple selected lots in one validated batch.

Payload concept:

```js
{
  corrections: [
    {
      lotId: "LOT-000481",
      newPurchasePrice: 4100
    }
  ],
  reason: "Opening stock purchase cost was omitted during initial setup"
}
```

Server is authoritative. Client-provided impact totals are ignored.

## 12. Server Validation

All validation happens before the first business write.

For every selected correction:

1. require `products:edit`
2. obtain one ScriptLock
3. require non-empty correction reason
4. Lot ID must exist uniquely
5. lot must not be Deleted
6. lot source must be an eligible internal source
7. current lot Purchase Price must still be blank/0
8. new cost must be finite and greater than 0
9. Product ID must exist
10. historical rows are selected only by exact Lot ID
11. duplicate Lot IDs in the request are rejected

If any selected lot fails validation, the whole batch performs zero business writes.

Google Sheets still has no SQL transaction rollback. The design guarantees validation atomicity, not physical write rollback.

## 13. Write Phase

After all selected corrections pass validation:

For each lot, in deterministic Lot ID order:

1. update `STOCK_LOTS.Purchase Price`
2. update matching `SALE_ITEM_LOTS.Unit Cost`
3. append one audit record

No stock movement is created because quantity did not move.

No Sales Invoice edit is performed.

No Purchase edit is performed.

## 14. Audit Log

Add an additive sheet:

`STOCK_LOT_COST_CORRECTIONS`

Suggested columns:

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

This log is append-only.

A second correction of the same lot is not part of V1 because V1 only accepts currently blank/zero-cost lots.

## 15. Historical COGS Impact Calculation

For preview:

`matched historical quantity = sum(SALE_ITEM_LOTS.Quantity where Lot ID matches)`

Since existing Unit Cost is expected to be 0 for this defect:

`historical COGS increase = matched historical quantity × new Purchase Price`

For robustness, calculate the delta from stored Unit Cost:

`sum(Quantity × (new cost - old Unit Cost))`

This produces correct preview even if a matching historical row contains a nonzero inconsistent cost.

No historical invoice amount changes.

Profit changes only because COGS changes.

## 16. Future Prevention

The root cause must also be blocked.

### Product creation with positive opening stock

If:

`Opening Stock > 0`

then:

`Purchase Price must be > 0`

A Product may still have Purchase Price 0 when Opening Stock = 0.

### Positive Stock Adjustment

Before creating an `ADJUSTMENT` lot:

`Product Purchase Price must be > 0`

If cost is 0, reject the positive adjustment with a clear message:

`Set this product's Purchase Price before adding stock.`

Negative stock adjustments remain allowed because they consume existing FIFO lots and do not create a new cost lot.

### Product Edit that increases stock

If the edited stock quantity increases:

`submitted Purchase Price must be > 0`

The new adjustment lot then uses that submitted/current Product Purchase Price.

### Opening-lot migration

`migrateOpeningStockLots_()` must not silently create a zero-cost opening-migration lot.

For products with positive stock and Purchase Price <= 0:

- skip creation
- count/report them as unresolved
- require the Product Purchase Price to be corrected first

## 17. Defense in Depth

Add an internal guard to the internal-lot creation path so future callers cannot accidentally create positive `OPENING`, `OPENING-MIGRATION`, `ADJUSTMENT`, or `LEGACY` quantity at a zero/blank Purchase Price.

The guard applies only to internal-stock sources.

Real purchase lots retain existing Purchase workflow rules, including legitimate business cases governed by Purchase validation.

## 18. Products List Visibility

Keep the current stock-value fallback for backward compatibility until old bad data is repaired.

Additionally, surface an `Unpriced Lot` warning/count when a product still contains positive remaining eligible zero-cost internal stock.

This prevents the display fallback from silently hiding unresolved data.

After correction, the warning disappears naturally because the lot now has a real cost.

## 19. Reports and Invoice Profit

No formula changes are required in:

- `SalesManagement.gs`
- `Reports.gs`

They already use `SALE_ITEM_LOTS.Unit Cost`.

Required regression behavior:

Before correction:
- zero-cost lot -> understated COGS -> overstated profit

After correction:
- matching historical COGS uses corrected cost
- invoice revenue is unchanged
- returned quantities remain netted through existing `SALE_ITEM_LOTS.Quantity`
- gross profit and profit margin recalculate correctly
- Profit Report and invoice-detail profit agree

## 20. Example — LOT-000481

Current:

- Product Purchase Price: ৳4,100
- Lot Purchase Price: ৳0
- Original Qty: 2
- Remaining Qty: 1
- Matched currently-sold Qty: 1

Correction:

`LOT-000481 Purchase Price: 0 -> 4100`

Effects:

- Remaining lot value: `1 × 4100 = ৳4,100`
- Matching historical COGS increases by `1 × 4100 = ৳4,100`
- Product quantity remains 1
- Sales Invoice revenue remains unchanged
- Cash remains unchanged
- Customer settlement remains unchanged
- Gross Profit decreases by the missing ৳4,100 COGS

## 21. Files Expected to Change

Likely production files:

- `Config.gs`
- `StockLots.gs`
- `Products.gs`
- `products.html`
- `PROJECT.md`

Possibly:

- `Setup.gs` if schema/setup migration helpers are housed there

Tests:

- new Stock Lot cost-correction regression suite
- stock/FIFO tests
- invoice profit tests
- Profit Report tests
- RPC/security tests
- production static gate
- state-drift/integrity tests

No Sales transaction mutation module should need a new accounting write path.

## 22. Required Tests

### Existing-data correction

- zero-cost OPENING lot can be corrected
- zero-cost OPENING-MIGRATION lot can be corrected
- zero-cost ADJUSTMENT lot can be corrected
- zero-cost LEGACY lot can be corrected
- purchase-origin lot is rejected
- deleted lot is rejected
- nonzero-cost lot is rejected in V1
- zero new cost rejected
- negative/NaN new cost rejected
- correction reason required

### Historical COGS

- matching SALE_ITEM_LOTS by exact Lot ID gets corrected Unit Cost
- unrelated same-product Lot IDs are untouched
- blank Lot ID historical rows are untouched
- historical sales revenue is untouched
- customer due is untouched
- Cash/Bank are untouched
- stock quantity is untouched
- returned/net Quantity remains unchanged
- fully returned Quantity=0 row has no profit impact
- invoice profit recalculates from corrected COGS
- Profit Report matches invoice profit

### Bulk correction

- multiple lots validate before first write
- one invalid lot aborts entire batch before writes
- duplicate Lot ID request rejected
- deterministic application order
- one audit row per corrected lot
- preview totals equal applied deltas

### Prevention

- product with opening stock >0 and Purchase Price 0 rejected
- product with stock 0 may keep Purchase Price 0
- positive stock adjustment with Purchase Price 0 rejected
- negative adjustment unaffected
- product edit stock increase with Purchase Price 0 rejected
- opening migration skips/reports unresolved zero-cost product
- internal lot helper rejects positive zero-cost internal lot creation

### Compatibility

- normal purchase lots unchanged
- FIFO order unchanged
- stock return behavior unchanged
- POS sale pricing unchanged
- multi-invoice Sales Return tests remain green
- public RPC security includes new endpoints
- production static gate passes

## 23. Deployment / Repair Sequence

1. back up the live spreadsheet
2. deploy code with additive audit sheet/header support
3. run `setupSystem_()` to add required schema
4. open `Unpriced Stock Lots`
5. review every suggested Product Purchase Price
6. manually fill rows whose Product Purchase Price is still 0
7. preview affected historical invoice counts and COGS deltas
8. apply selected corrections
9. verify:
   - Stock Lots valuation
   - Product stock valuation
   - example invoice profit
   - Profit Report
   - no change to customer balances
   - no change to Cash/Bank
   - no change to stock quantities
10. correct remaining unresolved rows in additional reviewed batches

## 24. Acceptance Criteria

The feature is complete when:

- all reviewed zero-cost internal lots can be corrected without editing sales or purchase transactions
- matching historical COGS is repaired by exact Lot ID
- historical and future profit use the corrected cost
- remaining inventory valuation uses the corrected cost
- no customer/supplier/cash/bank/quantity side effect occurs
- every correction is auditable
- bulk review works for the many affected lots in the uploaded data
- new positive opening/adjustment stock cannot silently create another zero-cost internal lot
- normal purchase/FIFO/return accounting remains unchanged