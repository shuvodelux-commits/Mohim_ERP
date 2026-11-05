# Native Sales Return Edit & Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add accounting-safe native Edit/Delete for completed Mohim ERP Sales Returns while keeping original Sale, FIFO/lot, refund, customer balance, audit and Day Book consistent.

**Architecture:** Extend `SalesReturn.gs` as the only mutation owner. First prove exact reversible stock and payment attribution under a locked read-only planner, then journal-guard each native mutation; reuse existing return editor and history with no separate correction engine.

**Tech Stack:** Google Apps Script V8; HTML/vanilla JS; Google Sheets; Node `node:test` mocked workbook suites; existing GitHub Actions/browser QA.

**Spec:** `docs/superpowers/specs/2026-11-05-sales-return-edit-delete-design.md`

## Global Constraints

- Preserve GitHub `main` as source of truth. Execute on a fresh worktree/branch. **Do not merge or deploy to production.**
- Follow `AGENTS.md`: native module owner, ScriptLock, authorization + all rejectable checks before writes, soft-delete/reversal exactly once, no parallel correction engine.
- Reuse `prepareSalesReturn_`, `commitPreparedSalesReturn_`, `planSaleReturnRestoration_`, `activeSalesReturnItems_`, `requireDeletePermission_`, `salePostingJournalDecision_` and existing form primitives where feasible; no blind copy.
- No schema rewrite of historical records. Additive columns only; legacy ambiguous return reversal must fail closed.
- Cash/Store Credit only; preserve existing split-payment feature flag and single-invoice restrictions.
- Exact-paisa rounding and stock/FIFO provenance must be asserted. A successful mock is **not** live Sheets E2E.
- Run each test first RED, then the minimum implementation GREEN, then regression tests and a focused commit. Never turn a RED test green by deleting assertions.

## Review Focus

1. A partial return restored to a lot that was subsequently sold must reject a quantity decrease/delete before writes (**Task 2**).
2. Multiple same-product source consumption rows from different suppliers or bundle components cannot be guessed from only Return ID + Lot ID (**Task 2**).
3. A customer spends Store Credit after a return; changing/deleting it must not silently create false due or reorder payment allocation (**Task 3**).
4. A split-payment refund was committed and then edited/deleted; re-sending the original creation operation ID must not return a misleading replay or post twice (**Task 4**).
5. Apps Script throws after the first business write; retry must report Needs Review and keep all source evidence for manual repair (**Task 4**, **Task 5**).

---

### Task 1: Return identity, readback and active-child semantics

**Files:**
- Modify: `SalesReturn.gs` (near `getReturnDetail`, `getReturnHistory`)
- Modify: `Utils.gs` (`activeReturnChildRows_`)
- Modify: `Config.gs` (`SALES_RETURN`, `SALES_RETURN_ITEMS`)
- Create: `tests/sales_return_correction_readback.test.js`

**Interfaces:**
- Consumes: `getReturnDetail(token, returnId)`, `activeSalesReturnItems_()`, `getInvoiceForReturn(token, invoiceId)`.
- Produces: `getReturnForEdit(token, returnId)` → `ok_({header,items,invoice,version,editable,reason})`; `SALES_RETURN['Edit Version']` default 0; effective active children.

- [ ] **Step 1 RED:** Write mocked-Sheets tests: view history excludes `Is Deleted=TRUE`; direct deleted return detail denied outside authorized audit; `getReturnForEdit` requires returns:edit, rejects duplicate ID, returns saved prices/qty, invoice and version; active child aggregator ignores `SALES_RETURN_ITEMS['Is Deleted']='TRUE'` but preserves legacy blank fields.
- [ ] **Step 2 RED:** Run `node --test tests/sales_return_correction_readback.test.js`. **Expected:** failures from missing edit API and incorrectly visible deleted rows/children.
- [ ] **Step 3 GREEN:** Implement the minimum readback and additive `Edit Version`, `Updated At`, `Updated By`, `Edit Reason` on `SALES_RETURN`, and child `Is Deleted` metadata on `SALES_RETURN_ITEMS`; read-only no accounting writes.
- [ ] **Step 4 VERIFY:** Run `node --test tests/sales_return_correction_readback.test.js tests/multi_invoice_sales_return_regressions.test.js tests/return_ledger_regressions.test.js`. **Expected:** all passing.
- [ ] **Step 5 COMMIT:** `git add SalesReturn.gs Utils.gs Config.gs tests/sales_return_correction_readback.test.js && git commit -m "test+feat(returns): safe correction readback and active children"`

### Task 2: Exact physical-stock reversal planner + durable restoration evidence

