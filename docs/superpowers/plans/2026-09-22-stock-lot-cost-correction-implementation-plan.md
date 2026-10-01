# Stock Lot Purchase-Cost Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair zero/blank Purchase Price on internal OPENING/ADJUSTMENT/LEGACY stock lots, propagate the corrected cost to exact historical `SALE_ITEM_LOTS` evidence so profit becomes accurate, and prevent future positive internal stock from being created at zero cost.

**Architecture:** Keep `STOCK_LOTS` as the authoritative lot-cost record and `SALE_ITEM_LOTS` as the authoritative historical sold-cost evidence. Add a narrowly scoped correction service in `StockLots.gs` that validates every selected lot before writes, updates only exact Lot ID matches, and appends an audit row per corrected lot. Add Products UI for single/bulk review, plus source-level guards in Product creation/positive adjustment/migration so the defect cannot recur.

**Tech Stack:** Google Apps Script V8, browser HTML/JavaScript, Google Sheets through existing `Database.gs` helpers, Node.js regression/static tests.

**Spec:** `/mnt/data/2026-09-22-stock-lot-cost-correction-design.md`  
Repository destination when/if the user later authorizes a push: `docs/superpowers/specs/2026-09-22-stock-lot-cost-correction-design.md`

## Global Constraints

- Start from GitHub `main` snapshot commit `647333b337f66e3e1f043d537f6a9aa8d74a480d`.
- Do not push, merge, open a PR, or mutate GitHub during implementation without explicit user permission.
- Implement locally in an isolated workspace and deliver changed files as a ZIP after verification.
- Google Sheets has no SQL transaction rollback. All rejectable business validation must complete before the first correction write.
- UI → service/business logic → existing `Database.gs` helpers → Sheets.
- One ScriptLock around each correction request.
- Reuse `products:edit` for mutations and `products:view` for previews.
- Historical repair may update only `SALE_ITEM_LOTS` rows whose `Lot ID` exactly equals the corrected `STOCK_LOTS.Lot ID`.
- Never infer or reconstruct historical linkage from Product ID, invoice date, FIFO order, or blank Lot IDs.
- Do not change sales revenue, sale quantity, customer due, payment allocation, Cash Book, Bank Book, supplier balances, stock quantity, lot FIFO date/order, or Purchase Invoice data.
- V1 corrects only blank/zero-cost internal lot sources: `OPENING`, `OPENING-MIGRATION`, `ADJUSTMENT`, `LEGACY`, `OPENING-*`, `ADJUSTMENT-*`.
- V1 corrected cost must be greater than zero.
- Existing real Purchase lots remain controlled by Purchase Edit.
- Every correction requires a nonblank reason and writes an append-only audit row.
- Keep the existing Product-list valuation fallback until bad data is corrected, but surface unresolved unpriced-lot warnings.
- All new production behavior must be implemented TDD-first.

## File Structure

**Modify**
- `Config.gs` — declare the audit sheet, headers, and ID prefix.
- `StockLots.gs` — source classification, preview/planning, exact-lineage repair, batch commit, audit, and internal-lot zero-cost guard.
- `Products.gs` — prevent positive opening/adjustment stock from creating zero-cost internal lots and expose warning counts in bootstrap.
- `products.html` — per-lot correction action plus bulk `Unpriced Stock Lots` review/preview/apply UI.
- `PROJECT.md` — document correction semantics, historical COGS repair, and future prevention.
- `.github/workflows/regression-tests.yml` — add the new suite when GitHub changes are eventually authorized.

**Create**
- `tests/stock_lot_cost_correction_regressions.test.js` — behavioral tests for classification, planning, exact-lineage repair, prevention, and bulk validation.
- `tests/stock_lot_cost_correction_ui_static.test.js` — focused UI/static checks for the Products workflow.

**Existing tests to extend only when needed**
- `tests/audit_sales_stock.test.js`
- `tests/deep_review_regressions.test.js`
- `tests/production_gate_static.test.js`
- `tests/public_rpc_security.test.js`
- invoice-profit/report regression suites already covering `SALE_ITEM_LOTS.Unit Cost`.

## Review Focus

1. **A zero-cost real Purchase lot** must never become eligible just because its cost is 0; test Purchase ID `PUR-000001` is rejected while `OPENING` is eligible.
2. **A same-product historical row with a different Lot ID** must remain untouched; exact lineage beats Product ID matching.
3. **A correction batch where the final lot is invalid** must produce zero writes for every earlier valid lot.
4. **A positive adjustment while Product Purchase Price is blank/0** must fail before Product stock or lot rows are written.
5. **A returned sale whose `SALE_ITEM_LOTS.Quantity` has been reduced** must use that current net quantity for COGS delta, with no return-row rewrite.

---

### Task 1: Add the cost-correction audit schema

**Files:**
- Modify: `Config.gs:29-70` (`CONFIG.SHEETS`)
- Modify: `Config.gs:429-465` vicinity (`CONFIG.HEADERS`)
- Modify: `Config.gs:971-1010` (`CONFIG.ID_PREFIX`)
- Test: `tests/stock_lot_cost_correction_regressions.test.js`

