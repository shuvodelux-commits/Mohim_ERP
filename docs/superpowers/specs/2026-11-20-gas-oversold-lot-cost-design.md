# Mohim_ERP GAS — Oversold Lot Reconciliation and FIFO Cost Parity

**Date:** 2026-11-20 (Asia/Dhaka)
**Status:** Approved problem and source-specific preparation; preview and production releases are gated separately.
**Repository:** `shuvodelux-commits/Mohim_ERP`, original Google Apps Script/Sheets ERP; do not conflate with SherERP_Cloud.
**Source baseline:** `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Existing business policy:** `AGENTS.md`, `PROJECT.md`.

## Problem

1. `products.html` renders `Products.Purchase Price` as cost instead of active FIFO lot cost; the same stale master default is sent to privileged POS users from `Sales.gs`.
2. `Products.gs` stock value is a signed sum of all lot remaining quantities, including unresolved `OVERSOLD` rows. A later purchase creates positive lots rather than settling the previous deficit, so positive on-hand stock can produce a negative Stock Value.
3. `Purchase.gs` creates a positive lot without offsetting negative lots. `planStockConsumption_` sees gross positive lots and can allocate already-committed replenishment.
4. Existing sales returns, purchase returns/edits/delete and historical `SALE_ITEM_LOTS` identities are affected by any physical lot rewrite.

## Grounded illustration (NOT a verified complete database snapshot)

Visible +240 Foot @ ৳64.75 and -229 Foot @ ৳68 => net 11 Foot, signed lot value -৳32. A displayed product Current Stock of 9 Foot and -৳168 *suggest* another -2 Foot @ ৳68, but requires a full read-only stock/consumption audit. If there are 231 verified unsettled Foot and no other stock events, settling 231 leaves 9 Foot of the 240 purchase priced at ৳64.75, worth ৳582.75; provisional cost variance is ৳750.75. Never use these inferred numbers in a real data-repair script.

## Approaches

- **UI masking only:** replace negative stock valuation with 0 or reuse the current product master price. Rejected: conceals the inconsistent ledger.
- **Bulk rewrite original sale allocations:** forces historical reports to match a new purchase, but loses source-invoice and return evidence. Rejected.
- **Auditable, source-linked settlement + one authorized FIFO cost read model:** chosen for the design. KISS, source native, no dependency or architecture migration. Use a controlled preview and a reversible evidence log; never silently edit historic sales or cash accounts.

## Staged implementation

**Stage A: Read-only accurate display and discrepancy audit (independent PR).** Add a deterministic `buildLotCostSnapshot_` helper under `StockLots.gs`, validating full source-shaped lot rows and cached stock before giving `nextCost`, FIFO cost tiers and a *conditional* projected value. Products shows genuine next FIFO cost and flags `NEEDS_REVIEW` instead of printing a false book value when negative debts still coexist with positive lots. POS sends cost information only if BOTH `POS Show Purchase Price` and `posCost:view` gates authorize it; the small cost reveal supports exact cart quantities across multiple FIFO lots. Preserve selling prices, inventory quantity, drafts, bundles and mobile UX. Stage A does NOT write any stocks or move any accounting money.

**Stage B: New purchase settlement under GAS ScriptLock (separate reviewed PR).** Plan complete FIFO debt allocations before beginning the first write, using purchase date + stable lot ID chronology. Book the incoming purchase at its real unit cost, then offset existing negative lots in an append-only settlement audit with operation ID, source Lot IDs and quantity. Mutating a Sheets transaction is not atomic, so include per-step pending/retry/reconciliation evidence and fail-closed guards against incomplete settlements before enabling stock posting. Verify purchase return, edit, delete and sale return paths against immutable source consumption evidence. Preserve product stock movement and product Current Stock; settlement itself has **zero net quantity movement**. No silent retroactive COGS rewrite.

**Stage C: Historical repair preview.** Export all source stock lots, sales consumption rows, purchase lines, movement rows and return history from a backed-up source spreadsheet; produce a per-product before/after report, ambiguous IDs queue, and exact rollback/restore journal. Require explicit human review before repairing old data, distinct from enabling fixes for new purchases.

**Stage D: Preview deploy and production cutover.** Use the separately configured preview Apps Script project ID; test on a copy of the Sheet, not the current live business. Full Node regression suite, permission tests, multi-unit and tile coverage, sale/return round trips, duplicate operations, mid-write crash injection and backup/restore rehearsal. Live deployment and repair explicitly require owner approval.

## Core correctness rules

- The existing `Products.Current Stock` may be a cache; sum of genuine lot remaining quantities must match it before valuations are considered reliable. Any mismatch fails with Needs Review; never invent a missing lot.
- Oversold settlement never creates or removes product total stock; it only changes outstanding negative and purchased positive lot balances in opposite directions.
- Remaining physical lots cost at their real purchase cost. Product master Purchase Price stays a reference/edit default, not a FIFO substitution.
- Historical sale revenue, payments, invoices, Party/Supplier balances, cash session and source `SALE_ITEM_LOTS` remain untouched by settlement itself.
- All cost disclosures are server-authorization gated. No unauthorized cost, projected profit or variance may be serialized.
- Existing negative stock sales, vendor shortage, bundling, mixed units, source date ordering and returns must keep working; ambiguous source provenance blocks automatic settlement.
- Sheet writes run under `LockService.getScriptLock()`, with pre-write validation and an auditable recovery path. No update to live Google Sheets in this PR.
- Use Superpowers RED -> GREEN -> refactor -> full tests -> independent QA -> owner-reviewed PR. Never merge/deploy automatically.