**Files:**
- Modify: `StockLots.gs` (`planSaleReturnRestoration_`, `applySaleReturnRestorationPlan_`; add inverse planning)
- Modify: `SalesReturn.gs` (`commitPreparedSalesReturn_` integration)
- Modify: `Config.gs` (`SALE_ITEM_LOTS`, `STOCK_MOVEMENT` additive evidence)
- Create: `tests/sales_return_correction_stock.test.js`

**Interfaces:**
- Consumes: `SALE_ITEM_LOTS`, `STOCK_MOVEMENT` by exact Return ID, `STOCK_LOTS`, bundle snapshot from `getSaleBundleSnapshot_`.
- Produces: `planSalesReturnStockUndo_(returnId, context)` → read-only inverse `{ productDeltas, lotDeltas, saleConsumptionDeltas, movements }` or throws; `applySalesReturnStockUndo_(plan, returnId)` → exact mutation. Original `commitPreparedSalesReturn_` persists durable identity for every new allocation.

- [ ] **Step 1 RED:** Tests prove (a) ordinary single-lot return undo, (b) partial multi-lot quantity decrease with exact provenance, (c) bundle snapshot physical components while parent remains one visible line, (d) two suppliers/shared component cannot be cross-attributed, (e) downstream lot consumption blocks, (f) missing/duplicate/legacy ambiguous evidence blocks, (g) price-only edit yields empty stock delta.
- [ ] **Step 2 RED:** Run `node --test tests/sales_return_correction_stock.test.js`. **Expected:** missing planner and/or evidence failures.
- [ ] **Step 3 GREEN:** Add immutable source-consumption identifiers to exact returned stock movements and lazily to the source `SALE_ITEM_LOTS` records when a return is written. Never rely on mutable Sheet row indexes as the durable identity. Implement the read-only inverse planner and an apply routine that reverses **only** the exact restored lot and source consumption quantities; preserve fallback return-lot ownership.
- [ ] **Step 4 VERIFY:** Run `node --test tests/sales_return_correction_stock.test.js tests/bundle_reversals.test.js tests/bundle_sale_edit_runtime.test.js tests/multi_invoice_sales_return_regressions.test.js`. **Expected:** all passing; historical ambiguity is an explicit error, not an inferred match.
- [ ] **Step 5 COMMIT:** `git add StockLots.gs SalesReturn.gs Config.gs tests/sales_return_correction_stock.test.js && git commit -m "test+feat(returns): reversible exact lot lineage"`

### Task 3: Read-only mutation planner for refund, customer and economics

**Files:**
- Modify: `SalesReturn.gs` (new planner near `prepareSalesReturn_`)
- Inspect/modify only if proved necessary: `CustomerSettlement.gs`, `SalePayments.gs`
- Create: `tests/sales_return_correction_planner.test.js`

**Interfaces:**
- Consumes: Task 2 `planSalesReturnStockUndo_`; `salesReturnCashRefundAvailable_`, `customerInvoiceCashCollected_`, `customerInvoiceSettlementSnapshot_`, `readSalePaymentBreakdown_`.
- Produces: `prepareSalesReturnChange_(token, returnId, requested, mode)` → read-only `{original, replacement, stockUndo, stockRedo, moneyUndo, moneyRedo, customerDelta, audit}`; mode `'Edit'|'Delete'`.

- [ ] **Step 1 RED:** Tests cover exact invoice caps *excluding self*, concurrent/later returns, insufficient Cash provenance, single active Cash Book reference, single Store Credit ledger reference, subsequent consumed customer credit, refund-method switch, changed date/backdate authorization, missing active session, negative/NaN price, stale version, duplicate return ID, Cash-only price edit with zero stock delta, and no writes for rejected input.
- [ ] **Step 2 RED:** Run `node --test tests/sales_return_correction_planner.test.js`. **Expected:** missing planner and unsafe-case failures.
- [ ] **Step 3 GREEN:** Build the read-only complete plan; reuse `prepareSalesReturn_` for replacement pricing but give it an effective view excluding current Return ID and a virtual state with original returned stock undone. Assert exact original journal/book evidence before any write. Block later settlement dependency rather than guessing allocation. Require editing at least one line and a nonempty edit reason; deletion requires nonempty delete reason.
- [ ] **Step 4 VERIFY:** Run `node --test tests/sales_return_correction_planner.test.js tests/sale_multi_payment_phase5.test.js tests/customer_settlement_business_logic.test.js tests/multi_invoice_sales_return_regressions.test.js`. **Expected:** all passing.
- [ ] **Step 5 COMMIT:** `git add SalesReturn.gs tests/sales_return_correction_planner.test.js CustomerSettlement.gs SalePayments.gs 2>/dev/null || true`; inspect staged diff, commit only changed intended files: `git commit -m "test+feat(returns): validate complete correction before writes"`.

