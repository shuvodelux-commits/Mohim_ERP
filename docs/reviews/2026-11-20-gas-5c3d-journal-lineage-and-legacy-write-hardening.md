# Mohim_ERP GAS — Task 5C3D: Journal lineage integrity and legacy writer quarantine

**Date:** 20 November 2026 (Asia/Dhaka)
**Repository:** `shuvodelux-commits/Mohim_ERP` (original Google Apps Script + Google Sheets)
**Starting GitHub main:** `b42d1a5b41db79733145028b4ecc653ed91afe10`, verified merged PR #67
**Production deployment:** None; no clasp push, workbook copy/repair, historical backfill, or live business mutation
**Release flags:** `CONFIG.PURCHASE_SETTLEMENT_WRITER_RELEASE_APPROVED=false`, `CONFIG.FUNDED_RETURN_WRITER_RELEASE_APPROVED=false`; unchanged

## Priority P0 gap discovered after merging PR #67

`TransactionUncertaintyGuard.gs` checked the **internal state of journals** but not their original source event sheets. An operator could remove or damage `Stock Lot Settlements` or `Stock Lot Settlement Reversals` after a committed purchase/refund journal; old code could treat that as an ordinary committed operation and permit new stock/Cash/Bank/Party writes. Further, several legacy delete, manual bank, vendor, product adjustment, and financial correction RPCs were not covered by the previous quarantine.

A committed journal is **not** standalone proof that its source event still exists. Do not silently reclassify missing evidence as a clean legacy workbook.

## Read-only journal/event lineage scanner

`inspectTransactionUncertainty_` now reads and reconciles both pairs directly through `getSpreadsheet_().getSheetByName` (no `getSheet_` auto-creation, no writing, no application row-cache trust).

- Purchase: `PURCHASE_SETTLEMENT_JOURNAL` ↔ `STOCK_LOT_SETTLEMENTS`, matching `Operation ID` and `Purchase ID`.
- Funded return: `FUNDED_RETURN_JOURNAL` ↔ `STOCK_LOT_SETTLEMENT_REVERSALS`, matching `Return Operation ID` / `Operation ID` and `Return ID`.
- A missing **both** pair is a genuinely legacy blank subsystem and safe **only while its code-release flag is OFF**. A missing **one** member is an incomplete schema and fails closed whether the flag is currently on or off.
- Every journal must have a unique operation and receipt, `Committed` state/stage, a matching final receipt, and **at least one** original `Committed` event linked to its operation and receipt. Every event must have a unique nonempty immutable ID and an existing matching journal. Orphan events, mismatched receipts, duplicate IDs, pending states or altered/missing headers block new financial writes.
- Read exceptions fail closed with sanitized, fixed issue identifiers. The scanner does **not** attempt repairs, refunds, rollbacks or replays.

**Runtime caution:** these uncached source checks read entire audit sheets under the lock on every protected write. Benchmark with a copied real workbook of representative journal sizes and Apps Script quota limits **before** enabling either writer; future performance improvements must preserve the no-stale-evidence contract.

## Missing legacy financial/stock entrypoints now quarantined

Added the same server-side `assertNoUncertainTransactionWrites_` after the native user permission check and before business mutations in 35 further entrypoints across:

- `DeleteEngine.gs` — sale/purchase and bank/expense/vendor/customer/supplier/finance delete, update, correction and reversal writers. The generic Day Book dispatcher already delegates to protected concrete delete handlers and was not modified.
- `BankLedger.gs` — new manual bank adjustment and bank-entry reversal.
- `Vendors.gs` — vendor payment, returned/outgoing vendor stock and receipt flows.
- `Products.gs` — manual physical stock adjustment.
- `CashReconciliation.gs` — session reconciliation explanation write.

`deletePurchase` additionally refuses an original purchase referenced by committed OVERSOLD settlement lineage. `deleteSalesInvoice` additionally refuses an invoice referenced by committed purchase settlement or funded return cost-reversal rows, even if the sale balance has later been returned. Source invoices remain part of immutable original-period COGS evidence.

The source-linked guards operate before any financial changes and do not automatically “undo” a real purchase or return. All existing permissions, user identity and cash session validations remain intact.

## TDD evidence and verification

- New paired journal/event contract tests: missing source sheets, orphan rows, unknown and duplicate IDs, missing/duplicate headers, mismatched invoice/return ID, pending event after journal Committed, and true unconfigured legacy pair.
- New protected-entrypoint contract tests: 35 missing native RPC guards were RED before the changes, then GREEN, with explicit checks that permission is evaluated before the guard and the guard occurs before any write.
- Source-linked sale invoice deletion contract and its read-only helper were RED before implementation, then GREEN. Existing purchase mutation protection was retained.
- Existing focused tests were upgraded to include the complete source-event pairs, rather than accepting phantom journal-only success fixtures.
- **Full local Node suite: 1,104/1,104 tests PASS, zero failures** with on-disk `TMPDIR` due to the local PC's nearly-full `/tmp` tmpfs. `git diff --check` clean. GitHub exact-head CI must be recorded from the submitted PR, not inferred.

## Still required before any live activation

1. **Real copied-workbook testing:** Create a dated, access-controlled clone of the original business Sheets, confirm every expected header and ID, test multiple historical negative lots, actual refunds, partial/fractional cost reversal, Cash and Store Credit, supplier/bank totals, and Apps Script quota/locking with a fully isolated staging deployment. Read-only verification first; do not attempt live repair.
2. **Human accountant policy approval:** Determine purchase-wide discount allocation and period attribution for a backdated settlement/return. Code still fails closed where no approved cost policy exists.
3. **Independent security/QA review:** Actual GAS/Google Sheets source-linked regression, protected endpoints and failure-injection after-commit. Node mocks do not verify real Google service consistency or concurrency.
4. **Refund variant coverage:** split-payment, bundle/multi-line, batch returns, unfunded-only and source-linked return editing/deletion remain outside the restricted writer's reviewed contract.
5. **Explicit owner release authorization:** separate flag activation, controlled deployment, backup/recovery and rollback plan. This PR changes no release flag and no live data.

**Review disposition:** a source-only hardening PR is suitable for independent review after exact GitHub CI. It is **not** production release approval.
