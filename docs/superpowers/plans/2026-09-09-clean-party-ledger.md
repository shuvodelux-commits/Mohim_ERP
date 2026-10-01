# Clean Party Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Hide internal sale/purchase correction rows from normal customer/supplier ledgers and print statements while preserving raw audit history for privileged on-screen inspection.

**Architecture:** `PartyLedger.gs` will build a clean read projection before pagination. Correction chains are collapsed by transaction reference, visible running balances are recomputed, and clean closing balance is checked against the raw ledger closing balance. Privileged users may request the raw view; statements are always clean.

**Tech Stack:** Google Apps Script V8, Google Sheets, vanilla HTML/CSS/JavaScript, Node.js assertion/vm tests.

**Spec:** `docs/superpowers/specs/2026-09-09-clean-party-ledger-design.md`

## Global Constraints
- Google Apps Script is the application runtime and Google Sheets is the database.
- Raw customer/supplier ledger rows must never be modified by this feature.
- Default interactive view and every printed statement must be clean business view.
- Real payments, returns, opening balances and refunds remain visible.
- Only Administrator/Owner/Manager may view raw correction rows.
- Projection must occur before pagination.
- Clean closing balance must exactly equal raw closing balance or the request fails closed.

---

### Task 1: Clean projection and integrity invariants

**Files:**
- Modify: `PartyLedger.gs`
- Create: `tests/party_ledger_clean_view.test.js`

**Interfaces:**
- Consumes: `partyLedgerBuildAscendingIndex_(kind, partyId)` raw active chronological rows.
- Produces: `partyLedgerBuildDisplayIndex_(kind, partyId, includeCorrections)` returning raw or clean chronological rows with `_displayBalance` and `_stableKey`.
- Produces: `partyLedgerCanViewCorrections_(token)` role gate.

- [x] **Step 1: Write failing tests** for sale collapse, customer reassignment net-zero removal, repeated edits, purchase supplier reassignment, same-party purchase due delta, real payment/return preservation, negative-chain fail-closed behavior, and clean/raw closing-balance equality.
- [x] **Step 2: Run** `node tests/party_ledger_clean_view.test.js` and verify failures are caused by missing projection behavior.
- [x] **Step 3: Implement minimal projection helpers** in `PartyLedger.gs`, including source-date lookup from current SALES/PURCHASES records and deterministic synthetic keys.
- [x] **Step 4: Run** `node tests/party_ledger_clean_view.test.js` and verify all tests pass.
- [x] **Step 5: Run regression tests** `node tests/party_ledger_workspace.test.js` and `node tests/return_ledger_regressions.test.js`.

### Task 2: Page/bootstrap raw-view authorization and pagination

**Files:**
- Modify: `PartyLedger.gs`
- Modify: `tests/party_ledger_clean_view.test.js`

**Interfaces:**
- `getCustomerLedgerPage(token, customerId, pageSize, cursor, includeCorrections)`
- `getSupplierLedgerPage(token, supplierId, pageSize, cursor, includeCorrections)`
- `getCustomerLedgerWorkspaceBootstrap(token, customerId, pageSize, includeCorrections)`
- `getSupplierLedgerWorkspaceBootstrap(token, supplierId, pageSize, includeCorrections)`
- Bootstrap returns `canViewCorrections`.

- [x] **Step 1: Add failing authorization/pagination tests** proving default calls are clean, privileged raw calls return correction rows, unauthorized raw calls fail, and a correction chain never splits across clean pages.
- [x] **Step 2: Run** `node tests/party_ledger_clean_view.test.js` and verify expected failures.
- [x] **Step 3: Wire page/bootstrap endpoints** to the display index and enforce the role gate server-side.
- [x] **Step 4: Run** `node tests/party_ledger_clean_view.test.js` and the existing workspace test.

### Task 3: Clean-only printable statements

**Files:**
- Modify: `PartyLedger.gs`
- Modify: `tests/party_ledger_clean_view.test.js`

**Interfaces:**
- Existing `getCustomerLedgerStatement` / `getSupplierLedgerStatement` signatures remain unchanged.

- [x] **Step 1: Add failing statement tests** for opening balance, period debit/credit, closing balance, reassigned transaction disappearance from old party, appearance on new party, and no internal update types in statement rows.
- [x] **Step 2: Run** the new test and verify failure against raw statement logic.
- [x] **Step 3: Change statement generation** to use clean projection only and recompute statement balances from clean rows.
- [x] **Step 4: Run** clean-view and existing Party Ledger tests.

### Task 4: Customer/Supplier Ledger UI toggle

**Files:**
- Modify: `customerLedger.html`
- Modify: `supplierLedger.html`
- Modify: `style.html`
- Modify: `tests/party_ledger_ui.test.js`

**Interfaces:**
- Both page states add `showCorrections: false` and `canViewCorrections: false`.
- Existing page/bootstrap RPC calls append the boolean `showCorrections`.

- [x] **Step 1: Add failing UI-contract assertions** for hidden-by-default `Show corrections`, privileged visibility from bootstrap, reset to clean on party change, passing the mode to page RPCs, and statement RPCs remaining mode-free.
- [x] **Step 2: Run** `node tests/party_ledger_ui.test.js` and verify failures.
- [x] **Step 3: Implement the compact toggle** in both pages and mode-aware reload behavior. Printing remains unchanged and therefore clean-only.
- [x] **Step 4: Run** `node tests/party_ledger_ui.test.js` and browser/static ledger checks.

### Task 5: Production-integrity hashes and full verification

**Files:**
- Modify only if required: `confirmation_spec_matrix.test.js`
- Modify only if required: `tests/confirmation_spec_matrix.test.js`
- Create: `CLEAN_LEDGER_VIEW_REPORT.md`

**Interfaces:**
- Existing confirmation-matrix integrity contract remains intact with the new audited `PartyLedger.gs` hash.

- [x] **Step 1: Run all `*.test.js` files** and record exact pass/fail set.
- [x] **Step 2: If hash pinning is the only new failure, update the PartyLedger hash** in both matrix copies and rerun them.
- [x] **Step 3: Run Apps Script syntax/combined parse checks and duplicate-global/RPC integrity checks used by the production gate.**
- [x] **Step 4: Create the report** with behavior examples and verification evidence.
- [x] **Step 5: Package the complete codebase ZIP**, extract it to a clean directory, rerun the critical clean-ledger tests against the extracted delivery, and only then present the artifact.
