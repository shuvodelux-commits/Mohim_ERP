# Mohim_ERP — Actual Apps Script and Google Sheets production-release acceptance evidence

**Date:** 20 November 2026 (Asia/Dhaka)
**Repository:** `shuvodelux-commits/Mohim_ERP`
**Merged source SHA:** `d47a3fb697df2d49f74f69d94ed8cf1debe90098`, PR #69 already merged into `main`
**Existing live Apps Script webapp:** deployment **version 77**, unchanged
**Production state:** **NOT RELEASED.** No live `clasp push`, deployment update, setup/repair, balance import, Cash/Bank/stock/customer mutation, or feature-flag activation.

## Which project documents authorize release work?

- `AGENTS.md` requires validation-before-write, lock/permission/Cash Session invariants, and real Apps Script/GSheets evidence for runtime behavior. Static/Node tests alone cannot prove services or financial postings.
- `PROJECT.md` contains original FIFO/OVERSOLD, source-ledger, session, return and delete/accounting rules; its recent source changes remain subject to the original module contracts.
- `docs/phase6-multi-payment-clone-acceptance.md` explicitly warns that the repository-root `.clasp.json` targets **production**. It requires a **separate, verified, private bound Spreadsheet and Apps Script** plus copied/synthetic Cash/Bank/Sale/Return tests and a positive release gate before production pushes.
- `docs/reviews/2026-11-20-gas-v8-staging-parser-release-preflight.md` records the real Google-side `BigInt` parser failure, the PR #69 fix, and outstanding financial readiness criteria.

## Verified environment identity, without exposing IDs

1. Original source `main` at `d47a3fb697df2d49f74f69d94ed8cf1debe90098`, with both `CONFIG.PURCHASE_SETTLEMENT_WRITER_RELEASE_APPROVED=false` and `CONFIG.FUNDED_RETURN_WRITER_RELEASE_APPROVED=false`. No changes made to these flags.
2. The connected owner's Apps Script API `projects.get` proved the production script is bound to a Google Sheets file. Its bound parent is **not** the synthetic QA workbook; no sensitive ID, file title, customer row or access token was printed in the evidence.
3. Existing production `clasp deployments` identified its webapp deployment at version **77**, unchanged as of this verification.
4. Production version 77's existing source was backed up via read-only `clasp pull --versionNumber 77` in the owner's local `/home/shoaib/apps-script-prod-backups/2026-11-20-before-pr68-v77/`. The backup contains 85 downloaded source files plus the local source project configuration; do not commit or share its script ID.
5. An **entirely new** synthetic spreadsheet-bound Apps Script project was created in private staging. The script and spreadsheet IDs were verified distinct from production. Its manifest restricts `webapp.access=MYSELF` and `executionApi.access=MYSELF`, and an independent private `clasp deploy` version 1 was created (not the public ERP webapp). Only this private QA workbook was shared between the two authorized Google accounts used for inspection; no production access was changed.
6. The staging script's pushed code was pulled back via `clasp pull`: all 55 `.gs`, 37 `.html` file contents matched the staged source before addition of the strictly staging-only `QACloneReadOnly.gs` probe. No QA probe has been added to the GitHub production source.

## Actual Google Apps Script runtime and real Google Sheets results

The private synthetic QA workbook's Sheet1 read-only custom formula **actually executed Apps Script V8** and obtained:

| Real synthetic QA scenario | Real Apps Script / Sheet result |
|---|---|
| GAS V8 integer-paisa cost `229 Foot × ৳64.75` and bound-book read | `QA_PASS:V8_COST_AND_READONLY_SHEETS` |
| Both purchase and return audit pairs absent, code release flags off | `CLEAR` |
| Purchase Settlement Journal exists, event sheet missing | `NEEDS_REVIEW / MISSING_OR_PARTIAL_LINEAGE_SHEETS_PURCHASE_SETTLEMENT_JOURNAL` |
| Genuine matching synthetic Committed purchase journal + settlement event | `CLEAR` |
| Same source settlement event edited to Writing after committed journal | `NEEDS_REVIEW / UNCOMMITTED_LINEAGE_EVENT_STOCK_LOT_SETTLEMENTS` |
| Restored Committed event | `CLEAR` |
| A second row duplicates the original settlement event ID | `NEEDS_REVIEW / DUPLICATE_OR_MISSING_EVENT_ID_STOCK_LOT_SETTLEMENTS` |
| Removed duplicate source event | `CLEAR` |

