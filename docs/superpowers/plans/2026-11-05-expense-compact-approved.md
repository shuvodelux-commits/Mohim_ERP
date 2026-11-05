# Expense V1 Compact Module Implementation Plan

> Use Superpowers test-driven-development and executing-plans.

**Goal:** Implement the approved five-screen Expense UI and the additional compact card revision in the existing Apps Script SPA.

**Architecture:** Maintain original `expense.html`, `expenseList.html`, `expenseCategory.html` and their event handlers. Enhance CSS/markup while reusing the native ERP underline navigation, add a dedicated Payees page powered by existing permission-checked Payee RPCs. In `expenseReport.html`, keep the existing period request and reconciliation; add a second server-filtered month-to-date ledger request on navigation/refresh and derive Today from its rows. Render small real-data category summaries, period presets, and an accessible compact daily chart. Avoid backend changes.

**Spec:** docs/superpowers/specs/2026-11-05-expense-compact-approved.md

## Tasks
1. Write failing tests for Today/Month independently scoped totals, category snippets, date presets, daily chart and error state; verify RED.
2. Implement report data extension and compact V1 UI without changing ledger math; verify GREEN.
3. Write failing markup/responsive tests for four expense pages and five accessible nav destinations, plus required preservation of form/history controls; verify RED.
4. Implement CSS and compact wrapper/navigation for Entry/History/Categories/Payees; verify GREEN.
5. Run all Node regression tests, production static and GitHub browser gates; inspect scoped diff, push feature branch and open PR for approval. No main merge or Apps Script deployment.
