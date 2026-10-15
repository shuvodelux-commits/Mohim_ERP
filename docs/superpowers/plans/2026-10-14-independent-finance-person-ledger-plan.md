# Independent Finance Person Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace PR #25's nested `All Transactions | Person Ledger` switch with the user's approved independent Finance **Person Ledger** tab: a compact two-pane, finance-people-only ledger with modal-first Record/View/Edit/Delete transactions.

**Architecture:** Reuse the existing Finance group navigation, person master data, `getFinanceBootstrap` and `getFinanceLedger`, Customer Ledger visual primitives, existing Finance transaction form and Finance Ledger modal/action handlers. Add one independent client-only page; avoid duplicating financial posting, session checks, edits, reversal and permissions. Implement a *read-only additive balance map* in the existing Finance bootstrap to populate the left list efficiently.

**Tech Stack:** Google Apps Script V8, Google Sheets, HTML/CSS/vanilla browser JavaScript, Node 24 / `node:test`, Playwright mocked browser checks.

**Spec:** `docs/superpowers/specs/2026-10-14-finance-person-ledger-independent-workspace-design.md` (user approved the 2026-10-14 two-pane generated UI mockup, which is VISUAL ONLY).

## Global Constraints

- Only `Owner`, `Lender`, `Borrower` records from `FINANCE_PERSONS`; do not include customers, suppliers, vendors or payees.
- UI authority: approved mockup's three Finance sub-tabs in **one row**, finance-people list on the left and selected profile/actions/ledger on the right. Follow Mohim ERP's actual styles and Bangla hints.
- Finance Ledger retains **all existing All Transactions** functionality; remove the rejected extra inner tab strip. Business Finance remains operational.
- **No new public posting endpoint, no schema changes, no new Cash/Bank business calculation.** Reuse `addFinanceTransaction`, `updateFinanceTransaction`, `deleteFinanceTransaction`, `getFinanceTransactionForEdit` and existing financial confirmation.
- Read-only relationship ledger semantics: Owner and Lender increases = **Credit**, decreases = Debit; Borrower receivable increases = **Debit**, decreases = Credit; pre-ERP openings affect ERP historical baseline but NOT current cash-session turnover. Server `getFinanceLedger` cash-direction debit/credit remains unchanged.
- Per-person balances must not net different roles, merge similar names, or hide historical inactive people. Select and act using stable Person ID and Finance ID.
- Responsive: two panes on desktop/wide tablet; phone/narrow tablet shows a people list followed by a **separate full-width** selected-person view and Back control.
- The image's amounts/transaction labels are **illustrative** and can contradict business accounting; use actual type metadata and authoritative `row.balance`.
- GitHub canonical `main/.clasp.json` contains **production Script ID**. No merge or Apps Script push/deploy during this plan. Preview deployment only after separate tests and user authorization.

## Source Map (inspected on feature branch)

| Path | Ownership |
|---|---|
| `UI.gs` | Finance navigation currently `finance` and `financeLedger` children; `subNavVisible_` enforces `permKey`. |
| `index.html` | Existing `#page-finance` and `#page-financeLedger` sections; add independent page section. |
| `javascript.html` | `renderSubNav_`, `goToPage`, `PAGE_LOADERS_`, `openModal`, `closeModal`, `runConfirmedAction`, `createPartySearchCombobox_`, `printLedgerRange`, `exportRowsToCsv`. |
| `financeLedger.html` | Current PR #25 has rejected nested UI plus existing View/Edit/Delete modal markup and `finLedOpenView_`, `finLedOpenEdit_`, `finLedDelete_`. Keep its original All Transactions handlers. |
| `finance.html` | Existing person, role, transaction-type, Cash/Bank inputs; `finSaveBtn` uses `addFinanceTransaction`, financial confirmation and correct session/baseline behavior. |
| `FinanceModule.gs` | `getFinanceBootstrap` exposes `personsAll`; `getFinanceLedger` includes per-role full-history running `balance`; `financeSignedBalances_` and `financePersonNameAliasMap_` already calculate authoritative relationship balances. |
| `customerLedger.html`, `style.html` | Reusable appearance, row density, cards, pager, focus/mobile rules. |
| `tests/finance_person_ledger_extension.test.js` | Previous PR #25 projection tests; migrate DOM expectation to new independent page and preserve semantic tests. |

