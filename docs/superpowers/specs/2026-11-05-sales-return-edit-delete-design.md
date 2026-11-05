# Mohim ERP Native Sales Return Edit & Delete — Design

**Date:** 2026-11-05  
**Status:** Proposed design for review; not production approval  
**Repository baseline reviewed:** `main` @ `92ac613119f8e37c886c5c015942bafe4231ef8d`  
**Owner:** Sales Return module, not a generic correction engine

## 1. Intent and existing behavior

Allow authorized shop staff to correct a **previously completed Sales Return**, or delete a mistaken return, without altering the original sales invoice, losing an audit trail, double-moving cash, corrupting customer due, or breaking stock-lot attribution. Preserve compact Return History and the existing Returns form. A batch contains independent child Return IDs, each tied to exactly one invoice.

Present code: `SalesReturn.gs` implements `completeReturn`, `completeReturnBatch`, `getReturnDetail`, `getReturnHistory`; `returnHistory.html` offers View/View Batch only. `DeleteEngine.gs::deleteSalesInvoice` blocks a sale with active returns and asks the user to delete returns first, but no native return deletion exists. `DayBook.gs` lists returns; `daybook.html` and `DeleteEngine.gs::deleteDayBookEntry` cannot edit/delete them. `Utils.gs::activeSalesReturnItems_` determines active children by active headers but does not currently filter deleted child lines.

## 2. Approaches

1. **Native, journal-guarded return correction (selected proposal).** Keep one immutable Return ID; implement read-only reconciliation before any mutation, update the return in-place with append-only audit and effective child lines, or soft-delete the header after precisely reversing its effects. Add only necessary lineage/soft-delete metadata to existing sheets. Compatible with existing navigation and correction ownership.
2. **Delete and create a replacement return.** Easier to call existing create code but leaks a second identity, makes partial Sheets writes hard to recover, and can break batch/customer/refund references. Rejected.
3. **Directly update/delete return rows.** Cannot safely reconcile lot consumption, Cash Book, and Customer Ledger. Rejected.

## 3. Scope and user experience

- **Return History → Actions:** View, Edit, Delete; a batch row still offers View Batch. Both desktop and touch layouts retain existing table styles.
- **Edit:** open the current `returns.html` single-invoice workspace with stored return quantities/prices, refund method, date, reason and notes. Display original return ID. Allow adjusting product quantities (including removing a line), prices up to the source invoice's **effective post-discount** unit price, refund method Cash/Store Credit, transaction date subject to existing date policy, reason and notes. Require an explicit **Edit Reason** for audit. An edited return must contain at least one positive line; use Delete for removing all lines. Do not permit changing invoice/customer.
- **Delete:** confirm Return ID, invoice, amount, refund method, and accounting effects. Require Delete Reason. Soft-delete the return; do not hard-delete source or child evidence. Hide it from normal Return History, sales return aggregates, customer lists, and Day Book, but expose to authorized audit/recycle views.
- **Batch:** edit/delete one child Return ID independently, retaining its Batch ID for surviving children. Batch detail and totals use only active children. Do not implement mixed-method batch returns or reconstitute an entire batch.
- **Day Book:** Open Original opens the selected return. Once the native handler is proven, Edit/Delete dispatch to the existing module owner, never duplicate accounting logic in Day Book.

## 4. Accounting and correctness