**Interfaces:**
- Produces sheet key: `STOCK_LOT_COST_CORRECTIONS`
- Produces sequential prefix: `SLC`
- Produces audit columns consumed by Task 3.

- [ ] **Step 1: Write the failing schema test**

Add a test that parses/evaluates `Config.gs` and requires:

```js
assert.equal(CONFIG.SHEETS.STOCK_LOT_COST_CORRECTIONS, 'Stock Lot Cost Corrections');
assert.equal(CONFIG.ID_PREFIX.STOCK_LOT_COST_CORRECTIONS, 'SLC');
assert.deepEqual(CONFIG.HEADERS.STOCK_LOT_COST_CORRECTIONS, [
  'Correction ID',
  'Date',
  'Lot ID',
  'Product ID',
  'Product Name',
  'Source',
  'Old Purchase Price',
  'New Purchase Price',
  'Original Quantity',
  'Remaining Quantity',
  'Matched Historical Quantity',
  'Affected Invoice Count',
  'Historical COGS Delta',
  'Reason',
  'Corrected By',
  'Created At'
]);
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
node --test tests/stock_lot_cost_correction_regressions.test.js
```

Expected failure: missing `STOCK_LOT_COST_CORRECTIONS`.

- [ ] **Step 3: Add the additive schema**

In `CONFIG.SHEETS`:

```js
STOCK_LOT_COST_CORRECTIONS: "Stock Lot Cost Corrections",
```

In `CONFIG.HEADERS`:

```js
STOCK_LOT_COST_CORRECTIONS: [
  "Correction ID",
  "Date",
  "Lot ID",
  "Product ID",
  "Product Name",
  "Source",
  "Old Purchase Price",
  "New Purchase Price",
  "Original Quantity",
  "Remaining Quantity",
  "Matched Historical Quantity",
  "Affected Invoice Count",
  "Historical COGS Delta",
  "Reason",
  "Corrected By",
  "Created At",
],
```

In `CONFIG.ID_PREFIX`:

```js
STOCK_LOT_COST_CORRECTIONS: "SLC",
```

Do not add soft-delete fields. This is append-only audit history.

- [ ] **Step 4: Run focused test and verify GREEN**

```bash
node --test tests/stock_lot_cost_correction_regressions.test.js
```

Expected: schema assertions pass.

- [ ] **Step 5: Local commit only**

```bash
git add Config.gs tests/stock_lot_cost_correction_regressions.test.js
git commit -m "feat: add stock lot cost correction audit schema"
```

Do not push.

---

### Task 2: Build pure eligibility and preview planning helpers

**Files:**
- Modify: `StockLots.gs:580-738`
- Test: `tests/stock_lot_cost_correction_regressions.test.js`

**Interfaces:**
- Produces `isInternalCostCorrectionSource_(purchaseId) -> boolean`
- Produces `isZeroStoredCost_(rawCost) -> boolean`
- Produces `buildInternalStockLotCostCandidate_(lot, product, saleItemLots) -> object`
- Produces `getUnpricedInternalStockLots(token) -> ok_({ lots, summary })`

Candidate shape:

```js
{
  lotId,
  productId,
  productName,
  source,
  purchaseDate,
  originalQuantity,
  remainingQuantity,
  consumedQuantity,
  currentPurchasePrice,
  productPurchasePrice,
  suggestedPurchasePrice,
  matchedHistoricalQuantity,
  affectedInvoiceCount,
  historicalCogsDelta,
  status // 'Ready' | 'Needs Cost'
}
```

- [ ] **Step 1: Write failing tests for source classification**

Tests:

```js
assert.equal(api.isInternalCostCorrectionSource_('OPENING'), true);
assert.equal(api.isInternalCostCorrectionSource_('OPENING-MIGRATION'), true);
assert.equal(api.isInternalCostCorrectionSource_('OPENING-2025'), true);
assert.equal(api.isInternalCostCorrectionSource_('ADJUSTMENT'), true);
assert.equal(api.isInternalCostCorrectionSource_('ADJUSTMENT-MANUAL'), true);
assert.equal(api.isInternalCostCorrectionSource_('LEGACY'), true);

assert.equal(api.isInternalCostCorrectionSource_('PUR-000001'), false);
assert.equal(api.isInternalCostCorrectionSource_(''), false);
assert.equal(api.isInternalCostCorrectionSource_(null), false);
```

Include the Review Focus case proving a real Purchase lot is not eligible.

- [ ] **Step 2: Run and verify RED**

```bash
node --test tests/stock_lot_cost_correction_regressions.test.js
```

Expected failure: helper missing.

- [ ] **Step 3: Implement minimal source helper**

```js
function isInternalCostCorrectionSource_(purchaseId) {
  const source = String(purchaseId || '').trim().toUpperCase();
  return source === 'OPENING' ||
    source === 'OPENING-MIGRATION' ||
    source === 'ADJUSTMENT' ||
    source === 'LEGACY' ||
    source.indexOf('OPENING-') === 0 ||
    source.indexOf('ADJUSTMENT-') === 0;
}
```

Implement `isZeroStoredCost_` so blank/null/undefined and numeric 0 are considered unpriced, while negative/non-numeric are not silently normalized into an eligible value.

