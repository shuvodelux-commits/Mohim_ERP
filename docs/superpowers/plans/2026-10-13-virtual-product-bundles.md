# Virtual Product Bundles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sell “Tubewell Set” as a single invoiced product while deducting FIFO-owned pipe/elbow/motor components, including allowed negative stock, with correct native returns, edit, delete, drafts and profit.

**Architecture:** Add virtual Bundle products and per-revision recipes to the existing Sheets/Apps Script ERP. Expand visible bundle sale lines to physical stock demands on the server, aggregate by component before FIFO, and attribute consumed lot rows to their visible source sale line. Keep immutable per-unit recipe snapshots for historic invoice operations; reuse native sale, return, cash/bank/ledger handlers.

**Tech Stack:** Google Apps Script V8 (.gs), HTML/browser JS, Google Sheets via Database.gs, node:test + vm-backed isolated workbook regression suites.

**Spec:** `docs/superpowers/specs/2026-10-13-virtual-product-bundles-design.md`

**Review state:** Documentation-only; do not execute until user approves. Work in an isolated feature branch based on refreshed `main`; never modify `legacy/`.

## Global Constraints

- Preserve `AGENTS.md`: FIFO across supplier lots, no supplier binding, allowed negative `OVERSOLD`, active cash session, permissions, validation before write, existing cash/bank/customer and vendor bookkeeping.
- KISS: Products gets a Bundle type; POS retains its existing search/cart/Enter flow; no new standalone module, nested bundles, manufacturing, or vendor sourcing of bundle components.
- Sale bundle quantity and return quantity must be whole sets. Physical quantity per component must be finite, greater than zero, valid in component's canonical stock unit.
- A bundle has its own selling price; use it for server-authoritative auto price; no independent physical stock lot, purchase, adjustment, or current-stock mutation.
- Treat blank historical Product Type and Source Sale Product ID as Standard and same as physical Product ID, respectively.
- All transaction effects remain attributable to original invoice and source sale product. Historic sale recipes win over edited master definitions.
- No product-code modifications, PR merge, clasp push or deploy before explicit user approval.

## Review Focus (hidden failure modes to pin with tests)

1. Two visible sale lines needing the same physical Pipe lot must plan FIFO **once per product**; net stock, lot balance, and attribution must reconcile (Task 4, Task 5).
2. A single component is already negative before checkout: show 0 available sets, still post to OVERSOLD accurately, then return the bundle without corrupting lot/debt history (Task 4, Task 7).
3. Bundle recipe changes after sale and after draft save: old invoice updates/returns use snapshot, new or stale draft requires explicit refresh (Tasks 6–8).
4. An invoice mixing a standard Pipe and Tubewell Set must return only the lots consumed for the selected visible line, even with shared product and multiple lots (Tasks 4, 7).
5. Partial Sheets commit, concurrent recipe edit, duplicate draft post, and cost-correction on component lots must not double-post money or fabricate “complete” profit evidence (Tasks 5, 6, 9, 10).

## File responsibility map

| Target | Responsibility |
|---|---|
| `Config.gs`, `Database.gs`, `Setup.gs` | New Sheets and headers, legacy defaults, cache invalidation and setup |
| **Create** `Bundles.gs` | Recipe validation/read/update, bundle capacity, snapshots and physical demand expansion |
| `Products.gs`, `products.html` | Products CRUD, display/edit type and components, prohibit direct inventory on bundle |
| `StockLots.gs` | Aggregate FIFO assignment to sold parent lines; restoration by source sale product |
| `Sales.gs`, `pos.html` | POS bootstrap/stock display/price; server sale posting of one visible row + physical component demands |
| `DraftSales.gs`, `draftSales.html` | Bundle revision in JSON and safe draft-post workflow |
| `SalesReturn.gs`, `DeleteEngine.gs` | Restore only historical component lots on native return and delete |
| `SalesManagement.gs` | Invoice edit deltas, historic recipe, profitability cost coverage |
| `Invoice.gs`, `Reports.gs`, `sales.html` | Printable single parent line, sales detail and accurate gross profit |
| `tests/*bundle*.test.js` | New isolated workbook, UI and integration regressions |

