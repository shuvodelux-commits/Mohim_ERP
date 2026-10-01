# SherERP Global Confirmation Dialog System — Design Specification

**Date:** 2026-09-05  
**Project:** SherERP  
**Runtime:** Google Apps Script  
**Database:** Google Sheets  
**Status:** Design approved in chat; written specification pending final user review

## 1. Purpose

SherERP currently uses a mixture of a specialized `confirmDelete(...)` flow and scattered native browser `confirm(...)` prompts, while many financially important actions post immediately after client validation. This specification introduces one reusable confirmation-dialog system for important actions across the ERP.

The system is a **client-side safety layer only**. It decides **when an existing action is allowed to execute**. It must never change the accounting, stock, ledger, locking, audit, permission, or validation behavior of that action.

### Core invariant

> **Confirmation changes only when an existing important action is allowed to execute. It never changes what that action does.**

No confirmation state, pending transaction sheet, confirmation token, or approval workflow is added to Google Sheets.

---

## 2. Scope

A confirmation is required when an action does at least one of the following:

- moves money;
- changes stock;
- changes accounting;
- changes a posted transaction;
- deletes, voids, cancels, or reverses an important record;
- materially activates/deactivates a business object;
- changes important security/system state.

Routine UI and ordinary non-financial master-data operations do not require confirmation.

### Explicitly not confirmed

The shared confirmation system must **not** interrupt:

- View;
- Print;
- Search/filter;
- Pagination;
- Navigation;
- Report generation;
- Ledger selection;
- Opening an ordinary modal;
- Choosing a Customer/Supplier;
- quick-add Customer/Supplier/Expense Category/Payee;
- ordinary new master creation;
- ordinary non-financial master edit.

This prevents confirmation fatigue.

---

## 3. Chosen Architecture

### 3.1 One global confirmation service

SherERP will use one shared client-side confirmation service, conceptually named:

```js
confirmAction(options)
```

The global dialog container must live in `index.html`, **outside all SPA page sections**. This is mandatory because a modal nested inside a hidden page section can remain invisible even when its own `hidden` flag is removed; SherERP already encountered this class of bug in Counter quick-add.

Shared behavior belongs in `javascript.html`, and responsive/variant styling belongs in `style.html`.

### 3.2 UI-only orchestration

Every protected action follows the same boundary:

```text
User action
  ↓
Existing client validation
  ↓
Build and freeze exact native payload
  ↓
Open shared confirmation dialog
  ↓
User confirms
  ↓
Call the same existing native function with the frozen payload
  ↓
Existing server validation/accounting/stock/audit behavior
```

The confirmation layer must not add new accounting writers or direct Google Sheets mutations.

### 3.3 Existing native functions remain authoritative

Examples:

```text
Counter Customer Receive
  → confirmAction(...)
  → existing receivePayment(...)

Counter Supplier Pay
  → confirmAction(...)
  → existing paySupplier(...)

Counter Expense
  → confirmAction(...)
  → existing addExpense(...)

Counter Bank Transfer
  → confirmAction(...)
  → existing transferBetweenBankAccounts(...)
```

The same principle applies to Sales, Purchase, Returns, Finance, Vendor, stock operations, and destructive actions.

---

## 4. Shared API Contract

The application-facing contract should be Promise-based.

```js
const result = await confirmAction({
  type: 'financial',
  title: 'Receive Payment?',
  message: 'Shuvo-এর কাছ থেকে পেমেন্ট গ্রহণ করছেন।',
  details: [
    { label: 'Amount', value: '৳5,000', emphasis: true },
    { label: 'In words', value: 'পাঁচ হাজার টাকা মাত্র' },
    { label: 'Method', value: 'Cash' }
  ],
  confirmLabel: 'Receive ৳5,000',
  cancelLabel: 'Cancel',
  reason: {
    required: false,
    label: 'Reason',
    placeholder: 'Enter reason...'
  }
});

if (!result.confirmed) return;
existingNativeAction(result.reason);
```

### 4.1 Supported option fields

`confirmAction(options)` supports:

- `type`: `'financial' | 'danger' | 'state-change'`;
- `title`: short action-oriented title;
- `message`: short contextual explanation;
- `details`: ordered summary rows;
- `confirmLabel`: exact action label;
- `cancelLabel`: defaults to `Cancel`;
- `reason.required`: whether reason entry is mandatory;
- `reason.label`: reason field label;
- `reason.placeholder`: optional hint;
- `reason.maxLength`: use existing backend constraint when known;
- `loadingLabel`: text shown while native action is running when wrapper manages pending state;
- optional trigger element reference for focus restoration.

