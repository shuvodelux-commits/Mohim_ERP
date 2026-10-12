# SherERP Project Guide

## 1. Project purpose

SherERP is a Google Apps Script + Google Sheets retail ERP for a hardware/battery-style business.

Current runtime:

```text
Browser HTML/CSS/JavaScript
        ↓
Google Apps Script
        ↓
Google Sheets
```

Long-term target:

```text
Browser
   ↓
FastAPI
   ↓
PostgreSQL
```

The current codebase must remain the source of truth for business behavior until a controlled PostgreSQL migration is performed.

---

## 2. Source tree

### Server-side Apps Script

| File | Responsibility |
|---|---|
| `Code.gs` | Web-app entry point, HTML include helper, spreadsheet menu |
| `Config.gs` | Sheet names, database headers, defaults, application configuration |
| `Database.gs` | Google Sheets repository/data-access helpers |
| `Utils.gs` | Shared validation, formatting, transaction helpers |
| `Auth.gs` | Login, sessions, authentication, permissions, backdating authorization |
| `UI.gs` | Sidebar/navigation definitions and permission-module definitions |
| `Setup.gs` | Initial schema creation and repair |
| `SeedData.gs` | Demo/seed data |
| `Diagnostics.gs` | Runtime diagnostics and schema/function checks |
| `DeleteEngine.gs` | Transaction-aware deletion/reversal logic |
| `CashSession.gs` | Start/close cash session and cash-session calculations |
| `CashBook.gs` | Cash ledger writer and running cash balance |
| `BankBook.gs` | Bank ledger writer and bank balance updates |
| `BankLedger.gs` | Bank ledger views/manual entries/reversals |
| `BankAccounts.gs` | Bank account master management |
| `DayBook.gs` | Combined transaction/day-book reporting |
| `FinanceModule.gs` | Business finance/person transactions |
| `Expense.gs` | Expense transactions |
| `ExpenseSettings.gs` | Expense categories and payee master data |
| `Products.gs` | Product master, stock adjustment, product status |
| `ProductSettings.gs` | Product categories and units |
| `StockLots.gs` | Lot creation, FIFO planning/consumption, lot restoration |
| `Purchase.gs` | Purchase creation |
| `PurchaseManagement.gs` | Purchase history/details/edit |
| `PurchaseReturn.gs` | Purchase return processing |
| `Sales.gs` | POS sale creation |
| `SalesManagement.gs` | Sales history/details/edit |
| `SalesReturn.gs` | Sales return processing |
| `Invoice.gs` | Invoice data assembly |
| `Customer.gs` | Customer master, due, customer payments |
| `Suppliers.gs` | Supplier master, due, supplier payments |
| `Vendors.gs` | Vendor/consignment master and vendor stock flows |
| `Reports.gs` | Business reports |
| `Dashboard.gs` | Dashboard calculations |
| `RoleManagement.gs` | Role creation/edit/status |
| `UserManagement.gs` | User management |
| `Settings.gs` | Application settings |
| `UI.gs` | Navigation and permissions |

### Client-side HTML

| File | Responsibility |
|---|---|
| `index.html` | Main application shell, sidebar, topbar, page containers |
| `javascript.html` | Shared client controller, server calls, navigation, invoice rendering, scrolling |
| `style.html` | Shared application CSS, responsive layout, invoice print CSS |
| `login.html` | Login screen |
| `dashboard.html` | Dashboard |
| `pos.html` | Classic POS/cart runtime and transaction behavior |
| `posv2.html` | SherHisab compact POS V2 presentation; reuses the same `pos.html` DOM/state/handlers |
| `sales.html` | Sales history |
| `returns.html` | Sales return |
| `returnHistory.html` | Return history |
| `purchase.html` | Purchase entry |
| `suppliers.html` | Suppliers |
| `vendors.html` | Vendors |
| `products.html` | Products |
| `customers.html` | Customers |
| `reports.html` | Reports |
| `settings.html` | General settings |
| `invoiceDesign.html` | Invoice design settings |
| `bank.html` | Bank accounts/ledger |
| `expense.html` | Add expense with required Payee selection/quick-add |
| `expenseList.html` | Expense list |
| `expenseLedger.html` | Chronological expense ledger with Payee filter and running total |
| `expenseCategory.html` | Expense categories |
| `expenseReport.html` | Expense report |
| `finance.html` | Business finance |
| `financeLedger.html` | Finance ledger |
| `daybook.html` | Day Book |
| `users.html` | Users |
| `roles.html` | Roles |

---

## 3. Application shell and UI architecture

`index.html` is the single application shell.

```text
#app
├── #sidebar
│   └── #navList
└── .main
    ├── .topbar
    │   ├── menu toggle
    │   ├── page title
    │   ├── calculator toggle
    │   └── refresh button
    └── #content
        ├── #subNav
        └── page sections
```

The pages are included into `index.html` with Apps Script `include()`.

### Desktop shell

Above 860px:

- Sidebar is fixed on the left.
- Topbar is fixed at the top.
- `.content` is the independent scrolling area.
- Horizontal overflow is handled by the content area.
- `#floatingHScroll` mirrors the content horizontal scroll so wide tables can be moved horizontally without reaching the bottom of a long list.

