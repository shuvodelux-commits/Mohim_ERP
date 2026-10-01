# SherERP Production Gate Audit — 2026-09-05

## Release scope

Audited source: `9-5-2026 deploy.zip` supplied in this conversation.

Architecture preserved exactly as supplied:

- Google Apps Script V8 application runtime
- Google Sheets persistence
- HTML/CSS/browser JavaScript SPA
- no SQL/transactional-database assumptions introduced

This gate focused on correctness, accounting/stock safety, invoice identity, permissions, cash-session rules, CRUD contracts, UI regressions, and browser behavior. No unrelated feature redesign was performed.

## Critical production defects repaired

### 1. Sequential Invoice ID collision

Root cause: `DocumentProperties` could lag behind imported/restored/sparse Sheet IDs. The previous safeguard used data-row count as a proxy for the highest issued sequence, which is invalid when rows contain sparse IDs such as `INV-000001`, `INV-000002`, `INV-000003`, `INV-000016`.

Fix: `generateId_()` now reconciles the counter against the actual ID column before the first ID in each family is issued during an execution. With a stale counter of 4 and an existing maximum `INV-000016`, the next ID is `INV-000017`.

### 2. Existing duplicate Sales IDs could resolve the wrong customer/invoice

The live data shown during this audit already contains duplicate IDs such as `INV-000005` belonging to different sales. Invoice-linked child sheets are keyed by Invoice ID, so choosing the first matching header can display or mutate another customer's transaction.

Fix: duplicate Sales IDs now fail closed instead of being guessed. Protection covers:

- invoice view/reprint payload
- Sales invoice list/actions
- POS customer phone Sales History
- Sales edit
- Sales delete
- Sales Return search/load/complete
- Sales Report
- Profit Report

The UI visibly marks ambiguous rows as `Duplicate ID` / integrity errors and disables ambiguous actions.

### 3. Cross-date duplicate report contamination

A duplicate header outside the selected reporting range could still share child rows with an in-range invoice because child rows are keyed only by Invoice ID.

Fix: Sales and Profit reports compare selected invoice IDs against the complete active Sales set and stop if an in-scope ID is duplicated anywhere in active Sales.

### 4. Google Sheets time-cell `1899-12-30` serialization

Time-only Sheets cells can serialize as Date values anchored to 1899.

Fix: date/time normalization is now applied in the affected operational surfaces, including Sales detail/history, Sales Return, Purchase Return, Day Book and invoice output.

### 5. Draft Invoice stale counter

Draft numbers used a separate `DocumentProperties` counter and could also be reused after a counter reset.

Fix: draft numbering reconciles both active drafts and immutable draft audit history before issuing the next number.

### 6. Public diagnostics exposure

Apps Script publishes global functions without a trailing underscore to `google.script.run`. Two editor-only diagnostic functions were therefore browser-callable without a business permission path.

Fix: diagnostics are private Apps Script helpers (`diagnoseProject_`, `checkForDuplicates_`) and documentation was updated accordingly.

## Automated source and security inventory

Frozen release inventory:

- 42 Apps Script `.gs` files
- 33 HTML files
- 432 top-level server functions inventoried
- 174 published/non-private server functions audited for server-side authentication/authorization reachability
- 29 routed application pages exercised in Chromium
- 43 high-risk financial/stock mutation paths audited for authorization, ScriptLock, repository mutation and cash-session policy

Static gates include:

- all Apps Script source syntax
- all embedded HTML JavaScript syntax
- duplicate global server functions
- literal frontend RPC target resolution
- executable `Session.getActiveUser()` identity misuse
- merge-conflict artifacts
- CONFIG Sheets/headers/ID-prefix consistency
- literal repository Sheet-key resolution
- 1,000+ literal DOM ID references
- critical financial write ordering
- public RPC authorization reachability
- sales invoice integrity guards
- confirmation-system contract

## Node regression gate

Final frozen-source result:

```text
46/46 Node test files PASS
```

The global confirmation matrix also passes:

```text
85/85 checks PASS
```

Coverage includes existing project suites plus production-gate regressions for:

- sparse/stale Invoice ID counters, using ID-column-only reconciliation to avoid wide full-sheet reads
- duplicate invoice fail-closed behavior
- cross-date duplicate report contamination
- deleted Sales exclusion
- Sales/POS/Return duplicate-ID UI contracts
- Draft Invoice counter integrity with Draft-No-column-only reconciliation
- date/time serialization
- public RPC security
- 43-path CRUD/business-rule matrix
- tablet POS design/responsive contracts
- accounting/settlement/ledger/FIFO/delete regressions already present in the project

## Chromium / Playwright E2E gate

Real headless Chromium was run through Python Playwright using the actual SherERP frontend and a deterministic mocked `google.script.run` backend.

Final result:

```text
54/54 checks PASS
```

The E2E gate includes:

- all 29 routed pages load without uncaught browser/console errors
- POS bootstrap and product add
- customer entry
- financial confirmation modal
- one authoritative `completeSale` RPC
- exact server-returned `INV-000017` rendered in invoice preview
- correct customer rendered with the returned invoice
- POS phone history blocks duplicate `INV-000005`
- Sales list shows both duplicate historical headers but disables their actions
- unique invoice actions remain available
- Sales Return duplicate search does not auto-load an ambiguous invoice
- Draft Save preserves exact cart totals and does not call `completeSale`
- 768x1024 tablet POS remains two-column, has no document horizontal overflow, and uses the collapsed icon rail

Two apparent browser failures found during development, Vendor Workspace and Finance Ledger, were traced to incorrect mock response shapes. They passed with responses shaped like the real server bootstrap. Production code was not modified for those false positives.

## CRUD / business-rule gate

The production matrix audits 43 high-risk mutation paths across:

- Sales create/update/delete
- Purchase create/update/delete
- Sales Return / Purchase Return
- Customer receipt update/delete
- Supplier payment update/delete
- Expense add/update/cancel/delete
- Finance add/update/delete
- Bank transfer/manual entry/reversal/delete
- Vendor payment/receipt/stock issue/return and their update/delete paths
- Stock adjustment
- Cash Session open/close

For applicable posted operations the matrix requires server-side authorization, ScriptLock, repository mutation presence and active-cash-session enforcement. Cash Session open/close are the intentional lifecycle exceptions to the normal active-session posting guard.

Existing regression suites additionally cover FIFO lot planning/application, return amount authority, settlement discounts, backdate policy, inactive parties/roles, delete/reversal dependencies, party-ledger chronology, and stock/accounting consistency contracts.

## Important live-data condition

The application code now prevents new sequential collisions and refuses ambiguous historical IDs. It does **not** silently rename duplicate invoices that already exist in the live Google Sheets.

That is deliberate. Existing child rows in Sale Items, stock lots/movements, customer ledger, cash/bank entries, vendor sourcing and returns can share the duplicated Invoice ID. Renaming only a Sales header would damage accounting integrity.

Before unrestricted use of affected historical invoices/reports, the live duplicate transactions require a separate, data-aware repair against a copy/backup of the actual spreadsheet.

## Runtime-only verification boundary

Local Node and browser tests cannot emulate Google infrastructure faithfully. The following still require a real deployed Apps Script project and test/copy spreadsheet:

- real `LockService` concurrency across simultaneous executions
- actual Google Sheets writes, recalculation and cell typing
- `PropertiesService` persistence across separate deployed executions
- real deployed session/cache behavior and role combinations
- actual cash-session state with live rows
- live FIFO/stock mutations against production-shaped Sheet data
- Drive-backed invoice logo access
- browser print/PDF/JPG output against the deployed Web App
- live duplicate-invoice data repair

No claim in this report treats those items as locally proven.

## Release conclusion

The packaged source passes the local production gate defined for this audit: syntax/static analysis, the complete Node regression suite, confirmation matrix, public-RPC security audit, high-risk CRUD/business-rule matrix, and Playwright/Chromium E2E all pass from the frozen release tree.

Deployment should be performed to a test/copy Apps Script + Google Sheets environment first, followed by the runtime-only acceptance checks above. Existing duplicate invoice data must be repaired separately before those ambiguous historical transactions can be safely edited/returned/reported.