These were checked via actual native Google Sheets values/formulas, not local fake Sheets. The QA workbook is left with **one internally consistent, synthetic committed journal/event pair**, an entirely absent return audit pair, and a passing current journal guard. It contains no real customer or live stock information.

**Interpretation:** the new transaction guard's source-lineage fail-closed behavior is verified in real Apps Script for the above controlled conditions. **No real financial transaction has been posted in GAS**, so this is not proof that the native purchase, Sale Return, Cash Book, Customer Ledger, Stock Lots or Profit E2E flows are safe in production.

## Why the full production release gate remains blocked

An owner-only staging `executionApi` deployment was created. Nevertheless `clasp run QA_GAS_STAGING_GUARD` returned an authorization/permission error. The caller's OAuth app and the script project need compatible standard Google Cloud project configuration and an enabled Apps Script API for `scripts.run`, not merely an API executable deployment. Do **not** change the real production project to fix this staging limitation.

Therefore the required original-project **real ScriptLock, actual stock/cash/customer/supplier/Bank writes and after-commit fault matrix** remains unexecuted. More specifically, the owner has not signed off on purchase-wide discount allocation and original-vs-return-period COGS; split-payment, bundle/multi-source, batch, unfunded-only and generic source-linked correction variants remain intentionally unsupported in the restricted funded-return writer. The unconditional journal guards also need a read-only audit of production's current actual journal/event sheet pairs before a code-only upload; a partial audit pair can block ordinary POS/Finance operations on deployment. Never infer this from the staging workbook.

**Important:** do not assume that `setupSystem_()` or `getSheet_()` reads are safe on production. They can auto-create/modify Sheets and must not be run just to inspect journal headers.

## Next strictly ordered release procedure

1. Establish the bound production Sheet ID from the Apps Script API (already verified privately), then read **only its four audit sheet names, required headers, and journal/event statuses** through a verified read-only authenticated Sheets channel. Do not print customer records or copy the real workbook outside authorized owner storage. If any audit pair is partial/ambiguous, stop release and prepare a separate reviewed migration/recovery plan. No auto-repair.
2. Complete private staging native action acceptance on synthetic book: cash-only and Store Credit returns, old negative/partially funded lots and actual replenishment COGS, Cash Session enforcement, Sales/Purchase source readback, customer/supplier ledger and Cash/Bank account reconciliation, and exact after-commit/duplicate-request fault injection. Record expected and observed quantities and integer-paisa totals independently.
3. Obtain independent human QA/security/accounting review including explicit owner policy decisions for purchase discounts and original sale/return reporting period. Document accepted unsupported workflows.
4. Verify the **exact merged `main` SHA** in full Node, mocked browser and real Apps Script parsing; preserve version 77 backup and deployment rollback route. If all checks pass, build a **detached production source package**, verify its `.clasp.json` is the previously confirmed production script, and update the **existing** deployment ID rather than create an unrelated URL. Keep both financial release flags `false` and tenant Settings unchanged.
5. Post-release confirm real shop login, all module screens, original customer/supplier balances, Cash/Bank/stock reconciliation, POS non-financial operations and production deployment version. If discrepancies appear, restore deployment 77 (and reconcile any partial actual financial writes separately). Turn on financial writers only in a new separately approved PR after dedicated migration and recovery readiness.

**Release verdict:** **NO-GO** until steps 1–3 are complete. The user's explicit intent to deploy has been respected through readiness checks, source and staging verification; a dangerous unverified production upload has not been mistaken for a successful deployment.