### Mobile shell

At 860px and below:

- Sidebar becomes a drawer.
- Topbar remains normal mobile navigation.
- Content uses mobile padding.
- POS switches to one column.
- Form grids switch to one column.

Do not remove the desktop fixed-shell CSS while changing invoice CSS. These are separate concerns.

### Topbar calculator

`#calcToggleBtn` in the topbar opens `#calcPanel`, a `position: fixed` scratchpad panel defined once in `index.html` (outside `#app`, alongside the toast/loader/print-host overlays) so it is reachable from every page without any page file including it itself.

- Each line is an independently typed expression (`calcLines_` in `javascript.html`), evaluated by a small recursive-descent parser (`calcEvaluate_`) — `+ - * /`, parentheses, and `× ÷ x` as multiply/divide aliases. No `eval()`/`Function()` is used since it parses arbitrary user input.
- Lines are numbered and stay editable; the footer total is the sum of every line that currently evaluates without error.
- The tape persists per-browser in `localStorage` (`hwerp.calc.lines`) with the same try/catch fallback pattern as the session token, so a blocked/unavailable store degrades to a non-persistent scratchpad rather than breaking.
- Purely a client-side scratchpad — it never calls `serverCall`, so it carries none of the transaction-safety/cash-session rules elsewhere in this document.

---


### Shared semantic balance card presentation

Monetary/status card colors use explicit ID-to-business-semantics mappings in
`javascript.html` (`ERP_SEMANTIC_CARDS_`, `ERP_SEMANTIC_DETAILS_`,
`ERP_SEMANTIC_INLINE_`), with shared scoped styles in `style.html`.
Configured card values are observed for display updates without altering
module renderers or transaction data. Green is receivable/incoming/gain,
red is payable/outgoing/cost, and zero or informational values are neutral.
Names such as `Money In`/`Money Out` are reserved for confirmed monetary
movement totals; purchases and sales on credit are not automatically cash flows.
See `docs/erp-semantic-balance-card-audit.md` for all mapped and excluded modules.

## 4. Navigation and permissions

`UI.gs` owns two separate concepts:

### NAV_ITEMS

Presentation/navigation only.

Examples:

```text
Dashboard
POS
Sales
  - Sales Invoice
  - New Return
  - Return History
Purchases
Suppliers
Vendor Ledger
Products
Customers
Bank Accounts
Expenses
Business Finance
Day Book
Reports
Settings
  - General
  - Invoice Design
  - Users
  - Roles
```

### PERMISSION_MODULES

Policy only.

Important distinction:

- Navigation changes must not silently change permissions.
- `returns` remains a distinct permission even though its pages are under Sales.
- Expense child pages, including Expense Ledger, use the `expense` permission.
- Every new Expense selects a Payee. The Expense row stores Payee ID/Name in its existing `Ledger ID` / `Ledger Name` fields; Expense Ledger can filter by that Payee and Day Book shows it as the party.
- Users/Roles are protected by management/admin rules.
- `posCost` is a permission with no page. It grants the right to see one
  extra figure (purchase price) inside POS, not access to anywhere. Only
  its `view` action is ever read.

---

## 5. Database model

Google Sheets acts as the current database.

`Config.gs` is the schema source of truth. `Database.gs` creates/repairs headers and maps object properties to sheet columns.

### Master data

```text
Products
Suppliers
Customers
Vendors
Bank Accounts
Finance Persons
Product Categories
Product Units
Expense Categories
Expense Payees
Users
Roles
Settings
```

### Transaction data

```text
Purchases
Purchase Items

Sales
Sale Items
Sale Item Lots

Sales Return
Sales Return Items

Purchase Return
Purchase Return Items

Expenses
Finance Transactions

Vendor Sourcing
Vendor Ledger
Vendor Returns
Vendor Issues
Vendor Returns Received

Supplier Ledger
Customer Ledger

Cash Book
Cash Sessions

Bank Book
Bank Transfers

Stock Movement
Stock Lots
```

### Security/audit data

```text
Sessions
Logs
Delete Log
Invoice Edit Log
```

---

## 6. Inventory model

Products are NOT linked permanently to suppliers.

A product contains:

```text
Product ID
Product Name
Category
Unit
Barcode
Purchase Price
Selling Price
Current Stock
Minimum Stock
Status
```

A purchase creates stock lots containing supplier history.

```text
Lot ID
Product ID
Product Name
Purchase ID
Purchase Date
Purchase Price
Original Quantity
Remaining Quantity
Status
Created At
Supplier ID
Supplier Name
```

### FIFO

FIFO is implemented in `StockLots.gs`.

Order:

1. Purchase date ascending.
2. Lot ID as same-day tie-breaker.

The sale planner first calculates all lot consumption without writing.

```text
planStockConsumption_()
        ↓
validation complete
        ↓
applyStockConsumption_()
```

This separation is important because the ERP has no general database transaction rollback mechanism.

### Negative stock

If physical lots cannot satisfy the sale, the remaining shortage becomes an `OVERSOLD` lot with negative remaining quantity.

Negative stock is intentional business behavior.

### Returns