## Review Focus (must become regression cases)

1. Two people have the **same display name**, different IDs: selecting one must never pull, post or edit the other's entries. Test in Task 2 / 4.
2. Multi-role `Owner + Lender` person with positive and negative balances: sidebar shows separate role labels, role-chip switch never nets them. Test in Task 2 / 4.
3. A selected person becomes **Inactive** while a Record modal is open: server rejects new posting and client shows error without clearing the draft or losing history. Test in Task 5.
4. Opening entry and a **backdated** transaction with a date range containing zero rows: carried opening/closing stay correct and opening does not display as active cash movement. Test in Task 4.
5. A modal opened from the independent page while `#page-financeLedger` is hidden: it must remain **visible**; closing it must restore the form and leave Finance Ledger usable. Test in Task 5 / 6.

---

### Task 1: Independent Finance sub-tab / route; remove nested buttons

**Files:**
- Modify: `UI.gs`, `index.html`, `javascript.html`, `financeLedger.html`
- Create: `financePersonLedger.html`
- Create test: `tests/finance_person_ledger_navigation.test.js`
- Modify: `tests/finance_person_ledger_extension.test.js` (no longer assert nested mode DOM)

**Interfaces:** new public client loader `financePersonLedgerLoad()` registered by `PAGE_LOADERS_.financePersonLedger`, route `goToPage('financePersonLedger')`; existing `financeLedger: 'finLedLoad'` unchanged.

- [ ] Write `navigation: finance children are finance, financeLedger, financePersonLedger; no second mode strip; legacy Finance Ledger stays` test with role permission checks (`permKey:'finance'`).
- [ ] Run `node --test tests/finance_person_ledger_navigation.test.js`; confirm RED for missing route.
- [ ] Add third `NAV_ITEMS[finance].children` entry and a separate `<section id="page-financePersonLedger" data-page="financePersonLedger">` include. Register loader. Establish page file with empty-state/visible shell.
- [ ] Remove PR #25's `finLedAllModeBtn` and `finLedPersonModeBtn` inner controls and obsolete moving-combobox code. **Retain all original `finLedTableBody`, `finLedOpenView_`, `finLedOpenEdit_`, `finLedDelete_`, Finance All Transactions filters, print/export**.
- [ ] Run the new test and `node --test tests/finance_ledger_money_indicators.test.js tests/finance_person_ledger_balance.test.js`; expect 0 failures; commit the route/cleanup change.

### Task 2: Efficient finance-only left people list and balances

**Files:**
- Modify: `FinanceModule.gs`, `financePersonLedger.html`
- Test: `tests/finance_person_ledger_people.test.js`, existing `tests/finance_person_roles.test.js`, `tests/finance_multibalance_business_logic.test.js`

**Interfaces:** additive `getFinanceBootstrap(token).personBalances`: lookup keyed by **Person ID**, each value `{ owner, loanPayable, borrowerReceivable }` with signed amounts. Use existing `financeSignedBalances_(activeRows_('FINANCE_TRANSACTIONS'), null, financePersonNameAliasMap_(getAllFinancePersonsForUI_()))` and adapt keys `id:<personId>`; preserve existing bootstrap response fields and permission gate. No new RPC.

- [ ] Write tests for only finance-role people (including inactive), name/phone filtering, same-name/different-ID nonmixing, Owner/Lender/Borrower net separation, no N+1 `getFinanceLedger` calls, and signed balances including negative credit.
- [ ] Run `node --test tests/finance_person_ledger_people.test.js`; verify missing `personBalances` is RED.
- [ ] Add the read-only `personBalances` property inside **existing** `getFinanceBootstrap`; do not change `financeSignedBalances_` arithmetic, stored data, financial RPCs or role permissions.
- [ ] Implement `finPersonLedgerRenderPeople_()` in the new page: initials, name, phone, role badge(s), Activity where reliably known, status, labeled per-role signed balance, selected highlight; `All | Owner | Lender | Borrower` filter and instant name/phone search with existing UI conventions.
- [ ] Run focused tests plus existing finance balance/role suites; expect 0 failures; commit.

