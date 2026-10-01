# SherERP Draft Invoice Design

**Date:** 2026-09-05  
**Status:** Approved for implementation planning  
**Project:** SherERP v3  
**Runtime:** Google Apps Script V8  
**Database:** Google Sheets  
**Baseline:** 2026-09-04 SherERP Apps Script package after Counter quick-add fixes

## 1. Goal

Add a first-class **Draft Invoice** workflow to POS so staff can prepare an unfinished sale, save it, continue with other customers, reopen it later, and finally post it through SherERP's existing sale engine.

A draft is **not a sale** and has **zero accounting or inventory effect**.

Canonical lifecycle:

```text
POS cart
  -> Save Draft
  -> Draft Invoices list
  -> Open Draft in normal POS
  -> Review / edit
  -> Existing Complete Sale flow
  -> Existing confirmation dialog
  -> Existing completeSale() posting
  -> Successful real invoice
  -> Draft removed
```

The feature must not create a second accounting, stock, ledger, cash, bank, customer-due, or invoice-posting path.

---

## 2. Approved Product Decisions

The following decisions are fixed for V1.

1. **Drafts do not reserve stock.**
2. **Draft numbering is separate from real invoice numbering.** A real `INV-...` number is created only when posting succeeds.
3. **Saving is manual only.** No background autosave and no periodic Apps Script writes.
4. Drafts live in a dedicated **Draft Invoices** section inside the existing Sales/POS workflow.
5. **Saved prices and discounts are preserved exactly.** Reopening a draft must not silently replace them with current selling prices.
6. Intended payment inputs are saved, but remain financially inactive until posting.
7. A draft may be incomplete. The only minimum requirement is **at least one product line**.
8. Normal users/cashiers manage **their own drafts**. Management users may manage **all drafts** through existing permissions, without hard-coding role names.
9. Drafts remain until explicitly deleted or successfully posted. There is no automatic expiry.
10. Posting requires opening the draft in the normal POS, reviewing it, and using the existing Complete Sale flow. There is no one-click posting from the list.
11. After a successful real sale, the active draft row is removed. Permanent evidence remains in the real invoice and draft audit log.
12. Drafts can be printed/exported with an unmistakable **DRAFT / খসড়া** marker and no real invoice number.
13. Concurrent edits use optimistic version checking. Stale saves are refused instead of silently overwriting newer work.
14. Serial/warranty selections, when present in the POS line model, are stored as intended selections only and never reserve stock or serials.

---

## 3. Non-Negotiable Accounting Boundary

### 3.1 Saving a draft must not call transaction writers

Draft functions must never directly or indirectly mutate:

- `SALES`
- `SALE_ITEMS`
- `SALE_ITEM_LOTS`
- `STOCK_MOVEMENT`
- `PRODUCTS.Current Stock`
- stock lots / FIFO quantities
- `CUSTOMER_LEDGER`
- customer `Current Due`
- `CASH_BOOK`
- `BANK_BOOK`
- vendor sourcing / vendor ledger
- Day Book sources
- reports or dashboard financial facts

Draft save/update/delete must **not** call:

- `completeSale()`
- `applyStockConsumption_()`
- `addCashBookEntry_()`
- `addBankBookEntry_()`
- `postVendorLedgerEntry_()`
- `requireActiveCashSession_()`

A user is allowed to save a draft even when no cash session is open because a draft does not move money or stock.

### 3.2 Posting remains authoritative in `completeSale()`

The current `completeSale(token, payload)` implementation remains the only sale-creation path. It continues to own:

- `pos.add` authorization;
- active cash-session enforcement;
- product existence validation;
- duplicate-product rejection;
- FIFO planning and consumption;
- negative-stock behavior;
- vendor/consignment shortage resolution;
- automatic/manual price validation;
- customer creation/lookup;
- discount and grand-total calculation;
- payment type and due calculation;
- bank/mobile-banking account validation;
- backdating validation;
- sale and sale-item writes;
- stock movements and lot consumption;
- vendor sourcing effects;
- cash/bank effects;
- customer due and ledger effects;
- final invoice payload.

