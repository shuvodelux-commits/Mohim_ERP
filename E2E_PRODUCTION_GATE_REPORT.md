# SherERP Production E2E Gate — 2026-09-08

## Scope
Headless Chromium test gate using the assembled Apps Script HTML shell with a mocked `google.script.run` bridge. No production Google Sheets data was written.

## Browser E2E results
- POS sale / draft / sale update: **9/9 PASS**
- Purchase create / purchase update / supplier reassignment: **7/7 PASS**
- Customer/Supplier ledger search + receive/pay + Expense edit: **12/12 PASS**
- Bank transfer / manual bank entry / Finance transaction: **7/7 PASS**
- Sales Return / Purchase Return completion: **7/7 PASS**
- Total high-value browser assertions: **42/42 PASS**

## Browser-only defect found and fixed
Customer Ledger and Supplier Ledger initialized `createPartySearchCombobox_()` before `javascript.html` defined it in the real include order. Both pages now initialize the combobox lazily when the ledger page is entered. This removed the uncaught browser `ReferenceError` while preserving the bounded search behavior.

## Critical non-browser verification
- Critical transaction/accounting/security suite: **71/71 PASS**
- Confirmation transaction matrix: **85/85 PASS** (included in critical suite)
- Party Ledger UI/workspace/static gate: **3 suites PASS**
- Production static gate: **44 Apps Script files, 33 HTML files, 496 server functions; PASS**
- Full Node suite: **158/168 PASS, 10 FAIL**

## Known remaining failures
The 10 remaining full-suite failures are pre-existing UI/responsive acceptance tests:
- `counter_acceptance.test.js`
- `counter_customer_receive.test.js`
- `counter_ui_primitives.test.js`
- `deep_review_regressions.test.js`
- `mobile_pwa_ui.test.js`
- `mockup_module_design.test.js`
- `pos_tablet_exact_mockup.test.js`
- `pos_tablet_recent_drafts.test.js`
- `sidebar_grouped_collapse.test.js`
- `tablet_responsive_shell.test.js`

A real Chromium tablet probe at 768x1024 also confirmed the POS currently collapses to one column instead of the older two-column tablet expectation. This is a UI/responsive issue, not an accounting/confirmation failure.

## Production conclusion
The audited financial/confirmation transaction paths are green in both logic-level and browser-level tests. The remaining known gaps are UI/responsive acceptance issues and should not be represented as fully resolved.