*Current main was inspected; `.gs` is the authoritative GitHub extension. The uploaded ZIP contains an older renamed `.js` backup. Reinspect latest branch file locations at execution time before coding.*

---

### Task 1: Additive schema and backward-compatible read contract

**Files**
- Modify: `Config.gs` (SHEETS, HEADERS, ID_PREFIX only if needed)
- Modify: `Database.gs` (sheet eligibility / cache invalidation)
- Modify: `Setup.gs` (only if its setup list is independent of CONFIG)
- Create: `tests/bundle_schema.test.js`

**Interfaces**
- Expose keys `BUNDLE_COMPONENTS` and `SALE_BUNDLE_COMPONENTS` using existing `getAllRows_ / appendRows_ / updateRowFields_`.
- Append `PRODUCTS.Product Type`, `PRODUCTS.Bundle Revision`, `SALE_ITEMS.Sold Product Type`, `SALE_ITEM_LOTS.Source Sale Product ID`, `STOCK_MOVEMENT.Source Sale Product ID`, `SALES_RETURN_ITEMS.Sold Product Type`.
- BUNDLE_COMPONENTS: Bundle Product ID, Component Product ID, Quantity Per Set, Unit, Revision, Status, Updated At.
- SALE_BUNDLE_COMPONENTS: Invoice ID, Bundle Product ID, Bundle Revision, Component Product ID, Quantity Per Set, Sets Sold, Component Quantity Sold, Unit, Created At. Recipe/ratio and revision never change after sale; Sets Sold/Component Quantity Sold may change **only** during a permitted native invoice update with the preexisting invoice edit log.

- [ ] **1.1 Failing tests:** assert headers and names, additive old-row defaults, new-sheet read/write/cache invalidation, no new stock rows for bundle.
- [ ] **1.2 Run:** `node --test tests/bundle_schema.test.js` → FAIL before schema.
- [ ] **1.3 Implement:** minimal CONFIG/repository/setup changes without touching legacy stock/sale data.
- [ ] **1.4 Verify:** same command → PASS; run `node --test tests/invoice_integrity_regressions.test.js` → PASS.
- [ ] **1.5 Commit:** `git add Config.gs Database.gs Setup.gs tests/bundle_schema.test.js && git commit -m "feat(bundle): add backward-compatible sheet contracts"` (omit Setup.gs from staging if not changed).

### Task 2: Master recipe service and bundle Products CRUD

**Files**
- Create: `Bundles.gs`, `tests/bundle_definition.test.js`
- Modify: `Products.gs`, `DeleteEngine.gs`, `Purchase.gs`, `PurchaseManagement.gs`

**Interfaces**
- `validateBundleDefinition_(bundleId, components, productsById)` → normalized array of `{productId, qtyPerSet, unit}` or throws.
- `getBundleDefinitions_(bundleIds, productsById, componentRows)` → map by bundle ID of `{bundleId, revision, components}`.
- `getBundleAvailability_(definition, productsById)` → nonnegative integer.
- `getSaleBundleSnapshot_(invoiceId, snapshotRows)` → map by sold bundle ID with revision, per-unit component quantities, and sold sets.
- `addBundleProduct(token, payload)`, `updateBundleProduct(token, bundleId, payload)` → existing `ok_ / fail_` envelope, products:add/edit permission and script lock; validate all before writing. Existing `addProduct/updateProduct` delegate only after type validation; no conversion from existing Standard.
- `getProductsBootstrap` includes recipe summary/availability without repeated Sheets reads.