Sales returns restore the lots actually consumed by the sale, rather than blindly creating unrelated stock.

---

## 7. Purchase behavior

Purchase flow:

```text
Supplier
   ↓
Any active product
   ↓
Quantity + cost
   ↓
Purchase
   ↓
Product stock increases
   ↓
New stock lot created
   ↓
Stock movement recorded
   ↓
Cash/bank payment and/or supplier due
```

Important:

- Product does not need a supplier link.
- Supplier is stored on the purchase lot/history.
- Backdated purchase date controls FIFO order.
- Purchase validation occurs before the purchase header is written.

---

## 8. POS behavior

POS uses `getPosBootstrap()`.

The bootstrap returns:

```text
Products
Customers
Vendors
Bank accounts
Active cash session
Shop settings
```

Customer data includes:

```text
Name
Phone
Address
Father Name
Current Due
```

A sale:

```text
Customer
   ↓
Cart
   ↓
Quantity/price
   ↓
Discount
   ↓
Payment type
   ↓
Payment method
   ↓
Bank account when applicable
   ↓
Complete Sale
```

The sale server validates the entire cart before the first write.

### Keyboard fast entry

Classic POS and POS V2 share the same cart keyboard flow from `pos.html`:

```text
Enter on POS page background
        ↓
focus Add Product
        ↓
type/search + Enter selected product
        ↓
focus Quantity
        ↓
Enter
        ↓
finish line + focus next Add Product
```

The page-level Enter shortcut is intentionally ignored while focus is already inside an input, textarea, select, button/link, editable control, or while a modal/confirmation overlay is open. This preserves normal form and dialog keyboard behavior.

### Purchase Price Visibility

Lets trusted counter staff see what an item cost while agreeing a price,
without exposing the shop's cost basis to whoever is standing at the
counter. Read-only: it changes nothing about pricing, stock, FIFO, or
accounting, and no cost is ever sent from the cart back to the server.

Two independent gates, both enforced server-side in `getPosBootstrap()`:

```text
Settings → "POS Show Purchase Price" = true      (shop-wide, off by default)
                        AND
role permission posCost:view                     (per role, Roles grid)
                        ↓
       products[].purchasePrice included in the bootstrap payload
```

If either gate fails, `purchasePrice` is **absent from the response
entirely** — not sent and hidden client-side. A user without the right
cannot recover it from the network response or from `posState`. The
payload also carries a `showPurchasePrice` boolean so POS can tell "not
mine to see" apart from "cost is genuinely 0".

The figure shown is `Products.Purchase Price` — the same field the
Products page shows and the same one FIFO falls back to for oversold
lots. It is not the FIFO lot cost, and `Purchase.gs` does not write back
to it, so it is only as current as the last manual product edit.

Display is deliberately discreet. Each cart line renders a small faint
dot next to the unit — no label, no tooltip, and the number is not in the
markup. Clicking the dot looks the cost up from `posState` and shows it
for four seconds; clicking again hides it immediately. Nothing is
readable over a customer's shoulder unless staff deliberately ask for it.

---

### POS V2 presentation

POS V2 is the **only user-facing POS screen**. Classic POS is no longer exposed in sidebar/sub-navigation, mobile navigation, dashboard shortcuts, draft actions, Sales actions, or Day Book edit routes.

The application still intentionally uses **one live POS runtime**. `pos.html` remains the owner of POS state, DOM control IDs, server calls, validation flow, cart behavior, draft/update behavior, shortage handling, and sale completion. `posv2.html` is the presentation/controller layer that activates the SherHisab UI over the shared `#page-pos` runtime.

```text
all normal POS entry points
          ↓
        posv2
          ↓
shared pos.html state + business workflow
```

The legacy route key `pos` remains only as a compatibility alias and is normalized to `posv2`; it must not expose the Classic presentation. `posv2` continues to ride on the existing `pos` permission and does not add a second permission module.

Draft Open/Continue keeps the same Draft ID/version and restores its saved customer, cart, payment, discount, notes and line metadata. Sale Edit/Update keeps the same Invoice ID and posts through `updateSale`. Duplicate Draft/Sale/Invoice clears draft/update identity, restores the copied form snapshot, and posts through normal `completeSale` as a new invoice. Because a duplicate is no longer the source draft, copied lines are normalized to ordinary manual pricing using the copied unit price and a recalculated `qty × unit price` line total; draft-only `fixed` pricing is reserved for an actual opened draft that carries `sourceDraftId`.

The POS V2 Draft Invoices modal mirrors the full Draft Invoices page actions: Open, Duplicate, Print / Preview, Save JPG, and Delete. Delete refreshes both the modal list and POS recent drafts.\n\nTypography rule: the ERP uses the normal sans-serif UI font for numbers, money, IDs, references, dates, calculator values, stock quantities, and other operational values. Monospace fonts are intentionally not loaded or used anywhere in the production HTML.

## 9. Vendor / consignment sourcing

When POS stock is insufficient, a line can be resolved as:

```text
Own FIFO
Vendor Source
Negative Stock
```

Vendor sourcing:

- Applies only to the shortage.
- Stores vendor, quantity and unit cost.
- Creates vendor payable/ledger information.
- Does not pretend vendor-sourced stock was owned inventory.

