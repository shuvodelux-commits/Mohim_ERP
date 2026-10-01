# SherERP Counter Quick-Entry Workspace Design

**Date:** 2026-09-04  
**Status:** Approved for implementation  
**Project:** SherERP v3, Google Apps Script runtime + Google Sheets database  
**Baseline:** Latest build with Customer/Supplier Ledger workspaces and grouped collapsible sidebar

## 1. Goal

Add a first-class **Counter** workspace for rapid daily money-entry tasks from one screen:

1. Receive Customer Payment
2. Pay Supplier
3. Add Expense
4. Bank Transfer

Counter is strictly a **UI entry layer**. It must reuse the ERP's existing authoritative posting functions and must not introduce a second accounting path.

The expected counter workflow is:

`select transaction type -> select party/account/category -> enter amount -> optionally enter discount/account/details -> post -> clear form -> stay on same transaction type -> focus first field`

## 2. Non-Negotiable Accounting Boundary

Counter must never directly mutate accounting or master transaction sheets.

Counter must not directly write to:

- CUSTOMER_LEDGER
- SUPPLIER_LEDGER
- EXPENSES
- BANK_BOOK / BANK_TRANSFERS
- CASH_BOOK
- DAY_BOOK or any derived daybook source
- Customer Current Due
- Supplier Current Due
- Bank Current Balance
- settlement-discount records or profit-impact records

All posting continues through the existing native functions below.

| Counter action | Existing authoritative server function | Existing permission enforced by server |
| --- | --- | --- |
| Receive Customer Payment | `receivePayment(token, customerId, amount, method, bankAccountId, notes, date, backdatedReason, discountAmount, discountReason)` | `customers.edit` |
| Pay Supplier | `paySupplier(token, supplierId, amount, method, bankAccountId, notes, date, backdatedReason, discountAmount, discountReason)` | `suppliers.edit` |
| Add Expense | `addExpense(token, payload)` | `expense.add` |
| Bank Transfer | `transferBetweenBankAccounts(token, payload)` | `bank.add` |
| Quick Add Customer | `addCustomerChecked(token, payload)` | `customers.add` |
| Quick Add Supplier | `addSupplier(token, payload)` | `suppliers.add` |

The existing functions remain responsible for locks, cash-session enforcement, backdating rules, bank-account resolution, settlement discounts, ledger/cash/bank writes, current-balance updates, audit fields, and server-side validation.

No new functions such as `postCounterPayment`, `postCounterExpense`, or `postCounterTransfer` may perform financial mutations.

## 3. Navigation and Page Placement

Counter is a first-class page directly under POS.

Expanded sidebar order:

```text
Dashboard
POS
Counter
────────
Sales
Customers
────────
Purchases
Suppliers
Vendor
────────
Products
────────
Day Book
Bank Accounts
Expenses
Business Finance
────────
Reports
────────
Settings
```

Counter participates in the existing 68px collapsed icon rail and active-item highlighting.

Counter is a presentation workspace, not a new permission module. **Do not add `counter` to `PERMISSION_MODULES`.** Its visibility is derived from underlying action permissions.

Counter is visible when the signed-in user can perform at least one of:

- `customers.edit`
- `suppliers.edit`
- `expense.add`
- `bank.add`

Administrators see all four transaction types.

A transaction selector button is visible only when its matching native action permission is present. Quick-add buttons are additionally controlled by `customers.add` and `suppliers.add`.

Server functions still re-check permission. Client hiding is never treated as security.

## 4. Files and Responsibilities

Expected production changes:

- **Create `counter.html`**: Counter page markup, client state, searchable comboboxes, posting orchestration, reset/focus behavior, live Bangla amount-in-words.
- **Create `Counter.gs`**: read-only Counter bootstrap/read-model aggregation only. It may inspect session permissions and return lightweight UI data. It must contain no financial mutation functions.
- **Modify `UI.gs`**: add Counter navigation metadata under POS using derived-capability visibility metadata rather than a new permission module.
- **Modify `javascript.html`**: Counter icon; generic navigation visibility support for capability-based presentation items if required; reusable client helpers only where they are truly shared.
- **Modify `index.html`**: include the Counter page partial.
- **Modify `style.html`**: Counter quick-entry layout, compact transaction selector, searchable-combobox results, responsive behavior.
- **Add tests under `tests/`**: Counter acceptance and regression tests.

