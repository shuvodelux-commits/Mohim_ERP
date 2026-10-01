# AGENTS.md

## SherERP AI Development Guide

This file is for Codex or other coding agents working on this repository.

---

## 1. What this project is

SherERP is a Google Apps Script + Google Sheets retail ERP.

Current stack:

- Google Apps Script V8
- HTML
- CSS
- Browser JavaScript
- Google Sheets as database

Target architecture later:

```text
Frontend → FastAPI → PostgreSQL
```

Do not migrate the system while performing ordinary bug fixes unless explicitly requested.

---

## 2. First rule: preserve business behavior

Before changing code, understand the existing business rule.

Critical rules:

- Products are not permanently linked to suppliers.
- Purchases create supplier-specific stock lots.
- POS sells by product, not supplier.
- FIFO is across all supplier lots.
- Negative stock sales are allowed.
- Vendor/consignment sourcing handles shortages separately from owned inventory.
- Returns must restore/reverse the actual transaction effects.
- Financial transactions require an active cash session under the project's transaction policy.
- Validation must happen before the first write.
- Administrator and permission protections must remain intact.
- Deleted records must not reappear in normal operational selectors.

Do not replace these rules with a simpler model just because it is easier to code.

---

## 3. Repository/data-access rule

`Database.gs` is the main Google Sheets repository layer.

Prefer:

```text
UI
 ↓
business/service function
 ↓
Database.gs helpers
 ↓
Google Sheets
```

Avoid scattering raw `SpreadsheetApp` operations through UI code.

Avoid repeated full-sheet reads inside loops.

For a multi-line transaction:

```text
read required data once
 ↓
build indexes
 ↓
validate entire request
 ↓
write
```

---

## 4. Transaction safety

This ERP has no general database transaction rollback equivalent to PostgreSQL.

Therefore:

### Validation phase

May:

- authenticate
- check permission
- check cash session
- read sheets
- calculate totals
- validate stock
- plan FIFO
- validate bank account
- validate dates
- validate dependencies

Must NOT:

- append transaction rows
- change product stock
- change lots
- change customer/supplier/vendor balances
- write cash/bank ledger entries

### Write phase

Only begin after all rejectable validation is complete.

Use `LockService.getScriptLock()` for multi-write operations.

---

## 5. Inventory rules

`StockLots.gs` is critical.

Use:

```text
planStockConsumption_()
```

for read-only FIFO planning.

Use:

```text
applyStockConsumption_()
```

only after validation.

Do not mutate stock during planning.

FIFO order:

1. Purchase Date ascending.
2. Lot ID ascending for same-date lots.

Do not reintroduce supplier selection into POS.

Negative stock is represented through an `OVERSOLD` lot.

---

## 6. Cash session

Use:

```text
requireActiveCashSession_()
```

before transaction writes where the project's cash-session policy applies.

The required order is:

```text
permission
cash session
validation
write
```

Do not move the cash-session check after a write.

---

## 7. Permissions

Use:

```text
requirePermission_(token, module, action)
```

for normal module authorization.

Use the project's management/delete permission helpers where applicable.

Do not assume navigation visibility is authorization.

`UI.gs` intentionally separates:

```text
NAV_ITEMS
PERMISSION_MODULES
```

Preserve that separation.

Never allow a non-Administrator to create another Administrator role.

Do not remove last-Administrator protection.

---

## 8. Authentication

The application has its own session system in `Auth.gs`.

Use the authenticated application user for audit identity.

Do not introduce:

```javascript
Session.getActiveUser().getEmail()
```

as a replacement for the app's logged-in user identity in transaction audit fields.

Use the existing actor helpers, such as:

```text
actorName_()
```

where appropriate.

---

## 9. Delete system

Deletion is transaction-aware.

Before adding a new delete path:

- Check whether the record has financial effects.
- Check stock effects.
- Check dependent records.
- Require a reason when the delete system requires one.
- Reverse related effects correctly.
- Preserve audit history.
- Protect outstanding balances.

