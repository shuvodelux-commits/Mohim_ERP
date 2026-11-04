# ERP-wide Current Module Topbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement task-by-task. Steps use checkbox syntax.

**Goal:** Remove parent › child breadcrumbs throughout the ERP and use a compact title/short Bangla helper for the active top-level module.
**Architecture:** Replace the breadcrumb composition in shared `goToPage()` with a pure group-title formatter; render English/Bangla in separate spans. Scope CSS to `#pageTitle`/topbar classes with responsive overflow protection. Keep the existing sidebar/subnav navigation path untouched.
**Tech Stack:** Apps Script HTML, vanilla JavaScript, CSS, Node tests, mocked Chromium/Playwright.
**Spec:** `docs/superpowers/specs/2026-11-05-erp-topbar-current-module.md`

## Constraints
- Start from `main` `1068c811`; production is `@71`.
- Only `javascript.html`, `style.html`, `index.html`, tests, docs change. No accounting data or permissions.
- Do not change the topbar height, navbar links or child-tab labels.
- Never deploy to production without separate explicit request.

### Task 1: RED navigation/title contract
- [ ] Create `tests/erp_module_topbar_title.test.js`: test every NAV_ITEMS module/child including POS V2, Sales Returns, Ledgers, Settings. Test no breadcrumbs, group Bangla helper, fallback and escaping.
- [ ] Add browser route-level topbar text/content and 1440px/768px/375px visual-bound checks.
- [ ] Run RED, ensure failure is meaningful.

### Task 2: Shared rendering and CSS
- [ ] Implement `moduleHeaderFor_(key,group)` returning the group label/Bangla helper; retain role/permission guards.
- [ ] Replace header `innerHTML` with safe `topbar-module-name` and `bn-hint` spans only.
- [ ] Set global title to 16px desktop/tablet, 15px phone, display compact two lines, preserve 56px bar and controls; mobile Bangla helper visible with safe truncation.

### Task 3: Browser verification and TEST preview
- [ ] Run focused tests, full Node, mocked Playwright gate across all modules and 3 breakpoints.
- [ ] Inspect final diff and PR; publish verified commit to existing TEST script ID and update existing `/exec` deployment only.
- [ ] Confirm production @71 unchanged. PR remains unmerged until user approval.