- [ ] **Step 4: Write failing candidate-preview tests**

Use one lot and mixed historical rows:

```js
const lot = {
  'Lot ID': 'LOT-1',
  'Product ID': 'P1',
  'Product Name': 'Tank',
  'Purchase ID': 'OPENING',
  'Purchase Date': '2026-09-01',
  'Purchase Price': 0,
  'Original Quantity': 2,
  'Remaining Quantity': 1,
  Status: 'Active'
};

const product = {
  'Product ID': 'P1',
  'Purchase Price': 4100
};

const evidence = [
  { 'Invoice ID': 'INV-1', 'Product ID': 'P1', 'Lot ID': 'LOT-1', Quantity: 1, 'Unit Cost': 0 },
  { 'Invoice ID': 'INV-2', 'Product ID': 'P1', 'Lot ID': 'LOT-X', Quantity: 4, 'Unit Cost': 0 },
  { 'Invoice ID': 'INV-3', 'Product ID': 'P1', 'Lot ID': '', Quantity: 2, 'Unit Cost': 0 }
];

const c = api.buildInternalStockLotCostCandidate_(lot, product, evidence);
assert.equal(c.matchedHistoricalQuantity, 1);
assert.equal(c.affectedInvoiceCount, 1);
assert.equal(c.historicalCogsDelta, 4100);
assert.equal(c.suggestedPurchasePrice, 4100);
assert.equal(c.status, 'Ready');
```

Add a second product with master Purchase Price 0 and assert `status === 'Needs Cost'`.

- [ ] **Step 5: Run and verify RED**

Expected failure: candidate helper missing.

- [ ] **Step 6: Implement candidate calculation**

Historical rows must be filtered only by:

```js
row['Lot ID'] === lot['Lot ID']
```

Compute delta robustly:

```js
const qty = Number(row['Quantity']) || 0;
const oldCost = Number(row['Unit Cost']) || 0;
delta += qty * (suggestedCost - oldCost);
```

Affected invoice count is the count of unique nonblank `Invoice ID` values among exact matches.

Consumed quantity shown in UI is informational:

```js
Math.max(0, Number(lot['Original Quantity']) - Number(lot['Remaining Quantity']))
```

Do not use consumed quantity to decide which historical rows to rewrite.

- [ ] **Step 7: Write failing public-preview API test**

Stub `getAllRows_` for `PRODUCTS`, `STOCK_LOTS`, and `SALE_ITEM_LOTS`; assert:

- `requirePermission_(token, 'products', 'view')` is called.
- eligible zero-cost internal lots are returned.
- Purchase-origin and nonzero-cost lots are excluded.
- response summary contains candidate count, ready count, needs-cost count, remaining quantity, historical matched quantity, and projected COGS delta.

- [ ] **Step 8: Implement `getUnpricedInternalStockLots(token)`**

Read each required sheet once:

```js
const products = getAllRows_('PRODUCTS');
const lots = getAllRows_('STOCK_LOTS');
const saleItemLots = getAllRows_('SALE_ITEM_LOTS');
```

Build indexes once; do not scan the full evidence array once per candidate.

- [ ] **Step 9: Run focused suite and verify GREEN**

```bash
node --test tests/stock_lot_cost_correction_regressions.test.js
```

- [ ] **Step 10: Local commit only**

```bash
git add StockLots.gs tests/stock_lot_cost_correction_regressions.test.js
git commit -m "feat: preview unpriced internal stock lots"
```

Do not push.

---

### Task 3: Implement validation-first single and bulk cost correction

**Files:**
- Modify: `StockLots.gs`
- Test: `tests/stock_lot_cost_correction_regressions.test.js`
- Extend if needed: `tests/public_rpc_security.test.js`
- Extend if needed: `tests/production_gate_static.test.js`

**Interfaces:**
- Produces `prepareInternalStockLotCostCorrections_(payload, context) -> prepared[]`
- Produces `commitInternalStockLotCostCorrections_(user, reason, prepared) -> result`
- Produces public `correctInternalStockLotCosts(token, payload)`
- Produces public `correctInternalStockLotCost(token, payload)` as a thin one-lot wrapper.

Prepared item shape:

```js
{
  lot,
  lotRowIndex,
  product,
  newPurchasePrice,
  matchedRows: [
    { rowIndex, invoiceId, quantity, oldUnitCost }
  ],
  matchedHistoricalQuantity,
  affectedInvoiceCount,
  historicalCogsDelta
}
```

- [ ] **Step 1: Write failing validation tests**

Cover all of these independently:

```text
missing reason
duplicate Lot ID in payload
lot does not exist
deleted lot
Purchase-origin lot
nonzero existing cost
new cost = 0
new cost < 0
new cost = NaN/non-numeric
missing Product master row
```

For every failure, assert no `updateRowFields_` and no `appendRow_` call occurred.

- [ ] **Step 2: Run focused suite and verify RED**

```bash
node --test tests/stock_lot_cost_correction_regressions.test.js
```

- [ ] **Step 3: Implement read-only preparation**

Preparation must:

```js
function prepareInternalStockLotCostCorrections_(payload, context) {
  // validate request-level reason/corrections
  // reject duplicate lot IDs
  // resolve lots by exact Lot ID
  // validate every selected lot
  // resolve Product row
  // collect exact matching SALE_ITEM_LOTS by Lot ID
  // compute deltas
  // return prepared array
}
```

No Database write helper is allowed inside this function.

- [ ] **Step 4: Add the Review Focus batch-atomicity test**

Construct two selected lots:

- first valid
- second invalid because source is `PUR-000100`

Call `correctInternalStockLotCosts`.

Assert:

```js
assert.equal(writes.length, 0);
```

This must fail before implementation and pass only when all preparation finishes before the first write.

- [ ] **Step 5: Implement commit helper**

For prepared items sorted lexicographically by Lot ID:

```js
updateRowFields_('STOCK_LOTS', item.lotRowIndex, {
  'Purchase Price': item.newPurchasePrice
});

item.matchedRows.forEach(function (r) {
  updateRowFields_('SALE_ITEM_LOTS', r.rowIndex, {
    'Unit Cost': item.newPurchasePrice
  });
});

appendRow_('STOCK_LOT_COST_CORRECTIONS', {
  'Correction ID': generateId_('STOCK_LOT_COST_CORRECTIONS'),
  'Date': new Date(),
  'Lot ID': item.lot['Lot ID'],
  'Product ID': item.product['Product ID'],
  'Product Name': item.product['Product Name'],
  'Source': item.lot['Purchase ID'],
  'Old Purchase Price': Number(item.lot['Purchase Price']) || 0,
  'New Purchase Price': item.newPurchasePrice,
  'Original Quantity': Number(item.lot['Original Quantity']) || 0,
  'Remaining Quantity': Number(item.lot['Remaining Quantity']) || 0,
  'Matched Historical Quantity': item.matchedHistoricalQuantity,
  'Affected Invoice Count': item.affectedInvoiceCount,
  'Historical COGS Delta': item.historicalCogsDelta,
  'Reason': reason,
  'Corrected By': actorName_(user),
  'Created At': now
});
```

Do not write `STOCK_MOVEMENT`.

Do not touch `SALES`, `SALE_ITEMS`, `CUSTOMERS`, ledgers, Cash Book, Bank Book, or Purchases.

- [ ] **Step 6: Implement public batch endpoint**

```js
function correctInternalStockLotCosts(token, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    const user = requirePermission_(token, 'products', 'edit');
    const context = loadInternalStockLotCostCorrectionContext_();
    const prepared = prepareInternalStockLotCostCorrections_(payload, context);
    return ok_(commitInternalStockLotCostCorrections_(user, sanitizeInput_(payload.reason), prepared));
  } catch (err) {
    logError_('correctInternalStockLotCosts', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}
```

`loadInternalStockLotCostCorrectionContext_()` must read `PRODUCTS`, `STOCK_LOTS`, and `SALE_ITEM_LOTS` once each and build indexes.

- [ ] **Step 7: Implement one-lot wrapper**

```js
function correctInternalStockLotCost(token, payload) {
  return correctInternalStockLotCosts(token, {
    corrections: [{
      lotId: payload.lotId,
      newPurchasePrice: payload.newPurchasePrice
    }],
    reason: payload.reason
  });
}
```

Do not add a second accounting engine.

- [ ] **Step 8: Write exact-lineage mutation tests**

Fixture:

```js
SALE_ITEM_LOTS = [
  { _rowIndex: 2, 'Invoice ID': 'INV-1', 'Product ID': 'P1', 'Lot ID': 'LOT-1', Quantity: 1, 'Unit Cost': 0 },
  { _rowIndex: 3, 'Invoice ID': 'INV-2', 'Product ID': 'P1', 'Lot ID': 'LOT-2', Quantity: 1, 'Unit Cost': 0 },
  { _rowIndex: 4, 'Invoice ID': 'INV-3', 'Product ID': 'P1', 'Lot ID': '', Quantity: 1, 'Unit Cost': 0 }
];
```

After correcting `LOT-1` to 4100:

- row 2 Unit Cost becomes 4100
- rows 3 and 4 are untouched
- Stock Lot quantity is unchanged
- exactly one audit row exists
- no money/party/stock-movement writer was called.

- [ ] **Step 9: Add returned/net-quantity test**

Use exact matched evidence with:

```js
Quantity: 0.5
Unit Cost: 0
```

for a partially returned sale. Correct to 4100 and assert historical COGS delta is:

```js
0.5 * 4100 === 2050
```

Do not write Sales Return rows.

- [ ] **Step 10: Add historical nonzero-inconsistent cost test**

Use:

```js
Quantity: 2
Unit Cost: 100
new cost: 500
```

Expected delta:

```js
2 * (500 - 100) === 800
```

This protects the preview formula from assuming old historical cost is always zero.

- [ ] **Step 11: Update RPC/static security expectations**

Ensure both new public functions contain/route through the `products:edit` gate and the preview endpoint contains `products:view`.

If `public_rpc_security.test.js` enumerates public globals, add the functions according to its established pattern rather than weakening the audit.

- [ ] **Step 12: Run focused and security suites**

```bash
node --test tests/stock_lot_cost_correction_regressions.test.js
node tests/public_rpc_security.test.js
node tests/production_gate_static.test.js
```

