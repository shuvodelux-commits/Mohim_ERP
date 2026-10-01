# SherERP Clean Customer/Supplier Ledger Report

Date: 2026-09-09

## User-facing rule
Customer Ledger and Supplier Ledger now default to a clean business statement view. Internal correction rows remain stored in Google Sheets but are projected away from normal on-screen and printed statements.

### Example: supplier corrected Matador -> Karatoa
Raw audit remains:
- Matador: Purchase 50,154 Debit
- Matador: Purchase Update 50,154 Credit
- Karatoa: Purchase Update 50,154 Debit

Clean Supplier Ledger shows:
- Matador: no PUR-000005 row
- Karatoa: PUR-000005 / Purchase / 50,154 Debit

### Example: repeated sale edits
Raw audit may contain Sale + Sale Update Credit/Debit chains. Clean Customer Ledger shows one current Sale row for the final receivable amount.

## Privileged audit view
Roles named Administrator, Owner, or Manager can enable `Show corrections` on screen. The server independently enforces this restriction. Other roles cannot request raw correction history by manipulating the browser RPC.

## Printing
Customer/Supplier statement printing always uses clean view. The print RPC has no correction-mode parameter, so internal correction rows cannot be accidentally included in a customer/supplier handout.

## Safety invariants
- Raw CUSTOMER_LEDGER and SUPPLIER_LEDGER rows are never mutated by this feature.
- Real Payment, Opening Balance, Sales Return Credit, Purchase Return Credit, and Advance Refund rows remain visible.
- Projection happens before pagination, so a correction chain cannot be split across clean pages.
- Clean running balances are recomputed server-side.
- Clean closing balance must equal raw ledger closing balance; otherwise the server fails the request.
- Duplicate base transaction references and negative correction-chain anomalies fail closed by showing the raw rows rather than silently merging them.
- Same-day edited transactions keep their original base-row chronology so a later real return does not appear before the sale/purchase it belongs to.

## Production files changed
- PartyLedger.gs
- customerLedger.html
- supplierLedger.html
- style.html

No sale, purchase, payment, return, settlement, stock, cash, bank, or accounting writer was changed for this feature.

## Verification
Feature-specific / ledger suites:
- party_ledger_clean_view.test.js: 16/16 PASS
- party_ledger_workspace.test.js: 10/10 PASS
- party_ledger_ui.test.js: 12/12 PASS
- return_ledger_regressions.test.js: 8/8 PASS
- style_encapsulation.test.js: PASS
- production_gate_static.test.js: PASS

Full tests/ suite comparison under the same runner:
- Baseline: 65 files, 56 PASS, 9 FAIL
- Clean-ledger build: 66 files, 57 PASS, 9 FAIL

The 9 failing files are unchanged baseline UI/responsive acceptance failures:
- counter_acceptance.test.js
- counter_customer_receive.test.js
- counter_ui_primitives.test.js
- mobile_pwa_ui.test.js
- mockup_module_design.test.js
- pos_tablet_exact_mockup.test.js
- pos_tablet_recent_drafts.test.js
- sidebar_grouped_collapse.test.js
- tablet_responsive_shell.test.js
