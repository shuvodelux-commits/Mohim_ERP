# Multi-Invoice Sales Return Batch — Accounting-Safe Design

Date: 2026-09-21  
Status: Proposed implementation design, approved in chat for specification  
Target: SherERP Google Apps Script + Google Sheets

## 1. Goal

Allow one customer to return products from multiple sales invoices in one operator workflow while preserving SherERP's existing invoice-level accounting, FIFO restoration, cash provenance, customer settlement, reports, and audit history.

Example:

- INV-000002: return 2 units
- INV-000005: return 5 units
- INV-000015: return 3 units

The operator completes one batch action, but SherERP records one normal Sales Return transaction per source invoice.

## 2. Core accounting decision

A batch is a grouping layer only. It is never the accounting source of truth.

Each source invoice keeps its own:

- Return ID
- Invoice ID
- authoritative return amount
- cash-refund eligibility
- Sales Return Credit ledger entry
- stock/FIFO restoration
- Stock Movement references
- Day Book row
- report attribution

Example:

```text
Batch ID: SRB-000125

SRT-000125 -> INV-000002
SRT-000126 -> INV-000005
SRT-000127 -> INV-000015
```

The Batch ID is presentation/audit metadata. Cash Book, Customer Ledger, Stock Movement, reports, and settlement continue to reference the child Return ID.

## 3. Existing invariants that must not change

### 3.1 Return economics

Return value is server-authoritative. The browser submits quantity, not the authoritative price.

The existing economic calculation based on the source invoice's subtotal/grand total and `effectiveTransactionUnitPrice_` remains authoritative. A batch must calculate each invoice separately.

### 3.2 Return quantity

For every source invoice and product:

```text
maximum returnable
= min(
    sold quantity - prior active returned quantity,
    outstanding owned-stock evidence
  )
```

No quantity can be pooled between invoices.

### 3.3 FIFO / stock lineage

A returned unit must restore against the original invoice's `SALE_ITEM_LOTS` evidence. Product quantities from different invoices are never merged before lot restoration.

### 3.4 Cash provenance

Cash refund capacity remains invoice-specific:

```text
refundable cash for invoice
= verifiable cash collected for invoice
- prior active cash refunds for invoice
```

Cash collected against one invoice cannot authorize a refund against another invoice.

### 3.5 Store Credit settlement

The current settlement chain must remain intact:

```text
Customer Ledger Sales Return Credit
-> Reference = Return ID
-> SALES_RETURN.Return ID
-> SALES_RETURN.Invoice ID
-> apply credit to source invoice first
-> then normal customer settlement rules
```

Therefore a single Return ID must never span multiple invoices.

### 3.6 Reporting dates

Existing behavior remains:

- Sales / Profit reporting attributes the return to the source invoice.
- Cash Book / Day Book use the actual return transaction date.
- Batch ID does not change report attribution.

### 3.7 Return immutability

Current Sales Returns are view-oriented and have no native server-side edit/delete workflow. This feature does not create a parallel edit/delete accounting system.

## 4. Scope

### In scope

- multi-select sales invoices for one customer
- combined return workspace grouped by source invoice
- one batch submit
- one child Sales Return per invoice
- validate all selected returns before the first business write
- invoice-level cash/store-credit accounting
- cumulative stock and customer-balance handling
- additive Batch ID metadata
- return-date integrity rule
- SALE_ITEM_LOTS supplier-lineage schema correction
- Return History batch visibility
- regression tests and GitHub CI coverage
- PROJECT.md documentation

### Out of scope

- combining unrelated customers
- multi-invoice Walk-in Customer batches
- one Return ID covering multiple invoices
- mixed Cash + Store Credit methods inside the same batch
- editing/deleting an existing Sales Return
- changing vendor-sourced return semantics
- introducing a second accounting ledger for batches
- changing Sales/Profit report accounting rules

## 5. Data model changes

### 5.1 SALES_RETURN

Add one additive column:

```text
Batch ID
```

Existing single-invoice returns leave it blank.

No separate Batch sheet is required. This avoids creating a second accounting object.

### 5.2 Batch ID generation

After all batch validations pass and child Return IDs are allocated, derive the Batch ID from the first child Return ID numeric suffix.

Example:

```text
first child Return ID: SRT-000125
Batch ID:              SRB-000125
```

This keeps Batch IDs readable and unique without a new sheet, new counter, or new ID-prefix dependency.

### 5.3 SALE_ITEM_LOTS supplier lineage correction

Add the already-written but currently undeclared column:

