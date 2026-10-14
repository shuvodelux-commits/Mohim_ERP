# Mohim ERP — Independent Finance Person Ledger Workspace (Revised Design)

**Date:** 2026-10-14  
**Status:** Approved visual design on 2026-10-14; implementation pending plan review  
**Reference:** User's two-pane Person Ledger screenshot and the subsequently approved generated UI mockup in the Oct 14 discussion, adapted to **only Finance people**. The screenshot's example amounts, roles and ledger transaction combinations are illustrative, NOT accounting test vectors; authoritative debit/credit comes from the existing Finance metadata and row balances.  
**Repository:** `shuvodelux-commits/Mohim_ERP`  
**Revision of:** Previous Finance Person Ledger proposal already in PR #25. That PR's current nested `All Transactions | Person Ledger` UI is **not the approved final layout**.

## 1. Scope and primary flow

The Finance navigation must show **three equal top-level sub-tabs** through the existing `UI.gs -> NAV_ITEMS` and `renderSubNav_` system:

1. **Business Finance** — existing transaction form and finance summary retained.
2. **Finance Ledger** — existing all-transactions page retained, **without** the nested view switch.
3. **Person Ledger** — its **own page/route** (`financePersonLedger`), showing the two-pane workspace below.

**Only finance people** are eligible: **Owner, Lender, Borrower** from `FINANCE_PERSONS`. Do not bring Customer, Supplier, Vendor, Payee or other people types into this page, and do not create a general-purpose people/party subsystem. Multi-role finance people may belong to more than one finance role; never combine accounts into one balance.

## 2. Visual direction: use screenshot as layout authority

The second attached screenshot is the locked spatial reference: search/list rail **on the left**, selected person profile/toolbar/ledger **on the right**. Apply **Mohim ERP's own colors, CSS tokens, typography, form controls and modal styles**, not a new visual design system.

### Left sidebar (approximately 28–32% on desktop)

- Search by finance person's name or phone, instant filtering; reuse existing `createPartySearchCombobox_` search and matching conventions or shared filtering logic.
- Role filters: **All | Owner | Lender | Borrower**; default All.
- List entries: compact initials avatar, name, role badge(s), phone when useful, status if inactive, **current balance with its role-specific meaning** and selected-row highlight.
- Role-specific balance semantics: **Lender Payable** positive = red / money to pay; **Borrower Receivable** positive = green / money to receive; signed negative balances use **Lender Credit** or **Borrower Credit** respectively; Owner shows **Owner Capital** or **Owner Advance**. For multi-role people show separately labeled balances; never net across roles.
- Clicking a person selects them **without navigation or page reload**; preserves focus and avoids loading the entire Finance Ledger for each list entry.

### Right workspace (approximately 68–72% on desktop)

1. **Profile header:** initials/name, phone, Active/Inactive, individual role badges. Current selected-role balance prominent on the right. For multi-role people, role chips switch the visible balance and ledger; the current role is always labeled.
2. **Actions:** primary **Record Transaction**, plus Print Statement; edit/view/delete are existing ledger transaction actions with the **same current permission checks**. Inactive people retain read-only history; disable new posting.
3. **Ledger tools:** date range, transaction type/relationship filter, search reference or note, Clear Filters, page size, and a compact period summary: Opening Balance, Period Debit, Period Credit, Closing Balance. No unrelated finance KPI grid.
4. **Ledger table:** Date, Particulars (transaction type + ID/reference and notes), Debit, Credit, Running Balance, Actions. Most recent first; maintain existing 50/100/200 paging choices, mobile-friendly rows and keyboard focus. Clearly mark pre-ERP openings as historical, not cash-session turnover.
5. **Empty states:** no person selected; selected person with no transactions; filters with no matching rows; clear errors. Do not show a blank table masquerading as zero current balance.

### Responsive behavior

- Desktop/wide tablets: two panes, fixed-width list rail and horizontally constrained ledger table.
- Narrow tablet/phone: **first show finance people list**; selecting one shows profile and ledger in a full-width view with a visible Back to People control. No narrow squeezed split layout; keep existing full-screen modal and touch control behavior.
- Keyboard: search → Arrow Up/Down → Enter selection; Esc closes search; accessible role filters and row actions.
- Existing ERP-wide clear (×), focus, light/dark tokens, and number formatting should be reused.

## 3. All transaction actions are MODAL-FIRST

### Record Transaction

**Record Transaction opens a modal inside Person Ledger; it must not navigate to Business Finance.**