Draft-to-sale conversion only supplies a reviewed POS payload plus a validated source-draft identity.

---

## 4. Data Model

### 4.1 Draft sheet

Add one temporary working-data sheet:

```text
Draft Invoices
```

Suggested configuration key:

```js
SALES_DRAFTS: 'Draft Invoices'
```

One draft occupies exactly one row.

Recommended headers:

```text
Draft ID
Draft No
Draft Date
Customer ID
Customer Name
Customer Phone
Customer Father Name
Customer Address
Items JSON
Payment JSON
Notes
Subtotal
Discount
Grand Total
Created By ID
Created By Name
Created At
Updated By ID
Updated By Name
Updated At
Version
```

List-screen scalar values such as customer, total, creator and update time remain in ordinary columns so listing drafts does not require parsing every JSON cell.

### 4.2 Stable technical ID and display number

Use two identities:

- `Draft ID`: stable internal key, e.g. `DRF-000001`, generated with SherERP's existing ID machinery.
- `Draft No`: human-facing number, e.g. `DRAFT-2026-0001`.

`Draft No` uses a server-side year-specific counter stored in `PropertiesService` and generated while holding the script lock. It is display/audit identity only.

Real invoice numbering remains unchanged. A draft never consumes an `INV-...` number.

### 4.3 Items JSON

`Items JSON` stores the cart snapshot required to reconstruct POS without normalizing every line into a second sheet.

Each line stores the minimum useful shape:

```js
{
  productId,
  name,
  unit,
  qty,
  unitPrice,
  lineTotal,
  savedPriceMode,
  shortageResolution,
  vendorId,
  vendorName,
  vendorUnitCost,
  serialSelections,   // optional when serial support exists
  warrantyData        // optional when the POS line model carries it
}
```

Rules:

- Draft storage never trusts these values as posting authority.
- `lineTotal` and header totals are saved snapshots for faithful reload/list display.
- Product IDs remain the identity used for revalidation.
- Optional serial/warranty data is informational/intended until the real posting path validates it.
- The current source baseline has no serial-specific POS payload. Therefore V1 code must keep those fields optional and must not invent stock/serial reservation behavior.

### 4.4 Payment JSON

Store the **user's intended input state**, not a financial transaction:

```js
{
  amountReceived,
  paymentMethod,
  bankAccountId
}
```

Derived values such as `paymentType`, `paidAmount`, `dueAmount`, and `change` are recalculated by the POS when reopened and again by `completeSale()` at posting.

This prevents stale derived payment values when draft items or discount are edited.

### 4.5 JSON size guard

Google Sheets has a per-cell character ceiling. Draft JSON must therefore be compact and bounded.

Before writing:

1. `JSON.stringify()` the items/payment payload.
2. Reject an abnormally large draft before the Sheet write with a clear message.
3. Use a conservative application limit below the Sheets cell maximum so one oversized draft cannot be truncated or lost.

Do not split normal draft items across a second sheet in V1 merely to avoid this edge case.

---

## 5. Draft Audit Trail

Because the active draft row is intentionally removed after successful posting, create a small append-only audit sheet:

```text
Draft Invoice Audit
```

Suggested key:

```js
SALES_DRAFT_AUDIT: 'Draft Invoice Audit'
```

Headers:

```text
Audit ID
Timestamp
Action
Draft ID
Draft No
Version
Actor ID
Actor Name
Source Owner ID
Invoice ID
Note
```

Required actions:

- `CREATED`
- `UPDATED`
- `DELETED`
- `POSTED`
- `POST_CLEANUP_RETRY` when an already-posted source draft is found and cleanup is retried

The audit sheet contains no financial amount authority. It is evidence of draft workflow only.

---

## 6. Permissions and Ownership

Do not create a new role-name check for `Manager` or `Owner`. SherERP roles are configurable and only `Administrator` is structurally special.

