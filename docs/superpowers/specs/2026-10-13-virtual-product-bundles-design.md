# Virtual Product Bundles — Design Specification

**Date:** 2026-10-13  
**Status:** Proposed for written-spec review; no implementation authorized  
**Project:** Mohim ERP (Apps Script / Google Sheets); source of truth: `shuvodelux-commits/Mohim_ERP` main  
**Decision:** Virtual sales kits, not physically pre-assembled stock. Negative component stock is permitted using the existing OVERSOLD-lot policy.

## 1. Purpose and acceptance example

A shopkeeper creates one product called **Tubewell Set**, sets a selling price of **৳15,000 per set**, and chooses the following physical products for every set: **5 pipes, 10 elbows, 1 motor**. POS searches/selects “Tubewell Set” as one product. Sale of two sets displays **Tubewell Set × 2 = ৳30,000** on the customer's invoice and deducts 10 pipes, 20 elbows, and 2 motors from stock using each component's existing FIFO lots and stock movements. Individual products keep their independent purchase/selling prices; the bundle revenue does not have to equal their individual selling prices. Bundle profit is revenue less actual FIFO cost of all components, including existing treatment of OVERSOLD fallback cost.

Success means ordinary sales, stock adjustments, returns, invoice updates, drafts, cash/bank/customer ledgers, day book, reconciliation, sales profit, security, and historic invoices retain their existing behavior.

## 2. Reviewed codebase and limits

Verified current GitHub main by reading `AGENTS.md`, `Config.gs`, `Products.gs`, `Sales.gs`, `StockLots.gs`, `SalesReturn.gs`, `SalesManagement.gs`, `DraftSales.gs`, and `DeleteEngine.gs`; reviewed `Invoice.gs` and representative existing Node tests. Uploaded clasp ZIP is a **different, older checkout/branch** (its embedded git HEAD is dated 2026-09-27 and files appear as .js), so the ZIP is supplementary, **not** an authority over current main. All code-task locations in the plan mean current GitHub `.gs` files.

Existing guarantees confirmed:
- `Sales.gs::completeSale` plans FIFO before writes, under script lock, and writes one `SALE_ITEMS` row per visible POS line. It currently assumes sold Product ID equals stocked Product ID.
- `StockLots.gs::planStockConsumption_` is read-only; `applyStockConsumption_` updates lots and can create an OVERSOLD lot for shortage. `SALE_ITEM_LOTS` identifies purchased lots with Product ID and Invoice ID and is reduced by native returns.
- `SalesReturn.gs::prepareSalesReturn_` validates returns against `SALE_ITEMS`, then plans restoration by Product ID; `completeReturnBatch` shares virtual stock state.
- `SalesManagement.gs::updateSaleInternal_`, `DeleteEngine.gs::deleteSalesInvoice`, and `buildSalesInvoiceProfitMetrics_` are currently Product-ID-centered.
- `DraftSales.gs` saves cart JSON and supports version-checked idempotent post retries. `Products.gs` permits changing current stock when editing.
- Apps Script/Sheets does not offer an all-sheet SQL transaction rollback. Keep the existing validate-all-then-write discipline; do not falsely promise crash-atomicity.

## 3. Chosen model and v1 boundaries

**Choice: virtual product bundle (sales kit).** The bundle exists in Products, is searchable and sellable as a **set**, but owns **no stock quantity or lot**. Its available sets are derived read-only from components. Users cannot purchase a bundle directly, set its opening stock, manually adjust stock, transfer its stock, or use it as a physical component. These operations continue to target standard products only.

**Included:** create/edit/deactivate bundles; independent bundle sale price and barcode; one POS/invoice line; server-validated recipe; sale qty multipliers; negative component stock; FIFO and full accounting cost; sale updates/duplication; native complete-set returns and batch returns; sale deletion; drafts; permission and audit integration.

**Excluded:** nested bundles, manufacturing/assembly/disassembly, returning only part of a set, on-the-fly substitutions, vendor sourcing on bundle lines, buying a virtual bundle, allocating a separate cash payment per component, and rewriting historical sale recipes after an edit.

