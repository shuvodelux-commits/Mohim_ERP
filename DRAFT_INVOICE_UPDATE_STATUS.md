# Draft Invoice Integration Status

This package combines the verified SherERP Global Confirmation Dialog build with the Draft Invoice feature.

## Applied
- Draft Invoices and Draft Invoice Audit Google Sheets schema
- Draft save/update/open/delete APIs
- Draft ownership/version conflict protection
- Draft POS save/update/open workflow
- Separate draft numbering
- No stock/accounting/cash/bank/customer-due effects while still a draft
- Draft-to-sale idempotency via Source Draft ID
- Draft preview/print/JPG with DRAFT / খসড়া marking
- Systemwide confirmation dialog preserved and used for draft deletion

## After deploying to Apps Script
Run **Hardware ERP → Setup / Repair System** once, then reload the web app.

## Verification
- 34/34 test files pass
- 42/42 .gs files parse
- 29 embedded HTML script blocks parse
- 0 merge conflict markers