Existing Customer, Supplier, Expense, and Bank posting implementations should not be refactored unless a narrowly scoped reusable UI callback is required for native quick-add integration.

## 5. Counter Page Structure

The page contains a compact four-button transaction selector:

```text
[ Customer Receive ] [ Supplier Pay ] [ Expense ] [ Bank Transfer ]
```

Only one form is visible at a time.

The selected type remains active after posting. Switching types is one click/tap. During an in-flight post, switching is disabled until the request settles.

Counter has no transaction-history table, ledger table, edit/delete actions, or reporting. Those stay in their original modules.

## 6. Counter Bootstrap

Add one read-only aggregation endpoint:

```text
getCounterBootstrap(token)
```

Its purpose is to reduce Apps Script round trips while keeping the mutation paths native.

It must:

1. Resolve the session user.
2. Determine action capabilities with existing `hasPermission_` logic.
3. Return data only for capabilities the user can actually use.
4. Return lightweight search/display shapes, not full histories.

Proposed response shape:

```js
{
  capabilities: {
    customerReceive: true|false,
    customerAdd: true|false,
    supplierPay: true|false,
    supplierAdd: true|false,
    expenseAdd: true|false,
    bankTransfer: true|false,
    settlementDiscount: true|false
  },
  customers: [{ id, name, phone, due }],
  suppliers: [{ id, name, phone, payable }],
  expenseCategories: [{ id, name }],
  expensePayees: [{ id, name, phone }],
  paymentAccounts: [{ id, name, type }],
  expensePaymentMethods: [...],
  transferAccounts: [{ id, name, type }],
  currencySymbol: "...",
  businessDate: "yyyy-MM-dd"
}
```

### 6.1 Permission-sensitive read model

Do not implement the bootstrap by blindly calling page bootstraps that require `view` permissions. The native posting functions are gated by action permissions such as `customers.edit`, `suppliers.edit`, `expense.add`, and `bank.add`.

Therefore `getCounterBootstrap` should validate the exact posting capability and then read only the lightweight rows necessary for that posting flow. This prevents an artificial dependency on `customers.view` or `suppliers.view` when the user's role is valid for payment posting.

### 6.2 Customer/Supplier data

Return only active, non-deleted parties suitable for new payment posting:

Customer:

```js
{ id: Customer ID, name: Customer Name, phone: Phone, due: Current Due }
```

Supplier:

```js
{ id: Supplier ID, name: Supplier Name, phone: Phone, payable: Current Due }
```

Inactive/deleted parties must not appear because native `receivePayment` and `paySupplier` reject them.

### 6.3 Accounts and methods

Use existing helpers/constants:

- `getActiveBankAccountsForUI_()` for payment account rows `{id,name,type}`.
- New Customer/Supplier payments use the same visible methods as their current native create-payment UI: `Cash`, `Bank`, `Mobile Banking`.
- Expense methods come from the existing `EXPENSE_PAYMENT_METHODS` constant: `Cash`, `Bank`, `Mobile Banking`, `Other`.
- Bank Transfer uses active bank/mobile-banking account rows from the existing BANK_ACCOUNTS data.

Do not invent Counter-only payment methods.

## 7. Customer Receive Form

Primary visible fields:

```text
Customer                     [ searchable combobox ] [+ Add]
Current Due                  read-only
Amount                       numeric
Bangla amount in words       read-only live text
Discount Given               numeric, default 0
Discount Reason              conditional when discount > 0
Payment Method               Cash / Bank / Mobile Banking
Account                      conditional for Bank/Mobile Banking
[ More details ▾ ]
[ RECEIVE ৳<amount> ]
```

