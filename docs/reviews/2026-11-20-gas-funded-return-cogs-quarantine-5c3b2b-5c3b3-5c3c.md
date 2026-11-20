# Mohim_ERP — 2026-11-20 source-linked Sales Return execution, cost reversal and write quarantine

**Repository:** shuvodelux-commits/Mohim_ERP (original Apps Script V8 + Google Sheets).
**Base:** GitHub `main` at `77ef0ec69559a6ca30a973137ce6b2974d67dfbe`; PR #66 already merged before this task started.
**Scope:** Task 5C3B2B (restricted funded Sales Return writer), Task 5C3B3 (reversal-aware COGS), and Task 5C3C (cross-module uncertain-operation quarantine).
**Deployment:** NONE. `CONFIG.FUNDED_RETURN_WRITER_RELEASE_APPROVED === false` AND `CONFIG.PURCHASE_SETTLEMENT_WRITER_RELEASE_APPROVED === false` are unchanged. No existing shop, invoice, customer, Cash Book or live Sheet was touched.

## Independent code/accounting QA of the merged #66 foundation

The reported GitHub PR #66 merge and required CI were verified. That merge did **not** include a recorded independent human review. The source files and existing source-ledger tests were re-opened and inspected, including `StockLots.gs` source restoration, `SalesReturn.gs` native financial posting, `FundedReturnJournal.gs` idempotency/receipt constraints, `ProfitOversoldCosts.gs`, and receipt/movement test fixtures. This run adds independent regression scenarios rather than asserting that source-only tests constitute human/accountant approval or real Sheets atomicity.

Confirmed issue #66 could not alone solve: the effective cost overlay assumed every committed purchase settlement remained outstanding. After a legitimate funded return, `SALE_ITEM_LOTS.Quantity` is lower, but the original immutable settlement is untouched. The pre-existing overlay therefore incorrectly fails with a quantity mismatch. Correct accounting must subtract only source-verified committed return-reversal quantities and their cumulative paisa delta, preserving original sale-time source.

## Task 5C3B2B — Native funded Sales Return writer, disabled-by-default

`FundedReturnWriter.gs` and a guarded branch in `SalesReturn.gs:completeReturn` execute only if the code release flag **AND** `Funded Oversold Return Enabled=true` tenant Settings are both present. Under the **original caller-owned ScriptLock**, existing `returns:add`, Cash Session and resolved transaction date preamble remain enforced.

The writer recognizes an original invoice's OVERSOLD source with **already committed genuine purchase funding**. It deliberately supports **one physical standard product with one original SALE_ITEM_LOTS OVERSOLD source**, Cash or Store Credit, a stable single-return operation ID, and Store Credit to an **existing** authorized customer. It refuses split-payment invoices, bundles, multiple return lines, mixed source lots, purchase-wide discounts with undefined actual-cost attribution, uncertain journals, and returns that would reverse only unfunded negative stock. Those unsupported variants remain on the legacy safe rejection path; no dummy RETURN lot or invented cost is permitted.

Read-only `prepareSalesReturn_` still determines the original effective discounted sale price, quantity available for return, and economic refund amount. The linked `planFundedOversoldSaleReturn_` is revalidated against actual purchase/lot/source/journal records before the first business write. A new `FUNDED_RETURN_JOURNAL` reservation (`Writing`) precedes the original Sales Return header, Product Current Stock increase **once**, source-specific old negative lot and actual positive purchase lot restoration, source sale-item-lot net quantity, immutable reversal event(s), one original Sales Return Items row and source-lot Stock Movements, and **either** one Cash Book refund debit or one Store Credit/customer due/ledger credit. Journal stages advance under lock.

All source-linked reversal events remain immutable after their status switches from Writing to Committed; their IDs, returned quantities and actual purchased cost reference the original source event. The strict `verifyFundedReturnReceipt_` must independently reconcile every header/item, source lot quantity, stock movement and signed cash/customer account before the operation is marked Committed. Any unknown result of an append/update (including a timeout *after Sheets committed the row*) stays or becomes **Needs Review**; neither the same operation nor new Cash/Store Credit is posted again automatically.

`returns.html` now retains a stable request fingerprint/operation ID on every single-invoice Sales Return, rather than only invoices using split payments, without changing the existing edit/delete operation flow.

**Important:** The writer's first persistent financial effect is the Writing journal. Native `generateId_` may advance a document-property **ID counter** before that reservation; an unposted counter gap is non-financial and cannot authorize posting money.

## Task 5C3B3 — Actual minus provisional COGS after verified funded returns

`ProfitOversoldCosts.gs` reads only existing, schema-verified reversal and funded-return journal sheets. If the pair does not exist on an original legacy workbook, it retains prior behavior without auto-creating Sheets; if only one exists, it fails closed. A committed reversal requires the exact immutable purchase settlement ID, original sale invoice and product, actual purchased lot/provisional price, original purchased unit price, unique return ID and operation with Committed journal/receipt, un-cancelled return document, matching Return Item quantity, correct canonical quantity scale and cumulative paisa math.

**Formula per source settlement:**

```
effective source COGS delta
  = (original actual purchase COGS - original provisional sale-time COGS)
    + sum(committed, source-verified reversal COGS deltas)
```

