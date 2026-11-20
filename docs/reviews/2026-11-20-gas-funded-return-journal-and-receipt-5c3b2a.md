# Mohim_ERP GAS — Task 5C3B2A: durable funded Sales Return journal and receipt verification

**Date:** 20 November 2026 (Asia/Dhaka)
**Repository:** `shuvodelux-commits/Mohim_ERP`, original Google Apps Script + Google Sheets business ERP
**Starting main:** `43418a7f1a902273b602c92dc9fe4e7996758761`, PR #65 verified merged
**Scope:** native return journal, complete refund fingerprint, read-only schema gate, pure strict single-product return receipt validator; **NOT an activated funded-return/refund writer**
**Deployment:** NONE. No live clasp push, live sheet migration or historical record changes authorized.

## 1. Exact source constraint

- PR #65 added `planFundedOversoldSaleReturn_`, a pure, `postable:false` reversal proposal. It determines which still-negative OVERSOLD quantity is reduced first, and which original real funded purchase lots (in latest-commit-first order) must be restored after a sale return. It computes source-linked integer-paisa COGS reversal amounts using cumulative rounding.
- `SalesReturn.gs:completeReturn` currently validates, writes a Sales Return, restores physical inventory through `planSaleReturnRestoration_`, and posts Cash or Store Credit. Its generic original-lot restoration **still intentionally refuses** any OVERSOLD source with settlement history. The current source-safe design cannot yet issue a paid funded refund.
- `ProfitOversoldCosts.gs` currently validates purchase settlement allocations against the net `SALE_ITEM_LOTS.Quantity`, and does not read committed sale-return reversal records. Enabling a funded return *before* that reporting overlay is updated would reject subsequent profit calculation or double-attribute historical COGS. The current purchase writer code-release flag is also still false.

## 2. New foundation (no public RPC/handler activation)

### A. Dedicated audit schemas in `Config.gs`

- `STOCK_LOT_SETTLEMENT_REVERSALS`: append-only source-linked event ID, return operation and return ID, original purchase settlement and source invoice/product IDs, old negative and real purchase lot IDs, canonical quantity ticks/scale, original provisional vs actual unit cost, cumulative-rounded returned cost and signed COGS reversal, actor, state and created timestamp.
- `FUNDED_RETURN_JOURNAL`: operation/return/invoice/product, whole-refund SHA-256, actor, Writing/Needs Review/Committed stage and verified receipt reference, timestamps/error. Unique ID prefixes declared.
- `CONFIG.FUNDED_RETURN_WRITER_RELEASE_APPROVED=false` independently freezes the new return path. `CONFIG.PURCHASE_SETTLEMENT_WRITER_RELEASE_APPROVED=false` remains unchanged. No tenant Settings edit or merge activates either path.

### B. Read-only setup gate

`fundedSaleReturnSchemaReady_` uses **`getSpreadsheet_().getSheetByName`** to test both existing Sheets and the exact required column names with no write. This matters because `Database.gs:getSheet_` implicitly **creates missing Sheets/headers even on a read**. Missing, partially created, truncated or duplicate-column schemas return a failed readiness result. Schema setup belongs in a separate copied-workbook preview and explicitly approved admin setup, not a purchase or refund preflight.

### C. Durable idempotency journal

`FundedReturnJournal.gs` contains private helpers:
- `fundedReturnJournalDecision_`: `NEW` only if no previous uncertain funded return; `REPLAY` only when the same operation, actor, invoice, physical product, return ID, complete SHA-256 cart hash, **Committed** receipt and source-specific verification all match; otherwise `NEEDS_REVIEW`.
- `reserveFundedReturnJournal_`: under caller-owned ScriptLock, durable Writing/Reserved journal append **before any eventual stock, return or money write**. An append that throws *after Google Sheets already recorded it* stays uncertain, without blindly appending again.
- `advanceFundedReturnJournal_`: strict sequential stages: Reserved → Return Header → Stock And Source Lots → Reversal Events → Return Items And Movement → Refund. A failure after a stage write is Needs Review; no duplicate stage replay.
- `markFundedReturnNeedsReview_`: monotonic failure state; never overwrites an existing Committed receipt or silently repairs an unknown Cash/Customer outcome.
- `commitFundedReturnJournal_`: requires Refund stage and explicit pure receipt readback **before** Committed. Even an unknown commit update result is never interpreted as license for a second refund.

These private functions are intentionally **not yet connected to `completeReturn`**. The future caller must retain `returns:add`, Cash Session, original sale identity and exact source snapshot validation under the **existing** ScriptLock.

