# Multi-Invoice Sales Return Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an accounting-safe multi-invoice Sales Return workflow for one customer while preserving SherERP's existing invoice-level settlement, cash provenance, FIFO restoration, reporting, and audit behavior.

**Architecture:** A batch is grouping metadata only. Each selected invoice is prepared independently and produces its own native Sales Return ID; a shared Batch ID groups those child returns for UI/history. The backend validates every child and all shared cumulative stock/customer state before the first business write, then commits the already-prepared child returns under one ScriptLock.

**Tech Stack:** Google Apps Script (V8), Google Sheets, HTML/vanilla JavaScript, Node.js regression tests.

**Spec:** `docs/superpowers/specs/2026-09-21-multi-invoice-sales-return-design.md`

## Global Constraints

- Do not push, merge, create a PR, or modify GitHub during implementation without explicit user permission.
- Work only on a local copy of the current `sherERP_Mohim` main production files.
- Preserve existing single-invoice Sales Return behavior except for the approved invariant: Return Date must not predate the source Sale Date.
- Batch mode requires 2-20 unique invoices, one non-empty identical Customer ID, and at most 100 selected return lines.
- Batch ID is metadata only; accounting references remain child Return IDs.
- Cash eligibility is validated independently per source invoice.
- Store Credit remains one `Sales Return Credit` row per child Return ID.
- No mixed Cash + Store Credit inside one batch in version 1.
- All rejectable business validation must happen before the first write.
- Google Sheets has no SQL rollback; never claim write-phase atomicity.
- Use TDD: every production behavior change needs a regression test that is observed failing before implementation.

## Review Focus

1. **Same product on several selected invoices:** Product `Current Stock` must increase cumulatively, not be overwritten from the same initial value. Task 4 includes an invariant test for `20 +2 +3 = 25`.
2. **Cash on one invoice must not fund another invoice's refund:** Task 4 includes a per-invoice provenance test where total batch cash is sufficient but one child invoice is not.
3. **Backdated batch crossing invoice dates:** Task 2 includes single and batch date tests proving a return cannot predate any source invoice.
4. **Store Credit sequencing:** Task 4 includes two-child credit tests proving Return ID → Invoice ID allocation and sequential Customer `Current Due`/ledger balances.
5. **Supplier lineage silently dropped from `SALE_ITEM_LOTS`:** Task 1 includes schema and idempotent repair tests so future rows persist `Supplier ID` and historical blanks can be recovered from `STOCK_LOTS.Lot ID`.

---

## File map

### Production files

- `Config.gs` — additive `SALES_RETURN.Batch ID` and `SALE_ITEM_LOTS.Supplier ID` headers.
- `StockLots.gs` — idempotent supplier-lineage repair and read-only/apply Sales Return restoration planner.
- `SalesReturn.gs` — shared prepare/commit engine, return-date invariant, multi-invoice batch endpoint, batch detail read helper.
- `returns.html` — multi-select invoice search and combined invoice-grouped return workspace.
- `returnHistory.html` — Batch ID display and grouped batch detail view.
- `PROJECT.md` — source-of-truth behavior documentation.

### Test files

- Create `tests/multi_invoice_sales_return_regressions.test.js` — end-to-end in-memory accounting invariants for the new backend behavior.
- Update `tests/deep_review_regressions.test.js` only where static invariants need to pin the new shared preparation path/date rule.
- Update `tests/return_ledger_regressions.test.js` only where Batch ID/history UI/accounting-reference invariants need static coverage.
- Update `.github/workflows/regression-tests.yml` only in the downloadable change set if the user wants the CI file deployed later; do not push it during local implementation.

---

### Task 1: Persist and repair Sale Item Lot supplier lineage

**Files:**
- Modify: `Config.gs`
- Modify: `StockLots.gs`
- Test: `tests/multi_invoice_sales_return_regressions.test.js`

**Interfaces:**
- Consumes: existing `getAllRows_`, `updateRowFields_`, `isDeleted_`, `CONFIG.HEADERS` behavior.
- Produces: configured `SALE_ITEM_LOTS.Supplier ID`; internal maintenance function `repairSaleItemLotSupplierIds_()` returning `{ scanned, repaired, unresolved }`.

- [ ] **Step 1: Write failing schema/repair tests**

Add tests that assert:

```js
test('SALE_ITEM_LOTS declares Supplier ID so Sales.gs writes persist', () => {
  assert.ok(CONFIG.HEADERS.SALE_ITEM_LOTS.includes('Supplier ID'));
});

test('repairSaleItemLotSupplierIds_ fills only blank values from matching STOCK_LOTS Lot ID', () => {
  // L1 blank -> S1, L2 already S9 remains S9, missing lot remains blank.
  const result = ctx.repairSaleItemLotSupplierIds_();
  assert.deepEqual(result, { scanned: 3, repaired: 1, unresolved: 1 });
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
node tests/multi_invoice_sales_return_regressions.test.js
```

Expected: FAIL because `Supplier ID` is not configured and `repairSaleItemLotSupplierIds_` does not exist.

- [ ] **Step 3: Add additive schema**

In `CONFIG.HEADERS.SALE_ITEM_LOTS`, append:

```js
"Supplier ID",
```

Do not reorder existing columns.

- [ ] **Step 4: Implement idempotent repair**

In `StockLots.gs`, add:

```js
function repairSaleItemLotSupplierIds_() {
  const lotsById = {};
  getAllRows_('STOCK_LOTS').forEach(function (lot) {
    lotsById[String(lot['Lot ID'] || '')] = lot;
  });

  let scanned = 0;
  let repaired = 0;
  let unresolved = 0;

  getAllRows_('SALE_ITEM_LOTS').forEach(function (row) {
    scanned++;
    if (String(row['Supplier ID'] || '').trim()) return;
    const lot = lotsById[String(row['Lot ID'] || '')];
    const supplierId = lot ? String(lot['Supplier ID'] || '').trim() : '';
    if (!supplierId) {
      unresolved++;
      return;
    }
    updateRowFields_('SALE_ITEM_LOTS', row._rowIndex, { 'Supplier ID': supplierId });
    repaired++;
  });

  return { scanned: scanned, repaired: repaired, unresolved: unresolved };
}
```

- [ ] **Step 5: Run GREEN**

Run the new regression file and confirm both tests pass.

- [ ] **Step 6: Run adjacent stock tests**

```bash
node tests/audit_sales_stock.test.js
node tests/deep_review_regressions.test.js
```

Expected: existing stock/FIFO tests remain green.

---

### Task 2: Add return-date integrity and extract read-only preparation

**Files:**
- Modify: `SalesReturn.gs`
- Test: `tests/multi_invoice_sales_return_regressions.test.js`
- Test: `tests/deep_review_regressions.test.js`

**Interfaces:**
- Consumes: `findUniqueSalesRow_`, `activeSalesReturnItems_`, `outstandingSaleOwnStockByProduct_`, `effectiveTransactionUnitPrice_`, `salesReturnCashRefundAvailable_`, `resolveTransactionDate_`.
- Produces:
  - `assertSalesReturnDateNotBeforeSale_(returnDateStr, sale)`
  - `prepareSalesReturn_(payload, options)` → read-only prepared child object.
  - Existing `completeReturn()` reuses the shared preparation path.

- [ ] **Step 1: Write failing date tests**

Add:

```js
test('single return rejects a return date before the source invoice date before writes', () => {
  const result = w.ctx.completeReturn('token', {
    invoiceId: 'INV1',
    date: '2026-09-04',
    items: [{ productId: 'P1', qty: 1 }],
    refundMethod: 'Cash'
  });
  assert.equal(result.success, false);
  assert.match(result.message, /cannot be before.*invoice/i);
  assert.equal(w.writes.length, 0);
});
```

- [ ] **Step 2: Write failing preparation purity test**

Expose the internal helper in the VM test and assert a valid call returns a prepared object while `w.writes.length === 0`.

Expected prepared shape:

```js
{
  sale,
  invoiceId,
  customerId,
  totalReturnAmount,
  refundMethod,
  validatedItems,
  stockChanges,
  dateStr,
  txDate
}
```

- [ ] **Step 3: Run RED**

Expected failures: missing date guard and `prepareSalesReturn_`.

- [ ] **Step 4: Implement date guard**

```js
function assertSalesReturnDateNotBeforeSale_(returnDateStr, sale) {
  const saleDate = safeDateOnly_(sale['Date']);
  if (saleDate && returnDateStr < saleDate) {
    throw new Error('Return date cannot be before invoice date ' + saleDate + '.');
  }
}
```

Call it after resolving transaction date and loading the sale, before any writes.

