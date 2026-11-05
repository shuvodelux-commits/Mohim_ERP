# Expense Period Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Use red-green-refactor with each task.

**Goal:** Restore trustworthy selected-period totals and improve expense reporting without changing accounting writes.

**Architecture:** expenseReport.html calls getExpenseLedger(token, {dateFrom, dateTo}). The server filters EXPENSES and returns active+cancelled rows and filteredTotal; client aggregates only active rows, checks reconciliation, and renders period KPIs, breakdowns and details.

**Tech Stack:** Google Apps Script V8, HTML, browser JavaScript, Node node:test, existing CSS.

**Spec:** docs/superpowers/specs/2026-11-05-expense-period-report-design.md

## Global Constraints
No accounting writes, no new API, no new dependencies, no main checkout changes, no production deployment; escaped user strings; bilingual headings; compact UI.

## Review Focus
- Date picker's change must trigger a fresh server-filtered query.
- Both endpoints inclusive; default month-to-date.
- Cancelled expenses excluded, while server total matches active rows.
- Invalid dates, failed RPC, and stale requests must not leave a misleading amount.
- Full History carries report dates; details capped at 25 but total uses all active records.

### Task 1: Report contract tests
**Files:** tests/expense_report_range_details.test.js
- [ ] Write Node VM tests against real expenseReport.html script: default range, server payload, period total, changed dates, cancelled rows, invalid range, daily average, highest entry, daily/category shares, XSS, empty data, error state and stale responses.
- [ ] Run node --test tests/expense_report_range_details.test.js; verify expected RED failures on current report.
- [ ] Verify actual Expense.gs getExpenseLedger contract using fixtures, not a mocked calculation.

### Task 2: Compact period report
**Files:** expenseReport.html, style.html
- [ ] Implement focused period cards and grouped breakdowns, respecting accessibility and ERP styling. Keep full-history navigation.
- [ ] Replace client-side getExpenseList with server-filtered getExpenseLedger, reconcile active rows to filteredTotal, and guard out-of-order results.
- [ ] Run focused tests to GREEN; run embedded-script syntax checks.

### Task 3: Whole-repo verification and PR
**Files:** Only tests, report, scoped CSS, spec and plan.
- [ ] Run node --test tests/*.test.js and relevant static checks; inspect diff for forbidden changes.
- [ ] Commit on isolated feature branch, push branch, open PR against main; let PR CI run.
- [ ] Do not merge/deploy without a new instruction.