Use existing permission semantics:

### 6.1 Own-draft capability

A user with:

```text
pos.add
```

may:

- create a draft;
- list their own drafts;
- open their own draft;
- update their own draft;
- delete their own draft.

### 6.2 Manage-all capability

A user with:

```text
sales.edit
```

or an Administrator may:

- list all drafts;
- preview any draft;
- delete any draft;
- update any draft when the POS editor is reachable.

Because V1 edits drafts only inside the existing POS screen, actually opening/editing a draft in POS also requires `pos.view` so `getPosBootstrap()` and POS routing remain protected exactly as they are today. Posting additionally requires `pos.add`.

This is the permission-level implementation of the approved “Manager/Owner can manage all” rule without hard-coding role labels.

### 6.3 Posting capability

Posting a draft still requires:

```text
pos.add
```

because `completeSale()` already enforces it.

A manager with `sales.edit` but no `pos.add` may list/preview/delete all drafts. If that user also has `pos.view`, they may open and edit drafts in POS. They still cannot turn a draft into a sale without `pos.add`.

### 6.4 Server-side ownership check

Every draft endpoint must resolve the authenticated user and verify either:

```text
row.Created By ID == acting user ID
```

or manage-all capability.

Client-side filtering is convenience only, never authorization.

---

## 7. Server API

Create a focused server module:

```text
DraftSales.gs
```

It owns only draft persistence/read models and draft-post linkage. It performs no accounting writes.

### 7.1 `saveSalesDraft(token, payload)`

Creates a new draft.

Validation before write:

- `pos.add` permission;
- payload exists;
- at least one item;
- each item has a nonblank product ID/name, quantity > 0, and a finite nonnegative saved price;
- serialized JSON is below the application size guard;
- scalar totals are finite and nonnegative.

It does **not** require:

- customer name/phone;
- payment completion;
- bank account validity;
- active cash session;
- current stock availability;
- FIFO planning;
- vendor availability;
- backdate permission.

Creation uses one script lock, assigns IDs/version `1`, appends the row, appends `CREATED` audit, then returns the saved draft identity/version.

### 7.2 `updateSalesDraft(token, draftId, expectedVersion, payload)`

Under one script lock:

1. authenticate;
2. load draft;
3. verify ownership/manage-all access;
4. compare stored `Version` to `expectedVersion`;
5. validate the new draft shape;
6. update only the draft row;
7. increment Version;
8. append `UPDATED` audit.

If versions differ, fail with:

```text
This draft was changed by another user. Reload the latest version.
```

No “last writer wins” behavior is allowed.

### 7.3 `getSalesDraftList(token)`

Return lightweight list rows only:

```js
{
  draftId,
  draftNo,
  draftDate,
  customerName,
  customerPhone,
  subtotal,
  discount,
  grandTotal,
  createdById,
  createdByName,
  createdAt,
  updatedByName,
  updatedAt,
  version,
  mine,
  canManage
}
```

- Own-draft users receive only their rows.
- Manage-all users receive all rows.
- Do not parse `Items JSON` for the list.
- Sort newest updated first in memory.

### 7.4 `getSalesDraft(token, draftId)`

Return the full draft after ownership/manage-all authorization.

The response includes:

- parsed item/payment state;
- stored version;
- whether the caller can manage it;
- current product availability metadata needed to warn about stale/missing products where practical.

The final posting validation remains in `completeSale()`.

### 7.5 `deleteSalesDraft(token, draftId, expectedVersion, reason)`

Under one script lock:

1. authenticate;
2. verify access;
3. verify version;
4. append `DELETED` audit;
5. hard-delete the temporary draft row.

A draft has no accounting or stock effect, so no financial reversal path is needed.

Delete confirmation is client-side through the approved global `confirmAction()` system once that system is present.

### 7.6 Internal helpers

Recommended private helpers:

```text
generateDraftInvoiceNo_()
canManageAllSalesDrafts_(user)
requireSalesDraftAccess_(user, row)
validateSalesDraftPayload_()
serializeSalesDraftPayload_()
parseSalesDraftRow_()
appendSalesDraftAudit_()
removeSalesDraftAfterPost_()
findPostedInvoiceByDraftId_()
```

Private helpers use trailing underscores so they are not exposed directly to `google.script.run`.

---

## 8. Safe Draft-to-Sale Conversion and Duplicate-Post Protection

A naive two-call flow is unsafe:

```text
completeSale() succeeds
  -> network drops
  -> deleteDraft() never runs
  -> draft remains
  -> user can accidentally post it again
```

V1 must prevent this.

### 8.1 Add source-draft linkage to Sales

Add one additive column to `SALES`:

```text
Source Draft ID
```

Ordinary POS sales leave it blank.

When posting a draft, the POS includes:

```js
payload.sourceDraftId
payload.sourceDraftVersion
```

### 8.2 Pre-write draft validation inside `completeSale()`

While `completeSale()` already holds its script lock and **before the first financial/stock write**:

1. If there is no `sourceDraftId`, proceed exactly as today.
2. If `sourceDraftId` is present, first search `SALES` for an existing row whose `Source Draft ID` matches.
3. If an existing real sale is already linked to this draft, **do not post again**. Authorize the retry from either the still-present draft row or the append-only `POSTED` draft-audit row, verify the posted version, retry non-throwing cleanup if needed, and return the existing invoice payload. This works even when the original successful request already deleted the active draft row but the browser lost the response.
4. If no linked sale exists, load the active draft, verify ownership/manage-all access, verify the expected version, then continue through the existing sale validation.

This makes retries idempotent at the draft-conversion boundary **before and after draft cleanup**.

### 8.3 Sale write

When a draft-origin sale is appended, also write:

```text
Source Draft ID = <draft id>
```

No other sale semantics change.

### 8.4 Cleanup after successful posting

After all existing sale writes/effects are complete:

1. attempt to append `POSTED` audit with the real Invoice ID;
2. attempt to remove the active draft row;
3. return the existing invoice payload.

**Post-write draft cleanup must be non-throwing.** Once the real sale has been written, an audit/delete cleanup failure must never make `completeSale()` report the financial sale itself as failed. The cleanup helper catches/logs its own failure. `Source Draft ID` remains the permanent idempotency key, so a later retry finds the already-created invoice and retries cleanup instead of posting again.

If the browser retries because the response was lost, the `Source Draft ID` lookup returns the already-created invoice instead of creating a duplicate.

This is the required safety property:

> One draft may produce at most one real sale, even if the final request/response is retried.

---

## 9. Price Preservation

Current POS auto-priced lines are recalculated from the latest lot-price ladder whenever they render. Reopening a saved draft with `priceMode: 'auto'` would therefore silently change the saved customer price, violating the approved rule.

### 9.1 Restore drafts as a fixed internal price mode

The current POS can store an exact FIFO-derived `lineTotal` that is not always equal to `roundMoney(qty × displayedUnitPrice)` because the visible unit price is rounded to two decimals. Restoring such a line as ordinary `manual` pricing could therefore shift the invoice by one poisha.

When a saved draft line is loaded into POS:

```js
line.unitPrice = saved unit price
line.lineTotal = saved exact line total
line.priceMode = 'fixed'
```

`fixed` is an internal draft-restore mode only. The original mode remains in `savedPriceMode` for audit/debug information and must not trigger automatic repricing on open.

### 9.2 Editing converts fixed lines to normal pricing

- Editing quantity on a fixed line switches it to `manual` and recalculates its line total from the edited quantity and visible unit price.
- Editing unit price switches it to `manual`.
- **Reset to Lot Price** switches it to `auto` and recalculates from the current FIFO pricing ladder.

No silent price refresh occurs.

### 9.3 Posting

