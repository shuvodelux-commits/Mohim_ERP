# Father / Husband relationship selector in POS and Customers

User-approved compact option (2026-11-04): one name field with a quick relationship toggle **Father / Husband**, default Father, in POS checkout and Add/Edit Customer.

## Requirements
- POS: dropdown next to the existing `posCustomerFatherName` field, same compact two-column Father/Address group as approved minimal checkout. Switching changes dynamic label `Father Name — বাবার নাম` ↔ `Husband Name — স্বামীর নাম` without clearing the entered name.
- Add/Edit Customer: same quick relationship dropdown beside existing `custFatherName`. Values and labels restored on edit, default Father on add.
- Preserve existing `Father Name` column for backward compatibility. Add **Relation Type** column in CUSTOMERS. Legacy blank type treated as Father. No data migration/rewrite of existing rows.
- Sale/invoice: store per-sale `Customer Relation Name` and `Customer Relation Type` snapshots on SALES, including cash/walk-in sales. Printing uses `পিতা` for Father, `স্বামী` for Husband. Never silently overwrite master customer's relation type when operator changes it for one sale.
- Drafts: persist `Customer Relation Type` in SALES_DRAFTS alongside current `Customer Father Name` (legacy column); restore on open/edit/duplicate/preview. Existing drafts default Father.
- All existing customer lookup/due, invoice editing, payment logic, cash sessions, audit and role permissions unchanged.
- Additive sheet headers only; no spreadsheet migration requiring manual step. No changes to production until explicit approval.

## Rollout
Base from PR #45 compact checkout head `5c4aa6b`; separate stacked PR for relationship type and TEST preview. While both PRs remain unmerged, review in TEST, merge compact PR first, then retarget relation PR to main.
