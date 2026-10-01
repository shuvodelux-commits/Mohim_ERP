# SherERP Final Production Transaction Audit

Date: 2026-09-08

## Scope
Production hardening focused on confirmation-modal transaction integrity and accounting state consistency for the Google Apps Script + Google Sheets ERP.

Audited transaction families:
- POS sale, draft save/load, sale update, invoice customer reassignment
- Purchase create/update, supplier reassignment
- Customer receive/payment edit/delete, credit/refund
- Supplier payment edit/delete, purchase settlement
- Sales Return and Purchase Return
- Expense create/edit/cancel/delete
- Cash session open/close
- Bank transfer/manual bank entry
- Finance transactions
- Vendor money/stock actions
- Stock adjustment
- Day Book/delete/reversal paths
- Dashboard, Reports, invoice/ledger settlement reconstruction

## Confirmed defects fixed during the audit
1. Confirmation payload identity could drift between modal display and backend execution. Party/record IDs are frozen before confirmation.
2. Customer ID selection could be rejected because stale draft/invoice phone text differed from the current customer record. Explicit active Customer ID is authoritative; phone-only resolution remains ambiguity-safe.
3. Draft/new sale and invoice-edit customer identity paths could route to the wrong duplicate-phone customer. Exact selected Customer ID is preserved.
4. Purchase edit displayed the newly selected supplier but backend retained the old supplier. Purchase, payable, supplier ledger and stock-lot provenance now move together.
5. Targeted customer payment spillover could create false Customer Credit while another invoice remained due.
6. Supplier purchase settlement/provenance was missing, causing purchase Due/Paid and refund-capacity drift.
7. Sale Update Credit correction rows were misclassified as customer payment/credit, inflating invoice Paid/Settled values.
8. Reports/returns could read stale Paid/Due values instead of reconstructed settlement state.
9. Non-cash `Other` payment edit/delete and refundable-cash provenance were inconsistent.
10. Dashboard excluded/active-row calculations were incomplete for cancelled/deleted records.
11. Customer/Supplier Ledger browser datalist search could dump the whole party list and search inconsistently. Replaced with bounded normalized combobox behavior.
12. Ledger combobox initialization could run before the shared helper existed. Initialization is now lazy.
13. Sales Return exposed client-side price authority. Return valuation is server-authoritative from the original invoice economics; UI return price is display-only.

## Fresh verification on cumulative production tree
### Browser transaction probes
- POS sale / draft / sale update: 9/9 PASS
- Purchase create / purchase update / supplier reassignment: 7/7 PASS
- Customer/Supplier ledger search + receive/pay + Expense edit: 12/12 PASS
- Sales Return / Purchase Return: 7/7 PASS
- Bank transfer / manual bank entry / Finance: 7/7 PASS
- Browser high-value assertions: 42/42 PASS

### Focused financial/confirmation gate
- 26 critical test files
- 97/97 tests PASS
- Confirmation specification matrix: 85/85 PASS
- Financial CRUD scenarios: 34/34 PASS
- Production static gate: 44 Apps Script files, 33 HTML files, 496 server functions PASS
- Published RPC security audit: 177 published functions PASS

### Full repository suite
- 168 tests total
- 159 PASS
- 9 FAIL

The 9 remaining failures are UI/responsive acceptance tests, not financial/accounting/confirmation failures:
- counter_acceptance.test.js
- counter_customer_receive.test.js
- counter_ui_primitives.test.js
- mobile_pwa_ui.test.js
- mockup_module_design.test.js
- pos_tablet_exact_mockup.test.js
- pos_tablet_recent_drafts.test.js
- sidebar_grouped_collapse.test.js
- tablet_responsive_shell.test.js

These known UI/responsive failures are not represented as fixed by this production accounting/transaction audit.

## Deployment note
This archive is a complete production snapshot. For Apps Script Web App deployment, publish a new deployment version after replacing project files. Do not manually edit financial rows in Google Sheets to compensate for historical ledger behavior unless a specific audited repair procedure requires it.