Vendor Workspace also supports the opposite direction (shop stock given to a vendor):

- **Give Products to Vendor** can contain multiple distinct products in one memo.
- Selecting a product pre-fills Unit Value from the product master Purchase Price; quantity and Unit Value remain editable before posting.
- One shared `Memo ID` groups the per-product `VENDOR_ISSUES` rows while each line keeps its own `Issue ID` for return/stock traceability.
- Posted memos can edit the common date/note plus each line's quantity and Unit Value; edits validate every line before the first write.
- Memo delete reverses every line's stock and vendor receivable together, and is blocked while any active Return Received depends on a line.
- Vendor master Name, Phone and Address are editable without rewriting historical transaction snapshots.

---

## 10. Cash-session rule

The ERP's financial transaction invariant is:

> A transaction requiring the business transaction session must not write anything before an active cash session is confirmed.

Typical sequence:

```text
Lock
 ↓
Authentication
 ↓
Permission
 ↓
Cash-session validation
 ↓
Input/business validation
 ↓
Read/plan calculations
 ↓
WRITE PHASE
```

If validation fails before WRITE PHASE:

```text
No transaction row
No stock change
No lot change
No customer/supplier/vendor balance change
No cash/bank change
```

Current transaction areas include sales, purchases, returns, payments, expenses, finance transactions, vendor flows, stock adjustments and bank transactions.

Master-data edits and pre-ERP financial opening balances can be saved without an active Cash Session. Current-day cash or bank transactions still require the usual session guard.

---

## 11. Payments and financial ledgers

### Cash

`CashBook.gs` is the single cash-book writer.

Cash balance is:

```text
previous balance + credit - debit
```

### Bank

`BankBook.gs` is the single bank-book writer.

For each bank account:

```text
current balance + credit - debit
```

### Customer/Supplier/Vendor

Ledger balances are maintained in their respective master records and ledger sheets.

### Bank transfers

A bank transfer creates:

```text
Bank Transfers header
Bank Book: Transfer Out
Bank Book: Transfer In
```

The transfer uses the application session user for audit identity.

---

## 12. Deletion model

Operational records use soft-delete fields where configured:

```text
Is Deleted
Deleted By
Deleted At
Delete Reason
```

Normal operational lists should exclude deleted records.

Administrator/history views can explicitly include deleted records.

Transaction deletion is not a simple row removal. `DeleteEngine.gs` reverses the associated stock, cash, bank and balance effects where applicable and writes audit information.

---

## 13. Invoice architecture

Invoice data is assembled in `Invoice.gs`.

Invoice rendering is in `javascript.html`.

### Screen invoice

The normal invoice preview uses the existing invoice layout.

### Print invoice

Print rendering uses `renderInvoicePrintHtml_()` so the browser can paginate the complete product table naturally.

Print requirements:

- Header expands with long shop descriptions.
- Customer section stays below the header.
- Product table can flow across physical pages.
- `thead` repeats.
- Product rows avoid splitting where possible.
- Totals/signature/footer remain after the final product.
- Footer is not fixed.
- Print-only CSS does not intentionally alter the normal screen layout.

### Invoice design settings

The current design settings include:

```text
Invoice Shop Description
Invoice Proprietor Name
Invoice Proprietor Paragraph
Invoice Title
Invoice Footer
```

`Invoice Proprietor Paragraph` is rendered below the proprietor name with `<em>` when non-empty.

Customer name remains in the customer section and is displayed with:

```text
নামঃ Customer Name
```

---

## 14. Performance architecture

Current Google Sheets performance strategy:

```text
UI
 ↓
Apps Script service/business logic
 ↓
Database.gs repository helpers
 ↓
Google Sheets
```

Caching is used for frequently read master data.

Avoid:

```text
for every cart line:
    read entire sheet
```

Prefer:

```text
read once
 ↓
index in memory
 ↓
validate/aggregate
 ↓
write batch
```

`completeSale()` and `createPurchase()` already use this pattern for major validation paths.

Long-term PostgreSQL architecture:

```text
UI
 ↓
FastAPI service layer
 ↓
Repository/data-access layer
 ↓
PostgreSQL
```

---

## 15. Important invariants for future development

### Inventory

- One product can have many supplier lots.
- POS does not choose supplier.
- FIFO is across all eligible lots.
- Negative stock is intentional.
- Vendor sourced quantity is not owned stock.
- Product current stock must reconcile with stock movements/lots.

### Transactions

- Validate before the first write.
- Use a script lock for multi-write transactions.
- Never partially write a transaction and then throw a validation error.
- Preserve audit fields.
- Preserve transaction date separately from Created At.

### Permissions

- Authenticate every client-reachable transaction endpoint.
- Check module permission before writes.
- Administrator remains protected.
- Do not derive permissions directly from navigation structure.

### Settings values

- Never test a boolean setting with `value === 'true'`. Booleans are
  written as the strings `'true'`/`'false'`, but Google Sheets auto-types
  a boolean-looking cell, so the value that comes back out of
  `getAllRows_` is often a real JavaScript boolean. Whether a given cell
  is coerced depends on that cell's format, so both types occur on the
  same sheet.