```text
Supplier ID
```

to `CONFIG.HEADERS.SALE_ITEM_LOTS`.

Reason:

- `Sales.gs` already writes `Supplier ID` into SALE_ITEM_LOTS row objects.
- `Database.gs::appendRows_()` only persists configured/real headers.
- `StockLots.gs` already supports supplier-aware restoration.

Future sales will therefore retain supplier lineage correctly.

Add an idempotent maintenance function:

```text
repairSaleItemLotSupplierIds_()
```

It only fills blank `SALE_ITEM_LOTS.Supplier ID` values by matching `Lot ID` to `STOCK_LOTS.Lot ID` and copying the lot's Supplier ID. It never overwrites a non-blank value.

This repair is deployment maintenance, not part of normal return requests.

## 6. Return-date integrity rule

A new return cannot be dated before its source sale.

Single invoice:

```text
return date >= invoice date
```

Batch:

```text
batch return date >= every selected invoice date
```

A return may still be backdated relative to today when the existing backdate permission/reason rules allow it.

The validation belongs in the shared server preparation path so single and batch returns follow the same rule.

## 7. Server architecture

### 7.1 Shared preparation / commit split

Refactor the existing return logic so both single and batch flows use the same accounting engine.

Introduce internal helpers conceptually equivalent to:

```text
buildSalesReturnContext_()
prepareSalesReturn_()
commitPreparedSalesReturn_()
```

Names may vary slightly during implementation, but responsibilities must remain separated.

### buildSalesReturnContext_

Read shared return dependencies once where practical:

- SALES
- SALE_ITEMS
- SALES_RETURN
- SALES_RETURN_ITEMS
- PRODUCTS
- SALE_ITEM_LOTS
- STOCK_LOTS
- VENDOR_SOURCING
- CUSTOMERS
- CUSTOMER_LEDGER when settlement is required

The batch path must not re-scan full sheets once per selected invoice when a shared indexed read can be used.

### prepareSalesReturn_

Read-only business validation/calculation. It must not write Sheets data.

For one invoice it validates/calculates:

- unique, active source invoice
- selected product membership
- duplicate product payload rejection
- sold quantity
- prior active returns
- outstanding owned-stock evidence
- authoritative economic return value
- cash-refund capacity
- product existence
- Store Credit customer eligibility
- return date >= invoice date
- stock-restoration plan inputs

It returns a prepared object containing all values needed by the write phase.

### commitPreparedSalesReturn_

Applies an already-validated prepared return using an assigned Return ID and optional Batch ID.

It creates the same native accounting records the existing `completeReturn()` creates today:

- SALES_RETURN
- SALES_RETURN_ITEMS
- PRODUCTS stock update
- STOCK_LOTS / SALE_ITEM_LOTS restoration
- STOCK_MOVEMENT
- CASH_BOOK for Cash
- CUSTOMER_LEDGER + customer balance for Store Credit

No second batch-specific accounting postings are created.

## 8. Read-only stock-restoration planning

Add a read-only Sales Return restoration planner in `StockLots.gs`, analogous in principle to the existing purchase-return planner.

Conceptual API:

```text
planSaleReturnRestoration_(invoiceId, productId, qty, virtualState)
applySaleReturnRestorationPlan_(plan, returnId)
```

The planner must use the same restoration ordering currently used by `restoreStockToLots_` and must be able to operate against a virtual/shared quantity state so multiple selected invoices can be validated together before writes.

The existing `restoreStockToLots_` may become a compatibility wrapper around plan + apply.

## 9. Batch endpoint

Add:

```text
completeReturnBatch(token, payload)
```

Payload shape:

```js
{
  invoiceReturns: [
    {
      invoiceId: "INV-000002",
      items: [
        { productId: "PRD-...", qty: 2 }
      ]
    },
    {
      invoiceId: "INV-000005",
      items: [
        { productId: "PRD-...", qty: 5 }
      ]
    }
  ],
  refundMethod: "Cash" | "Store Credit",
  reason: "...",
  notes: "...",
  date: "yyyy-MM-dd",
  backdatedReason: "..."
}
```

Safety limits:

- minimum 2 invoices for batch mode
- maximum 20 invoices
- maximum 100 selected return lines
- all invoice IDs unique

Single-invoice Return continues through the existing `completeReturn()` public RPC.

## 10. Batch validation sequence

`completeReturnBatch()` obtains one ScriptLock and performs this sequence:

