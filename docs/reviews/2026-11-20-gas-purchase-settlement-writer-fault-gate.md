# Mohim_ERP — Task 5C2: Native Google Sheets purchase-settlement writer, locked behind release gate

**Date:** 2026-11-20 (Asia/Dhaka)
**Repo:** `shuvodelux-commits/Mohim_ERP` (original Google Apps Script + Google Sheets ERP, not SherERP_Cloud)
**Starting main:** `6b4f02d45a1317d5cbd0695af026601abee143e6`; PR #62 verified merged into actual `main`
**Status:** native writer and fault-injection tests implemented; **disabled by default, no live deployment, no historical business-data change**. This PR does **not** authorize turning on settlement or claiming 100% complete financial reporting.

## 1. Verified source cause

`Purchase.gs:createPurchase` validates supplier/cart/payment under ScriptLock, creates a purchase header, increases `Products.Current Stock` by bought quantity Q, creates a gross positive purchase lot Q, books stock movements and supplier/cash/bank effects. That pre-existing path does **not** fund earlier negative OVERSOLD source lots or reprice historical sale COGS.

PR #62 introduced the **read-only whole-purchase** settlement planner and SHA-256 whole-cart intent hash, but no posting code. This task connects an opt-in native purchase writer, not an alternative ERP framework.

## 2. How the gated writer works

The native `Purchase.gs:createPurchase` still acquires its existing `LockService.getScriptLock()` and performs its old permissions, cash-session, supplier, item, date, bank and amount validation. **The new path is entered only when both conditions are true**:

- `CONFIG.PURCHASE_SETTLEMENT_WRITER_RELEASE_APPROVED === true` (this PR deliberately sets it to **false**);
- `getSettingsMap_()['Oversold Purchase Settlement Writer Enabled']` is the string `true` (an additional tenant opt-in).

A setting change alone cannot activate the new path. The original purchase flow is retained unmodified when the gate is off. The purchase form now sends a stable `operationId` only on creation; an uncertain retry retains the same ID and a successful save resets it. Editing an existing purchase still calls `updatePurchase`.

After authorization and before any business row is written, the new writer:

1. Validates the canonical full-cart SHA-256 (actor, supplier, date/backdate reason, all distinct product base-unit quantities and 6-decimal tick scale, purchase and selling unit prices, discount, paid amount, method, bank, notes). Rejects sub-paisa money and unsupported quantity precision.
2. Uses direct spreadsheet read-only API to verify the journal and settlement sheets/required headers already exist. `Database.gs:getSheet_` implicitly **creates** missing sheets on read; it is intentionally **not** used for this setup gate. Real setup/repair must happen separately, on a copied workbook first.
3. Reads all relevant source stock lots, original `SALE_ITEM_LOTS`/SALES, previous committed settlement allocations and operation journals. The previously-reviewed `prepareOversoldPurchaseBatch_` validates the **entire** multi-line purchase, including original invoice dates, outstanding OVERSOLD debt, prior allocation history and net quantity. An ambiguous historic mixed positive+negative inventory state fails closed.
4. Generates one purchase ID and one new lot ID per line under the existing lock. Builds immutable offsets **before** any business write. Positive new lot `Original Quantity=Q`; its `Remaining Quantity=Q-funded`. Original negative lots move toward zero by funded quantity and retain their original provisional cost and sale links.
5. **First persistent business-related write:** one `PURCHASE_SETTLEMENT_JOURNAL` row `Writing / Reserved` with stable operation ID, whole-cart fingerprint and purchase ID. Any unknown append outcome or prior `Writing/Needs Review` operation blocks further posting. The global '*' marker conservatively blocks all new purchases while a previous outcome is unresolved.
6. Stages the original source-specific purchase effects: purchase header, one `Products.Current Stock +=Q` per distinct product and lot offsets, immutable allocation event rows, purchase items, exactly one stock movement per line, original Cash or Bank debit, supplier due and Supplier Ledger entry. Each stage advances the same journal under lock. No separate stock movement/increment for settlement.
7. Marks settlement allocation events `Committed` only after all rows and money effects are written. A **strict source receipt verifier** validates purchase header, all items and product net stock, gross and remaining purchased lots, old negative source lots, each actual/provisional unit cost and signed variance, unique stock movements, original supplier due and Cash/Bank entries. Only after exact readback can the journal be marked `Committed`.
8. A fully identical retry returns an existing receipt **only after** matching actor, entire SHA-256 cart intent and readback evidence; any modified, interrupted, duplicate or ambiguous attempt fails with `Needs Review`, without repeating cash, stock, or supplier postings. The committed replay verifier is intentionally conservative after subsequent legitimate stock changes.

**All functions use the native Apps Script V8 runtime and existing `Database.gs` repository helpers. No Node runtime ships in production.**

## 3. Numerical/source audit example (synthetic, not live data)