A return of 5 Foot from a fully funded synthetic 229-Foot old OVERSOLD sale at provisional ৳68 and actual ৳64.75 reverses **৳16.25** of the original favorable COGS variance. Source sale-item net quantity becomes 224, new actual purchase lot remains available with 5 additional Foot, original negative remains zero, and the historical sale-period Profit report now reflects exactly 224 funded Foot. For a partial restoration of 105 Foot when 100 remain negative, old debt goes -100→0 and only 5 actual-funded Foot is reversed, leaving 124 funded sold Foot. Repeated fractional 0.01-unit returns use cumulative rounding; no per-return paisa rounding drift accumulates.

The Profit/Dashboard cache namespace is versioned, and its derived generation was already wired to the new audit sheets by PR #66. Return adjustments are attributed to the **original invoice period**, consistent with the original Sales Return model; report-date policy must still be signed off by the owner/accountant.

**Nothing rewrites original `SALE_ITEM_LOTS.Unit Cost`, original sale price, customer Cash receipts or historical purchase lots as invented values.**

## Task 5C3C — cross-module unknown-operation freeze

A new `TransactionUncertaintyGuard.gs` performs a **fresh, uncached, direct `SpreadsheetApp.getSheetByName` read under the caller's existing lock** of Purchase Settlement Journal and Funded Return Journal; a missing optional sheet in a legacy ERP is read-only safe while its release flag is disabled. Missing required state/receipt headers, duplicated operation or receipt IDs, non-Committed or malformed Committed journal entries, or readback uncertainty block new stock/money writes.

It is called before the first business write (after the existing authorization checks) by: POS completion and draft-posting cleanup, sales invoice edit, purchase creation/edit/return, single/batch/update/delete Sales Return, customer payment/advance refund, supplier payment, expenses add/edit/cancel, finance money transactions, bank transfer, Cash Session start/close, and manual stock-lot cost corrections. The normal business read/report endpoints remain available for reconciliation. A further direct source guard refuses purchase edit/return if it already funded historic OVERSOLD sales; and refuses Sales Return edit/delete if it has committed linked reversal events. No single owner can silently erase those cost sources through a legacy form.

The guard deliberately blocks globally when source/money outcomes are uncertain; fine-grained business-isolation and copied-Sheets manual repair are later improvements and must not be guessed.

## Superpowers TDD verification

- New reversal-aware source COGS tests were RED on the previous overlay. They cover full/partial/multi-price returns, missing or duplicate events, incorrect actual/provisional unit cost, altered return receipts, invalid quantity and paisa reconciliation.
- New cross-module read-only gate tests were RED, then GREEN; a full-suite run caught permission-order masking in POS draft conversion, repaired by moving the POS gate to **after** draft authorization and **immediately before** the actual posting/cleanup boundary.
- New real-`completeReturn` in-memory GAS integration tests were RED before adding the restricted writer. They cover exact real sale preparation, Cash and Store Credit, repeated returns, previous operation idempotency, partially funded old negative stock, fault injection after Purchase/Return header, stock/Sale Item Lots updates, immutable reversal status and append, return item/movement, Cash and Customer Ledger, journal reservation/stage, and source-linked original-period COGS after commit.
- Native purchase and funded-return flags are verified false in `Config.gs`. No production release activation, `clasp push`, Schema/Repair or historical backfill in this PR.
- **Full local Node regression:** 1,089/1,089 tests passed, zero failures, using an on-disk TMPDIR (the connected machine’s /tmp tmpfs was nearly full). Native V8 source syntax parser checks passed. Exact-head GitHub CI and independent human review remain to be verified on the PR. A mocked Sheets/in-memory test is **not** a production deployment or real Apps Script `SpreadsheetApp` fault-injection proof.

## Hard blockers before activation

1. **Refund coverage:** single-source funded returns with *only unfunded* stock, bundle/multi-line/partial supplier sourcing, split-payment returns, batch returns and source-linked refund edits/deletes remain deliberately blocked. The existing legacy generic path must **never** skip those checks or create fallback lots.
2. **Original purchase-wide discount allocation:** on a funded batch with a purchase-level discount, the correct COGS allocation to each lot remains an owner/accountant decision. The current source code fails closed rather than silently assigning a made-up effective purchase cost.
3. **Cross-module scope review:** confirm less common write endpoints, bulk imports and batch adjustments cannot alter the uncertain books outside the core protected native handlers. The conservative global guard prioritizes business calculations over availability.
4. **Readback after later legitimate operations:** the strict committed receipt replay of an old refund may be insufficient after later stock/customer activity. Returning Needs Review is preferable to paying twice, but operator recovery/long-term reconciliation workflow needs a separate audited implementation.
5. **Real copied workbook QA:** explicit dedicated audit sheet creation on a backed-up **copy**, an isolated GAS deployment, real lock/cache/readback/quota tests and injected uncertain Google Sheets outcomes. Independent accounting, Security, Super QA and user-approved release flag activation are required before any live deployment.

**Review decision:** This code can be reviewed/merged as **inactive source** after full CI and independent review. Neither release flag is activated by this source-only merge; the actual business deployment remains separately controlled.