### Task 4: Native journaled edit transaction with audit and fault injection

**Files:**
- Modify: `SalesReturn.gs`
- Modify: `Config.gs` (`INVOICE_EDIT_LOG` additive return audit fields)
- Create: `tests/sales_return_correction_edit.test.js`
- Create: `tests/sales_return_correction_faults.test.js`

**Interfaces:**
- Consumes: `prepareSalesReturnChange_(token, returnId, requested, 'Edit')`, `applySalesReturnStockUndo_`, `salePostingJournalDecision_`.
- Produces: `updateSalesReturn(token, payload)` → `ok_({returnId,version,totalReturnAmount,refundMethod})`; payload `{returnId,expectedVersion,items:[{productId,qty,price}],refundMethod,date,backdatedReason,reason,notes,editReason,operationId}`.

- [ ] **Step 1 RED:** Assert same Return ID, version increment, audit before/after, changed line active filter, price-only zero-stock effect, quantity up/down, valid method switch, stable batch association, original `Created At`, exact Cash/Customer delta and invoice totals. Assert repeat operationId with same payload returns committed result; changed payload and actor mismatch reject. Original `completeReturn` replay after edit rejects stale result.
- [ ] **Step 2 RED:** Add failpoints to mock `appendRow_`/`updateRowFields_` on journal, stock, lots, cash, ledger, children, header and audit. Test that post-first-write failures mark `Needs Review`; no auto-replay or second cash/stock move.
- [ ] **Step 3 RED:** Run `node --test tests/sales_return_correction_edit.test.js tests/sales_return_correction_faults.test.js`. **Expected:** missing edit API/journal behavior.
- [ ] **Step 4 GREEN:** Under ScriptLock, do authorization → full plan → journal reservation → exact undo/redo → write replacement effective children → append existing `INVOICE_EDIT_LOG` audit details → update header/version → journal Committed. Mark prior children soft-deleted; append replacement children; keep original Return ID. Failed writes mark the journal Needs Review and require manual reconciliation; never attempt speculative rollback.
- [ ] **Step 5 VERIFY:** Run `node --test tests/sales_return_correction_edit.test.js tests/sales_return_correction_faults.test.js tests/sale_multi_payment_phase5_runtime.test.js tests/return_ledger_regressions.test.js`. **Expected:** all passing.
- [ ] **Step 6 COMMIT:** `git add SalesReturn.gs Config.gs tests/sales_return_correction_edit.test.js tests/sales_return_correction_faults.test.js && git commit -m "test+feat(returns): journaled native return editing"`

### Task 5: Audited native return deletion and dependent invoice unlocking

**Files:**
- Modify: `SalesReturn.gs`
- Modify: `DeleteEngine.gs` (`deleteDayBookEntry` case only, preserving native sale deletion guard)
- Create: `tests/sales_return_correction_delete.test.js`

**Interfaces:**
- Consumes: `prepareSalesReturnChange_(token, returnId, {reason,operationId,expectedVersion}, 'Delete')` and Task 2 inverse planner.
- Produces: `deleteSalesReturn(token, returnId, reason, operationId, expectedVersion)` → `ok_({returnId,deleted:true})`; `deleteDayBookEntry(token,'sales return',returnId,reason)` routes to same native handler (Day Book must provide stable operationId through the existing confirmation plumbing or a server-derived deterministic one).

- [ ] **Step 1 RED:** Tests assert delete permissions/date window/session, unique reversal of Cash Book or Store Credit and stock, soft-delete header + audit log, active children excluded by parent, original invoice remains untouched, no double reversal on repeated delete, no deletion of a return whose inventory was already resold/credit spent, and sale deletion remains blocked until every active return is resolved.
- [ ] **Step 2 RED:** Run `node --test tests/sales_return_correction_delete.test.js`. **Expected:** delete API absent/unrouted.
- [ ] **Step 3 GREEN:** Implement journaled native soft-delete. Use existing `markRowDeleted_`, `markMatchingDeleted_`, `logDeletion_`; retain Return ID and all historical evidence. `deleteDayBookEntry` delegates only; never directly marks a return deleted.
- [ ] **Step 4 VERIFY:** Run `node --test tests/sales_return_correction_delete.test.js tests/crud_business_rule_matrix.test.js tests/audit_financial_crud.test.js tests/sales_return_correction_faults.test.js`. **Expected:** all passing.
- [ ] **Step 5 COMMIT:** `git add SalesReturn.gs DeleteEngine.gs tests/sales_return_correction_delete.test.js && git commit -m "test+feat(returns): audited exact return deletion"`