- [ ] **Step 5: Extract `prepareSalesReturn_` without changing economics**

Move all rejectable validation/calculation from current `completeReturn()` through stock-target and Store Credit customer validation into a read-only helper. Do not alter formulas or messages except where required for batch context.

`prepareSalesReturn_` must not call:

- `appendRow_`
- `appendRows_`
- `updateRowFields_`
- `addCashBookEntry_`
- `addBankBookEntry_`
- `restoreStockToLots_`
- `createLot_`

- [ ] **Step 6: Keep `completeReturn()` behavior compatible**

`completeReturn()` should:

```js
lock
permission + cash session
resolve date
prepared = prepareSalesReturn_(...)
returnId = generateId_('SALES_RETURN')
commitPreparedSalesReturn_(prepared, { returnId, batchId: '' })
unlock
```

- [ ] **Step 7: Run GREEN and existing return tests**

```bash
node tests/multi_invoice_sales_return_regressions.test.js
node tests/deep_review_regressions.test.js
node tests/confirmation_sales_purchase_returns.test.js
node tests/return_ledger_regressions.test.js
node tests/customer_settlement_business_logic.test.js
```

Expected: all green.

---

### Task 3: Add read-only Sales Return lot-restoration planning

**Files:**
- Modify: `StockLots.gs`
- Modify: `SalesReturn.gs`
- Test: `tests/multi_invoice_sales_return_regressions.test.js`
- Test: `tests/audit_sales_stock.test.js`

**Interfaces:**
- Consumes: `SALE_ITEM_LOTS`, `STOCK_LOTS`, existing restoration order and legacy/OVERSOLD fallback semantics.
- Produces:
  - `planSaleReturnRestoration_(invoiceId, productId, productName, qty, options)`
  - `applySaleReturnRestorationPlan_(plan, fallbackReference)`
  - `restoreStockToLots_()` becomes a compatibility wrapper around plan + apply.

- [ ] **Step 1: Write failing planner purity test**

Assert planning a partial return produces expected draws and no writes.

```js
const plan = ctx.planSaleReturnRestoration_('INV1', 'P1', 'Widget', 2, {});
assert.deepEqual(plan.draws.map(d => [d.lotId, d.qty]), [['L2', 1], ['L1', 1]]);
assert.equal(w.writes.length, 0);
```

Preserve current restoration ordering: most recently consumed `SALE_ITEM_LOTS` evidence first.

- [ ] **Step 2: Write failing virtual-state test**

Plan two child returns against shared cloned `SALE_ITEM_LOTS` quantities; the second plan must see the first plan's reserved evidence without mutating Sheets.

- [ ] **Step 3: Run RED**

Expected: planner missing.

- [ ] **Step 4: Implement planner**

The plan contains:

```js
{
  invoiceId,
  productId,
  productName,
  qty,
  draws: [{ saleItemLotRowIndex, lotId, qty, sourceKind, supplierId }],
  fallbackQty,
  supplierId
}
```

For physical lots, `sourceKind = 'LOT'`. For OVERSOLD/LEGACY/missing lot evidence, mark fallback so apply creates a fresh return lot exactly as current behavior does.

- [ ] **Step 5: Implement apply helper and compatibility wrapper**

`applySaleReturnRestorationPlan_` performs the current `STOCK_LOTS` and `SALE_ITEM_LOTS` mutations and returns `[{ lotId, qty }]` for Stock Movement creation.

`restoreStockToLots_` should become:

```js
function restoreStockToLots_(invoiceId, productId, productName, qty, fallbackReference, supplierId) {
  return applySaleReturnRestorationPlan_(
    planSaleReturnRestoration_(invoiceId, productId, productName, qty, { supplierId: supplierId }),
    fallbackReference
  );
}
```

- [ ] **Step 6: Integrate planner into `prepareSalesReturn_`**

Every validated return line stores a precomputed restoration plan. The write phase only applies the plan.

- [ ] **Step 7: Run GREEN**

```bash
node tests/multi_invoice_sales_return_regressions.test.js
node tests/audit_sales_stock.test.js
node tests/deep_review_regressions.test.js
```

Expected: planner tests and all existing restoration tests pass.

---

### Task 4: Implement batch backend with accurate cumulative accounting

**Files:**
- Modify: `Config.gs`
- Modify: `SalesReturn.gs`
- Test: `tests/multi_invoice_sales_return_regressions.test.js`
- Test: `tests/customer_settlement_business_logic.test.js`
- Test: `tests/reports_business_logic.test.js`