Previously sold genuine OVERSOLD `-229` and `-2` Foot each recorded with provisional unit cost **৳68**, followed by a new real 240-Foot purchase @**৳64.75**.

- Purchases increase product cached stock from **-231** to **+9** exactly once.
- The newly purchased source lot records **240 original / 9 available** Foot.
- Original negative source lots update **-229 → 0** and **-2 → 0**, each with distinct original invoice/source-lot references.
- Two immutable `STOCK_LOT_SETTLEMENTS` events record unit cost 6800 → 6475 **integer paisa** per Foot, including original invoice identity.
- Provisional-versus-actual COGS difference for 231 genuinely funded Foot = **+৳750.75 favorable**; no original sale price, customer Cash/Party balance or original `SALE_ITEM_LOTS.Unit Cost` is rewritten. **The final COGS/profit report overlay is still NOT IMPLEMENTED**. This example must never be applied to a live screenshot alone.

A partial restock of 100 Foot at one price followed by a second restock of 140 Foot at a different price is separately regression tested. The second operation uses committed history to fund only **131 remaining** old sold units. Each funding event retains the real purchase cost of its own batch; any beyond-debt quantity remains new owned inventory.

## 4. Superpowers RED → GREEN / fault injection evidence

- Starting `main` from merged PR #62. New journal tests initially **15 RED**, source receipt verifier **9 RED**, direct read-only schema preflight **4 RED**, and native writer integration initially **10 RED** (including correct release flag) until implementation.
- Additional RED caught a duplicate receipt/operation collision and three quantity/variance conservation errors; each was fixed and rerun GREEN.
- The journal tests simulate Google Sheets throwing both **before an append** and **after it has actually committed** the new row. They cover reservation, immutable actor+fingerprint, duplicate Purchase IDs, sequential stages, unknown stage updates, `Needs Review` and proof-of-receipt-only commit/replay.
- The source receipt tests refuse missing/duplicate purchase headers/items, invalid purchased/old stock lots, mismatched allocation events and cost math, missing/duplicate movements, wrong supplier due and double Cash/Bank posts, invalid bank IDs and invalid cent precision.
- The real `createPurchase` integration (simulated in-memory Sheets and real native handlers) checks 240/-231 allocation, 2-product purchase, exact Cash/Supplier totals, one-receipt replay, changed-cart rejection, absent sale link, previous unknown operation, failures at purchase header, stock update, settlement event, purchase items, Cash append and Supplier Ledger append, partial multi-purchase restocks, bank and zero-paid paths, and disabled release flag.
- The frontend operation-ID contract verifies the same ID is reused until a confirmed success. This is **not** a real browser/copy-workbook validation.
- First full local Node suite failed **only** because the CachyOS `/tmp` tmpfs was 100% full with temporary build caches. After clearing the rebuildable `/tmp/node-compile-cache` and running with `NODE_DISABLE_COMPILE_CACHE=1`, full suite: **970/970 passed, zero failures**.
- Fresh exact-commit GitHub Actions, independent code review, and copied-workbook Apps Script preview still must pass before production approval.

## 5. Hard blockers before enabling flag or live deploy

1. **Task 5C3 profit accounting:** effective final COGS and gross margin/profit must include the exact source-linked actual purchased costs **once** after settlement, preserve the original provisional sale-cost evidence, and define whether purchase-wide discounts alter actual batch COGS. Reporting date and cumulative rounding policy require explicit accounting signoff.
2. **Funded sale return handling:** `SalesReturn.gs` currently **blocks** a return touching any already-funded OVERSOLD source. That prevents silent double-counting but is not a finished refund/COGS reversal workflow. Purchase return/edit/delete must also be rechecked against committed event links and later consumed portions.
3. **Global interrupted-operation isolation:** an unresolved source purchase may have partially changed product stock, supplier due, Cash Book or Bank Book. The new journal blocks subsequent **purchase** writers, but other Sales/Returns/Finance writers are **not yet quarantined** by this journal. Do not enable until those paths refuse affected uncertain records, or an equivalent reviewed recovery mechanism is implemented.
4. **Full source readback and copied-workbook fault injection:** Apps Script `SpreadsheetApp`, `PropertiesService`, cache invalidation, bank payment, ScriptLock timeouts and unknown Sheets write results must be exercised on a backed-up **copy** with explicit authorized setup. No current Node test proves 100% real Google Sheets operation atomicity or Apps Script deployment compatibility.
5. **Historical data repair and migration:** never infer a missing -2 Foot or restock cost from a screenshot. A historical ledger/lot repair requires a separately exported complete real business dataset, item-level source lineage, dry-run reconciliation and human approval.

**Decision:** Keep `PURCHASE_SETTLEMENT_WRITER_RELEASE_APPROVED = false` in this PR. Merely merging the PR does not activate the new writer or change live data. After Task 5C3 and real preview gates, review a separate tiny release-flag PR and separately approve deployment.
