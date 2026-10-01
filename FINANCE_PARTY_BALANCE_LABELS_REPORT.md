# Finance Party Balance + Debit/Credit Labels Upgrade

Date: 2026-09-16
Base: SherERP-PRODUCTION-FINAL-FINANCE-LEDGER-PEOPLE-COMBOBOX-AUDITED-2026-09-15.zip

## Runtime changes

Only three runtime files changed:
- FinanceModule.gs
- finance.html
- financeLedger.html

## Behavior

- Stored Finance transaction keys remain unchanged for Google Sheets compatibility.
- Display labels are now:
  - Owner Investment -> Owner Credit
  - Owner Withdrawal -> Owner Debit
  - Loan Received -> Lender Credit
  - Loan Repayment -> Lender Debit
  - Borrower Loan -> Borrower Debit
  - Borrower Repayment -> Borrower Credit
- Business Finance type selector is grouped Lender / Borrower / Owner / Opening Balance with separators.
- Normal transaction options show Bangla action descriptions.
- Finance Ledger shows a highlighted selected-person balance card using complete-history summary, independent of display date/query filters.
- Multi-role people show one balance item per relationship role without cross-netting.
- Ledger `Person` display heading is renamed to `Party`.
- Relationship account display names are Owner Balance / Lender Balance / Borrower Balance.
- Ledger search continues matching stable legacy transaction keys such as `Loan Repayment` even though the visible label is `Lender Debit`.

## Verification

- New feature/static contract tests: 4/4 pass.
- Focused Finance + confirmation suite: 28/28 pass.
- Finance multi-balance browser probe: 20/20 pass.
- Existing Bank/Finance browser probe: 7/7 pass.
- Production static/security: 2/2 test files pass; 44 GS, 32 HTML, 519 server functions parsed; 182 published RPC functions audited.
- Full Node suite: 221/230 pass. The 9 failing files are the same pre-existing UI files from the prior production baseline; no new failing file.