Do not simply call `deleteRow_()` on financial transaction records.

---

## 10. UI architecture

`index.html` is the shared shell.

Important IDs/classes:

```text
#app
#sidebar
.nav-list
.main
.topbar
#content
#subNav
#refreshBtn
#floatingHScroll
#floatingHScrollInner
#printHost
```

### Desktop shell

Above 860px:

```text
fixed sidebar
fixed topbar
scrolling content
floating horizontal scrollbar
```

Do not remove or broadly override these rules when changing module CSS.

### Mobile

Below 860px:

```text
sidebar drawer
single-column POS
single-column forms
```

---

## 11. Floating horizontal scrollbar

The user specifically needs a desktop solution for wide tables.

The implementation is split across:

```text
index.html
style.html
javascript.html
```

`#floatingHScroll` mirrors `.content.scrollLeft`.

When modifying tables:

- Do not disable `.content` horizontal overflow.
- Do not remove the floating scrollbar.
- Keep the synchronization logic intact.
- If a module creates another horizontal scroll container, verify which element should be synchronized.

---

## 12. POS rules

`pos.html` is sensitive because many controls are wired by `javascript.html` and/or its local script.

Do not remove an element that JavaScript expects without also updating its event wiring.

Optional DOM elements must use null-safe checks.

POS must support:

- Customer selection
- Customer due display
- Father Name/address expansion
- Cart quantity editing
- Price editing
- Discount
- Amount received
- Payment method
- Bank account selection for bank/mobile-bank payment where required
- Own stock
- Vendor sourcing
- Negative stock
- Complete sale
- Automatic calculation refresh

A JavaScript exception in POS initialization can disable many apparently unrelated controls, so check the browser console first.

---

## 13. Invoice rules

Invoice rendering is shared through `Invoice.gs` and `javascript.html`.

Current design requirements:

- Customer remains in customer information section.
- Customer label is `নামঃ`.
- Billed-to block is removed.
- Proprietor Name remains where designed.
- Proprietor Paragraph is configured under Settings → Invoice Design → Shop Identity.
- Proprietor Paragraph renders under the proprietor name using `<em>` when non-empty.
- Shop description must expand naturally.
- `.inv-header-side` aligns to the bottom/right without breaking the header.
- Print must not use a fixed footer.
- Product table must naturally paginate.
- `thead` should repeat on printed pages.
- Product rows should avoid splitting.
- Signature/footer follows the complete product list.
- Short invoices should remain one page when they fit.

Do not reintroduce fixed invoice heights or fixed footer positioning.

---

## 14. Settings / invoice design

Invoice design settings are stored in the Settings sheet.

Important keys include:

```text
Invoice Shop Description
Invoice Footer
Invoice Proprietor Name
Invoice Proprietor Paragraph
Invoice Title
```

If changing invoice settings:

- Update `invoiceDesign.html`.
- Update server-side settings validation if needed.
- Update `Invoice.gs` if the setting changes invoice data.
- Update `javascript.html` renderer.
- Update `style.html` only for presentation.

Do not remove `Invoice Proprietor Paragraph`.

---

## 15. Performance

Current performance improvements include:

- master-data caching
- batch reads
- in-memory indexes
- FIFO planning from a preloaded lot set
- reduced per-line reads

Do not optimize by blindly caching transaction-heavy data.

Freshness matters for:

- stock
- cash
- bank balances
- customer due
- supplier due
- vendor balances
- active cash session

Future large-scale optimization should introduce a clearer repository/indexing strategy, then PostgreSQL.

---

## 16. Code-change workflow

For every bug:

1. Reproduce.
2. Find the client event.
3. Find the server endpoint.
4. Trace the repository operations.
5. Check related modules for the same bug pattern.
6. Make the smallest safe change.
7. Preserve existing business rules.
8. Run syntax checks.
9. Run static reference checks.
10. Test the affected module.
11. Test adjacent transaction paths.
12. Update `PROJECT.md` when architecture/behavior changes.

Do not replace the whole project with generated code.

---

## 17. Testing expectations

