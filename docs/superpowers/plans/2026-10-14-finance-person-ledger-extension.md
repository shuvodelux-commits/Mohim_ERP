# Finance Person Ledger Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Customer-Ledger-shaped per-person, per-role Finance statement within the current Finance Ledger without changing business calculations or financial posting.

**Architecture:** Keep All Transactions as-is. Reuse existing Finance RPCs, people search, ledger state, edit/delete menu, print/export, and Business Finance form. For the new person view, project relationship debit/credit from transaction metadata without mutating raw cash-direction columns.

**Tech Stack:** Google Apps Script (`.gs`), vanilla HTML/CSS/JavaScript, Node `node:test` and existing mocked Chromium probes.

**Spec:** `docs/superpowers/specs/2026-10-14-finance-person-ledger-design.md`

## Global Constraints
- KISS; no new database schema, server endpoints, business posting functions, role permissions, or transaction types.
- Original Finance Ledger and customer/supplier ledgers remain intact.
- Mirror `customerLedger.html` line 1 onward: one search toolbar, one person card with one balance, one transaction list, 50/100/200 pagination, responsive mobile layout.
- Finance person search uses the same combobox; active/inactive finance person rules stay the same.
- Print/CSV must use the same role-specific data and carry balances; opening entries are not current-session cash movements.

## Review Focus
1. **Opening loans:** Lender opening 20,000, receipt 10,000 and repayment 5,000 => payable 25,000; opening must appear as relationship credit, not cash in.
2. **Borrower vs lender:** Borrower loan must appear as relationship debit, even though it is Cash Out; no cross-role netting.
3. **Empty periods:** An empty date range may carry a nonzero opening and closing.
4. **Action identity:** Role filtering must not change target Finance ID for View/Edit/Delete.
5. **Inactive/legacy people:** View history remains available; posting stays limited to active people and server permissions.

---

### Task 1: Add Customer Ledger-shaped view without replacing original ledger
**Files:** `financeLedger.html`; `tests/finance_person_ledger_extension.test.js`.
**Interfaces:** original `finLedLoad()`, `finLedRender_()`, `finLedState`, original All Transactions DOM IDs.
- [x] Write test for Person Ledger switch and original All Transactions retention.
- [x] Confirm red against prior UI.
- [x] Add isolated mode switch and `.party-ledger-*` markup; keep All Transactions default.
- [ ] Run focused test using a checkout of the exact PR head, then commit verified evidence.

### Task 2: Project relationship debit/credit with existing metadata
**Files:** `financeLedger.html`; `tests/finance_person_ledger_extension.test.js`.
**Interfaces:** `finLedType_`, `finLedState.rows`, existing `row.balance`.
- [x] Add failing tests for lender/borrower/owner openings and repayments, and mixed-role separation.
- [x] Implement UI-only `finLedPersonStatementRows_(rows,account,dateFrom,dateTo)` using existing type metadata.
- [x] Validate six projection tests in isolated historical-backup test fixture; not yet on exact GitHub head.
- [ ] Run on current branch with a complete verified checkout.

### Task 3: Reuse complete-history period authority and view balance
**Files:** `financeLedger.html`; `tests/finance_person_ledger_extension.test.js`.
**Interfaces:** `getFinanceLedger(token, filters)`, `financeBalanceSummary_`, `finLedRenderSelectedPersonBalance_`.
- [x] Keep Finance RPC unchanged; fetch complete selected person history, then locally filter date/account.
- [x] Show current selected-account balance from existing complete-history summary.
- [x] Keep inactive people viewable, with posting action disabled.
- [ ] Verify backdated-date/reordered transaction cases and server permission behavior in actual runtime.

### Task 4: Reuse edit/delete actions and existing posting/print/export
**Files:** `financeLedger.html`, `finance.html`.
**Interfaces:** `openRowActionMenu_`, `finLedOpenView_`, `finLedOpenEdit_`, `finLedDelete_`, `finLoad`, `printLedgerRange`, `exportRowsToCsv`.
- [x] Route person Actions through existing Finance ID resolution.
- [x] Route new transaction to the current Business Finance form with selected person; no new posting RPC.
- [x] Print and CSV use projected relationship columns with period opening/closing; All Transactions unchanged.
- [ ] Verify user permission boundaries and precise CSV/print contents in browser.

### Task 5: Verify design parity, regressions and responsive layouts
**Files:** `financeLedger.html`; `tests/finance_person_ledger_extension.test.js`; existing Finance suites.
- [x] Reuse customer ledger workspace, toolbar, selected-person card, transaction list, pager and mobile table classes.
- [ ] Test desktop 1366×768, small laptop 1024×768, tablets portrait 768×1024/landscape 1024×768, phone 390×844.
- [ ] Run `node --test tests/finance_person_ledger_extension.test.js tests/finance_multibalance_business_logic.test.js tests/finance_person_ledger_balance.test.js tests/finance_ledger_money_indicators.test.js tests/finance_person_roles.test.js`.
- [ ] Run whole `node --test tests/*.test.js` and mocked Chromium probe on exact branch.
- [ ] Resolve pre-existing GitHub Actions runner issue [#23](https://github.com/shuvodelux-commits/Mohim_ERP/issues/23); require meaningful green CI before considering merge/deployment.

## Handoff
Feature branch only. Status is **implementation complete enough for draft review, not regression/production approved**. Do not merge or deploy until full tests and browser comparisons are performed.