- Preselected person (read-only identity, or selectable among the current person's eligible roles only).
- Transaction type filtered by the selected role, from existing `FINANCE_TRANSACTION_TYPES`.
- Date, Amount, Payment Method (Cash/Bank/Mobile Banking when appropriate), linked Bank/Mobile account when required, Reference, Notes, backdated reason.
- Reuse `finUpdateHint_` / Finance-form field semantics, type metadata, `paymentMethodNeedsAccount_`, `fillBankAccountSelect_`, `runConfirmedAction`, `banglaAmountInWords_`, and the existing permission-protected `addFinanceTransaction(token,payload)` server RPC. No new posting method.
- Pre-ERP opening entries show **no Cash/Bank movement**, preserve historical cash baseline semantics and do not affect the current Cash Session.
- The server continues to validate permission/cash session/amount/type/person-role/date; client guard matches existing Finance form.
- After successful confirmed save: close modal, refresh selected-person ledger and sidebar balances, retain selected person/role and sensible filters. On error, leave modal open and show an inline error; do not duplicate/retry money posting.

### View / Edit / Delete existing ledger entries

- Clicking a transaction row (or View from Actions) opens **View Transaction modal** on the same page, displaying date, type, person, amount, payment account/method, reference, notes, author, and running balance.
- **Edit** from the modal or row Actions opens the existing edit flow, based on `getFinanceTransactionForEdit` and **existing** `updateFinanceTransaction` plus existing financial confirmation.
- **Delete** uses the existing `confirmDelete` and `deleteFinanceTransaction`; audit, reversal and permissions unchanged.
- Avoid duplicate element IDs. When reusing Finance Ledger modals on an independent page, ensure overlay is actually mounted in a **visible modal host**, not trapped under a hidden `#page-financeLedger` ancestor.
- Do not build a second business posting route or simplify existing update/delete reversal logic. Prefer factoring small shared UI functions and reusing existing modal code over copy-pasting large finance form handlers.
- Print Statement and Export reuse `printLedgerRange` / `exportRowsToCsv` with the selected role and period, including accurate period opening/closing.

## 4. Data & accounting contract

- **No schema change** and **no new public RPC**. Maintain `Auth.gs` permissions, `Database.gs` helper boundaries, `FinanceModule.gs` transaction accounting, Cash/Bank postings, existing `DeleteEngine.gs` reversal behavior.
- Current `getFinanceBootstrap` already returns `personsAll` and type metadata, but **not individual person balances**. Add a **read-only additive field** on this *existing* response for sidebar balances, computed from **existing** `financeSignedBalances_`, `financePersonNameAliasMap_` and the same active `FINANCE_TRANSACTIONS` rows. Do **not** issue an N-person sequence of `getFinanceLedger` requests.
- Select full transaction history for one person using the **existing** `getFinanceLedger(token,{personId})`. It already sorts by date and Finance ID and carries authoritative `row.balance`.
- Display-only relationship debit/credit transformation: Owner and Lender increases appear in **Credit**, decreases in **Debit**; Borrower receivable increases appear in **Debit**, decreases in **Credit**. Opening entries participate in relationship opening/closing but are **not** cash in/out. Never modify underlying `row.debit/row.credit` cash-direction fields from the server for other consumers.
- Period opening = most recent account balance before From Date; closing = most recent account balance at/before To Date. An empty period may have a nonzero carried opening/closing.
- Inactive finance people remain visible for historical audit and printing. Legacy name-based references must follow existing ID/alias resolution; never mix two people's ledgers because names match.

## 5. Boundaries & implementation touchpoints

Expected code paths to review and adjust on PR #25 (exact paths may be refined during the written implementation plan):

- `UI.gs`: add **Person Ledger** nav child with `permKey:'finance'`.
- `index.html`: separate `<section data-page="financePersonLedger">` pointing to a dedicated `financePersonLedger.html`.
- `javascript.html`: register page loader, reuse existing shell/sub-nav and modal helpers.
- `financeLedger.html`: restore original independent **All Transactions** page (remove nested person-toggle control without damaging existing row actions, printing, editing and audit).
- `financePersonLedger.html`: the dedicated two-pane UI and scoped client state. Reuse existing Finance helpers wherever possible.
- `finance.html`: preserve its Business Finance form; share validation/confirmation helper code where necessary, rather than duplicating financial logic.
- `FinanceModule.gs`: **read-only additive individual balances in existing bootstrap response only, if needed**; financial writes and ledger signatures unchanged.
- `style.html`: minimal dedicated scoped two-pane CSS using current tokens, clear responsive breakpoints; avoid unrelated redesign.
- Tests: nav+permission/route, selected finance person, multi-role account separation, actual live modal host visibility, posting RPC/confirm sequence, edit/delete authorization, display signs and opening transactions, empty periods, search/keyboard, mobile responsive checks and no duplicate IDs.

## 6. Acceptance checklist

- [ ] Business Finance | Finance Ledger | Person Ledger appear as one native top-level sub-tab row.
- [ ] No second `All Transactions | Person Ledger` button row anywhere.
- [ ] Person Ledger includes **only Owner/Lender/Borrower**, with historical inactive finance people viewable.
- [ ] Left list allows name/phone search, role chips and correct per-person **independent** balance labels.
- [ ] Selected person and their relationship ledger are visible together on desktop; full-width, easy workflow on mobile.
- [ ] Record Transaction is a modal, **no page navigation**, reusing existing Finance posting confirmation/server RPC.
- [ ] Clicking a transaction opens the View modal on the Person Ledger page; existing Edit/Delete behavior preserved.
- [ ] Lender, Borrower and Owner opening entries, full-history current balance, filters and running balances are correct.
- [ ] Whole Node regression suite, finance financial-integrity suite, desktop/tablet/mobile mocked-browser checks pass.
- [ ] No changes to production Apps Script deployment or main until explicitly authorized.

## 7. Delivery and safety

The currently open PR #25 and preview `@1` deploy still use the **previous**, rejected nested button layout. This document **does not** mean the revised design has been implemented. Following approval of this visual design, the next step is the Superpowers implementation plan review and subsequent code revision of PR #25, followed by thorough tests and preview-only deployment with the existing preview Script/Deployment IDs.

**User-confirmed scope:** "Only finance people." The second user-supplied screenshot determines the overall two-pane layout; the generated mockup was explicitly approved on 2026-10-14. Any visual details not supported by the screenshot are bounded by existing Mohim ERP styles and UX patterns.