**Interfaces:**
- Consumes: `prepareSalesReturn_`, `commitPreparedSalesReturn_`, planner from Task 3.
- Produces:
  - configured `SALES_RETURN.Batch ID`
  - public RPC `completeReturnBatch(token, payload)`
  - internal `deriveSalesReturnBatchId_(firstReturnId)`
  - read RPC `getReturnBatchDetail(token, batchId)`

- [ ] **Step 1: Write failing same-customer identity tests**

Cover:

- 2 invoices same `Customer ID` accepted
- different Customer IDs rejected with zero writes
- blank Customer ID rejected with zero writes
- duplicate invoice IDs in request rejected
- 21 invoices rejected
- >100 selected lines rejected

- [ ] **Step 2: Write failing per-invoice Cash provenance test**

Scenario:

```text
INV1 refundable cash = 500, requested return = 100
INV2 refundable cash =   0, requested return =  50
batch total cash available = 500 > batch return 150
```

Expected: whole batch rejected before writes because INV2 independently fails.

- [ ] **Step 3: Write failing cumulative stock test**

Same product on 2 invoices, initial stock 20, returns +2 and +3.

Expected final Product Current Stock = 25, not 23.

- [ ] **Step 4: Write failing Store Credit sequential-balance test**

Customer Current Due 1,000. Child return totals 100 and 250.

Expected:

```text
child1 ledger Balance = 900
child2 ledger Balance = 650
CUSTOMERS.Current Due = 650
```

Also assert each ledger row `Reference` is the child Return ID and `customerSettlementState_` maps each child to its source invoice.

- [ ] **Step 5: Write failing invalid-last-child zero-write test**

Child 1 valid, Child 2 asks for excessive quantity.

Expected: zero writes across every business sheet.

- [ ] **Step 6: Run RED**

Expected: `completeReturnBatch` missing / Batch ID absent.

- [ ] **Step 7: Add `Batch ID` schema**

Append `"Batch ID"` to `CONFIG.HEADERS.SALES_RETURN` after `Return ID` or at the additive end. Prefer additive end if preserving live-sheet order is safer; all code must access by header name.

- [ ] **Step 8: Implement Batch ID derivation**

```js
function deriveSalesReturnBatchId_(returnId) {
  const suffix = String(returnId || '').replace(/^SRT-/, '');
  return 'SRB-' + suffix;
}
```

If Return ID prefix format is not `SRT-`, derive from the numeric suffix robustly and throw before writes if it cannot be derived.

- [ ] **Step 9: Implement `completeReturnBatch` validation phase**

Under one ScriptLock:

```js
const actingUser = requirePermission_(token, 'returns', 'add');
requireActiveCashSession_();
const txDate = resolveTransactionDate_(...);
validate invoiceReturns count/uniqueness/line limit;
prepare all children with one same non-empty Customer ID;
validate date for every child;
validate Cash independently per prepared child;
build cumulative product stock values;
build virtual restoration reservations;
validate Store Credit customer once;
```

No writes before all children are prepared.

- [ ] **Step 10: Allocate child IDs only after validation**

Generate one `SRT` ID per child after all validations pass. Derive one Batch ID from the first generated child ID.

- [ ] **Step 11: Commit Cash batch**

For each child in request order:

- use child-specific Return ID
- set `SALES_RETURN.Batch ID`
- apply its prepared restoration plans
- write one Cash Book entry referencing that Return ID
- keep Product stock using the shared running Product state

- [ ] **Step 12: Commit Store Credit batch**

Maintain one `runningDue` initialized from the customer master. For each child:

```js
runningDue = roundMoney_(runningDue - child.totalReturnAmount);
```

Write one Customer Ledger row per child with that sequential `Balance`, and update Customer `Current Due` consistently.

- [ ] **Step 13: Implement batch detail read helper**

`getReturnBatchDetail(token, batchId)`:

- requires `returns:view`
- loads active/visible `SALES_RETURN` rows with matching Batch ID
- loads matching `SALES_RETURN_ITEMS`
- returns child headers/items and a computed `batchTotal`
- returns fail if no batch rows found

- [ ] **Step 14: Run GREEN**

```bash
node tests/multi_invoice_sales_return_regressions.test.js
node tests/customer_settlement_business_logic.test.js
node tests/reports_business_logic.test.js
node tests/audit_sales_stock.test.js
```