`completeSale()` accepts `priceMode: 'fixed'` only when a valid `sourceDraftId/sourceDraftVersion` is present. For each fixed line it verifies product ID, quantity, visible unit price, and exact line total against the authorized stored draft snapshot, then uses the stored exact line total. Ordinary non-draft POS requests cannot use `fixed` mode.

This preserves the exact saved invoice economics while keeping the server authoritative at the draft boundary.

---

## 10. Stock, Vendor, Serial and Warranty Revalidation

### 10.1 No stock reservation

Saving or updating a draft does not call FIFO planning and does not change current stock.

The list may show saved quantities, but they do not represent held inventory.

### 10.2 Reopen

Opening a draft first refreshes the normal POS bootstrap so current:

- product availability;
- Current Stock;
- lot-pricing ladder;
- active vendors;
- bank/mobile-banking accounts;
- customer data;
- active cash session

are fresh.

Saved prices remain fixed as described above.

### 10.3 Stale product handling

If a saved product has been deleted/inactivated or otherwise cannot be resolved:

- keep the draft itself intact;
- clearly identify the affected line as unavailable;
- do not silently substitute another product;
- block real posting until the user removes/replaces the invalid line.

### 10.4 Vendor shortage handling

Saved vendor shortage choices are intentions only.

At posting, existing `completeSale()` behavior remains authoritative and may reject a vendor that is now inactive, missing, or no longer applicable to the current shortfall.

### 10.5 Serial/warranty handling

When the POS later/currently carries serial or warranty selection fields, the draft stores them as intended values only.

On reopen/post:

- revalidate their availability through the owning serial/warranty module;
- never reserve them merely because they appear in a draft;
- if unavailable, require replacement before posting.

No serial reservation sheet or lock is introduced by Draft Invoice V1.

---

## 11. POS UI

### 11.1 Primary action placement

Add a secondary action near the current Complete Sale button:

```text
[ Save Draft ]   [ Complete Sale ]
```

`Save Draft` is available when there is at least one cart line.

Saving a draft does not require an active cash session or complete customer/payment fields.

### 11.2 New draft save

`Save Draft` snapshots:

- selected customer fields, even if incomplete;
- cart lines;
- current fixed visible prices and line totals;
- invoice discount;
- Amount Received input;
- intended payment method/account;
- shortage/vendor choices;
- optional serial/warranty intent;
- note/date fields if the POS exposes them.

On success:

1. show the assigned Draft No;
2. clear customer/cart/payment fields using the same safe reset primitives as a completed sale;
3. clear draft-edit state;
4. keep the user on POS, ready for the next customer.

### 11.3 Editing an existing draft

When a draft is opened:

- navigate to POS;
- refresh POS bootstrap;
- show a visible banner such as `Editing DRAFT-2026-0007`;
- set `posState.draftId`, `draftNo`, and `draftVersion`;
- restore the customer/form/cart state;
- restore saved prices as manual/fixed;
- show current stock/vendor warnings;
- change the secondary action label to `Update Draft`.

An `Exit Draft` action clears only the local loaded draft state and returns to a clean POS. It does not delete or modify the stored draft.

### 11.4 Save while editing

`Update Draft` sends the current expected version.

On success:

- update local version from the server response;
- show success toast;
- clear POS/draft mode so the register is ready for the next customer.

On version conflict:

- do not overwrite;
- keep local screen data visible;
- offer `Reload Latest` / `Cancel` behavior in the UI;
- no draft write occurs.

### 11.5 Complete Sale while editing a draft

The normal POS validation and approved confirmation-dialog flow run.

The frozen payload includes the source draft ID/version.

If posting succeeds, draft mode is cleared and the existing invoice preview/print behavior continues.

---

## 12. Draft Invoices Page

Create:

```text
draftSales.html
```

Add it as a child under the existing **Sales** group:

```text
Sales
  Sales Invoice
  Draft Invoices
  New Return
  Return History
```

The new child should be capability-visible when the user can either:

- `pos.add` (own drafts), or
- `sales.edit` (manage all drafts).

