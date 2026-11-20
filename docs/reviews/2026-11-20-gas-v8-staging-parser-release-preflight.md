# Mohim_ERP — Apps Script V8 parser blocker found before production deployment

**Date:** 20 November 2026, Asia/Dhaka
**Repository:** shuvodelux-commits/Mohim_ERP
**Verified merged base:** a0e2e7f4b6e4242f8b6f99a9552f63922c3bb023 (PR #68)
**Existing production deployment:** version 77, still unchanged at the time of this checkpoint.

## User request and production safeguard

The owner explicitly requested deployment of all merged changes to the original Google Apps Script ERP. The pre-release inspection found a 12-commit difference between previously deployed version 77 and the current GitHub main. Production's configured `.clasp.json` refers to the live container-bound Apps Script project; repository documentation expressly forbids root-level push until copied-workbook acceptance. No live code/Sheet change was made.

A copy of the currently deployed version **77** was captured read-only via `clasp pull --versionNumber 77` in local `/home/shoaib/apps-script-prod-backups/2026-11-20-before-pr68-v77/` (85 Apps Script remote files plus the local configuration). Preserve this for rollback; never commit IDs, credentials or customer/business records.

An independent **new private, synthetic spreadsheet-bound QA Apps Script project** was created. Its script ID was verified distinct from production, and its staging manifest restricts webapp access to `MYSELF`. An initial isolated `clasp push --force` failed with **Google Apps Script parser error:** `ParseError: Unexpected token ILLEGAL line: 185 file: OversoldSaleReturnSettlement.gs`. The exact source uses a BigInt numeric literal `2n`, which Node's V8 accepts but Google's Apps Script source parser rejects. Eight or more other BigInt uses existed in the newly merged financial modules.

## Fix in this PR

Remove all BigInt usage from `.gs` accounting sources: `StockLots.gs`, `PurchaseSettlement.gs`, `PurchaseSettlementJournal.gs`, `ProfitOversoldCosts.gs`, and `OversoldSaleReturnSettlement.gs`. Replace with fixed-integer half-up cents arithmetic using quotient/remainder decomposition to minimize overflow. Reject any inputs that cannot be proven safe with `Number.isSafeInteger` — never guess cents or fall back to mutable purchase master price. Validate cumulative return reversal cost at each intermediate step. Original sale-provisional versus actual replenishment COGS stays unchanged semantically.

TDD test suite `tests/gas_v8_integer_paisa_compat.test.js` first failed 10/10 cases on the original merged source, then 10/10 passed after changing it. It also scans all backend `.gs` for unsupported numeric literal/constructor use and cross-checks fractional rounds against exact BigInt arithmetic **only inside Node tests**. The source changed here has no live Schema/Finance/Party mutations and does not alter two release flags.

**Critical separate validation:** with the patched Apps Script files, the private staging project's `clasp push --force` completed successfully (55 `.gs` + 37 `.html` source files and manifest). Thus the initial parser blockade is fixed at the actual Apps Script source-upload gate. `clasp run __nonexistent_readonly_probe_` reported that the connected account could not execute functions through the Apps Script API. A successful upload alone is NOT a live Sheet accounting test.

## Remaining production acceptance gates

1. Enable or otherwise provision authorized read-only/test execution on the isolated synthetic spreadsheet, verify bound script and sheet identities, and run source-specific real `SpreadsheetApp`, ScriptLock, Cash/Bank/Customer/stock, and after-commit failure scenarios. Never use production IDs as a test target.
2. Reconcile an actual copied/synthetic workbook for the two new audit journal/event pairs (legacy both-absent case vs partial pair, duplicate/committed/unknown rows); verify application access after the unconditional PR #68 quarantine guards.
3. Obtain independent accounting approval for purchase-wide discount and historical profit-period rules, and QA approval for remaining unsupported funded-return types.
4. Only after these gates and an exact-commit GitHub CI pass, approve an isolated production-code release that retains both financial release flags FALSE unless separately authorized to enable them. Use a deployment update preserving the existing production URL and recorded rollback version 77.

**No live production `clasp push`, deployment update, or original Google Sheet writes were performed for this parser fix.**