Expected: all pass.

- [ ] **Step 13: Local commit only**

```bash
git add StockLots.gs tests/stock_lot_cost_correction_regressions.test.js tests/public_rpc_security.test.js tests/production_gate_static.test.js
git commit -m "feat: correct internal lot costs and historical COGS"
```

Do not push.

---

### Task 4: Prevent new zero-cost internal stock lots

**Files:**
- Modify: `StockLots.gs:133-160`, `602-609`, `710-738`
- Modify: `Products.gs:112-195`, `197-287`, `289-374`
- Test: `tests/stock_lot_cost_correction_regressions.test.js`
- Extend: `tests/audit_sales_stock.test.js` if its stock adjustment fixtures need explicit cost.

**Interfaces:**
- Produces `assertPositiveInternalLotCost_(source, qty, purchasePrice)`
- Existing `createLotWithRow_` calls the guard for internal positive stock.
- Existing Product/Adjustment user errors remain module-friendly.

- [ ] **Step 1: Write failing guard tests**

```js
assert.throws(
  () => api.assertPositiveInternalLotCost_('OPENING', 2, 0),
  /Purchase Price/
);

assert.throws(
  () => api.assertPositiveInternalLotCost_('ADJUSTMENT', 1, ''),
  /Purchase Price/
);

assert.doesNotThrow(
  () => api.assertPositiveInternalLotCost_('PUR-000001', 2, 0)
);

assert.doesNotThrow(
  () => api.assertPositiveInternalLotCost_('ADJUSTMENT', 0, 0)
);
```

Real Purchase behavior is not changed by this internal-source guard.

- [ ] **Step 2: Run and verify RED**

```bash
node --test tests/stock_lot_cost_correction_regressions.test.js
```

- [ ] **Step 3: Implement internal-lot guard**

```js
function assertPositiveInternalLotCost_(purchaseId, qty, purchasePrice) {
  if (!isInternalCostCorrectionSource_(purchaseId)) return;
  if ((Number(qty) || 0) <= 0) return;
  if (!isValidNonNegativeNumber_(purchasePrice) || Number(purchasePrice) <= 0) {
    throw new Error('Set this product\'s Purchase Price before adding stock.');
  }
}
```

Call it from `createLotWithRow_` before generating/writing the lot.

- [ ] **Step 4: Write failing Product creation tests**

For `addProduct`:

- `stock = 5, purchasePrice = 0` → fail before `appendRow_('PRODUCTS', ...)`
- `stock = 0, purchasePrice = 0` → existing behavior remains valid.

Assert no Product or Stock Lot write in the first case.

- [ ] **Step 5: Implement opening-stock validation in `addProduct`**

Before the first Product write:

```js
if (stock > 0 && Number(payload.purchasePrice) <= 0) {
  return fail_('Purchase Price must be greater than zero when Opening Stock is greater than zero.');
}
```

Keep the existing nonnegative validation too.

- [ ] **Step 6: Write failing positive-adjustment tests**

For `adjustStock` with Product Purchase Price 0:

- `delta = +3` → fail before any lot/product/movement write.
- `delta = -1` with existing lots → follows existing negative adjustment path and is not blocked by this new rule.

- [ ] **Step 7: Implement positive-adjustment prevalidation**

In `adjustStock`, after loading Product and before `addAdjustmentLot_`:

```js
if (delta > 0 && (Number(product['Purchase Price']) || 0) <= 0) {
  return fail_('Set this product\'s Purchase Price before adding stock.');
}
```

- [ ] **Step 8: Write failing `updateProduct` stock-increase test**

Given Current Stock 10 and submitted Stock 12 with submitted Purchase Price 0:

- reject before updating Product fields
- no adjustment lot
- no stock movement.

Stock-decrease behavior must remain unchanged.

- [ ] **Step 9: Implement `updateProduct` increase guard**

Because `updateProduct` receives the new Purchase Price in the same payload, validate the submitted price:

```js
if (delta > 0 && Number(payload.purchasePrice) <= 0) {
  return fail_('Purchase Price must be greater than zero when increasing stock.');
}
```

Do this before `updateRowFields_('PRODUCTS', ...)`.

- [ ] **Step 10: Write failing migration test**

For a Product with:

```js
Current Stock: 5
Purchase Price: 0
no existing Stock Lot
```

`migrateOpeningStockLots_` must not create a lot.

Refactor the migration's pure decision loop into a testable helper if needed, and return/report:

```js
{ created: 0, unresolved: 1 }
```

- [ ] **Step 11: Implement migration skip/report**

Skip zero-cost positive-stock products. Update the UI alert text to include both counts:

```text
Created: X opening lot(s).
Unresolved: Y product(s) have positive stock but no Purchase Price.
```

- [ ] **Step 12: Run stock regression suites**

```bash
node --test tests/stock_lot_cost_correction_regressions.test.js
node tests/audit_sales_stock.test.js
node tests/deep_review_regressions.test.js
```

Expected: all pass.

- [ ] **Step 13: Local commit only**

