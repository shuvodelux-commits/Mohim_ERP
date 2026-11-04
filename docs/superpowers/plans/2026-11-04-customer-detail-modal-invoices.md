# Customer detail modal invoice visibility — Mohim ERP

## Root cause
- Sales Invoice customer name in sales.html routes to Customers -> custOpenDetail_(customerId).
- customers.html calls getCustomerDetail, which previously loaded only CUSTOMER_LEDGER.
- The checkout Sale writer persists CUSTOMER_LEDGER only when Due Amount > 0; linked fully paid sales are therefore omitted.
- The separate Customer Ledger already provides partyLedgerBuildDisplayIndex_('customer', id, false), including a reconciled, read-only source-invoice projection.

## Minimal correction
- Keep Sales link -> Customers modal behavior, permission gate, original payment edit/delete controls and Current Due.
- Use same display index in getCustomerDetail; merge indexed entries with original raw payment metadata by actual sheet row index.
- Preserve payment discount fields, chronological balances, corrected Sale chains, genuine returns/settlements. Synthetic Sales are never editable as Payment.
- Label projected Debit as Invoice Total and checkout Credit as Paid at Checkout; no accounting writes or duplicate Customer Payment.
- Only linked Customer IDs surface paid sales; never match by name/phone. Missing unpaid ledger obligations are not fabricated.
- This patch is separate from already merged PR #35; no production Apps Script deployment.

## Tests
- tests/customer_detail_modal_invoices.test.js confirmed RED before code changes and GREEN after. Linked paid, partial, return, edited sale, unlinked/deleted, no-evidence, permission and UI-label coverage.
- Browser gate verifies Sales customer link -> modal, rendered paid invoice and editable original payment.
- Run full Node, browser and CI checks, then deploy only to existing verified test app.