The existing generic navigation helper supports `actionPermAny` for top-level items. Extend sub-navigation visibility to honor the same metadata rather than adding a Draft-specific navigation hack.

### 12.1 List columns

Desktop:

```text
Draft No | Updated | Customer | Phone | Amount | Created By | Action
```

Mobile uses compact cards with the same information.

Search should match:

- Draft No;
- customer name;
- phone;
- creator name for manage-all users.

### 12.2 Action menu

Use one Action menu consistent with SherERP list conventions:

- `Open`
- `Print / Preview`
- `Save JPG` / existing export mechanism
- `Delete`

There is **no Post action** in the list.

Posting requires `Open` -> POS -> review -> Complete Sale.

### 12.3 Delete

Deleting a draft uses the approved shared `confirmAction()` danger dialog once that system is implemented.

Suggested summary:

```text
Delete Draft?
DRAFT-2026-0007
Customer: Shuvo
Amount: ৳5,000

This removes the unfinished draft only. No posted sale/accounting entry exists.
```

After confirmation, call `deleteSalesDraft()` with the current version.

---

## 13. Draft Print / Export

Draft documents must reuse SherERP's existing invoice data/rendering system rather than creating a second receipt template.

### 13.1 Draft invoice payload

Create an internal draft-preview payload with the same shape consumed by `renderInvoiceHtml_()` / print/JPG rendering, plus:

```js
isDraft: true
draftNo: 'DRAFT-2026-0007'
invoiceId: 'DRAFT-2026-0007'
```

Use current shop/invoice-design settings for branding.

### 13.2 Visible marking

All screen, A4 print/PDF, thermal print, and JPG renderers must visibly mark:

```text
DRAFT
খসড়া
```

Requirements:

- marker appears on every physical/page chunk;
- draft number is shown instead of a real invoice number;
- no `INV-...` number is generated;
- the automatic `Paid / পরিশোধিত` badge is suppressed for drafts;
- intended payment figures may be shown as provisional values if the normal invoice totals section is used.

### 13.3 Sharing scope

V1 reuses existing browser print/PDF and Save JPG/export behavior. It does not add a WhatsApp Business API integration.

If the existing client already has a generic Web Share helper, it may be reused, but draft functionality must not depend on it.

---

## 14. Confirmation-System Integration

The separately approved global confirmation-dialog system is a UI safety dependency for important actions.

Draft behavior:

- `Save Draft`: no confirmation. It is non-financial and reversible by editing.
- `Update Draft`: no confirmation.
- `Delete Draft`: danger confirmation because it discards saved work.
- `Complete Sale from Draft`: same financial confirmation as an ordinary POS sale.

Do not add draft-only browser `confirm(...)` prompts if the shared `confirmAction()` service is available.

---

## 15. Files and Responsibilities

Expected production changes:

### New

- `DraftSales.gs` — draft persistence, ownership/version checks, draft audit, post-link cleanup helpers.
- `draftSales.html` — Draft Invoices list/search/action UI.
- tests under `tests/` for draft persistence, permissions, version conflicts, conversion idempotency and UI contracts.

### Modify

- `Config.gs`
  - add `SALES_DRAFTS` and `SALES_DRAFT_AUDIT` sheets/headers;
  - add draft ID/audit ID prefixes;
  - add `Source Draft ID` to `SALES` header.

- `Sales.gs`
  - accept optional source-draft ID/version in `completeSale()`;
  - validate the source draft before first write;
  - detect an already-posted source draft;
  - stamp `Source Draft ID` on the real sale;
  - remove/audit the draft only after successful posting;
  - leave ordinary sale behavior unchanged when source draft fields are absent.

- `pos.html`
  - Save/Update Draft control;
  - draft-edit state/banner;
  - draft snapshot/restore;
  - fixed-price restore;
  - source draft fields on final post;
  - clean reset after save/post.

- `UI.gs`
  - add Draft Invoices as a Sales child using derived action permissions, not a new permission module.