- Use `isSettingEnabled_()` (Utils.gs) server-side. It accepts both
  types and fails closed on blank/missing.
- This is the same class of problem `serializeCellValue_` (Database.gs)
  exists to solve for Dates.

### Deletes

- Require a reason where the delete system applies.
- Do not silently erase financial history.
- Preserve audit information.
- Protect outstanding balances and dependent transactions.
- Read master data for any operational selector with `activeRows_`, never
  `getAllRows_`. Deletion is a SOFT delete: `markRowDeleted_` stamps
  `Is Deleted` and does **not** touch `Status`, so a `Status !== 'Inactive'`
  filter alone still returns deleted rows. This exact slip put deleted
  suppliers in New Purchase, and deleted products/customers in POS.
- A dropdown fix is only half of it. The endpoint that accepts the choice
  must re-check with `activeRows_` too, or a page opened before the delete
  can still post against the deleted record.
- Duplicate-name/uniqueness checks on a soft-deletable sheet must also use
  `activeRows_`, or a deleted record reserves its name forever and the
  name can never be re-used. Applies to SUPPLIERS and PRODUCTS. Safe
  because every lookup in the app resolves by ID, never by name.
- Not every module soft-deletes. `deleteCustomer` (Customer.gs) and the
  Product Categories/Units, Roles and Users paths use a hard `deleteRow_`,
  so their uniqueness checks are unaffected. The sheets that actually get
  `markRowDeleted_` are SALES, PURCHASES, EXPENSES, SUPPLIERS, PRODUCTS,
  FINANCE_TRANSACTIONS, CASH_BOOK, the CUSTOMER/SUPPLIER/VENDOR ledgers
  and the VENDOR_* sheets — CUSTOMERS carries the columns but never
  populates them.

### UI

- Do not break the fixed desktop shell while changing module styles.
- Do not remove the floating horizontal scrollbar.
- Avoid broad CSS selectors that affect unrelated modules.
- Keep mobile drawer behavior intact.

---

## 16. Known audit result from this review

### Fixed during this audit

`BankBook.gs` had a remaining audit-identity inconsistency in `transferBetweenBankAccounts()`:

```text
Session.getActiveUser().getEmail()
```

was used even though the project deliberately uses its own authenticated application session for audit identity.

It was changed to use the authenticated `actingUser` and `actorName_()`.

This is important for web-app deployments where `Session.getActiveUser()` may not provide the application's logged-in staff identity.

### Static review findings

The uploaded project passed:

- JavaScript syntax checks for all embedded client scripts.
- Apps Script source syntax checks using the JavaScript parser.
- Client `serverCall()` reference check.
- Inline event-handler function reference check.
- DOM `getElementById()` reference check.

One comment-only `serverCall('someFunction', ...)` example was found. It is not executed code.

Three DOM IDs referenced by JavaScript were checked:

- `dbMethod`
- `dbShowDeleted`
- `posManageVendorsBtn`

The first two are guarded optional references. `posManageVendorsBtn` is also guarded by a null check in the current version.

### Test limitation

This audit can statically inspect the complete uploaded codebase, but it cannot honestly claim to have executed real Google Apps Script transactions against your live Google Sheet because the uploaded project does not contain the live Spreadsheet runtime/data.

Therefore the following still require a real deployment test:

- Login/session behavior
- Permission enforcement with real users
- Cash-session transaction writes
- FIFO against real lots
- Returns against real history
- Bank/cash ledger totals
- Google Sheets concurrency
- Browser print rendering
- Mobile browser behavior
- Real Google Apps Script quotas/performance

Use `diagnoseProject_()` from `Diagnostics.gs` in the Apps Script editor after deploying to verify the live runtime and sheet schema. The trailing underscore intentionally keeps this diagnostic unavailable to `google.script.run` web clients.

---

## 17. Recommended future bug-fixing workflow

When fixing a bug:

1. Reproduce it.
2. Identify the exact UI event or server endpoint.
3. Trace the complete path from UI → server → repository → sheet.
4. Check related modules for the same pattern.
5. Validate all inputs before the first write.
6. Use `LockService` for multi-write financial/inventory operations.
7. Preserve existing business invariants.
8. Make the smallest possible code change.
9. Run syntax/static checks.
10. Test the affected module.
11. Test at least one related module.
12. Update this document if architecture or business behavior changes.

Never overwrite the whole project with a generated rewrite for a localized bug.

---

## 18. Optional future PostgreSQL migration target (not current SherERP architecture)

SherERP currently remains Google Apps Script + Google Sheets. Do not use this future migration sketch to make current design decisions. If a future migration is explicitly approved, recommended conceptual tables are:

```text
tenants
users
roles
permissions
role_permissions

products
product_categories
product_units

suppliers
customers
vendors

purchases
purchase_items
stock_lots
stock_movements

sales
sale_items
sale_item_lots

sales_returns
sales_return_items
purchase_returns
purchase_return_items

supplier_ledger
customer_ledger
vendor_ledger

expenses
expense_categories
expense_payees

cash_sessions
cash_book

bank_accounts
bank_book
bank_transfers

finance_persons
finance_transactions

invoice_edit_logs
delete_logs
sessions
application_settings
```