More Details contains:

- Payment Date, default business today
- Note
- Backdated Reason, shown/required only when Payment Date is before business today

The visible `Total Settled` and `Balance After` summary should reuse the same arithmetic semantics as the existing Customer payment UI:

- physical receipt = `Amount`
- settlement = `Amount + Discount`
- Bangla amount-in-words describes **Amount only**, never the discount or total settlement

Discount permission and validation continue through existing settlement-discount rules. When the user lacks settlement-discount permission, the Counter discount control must be unavailable/disabled in the same effective way as the native workflow.

Posting call is exactly the existing `receivePayment(...)` signature.

## 8. Supplier Pay Form

Primary visible fields:

```text
Supplier                     [ searchable combobox ] [+ Add]
Current Payable              read-only
Amount                       numeric
Bangla amount in words       read-only live text
Discount Received            numeric, default 0
Discount Reason              conditional when discount > 0
Payment Method               Cash / Bank / Mobile Banking
Account                      conditional for Bank/Mobile Banking
[ More details ▾ ]
[ PAY ৳<amount> ]
```

More Details contains:

- Payment Date, default business today
- Note
- Backdated Reason, conditional for past dates

Bangla amount-in-words describes the actual money paid, not `Amount + Discount`.

Posting call is exactly the existing `paySupplier(...)` signature.

## 9. Expense Form

The current native `addExpense` function requires both a category and a payee. Counter must therefore expose both rather than simplifying away a mandatory native field.

Primary visible fields:

```text
Expense Category             searchable/selectable
Payee                        searchable/selectable
Description                  text
Amount                       numeric
Bangla amount in words       read-only live text
Payment Method               native expense method list
Account                      conditional for Bank/Mobile Banking
[ More details ▾ ]
[ ADD EXPENSE ]
```

More Details contains:

- Date, default business today
- Reference No
- Notes
- Backdated Reason, conditional for past date

Posting payload must map directly to the existing `addExpense(token, payload)` contract:

```js
{
  date,
  categoryId,
  payeeId,
  amount,
  paymentMethod,
  bankAccountId,
  description,
  referenceNo,
  notes,
  backdatedReason
}
```

Counter must not bypass the existing payee requirement.

## 10. Bank Transfer Form

Primary visible fields:

```text
From Account                 searchable/selectable
To Account                   searchable/selectable
Amount                       numeric
Bangla amount in words       read-only live text
[ More details ▾ ]
[ TRANSFER ]
```

More Details contains:

- Notes

The native transfer function currently owns the transaction date and accepts only `{fromAccountId,toAccountId,amount,notes}`. Counter must not add a Counter-only transfer-date field unless the native Bank module is separately redesigned in a future feature.

Client pre-validation:

- From required
- To required
- From != To
- Amount > 0

Server `transferBetweenBankAccounts` remains final authority.

## 11. Searchable Customer/Supplier Combobox

Customer and Supplier selection is a searchable combobox, not a static dropdown.

Required behavior:

- Search by name.
- Search by phone.
- Case-insensitive English matching.
- Reuse existing Bangla/English normalization helpers where available and safe.
- Partial matching.
- Render only a small result slice, target 10-20 matches, rather than hundreds of DOM nodes.
- Arrow Up/Down moves highlight.
- Enter selects the highlighted result.
- Escape closes results.
- Mouse/touch selects.
- Selection immediately shows Due/Payable and moves focus to Amount.
- Clear selection returns focus to search.

Example result:

```text
Rahim Enterprise
01712xxxxxx                  Due ৳25,000
```

The bootstrap may carry the lightweight index in memory; search is performed client-side with no Apps Script call per keystroke.

## 12. Quick Add Customer and Supplier

The `+ Add` action must use the existing native Add Customer/Add Supplier UI and native server save functions, not a reduced Counter-specific master-data form.

### 12.1 Existing modal reuse

Current Customer and Supplier add modals are already loaded into the single-page application through `customers.html` and `suppliers.html`. Counter may open those native modals through a small reusable opener/callback contract.

