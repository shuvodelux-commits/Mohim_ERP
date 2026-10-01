# SherERP Production Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Deeply audit, regression-test, repair verified defects, and package the uploaded Apps Script + Google Sheets SherERP deployment only after source, business-rule, UI, and browser gates are green.

**Architecture:** Preserve the existing Google Apps Script + Google Sheets architecture and business rules. Use static analysis and Node regression tests for source contracts, targeted VM/harness tests for server logic where practical, and Chromium Playwright with a mocked `google.script.run` bridge for frontend E2E. Do not claim real Apps Script/Sheets runtime behavior that cannot be executed locally.

**Tech Stack:** Google Apps Script V8, Google Sheets, HTML/CSS/browser JavaScript, Node.js 22, Python/Playwright Chromium.

**Spec:** `AGENTS.md`, `PROJECT.md`, and the production-gate requirements approved in the current conversation.

## Global Constraints

- Preserve Apps Script + Google Sheets architecture.
- Validation before write; lock multi-write financial operations.
- Preserve FIFO across supplier lots and OVERSOLD negative-stock behavior.
- Preserve cash-session and server-side permission enforcement.
- Preserve transaction-aware reversal/delete semantics and audit history.
- Never silently resolve ambiguous duplicate invoice IDs.
- Fix verified root causes only; no unrelated feature work.
- Runtime-only Google services are reported separately unless a real deployment is available.

---

### Task 1: Baseline source and regression suite
- [x] Inventory files/functions and run syntax/static checks.
- [x] Run every existing Node test individually and record failures.
- [x] Classify failures as product defect, stale test, or environment limitation before changing code.

### Task 2: Vendor Workspace browser failure
- [x] Reproduce the `vlFillWorkspaceVendorSelect_()` failure with the smallest browser/harness case.
- [x] Trace initialization data flow and identify whether production code or mock bootstrap is at fault.
- [x] If production defect, add a failing regression test first, implement minimal fix, and verify adjacent vendor flows.

### Task 3: Invoice identity and chronology integrity
- [x] Verify next invoice generation against stale counters and actual Sales IDs.
- [x] Verify duplicate historical IDs fail closed across view/print/edit/delete/return/history/report paths.
- [x] Verify Sales History date/time normalization and draft-to-sale idempotency.

### Task 4: CRUD and business-rule matrix
- [x] Enumerate public server CRUD/transaction endpoints by module.
- [x] Run static/VM contract checks for permission, cash-session, validation-before-write, lock, stock/FIFO, balance, and reversal invariants.
- [x] Add targeted regressions for any verified gaps before fixing them.

### Task 5: Full UI and Playwright sweep
- [x] Build deterministic local shell with mocked Apps Script responses.
- [x] Smoke every navigable page and action surface in Chromium.
- [x] Run POS/invoice/customer/vendor/returns critical E2E flows.
- [x] Run tablet viewport guards and fail on uncaught browser/console errors.

### Task 6: Final freeze and packaging
- [x] Run all Node tests, syntax/static checks, and Playwright suites from a clean state.
- [x] Verify git diff contains only justified production/test/audit changes.
- [x] Update audit report with tested vs runtime-only boundaries.
- [x] Create full deployment ZIP and changed-files-only ZIP; verify archive integrity.
