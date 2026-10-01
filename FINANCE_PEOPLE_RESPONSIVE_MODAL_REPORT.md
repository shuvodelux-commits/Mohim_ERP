# Finance People Responsive Modal Upgrade Report

**Date:** 2026-09-16

## Scope

Presentation-only refinement of **Manage Finance People** on top of the audited Finance Person Master UI build.

## Production file changed

- `finance.html`

No Finance accounting, Person CRUD RPC payload, Sales, Purchase, Stock, Vendor, Expense, Bank, Customer/Supplier, Return, or shared responsive-shell production logic was changed.

## Desktop changes

- Manage Finance People modal now uses up to 1040px / 96vw instead of the generic 560px dialog width.
- Name / Phone / Description form columns use flexible zero-minimum grid tracks so fields do not force modal overflow.
- Only the people table owns horizontal overflow as a last resort; the modal body itself is locked against horizontal scrolling.
- Table uses fixed, balanced column widths and compact action buttons.
- At an 867px viewport, browser verification confirms both modal body and people table fit without horizontal scroll.

## Mobile changes

- Owner / Lender / Borrower role controls are compact role chips.
- Checkbox dimensions are explicitly 16x16 and override the global mobile 46px input sizing.
- Roles use a three-column responsive grid; Add Person becomes a full-width action below them.
- Finance People table becomes stacked cards with Name, Phone, Description, Roles, Status and Actions labels.
- Edit / Activate / Deactivate controls remain reachable without horizontal scrolling.

## Verification

- New static responsive regression: **3/3 PASS**
- Existing focused Finance UI/confirmation regression: **15/15 PASS**
- Existing Finance browser workflow: **26/26 PASS**
- Responsive browser layout probe: **7/7 PASS**
- Static Apps Script/HTML production gate: **PASS** (44 GS, 32 HTML, 520 server functions)
- Public RPC security audit: **PASS** (183 published functions)
- Full Node suite current: **232/241**
- Full Node suite previous audited baseline: **229/238**
- Both have the exact same 9 pre-existing failing UI test files; the 3 new responsive tests are additional passes.