If necessary, extract only the **UI opener/save-success callback hook** from the current page scripts. Do not duplicate customer/supplier validation or creation logic.

### 12.2 Success flow

```text
Counter + Add
-> native Add Customer/Supplier modal
-> native save function succeeds
-> refresh only the relevant lightweight Counter party list
-> identify newly created ID from server response
-> auto-select new party
-> show due/payable
-> focus Amount
```

The existing `addCustomerChecked` and `addSupplier` responses already return `{id}` and should remain the source of the new ID.

### 12.3 Cancel/error behavior

Opening quick-add must not destroy the current Counter form state.

- Cancel: restore exact Counter state.
- Save error: keep native modal values and native error handling.
- Save success: preserve any Counter amount/discount/note values that the cashier had already typed, while selecting the newly created party.

## 13. Live Bangla Amount-in-Words

All four forms show live Bangla wording immediately below the Amount field.

Examples:

```text
125
একশ পঁচিশ টাকা মাত্র
```

```text
12,500
বারো হাজার পাঁচশ টাকা মাত্র
```

```text
1,25,000
এক লাখ পঁচিশ হাজার টাকা মাত্র
```

```text
1,25,00,000
এক কোটি পঁচিশ লাখ টাকা মাত্র
```

```text
23,000.50
তেইশ হাজার টাকা পঞ্চাশ পয়সা মাত্র
```

Rules:

- Client-side only. No Apps Script RPC while typing.
- Supports Bangladeshi grouping: হাজার, লাখ, কোটি.
- Supports up to two decimal places as পয়সা.
- Empty, invalid, or zero amount renders no wording.
- Read-only display only; never used to derive the numeric payload.
- Customer/Supplier discount is never included in the wording.
- Output should be deterministic and covered with direct unit/regression cases.

## 14. Keyboard and Focus Model

Counter is optimized for repetitive cashier entry.

General rules:

- Search Enter selects a party/result; it does not post.
- Enter on normal fields advances to the next currently visible/relevant field.
- Hidden conditional fields are skipped.
- Enter on the final editable field moves to the primary Post button.
- A further Enter/click on the Post button posts.
- Do not implement a global Enter shortcut that can accidentally post from arbitrary fields.

Typical cash Customer Receive sequence:

`Customer Search -> Enter/select -> Amount -> Discount -> Payment Method -> Post`

If Discount is zero, Discount Reason is absent from focus order.

If method is Cash, Account is absent from focus order.

## 15. Conditional Field Rules

### Discount Reason

Shown and required only when Discount > 0.

### Bank/Mobile Account

Shown only when `paymentMethodNeedsAccount_(method)` is true.

Changing from Bank/Mobile Banking to Cash/Other must clear any previously selected account ID immediately so hidden stale values cannot leak into posting.

Use existing `fillBankAccountSelect_` behavior to filter account type:

- Bank -> Bank accounts
- Mobile Banking -> Mobile Banking accounts

### More Details

Collapsed by default. Reset closes it again after successful posting.

## 16. Posting State and Duplicate Protection

On Post:

1. Run lightweight client validation.
2. Lock the active form and transaction-type selector against duplicate interaction.
3. Change primary button text to an in-progress label such as `Receiving...`, `Paying...`, `Saving...`, or `Transferring...`.
4. Call the existing native server function once.
5. On success, show confirmation and reset.
6. On failure, unlock without clearing values.

No optimistic accounting update.

A form must maintain an in-flight flag so double-click, double-tap, and repeated Enter cannot create a second RPC.

## 17. Success Reset Rules

Reset occurs **only after confirmed native server success**.

### Customer Receive

- customer: clear
- amount: clear
- amount words: clear
- discount: reset to 0/blank according to native convention
- discount reason: clear/hide
- bank account: clear/hide if not needed
- note: clear
- payment date: business today
- backdated reason: clear/hide
- More Details: closed
- active transaction type: remains Customer Receive
- focus: Customer Search