### Task 3: Two-pane selected-person workspace and responsive behavior

**Files:**
- Modify: `financePersonLedger.html`, `style.html`
- Test: `tests/finance_person_ledger_workspace.test.js`

**Interfaces:** `finPersonLedgerSelect_(personId, role)` changes only the selected Person ID and account; triggers `getFinanceLedger(authToken,{personId})` once per selected person and caches response locally. `financePersonLedgerLoad()` ensures bootstrap once and refreshes selected person data when required.

- [ ] Write failing DOM/behavior tests: one left people list + one right profile, selected-person identity, role chips, current balance, actions, filters, desktop panes, and mobile list→detail→Back transitions without page navigation.
- [ ] Run focused test and verify RED.
- [ ] Add customer-ledger-inspired profile card, ledger toolbar, empty state and separate selected-person section; style scoped `#page-financePersonLedger` with ~30/70 two-pane desktop grid and one-pane phone/narrow tablet presentation.
- [ ] Ensure new page does not reuse conflicting IDs from `financeLedger.html` or `finance.html`; existing global search-clear, keyboard navigation and popup positioning remain functional.
- [ ] Test desktop 1366×768, small laptop 1024×768, tablet 768×1024 and 1024×768, phone 390×844; commit after static/focused results and browser smoke test.

### Task 4: Accurate relationship ledger, date/type/search filters and print

**Files:**
- Modify: `financePersonLedger.html`, `financeLedger.html` (remove obsolete nested projection owner only after migration)
- Modify: `tests/finance_person_ledger_extension.test.js`
- Test: `tests/finance_person_ledger_statement.test.js`

**Interfaces:** reuse/move existing PR #25 `finLedPersonStatementRows_(rows,account,dateFrom,dateTo)` to one **shared UI-only projection implementation** (in a global client module or new page; never have two independent implementations). `finPersonLedgerState` keeps authoritative `personId`, selected `account`, full history `rows`, visible filters, `pageNumber`, `pageSize`.

- [ ] Write failing test for lender opening 20,000 + received 10,000 − repaid 5,000 => payable 25,000; borrower opening Debit and repayment Credit; owner capital Credit; same-date Finance-ID order; selected-role-only ledger rows; empty period carries balance; search/type only filters display; correct stable Finance ID actions.
- [ ] Run `node --test tests/finance_person_ledger_extension.test.js tests/finance_person_ledger_statement.test.js` and verify expected RED assertions after migration.
- [ ] Render Date, Particulars (type + Finance ID/reference + notes), Debit, Credit, Running balance, Actions. Period header: Opening, Period Debit, Period Credit, Closing. Reuse `row.balance` and existing transaction metadata; never reinterpret/copy raw server cash-direction debit/credit into person statement.
- [ ] Add date/type/reference search filters, Clear Filters, 50/100/200 pagination and responsive mobile ledger rows. Complete-history selected-card balance must not shift when changing date filters.
- [ ] Reuse `printLedgerRange` and `exportRowsToCsv` for the selected person's selected-role period including opening/closing and explicit role label; preserve original Finance Ledger's print/export unchanged.
- [ ] Run statement, opening-balance, per-person and Finance Ledger regression suites; commit.

### Task 5: Modal-first Record Transaction, reusing Finance's actual form and submit handler

**Files:**
- Modify: `finance.html`, `financePersonLedger.html`, `index.html` or suitable global modal host (as dictated by existing DOM shell)
- Test: `tests/finance_person_ledger_record_modal.test.js`