### 4.2 Return value

```js
{
  confirmed: true | false,
  reason: 'trimmed reason string'
}
```

On cancel, `confirmed` is `false` and no native mutation runs.

### 4.3 One dialog at a time

Only one global confirmation may be active. A second request while one is active must not stack another modal. The implementation may reject, ignore, or serialize the second request, but stacking is forbidden.

---

## 5. Payload Freezing and Accounting Safety

The form payload must be built **before** opening the confirmation dialog and treated as immutable for that confirmation cycle.

The same frozen values must drive:

1. the confirmation summary shown to the user; and
2. the existing native function call after confirmation.

This prevents a mismatch where the dialog says one amount/party/account but the server receives another because underlying fields changed.

### 5.1 Underlying form lock

While confirmation is open:

- the background form is blocked by the modal backdrop;
- the user cannot edit the fields being confirmed;
- cancel restores the untouched form state;
- confirm executes the frozen payload.

---

## 6. Confirmation Variants

### 6.1 Financial

Used for money/stock/accounting posting actions.

Visual treatment:

- normal primary action color;
- prominent amount/value;
- Bangla amount-in-words when monetary;
- party/account/document context;
- settlement details where relevant.

Example:

```text
Receive Payment?

Shuvo-এর কাছ থেকে পেমেন্ট গ্রহণ করছেন।

Amount
৳5,000
পাঁচ হাজার টাকা মাত্র

Method
Cash

[ Cancel ]    [ Receive ৳5,000 ]
```

### 6.2 Danger

Used for destructive actions such as Delete/Void/Cancel/Reverse.

Visual treatment:

- red/danger confirm button;
- explicit consequence statement;
- required reason inside dialog when the existing action requires one.

Example:

```text
Delete Expense?

Category: Salary
Payee: Rahim
Amount: ৳8,000

This will reverse the related accounting effect.

Reason *
[ Enter reason... ]

[ Cancel ]    [ Delete Expense ]
```

### 6.3 State change

Used for meaningful activation/deactivation and security/system state changes.

Visual treatment:

- warning styling;
- object identity/current state;
- concise consequence statement.

---

## 7. Amount Formatting and Bangla Words

The confirmation system must reuse the existing Bangla amount-in-words utility introduced for Counter. It must not create a second converter.

Supported wording includes:

- হাজার;
- লাখ;
- কোটি;
- পয়সা.

### 7.1 Actual money movement rule

For Customer/Supplier settlement discount, amount-in-words describes the **actual Cash/Bank/Mobile money movement**, not settlement total.

Example:

```text
Amount received       ৳4,500
Discount given          ৳500
Total settled         ৳5,000

চার হাজার পাঁচশ টাকা মাত্র
```

The numeric summary may show both cash movement and total settlement so the user can verify both.

---

## 8. Reason Handling

If an existing action requires a reason, the reason belongs inside the shared confirmation dialog.

Rules:

- blank or whitespace-only reason is invalid;
- reason is trimmed before use;
- Confirm remains disabled or validation blocks confirmation until reason is valid;
- existing backend length/validation constraints remain authoritative;
- the exact reason is passed into the existing native action;
- the same reason must not be requested twice in both the original form and confirmation dialog.

Actions that do not currently need a reason remain simple and do not gain an unnecessary reason requirement.

---

## 9. Keyboard and Focus Behavior

The user selected **Confirm-first focus** for speed.

### 9.1 Opening behavior

- Confirm button receives initial focus.
- The same Enter keypress that opened the dialog must **not** also confirm it.
- A deliberate second Enter confirms.
- `Esc` cancels before submission starts.
- Tab navigation is trapped within the active dialog.
- Focus returns to the original trigger after Cancel.
- Visible focus styles remain intact.

### 9.2 Double-Enter guard

Do not use an arbitrary visible delay. The implementation should consume/guard the originating keyboard event or use an event-cycle/opening token so only a subsequent deliberate Enter can confirm.

---

## 10. Async and Duplicate-Submit Safety

After the user confirms and the native request begins:

- Confirm becomes disabled;
- Cancel becomes disabled;
- Esc is ignored;
- backdrop click is ignored;
- duplicate click/Enter cannot start another RPC;
- underlying form remains locked;
- button text may change to a loading label such as `Receiving...`.