```bash
git add StockLots.gs Products.gs tests/stock_lot_cost_correction_regressions.test.js tests/audit_sales_stock.test.js tests/deep_review_regressions.test.js
git commit -m "fix: prevent zero-cost internal stock lots"
```

Do not push.

---

### Task 5: Surface unresolved lot warnings in Products bootstrap

**Files:**
- Modify: `Products.gs:18-110`
- Test: `tests/stock_lot_cost_correction_regressions.test.js`
- Test: `tests/stock_lot_cost_correction_ui_static.test.js`

**Interfaces:**
- Extends each Product DTO with:
  - `Unpriced Lot Count`
  - `Unpriced Remaining Quantity`
- Keeps existing `Stock Value` fallback untouched.

- [ ] **Step 1: Write failing bootstrap tests**

Given two lots for Product P1:

```js
[
  { 'Product ID': 'P1', 'Purchase ID': 'OPENING', 'Purchase Price': 0, 'Remaining Quantity': 2 },
  { 'Product ID': 'P1', 'Purchase ID': 'PUR-1', 'Purchase Price': 0, 'Remaining Quantity': 1 }
]
```

Expected:

```js
product['Unpriced Lot Count'] === 1
product['Unpriced Remaining Quantity'] === 2
```

The zero-cost Purchase lot is deliberately not counted by this internal-data repair warning.

- [ ] **Step 2: Run and verify RED**

```bash
node --test tests/stock_lot_cost_correction_regressions.test.js
```

- [ ] **Step 3: Extend existing lot aggregation**

Reuse the existing single Stock Lots pass in `getProductsBootstrap`. Do not introduce another full-sheet loop.

Extend stats:

```js
{
  qty: 0,
  value: 0,
  unpricedInternalQty: 0,
  unpricedInternalLotCount: 0
}
```

Increment count only for eligible internal zero-cost lots with positive Remaining Quantity.

Return additive DTO fields without changing `Stock Value` formula.

- [ ] **Step 4: Run focused tests and verify GREEN**

- [ ] **Step 5: Local commit only**

```bash
git add Products.gs tests/stock_lot_cost_correction_regressions.test.js
git commit -m "feat: expose unpriced internal lot warnings"
```

Do not push.

---

### Task 6: Add single-lot and bulk correction UI to Products

**Files:**
- Modify: `products.html:125-150` Stock Lots modal
- Modify: `products.html:160-620` Product list/actions as needed
- Modify: `products.html:670-727` lot rendering
- Create: `tests/stock_lot_cost_correction_ui_static.test.js`

**Interfaces:**
- Consumes `getUnpricedInternalStockLots(token)`
- Consumes `correctInternalStockLotCost(token, payload)`
- Consumes `correctInternalStockLotCosts(token, payload)`

- [ ] **Step 1: Write failing static UI tests**

Require these UI strings/handlers to exist:

```text
Unpriced Stock Lots
Correct Purchase Cost
Historical COGS Impact
Correction Reason
Apply Selected Corrections
```

Require calls to:

```js
serverCall('getUnpricedInternalStockLots', authToken)
serverCall('correctInternalStockLotCost', authToken, ...)
serverCall('correctInternalStockLotCosts', authToken, ...)
```

Also assert the Stock Lots table still renders Purchase Price/Original Qty/Remaining Qty/Value.

- [ ] **Step 2: Run and verify RED**

```bash
node --test tests/stock_lot_cost_correction_ui_static.test.js
```

- [ ] **Step 3: Add Product-list warning/action**

When a product has:

```js
Number(product['Unpriced Lot Count']) > 0
```

show a visible warning badge such as:

```text
Unpriced lots: 2
```

and make the existing `View Lots` route the user to the affected rows.

Add a Products-page action/button:

```text
Unpriced Stock Lots
```

Do not add a new navigation module/page.

- [ ] **Step 4: Add per-lot `Correct Purchase Cost` action**

Extend the Stock Lots table with an Action column.

Show the action only when the server DTO marks/derives the lot as:

- internal source
- current Purchase Price = 0
- not Deleted.

Prefer returning explicit `costCorrectionEligible` and `suggestedPurchasePrice` from `getProductLots` rather than duplicating source-classification rules in browser JavaScript.

Correction modal fields:

```text
Lot ID
Product
Source
Original Qty
Remaining Qty
Consumed Qty
Current Lot Cost
Product Purchase Price
Historical matched quantity
Affected invoice count
Historical COGS impact
New Purchase Cost
Correction Reason
```

- [ ] **Step 5: Add single-correction confirmation**

Use existing `runConfirmedAction` with `type: 'financial'`.

Confirmation must explicitly show:

```text
This changes inventory cost/COGS evidence only.
Sales totals, payments, customer due and stock quantity will not change.
```

Then call:

```js
serverCall('correctInternalStockLotCost', authToken, {
  lotId: selected.lotId,
  newPurchasePrice: Number(newCost),
  reason: reason
})
```

On success:

- close correction modal
- refresh lot modal
- `prodLoad()`
- reload Sales/Reports only if the shell has a safe existing invalidation helper; otherwise those pages will naturally refetch on navigation.
- show success toast with affected invoice count and COGS delta from server response.

- [ ] **Step 6: Add bulk review modal**

Create one large modal with table columns from the spec:

```text
Select
Lot ID
Product
Source
Date
Original Qty
Remaining Qty
Consumed Qty
Current Cost
Product Purchase Price
Proposed Cost
Historical Invoice Count
Historical COGS Impact
Status
```

Rows with suggested cost <= 0 default to unselected and status `Needs Cost`.

`Select Ready` selects only rows with a valid proposed cost > 0.

- [ ] **Step 7: Add client-side preview totals**

Compute informational UI totals only:

```text
selected lot count
remaining quantity
matched historical quantity
affected invoices
projected historical COGS delta```

The server must recompute everything; browser totals are never submitted as authoritative accounting values.

- [ ] **Step 8: Add bulk confirmation and submit**

Build payload only from selected rows:

```js
{
  corrections: selectedRows.map(function (row) {
    return {
      lotId: row.lotId,
      newPurchasePrice: Number(row.proposedCost)
    };
  }),
  reason: reason
}
```

Require nonblank reason before calling the server.

Submit through:

```js
serverCall('correctInternalStockLotCosts', authToken, payload)
```

- [ ] **Step 9: Run UI and Products regression tests**

```bash
node --test tests/stock_lot_cost_correction_ui_static.test.js
node --test tests/stock_lot_cost_correction_regressions.test.js
```

Then run any existing responsive Products/table tests discovered in the repo.

- [ ] **Step 10: Local commit only**

```bash
git add products.html tests/stock_lot_cost_correction_ui_static.test.js
git commit -m "feat: add stock lot cost correction UI"
```

Do not push.

---

### Task 7: Prove invoice profit and Profit Report correct themselves from repaired COGS

**Files:**
- Test: `tests/stock_lot_cost_correction_regressions.test.js`
- Extend existing invoice-profit test file if one already isolates `buildSalesInvoiceProfitMetrics_`
- Extend existing Profit Report regression file if needed
- No production changes expected in `SalesManagement.gs` or `Reports.gs`.

**Interfaces:**
- Validates the design assumption that no new profit formula is necessary.

- [ ] **Step 1: Write failing integration-style profit fixture**

Create a fixture equivalent to the observed Tank case:

```js
sale net revenue = 4980
other product COGS = 703
Tank consumed Qty = 1
Tank Unit Cost before correction = 0
Tank Unit Cost after correction = 4100
```

Before correction:

```js
profit === 4277
```

After invoking the correction logic against exact `LOT-000481` evidence:

```js
profit === 177
```

Use existing production profit helpers rather than reimplementing profit math in the test.

- [ ] **Step 2: Add Profit Report agreement test**

For the same invoice/date range, assert:

```text
invoice-detail COGS == Profit Report COGS contribution
invoice-detail gross profit == corresponding aggregate arithmetic
```

The exact Report response fields should follow the existing test conventions.

- [ ] **Step 3: Add unchanged-revenue assertions**

Snapshot before correction:

```text
SALES.Grand Total
SALE_ITEMS.Line Total
SALES.Paid Amount
SALES.Due Amount
```

Assert they are identical after correction.

Also assert no Customer/Cash/Bank/Supplier writer was invoked.

- [ ] **Step 4: Run profit/report suites**

Run the discovered existing commands plus the new suite. At minimum:

```bash
node --test tests/stock_lot_cost_correction_regressions.test.js
```

and the repo's maintained report/invoice-profit regression commands.

- [ ] **Step 5: Local commit only**

```bash
git add tests/stock_lot_cost_correction_regressions.test.js tests/*
git commit -m "test: verify corrected lot cost flows into profit"
```

Stage only files actually changed; do not use a broad `tests/*` glob if it would include unrelated generated files.

Do not push.

---

### Task 8: Document behavior and add CI coverage locally

**Files:**
- Modify: `PROJECT.md:289-360` Inventory model
- Modify: `PROJECT.md:910-1036` Source-of-truth/recent behavior
- Modify: `.github/workflows/regression-tests.yml:45-58`
- Test: static docs/workflow checks if maintained by repo.

**Interfaces:**
- Documents the permanent accounting contract for future work.

- [ ] **Step 1: Update `PROJECT.md`**

Add a section:

```markdown
## Internal Stock Lot Cost Correction

OPENING/OPENING-MIGRATION/ADJUSTMENT/LEGACY lots are internal inventory
sources. If historical bad data left one with Purchase Price 0, Products
can correct the lot cost without editing the sale transaction.

Correction updates:
- STOCK_LOTS.Purchase Price
- exact matching SALE_ITEM_LOTS.Unit Cost
- Stock Lot Cost Corrections audit log

It never changes:
- sales revenue or quantity
- customer/supplier balances
- cash/bank
- stock quantity
- FIFO date/order
- Purchase Invoice

Historical linkage is exact Lot ID only; blank/ambiguous evidence is never guessed.
```

Document the prevention rule:

```text
Positive Opening Stock / positive Adjustment requires Product Purchase Price > 0.
```

- [ ] **Step 2: Add workflow step**

Add:

```yaml
- name: Stock lot cost correction
  run: node --test tests/stock_lot_cost_correction_regressions.test.js

- name: Stock lot cost correction UI
  run: node --test tests/stock_lot_cost_correction_ui_static.test.js
```