**Interfaces:** existing `finType`, `finPerson`, `finDate`, `finAmount`, `finPaymentMethod`, `finBankAccount`, `finBackdatedReason` and **existing** `finSaveBtn`/confirmed `addFinanceTransaction` flow. Add narrowly scoped `finEntryFormMount_(targetElement)` / `finEntryFormRestore_()` UI helpers to physically move the **same** Finance form into a visible modal host, with a placeholder at the old location, and a single optional success callback `finEntryAfterSave_` to refresh the selected person. Do not create duplicate transaction form fields or save functions.

- [ ] Write failing tests: the selected Person ID is prefilled, allowed types filtered by role, no new save RPC, modal contains original form nodes (IDs unique), Bank/Mobile Banking account visibility and required backdated reason retained; Esc/Close/navigation always restore the form to Business Finance.
- [ ] Run focused test and confirm RED.
- [ ] Add `financePersonRecordModal` in a modal host **outside all hidden page sections**. On Record Transaction click, mount the existing Finance form node, preselect person/role, open modal. Restore form after close/cancel/Escape/navigation, including after a save error.
- [ ] Continue to run the existing `finSaveBtn` confirmation callback and `addFinanceTransaction`; only after successful save close/restore modal and refresh sidebar balances plus selected-person ledger. Permission/session failures show inline error and keep draft; no automatic retry.
- [ ] Run focused test plus `tests/confirmation_vendor_finance_inventory.test.js` and `tests/finance_multibalance_business_logic.test.js`; commit.

### Task 6: View/Edit/Delete modals and action integrity

**Files:**
- Modify: `financeLedger.html`, `financePersonLedger.html` and shared modal host in `index.html` if used
- Test: `tests/finance_person_ledger_actions.test.js`

**Interfaces:** keep **one** existing `finLedOpenView_(financeId)`, `finLedOpenEdit_(financeId)`, `finLedDelete_(financeId)`, with a read-only selected-person row lookup source when current route is `financePersonLedger`. Existing `getFinanceTransactionForEdit`, `updateFinanceTransaction`, `confirmDelete`, `deleteFinanceTransaction` unchanged. Maintain original `finLedState.rows` semantics for All Transactions.