Expected: all green and new accounting assertions pass.

---

### Task 5: Add multi-select Return UI without changing single-invoice entry

**Files:**
- Modify: `SalesReturn.gs`
- Modify: `returns.html`
- Test: `tests/multi_invoice_sales_return_regressions.test.js`
- Test: `tests/mobile_customer_return_regressions.test.js`

**Interfaces:**
- Consumes: `searchInvoicesForReturn`, `getInvoiceForReturn`, `completeReturnBatch`.
- Produces: customer-aware selectable search results and combined invoice-grouped Return UI state.

- [ ] **Step 1: Write failing search DTO/UI tests**

Assert `searchInvoicesForReturn` returns `customerId` and the HTML contains:

- selection checkbox/button hooks
- selected-count element
- `Open Selected Invoices`
- same-customer gating logic
- batch submit RPC name

- [ ] **Step 2: Run RED**

Expected: missing DTO field and UI hooks.

- [ ] **Step 3: Add `customerId` to search result DTO**

Keep all current fields unchanged.

- [ ] **Step 4: Preserve exact-match single-invoice behavior**

An exact invoice search can still use `returnsLoadInvoiceById_` as today.

- [ ] **Step 5: Add batch-selection state**

Extend `rtState` with:

```js
selectedInvoiceIds: [],
batchInvoices: [],
batchMode: false
```

Do not reuse `editingReturnId` for batch state.

- [ ] **Step 6: Add same-customer selection enforcement**

After first selection, disable invoices whose `customerId` differs or is blank. Duplicate historical Invoice IDs remain disabled.

- [ ] **Step 7: Load selected invoices**

Call existing `getInvoiceForReturn` for each selected invoice using `Promise.all`; then render one invoice section per result.

- [ ] **Step 8: Render grouped return lines**

Every row key must include both Invoice ID and Product ID so the same Product ID on different invoices remains independent.

- [ ] **Step 9: Render per-invoice Cash warnings**

For Cash selection, show which selected invoice exceeds its own `cashRefundAvailable`. This is convenience only; server remains authoritative.

- [ ] **Step 10: Submit batch payload**

Map each invoice section to:

```js
{
  invoiceId: inv.invoiceId,
  items: inv.items.filter(qty > 0).map(...)
}
```

Then call `completeReturnBatch` with common method/reason/note/date/backdate reason.

- [ ] **Step 11: Preserve existing single mode submit**

Single mode continues to call `completeReturn` and its existing confirmation UI.

- [ ] **Step 12: Run GREEN**

```bash
node tests/multi_invoice_sales_return_regressions.test.js
node tests/mobile_customer_return_regressions.test.js
node tests/confirmation_sales_purchase_returns.test.js
```

Expected: desktop/mobile static tests and existing confirmation flow stay green.

---

### Task 6: Add Batch ID visibility and grouped Return History detail

**Files:**
- Modify: `returnHistory.html`
- Modify: `SalesReturn.gs`
- Test: `tests/multi_invoice_sales_return_regressions.test.js`
- Test: `tests/return_ledger_regressions.test.js`

**Interfaces:**
- Consumes: `getReturnHistory`, `getReturnDetail`, `getReturnBatchDetail`.
- Produces: Batch ID column/label and grouped batch detail modal.

- [ ] **Step 1: Write failing history tests**

Assert:

- history renders `Batch ID`
- rows with blank Batch ID still render as normal single returns
- rows with Batch ID offer `View Batch`
- `View Batch` calls `getReturnBatchDetail`
- child Return ID and Invoice ID remain visible

- [ ] **Step 2: Run RED**

Expected: history lacks Batch UI.

- [ ] **Step 3: Add Batch column or secondary label**

Keep Return ID as the primary accounting identifier. Batch ID must never replace Return ID in the row key/action ID.

- [ ] **Step 4: Add grouped batch detail modal**

Show:

- Batch ID
- customer
- date
- child Return IDs
- source Invoice IDs
- child totals
- product lines under each child
- computed Batch Total

- [ ] **Step 5: Run GREEN**

```bash
node tests/multi_invoice_sales_return_regressions.test.js
node tests/return_ledger_regressions.test.js
```

Expected: both green.

---

### Task 7: Document behavior and integrate regression suite locally