At minimum, static checks should include:

### Client JavaScript

```text
node --check
```

on all embedded scripts extracted from HTML.

### Apps Script source

Copy `.gs` files to temporary `.js` files and run:

```text
node --check
```

This checks JavaScript syntax only. It does not emulate Google Apps Script services.

### Reference checks

Verify:

- every `serverCall('functionName')` has a server function
- inline event handlers refer to defined client functions
- `getElementById()` references are either present or intentionally optional
- no accidental duplicate function/global declarations
- configuration sheet names and headers are internally consistent

### Runtime testing

A real Apps Script deployment is required for:

- Google Sheets writes
- permissions
- session handling
- cash session enforcement
- LockService behavior
- actual FIFO stock
- reports
- print/PDF behavior in Chrome
- mobile UI

Never claim those runtime tests were performed if only static source analysis was possible.

---

## 18. File delivery rule

For normal bug fixes:

- Return only changed files.
- Do not return the entire ERP ZIP unless explicitly requested.
- If multiple files changed, provide a small ZIP containing only changed files.

For architecture documentation requests, `PROJECT.md` and `AGENTS.md` should be updated together when appropriate.

---

## 19. Current known audit correction

During the latest full static audit, `BankBook.gs` contained one audit-identity inconsistency in `transferBetweenBankAccounts()`.

Old behavior:

```javascript
Session.getActiveUser().getEmail()
```

Correct behavior:

```text
authenticated application user
        ↓
actorName_(actingUser)
```

This correction has been applied.

---

## 20. Do not make these mistakes

Never:

- move customer information into the invoice header without an explicit request
- remove the proprietor paragraph setting
- restore the old fixed invoice header height
- use a fixed footer for invoice printing
- remove the desktop fixed sidebar/topbar
- remove the floating horizontal scrollbar
- add supplier selection to POS
- write stock before validating the whole transaction
- write cash/bank entries before transaction validation
- use `Session.getActiveUser()` for app-staff identity
- return the entire project for a small fix
- silently change business behavior while performing a UI change

---

## 21. Native transaction action invariants (2026-09-03 rollback)

SherERP does **not** use a central revision/job workflow. The authoritative transaction lifecycle is the native workflow already owned by each module.

- Sales: `getSaleForUpdate` -> existing POS Update Mode -> `updateSale`; deletion uses the native sales delete/reversal path.
- Purchases: `getPurchaseForUpdate` -> existing Purchase Update Mode -> `updatePurchase`; deletion uses `deletePurchase`.
- Expenses: existing Expense edit form -> `updateExpense`; deletion/cancellation uses the native Expense/Delete Engine rules.
- Customer and Supplier payment rows: native `get*PaymentForEdit`, `update*Payment`, and `delete*Payment` handlers. Settlement Discount remains part of these native handlers.
- Vendor and Finance transaction actions use their module-native get/update/delete handlers.
- Day Book is orchestration only: Delete dispatches to the owning module through `deleteDayBookEntry`; it never maintains a second accounting state.
- Bank manual entries continue to use their native Reverse behavior.
- Sales Return / Purchase Return keep their existing return workflows; no generic transaction editor is layered on top.

### Safety rules

- Native create/edit/delete operations continue to enforce their normal permission, active Cash Session, date-window, stock/FIFO, linked-return, bank-account, and dependency guards.
- Delete means the module's existing audited soft-delete/reversal behavior. It must reverse stock, cash/bank and party balances exactly once and mark the source row deleted so normal ledgers and Day Book exclude it.
- Do not add a second correction API, revision store, transaction-index search layer, generic correction modal, or alternate Save/Delete route.
- If a new edit/delete requirement is needed, extend the owning module's existing handler and regression tests instead of introducing a parallel transaction engine.

### Google Apps Script / Sheets constraint

All accounting decisions must remain optimized for Google Apps Script + Google Sheets. Validate before the first write, hold ScriptLock only across the necessary mutation window, use the shared data-access/cache invalidation helpers, and avoid SQL-style transaction assumptions.
