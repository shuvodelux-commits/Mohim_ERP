# Native Sales Return Edit/Delete — QA and release acceptance

**Date:** 2026-11-05  
**Status:** Developer implementation on draft PR #49; **NOT PRODUCTION APPROVED**.  
**Plan:** `docs/superpowers/plans/2026-11-05-sales-return-edit-delete-tdd.md`  
**Spec:** `docs/superpowers/specs/2026-11-05-sales-return-edit-delete-design.md`

## Scope delivered to the draft branch

- Native `getReturnForEdit`, `updateSalesReturn`, `deleteSalesReturn` in `SalesReturn.gs`; no generic transaction editor.
- Return History View/Edit/Delete, existing single-invoice Return Cart edit mode, and Day Book native dispatch.
- Exact physical lot/source-consumption reversal with additive lineage evidence and conservative ambiguity blocks.
- Cash/Store Credit reconciliation, optimistic `Edit Version`, immutable operation IDs, audit log and two-state journal (`Committed` or `Needs Review` on interrupted writes).
- Soft-deleted headers/child lines no longer contribute to normal return totals. Batch child corrections retain their Batch ID and do not edit siblings.

## TDD / automated regression checklist

- [x] RED: return readback and soft-delete filters.
- [x] GREEN: return readback + correction metadata.
- [x] RED: stock reversal/legacy ambiguity.
- [x] GREEN: exact lot/source stock reversal.
- [x] RED: refund planner, later customer ledger protection.
- [x] GREEN: fail-closed pre-write planner.
- [x] RED: edit journal/replay and fault injection.
- [x] GREEN: price-only edit, cash/credit reposting and journal replay.
- [x] RED: delete/Day Book dispatch.
- [x] GREEN: native soft-delete and reason/audit logging.
- [x] RED: Return History/Day Book UI wiring.
- [x] GREEN: new UI actions with server-side authority.
- [ ] Verify the new integrated mock Sheets create → quantity-edit → delete round trip and fault injections at each mutation stage.
- [ ] Verify full Node suite, static security gate and mocked Chromium in a single passing commit with exact SHA.
- [ ] Independent review of all financial invariants and implementation assumptions.
- [ ] Real isolated Apps Script + *mapped* Google Sheets **cloned** transaction acceptance.

## Required clone-only acceptance matrix

Use a newly mapped, non-production Apps Script project and a **cloned** bound spreadsheet with enough test data and independent cash/ledger reconciliation. Record Script ID, workbook ID, HEAD commit and deployment before each exercise.

1. Single Cash return: create 2 units → edit to 1 → delete. Check product stock, exact stock lots, consumption evidence, Cash Book net, return status and Day Book.
2. Cash return: edit **price only** after original returned goods have been sold; stock must not move, only refund change may post if permitted.
3. Store Credit: create → edit → delete with no downstream settlement; verify customer Current Due and CUSTOMER_LEDGER equality.
4. Store Credit: spend/allocate credit in later payment/return; correction **must fail before any Sheet mutation**.
5. Cash → Store Credit, and Store Credit → Cash: verify single active entry per ledger and exact net refund.
6. Multi-invoice batch: edit/delete only one child; validate Batch ID, active child total and surviving sibling quantities.
7. Bundle: sold snapshot with changed current recipe; correction must apply sale-time physical components and keep one visible return product line.
8. Mixed vendor/own-stock and fallback/oversold historical lots: never consume arbitrary FIFO and reject ambiguous source attribution.
9. Multi-payment invoice: only individually permitted split-payment refunds; verify original Cash/Bank/Mobile provenance and replay protection, not bank-account-specific disbursement.
10. Permission matrix: Administrator/staff add/view/edit/delete, deletion window, invalid session, closed historical Cash Session, backdated date change and required reasons.
11. Concurrency: two editors with same `expectedVersion`; exactly one edit succeeds, stale editor rejected before writes.
12. Exact operation replay: committed retry returns stored result, changed payload cannot replay, partial-write `Needs Review` blocks all further mutation.
13. Fault injection: every boundary after journal reservation (stock, lot, source, Cash, customer, child, header, log, commit marker) must never double-post on retry; review the original journal and all write evidence.
14. Original sale cannot be updated/deleted while an active return exists, but may be eligible again after all linked returns are successfully soft-deleted.
15. Cash Session close/reopen: verify current drawer and historical backdated cash postings against the cash reconciliation module.
16. Reports, customer ledger, sales history, Day Book, print and audit views exclude deleted returns and compute edited economic value.

## Release blockers / risk rulings

- **No production write.** The tracked `main/.clasp.json` points to production Script ID `11zr6QpAODCdXOaYIQwIOYbkiajSukagTOSj_z9TVjBR3TPJgJvgSHg27`. The known shared preview Script ID `1c1wtUuO0xISTw0JTfAKnqry28UeJaIcW8CWwJVDSo1Y31BbPad4glp4G` is not an automatically approved clone either.
- Old return/lot evidence with no uniquely reconstructable link is deliberately blocked; do not infer or mutate legacy rows to force success.
- Reversing returned units that are unavailable in their recorded lot is blocked. No automatic negative inventory adjustment.
- Store Credit with later customer ledger entries is deliberately blocked, even if an operator believes they are unrelated; requires independent reconciliation.
- Apps Script + Google Sheets has no multi-sheet atomic commit. The journal is an ambiguity barrier, **not** automatic rollback; a partial failure requires operator-reviewed repair.
- The new implementation is not release-eligible on the basis of mocked CI alone. Do not merge PR #49, set new feature flags, run Setup against live Sheets, `clasp push` or `clasp deploy` until clone acceptance and explicit authorization.

## Command gate

```bash
node --test tests/sales_return_correction_*.test.js
node --test tests/*.test.js
node tests/production_gate_static.test.js
node tests/audit_security_drafts.test.js
node tests/production_gate_browser.cjs
```

Record actual commands, pass/fail counts and SHA from GitHub Actions and the isolated clone; do not substitute a forecast for completed test evidence.