### 10.1 Success

On success:

- dialog closes;
- the existing module's native success behavior runs unchanged;
- Counter still performs its approved reset/focus behavior after confirmed successful posting.

### 10.2 Failure

On native/server/network failure:

- no success message is shown;
- dialog closes and returns to the original form, unless an existing module has a stronger established behavior;
- original form values remain available for correction/retry;
- native error is shown;
- no optimistic accounting state is created.

---

## 11. Responsive Presentation

### 11.1 Desktop/tablet

Use a centered modal dialog with backdrop.

### 11.2 Mobile

Use the same global component as a bottom sheet:

- anchored to bottom;
- rounded top corners;
- maximum height with internal scrolling;
- sticky action row at bottom;
- reason field remains accessible above actions;
- backdrop blocks the page;
- no horizontal overflow.

The business/action API is identical on all screen sizes.

---

## 12. Accessibility

The component must provide:

- `role="dialog"`;
- `aria-modal="true"`;
- `aria-labelledby` tied to the current title;
- focus trap;
- keyboard cancellation before posting;
- focus restoration after cancel;
- visible focus ring;
- readable summary ordering;
- no reliance on color alone to communicate danger/state.

---

## 13. Compatibility Strategy

SherERP already has a specialized `confirmDelete(...)` path and scattered browser `confirm(...)` calls.

### 13.1 `confirmDelete(...)` compatibility wrapper

Do not immediately rewrite every existing delete caller. Convert `confirmDelete(...)` into a compatibility wrapper around the new global service where its current caller contract can be preserved.

Conceptually:

```js
function confirmDelete(opts) {
  return confirmAction({
    type: 'danger',
    title: opts.title || 'Delete?',
    // map existing fields/options
  }).then(function (result) {
    if (!result.confirmed) return;
    // execute the same existing native delete path
  });
}
```

This gives existing callers the new UI while minimizing accounting/delete regression risk.

### 13.2 Browser `confirm(...)` migration

Protected workflows using browser `confirm(...)` must be migrated to `confirmAction(...)`.

Current examples found in the latest UI include:

- Expense Category activate/deactivate;
- Supplier activate/deactivate;
- Vendor activate/deactivate;
- Remove invoice logo;
- Role activate/deactivate/delete;
- Customer permanent delete;
- Product list removal and Product activate/deactivate;
- Bank Account activate/deactivate;
- User activate/deactivate/permanent delete;
- Sign out.

Migration must preserve existing native server calls and permission checks.

---

## 14. Exact Coverage Matrix

### 14.1 Counter

Confirm:

- Receive Customer Payment;
- Pay Supplier;
- Add Expense;
- Bank Transfer.

Do not confirm:

- quick-add Customer;
- quick-add Supplier;
- quick-add Expense Category;
- quick-add Payee;
- transaction-type switching.

### 14.2 Customer

Confirm:

- Receive Payment;
- edit posted Customer Payment;
- delete Customer Payment;
- Customer deletion;
- accounting-changing opening balance actions where applicable.

Customer Ledger uses the same native confirmation policy.

Ordinary address/phone/name edits do not require confirmation unless they trigger an accounting repost.

### 14.3 Supplier

Confirm:

- Supplier Payment;
- edit posted Supplier Payment;
- delete Supplier Payment;
- Supplier deletion;
- activate/deactivate Supplier;
- accounting-changing opening balance actions where applicable.

Supplier Ledger uses the same native confirmation policy.

### 14.4 Expense

Confirm:

- Add Expense;
- edit posted Expense;
- delete Expense;
- Expense Category activate/deactivate.

Do not confirm quick-add Category/Payee.

### 14.5 Bank

Confirm:

- Bank Transfer;
- manual bank financial entry;
- financial reversal/adjustment;
- Bank Account activate/deactivate.

Summary must show account and, for transfer, both From and To.

### 14.6 Sales/POS

Confirm:

- complete/post Sale;
- edit posted Sale when it reverses/reposts accounting/stock;
- delete Sale;
- Sales Return;
- Start Cash Session;
- Close Cash Session.

Sale confirmation should show, where available:

- Customer;
- invoice total;
- paid now;
- due;
- item count;
- payment method/account;
- actual money amount in Bangla words.

Close Cash Session should emphasize expected cash, counted cash, and difference.

### 14.7 Purchase

Confirm:

- create/post Purchase;
- edit posted Purchase when it reverses/reposts accounting/stock;
- delete Purchase;
- Purchase Return.

Purchase confirmation should show:

- Supplier;
- purchase total;
- paid amount;
- due;
- landed/extra cost where material;
- item count;
- payment source.

### 14.8 Returns

Sales Return and Purchase Return confirmations must warn that stock and accounting will change and show the relevant document/party/amount/item summary.

### 14.9 Finance

Confirm:

- Add Finance Transaction;
- Update Finance Transaction;
- Delete Finance Transaction;
- Finance Person activate/deactivate.

Do not confirm ordinary Finance Person creation/edit of non-financial master fields.

### 14.10 Vendor Workspace

Confirm:

- Pay Vendor;
- Receive Payment from Vendor;
- Give Products to Vendor;
- Receive Products from Vendor;
- Return Products to Vendor;
- edits to posted vendor money/stock transactions;
- deletion/reversal;
- vendor activate/deactivate/delete.

Inventory movement confirmation must show product and quantity prominently.

### 14.11 Product / Inventory

Confirm:

- direct Stock Adjustment;
- Product delete;
- Product activate/deactivate;
- remove Category/Brand from available selections where the current workflow already treats that as an important state change.

Stock adjustment summary should show current stock, adjustment, resulting stock, and reason.

Ordinary Product creation/edit does not require confirmation unless it directly mutates stock/accounting.

### 14.12 Users / Roles / System

Confirm:

- User activate/deactivate;
- User permanent delete;
- Reset user password;
- Role activate/deactivate;
- Role delete;
- Sign out;
- Remove invoice logo;
- other equivalent security/system-state destructive actions.

These use state-change or danger variants and do not require financial formatting.

---

## 15. Validation Order

Protected actions must follow this exact order:

1. user fills form;
2. existing client validation runs;
3. if invalid, show validation error and **do not open confirmation**;
4. build/freeze exact native payload;
5. build summary from the same payload;
6. open confirmation;
7. optional reason validation occurs inside confirmation;
8. user confirms;
9. existing native function executes;
10. existing native success/error behavior continues.

The dialog must never make an invalid transaction look ready to post.

---

## 16. Google Apps Script / Google Sheets Constraints

The confirmation system must remain entirely client-side except for calling the existing native functions after confirmation.

It must **not** add:

- a Confirmation sheet;
- pending transaction rows;
- extra confirmation RPCs;
- confirmation tokens;
- polling;
- server locks dedicated to the dialog;
- duplicate mutation functions.

This avoids extra Apps Script round trips and Google Sheets contention.

---

## 17. Error Handling Rules

- Cancel: execute nothing; preserve form.
- Client validation failure: no dialog.
- Required reason missing: stay in dialog; do not execute.
- Native permission failure: show existing error; no success state.
- Native validation failure: show existing error; preserve form.
- Network/Apps Script failure: show error; preserve form.
- Repeated click/Enter during pending request: ignored.
- Attempt to open second confirmation while first is open: no stacking.

---

## 18. Implementation Boundaries

Expected shared files:

- `index.html`: one global confirmation container outside module page sections;
- `javascript.html`: `confirmAction(...)`, focus management, keyboard guard, compatibility wrapper, common summary helpers;
- `style.html`: desktop modal, mobile bottom sheet, financial/danger/state styling.

Expected module files are modified only at action entry points to:

1. validate;
2. freeze payload;
3. construct contextual summary;
4. await confirmation;
5. call the same existing native action.

Server `.gs` code should remain unchanged unless an existing reason field must be passed through an already-supported function signature. No new financial mutation function is permitted for confirmation.

---

## 19. Release Acceptance Matrix

The implementation is not accepted until all applicable checks below are executable and green.