Current normal product behavior is unchanged. A product starts as Standard unless explicitly created as Bundle. **Do not convert a pre-existing Standard product into a Bundle or back again** in v1; use Add Bundle to avoid corrupting historical stock. Bundle recipe is editable only for **future** sales; prior invoices use snapshots.

## 4. User interface

Stay inside the existing **Products** page. Product editor gains Product Type (Standard / Bundle). Bundle form has Name, Category, Brand (optional), Unit fixed to **set**, optional barcode, selling price, Status, and an inline searchable component table [Product, Quantity, Unit, remove]; Add component reuses current product search/select and clear behavior. A component must be active Standard, never the bundle itself or another bundle. Disallow duplicate component IDs and 0/NaN/infinite/negative quantities. Quantities are expressed in the component's canonical inventory unit; use the same fractional precision and unit-conversion constraints already enforced by existing stock operations, if present. Bundle **sale quantity and return quantity are positive whole sets**.

Do not show editable Purchase Price, Opening Stock, Stock Adjustment, or Minimum Stock for bundles. Show calculated **Available Sets** instead of current stock, with optional component shortage explanation and a concise “Bundle” label. Calculation: minimum floor(max(0, component Current Stock) / quantity required) across all components, clamped at 0. This is informational only: **selling more sets remains allowed** and negative component stock follows standard OVERSOLD behavior. Existing POS row/cart layout and Enter-to-product/qty focus flow remain intact. Bundle search result/line uses the bundle's fixed product Selling Price for auto mode, not component lot selling-price ladders; permitted manual bundle price override works as now.

Invoice, sale list, return selector and invoice print show **one Tubewell Set line** with its bundle price. A staff-only component breakdown can be shown in details, not as extra billed invoice lines. Financial summaries post one parent sale value only; never sum separately generated component revenue.

## 5. Data contract / additive schema

Extend `Config.gs` / Sheets headers:
- PRODUCTS: append **Product Type** = Standard or Bundle (blank legacy value means Standard), **Bundle Revision** = positive integer for bundles. Existing column order and meaning unchanged.
- New BUNDLE_COMPONENTS sheet (“Bundle Components”): **Bundle Product ID**, **Component Product ID**, **Quantity Per Set**, **Unit**, **Revision**, **Status** (active/retired), **Updated At**. Every active revision has at least one component; only one active component entry per component ID. Publishing a changed recipe increments Bundle Revision under lock; old revision rows may be kept for audit but aren't used for new sales.
- SALE_ITEMS: append **Sold Product Type** (Standard/Bundle). Never silently recast old invoices on a later product type change.
- New SALE_BUNDLE_COMPONENTS sheet (“Sale Bundle Components”): **Invoice ID**, **Bundle Product ID**, **Bundle Revision**, **Component Product ID**, **Quantity Per Set**, **Sets Sold**, **Component Quantity Sold**, **Unit**, **Created At**. Rows are immutable sale-time recipe snapshots; valid unique key (Invoice ID, Bundle Product ID, Component Product ID). For invoice quantity updates, update the outstanding sold-quantity snapshot in concert with the existing edit log and audit lineage, while preserve original recipe per set. Existing return totals remain in SALES_RETURN_ITEMS; derived outstanding components are computed against original sold sets and returns.
- SALE_ITEM_LOTS: append **Source Sale Product ID**. Blank for historical normal sales and interpreted as same as Product ID; for bundle consumption, Product ID = **physical component** and Source Sale Product ID = **visible bundle**. This is required when one sale contains an individual pipe and a Tubewell Set with pipes, or two sets sharing a component. Keep the existing Quantity net-of-returns semantics.
- Optional/needed audit metadata on STOCK_MOVEMENT **Source Sale Product ID** for component traceability; its product id remains the physical product. Current Stock and STOCK_LOTS always belong to physical components.
- SALES_RETURN_ITEMS: append **Sold Product Type** for explicitly identifying a returned bundle line when viewing history; historical blank defaults Standard.

Add new SHEETS, HEADERS, and ID prefixes **only where generated IDs are actually needed**. Composite keys above do not require separate counters. `Database.gs` must recognize new keys and invalidate their caches when written. Setup is additive via the project's existing header self-healing; old rows/legacy normal invoices require no one-time rewrite.

## 6. Service interfaces and invariant