The migration must preserve FIFO, negative stock, vendor sourcing, returns, payments, permissions and audit history.

---

## 19. Source-of-truth rules

When future code changes conflict with this document:

1. Current source code is the implementation source of truth.
2. This document is the architectural/behavioral guide.
3. If code changes intentionally alter behavior, update `PROJECT.md` in the same change.
4. Do not silently change business rules while fixing UI or performance issues.

## Smart product search (2026-08-25)

Reusable dependency-free product search is implemented in `javascript.html` and reused by POS, Products/Stock Adjustment, Purchase product picking, and the Vendor product selector. Search uses Product Name, Brand, Category, Barcode, and Unit only. It normalizes Unicode/case/whitespace and Bangla digits, supports multiple partial words in any order, precomputes one search index per loaded product, ranks exact barcode first, then exact name, name prefix, word-prefix and substring matches, and adds only a small in-stock tie-break bonus. POS preserves existing add-to-cart/barcode behavior and adds clear + keyboard result navigation. Product List applies its category/brand filters before search ranking.
## Product stock-value fallback fix (2026-08-26)

`getProductsBootstrap()` still uses FIFO lot value as the primary stock valuation. It now also handles incomplete legacy/opening lot data: positive unpriced `OPENING`, `OPENING-MIGRATION`, `ADJUSTMENT`, or `LEGACY` remaining quantities, plus any positive gap between `Products.Current Stock` and total lot remaining quantity, are valued at the product's current `Purchase Price`. Real purchase lots remain authoritative, including genuine zero-cost purchases. This prevents Product List from showing `0` stock value for positive newly-added/opening stock without changing normal FIFO valuation.


---

## 20. Native transaction Edit/Delete rollback (2026-09-03)

The central revision/job architecture was removed after live workflow testing showed it could diverge from the original module accounting paths. SherERP now has one authoritative path per transaction family again.

- Sales Edit loads `getSaleForUpdate` into the existing POS Update Mode and saves through `updateSale`.
- Purchase Edit loads `getPurchaseForUpdate` into the existing Purchase Update Mode and saves through `updatePurchase`.
- Expense, Customer/Supplier payment, Vendor and Finance edits call their original module handlers directly.
- Customer/Supplier payment deletion restores the total settled amount to the party balance, reverses only the actual Cash/Bank payment amount, soft-deletes the payment row, and is therefore excluded from normal party ledgers and Day Book.
- Day Book owns no accounting mutation logic. Its Delete action calls `deleteDayBookEntry`, which dispatches to the real owning module.
- Bank manual entries retain the native Reverse workflow.
- Return modules keep their original return-specific workflows.

There is no generic transaction correction page, transaction revision/job subsystem, transaction index, shared correction modal, or special central-correction permission. New transaction fixes must extend the owning module's native Edit/Delete/Cancel behavior rather than introducing a parallel accounting route.

The original permission, cash-session, backdate, FIFO/lot, return-dependency, bank-account, soft-delete and audit rules remain authoritative. Google Apps Script + Google Sheets constraints still apply: validate before writing, keep mutations bounded, invalidate caches through the shared database helpers, and avoid SQL transaction assumptions.

## Settlement Discount — Customer Receivable / Supplier Payable

Customer collections and Supplier payments support negotiated settlement discounts without treating the discount as cash.

- Customer example: Due 25,000; Receive 24,000; Discount Given 1,000; balance becomes 0. Cash/Bank increases only 24,000; the 1,000 customer settlement discount reduces profit.
- Supplier example: Payable 30,000; Pay 28,000; Discount Received 2,000; balance becomes 0. Cash/Bank decreases only 28,000; the 2,000 supplier settlement discount increases profit.
- Customer/Supplier payment ledger rows store Payment Amount, Discount Amount and Discount Reason. Credit remains the total settled amount so party running balances reconcile.
- Discount changes require the edit-only Settlement Discount permission. Existing overpayment/advance behavior remains unchanged when Discount is zero.
- Native Customer/Supplier payment Edit/Delete keeps party-balance settlement separate from actual Cash/Bank movement.
- Day Book reports actual money only. Profit reports Customer Discount Given and Supplier Discount Received separately.
- Deployment: run `setupSystem_()` once after upgrading so the additive ledger columns are appended to the live Google Sheets.

## Production audit corrections (2026-09-05)

- Document ID counters reconcile against existing sheet IDs; invalid
  PropertiesService counter values reset to the sheet maximum before use.
- Duplicate Sales invoice IDs fail closed in invoice actions, returns, customer
  ledgers, Day Book, Sales reports, and Profit reports, including duplicates in
  deleted historical rows.
- Sales update, return, and delete derive owned-stock effects from
  `SALE_ITEM_LOTS`; later vendor-sourcing edits cannot create owned stock.
- Cash balance is the sum of active Cash Book movements. A first Cash Session
  creates a baseline only when no pre-ERP historical opening has already seeded
  the book; later sessions write a zero-value boundary marker.