1. require `returns:add`
2. require active cash session
3. validate payload shape and limits
4. resolve/validate transaction date and backdate reason
5. load all selected source invoices
6. reject duplicate/deleted/ambiguous invoices
7. require one identical, non-empty Customer ID across all invoices
8. reject Walk-in/blank Customer ID batch mode
9. prepare every child return using the shared read-only engine
10. validate each invoice's refund rules independently
11. validate Store Credit customer state
12. build shared cumulative stock/restoration state
13. validate return date against every source sale date
14. only after every child passes, allocate child Return IDs
15. derive Batch ID
16. enter write phase

No business validation may begin after step 16.

## 11. Cumulative state rules during batch commit

### 11.1 Product Current Stock

The same product can appear on several selected invoices.

The batch must maintain a shared running stock value.

Example:

```text
opening Product A stock = 20
INV-2 return +2 -> running stock 22
INV-5 return +3 -> running stock 25
```

The second write must never reuse the original stock value of 20.

### 11.2 Customer Current Due for Store Credit

All selected invoices belong to one Customer ID.

Use one running due balance:

```text
runningDue = current customer Current Due

child 1:
  runningDue -= return amount
  ledger Balance = runningDue

child 2:
  runningDue -= return amount
  ledger Balance = runningDue
```

Update the Customer master consistently with each successfully committed child or through an equivalent ordering that guarantees a partially completed batch never leaves the master behind completed child ledger entries.

### 11.3 Cash

Create one Cash Book refund entry per child Return ID.

Do not create one combined Batch cash entry.

This preserves invoice-level cash provenance and Day Book traceability.

### 11.4 Stock movements

Create Stock Movement rows per child Return ID.

Batch ID may be added to Notes for operator traceability, but `Reference` remains the child Return ID.

## 12. Failure semantics

Google Sheets does not provide a SQL transaction rollback across these writes.

The implementation therefore guarantees:

- all business-rule validation occurs before the first write
- each committed child is a fully valid native Sales Return
- no batch-level accounting entry can make completed children dependent on an incomplete batch
- if an external Apps Script/Sheets write error interrupts the write phase, already-committed child returns remain independently auditable and correct

The response for a write-phase interruption must include/log the Batch ID and any child Return IDs known to have completed so the operator can reconcile rather than retry blindly.

The implementation must not claim SQL-style atomic rollback.

## 13. Refund-method policy

Version 1 supports one refund method for the whole batch:

- Cash
- Store Credit

Mixed refund methods inside one batch are intentionally excluded.

### Cash

Each child must independently satisfy its invoice cash limit.

A batch-level total cash comparison is forbidden.

### Store Credit

Each child writes its own `Sales Return Credit` Customer Ledger row:

```text
Reference = child Return ID
```

This preserves `CustomerSettlement.gs` source-invoice-first allocation.

## 14. UI design

### 14.1 Search results

Current search supports invoice number or phone.

Add:

- checkbox/select control
- Customer ID in returned search DTO
- selected count
- `Open Selected Invoices` button

After the first invoice is selected:

- only rows with the same non-empty Customer ID remain selectable
- duplicate invoice IDs remain disabled
- Walk-in invoices can only use the existing single-invoice Load path

### 14.2 Combined return workspace

Show one customer summary followed by one section per source invoice.

Each section shows:

- invoice ID
- invoice date
- original total
- paid/settled
- due
- cash refundable
- previous return amount
- product rows
- Sold
- Returned
- Available
- Return Qty
- Return Price
- Line Total

The same product appearing on different invoices remains separate.

### 14.3 Totals

Show:

- selected invoice count
- selected return-line count
- total return amount
- for Cash: per-invoice cash eligibility warnings and total eligible cash as informational only

The server remains authoritative.

### 14.4 Single-invoice compatibility

The existing Sales Management -> Sales Return action continues to open the normal single-invoice workflow.

No user is forced into batch mode.

## 15. Return History

Keep one row per child Return, because that is the accounting transaction.

Add/display `Batch ID`.

For a batch row, offer a batch-detail view that groups every child sharing that Batch ID.

Add server read helper:

```text
getReturnBatchDetail(token, batchId)
```

It returns:

- batchId
- customer
- common date/reason/notes
- child return headers
- child items
- batch total

No batch-level financial totals are persisted separately; the displayed batch total is the sum of child returns.

## 16. Reports / Day Book / settlement changes

### Reports.gs

No accounting formula change.

Regression tests must prove:

- returned value remains attributed by child Invoice ID
- profit uses the same return-item economics
- batch metadata does not change net sales or COGS logic