Create a small dedicated `Bundles.gs` business layer:
- `getBundleDefinitions_(bundleIds, productsById, componentRows)`: parse and index current active recipes with versions; read inputs once; return maps.
- `validateBundleDefinition_(bundleId, components, productsById)`: reject empty, duplicate, inactive, bundle-as-component, nonexistent, nonfinite or invalid quantities.
- `buildSaleStockDemands_(displayLines, currentDefinitions, historicalSnapshots)`: map visible sale lines to **physical product demands**, retaining owner/sold Product ID and lot attribution. Provide a deterministic order, aggregate demand by physical ID before FIFO planning, and allocate the resulting FIFO draws back to each owner line without overdrawing a lot.
- `getBundleAvailability_(definition, productsById)`: informational capacity, not a sale blocker.
- `getSaleBundleSnapshot_(invoiceId, snapshotRows)`: authoritative historical recipes for update and return.
- `getBundleComponentBreakdown_(invoiceId, ...)`: optional staff detail/read model.

All browser-provided recipe, component costs, virtual stock, availability and revision values are **untrusted**. Sale service derives canonical component quantities server-side. New sale rejects stale Bundle Revision and requests refresh (do not silently consume a changed recipe); draft post follows §9.

Invariant for any posted invoice: each physical product's total stock reduction equals the sum of component stock demands owned by all sold parent lines + standalone demand, less any explicitly separately vendor-sourced standalone quantity. Exactly one `SALE_ITEMS` row is stored per visible parent/standard product. Every `SALE_ITEM_LOTS` row identifies physical Product ID and the visible source sale Product ID. All bundle stock movements reference the normal invoice and explain their parent sale product.

## 7. Sale validation, FIFO, and negative stock

In `completeSale`: build all display lines and prices first; validate recipe revisions, positive integer set count, product and component status, money, permissions, cash session and draft version. Expand each bundle to demands, combine with standalone owned stock demand **by physical Product ID**. Plan FIFO **once per physical Product ID** using existing `planStockConsumption_`, and assign draws to each origin visible line deterministically. Do not plan two independent overlapping draws for pipes sold both inside and outside a bundle. All calculated product Current Stock values derive from aggregated demand, not repeated stale row values.

Normal standalone lines retain their existing vendor sourcing option; **bundle lines cannot source component shortfalls from vendors** in v1. For bundle components (including when stock is zero), unfulfilled quantities become normal OVERSOLD lots; negative Current Stock is visible on component products. Cost is actual FIFO lot unit cost plus existing OVERSOLD fallback; no synthetic bundle cost lot. Preserve payment, discount, due, bank, cash, customer and date logic unchanged.

After full validation, under existing script lock, post parent sale lines, component/standard lot draws, sale-item-lot owner attribution, stock cache updates, movement rows, snapshot rows and financial effects. Arrange writes so any possible validation failure occurs before the first write. Since Sheets writes may fail mid-commit, expose partial-write recovery requirements and reconciliation checks; never claim full atomic rollback. Generate durable invoice IDs and keep draft-post idempotency.

## 8. Native transaction reversals and returns

**Sale edit:** honor existing permissions, open cash-session, already-returned and vendor-settlement guards. Keep the **original component quantities per set** for previously sold bundle lines, even after current recipe changes. Newly added bundle lines use current revision. Plan net physical stock differences across all edited visible lines, maintaining source sale product attribution and lot-restoration reservations before committing. If a bundle line quantity decreases/removes, restore only its own consumed stock lots. If it increases, draw additional components by its historical recipe. Never restore components owned by an unrelated bundle or standalone sale line. Preserve existing invoice edit-log and financial delta semantics.

**Return:** operator selects complete sets on the **visible** invoice. Enforce whole-set qty and max outstanding sets (sold less already returned); derive each component's restore qty from saved recipe. Restore against SALE_ITEM_LOTS filtered by Invoice ID + **Source Sale Product ID** + physical Component Product ID, including OVERSOLD provenance. Do not allow negative return qty, double return or returning component individually from a bundle. Refund/Store Credit uses **bundle sale price after invoice discount** and existing per-invoice paid/refund limits, not component price. Reuse existing `prepareSalesReturn_`, `commitPreparedSalesReturn_`, `completeReturnBatch` and virtual lot reservation. Keep one SALES_RETURN_ITEMS record per returned parent display line.