- [ ] **2.1 Failing tests:** one bundle with three components; duplicates, nested, deleted/inactive, 0/NaN and fractional set count reject; revision increments only on changed recipe; inactive historic component doesn't prevent old reversal; blank legacy Product Type is Standard; capacity floor=min; product stock adjustment/purchase/delete guards reject bundle or referenced component.
- [ ] **2.2 Run:** `node --test tests/bundle_definition.test.js` → FAIL.
- [ ] **2.3 Implement:** `Bundles.gs`, Products service functions; extend `DeleteEngine.gs::deleteProduct` component-reference guard, and `Purchase.gs::createPurchase` plus `PurchaseManagement.gs` purchase-update validation to disallow bundle IDs; no direct Sheet calls from UI.
- [ ] **2.4 Verify:** bundle-definition tests and `node --test tests/audit_sales_stock.test.js` → PASS.
- [ ] **2.5 Commit:** `git add Bundles.gs Products.gs DeleteEngine.gs Purchase.gs PurchaseManagement.gs tests/bundle_definition.test.js && git commit -m "feat(bundle): manage virtual bundle recipes"`.

### Task 3: Products editor UX without changing standard-product flow

**Files:** Modify `products.html`; Create `tests/bundle_product_ui.test.js`.

**Interfaces**
- Existing Products add/edit UX gains Standard / Bundle product type, inline component search, qty and remove; uses same searchable field/clear and responsive style. Bundle-only controls hide current/opening/min stock, purchase price, manual adjustment; show read-only Available Sets and explicit “Negative component stock allowed”.
- Keep existing normal product submit payload identical; bundle submit includes `components: [{productId, qtyPerSet}]`.

- [ ] **3.1 Failing tests:** DOM/template assertions for type toggle, component picker, qty validation, no bundle stock edit controls, unchanged standard form and X/Enter behavior.
- [ ] **3.2 Run:** `node --test tests/bundle_product_ui.test.js` → FAIL.
- [ ] **3.3 Implement:** reuse existing modal/styles; no new page, side menu, or nested bundles.
- [ ] **3.4 Verify:** UI suite PASS; manually inspect mobile/tablet/desktop form.
- [ ] **3.5 Commit:** `git add products.html tests/bundle_product_ui.test.js && git commit -m "feat(bundle): add compact bundle editor"`.

### Task 4: Physical demand expansion and attributed FIFO

**Files:** Modify `Bundles.gs`, `StockLots.gs`; Create `tests/bundle_stock_planning.test.js`.

**Interfaces**
- `buildSaleStockDemands_(displayLines, definitions, historicalSnapshots)` → `{requirementsByProductId, ownersByProductId}`. Owner rows: `{sourceSaleProductId, physicalProductId, qty}`; Standalone sourceSaleProductId=physicalProductId. On an edit, historicalSnapshots supplies ratios for pre-existing bundles.
- `planAttributedStockConsumption_(demands, allLots, productsById)` → `{plansByProductId, attributedDraws}`; call `planStockConsumption_` **once** per physical ID; allocate each real/FALLBACK/OVERSOLD draw to source-sale owners in deterministic cart order. Do not mutate Sheets. Preserve vendor-sourced standalone net-owned calculation as separate existing path, never bundle vendor attribution.
- Extend `planSaleReturnRestoration_(..., options)` with `options.sourceSaleProductId` to filter `SALE_ITEM_LOTS` by parent when given, default blank/own ID for legacy normal records. Reuse virtual row reservations for batch restoration.

- [ ] **4.1 Failing tests:** Tubewell Set ×2 gives pipe10/elbow20/motor2; plus standalone pipe3 consumes a combined pipe13 once; two bundles sharing a motor; two FIFO purchase lots; negative OVERSOLD attribution; distinct restoration plans for bundle vs standalone.
- [ ] **4.2 Run:** `node --test tests/bundle_stock_planning.test.js` → FAIL.
- [ ] **4.3 Implement:** pure expansion/allocation helpers and surgical restoration filter, reusing FIFO and OVERSOLD implementations.
- [ ] **4.4 Verify:** new suite, `node --test tests/audit_sales_stock.test.js` and `node --test tests/stock_lot_cost_correction_regressions.test.js` → PASS.
- [ ] **4.5 Commit:** `git add Bundles.gs StockLots.gs tests/bundle_stock_planning.test.js && git commit -m "feat(bundle): attribute aggregate FIFO draws to sale parents"`.