### DayBook.gs

Keep one Sales Return row per child Return ID.

Optionally include Batch ID in the description only.

### CustomerSettlement.gs

No algorithm change expected.

Regression tests must prove every Sales Return Credit still maps through:

```text
Return ID -> Invoice ID
```

and settles its source invoice first.

## 17. Files expected to change

Production:

- `Config.gs`
- `SalesReturn.gs`
- `StockLots.gs`
- `returns.html`
- `returnHistory.html`
- `Setup.gs` or a dedicated maintenance/migration location if needed
- `PROJECT.md`

Possibly read-only helper changes in:

- `Utils.gs`

Tests:

- new multi-invoice return business-logic regression suite
- existing return/settlement/report/stock tests updated only where necessary
- GitHub Actions regression workflow expanded to include the new suite

No unrelated module refactor is part of this change.

## 18. Required regression matrix

### Identity and selection

- two invoices for same Customer ID are accepted
- different Customer IDs rejected before writes
- blank Customer ID / Walk-in batch rejected
- duplicate Invoice ID payload rejected
- duplicate historical Sales invoice ID rejected
- deleted source invoice rejected
- inactive customer rules match native Cash vs Store Credit behavior

### Quantity and economics

- different invoice discounts calculate independently
- same product on three invoices remains three source-specific return calculations
- prior returns reduce each invoice independently
- client cannot override return price
- one-paisa discounted-value clamp remains correct
- return date before any selected sale date rejected before writes

### Cash

- cash capacity checked independently per invoice
- excess cash on invoice A cannot fund invoice B refund
- prior cash refunds reduce only their source invoice capacity
- non-cash original collections do not create refundable cash
- Cash Book contains one row per child Return ID
- Day Book cash out equals sum of child cash returns

### Store Credit / customer ledger

- one ledger credit per child Return ID
- source invoice receives its own credit first
- excess becomes normal customer credit under current settlement rules
- repeated child credits produce correct running Customer.Current Due
- ledger Balance values are sequentially correct
- reports do not count Store Credit as collected cash

### Stock / FIFO

- same product returned from several invoices increments Current Stock cumulatively
- restoration only touches SALE_ITEM_LOTS belonging to each source invoice
- partial repeated returns consume restoration evidence once
- legacy/oversold fallback behavior remains unchanged
- supplier lineage persists for new SALE_ITEM_LOTS
- supplier-lineage repair fills blanks without overwriting existing values

### Reports and history

- Sales Report net sales unchanged except correct child returns
- Profit report COGS/return handling unchanged
- Return History shows child Return IDs and common Batch ID
- batch detail total equals sum of child returns
- existing single returns with blank Batch ID remain readable
- deleted/soft-deleted return header behavior remains unchanged

### Failure and compatibility

- invalid final child causes zero business writes
- all preparation paths are read-only
- single-invoice `completeReturn()` passes all existing tests unchanged
- public RPC security test includes the new batch RPC
- production static gate passes
- GitHub regression workflow passes on the feature branch and on merged main

## 19. Deployment sequence

1. deploy additive schema code
2. run normal setup/repair so `Batch ID` and `SALE_ITEM_LOTS.Supplier ID` headers exist
3. run `repairSaleItemLotSupplierIds_()` once on a backup/test spreadsheet and review its counts
4. run full regression suite
5. perform live smoke test on a backup copy:
   - one normal single return
   - one 3-invoice Cash batch
   - one 3-invoice Store Credit batch
   - same product across multiple selected invoices
   - prior-return case
6. reconcile:
   - Product Current Stock
   - Stock Lots
   - Sale Item Lots
   - Customer Current Due
   - Customer Ledger
   - Cash Book
   - Day Book
   - Sales Report
   - Profit Report
7. deploy to production only after reconciliation matches

## 20. Acceptance criteria

The feature is complete only when:

- operators can select multiple invoices belonging to one customer and complete one return workflow
- SherERP creates one native child Sales Return per invoice
- every child keeps its original invoice identity
- Batch ID is grouping metadata only
- cash provenance cannot cross invoice boundaries
- Store Credit continues source-invoice-first settlement
- stock/FIFO restoration remains source-invoice-specific
- cumulative Product stock and Customer Due are correct when several children affect the same master row
- single-invoice returns behave exactly as before except for the new date-integrity rule
- supplier lineage begins persisting correctly in SALE_ITEM_LOTS and the repair tool is idempotent
- all targeted and existing regression suites pass on GitHub