### D. Full original-refund intent identity

`buildFundedReturnIntentHash_` computes deterministic GAS `Utilities.computeDigest(SHA_256)` over the authenticated actor, stable operation ID, original invoice and customer, return date/backdating reason, exact physical sale source and 6-decimal base-unit quantities, refunded sale unit price, Cash vs Store Credit, refund amount in integer paisa, reason and notes. Any changed financial/security attribute changes the hash. Sub-paisa amounts or invalid quantity precision fail rather than round. The browser is not allowed to supply a trusted hash; a future server writer will derive it after native source checks.

### E. Pure source receipt verifier

`verifyFundedReturnReceipt_(snapshot)` compares the **future writer's prevalidated immutable expected plan** to freshly read, exact source rows: one Sales Return header/item with correct invoice, return operation, customer and refund total; original net `SALE_ITEM_LOTS` source quantity and provisional cost; exact signed stock lots summing to `Products.Current Stock`; original committed purchase settlement and actual bought lot cost; unique committed source-linked reversal events and signed COGS cents; one stock movement per actual restored source (summing to the return quantity exactly); and **either** Cash refund `Debit` or Store Credit `CUSTOMER_LEDGER.Credit` with exact customer balance, never both. Unexpected/duplicated rows, wrong source purchase ID, malformed cent precision or a write not proven on readback fail closed.

It is intentionally conservative after later legitimate stock/cash activity: an uncertain historical receipt requires reconciliation, never a second refund. This verifier does NOT claim Google Sheets multi-row atomicity or safe retroactive corrections.

### F. Cache invalidation

`Database.gs:invalidateDerivedCachesForSheet_` now invalidates Profit/Dashboard derived generation for writes to either new audit sheet, preventing a future verified reversal from being hidden by an old cached provisional-profit calculation. **The reversal overlay itself remains a separate unfinished task.**

## 3. Superpowers RED → GREEN

- 11 journal cases initially RED on missing functions, then GREEN, plus a later RED for a malformed *unrelated* Committed receipt that might have permitted a new refund.
- 5 schema/gating cases initially RED, plus one Profit cache generation test.
- 9 strict receipt cases initially RED, then passed; additional RED caught duplicate reversal IDs across other return documents, mismatched source movement amounts and incorrect sign of customer Store Credit balances.
- 4 whole-refund payload fingerprint cases initially RED.
- The final focused suite passes **35/35** new cases. Full repository regression suite and exact-head GitHub Actions results must be separately recorded from the actual PR.

## 4. Execution order to finish safely (do not skip)

1. **Task 5C3B2B — source-native, journalled single-item funded Sales Return writer.** First revalidate all ordinary `prepareSalesReturn_` refund/pricing, customer/cash session, current stock and immutable funded source under ScriptLock. Reject bundles, mixed source lots, split-payment and batch return cases that have no proven supported plan. Assign unique server receipt and reversal IDs; reserve the journal; then stage the *exact* original Sales Return header, Product Current Stock += R once, old debt and real funded purchase lots, net sale-item consumed qty, immutable reversal events, Stock Movements, original Cash or Store Credit ledger posting. Test faults before AND after each append/update. Never auto-retry unknown money writes. Read back all sources before committing.
2. **Task 5C3B3 — effective COGS and Profit reverse overlay.** Source-verify committed reversal rows against immutable original settlement events and prior returns, apply cumulative-rounding returned COGS corrections without touching original sale-time cost. Original sale-period Profit and Dashboard must agree under full/partial/multi-cost/fractional returns.
3. **Task 5C3C — cross-module interrupted-write isolation.** A Writing/Needs Review purchase or funded return may already have changed stock or cash while other Sales/POS/Purchase/Return/Finance endpoints remain writable. Production activation MUST block those overlapping actions, or introduce separately reviewed safe recovery and reconcile each affected row. Other legacy/batch/edit/delete return paths cannot silently undo funded allocations.
4. **Accounting and launch QA:** agree purchase-wide discount allocation, negative stock and return-date profit policy; copied actual Google Sheets dataset with real `SpreadsheetApp` failure injection, source reconciliation, independent Super QA/Security/Accounting review, GitHub CI, owner-approved **separate flag activation PR**, then separately authorized clasp deployment and historical backfill.

## Decision

This PR is safe to review/merge as **disabled internal source groundwork**, not the finished funded-return solution. It creates no actual customer refund or inventory return and changes no live data. The current intentional funded OVERSOLD return block in `StockLots.gs` remains untouched.