**Delete:** `deleteSalesInvoice` reverses physical consumption by sourced owner; it must not require bundle Product ID to have a stock lot. Existing policy requires deleting associated returns first. Restore money only once.

**Product deletion:** `deleteProduct` must block deletion of any standard component referenced by an active bundle definition and any historical sale-bundle evidence requiring its existence. Soft delete/deactivate rules remain intact.

## 9. Drafts, reports, cost and historical behavior

Draft saved line stores bundle product ID, revision and price mode. When loading a draft, show saved bundle and current recipe version; on posting **reject if recipe revision changed** with actionable message to refresh/update draft; prevent silent deduction of different components. Keep current `fixed`/manual/auto draft-price contract, version checks and source-draft idempotency. Duplicate Sale creates a new POS cart with **current** recipe (clear old revision and request current stock validation); editing an existing invoice uses **historic** snapshot.

COGS for bundle sale = sum over component SALE_ITEM_LOTS of net outstanding lot qty × unit cost, with existing cost-correction adjustment mechanics. Expense/profit and Invoice Gross Profit need cost coverage measured against **physical demands**, not sold bundle Product IDs; use owner attribution to join where necessary. After returns, customer revenue decreases according to the bundle's effective discount/refund amount; COGS decreases by restored component cost. For future edits, recalculate profit from surviving lot evidence, not from today's component Purchase Prices. Cover `Reports.gs`, `SalesManagement.gs`, day book and related cost completeness calculations; leave cash/bank posting unchanged.

Original historic standard invoices stay readable with blank Product Type/Source Sale Product ID, interpreted as Standard/same ID. All released bundle invoices remain traceable if master recipe changes, is deactivated, or product selling prices change.

## 10. Security, data integrity and failure policy

- Session authorization: `products:view/add/edit`, `pos:view/add`, `sales:edit`, and `returns:add` exactly as existing service boundaries; never expose unrestricted non-underscore Apps Script globals.
- Require script lock for master recipe publishing and every multi-write sale/return/edit/delete operation; check stale bundle revision and draft version **inside** lock.
- Additive headers only; include new sheets in cache invalidation and setup; no live migration/truncation.
- Validate all computed quantities/prices as finite and valid in their existing unit precision; prevent excessive sheets payload.
- Reject missing/inactive component at new posting; existing historical return/delete must still work with preserved evidence even if a component later becomes inactive.
- Read all relevant sheets once per request, index by ID. No per-component full-sheet reads.
- If the write phase has an unexpected Google Sheets failure, log invoice/sale operation and detect partial state for manual repair before retry; do not auto-repeat paid invoices without verified idempotency.
- Audit sample cases: insufficient component → negative/OVERSOLD; FIFO lot allocation; aggregate shared components; mixed bundle + standalone; after-recipe-change return; split cash/credit; partial/batch return; update delta; duplicate; delete; cost correction; permissions; cash-session; historic rows.

## 11. Rollout and acceptance criteria

1. Add schema/backend foundation and tests without showing bundles in POS; expose behind a feature setting if incremental rollout needs gating.
2. Add UI, integrate posted sale/draft handling, then returns/edits/delete/profit; do not ship a half-connected bundle that cannot be reversed.
3. Run Node regression suite including preexisting sales, stock, returns, draft and accounting drift tests, plus new bundle tests. Manually exercise a copy/test deployment with real Sheets before production clasp push/deploy.
4. Verify sample sale 2 × Tubewell Set @৳15,000 writes one parent invoice line at ৳30,000 and movement -10 Pipe, -20 Elbow, -2 Motor; stock cache equals lot ledger, finance entries recorded once.
5. Verify return of 1 set restores 5 Pipe, 10 Elbow, 1 Motor from the original lots, and changes refunded/credited revenue by correct discounted bundle amount.
6. Verify after changing current recipe or prices, an old invoice, profit, edit and return still use original component evidence.

**Approval gate:** Documentation only. No product code, Sheets data, clasp deployment, merge, or production changes until the user explicitly approves the written specification and execution plan.