- [ ] Write failing tests that View modal really becomes visible from the independent route, selected row resolves by **Finance ID** after search/pagination, Edit uses original server lookup + permission/confirmation, Delete uses original audit/reversal path, and same-name people cannot affect each other's entries.
- [ ] Run focused tests, verify RED.
- [ ] Make the **single existing** View/Edit modals available outside hidden `#page-financeLedger` (a shared modal host; relocate DOM nodes once, don't duplicate IDs). Pass the selected-person read-only row context into existing view handler without permanently overwriting All Transactions state.
- [ ] Add a safe refresh hook for Person Ledger after successful edit/delete without invoking a duplicate mutation endpoint; preserve selected Person ID, role and filters if the transaction still belongs to them.
- [ ] Test active/inactive/history/no access and modal visibility on desktop and mobile; run `node --test tests/finance_person_ledger_actions.test.js tests/public_rpc_security.test.js`; commit.

### Task 7: Full regression, visual comparison, review and PR handoff

**Files:**
- Test: all `tests/*.test.js` plus mocked-browser Playwright production gate
- Documentation: `docs/superpowers/specs/2026-10-14-finance-person-ledger-independent-workspace-design.md` and this plan

**Interfaces:** Existing PR #25 remains the delivery vehicle. Finance Person Ledger replaces its earlier nested design. PR #26 Purchase Supplier Search and PR #27 unrelated test-fix are separate and should not be silently merged into #25.

- [ ] `node --test tests/finance_person_ledger_navigation.test.js tests/finance_person_ledger_people.test.js tests/finance_person_ledger_workspace.test.js tests/finance_person_ledger_statement.test.js tests/finance_person_ledger_record_modal.test.js tests/finance_person_ledger_actions.test.js` → 0 fail.
- [ ] `node --test tests/finance_person_ledger_extension.test.js tests/finance_person_ledger_balance.test.js tests/finance_multibalance_business_logic.test.js tests/finance_person_roles.test.js tests/finance_ledger_money_indicators.test.js tests/public_rpc_security.test.js` → 0 fail.
- [ ] `node --test tests/*.test.js` → 0 fail. The earlier preview run reported 439/445, 6 failures in semantic-card VM fixture; make sure PR #27 fix is present in the **preview integration checkout** before full-suite gate, or report that known baseline failure explicitly rather than falsely attributing it to Person Ledger. Test environment CI runner issue #23 may still block jobs without executing steps.
- [ ] Run `node tests/production_gate_browser.cjs` and actual screenshot comparisons at 1366, 1024, 768 and 390 px. Compare to approved image: **one native tab row**, 30/70 desktop split, accurate list balances, modal foreground, sticky mobile flow, correct no-overflow.
- [ ] Validate one real preview-copy Apps Script smoke flow after the user authorizes preview deploy: Owner/Lender/Borrower selection, record, view, edit, delete, balances, date filtering, print, original Finance Ledger, Business Finance. No destructive financial action in production.
- [ ] Inspect `git diff origin/main...HEAD`: no unrelated file rewrites, no duplicate IDs, no changes to `FinanceModule.gs` financial posting methods / `DeleteEngine.gs`, no new public posting RPC. Record tests/screenshots and update PR #25 description.
- [ ] Keep PR #25 unmerged and production untouched until user approves merge/deploy. Preview target, if later authorized, is Script ID `1c1wtUuO0xISTw0JTfAKnqry28UeJaIcW8CWwJVDSo1Y31BbPad4glp4G`, existing deployment ID `AKfycbwAVPDWqKkL7J-YBHA0IwFyS84pBfP5nVGzl7s_R3NDf1WF04TMSzg100742zwZreqchQ`. Guard `.clasp.json` first; GitHub `main` is production-bound.

## Handoff

**Design:** User approved the generated desktop mockup on 2026-10-14. The generated picture conveys layout only; business amounts and roles are examples, never ledger truth.

**Current state:** This file is an **implementation plan**, not executed changes. PR #25 still contains the old nested UI until Tasks 1–7 are implemented and tested.

**Proposed execution:** Native sequential TDD on PR #25 with an independent final review, because the same Finance form/ledger handlers must be moved safely without duplicating their mutation logic. No merge or deploy until explicit authorization.

## Implementation evidence / remaining release gates (2026-10-14)

**Implemented on PR #25:** Independent three-tab navigation (Business Finance | Person Ledger | Finance Ledger), separate `financePersonLedger.html`, two-pane finance-only list/profile/ledger, read-only per-person balance map via `getFinanceBootstrap`, accounting relationship statement, keyboard search selection, mobile list-first flow, Record modal with the existing Finance form, existing View/Edit/Delete modals, statement print/export, and preservation of the original Finance Ledger page.

**Verification performed:** 29/29 targeted tests passed in an isolated V8 source harness against the actual latest PR files; scripts parse; static page IDs are unique; mocked runtime verified bootstrap → personId-scoped finance query → lender ledger and modal open/lock/restore. These are **not equivalent to a real Node project checkout or browser verification**.

**Still pending before production/preview deployment:** run the full `node --test tests/*.test.js` in the actual preview worktree; confirm PR #27's separate test harness fix in the integration branch; inspect UI on desktop, tablet and phone; actual transaction create/view/edit/delete including Backdated and inactive access; review print/export and permissions against a nonproduction Apps Script copy; fresh independent code review. Draft PR must remain unmerged until those gates pass.

**Known historical source concern:** `financePersonNameAliasMap_` in existing server code assigns a legacy name-only finance row to one ID when two Finance people share the same normalized name. New UI has not changed that existing global algorithm. Person-ID-bearing rows remain individually keyed; ambiguous name-only rows need a separate accounting migration/identity audit before asserting they belong to a specific person.

**Safety:** No `clasp push` or deployment occurred during this implementation. The GitHub `main` branch remains unchanged.