- Pre-ERP customer, supplier, owner, lender and borrower opening balances post
  signed `Historical Opening` Cash Book rows with stable `OPEN:type:id`
  references. Positive customer/borrower amounts reduce the brought-forward
  cash position; positive supplier/lender/owner amounts increase it; signed
  advances reverse the direction. This is a **historical cash baseline**
  adjustment, not a current-day receipt or payment.
- Historical opening rows never contribute to Cash Session cash-in/cash-out or
  the expected physical till total, even if recorded after Start Day. Finance
  opening entries remain non-cash in Day Book turnover. Edit replaces the old
  historical entry, while eligible delete reverses it. Bank-account opening
  balances remain in the corresponding Bank Book/account baseline without
  requiring the current Cash Session.
- Existing opening balances entered before this upgrade are **not** silently
  backfilled, because prior Cash Session opening counts and bank openings may
  already contain these amounts. Reconcile the go-live baseline before any
  one-time historical migration to avoid double counting.
- Ambiguous legacy customer/supplier payment book references must be repaired
  before edit/delete; reversal never guesses between same-value movements.
- Deleted expenses and sales cannot re-enter native update/cancel paths, and
  purchase product validation completes before the first transaction write.
- Malformed session expiry values fail closed, Administrator credentials remain
  Administrator-controlled, and Administrator status changes are serialized.

## Calculation and Sheets performance corrections (2026-09-08)

- Dashboard receivables/payables exclude soft-deleted masters, and Today's
  Expense excludes cancelled transactions.
- Sales, purchase, finance, bank and Day Book currency totals round through the
  shared two-decimal money helper.
- Profit COGS combines owned FIFO evidence from `SALE_ITEM_LOTS` with active
  vendor-shortage costs from `VENDOR_SOURCING`. Coverage now requires cost
  evidence for each product's complete net sold quantity. Vendor-sourcing
  writes invalidate the derived profit cache so those costs cannot stay stale.
- Cash/Bank reports rebuild dated opening and closing balances from live
  chronological movements. Delete-voided bank rows are excluded; both sides of
  a manual reversal pair remain for a net-zero audit trail.
- Day Book recomputes running cash from live movements, shows each bank transfer
  once, preserves manual reversal pairs, separates role-dependent cache entries,
  and reuses its Supplier Ledger read. Cash-session opening/closing reconciliation
  is deliberately excluded from Day Book rows and Day Book Cash In/Cash Out totals.
  The Cash Book stores posting time in `Created At` separately from its
  backdatable business `Date`. Day Book uses that posting time; for legacy
  date-only Cash Book entries, it aligns an entry with the owning transaction
  by reference (including exact-second ties). Unmatched old date-only movements
  cannot have their precise intra-day order reconstructed and retain a
  date-level fallback.
- Cash Reconciliation is a dedicated cash-session audit/explanation module. It
  compares each session's opening count with the previous closed count and the
  closing expected amount with the closing count. A non-zero difference shows a
  short action such as `Record Cash Out ৳10,000` or `Record Cash In ৳5,000`.
  The real Cash In/Cash Out must be recorded through its owning ERP workflow.
  The user then links one or multiple real Cash Book entries whose direction and
  combined amount exactly explain the difference; the status becomes `Explained`.
  Edited/deleted or otherwise inconsistent linked entries become `Needs Review`.
  A Cash Book entry cannot explain two reconciliation differences.
- Legacy automatic `Session Open` / `Day Close Adjustment` movements are
  neutralized only after a complete real explanation is linked, preventing the
  real ERP transaction from being double-counted while retaining the audit row.
- Bank transfers reuse one `BANK_ACCOUNTS` read and reject inactive accounts.
  New and edited Finance entries reject inactive persons. Finance create/edit rejects
  sub-cent amounts that round below 0.01 before any write.
- Cash Session opening, summary and close calculations use two-decimal money
  values and reuse one preloaded read of each required sheet. The first-ever
  session establishes the initial cash baseline once; later `Session Open`
  rows are zero-value boundary markers. Start Day and Close Day never block on
  unresolved reconciliation differences, and Close Day no longer manufactures
  a synthetic adjustment. Real transactions linked as reconciliation catch-up
  entries are excluded from active-session Cash In/Cash Out totals so they do
  not distort that session's expected cash. Recoverable `Starting` / `Closing`
  states still protect interrupted session writes. Retry refreshes `CASH_BOOK`
  after uncertain writes and preserves the originally
  confirmed opening/count amount, and rejects a different retry amount instead
  of silently changing or ignoring the user's confirmation. Pending close
  summaries also restore the saved note, while an explicitly edited retry note
  becomes the final session note. Repository append
  cache invalidation runs even when Sheets reports an unknown write result.
  Repository failures propagate to POS instead of looking like a closed drawer,
  and POS displays the automatic opening-adjustment mismatch without asking the
  user to post the same difference a second time.

## Multi-invoice Sales Return batches (2026-09-21)

SherERP can group several Sales Returns for the same customer into one operator workflow without changing the accounting identity of any source invoice.

