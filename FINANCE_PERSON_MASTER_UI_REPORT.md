# SherERP Finance Person Master Data + Finance UI Refinement Report

**Date:** 2026-09-16  
**Base build:** `SherERP-PRODUCTION-FINAL-FINANCE-PARTY-BALANCE-LABELS-AUDITED-2026-09-16.zip`

## Scope

This release is intentionally isolated to Business Finance / Finance Ledger.

Changed production files:
- `Config.gs`
- `FinanceModule.gs`
- `finance.html`
- `financeLedger.html`

No production changes were made to Sales, Purchase, Stock, Vendor, Expense, Bank, Customer/Supplier Settlement, Returns, Clean Ledger, POS, or Products.

## Finance Person master data

`FINANCE_PERSONS` gains one additive `Description` column. Existing rows remain valid. Existing `Notes` is retained and is used as a read fallback when `Description` is blank, so older descriptive data is not lost.

Finance Person create/edit now supports:
- Name
- Phone
- Description
- Owner/Lender/Borrower multi-role selection
- Active/Inactive status remains the existing separate lifecycle control

A new permission-checked `updateFinancePerson()` RPC edits Name, Phone, Description and Roles while preserving the stable Person ID. Historical finance transactions are not rewritten.

## Finance Ledger person dropdown

Finance Ledger continues using the searchable name/phone combobox but now opens the complete `personsAll` master list instead of applying the previous 20-person result cap. This includes inactive historical Finance People so prior ledgers remain findable.

New finance transactions remain restricted to active people whose roles match the selected transaction type.

## Transaction type UI

Stored transaction keys are unchanged. The selector remains display-only for the renamed Debit/Credit labels.

The selector now uses compact horizontal group headers for:
- Lender
- Borrower
- Owner
- Opening Balance

Bangla descriptions were added to the three opening types:
- Opening Owner Capital — প্রারম্ভিক মালিক মূলধন
- Opening Loan — প্রারম্ভিক ঋণ
- Opening Borrower Loan — প্রারম্ভিক ঋণগ্রহীতা ঋণ

## Verification

TDD regression added for Description schema/data, master-data create/edit, full Finance Ledger people list, compact grouped transaction UI, and opening Bangla labels.

Pre-package evidence:
- Focused Finance/confirmation suites: **42/42 PASS**
- Finance multibalance browser probe: **26/26 PASS**
- Existing Bank/Finance browser probe: **7/7 PASS**
- Production static + public RPC security: **PASS**, 183 published functions audited
- Complete Node suite: **229/238 PASS**
- Remaining 9 failures are the same pre-existing UI test files from the prior production baseline:
  - `counter_acceptance.test.js`
  - `counter_customer_receive.test.js`
  - `counter_ui_primitives.test.js`
  - `mobile_pwa_ui.test.js`
  - `mockup_module_design.test.js`
  - `pos_tablet_exact_mockup.test.js`
  - `pos_tablet_recent_drafts.test.js`
  - `sidebar_grouped_collapse.test.js`
  - `tablet_responsive_shell.test.js`

The delivered ZIP is fresh-extracted and retested before release.