**Files:**
- Modify: `PROJECT.md`
- Create/Modify: `tests/multi_invoice_sales_return_regressions.test.js`
- Modify: `.github/workflows/regression-tests.yml` only for downloadable delivery; do not push.

**Interfaces:**
- Consumes: all completed behavior.
- Produces: source-of-truth documentation and repeatable CI command list.

- [ ] **Step 1: Update `PROJECT.md`**

Document:

- batch metadata vs child accounting IDs
- same Customer ID restriction
- no Walk-in batches
- one refund method per batch
- per-invoice Cash provenance
- per-invoice Store Credit settlement
- shared running stock/customer balance
- Return Date >= Sale Date
- `SALE_ITEM_LOTS.Supplier ID` persistence/repair
- Google Sheets no-SQL-rollback limitation

- [ ] **Step 2: Add regression workflow step locally**

Insert:

```yaml
- name: Multi-invoice sales return regressions
  run: node tests/multi_invoice_sales_return_regressions.test.js
```

Do not push it.

- [ ] **Step 3: Run the focused affected suite**

```bash
node tests/multi_invoice_sales_return_regressions.test.js
node tests/audit_sales_stock.test.js
node tests/deep_review_regressions.test.js
node tests/customer_settlement_business_logic.test.js
node tests/reports_business_logic.test.js
node tests/return_ledger_regressions.test.js
node tests/confirmation_sales_purchase_returns.test.js
node tests/mobile_customer_return_regressions.test.js
node tests/public_rpc_security.test.js
node tests/production_gate_static.test.js
```

Expected: all exit 0.

- [ ] **Step 4: Run broader maintained accounting gates**

```bash
node tests/crud_business_rule_matrix.test.js
node tests/accounting_state_drift_read_paths.test.js
node tests/state_drift_accounting_invariants.test.js
node tests/state_drift_sequence_fuzz.test.js
node tests/audit_financial_crud.test.js
```

Expected: all exit 0. Any unrelated existing failure must be reported by exact test name; do not hide it.

---

### Task 8: Final review, packaging, and user delivery

**Files:**
- Package only changed production files plus relevant tests/documentation.
- Do not include the full ERP project unless the user asks.

**Interfaces:**
- Consumes: completed local implementation and test evidence.
- Produces: downloadable ZIP and review report; no GitHub side effect.

- [ ] **Step 1: Diff changed files against the local current-main baseline**

Expected production change set:

```text
Config.gs
StockLots.gs
SalesReturn.gs
returns.html
returnHistory.html
PROJECT.md
```

Add other production files only if implementation proves they are necessary; record the reason.

- [ ] **Step 2: Perform whole-change code review**

Review specifically for:

- any validation after first write
- any batch-level pooled Cash check
- any shared Return ID across invoices
- stale Product stock overwrite
- stale Customer Due overwrite
- loss of Return ID → Invoice ID settlement mapping
- incorrect lot restoration across invoices
- client-authoritative return price
- accidental GitHub/network side effects

- [ ] **Step 3: Fix any Critical/Important review findings with RED→GREEN tests**

Run the full focused suite after fixes.

- [ ] **Step 4: Verify changed-file package byte-for-byte**

Create:

```text
SherERP-MULTI-INVOICE-SALES-RETURN-CHANGED-FILES.zip
```

Include changed production files and a `tests/` folder containing the new/updated regression tests. Include the local implementation plan and a concise review report outside the production root or in a `docs/` folder.

Run `unzip -t` and compare packaged production files byte-for-byte to the tested working tree.

- [ ] **Step 5: Deliver downloads only**

Provide sandbox links to:

- changed-files ZIP
- individual production files if useful
- test/review report

Explicitly state: **No GitHub push/PR/merge was performed.**

## Approved UX / Pricing Revision — 2026-09-21

During implementation the user approved two refinements:

1. Multi-invoice selection uses a dedicated **Customer-first** flow: search customer -> view customer -> show all invoices for that exact Customer ID -> select one or more -> open selected. Direct invoice search remains for normal single-invoice returns.
2. **Return Price is editable** per return line. The server validates the requested price with `salesReturnRequestedUnitPrice_`: it must be non-negative and cannot exceed the source invoice's effective post-discount unit price. Missing price keeps the previous full-price behavior. All cash, Store Credit, report, and line-total accounting uses the validated requested price.

These revisions do not change the Batch ID / child Return ID accounting architecture.