- `javascript.html`
  - extend sub-nav `actionPermAny` visibility generically if needed;
  - reuse invoice renderer for draft marking/preview;
  - route/load hook for Draft Invoices page;
  - shared confirmation integration after that approved system lands.

- `index.html`
  - include `draftSales.html`.

- `style.html`
  - draft list/cards;
  - POS draft-edit banner;
  - draft watermark/banner in invoice print/screen/JPG-compatible presentation where applicable.

- `Invoice.gs`
  - preferably extract/reuse shop-payload assembly so a draft preview can use the same current shop/invoice design without reading a Sale row.
  - no draft is ever read from `SALES` as if it were posted.

- `PROJECT.md`
  - document Draft Invoice lifecycle, sheet ownership, no-reservation rule, and source-draft idempotency boundary after implementation.

`Setup.gs` should not need draft-specific logic if it continues to create/repair all `CONFIG.SHEETS` entries generically.

---

## 16. Error Handling

Required user-facing failures:

### Save/update

- `Add at least one product before saving a draft.`
- `This draft was changed by another user. Reload the latest version.`
- `You do not have permission to manage this draft.`
- `This draft is too large to save. Remove some lines or notes.`

### Open

- Missing/inactive products are identified explicitly.
- Missing/inactive vendor/account references are warnings until posting when possible.
- The draft itself is never silently modified just because referenced master data changed.

### Post

All ordinary sale errors remain the existing `completeSale()` errors, including:

- cash session missing;
- incomplete customer identity;
- missing product;
- invalid vendor shortage resolution;
- invalid bank account;
- invalid backdate;
- invalid payment split.

A posting failure leaves the draft row intact.

A retry after a real sale was already created from the same draft returns the linked invoice and cleans up the draft instead of creating a duplicate sale.

---

## 17. Performance Rules for Apps Script + Sheets

1. One active draft = one main draft row.
2. No per-item draft sheet and no repeated append/delete loops for line items.
3. Draft list reads scalar metadata without parsing Items JSON.
4. One script lock per create/update/delete/post-conversion operation.
5. Do not call `getAllRows_()` repeatedly inside a draft line loop.
6. Reuse the current POS bootstrap for current products/customers/vendors/accounts instead of building a second large bootstrap.
7. Keep draft history in a small append-only audit sheet; do not retain full old JSON versions unless later requested.
8. Do not cache stock, due, cash session or active account data as part of draft persistence.
9. Draft snapshot totals are presentation values only and never feed reports/dashboard/accounting.

---

## 18. Testing Strategy

Add focused Node/static tests in the existing `tests/` convention plus runtime acceptance steps for Apps Script behaviors that cannot be emulated locally.

### 18.1 Server/static contract tests

Prove:

1. Config contains Draft Invoices and Draft Invoice Audit schemas.
2. Draft save does not reference financial/stock writers.
3. Draft save does not require an active cash session.
4. `completeSale()` remains the only real sale writer used by draft conversion.
5. `SALES` includes additive `Source Draft ID`.
6. Ordinary POS sale payloads with no draft ID retain existing behavior.
7. Draft posting validates version/access before the first sale write.
8. Existing-sale-by-source-draft check occurs before a second sale can be created.
9. Draft prices restore in internal `fixed` mode and preserve exact saved line totals; any quantity/price edit leaves fixed mode.
10. Draft list has no direct Post action.
11. Draft print renderer visibly contains DRAFT/খসড়া handling.
12. Draft navigation rides on existing permissions, not a new `PERMISSION_MODULES` module.

### 18.2 Permission tests

- Cashier with `pos.add`, no `sales.edit`: create/list/open/update/delete own draft; cannot access another user's draft.
- Manager-like role with `sales.edit`: list/preview/delete all drafts; with `pos.view`, also open/update them in POS.
- User without `pos.add` and without `sales.edit`: no Draft Invoices access.
- User with `sales.edit` but no `pos.add`: may manage drafts but cannot post because `completeSale()` denies `pos.add`.
- Administrator: full access.