- A batch is presentation/audit metadata only. `SALES_RETURN.Batch ID` groups child returns; every child keeps its own `Return ID` and one source `Invoice ID`.
- Batch mode accepts 2–20 unique invoices, at most 100 selected return lines, and requires one identical non-empty Customer ID. Walk-in invoices continue through the existing single-invoice return flow.
- Version 1 uses one refund method for the whole batch: Cash or Store Credit. Mixed methods are intentionally not supported.
- Cash refund eligibility remains invoice-specific. Cash collected on one invoice can never authorize a refund against another invoice.
- Store Credit posts one `Sales Return Credit` Customer Ledger row per child Return ID. Customer settlement therefore preserves the existing `Return ID -> Invoice ID` mapping and applies credit to its source invoice first.
- All selected children are prepared and validated under one ScriptLock before the first return/stock/ledger write. Product stock and lot-restoration planning use shared virtual running state so the same product or stock lot can be returned from several invoices without stale overwrites.
- The write phase creates one native Sales Return header/items set, Stock Movement set, and Cash Book or Customer Ledger effect per child Return ID. Batch ID is never used as the accounting reference.
- Return Date cannot be earlier than the source Sale Date. In batch mode the common return date must therefore be on or after every selected invoice date. Existing backdate permission/reason rules still apply relative to today.
- `SALE_ITEM_LOTS` now persists `Supplier ID`, which `Sales.gs` already supplied in row objects. `repairSaleItemLotSupplierIds_()` can idempotently fill historical blank supplier lineage from the matching `STOCK_LOTS.Lot ID` without overwriting existing values.
- Google Sheets does not provide SQL-style rollback. Business-rule rejection is guaranteed before the first write, and every committed child remains an independently valid/auditable Sales Return if an external Apps Script/Sheets failure interrupts the write phase.
- Sales/Profit reports continue attributing return economics to each source invoice; Cash Book/Day Book continue using each child Return ID and actual return date. Batch metadata does not change those calculations.

## Customer-first multi-invoice Sales Return picker and editable Return Price (2026-09-21)

The accounting-safe multi-invoice Sales Return workflow now has two entry paths:

- **Find Invoice** remains the fast single-invoice return path.
- **Find Customer** is the dedicated multi-invoice path. The operator searches by Customer ID, name, or phone, opens the customer, sees that customer's sales invoices in a Sales-style list, selects one or more invoices, then opens the selected invoice(s) in the Return Cart. Multi-invoice selection therefore cannot accidentally mix customers.

The Return Cart now allows **Return Price** to be edited per product line for both single and batch returns. The displayed/default price is the source invoice's effective post-discount unit price. The browser sends the requested price, but the server remains authoritative: the requested price must be finite and non-negative, cannot exceed that source invoice's effective post-discount sale price, and the stored line total is still capped by the remaining returnable economic value after prior returns. A missing price from a stale browser defaults to the full effective invoice price for backward compatibility.

Batch accounting is unchanged: each selected invoice creates its own Sales Return ID, cash refund capacity is checked per invoice, Store Credit remains linked Return ID -> source Invoice ID, and Batch ID is grouping/audit metadata only.

## Internal Stock Lot Cost Correction (2026-09-22)

`OPENING`, `OPENING-MIGRATION`, `ADJUSTMENT`, `LEGACY`, `OPENING-*`, and `ADJUSTMENT-*` lots are internal inventory sources. If historical setup or adjustment data left one of these lots with a blank/zero Purchase Price, Products can correct that lot cost without editing the original sale or any Purchase Invoice.

- The correction updates only `STOCK_LOTS.Purchase Price` and exact matching `SALE_ITEM_LOTS.Unit Cost` rows for the same Lot ID.
- Historical linkage is **exact Lot ID only**. Blank or ambiguous historical Lot IDs are never guessed from Product ID, invoice date, current FIFO state, or remaining stock.
- Historical Sales revenue, Sales quantity, Customer Due, Cash/Bank, Supplier balances, Stock quantity, and FIFO date/order do not change.
- Profit and COGS recalculate from the corrected `SALE_ITEM_LOTS.Unit Cost`; remaining inventory valuation and future FIFO COGS use the corrected `STOCK_LOTS.Purchase Price`.
- Every accepted correction requires a reason and appends one row to `Stock Lot Cost Corrections` for audit.
- Normal Purchase-origin lots are not eligible here; their cost remains controlled through Purchase Edit.
- Positive Opening Stock requires Product Purchase Price > 0. Positive manual Stock Adjustment and Product-edit stock increases also require Purchase Price > 0 before any new internal lot is written.
- Opening-lot migration skips and reports positive-stock products whose Purchase Price is missing/zero instead of silently creating another zero-cost lot.
- Google Sheets still has no SQL-style rollback. SherERP validates the full selected correction batch before the first business write, then applies deterministic bounded writes under one ScriptLock.

Deployment note: run `setupSystem_()` once after installing this version so the additive `Stock Lot Cost Corrections` audit sheet/header schema is available before using the correction workflow.
### Historical party opening cash migration (2026-10-10)

Opening Customer/Supplier and Finance Person balances are legacy obligations
from before adopting the ERP, but also now seed the running ERP cash baseline
using auditable cash-book references. They do **not** represent money received
or paid during the current session. Never infer a duplicate historical cash
movement from the same invoice/payment, and never silently re-seed old records.
