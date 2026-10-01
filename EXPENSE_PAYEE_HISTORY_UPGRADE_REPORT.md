# SherERP Expense Payee + Expense History Upgrade Report

Date: 2026-09-15
Base build: SherERP-PRODUCTION-FINAL-BUSINESS-FINANCE-MULTIBALANCE-AUDITED-2026-09-15.zip

## Scope

This upgrade is isolated to the Expense module and navigation metadata. It adds full Payee master-data lifecycle management and merges the former Expense List + Expense Ledger user experience into one Expense History page. Historical EXPENSES rows remain the accounting source of truth and are never rewritten when a payee is edited, deactivated, or deleted.

## Runtime files changed

- Config.gs
- Expense.gs
- ExpenseSettings.gs
- UI.gs
- expense.html
- expenseList.html

No Sales, Purchase, Stock, Vendor, Finance, Customer/Supplier Settlement, Clean Ledger, Return, Bank, or POS production file was modified.

## Payee management

- Edit Payee Name, Phone, Notes.
- Activate / Deactivate Payee.
- Deactivated Payees are removed from Add/Edit Expense active selectors.
- Soft Delete with mandatory reason and existing Expense delete-window permission policy.
- Added EXPENSE_PAYEES audit columns: Is Deleted, Deleted By, Deleted At, Delete Reason.
- Deleted Payees are hidden from management and future selectors but historical expense rows are unchanged.
- A name belonging only to a soft-deleted Payee can be reused.
- Soft-deleted Payees cannot be reactivated or edited.

## Expense History merge

Sidebar now exposes Add Expense, Expense History, Expense Categories, Report. The old Expense Ledger page remains in the source tree for compatibility but is no longer a sidebar destination.

Expense History uses the existing getExpenseLedger() accounting read path and includes:

- Date/category/payee/payment/status/search filtering.
- Total Expense, Filtered Total, Entries Shown cards.
- Running Total column.
- View, Edit, Delete actions.
- Print and CSV export.
- Payee-filtered running total behavior inherited from the ledger engine.

## Verification

Focused upgrade test: PASS.
Existing financial CRUD: 34/34 PASS.
Confirmation spec matrix: 85/85 PASS.
Expense/Party browser probe: 12/12 PASS.
New Expense Payee/History browser probe: 8/8 PASS.
Static production gate: PASS (44 GS, 33 HTML, 519 server functions).
Public RPC security: PASS (182 published functions).
Full Node suite: 215/224 PASS, with exactly the same 9 pre-existing UI test files failing as the base Finance build and no new failing test file.

Pre-existing failing files unchanged:
- counter_acceptance.test.js
- counter_customer_receive.test.js
- counter_ui_primitives.test.js
- mobile_pwa_ui.test.js
- mockup_module_design.test.js
- pos_tablet_exact_mockup.test.js
- pos_tablet_recent_drafts.test.js
- sidebar_grouped_collapse.test.js
- tablet_responsive_shell.test.js

## Deployment

Back up the production Google Sheet and Apps Script project. Deploy the full ZIP or replace the six changed runtime files. Run private setupSystem_() once from the bound Spreadsheet editor so the additive EXPENSE_PAYEES audit columns are appended if missing. Existing rows remain valid because blank Is Deleted means active/not deleted.