### 18.3 Concurrency/version tests

Scenario:

```text
User A opens version 3
User B updates -> version 4
User A tries save with expectedVersion 3
=> refused
=> version 4 remains unchanged
```

Delete and post must also reject stale versions before mutation.

### 18.4 Accounting invariants

After Save Draft / Update Draft / Delete Draft, assert no change to:

- Sales count;
- Sale Items count;
- stock quantities/lots;
- Stock Movement;
- Customer Current Due;
- Customer Ledger;
- Cash Book;
- Bank Book;
- Vendor Ledger/Sourcing;
- Day Book source transaction totals.

### 18.5 Conversion acceptance

1. Save a draft with one or more lines.
2. Change stock after saving.
3. Open draft and confirm current stock is refreshed but saved price is unchanged.
4. Review and post.
5. Existing `completeSale()` creates exactly one real invoice.
6. Draft row is removed.
7. `POSTED` audit references the real Invoice ID.
8. `SALES.Source Draft ID` references the draft.
9. Stock/cash/bank/due effects match an ordinary equivalent POS sale.

### 18.6 Retry/idempotency acceptance

Simulate/replay the final conversion request using the same Draft ID after a real sale already exists.

Expected:

- no second sale row;
- no second stock consumption;
- no duplicate cash/bank/ledger effect;
- existing invoice returned;
- leftover draft cleanup retried safely.

### 18.7 Price preservation acceptance

1. Save draft at product price ৳1,200.
2. Change current lot/default selling price to ৳1,250.
3. Reopen draft.
4. POS still shows ৳1,200.
5. User may explicitly click Reset to Lot Price to adopt current automatic pricing.

### 18.8 Draft print acceptance

- Draft number shown.
- No real Invoice ID allocated.
- DRAFT / খসড়া visible on A4 preview/print, thermal, and JPG.
- Paid badge suppressed.
- Printing/exporting does not post the draft.

### 18.9 Runtime-only checks

A real Apps Script deployment is required to verify:

- `LockService` behavior;
- concurrent Sheet writes;
- `PropertiesService` year counters;
- actual sheet schema repair;
- Google Sheets JSON cell size behavior;
- browser print/PDF/JPG output;
- final posting with real stock/cash/bank/customer data.

Do not claim these are tested from Node/static analysis alone.

---

## 19. Acceptance Criteria

Draft Invoice V1 is complete only when all of the following are true:

1. Staff can save an unfinished POS cart with at least one product.
2. Saving does not require customer/payment completeness or an open cash session.
3. Saving/updating/deleting a draft has zero accounting or stock effect.
4. Each draft has a separate Draft No and never consumes a real Invoice ID.
5. Own/all visibility follows the approved permission model.
6. Drafts can be reopened into the existing POS.
7. Saved prices/discount and exact line totals are restored exactly, with no silent auto repricing or one-poisha drift.
8. Current stock/vendor/account state is refreshed before posting.
9. Stale concurrent updates are refused.
10. Draft list provides Open / Print-Preview / Export / Delete, but no direct Post.
11. Draft prints are unmistakably DRAFT / খসড়া.
12. Posting uses the same `completeSale()` business logic as an ordinary sale.
13. A failed posting leaves the draft intact.
14. A successful posting removes the active draft row.
15. Retrying a draft conversion cannot create a duplicate sale.
16. Draft create/update/delete/post actions are auditable.
17. Ordinary POS sales continue to work unchanged when no source draft is supplied.

---

## 20. Implementation Order

After this written spec is approved, the implementation plan should slice work in this order:

1. schema + draft persistence + audit + version/permission tests;
2. Draft Invoices list/navigation;
3. POS Save/Update/Open restore behavior and fixed-price semantics;
4. source-draft idempotent conversion inside `completeSale()`;
5. draft invoice preview/print/JPG marking;
6. confirmation-system integration;
7. full static regression + runtime acceptance checklist.

No implementation should begin until this written design specification is approved.