### Task 6: Native Return History/Returns editor and Day Book UX

**Files:**
- Modify: `returnHistory.html`, `returns.html`, `daybook.html`, `DayBook.gs`
- Create: `tests/sales_return_correction_ui.test.js`
- Update: `tests/confirmation_sales_purchase_returns.test.js` only if existing confirmation shape requires a new case.

**Interfaces:**
- Consumes: `getReturnForEdit`, `updateSalesReturn`, `deleteSalesReturn` from Tasks 1/4/5.
- Produces: `rhOpenEditById_(returnId)` → existing `returns.html` single-invoice editor, `rhDeleteById_(returnId)` → `confirmDelete` with reason and stable operationId, and Day Book native routing.

- [ ] **Step 1 RED:** Browser/DOM tests require Return History View/Edit/Delete for an active single return, View Batch for a child; correct permission/availability states; edit field prefilling including original quantity, Refund Method, date/notes; actual **Update Return** payload and stale-version/operation ID handling; Delete confirmation and refresh; batch detail recomputes only active children; Day Book Open Original/Edit/Delete route by source Return ID. No UI action permits deleting other batch children.
- [ ] **Step 2 RED:** Run `node --test tests/sales_return_correction_ui.test.js`. **Expected:** no Edit/Delete menu or handlers.
- [ ] **Step 3 GREEN:** Reuse `returnHistory.html` row action menu, `rtState.editingReturnId`/`editQtyByProduct`, existing `runConfirmedAction` and `confirmDelete`. Do not introduce a separate correction modal. Expose only valid actions and display server rejection reasons. Day Book remains orchestration-only.
- [ ] **Step 4 VERIFY:** Run `node --test tests/sales_return_correction_ui.test.js tests/multi_invoice_sales_return_regressions.test.js tests/daybook_business_logic.test.js tests/confirmation_sales_purchase_returns.test.js`. **Expected:** all passing.
- [ ] **Step 5 COMMIT:** `git add returnHistory.html returns.html daybook.html DayBook.gs tests/sales_return_correction_ui.test.js && git commit -m "test+feat(returns): native edit delete actions in history and daybook"`

### Task 7: Regression matrix, isolated Sheets acceptance and release gate

**Files:**
- Create: `docs/qa/sales-return-edit-delete-acceptance.md`
- Modify: relevant tests from Tasks 1–6 for defects proven by RED tests
- Do **not** modify production `.clasp.json` or deployment IDs.

**Interfaces:** Consumes all Tasks 1–6 APIs and test fixtures. Produces reproducible QA acceptance evidence and an unmerged draft PR.

- [ ] **Step 1 RED:** Add missing integration tests for single cash/store credit, split-payment Cash/Store Credit original provenance, batch child edit/delete, bundles, same-lot contention, subsequent credit settlement, historical zero/duplicate lineage, backdated return, closed Cash Session, zero stock, and replay after delete. Each new behavior starts failing.
- [ ] **Step 2 GREEN:** Fix only proven gaps. Run targeted `node --test tests/sales_return_correction_*.test.js`. **Expected:** all passing.
- [ ] **Step 3 VERIFY:** Run `node --test tests/*.test.js` (all tests pass, record exact counts) and existing repo static/browser CI gates as documented in `.github/workflows/regression-tests.yml`. No silent skips.
- [ ] **Step 4 ISOLATED E2E:** On a **mapped non-production clone** of Script + bound Google Sheet, exercise real Cash Book, Customer Ledger, STOCK_LOTS, SALE_ITEM_LOTS and journal fault/replay scenarios; reconcile before/after totals. Inspect exact `.clasp.json` Script ID. **Never target known production ID `11zr6QpAODCdXOaYIQwIOYbkiajSukagTOSj_z9TVjBR3TPJgJvgSHg27`.** No `clasp push` without explicit environment authorization.
- [ ] **Step 5 REVIEW:** Complete Superpowers whole-branch code review and record limitations. Create/retain a draft PR; do not merge until isolated Sheets E2E, authorization tests, accounting sign-off and explicit production release approval.
- [ ] **Step 6 COMMIT:** `git add docs/qa/sales-return-edit-delete-acceptance.md tests && git commit -m "test(returns): complete correction acceptance and fault gates"`

## Suggested first command at execution

```bash
cd /home/shoaib/apps-script-backup
git status --short
git fetch origin
# Use a separate Git worktree and feature branch (do not work on main).
# Confirm current AGENTS.md, main commit and GitHub PR state.
# First task: RED tests for readback; do not start by adding buttons.
```

**Handoff:** Plan and spec are reviewable documentation only. No code implementation, full test run, merge, preview deployment or production deployment is implied by saving this plan.