### Task 5: POS bundle sale with one invoice line

**Files:** Modify `Sales.gs`, `pos.html`; Create `tests/bundle_sale_posting.test.js`.

**Interfaces**
- `getPosBootstrap(token)`: return Bundle product records with `productType='Bundle'`, `bundleRevision`, `availableSets`, sale price and component warning data; do not expose cost to users without existing `posCost` permission.
- `completeSale(token,payload)`: verify bundle revision, integer set qty, and server-side component recipe. Standard vendor sourcing unchanged; bundle ignores/rejects `vendorId/vendorUnitCost`. In `priceMode='auto'` take Bundle Selling Price, never component lot ladder; `fixed` retains native draft price integrity. Expand, aggregate, validate all, plan FIFO, allocate per owner, then write one SALE_ITEMS row per visible line, physical stock/lot/movement per component, attributed SALE_ITEM_LOTS, SALE_BUNDLE_COMPONENTS and one financial sale.

- [ ] **5.1 Failing VM-workbook tests:** 2 sets @15000 = 30000 with one SALE_ITEMS line and -10/-20/-2; zero-stock motor produces oversold; component+standalone overlap; subtotal/discount/cash+due only once; stale revision/no component failure before any transaction write; no vendor sourcing for bundle; reject shared-component mixed cart when standalone line requires vendor sourcing (ask user to split invoices); ordinary standalone vendor sourcing stays passing.
- [ ] **5.2 Run:** `node --test tests/bundle_sale_posting.test.js` → FAIL.
- [ ] **5.3 Implement:** server posting and UI product search/cart inclusion with original Enter flow; use existing movement and finance services.
- [ ] **5.4 Verify:** new tests, `node --test tests/audit_sales_stock.test.js tests/sale_update_sourcing_reconciliation.test.js` → PASS.
- [ ] **5.5 Commit:** `git add Sales.gs pos.html tests/bundle_sale_posting.test.js && git commit -m "feat(bundle): sell one virtual item and consume component stock"`.

### Task 6: Draft and duplication revision safety

**Files:** Modify `DraftSales.gs`, `draftSales.html`, `pos.html`; Create `tests/bundle_draft.test.js`.

**Interfaces**
- Draft line JSON adds `bundleRevision` as integer for Bundle; existing data parsed unchanged. `fixedDraftLineByProduct_` continues to validate the visible parent product price/qty/total; draft posting verifies bundle revision against server master and requests explicit draft refresh on mismatch.
- Duplicate invoice opens POS with **current** revision (not copied historic snapshot); edit existing invoice (Task 8) remains historic. Posted-draft retries resolve original invoice before checking stale recipe.

- [ ] **6.1 Failing tests:** saved revision round-trip; stale draft rejected without stock or money write; existing nonbundle draft passes; double-submit/retry returns same invoice ID even after recipe edit; fixed draft price preserved; duplicate uses new revision.
- [ ] **6.2 Run:** `node --test tests/bundle_draft.test.js` → FAIL.
- [ ] **6.3 Implement:** minimal additive JSON/UI and server check.
- [ ] **6.4 Verify:** new tests and `node --test tests/draft_sales_server.test.js` → PASS.
- [ ] **6.5 Commit:** `git add DraftSales.gs draftSales.html pos.html tests/bundle_draft.test.js && git commit -m "feat(bundle): preserve draft recipe revisions and posting retries"`.

### Task 7: Native return, batch return, delete and stock history

**Files:** Modify `SalesReturn.gs`, `DeleteEngine.gs`, `StockLots.gs`; Create `tests/bundle_reversals.test.js`.

