# Compact POS V2 checkout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** Make the existing minimalist POS V2 checkout more vertically compact while keeping all workflows.
**Architecture:** Modify existing approved CSS rules in `posv2.html` only; do not add another cascading override or new JavaScript. Keep existing `pos.html` controls and semantics.
**Tech Stack:** Google Apps Script HTML/CSS, Node test runner, mocked Playwright browser.
**Spec:** `docs/superpowers/specs/2026-11-04-compact-pos-checkout.md`

## Global Constraints
- Start from main commit `35aa0ef` with PR #44 merged.
- Touch `posv2.html`, the design-contract test, a new compactness test, mocked browser tests, and documentation only.
- Production @70 must not change; TEST preview updated only after CI green.
- Do not alter invoices, accounting math, customer/draft RPCs, feature flags, or the previously proposed Father/Husband type feature.

## Review Focus
1. Desktop/customer panel gets shorter but retains all controls and visible focus.
2. Split payment rows still fit 610px, and narrow desktop uses two-row container layout.
3. Phone payment tab scrolls safely; sticky Complete Sale action remains visible.
4. Customer due/draft/optional fields still appear; no cart movement due to customer height.
5. All Node tests and mocked browser checks pass.

### Task 1: Test-first
- [ ] Create `tests/pos_checkout_compact_density.test.js` asserting updated CSS metrics and all existing UI IDs.
- [ ] Update mocked browser checks to measure actual 36px customer inputs, 40px actions, 5px payment row padding, and nonoverlap at 610px/sidebar/phone.
- [ ] Run RED; ensure failure comes from existing larger metrics.

### Task 2: Compact the existing CSS
- [ ] Update canonical approved CSS in `posv2.html`, not append duplicate overrides.
- [ ] Preserve 36px inputs, existing payment flat borders and responsive breakpoints.
- [ ] Update prior reference-test values to new approved design; don't weaken interaction tests.
- [ ] Run focused tests.

### Task 3: Verify and publish TEST only
- [ ] Run full Node suite, mocked Playwright; inspect diff and CI.
- [ ] Push branch, create new review PR; checkout into `apps-script-pos-preview`, verify TEST script ID, push and update existing TEST deployment ID only.
- [ ] Confirm TEST deployed version, production still @70.
