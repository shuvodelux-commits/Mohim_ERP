# Always-Visible Customer Fields and Stable POS Cart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or subagent-driven-development. Write tests before fixes, observe RED and GREEN, verify all regression suites.

**Goal:** Keep optional POS customer fields visible and prevent their height changing desktop cart position.
**Architecture:** Update POS V2 HTML to remove toggle; keep original input IDs and restore callbacks. Make the common display helper always show the fields; use an independent max-content first grid row to avoid spanning customer panel affecting cart. Add responsive two-column styling.
**Tech Stack:** Google Apps Script HTML/CSS/JS, Node, mocked Chromium.
**Spec:** `docs/superpowers/specs/2026-11-04-pos-customer-fields-static.md`

## Global Constraints
- Branch PR #44, no production deployment.
- No changes to sales, customer models, draft data, or accounting.
- No removal of Father/Address input IDs or metadata.

## Tasks
### 1. RED test
- [ ] Create `tests/pos_customer_optional_fields_static.test.js`: assert input controls present, toggle removed, helper cannot hide fields, desktop independent grid row sizes, compact field CSS.
- [ ] Extend Playwright gate: parent grid cart top remains stable when customer due and optional fields grow; phone fields do not clip.
- [ ] Run focused tests expecting failure before modifications.

### 2. Implement
- [ ] In `pos.html`, remove button and toggle click handler, leave fields permanently visible.
- [ ] In JS, retain `posSetCustomerMoreExpanded_` compatibility for draft/invoice restores but make it ensure always visible.
- [ ] In `posv2.html`, add 2-column optional field grid at desktop/tablet, 1-column below 540px, 36px controls, and `grid-template-rows:max-content minmax(0,1fr)` on desktop grid.

### 3. Verify and TEST preview
- [ ] Run focused, full Node and mocked-browser CI; fix until green.
- [ ] Push PR #44 and TEST Apps Script only; update existing /exec deployment; verify production remains @70.