**Interfaces**
- `prepareSalesReturn_`: lookup parent line and saved per-unit recipe; enforce whole set and remaining sold-parent quantity. Build component-level return restoration plans with sourceSaleProductId, preserving shareable virtual reservations across batch; allocate price/refund using existing discounted parent-unit calculation. `commitPreparedSalesReturn_`: one return parent record + physical component lot/stock restoration, not a second customer refund.
- `deleteSalesInvoice`: reconstruct physical reversal from SALE_ITEM_LOTS and source parent, not from the visible bundle as if it were a stock product. Preserve existing returns-first guard, supplier/vendor and cash/bank/customer reversals.
- Document how FALLBACK/OVERSOLD sale-lot reversal keeps lot ledger and Current Stock reconcilable; do not create phantom physical bundle lots.

- [ ] **7.1 Failing tests:** sell2/return1 yields +5/+10/+1 and correct cash refund; return after recipe changed uses original; repeated return above remaining rejected; mixed standard Pipe+bundle restores its own lot provenance; batch return virtual reservations avoid duplicate lot restoring; delete without return restores all components; old normal return/delete still pass; cash-session/permissions preserved.
- [ ] **7.2 Run:** `node --test tests/bundle_reversals.test.js` → FAIL.
- [ ] **7.3 Implement:** extend existing native return/delete functions rather than a parallel subsystem.
- [ ] **7.4 Verify:** new tests, `node --test tests/multi_invoice_sales_return_regressions.test.js tests/audit_sales_stock.test.js` → PASS.
- [ ] **7.5 Commit:** `git add SalesReturn.gs DeleteEngine.gs StockLots.gs tests/bundle_reversals.test.js && git commit -m "feat(bundle): restore original components on return and delete"`.

### Task 8: Historical-recipe invoice editing

**Files:** Modify `SalesManagement.gs`, `Bundles.gs`, `StockLots.gs`; Create `tests/bundle_sale_edit.test.js`.

**Interfaces**
- `updateSaleInternal_`: carry original recipe by bundle ID and parent sale line from SALE_BUNDLE_COMPONENTS; expanding quantity uses historical ratio, not latest recipe. Added bundle line loads current revision. Prepare *all* old-lot restorations with source filter and virtual reservations and then net new aggregate physical draws; prevalidate existing return/date/open-session/vendor/debt/payment policies.
- Quantity decreases, increases and product removal reconcile owned lots, Stock Movement, Current Stock, sale component Sets Sold, parent line totals and existing edit log. Same-qty price change has **zero** stock writes. Disallow fractional set qty. Maintain no source sharing across parent lines.

- [ ] **8.1 Failing tests:** edit old set qty2→3 after master recipe change draws only +5/+10/+1 from old recipe; qty2→1 restores original lot attribution; remove bundle line completely; add new bundle with current recipe; price-only edit preserves all stock and lots; mixed parent/standalone shared pipe; edit blocked if return exists/closed cash session.
- [ ] **8.2 Run:** `node --test tests/bundle_sale_edit.test.js` → FAIL.
- [ ] **8.3 Implement:** keep current `updateSaleInternal_` financial reconciliation and edit audit; replace only stock-demand planning and application for affected bundle lines.
- [ ] **8.4 Verify:** new tests, `node --test tests/sale_update_sourcing_reconciliation.test.js tests/audit_sales_stock.test.js` → PASS.
- [ ] **8.5 Commit:** `git add SalesManagement.gs Bundles.gs StockLots.gs tests/bundle_sale_edit.test.js && git commit -m "feat(bundle): edit invoices using historical recipe snapshots"`.

### Task 9: Invoice, profit, reports and read models

**Files:** Modify `Invoice.gs`, `SalesManagement.gs`, `Reports.gs`, `sales.html` if breakdown is displayed; Create `tests/bundle_profit_reports.test.js`.

**Interfaces**
- Printed/detail invoice and list expose only parent line `Tubewell Set ×2 = ৳30000`; staff details may include read-only component listing. `buildSalesInvoiceProfitMetrics_` and report cost-coverage calculations compare physical demands (and same-source lot coverage) rather than bundle Product ID to component Product IDs.
- Net COGS=sum net remaining SALE_ITEM_LOTS physical qty × existing lot unit cost (and standalone vendor cost); net revenue uses normal sales and return amounts; cost correction on component lot flows to report the same way as standard physical product.

