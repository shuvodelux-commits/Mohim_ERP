# Remove Correction Center Rollback Implementation Plan

**Goal:** Restore SherERP's pre-Correction-Center native Edit/Delete/Cancel behavior while retaining Settlement Discount and the mobile/PWA UI.

**Architecture:** Module UIs call their existing native server handlers directly. Correction Center UI/navigation and Correction*.gs orchestration are removed. Payment settlement discount remains implemented inside native Customer/Supplier payment handlers, and mobile styling remains presentation-only.

**Tech Stack:** Google Apps Script V8, Google Sheets, HTML/CSS/vanilla JavaScript.

## Global Constraints
- Google Apps Script is the runtime and Google Sheets is the database.
- No Correction Center, correction history, revision engine, correction job workflow, or Transaction Correction permission in daily UI.
- Preserve existing soft-delete/reversal accounting behavior and current-day/cash-session guards.
- Preserve Settlement Discount accounting and mobile/PWA responsive UI.
- Daybook delete must dispatch to the owning native delete handler.

### Task 1: Regression contracts for rollback
- Add tests proving no Correction Center UI/navigation/server files are required.
- Add tests proving Sales Edit uses `getSaleForUpdate` and native POS update mode.
- Add tests proving Customer/Supplier payment Edit uses native get/update handlers and Delete uses native delete handlers.
- Add tests proving Daybook still calls `deleteDayBookEntry`.

### Task 2: Remove shared correction UI/navigation
- Remove Correction Center page include, confirmation modal, navigation entry, special permission, icon, deep-link helpers, and shared audited-correction functions.
- Remove `Correction*.gs` files from the production artifact.

### Task 3: Restore module-native UI actions
- Sales/Purchase/Expense/Customer/Supplier/Vendor/Bank/Finance/Returns use existing native handlers.
- Delete/Cancel buttons route to existing delete/reversal functions instead of correction apply/cancel APIs.

### Task 4: Decouple native server paths from correction-only helpers
- Replace unconditional `correctionPaymentAccount_` dependencies with a native payment-account lookup helper.
- Remove corrected invoice marker dependency.
- Ensure non-correction paths do not require any Correction*.gs function.

### Task 5: Verify and package
- Run full test suite, syntax, RPC, duplicate-function, and conflict-marker checks.
- Extract final ZIP to a fresh directory and rerun all checks there.