1. Shared confirmation container exists globally outside SPA page sections.
2. Desktop renders centered modal.
3. Mobile renders bottom sheet.
4. Only one confirmation can exist at a time.
5. Confirm receives initial focus.
6. Opening Enter does not immediately confirm.
7. A second Enter confirms.
8. Esc cancels before posting.
9. Focus returns to trigger after Cancel.
10. Background form cannot be interacted with while dialog is open.
11. Frozen payload drives both summary and submitted native action.
12. Customer Receive uses shared confirmation.
13. Customer Ledger Receive uses shared confirmation.
14. Counter Customer Receive uses shared confirmation.
15. Supplier Pay uses shared confirmation.
16. Supplier Ledger Pay uses shared confirmation.
17. Counter Supplier Pay uses shared confirmation.
18. Expense Add uses shared confirmation.
19. Counter Expense uses shared confirmation.
20. Bank Transfer uses shared confirmation.
21. Counter Bank Transfer uses shared confirmation.
22. Sale posting requires confirmation.
23. Purchase posting requires confirmation.
24. Sales Return requires confirmation.
25. Purchase Return requires confirmation.
26. Start Cash Session requires confirmation.
27. Close Cash Session requires confirmation.
28. Finance posting requires confirmation.
29. Vendor money movement requires confirmation.
30. Vendor stock movement requires confirmation.
31. Stock adjustment requires confirmation.
32. Delete Sale uses danger dialog.
33. Delete Purchase uses danger dialog.
34. Delete Customer Payment uses danger dialog.
35. Delete Supplier Payment uses danger dialog.
36. Delete Expense uses danger dialog.
37. Delete Finance Transaction uses danger dialog.
38. Existing `confirmDelete()` compatibility path still works.
39. Required destructive reason appears in dialog.
40. Blank required reason blocks confirmation.
41. Entered reason reaches existing native function unchanged.
42. Financial summary shows amount numerically.
43. Financial summary shows Bangla words.
44. Settlement discount shows both money movement and total settlement.
45. Bangla words use actual cash/bank movement, not settlement total.
46. Bank confirmation shows account.
47. Bank Transfer shows both From and To accounts.
48. Sale confirmation shows customer, total, paid, due, and item count.
49. Purchase confirmation shows supplier, total, payment, due, and item count.
50. Return confirmation warns stock/accounting will change.
51. Dangerous confirm button uses danger styling.
52. Financial confirm uses primary styling.
53. State-change confirm uses warning styling.
54. Confirm becomes disabled after submit.
55. Repeated click cannot cause duplicate RPC.
56. Repeated Enter cannot cause duplicate RPC.
57. Cancel is disabled while native RPC is running.
58. Server failure does not falsely show success.
59. Posting failure preserves original form values.
60. Client validation occurs before confirmation.
61. Invalid forms never show a misleading confirmation.
62. Quick-add Customer/Supplier/Payee/Category does not get unnecessary confirmation.
63. View/Print/Search/Pagination do not get confirmation.
64. Ordinary non-financial master edits do not get confirmation.
65. Customer deletion requires confirmation.
66. Supplier deletion requires confirmation.
67. Product deletion requires confirmation.
68. User deletion/reset password actions use shared confirmation.
69. Role deletion uses shared confirmation.
70. Sign-out uses shared confirmation.
71. Remove invoice logo uses shared confirmation.
72. Native browser `confirm()` is removed from protected workflows.
73. Existing accounting mutation functions remain unchanged unless required only to receive an existing reason parameter.
74. No new accounting writer exists in confirmation code.
75. Existing Customer accounting regressions remain green.
76. Existing Supplier accounting regressions remain green.
77. Existing Expense accounting regressions remain green.
78. Existing Bank regressions remain green.
79. Existing Sales/Purchase/Return regressions remain green.
80. Existing Vendor/Finance regressions remain green.
81. Existing Counter regressions remain green.
82. Existing sidebar/mobile regressions remain green.
83. HTML/Apps Script syntax checks remain green.
84. RPC target validation remains green.
85. No duplicate global functions are introduced.

---

## 20. Non-Goals

This feature is **not**:

- a manager approval workflow;
- a maker-checker system;
- a server-side transaction queue;
- an audit-signature system;
- an undo subsystem;
- a replacement for permissions;
- a replacement for server validation;
- a replacement for accounting corrections/reversals.

It is a consistent, contextual **last user-intent check before an existing important action executes**.

---

## 21. Delivery Strategy

Implementation should proceed in risk-controlled layers:

1. build/test the global `confirmAction(...)` component and keyboard/accessibility behavior;
2. wrap existing `confirmDelete(...)` for compatibility;
3. migrate Counter and direct money-entry workflows;
4. migrate Sales/Purchase/Returns/Cash Session;
5. migrate Expense/Bank/Finance/Vendor/Inventory;
6. migrate master/status/security browser `confirm(...)` uses;
7. run the complete accounting/UI regression and structural release gate;
8. package full ZIP and changed-files-only ZIP from a clean verified extraction.

Each migration must preserve the existing native mutation function and server permission checks.