- [ ] **9.1 Failing tests:** no duplicate component revenue; exact sample COGS; component purchase price changes after sale don't silently reprice historic cost; partial return correctly reduces net revenue and net COGS; missing lot evidence marks costComplete=false; old invoice remains unchanged; no customer-facing component pricing.
- [ ] **9.2 Run:** `node --test tests/bundle_profit_reports.test.js` → FAIL.
- [ ] **9.3 Implement:** one coherent cost-coverage read model reused by sales list and reports; preserve permission-gated cost exposure.
- [ ] **9.4 Verify:** new tests, `node --test tests/accounting_state_drift_read_paths.test.js tests/stock_lot_cost_correction_regressions.test.js` → PASS.
- [ ] **9.5 Commit:** `git add Invoice.gs SalesManagement.gs Reports.gs tests/bundle_profit_reports.test.js && git commit -m "feat(bundle): report parent revenue and component FIFO cost"` (also stage sales.html only if changed).

### Task 10: Full verification, rollout safety and documentation

**Files:** Create `tests/bundle_end_to_end.test.js`; modify deployment/test documentation if necessary. No silent production rollout.

**Interfaces**
- An isolated in-memory workbook for sale→return, sale→edit→delete, stale draft→retry, standalone/vendor sale unaffected, plus a manual test-deployment checklist. Validate snapshots, stock movement arithmetic, FIFO lots and ledger reference counts at each step.

- [ ] **10.1 Failing cross-module acceptance tests:** create Tubewell Set 5/10/1; sell2 for 30000; physical movement -10/-20/-2; sold line count1; return1 +5/+10/+1; single correct refund; stock cache=lot totals; duplicate posted draft returns same invoice; standard negative-stock/vendor sale unchanged.
- [ ] **10.2 Run:** `node --test tests/bundle_end_to_end.test.js` → FAIL.
- [ ] **10.3 Implement:** test harness and any narrowly scoped missing integration or recovery guard discovered (add a regression first). Document rollback procedure: disable new bundle UI/creation while preserving historic read/return support; never remove new Sheets/columns or corrupt sold records.
- [ ] **10.4 Verify:** `node --test tests/*.test.js` → PASS and manually verify in **separate test spreadsheet / Apps Script test deployment**: desktop/mobile POS keyboard flow, invoice preview, partial/batch return, sale edit, delete, cost permissions, historic migration, shortage and recovery. Record concrete results/screenshots/logs in PR.
- [ ] **10.5 Commit:** `git add tests/bundle_end_to_end.test.js docs/ && git commit -m "test(bundle): verify native posting and full reversal lifecycle"`; open a code PR for review **only after** all checks pass. Do not merge or clasp deploy without user request.

## Final acceptance gate

- [ ] Bundle creation/editing with active standard components, independent price, barcode and revision.
- [ ] One visible sale/invoice item and correct aggregated component FIFO lot + Current Stock effects.
- [ ] Negative component sale generates existing OVERSOLD evidence, without stock-rejection popup.
- [ ] Original component recipe survives edits, returns, deletion, duplication and recipe revision changes.
- [ ] Partial-set **quantities** not permitted; partial **number of complete sets** returned as usual.
- [ ] Existing vendor sourcing for standalone lines, cash/bank/customer ledgers, drafts and all prior standard-product tests pass.
- [ ] Profit/cost coverage are accurate, permission-gated and traceable by source sale product.
- [ ] No product code merged, Sheets mutated, clasp pushed, or production deployed before explicit authorization.

## Execution handoff (after plan approval)

Recommend **subagent-driven** implementation with task-level code review: cross-module stock/financial accounting changes can cause data loss and are worth independent validation. Follow the plan sequentially (Task 1→10) in an isolated GitHub feature branch, require TDD/red-green per task, run full test suite and request user approval prior to final merge/deployment.
