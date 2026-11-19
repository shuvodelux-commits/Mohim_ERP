# Mohim_ERP GAS Oversold Lots / FIFO Cost Parity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Make original Google Apps Script ERP show genuine FIFO purchase cost, resolve oversold lots on replenishment, prevent false negative valuation and preserve sale/return/accounting integrity.

**Architecture:** Stage a standalone source-specific fix across audited PRs: server-side pure lot snapshot first, then permission-gated Products/POS read model, then a strictly planned and journalled purchase settlement under Apps Script ScriptLock, followed by source-linked returns and historical repair dry-run. Never copy Cloudflare/D1 modules directly into GAS.

**Tech Stack:** Google Apps Script V8 (.gs), Google Sheets, existing HTML/CSS/JS, Node built-in test runner, Github Actions, clasp preview.

**Spec:** `docs/superpowers/specs/2026-11-20-gas-oversold-lot-cost-design.md`

## Global constraints

- Repo `shuvodelux-commits/Mohim_ERP`; source baseline `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; follow `AGENTS.md`, `PROJECT.md`.
- Work in isolated `fix/gas-lot-cost-oversold-20261120` worktree; never modify `main`/live clasp directly; no deploy or historic data change in PR.
- Preserve sale price, multiunit, bundles, cash and supplier/customer ledgers, negative stock, vendor sourcing, purchase editing and returns; settlement itself must not change Products.Current Stock.
- Do not hide negative valuation via clamping or fake a missing two-foot stock lot.
- Cost can be sent to POS only with server-side setting **and** `posCost:view` permission.
- Every task needs an observed failing test, minimum implementation, passing tests, refactor and retest; all 812 baseline Node tests must remain green.
- Preview before production, backed-up source spreadsheet and owner-approved migration/repair.

## Review focus

1. +240/-229 only implies 11 Foot; a product cache of 9 yields Needs Review rather than an invented -2 lot.
2. +240/-231 implies 9 eligible Foot with FIFO cost 64.75, never gross 240.
3. Multiple active positive lots, returns, fractional Foot or tile conversions must not fabricate source allocation.
4. Privilege denied: no purchase cost nor any lot cost tier in POS network payload.
5. Retrying a partial Sheet write must not double-offset historical OVERSOLD or replay a Cash/Party transaction.

## Stage A — Read-only preview / display (initial PR)

### Task 1: Audit/lot FIFO read model

**Files:**
- Modify `StockLots.gs` to add `buildLotCostSnapshot_(productId, lots, productRow)`.
- Test `tests/oversold_lot_fifo_cost_read.test.js`.

**Interface:** Pure read model; returns `{status,netQty,unresolvedOversold,nextUnitCost,costTiers,projectedStockValue,originalStockValue}`. `costTiers` are ordered `[{qty,unitCost}]`. Does not post or mutate.

- [ ] Write tests for +240/-231, +240/-229 with cache 9 mismatch, normal multi-FIFO supplier lots, source-date inversion, missing costs, deleted lots and no-lot product.
- [ ] Run `node --test tests/oversold_lot_fifo_cost_read.test.js` → see an expected behavior failure.
- [ ] Add the minimal pure helper, using existing `compareLotsFifo_` and sale source rules.
- [ ] Re-run focused and all `node --test tests/*.test.js`; no regressions.
- [ ] Commit Task 1.

### Task 2: Products cost/valuation UX with correct review status

**Files:**
- Modify `Products.gs:getProductsBootstrap` only to use Task 1 read model; preserve existing bundle/no-lot logic.
- Modify `products.html` Purchase table rendering, sorting, and the valuation review indicator.
- Test `tests/oversold_lot_products_ui.test.js`.

- [ ] RED test: next FIFO cost is 64.75 instead of master 68; unposted oversold data show Stock Value **Needs Review**, not negative -168 nor unearned +582.75; inconsistent 9/11 explicit warning.
- [ ] Run targeted test and observe failure; make minimum server+client changes.
- [ ] Re-run tests and check keyboard/table mobile layout; no unrelated redesign.
- [ ] Commit Task 2.

### Task 3: POS privileged FIFO cost without leak

**Files:**
- Modify `Sales.gs:getPosBootstrap`; preserve existing POS show-price / posCost permission double gate.
- Modify `pos.html` cost reveal to show quantity-weighted FIFO cost when multiple eligible lots, with explicit estimated/beyond-stock handling.
- Test `tests/oversold_lot_pos_cost_permission.test.js`.

- [ ] RED tests for one Foot 64.75 vs master 68, mixed two-lot cart, 10 requested/9 available, and no cost response when user unauthorized.
- [ ] Run targeted test, confirm RED, implement minimal server/client adapter, rerun.
- [ ] Run all Node tests and existing POS server/UI security tests.
- [ ] Commit and open PR Stage A; independent Super QA/Review before merge.

## Stage B — New purchase automatic settlement (subsequent scoped PR; requires Stage A review)

### Task 4: Pure purchase settlement and recovery design

**Files:** `StockLots.gs`, `Config.gs`, `Setup.gs`, `tests/oversold_lot_purchase_settlement.test.js`.

- [ ] RED for 240 bought / 231 debt -> 9 remaining; zero net change on settlement; partial purchase; multiple costs/debts; backdated purchase; identical operation replay; corrupted source IDs.
- [ ] Plan allocations before writes, store source and operation evidence in additive `STOCK_LOT_SETTLEMENTS` audit schema; ledger pending/finished/recovery states and unique link provenance.
- [ ] Test write-failure retry after each row update with isolated fake Sheet ledger and reproducible recovery, not just pure numeric assertions.
- [ ] Validate relevant return dependency gates and full suite, then PR.

### Task 5: Integrate into purchase / sale / return workstreams

**Files:** `Purchase.gs`, `StockLots.gs`, `Sales.gs`, `SalesReturn.gs`, `PurchaseReturn.gs`, `PurchaseManagement.gs`, appropriate tests.

- [ ] RED integration for purchase posting with lock, lot settlement and stable cash/supplier balances.
- [ ] RED sale/return tests: original negative sale restored after funding, supplier return of only unsold positive, purchase edit/deletion blocked against settled stock.
- [ ] Implement only after immutable source links, pre-write validation, crash recovery and full tests.
- [ ] Full node suite and clasp preview against copy of Google Sheet; owner review and approval before deployment.

## Stage C — Source historic repair and acceptance

### Task 6: Read-only historical audit/export and human-approved repair proposal

- [ ] Export verified Products, Stock Lots, Sale Item Lots, Purchases, Stock Movements and Returns from a backup/copy; audit ALL lots for target product and affected products.
- [ ] Generate before/after quantity/value/COGS variance diff and Needs Review queue; no write on dry-run.
- [ ] Repair old records only after owner approves diff and a recovery test proves rollback; journal every changed original row and corresponding reason.
- [ ] Confirm screenshot case and other mismatched SKUs; no source row guesses.

## Gate sequence

Stage A PR review → Stage B PR review → full source-accounting QA → preview clasp deployment to an **isolated** script ID + copied Sheet → user acceptance → authorized live deploy → separately authorized historical backfill. No automatic deployment on merge.