### Supplier Pay

Equivalent reset; focus Supplier Search.

### Expense

- category: clear
- payee: clear
- description: clear
- amount: clear
- amount words: clear
- payment method: native default
- account: clear/hide if not needed
- date: business today
- reference: clear
- notes: clear
- backdated reason: clear/hide
- More Details: closed
- active type remains Expense
- focus: Expense Category

### Bank Transfer

- From: clear
- To: clear
- Amount: clear
- amount words: clear
- Notes: clear
- More Details: closed
- active type remains Bank Transfer
- focus: From Account

## 18. Error Preservation

Any native validation error, permission error, Apps Script error, or network failure must preserve the user's entry.

Failure means:

- selected party/account remains
- amount remains
- discount remains
- conditional account remains
- More Details values remain
- active transaction type remains
- Post controls re-enable
- native error text is shown

No form fields are cleared on failure.

Where the failing field is obvious from local validation, focus that field. Otherwise retain current focus or focus the primary relevant field without erasing input.

## 19. Success Feedback

Use the existing toast system for unobtrusive confirmation.

Examples:

- `Received ৳23,000 from Rahim Enterprise`
- `Paid ৳28,000 to ABC Supplier`
- `Expense saved: ৳1,500`
- `Transferred ৳10,000`

The confirmation must describe the actual physical Amount, not Customer/Supplier settlement total including discount.

## 20. Mobile and Responsive Layout

Counter must work as a phone-first quick-entry form while preserving the current global mobile navigation.

Requirements:

- No horizontal page overflow.
- Forms become one column on phone.
- Numeric fields request numeric/decimal mobile keyboard where possible.
- Search result rows remain touch-friendly.
- `+ Add` remains reachable beside or immediately under the combobox.
- Four transaction-type buttons may use a compact 2x2 arrangement or a single-row scroll only when necessary; they must remain one-tap choices.
- Primary Post button has a large touch target.
- Existing mobile bottom navigation/More behavior remains unchanged except Counter may be surfaced through the existing navigation system according to its normal rules.

Desktop keeps a compact centered quick-entry workspace rather than stretching fields across the full viewport.

## 21. Apps Script / Google Sheets Performance Rules

- One bootstrap RPC for initial Counter data.
- No RPC per combobox keystroke.
- No ledger histories in bootstrap.
- No full Customer/Supplier detail payloads.
- Refresh only the affected party list after quick-add.
- Use current shared account helper rather than reading account sheets separately for each form.
- Financial mutations remain one native posting RPC each.
- Do not add new sheet scans after a successful post solely to animate UI; refresh only data needed to prepare the next entry.

## 22. Scope Exclusions

Counter V1 does not include:

- Sales
- Purchases
- Sales Returns
- Purchase Returns
- Business Finance borrowing/investment
- transaction history
- edit/delete transaction
- ledger display
- correction workflow
- reports
- cash-day open/close controls
- a new permission module
- new accounting/posting functions
- Counter-specific bank-transfer date

## 23. Acceptance and Regression Test Matrix

The implementation is not release-ready until the following behaviors are executable and green.