1. **Authoritative quantities:** source invoice lines minus all **other active returns**, recomputed under ScriptLock. Editing its own return excludes its existing active child lines when validating the proposed replacement. Both aggregate quantity and economic return value caps apply across the entire invoice.
2. **Physical stock:** each original return increased `PRODUCTS.Current Stock`, restored exact `STOCK_LOTS` quantities, and decreased recorded `SALE_ITEM_LOTS.Quantity`; virtual bundle returns restore physical components using the sale-time recipe snapshot. A downward edit/delete must undo **the same physical allocation**, not consume arbitrary FIFO lots. If returned stock has since sold/transferred/been consumed, or attribution is ambiguous, block with a specific error and no writes. No automatic negative-stock bypass. A price-only or notes-only edit moves zero stock.
3. **Lineage migration:** new Sales Returns must durably record which consumption evidence and lot each restoration used. Existing `STOCK_MOVEMENT` contains Return ID/Lot ID/Source Sale Product ID but not an immutable source consumption identifier; design additive identifiers/columns in those existing sheets rather than a second stock engine. Legacy returns are editable/deletable only when their exact reversal can be reconstructed and verified uniquely; otherwise **Needs Review**, no mutation and no speculative backfill.
4. **Cash:** a Cash refund is a `CASH_BOOK` Debit with Reference = Return ID. Verify it uniquely and reconcile against the invoice's verifiable collected Cash/Bank/Mobile value, prior active refunds and split-payment provenance. Delete/replace only the exact refund effect; preserve historical evidence via soft-delete/compensating movements. Cash-in-hand and session calculations must reflect the net difference exactly once.
5. **Store Credit:** a `CUSTOMER_LEDGER` Credit and `CUSTOMERS.Current Due` reduction are linked to Return ID. Reverse/re-apply the exact difference only when ledger state can be proved consistent. If credit has since been consumed by dependent settlements or provenance cannot be proved, fail closed, explain what must be reconciled, and do not change rows.
6. **Edit/version protection:** `SALES_RETURN` keeps Return ID, Invoice ID, original Processed By/Created At, and Batch ID; append `Edit Version`, `Updated At`, `Updated By`, `Edit Reason`. Client submits expectedVersion; stale edits rejected before mutation. Use existing `INVOICE_EDIT_LOG` with additive return-specific audit fields (before/after values and items), and `DELETE_LOG` for deletion. Original header/child source remains the sole accounting state, not the logs.
7. **Idempotency/faults:** every edit/delete submits one stable operation ID; use existing `SALE_POSTING_JOURNAL` with explicit return-correction operation types, immutable request hash, actor and invoice attribution. Under ScriptLock: validate permissions and read all evidence → plan every delta → reserve journal → mutate. Committed retries return the same result; `Writing`/`Needs Review` never auto-replay. Journal lookup must bind to exact Return ID as well as invoice/actor/hash, and also detect existing unresolved operations. A previously committed original `completeReturn` replay must not silently claim a previously edited/deleted return is unchanged.
8. **Permissions and dates:** `requirePermission_(token,'returns','edit')` for edits; `requireDeletePermission_(token,'returns', header.Date)` for deletion. Require active Cash Session and protect closed historical sessions/correction windows per existing ERP policy; use `resolveEditedTransactionDate_` for a changed date. No direct sheet editing by clients.
9. **Safety boundaries:** never mutate a sale invoice, other returns or unrelated Cash/Bank/Customer/Stock records. Preserve split-payment flag OFF by default; never weaken the single-invoice-only split-return and account-specific disbursement restrictions. Missing/inconsistent book evidence, duplicate Return IDs, orphan movements, missing bundle snapshots or uncertain customer-credit allocation → fail closed.

## 5. Data and code boundaries

| File | Responsibility |
| --- | --- |
| `SalesReturn.gs` | Native get-for-edit, read-only correction plan, edit/delete commit, existing return creation |
| `StockLots.gs` | Exact reversible return allocation planning/application with lot evidence |
| `Config.gs` | Additive lineage, active child, audit and version fields on existing sheets |
| `Utils.gs` | Filter soft-deleted return child rows as well as headers |
| `returnHistory.html`, `returns.html` | Native action menu and reuse of single-invoice return editor |
| `DayBook.gs`, `daybook.html`, `DeleteEngine.gs` | Route Edit/Delete to return owner; no duplicate business writes |
| `SalesManagement.gs`, `CustomerSettlement.gs` | Verify linked sales eligibility, exact customer allocation and refund semantics as needed |
| `tests/sales_return_correction_*.test.js` | Mocked-Sheets accounting tests + failure injection |

**Migration:** additive, no rewrite of existing historical rows. Historical records without provable lineage remain readable and are blocked for risky correction, with a precise explanation. Deployment requires an isolated, mapped Apps Script + cloned Google Sheets workbook; mocked Node test success does not authorize production.

## 6. Acceptance criteria

- Create → edit quantity up/down, price up/down, refund method, reason/date, and delete; totals reconcile to exact-paisa values; no double movements.
- Original Return ID and batch association remain stable; other return children are untouched.
- Unrelated transactions, unavailable lot stock, reused operation ID with changed payload, stale edit version, corrupted Cash/Bank evidence, downstream Store Credit use, missing lineage, or closed session all fail **before any business write**.
- Inject failures at each mutation boundary; retry never duplicates cash/credit/stock or tries uncertain rollback.
- All prior return, bundle, sales, payment, ledger, Day Book, security and confirmation regression tests pass; browser smoke tests pass on the isolated Apps Script/Sheets copy.
- Reviewable diff and draft PR only; no `main` merge, `clasp push`, or production deployment as part of planning.

## 7. Outstanding engineering judgment at implementation

The exact schema for immutable consumption evidence must be finalized from `StockLots.gs::planSaleReturnRestoration_` and actual legacy sheet shape in a **test-first** task. If no unambiguous mapping can be built without an intrusive migration, reject legacy mutation rather than infer attribution. The same conservative policy applies to later customer-credit usage and cash-session history. Those conservative blocks are deliberate correctness boundaries, not silent partial success.