The workflow file is prepared locally but not pushed until the user authorizes GitHub mutation.

- [ ] **Step 3: Run workflow/static suites locally**

```bash
node --test tests/stock_lot_cost_correction_regressions.test.js
node --test tests/stock_lot_cost_correction_ui_static.test.js
node tests/public_rpc_security.test.js
node tests/production_gate_static.test.js
```

- [ ] **Step 4: Local commit only**

```bash
git add PROJECT.md .github/workflows/regression-tests.yml
git commit -m "docs: define internal stock lot cost correction"
```

Do not push.

---

### Task 9: Full verification, review, and changed-files package

**Files:**
- No new production behavior.
- Create local review report: `STOCK_LOT_COST_CORRECTION_REVIEW.md`
- Create local ZIP containing only changed files.

**Interfaces:**
- Produces final downloadable artifacts for the user.
- Does not mutate GitHub.

- [ ] **Step 1: Read verification skill before claiming completion**

Use:

```text
superpowers:verification-before-completion
```

- [ ] **Step 2: Run the full repository-maintained test command**

Run every test command represented by the project's CI plus the new tests. Do not substitute a selected subset for the full maintained suite.

At minimum include:

```bash
node --test tests/stock_lot_cost_correction_regressions.test.js
node --test tests/stock_lot_cost_correction_ui_static.test.js
node tests/chat_updates_regressions.test.js
node --test tests/dashboard_business_logic.test.js
node tests/vendor_multi_product_memo_regressions.test.js
node tests/finance_multibalance_business_logic.test.js
node tests/confirmation_vendor_finance_inventory.test.js
node tests/invoice_integrity_regressions.test.js
node tests/audit_sales_stock.test.js
node tests/public_rpc_security.test.js
node tests/production_gate_static.test.js
```

Also run every additional maintained accounting/report/settlement suite present in the local repository, including those previously used for the Multi-Invoice Return final gate.

Any failure must be reported by name; do not omit pre-existing failures.

- [ ] **Step 3: Perform whole-change code review**

Review specifically for:

```text
direct sheet writes bypassing Database.gs
historical matching by Product ID instead of exact Lot ID
validation after first write
money/customer/supplier mutations
stock quantity mutations
real Purchase-lot eligibility leakage
zero-cost internal-lot creation paths still unguarded
browser-computed totals being trusted by server
new public RPC without permission gate
```

Fix any defect through a new RED→GREEN TDD cycle.

- [ ] **Step 4: Verify exact changed-file diff**

Expected production files:

```text
Config.gs
StockLots.gs
Products.gs
products.html
PROJECT.md
.github/workflows/regression-tests.yml
```

Expected tests:

```text
tests/stock_lot_cost_correction_regressions.test.js
tests/stock_lot_cost_correction_ui_static.test.js
```

Plus only existing test files that required legitimate assertion updates.

No unrelated file changes may remain.

- [ ] **Step 5: Create review/deployment report**

`STOCK_LOT_COST_CORRECTION_REVIEW.md` must include:

- root cause
- changed files
- schema migration (`setupSystem_()`)
- correction workflow
- exact historical COGS behavior
- prevention behavior
- test commands/results
- known limitation: ambiguous/blank historical Lot IDs are reported, never guessed
- Google Sheets validation-atomicity limitation
- live deployment checklist.

- [ ] **Step 6: Package changed files**

Create:

```text
SherERP-STOCK-LOT-COST-CORRECTION-CHANGED-FILES.zip
```

Include only:

- changed production files
- changed/new test files
- local workflow file
- spec
- this implementation plan
- review report
- checksum manifest.

Do not include unrelated repo files.

- [ ] **Step 7: Verify package byte-for-byte**

For every packaged changed source/test file, compare SHA-256 to the tested workspace copy.

- [ ] **Step 8: Final response**

Provide download links for:

- changed-files ZIP
- review/deployment report
- checksum manifest.

State explicitly:

```text
No GitHub push/PR/merge was performed for this Stock Lot fix.
```

Do not offer to push automatically. Wait for explicit user authorization.

---

## Execution Order

```text
Task 1  Audit schema
   ↓
Task 2  Eligibility + preview
   ↓
Task 3  Correction engine + exact historical COGS repair
   ↓
Task 4  Future prevention
   ↓
Task 5  Product warning data
   ↓
Task 6  Single/bulk UI
   ↓
Task 7  Profit/report proof
   ↓
Task 8  Documentation + local CI update
   ↓
Task 9  Full verification + downloadable package
```

## Self-Review Result

- **Spec coverage:** All 24 design-spec sections map to one or more tasks. Exact-lineage repair, bulk review, audit logging, prevention, Products warning, report behavior, deployment, and acceptance criteria are covered.
- **Placeholder scan:** No `TBD`, `TODO`, `FIXME`, or implementation-later placeholders remain.
- **Type consistency:** Public API and helper names are consistent across Tasks 2, 3, 5, and 6.
- **Review Focus:** All five high-risk cases have explicit owning tests.
- **Scope:** One coherent inventory-cost correction subsystem; no generic transaction correction engine or unrelated accounting refactor is introduced.