1. Counter appears directly below POS.
2. Counter is hidden when user has none of the underlying posting permissions.
3. Customer Receive button follows `customers.edit`.
4. Supplier Pay button follows `suppliers.edit`.
5. Expense button follows `expense.add`.
6. Bank Transfer button follows `bank.add`.
7. `+ Add Customer` follows `customers.add`.
8. `+ Add Supplier` follows `suppliers.add`.
9. Customer combobox searches by name.
10. Customer combobox searches by phone.
11. Supplier combobox searches by name.
12. Supplier combobox searches by phone.
13. Combobox renders only a bounded match slice rather than the entire list.
14. Arrow keys and Enter select highlighted combobox result.
15. Search Enter selects rather than posting.
16. Customer selection shows correct Current Due.
17. Supplier selection shows correct Current Payable.
18. Customer quick-add opens/reuses the native Customer add flow.
19. Customer save uses `addCustomerChecked`.
20. Newly added customer auto-selects by returned ID.
21. Supplier quick-add opens/reuses the native Supplier add flow.
22. Supplier save uses `addSupplier`.
23. Newly added supplier auto-selects by returned ID.
24. Quick-add cancel preserves current Counter form state.
25. Quick-add success preserves pre-existing Counter amount/discount/note values while selecting new party.
26. Customer posting calls existing `receivePayment` with the native positional contract.
27. Supplier posting calls existing `paySupplier` with the native positional contract.
28. Expense posting calls existing `addExpense` with native payload fields, including required `payeeId`.
29. Bank Transfer posting calls existing `transferBetweenBankAccounts` with native payload fields only.
30. `Counter.gs` contains no financial sheet writer / append/update transaction path.
31. Customer settlement discount still uses existing native validation/accounting.
32. Supplier settlement discount still uses existing native validation/accounting.
33. Discount Reason appears only when discount > 0 and is required then.
34. Bank/Mobile account selector appears only when required.
35. Changing payment method clears stale hidden account ID.
36. Bank method filters to Bank accounts.
37. Mobile Banking method filters to Mobile Banking accounts.
38. Expense exposes native required Payee field.
39. Expense uses native method list including `Other`.
40. Bank Transfer has no Counter-only date field.
41. Bangla words update live without RPC.
42. Bangla words correctly render hundreds/basic numbers.
43. Bangla words correctly render হাজার.
44. Bangla words correctly render লাখ.
45. Bangla words correctly render কোটি.
46. Decimal amount correctly renders পয়সা to two places.
47. Customer/Supplier discount is excluded from amount-in-words.
48. Empty/zero/invalid amount shows no words.
49. Enter advances only through visible/relevant fields.
50. Enter from an arbitrary field cannot accidentally submit.
51. Post button/in-flight flag prevents duplicate RPC submission.
52. Transaction selector is locked while a post is in flight.
53. Native/server error preserves every entered value.
54. Network/RPC failure preserves every entered value.
55. Success resets the active form.
56. Success retains the active transaction type.
57. Customer success returns focus to Customer Search.
58. Supplier success returns focus to Supplier Search.
59. Expense success returns focus to Category.
60. Bank Transfer success returns focus to From Account.
61. More Details defaults closed.
62. Successful reset closes More Details.
63. Customer/Supplier/Expense date defaults to business today.
64. Backdated reason appears and is required according to existing native date behavior.
65. Customer success toast reports actual Amount, not settlement total.
66. Supplier success toast reports actual Amount, not settlement total.
67. Mobile Counter has no horizontal overflow.
68. Existing Customer module receive-payment flow remains unchanged and green.
69. Existing Supplier module payment flow remains unchanged and green.
70. Existing Expense module remains unchanged and green.
71. Existing Bank Transfer module remains unchanged and green.
72. Existing settlement-discount regression suite remains green.
73. Existing Day Book/Cash/Bank/accounting regression suite remains green.
74. Existing Customer/Supplier Ledger workspaces remain green.
75. Existing grouped/collapsible sidebar behavior remains green.
76. Apps Script parse checks remain clean.
77. HTML script parse checks remain clean.
78. RPC target audit reports no missing server functions.
79. Duplicate top-level server-function audit remains clean.
80. Final full ZIP passes clean-extraction regression verification.

## 24. Release Deliverables

After implementation and final verification, deliver:

1. Full SherERP ZIP based on the latest grouped-collapsible-sidebar + Customer/Supplier-Ledger baseline.
2. Changed-files-only ZIP containing only files changed for Counter.
3. Fresh verification summary with actual test/check counts from the final extracted ZIP.

## 25. Design Invariant

The load-bearing invariant is:

> **Counter introduces zero new accounting behavior. It is a rapid UI doorway into SherERP's existing authoritative transaction functions.**

Any implementation choice that duplicates posting logic, bypasses native permission/validation, or writes accounting sheets directly violates this design.
