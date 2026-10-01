# Global Confirmation Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one reusable, responsive confirmation-dialog safety layer for every important SherERP action without changing any existing accounting, stock, ledger, locking, permission, audit, or Google Sheets mutation semantics.

**Architecture:** A single global confirmation container lives in `index.html` outside all SPA page sections. `javascript.html` exposes a Promise-based `confirmAction(options)` service plus compatibility helpers such as `confirmDelete(...)`; modules validate and freeze their existing native payload, ask for confirmation, then call exactly the same server function they already call today. The confirmation layer is client-side only and adds no server state or accounting writers.

**Tech Stack:** Google Apps Script HTML Service, vanilla JavaScript, HTML/CSS, Google Sheets backend, Node.js regression tests.

**Spec:** `docs/superpowers/specs/2026-09-05-global-confirmation-dialog-design.md`

## Global Constraints

- Runtime remains Google Apps Script and database remains Google Sheets.
- `confirmAction(...)` is a client-side safety layer only; no confirmation rows, tokens, pending sheets, approval workflow, or server-side confirmation state may be added.
- Existing native mutations remain authoritative. Do not create replacement functions for `receivePayment`, `paySupplier`, `addExpense`, `transferBetweenBankAccounts`, `completeSale`, `updateSale`, `createPurchase`, `updatePurchase`, `completeReturn`, finance, vendor, stock, delete/reversal, or status-change operations.
- Existing permissions, locks, validation, correction/reversal, audit, stock, Cash/Bank, Day Book, settlement-discount, and profit behavior must remain unchanged.
- Validate the form before opening confirmation. Invalid transactions must not show a confirmation dialog.
- Build and freeze the exact payload before confirmation. The same frozen values must drive both the summary and the eventual native mutation call.
- Only one confirmation dialog may be active at a time.
- Confirm receives initial focus. The keypress that opened the dialog must not also confirm it; a deliberate second Enter confirms.
- Desktop/tablet use a centered modal; mobile uses a bottom sheet through the same API.
- `Esc` cancels before submission; after native submission begins, Confirm/Cancel/Esc/backdrop cancellation are disabled until the RPC resolves.
- Required destructive reasons live inside the confirmation dialog when the existing action already requires a reason.
- Quick-add Customer/Supplier/Expense Category/Payee, View, Print, Search, Pagination, Navigation, reports, ordinary master creation, and ordinary non-financial edits remain confirmation-free.
- Dangerous actions use danger styling; financial actions use primary styling; material state changes use warning styling.
- Reuse the Counter Bangla amount-word behavior and preserve the existing output convention `হাজার / লাখ / কোটি / পয়সা`.
- Customer permanent deletion must preserve its existing server-required `Delete Confirmation Key`; the new shared confirmation replaces the browser `confirm()` but does not weaken or remove the key requirement.
- No task may alter a `.gs` mutation solely to support confirmation unless an existing reason parameter must already be passed through unchanged.

---

## File Structure

**Create**
- `tests/confirmation_dialog_core.test.js` — global modal API, focus, responsive structure, single-dialog, reason validation, payload-snapshot primitives.
- `tests/confirmation_financial_flows.test.js` — Customer/Supplier/Counter/Expense/Bank protected posting paths.
- `tests/confirmation_sales_purchase_returns.test.js` — POS sale/update, cash session, Purchase, Purchase Return/Sales Return coverage.
- `tests/confirmation_vendor_finance_inventory.test.js` — Finance, Vendor, stock/status operations.
- `tests/confirmation_system_actions.test.js` — Users, Roles, sign-out, invoice logo, master/status actions, browser-confirm migration.
- `tests/confirmation_acceptance.test.js` — spec-wide invariants, native-function preservation, syntax/RPC/no-writer guards.

**Modify**
- `index.html` — one global confirmation container outside all hidden SPA page sections; retire the standalone delete modal shell once compatibility is green.
- `javascript.html` — shared `confirmAction`, focus trap, opening-key guard, pending-state handling, Bangla amount words, `confirmDelete` compatibility wrapper, logout and common confirmation helpers.
- `style.html` — financial/danger/state-change styles, desktop centered modal, mobile bottom sheet, sticky mobile actions, focus/error/pending states.
- `counter.html` — four Counter posting commit points.
- `customers.html`, `customerLedger.html` — receive payment, payment edit/delete, customer permanent delete confirmation.
- `suppliers.html`, `supplierLedger.html` — supplier payment, payment edit/delete, supplier status/delete confirmation.
- `expense.html`, `expenseList.html`, `expenseCategory.html` — add/edit/delete expense and category status confirmations.
- `bank.html` — transfer, manual bank entry, reversal-reason, account status confirmations.
- `pos.html`, `sales.html` — cash session, complete/update Sale, Sale delete/native action coverage, POS vendor status if retained there.
- `purchase.html` — create/update Purchase, Purchase Return and delete coverage.
- `returns.html` — Sales Return confirmation.
- `finance.html`, `financeLedger.html` — add/update/delete Finance and finance-person state change.
- `vendors.html` — vendor payment, vendor receipt, product movement, status, delete and existing delete wrapper paths.
- `products.html` — stock adjustment, product status/delete, category/unit removal state changes.
- `users.html`, `roles.html`, `invoiceDesign.html` — security/system confirmations.

Do **not** add confirmation logic to server `.gs` files unless a test proves an existing reason argument cannot otherwise be passed unchanged.

---

### Task 1: Build the Global Confirmation Primitive

**Files:**
- Create: `tests/confirmation_dialog_core.test.js`
- Modify: `index.html:190-216`
- Modify: `javascript.html:940-980, 1518-1555, 2200-2245`
- Modify: `style.html` confirmation/modal sections

**Interfaces:**
- Consumes: existing `openModal`, `closeModal`, `escapeHtml`, `formatMoney`, Counter amount-word behavior.
- Produces:
  - `confirmAction(options) -> Promise<{confirmed:boolean, reason:string}>`
  - `runConfirmedAction(options, runner) -> Promise<any|null>` — mutation wrapper that keeps the dialog in pending state while `runner(reason)` is unresolved
  - `banglaAmountInWords_(value) -> string`
  - one global DOM container `#confirmActionModal`
  - `closeConfirmAction_(result)` internal resolver
  - `setConfirmActionPending_(pending, label)` internal pending-state helper

- [ ] **Step 1: Write the failing core test**

Create `tests/confirmation_dialog_core.test.js` that asserts the production files contain one global dialog outside `#app`, and evaluates the extracted shared JavaScript to prove the API contract. The test must cover these concrete behaviors:

```js
assert.match(indexHtml, /id="confirmActionModal"/);
assert.match(indexHtml, /role="dialog"/);
assert.match(indexHtml, /aria-modal="true"/);
assert.match(js, /function confirmAction\(options\)/);
assert.match(js, /function banglaAmountInWords_\(value\)/);
assert.equal(ctx.banglaAmountInWords_('23,000.50'), 'তেইশ হাজার টাকা পঞ্চাশ পয়সা মাত্র');
assert.equal(ctx.banglaAmountInWords_('1,25,00,000'), 'এক কোটি পঁচিশ লাখ টাকা মাত্র');
```

Use a small fake DOM to verify:
- opening a second dialog while one is active does not stack;
- blank required reason cannot resolve as confirmed;
- cancel resolves `{confirmed:false, reason:''}`;
- the confirmation detail rows are escaped rather than injected as raw HTML.

- [ ] **Step 2: Run the core test and verify RED**

Run:

```bash
node tests/confirmation_dialog_core.test.js
```

Expected: FAIL because `#confirmActionModal`, `confirmAction`, and `banglaAmountInWords_` do not exist yet.

- [ ] **Step 3: Add the one global dialog shell**

Replace the specialized `#deleteModal` markup in `index.html` with one global shell outside `#app`, preserving a single modal host:

```html
<div class="confirm-action-overlay" id="confirmActionModal" hidden>
  <section class="confirm-action-dialog" role="dialog" aria-modal="true" aria-labelledby="confirmActionTitle">
    <div class="confirm-action-header">
      <h3 id="confirmActionTitle"></h3>
      <button type="button" class="modal-close" id="confirmActionClose" aria-label="Cancel">&#10005;</button>
    </div>
    <div class="confirm-action-body">
      <p id="confirmActionMessage"></p>
      <div id="confirmActionDetails"></div>
      <label class="field" id="confirmActionReasonRow" hidden>
        <span id="confirmActionReasonLabel">Reason</span>
        <textarea id="confirmActionReason"></textarea>
        <span class="field-error" id="confirmActionReasonError"></span>
      </label>
    </div>
    <div class="confirm-action-footer">
      <button type="button" class="btn" id="confirmActionCancel">Cancel</button>
      <button type="button" class="btn btn-primary" id="confirmActionConfirm">Confirm</button>
    </div>
  </section>
</div>
```

Do not add any module-specific fields to this shell.

- [ ] **Step 4: Implement the Promise-based service**

In `javascript.html`, implement one state object and one resolver. Normalize options to this shape:

```js
{
  type: 'financial',
  title: '',
  message: '',
  details: [],
  confirmLabel: 'Confirm',
  cancelLabel: 'Cancel',
  reason: { required: false, label: 'Reason', placeholder: '', maxLength: 200 },
  trigger: null,
  openingEvent: null
}
```

The implementation must:
- reject/return the already-active Promise rather than render a second dialog;
- render detail rows from `{label,value,emphasis}` using `textContent`/escaping;
- set variant classes `is-financial`, `is-danger`, `is-state-change`;
- focus Confirm after open;
- consume the originating Enter event by recording its `timeStamp`/event-cycle token so the same key event cannot activate Confirm;
- trap Tab/Shift+Tab inside the dialog;
- let `Esc` cancel only while not pending;
- block backdrop cancellation while pending;
- restore focus to the trigger on cancel when still connected;
- validate and trim required reason before resolving confirmed;
- resolve exactly once.

Also implement `runConfirmedAction(options, runner)`. It must open the same dialog, enter the `PENDING` phase after deliberate confirmation, disable Confirm/Cancel/Close/Esc/backdrop, swap Confirm text to `loadingLabel`, await `runner(reason)`, then close and resolve on success. On runner failure it must close, restore the trigger/form interaction, and rethrow the native error without synthesizing success. This wrapper is the standard mutation entry point; `confirmAction` remains available for pure yes/no decisions.

- [ ] **Step 5: Centralize Bangla amount words without breaking Counter**

Move the decimal-capable Counter converter into `javascript.html` as `banglaAmountInWords_(value)`. In `counter.html`, keep a temporary compatibility wrapper so existing Counter tests and callers remain valid during migration:

```js
function counterAmountInBangla_(value) {
  return banglaAmountInWords_(value);
}
```

Preserve exact outputs already asserted by `tests/counter_ui_primitives.test.js`.

- [ ] **Step 6: Add responsive/variant CSS**

Add styles that prove these contracts:
- desktop/tablet: centered `.confirm-action-dialog`;
- mobile breakpoint: `.confirm-action-overlay` aligns to bottom and dialog becomes a bottom sheet with rounded top corners;
- `.is-danger` Confirm uses existing danger tokens;
- `.is-state-change` uses warning treatment;
- mobile footer is sticky;
- disabled/pending controls are visually non-interactive;
- visible `:focus-visible` ring remains.

- [ ] **Step 7: Run core + existing Counter primitive tests**

Run:

```bash
node tests/confirmation_dialog_core.test.js
node tests/counter_ui_primitives.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add index.html javascript.html style.html counter.html tests/confirmation_dialog_core.test.js
git commit -m "feat: add shared confirmation dialog primitive"
```

---

### Task 2: Convert `confirmDelete(...)` into a Compatibility Wrapper

**Files:**
- Modify: `javascript.html:2200-2245`
- Modify: `customerLedger.html`, `customers.html`, `supplierLedger.html`, `suppliers.html`, `daybook.html`, `expenseList.html`, `financeLedger.html`, `products.html`, `purchase.html`, `sales.html`, `vendors.html`
- Test: `tests/confirmation_dialog_core.test.js`
- Create: `tests/confirmation_system_actions.test.js`

**Interfaces:**
- Consumes: `confirmAction(options)` from Task 1; existing `confirmDelete({title,summary,fn,args,reloadPages,onDone})` callers.
- Produces: same legacy `confirmDelete(opts)` call signature, now delegating to `confirmAction({type:'danger', reason:{required:true,...}})`.

- [ ] **Step 1: Extend the failing tests for compatibility**

Add assertions that:

```js
assert.match(js, /function confirmDelete\(opts\)/);
assert.match(js, /confirmAction\(/);
assert.doesNotMatch(indexHtml, /id="deleteModal"/);
assert.doesNotMatch(js, /function submitDelete\(/);
```

Add a fake `serverCall` test proving a confirmed legacy delete receives its existing arguments plus the trimmed reason exactly once.

- [ ] **Step 2: Run and verify RED**

```bash
node tests/confirmation_dialog_core.test.js
```

Expected: FAIL because `confirmDelete` still drives `#deleteModal` / `submitDelete()`.

- [ ] **Step 3: Reimplement `confirmDelete` as a wrapper**

Convert the existing API to:

```js
function confirmDelete(opts) {
  var o = opts || {};
  var summaryText = legacyDeleteSummaryText_(o.summary || '');
  return runConfirmedAction({
    type: 'danger',
    title: o.title || 'Delete record?',
    message: summaryText || 'This will reverse or remove the related record effects.',
    details: o.details || [],
    confirmLabel: o.confirmLabel || 'Delete',
    loadingLabel: o.loadingLabel || 'Deleting...',
    reason: { required: true, label: 'Reason', placeholder: 'e.g. entered twice by mistake', maxLength: 200 },
    trigger: o.trigger || document.activeElement
  }, function (reason) {
    var args = [o.fn, authToken].concat(o.args || [], [reason]);
    return withLoader(serverCall.apply(null, args)).then(function (res) {
      showToast(o.successMessage || 'Deleted. Stock and balances have been reversed.', 'success');
      (o.reloadPages || [currentPage]).forEach(reloadPage_);
      if (typeof o.onDone === 'function') o.onDone(res);
      return res;
    });
  });
}
```

Define `legacyDeleteSummaryText_(html)` in this task as a conservative compatibility helper: create a detached DOM element, assign the already-generated trusted legacy summary HTML, read only `textContent`, normalize whitespace, and return plain text. Do not return or execute HTML. Prefer extending callers over Tasks 2-9 to pass structured `details` explicitly.

- [ ] **Step 4: Remove obsolete delete-modal state**

Delete `deleteCtx_`, `submitDelete()`, `delTitle`, `delSummary`, `delReason`, and delete-only modal CSS after compatibility tests are green.

- [ ] **Step 5: Run all existing delete/accounting regressions**

```bash
node tests/pre_correction_native_actions.test.js
node tests/deep_review_regressions.test.js
node tests/opening_balance_actions.test.js
node tests/vendor_workspace_actions_expense_test.js
node tests/party_ledger_ui.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add index.html javascript.html style.html customers.html customerLedger.html suppliers.html supplierLedger.html daybook.html expenseList.html financeLedger.html products.html purchase.html sales.html vendors.html tests/confirmation_dialog_core.test.js tests/confirmation_system_actions.test.js
git commit -m "refactor: route delete confirmations through shared dialog"
```

---

### Task 3: Protect Counter and Customer/Supplier Money Flows

**Files:**
- Modify: `counter.html:430-780`
- Modify: `customers.html:350-465`
- Modify: `customerLedger.html:390-490`
- Modify: `suppliers.html:270-465`
- Modify: `supplierLedger.html:390-490`
- Create: `tests/confirmation_financial_flows.test.js`

**Interfaces:**
- Consumes: `confirmAction`, `runConfirmedAction`, `banglaAmountInWords_`, existing native RPCs `receivePayment`, `paySupplier`, `updateCustomerPayment`, `updateSupplierPayment`, `confirmDelete`.
- Produces: frozen-payload confirmation at each Customer/Supplier payment commit point; no new server calls.

- [ ] **Step 1: Write failing payment confirmation tests**

The test must statically and, where practical, VM-execute the submit handlers to prove:
- Counter Customer Receive calls `confirmAction` before `serverCall('receivePayment', ...)`;
- Counter Supplier Pay calls `confirmAction` before `serverCall('paySupplier', ...)`;
- Customer page and Customer Ledger Receive do the same;
- Supplier page and Supplier Ledger Pay do the same;
- update payment flows ask for confirmation before existing update RPCs;
- confirmation details show party name, actual payment amount, Bangla words, discount, total settlement, method, and selected account when applicable;
- Bangla words are calculated from payment amount only, never amount + discount;
- client validation happens before `confirmAction`;
- cancelled confirmation causes zero RPC calls.

- [ ] **Step 2: Run and verify RED**

```bash
node tests/confirmation_financial_flows.test.js
```

Expected: FAIL because current handlers call RPCs directly.

- [ ] **Step 3: Add one helper for settlement confirmation details**

In `javascript.html`, add a pure helper such as:

```js
function settlementConfirmDetails_(o) {
  return [
    { label: o.partyLabel, value: o.partyName, emphasis: true },
    { label: o.directionLabel, value: formatMoney(o.amount), emphasis: true },
    { label: 'In words', value: banglaAmountInWords_(o.amount) },
    { label: o.discountLabel, value: formatMoney(o.discount || 0) },
    { label: 'Total Settlement', value: formatMoney(Number(o.amount || 0) + Number(o.discount || 0)) },
    { label: 'Method', value: o.method },
    { label: 'Account', value: o.accountName || '' }
  ].filter(function (row) { return row.value !== ''; });
}
```

This helper formats display only; it must not calculate or mutate accounting state.

- [ ] **Step 4: Wrap Counter Customer/Supplier commits**

At each Counter submit handler:
1. keep existing validation;
2. create the exact array/arguments currently sent to the native RPC;
3. create a frozen display snapshot from those values;
4. call `runConfirmedAction(options, function () { return serverCall(...); })`;
5. let the wrapper keep the confirmation in pending state until the existing native Promise resolves;
6. preserve the current Counter success reset/focus behavior exactly.

Use labels `Receive ৳X` and `Pay ৳X`.

- [ ] **Step 5: Wrap native Customer/Supplier page and ledger flows**

Apply the same pattern without changing existing form reset, settlement-discount validation, backdate reason behavior, ledger reload, or error handling.

- [ ] **Step 6: Keep payment delete paths on `confirmDelete`**

Do not create new delete code. Ensure the details passed into the danger dialog include party/reference/amount when those values are already available client-side.

- [ ] **Step 7: Run payment + settlement regressions**

```bash
node tests/confirmation_financial_flows.test.js
node tests/counter_customer_receive.test.js
node tests/counter_supplier_pay.test.js
node tests/settlement_discount.test.js
node tests/party_ledger_ui.test.js
node tests/party_ledger_workspace.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add javascript.html counter.html customers.html customerLedger.html suppliers.html supplierLedger.html tests/confirmation_financial_flows.test.js
git commit -m "feat: confirm customer and supplier money movements"
```

---

### Task 4: Protect Expense and Bank Money Flows

**Files:**
- Modify: `expense.html:150-205`
- Modify: `expenseList.html:250-305`
- Modify: `bank.html:275-540`
- Modify: `counter.html:620-780`
- Test: `tests/confirmation_financial_flows.test.js`

**Interfaces:**
- Consumes: `confirmAction`, `runConfirmedAction`, `banglaAmountInWords_`; native `addExpense`, `updateExpense`, `transferBetweenBankAccounts`, `addBankManualEntry`, `reverseBankEntry`, `setBankAccountStatus`.
- Produces: financial/danger/state-change confirmation around the existing Expense and Bank RPCs.

- [ ] **Step 1: Extend tests and verify RED**

Add cases proving:
- native Expense add and Counter Expense confirm Category, Payee, amount, words, method/account;
- Expense edit confirms before `updateExpense`;
- native and Counter Bank Transfer show From, To, amount, words;
- manual Bank Entry shows account, type/direction, amount, reference/note;
- Bank reversal uses a required reason inside the shared danger dialog instead of browser `prompt()`;
- Bank account Activate/Deactivate uses state-change dialog rather than browser `confirm()`.

Run:

```bash
node tests/confirmation_financial_flows.test.js
```

Expected: FAIL on the new coverage.

- [ ] **Step 2: Wrap Expense add/edit**

Freeze the exact existing Expense payload. Confirm before the native RPC; do not change Payee/category/date/payment validation or success behavior.

- [ ] **Step 3: Wrap Bank Transfer and manual entry**

Use the existing transfer/manual-entry payloads unchanged. Resolve account display names from the already-loaded bank-account bootstrap data; never perform an extra write or extra confirmation RPC.

- [ ] **Step 4: Replace Bank reversal `prompt()`**

Use:

```js
confirmAction({
  type: 'danger',
  title: 'Reverse Bank Entry?',
  details: [{ label: 'Entry', value: id }],
  confirmLabel: 'Reverse Entry',
  reason: { required: true, label: 'Reason', maxLength: 200 }
})
```

Pass `result.reason` unchanged to the existing `reverseBankEntry(authToken, id, reason)` RPC.

- [ ] **Step 5: Wrap Bank status changes**

Use `type:'state-change'`; display account name and next state. Keep `setBankAccountStatus` unchanged.

- [ ] **Step 6: Run regressions**

```bash
node tests/confirmation_financial_flows.test.js
node tests/counter_expense_transfer.test.js
node tests/deep_review_regressions.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add expense.html expenseList.html bank.html counter.html tests/confirmation_financial_flows.test.js
git commit -m "feat: confirm expense and bank transactions"
```

---

### Task 5: Protect POS Sales, Sale Updates, and Cash Sessions

**Files:**
- Modify: `pos.html:250-315, 1010-1090`
- Modify: `sales.html:410-530`
- Create: `tests/confirmation_sales_purchase_returns.test.js`

**Interfaces:**
- Consumes: `runConfirmedAction`, existing POS validation/`posDeriveSaleTerms_`, `completeSale`, `updateSale`, `startCashSession`, `closeCashSession`, existing update-reason flow, `confirmDelete`.
- Produces: financial confirmation for session open/close and sale commit/update; danger delete remains compatibility wrapper.

- [ ] **Step 1: Write failing POS tests**

Prove:
- Start Cash Session confirms opening cash + Bangla words + note when present;
- Close Cash Session confirms expected cash, counted cash, difference, and note from the already-loaded session state;
- Sale confirm shows customer, grand total, paid now, due, item count, method/account;
- update Sale confirm identifies it as an update and includes the existing `posState.updateReason` in the summary;
- the exact `payload` object built before confirmation is the object sent to `completeSale`/`updateSale` after confirmation;
- cancel produces no sale RPC.

- [ ] **Step 2: Run and verify RED**

```bash
node tests/confirmation_sales_purchase_returns.test.js
```

Expected: FAIL.

- [ ] **Step 3: Wrap Cash Session start/close**

Do not change `startCashSession` or `closeCashSession` arguments. Build a snapshot first, confirm, then issue the same RPC. The close confirmation must visually emphasize a non-zero difference.

- [ ] **Step 4: Wrap Sale create/update commit**

Keep all current validation before confirmation. Freeze `payload`, `isUpdate`, totals, and item count. After confirm, select the same native call:

```js
var call = isUpdate
  ? serverCall('updateSale', authToken, posState.updateInvoiceId, payload)
  : serverCall('completeSale', authToken, payload);
```

Do not rebuild `payload` after confirmation.

- [ ] **Step 5: Preserve Sales-history actions**

`View`, `Print`, and `Duplicate` remain unconfirmed. Destructive Sale actions continue through `confirmDelete`. Opening update mode may keep its existing reason prompt because that reason is part of the edit-mode authorization; the final update confirmation must display the frozen reason and must not ask for it twice.

- [ ] **Step 6: Run regressions**

```bash
node tests/confirmation_sales_purchase_returns.test.js
node tests/compact_pos_mockup.test.js
node tests/mockup_module_design.test.js
node tests/pre_correction_native_actions.test.js
node tests/settlement_discount.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add pos.html sales.html tests/confirmation_sales_purchase_returns.test.js
git commit -m "feat: confirm sales and cash-session commits"
```

---

### Task 6: Protect Purchase and Return Posting

**Files:**
- Modify: `purchase.html:1020-1110` and Purchase Return submit block
- Modify: `returns.html:180-245`
- Modify: `returnHistory.html` only if a destructive action exists there
- Test: `tests/confirmation_sales_purchase_returns.test.js`

**Interfaces:**
- Consumes: `runConfirmedAction`; native `createPurchase`, `updatePurchase`, `completePurchaseReturn`, `completeReturn`, existing Purchase delete wrapper.
- Produces: financial/stock confirmation before create/update/return mutations.

- [ ] **Step 1: Extend return/purchase tests and verify RED**

Add cases proving:
- Purchase confirmation shows Supplier, total, discount, paid amount, due, landed/extra cost when present, item count, method/account;
- Purchase update shows before/update identity and existing update reason;
- Sales Return confirmation shows invoice/customer, return amount, item count and stock/accounting warning;
- Purchase Return confirmation shows supplier/purchase reference, return amount/item count and payable/stock warning;
- View/search/print remain unconfirmed.

Run:

```bash
node tests/confirmation_sales_purchase_returns.test.js
```

Expected: FAIL on the new cases.

- [ ] **Step 2: Wrap Purchase create/update**

Preserve `purDate`, backdate-reason validation, `payload`, `purState.updateReason`, and current success reset. Freeze before dialog and call the same existing RPC after confirm.

- [ ] **Step 3: Wrap Sales Return**

In `returns.html`, keep all quantity/eligibility validation before confirmation. Freeze the existing `payload`, compute display-only returned amount/item count from that frozen payload/invoice data, then call `completeReturn` unchanged.

- [ ] **Step 4: Wrap Purchase Return**

Wrap the existing `prtCompleteBtn` handler in `purchase.html`, preserving its current validation and exact `completePurchaseReturn(authToken, payload)` RPC. Freeze `payload` before the dialog, summarize `prtState.purchase.purchaseId`, supplier, selected items/quantities and the existing computed return total, then call `completePurchaseReturn` unchanged after confirmation.

- [ ] **Step 5: Run regressions**

```bash
node tests/confirmation_sales_purchase_returns.test.js
node tests/deep_review_regressions.test.js
node tests/lot_selling_price.test.js
node tests/mobile_customer_return_regressions.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add purchase.html returns.html returnHistory.html tests/confirmation_sales_purchase_returns.test.js
git commit -m "feat: confirm purchase and return postings"
```

---

### Task 7: Protect Finance and Vendor Money/Stock Operations

**Files:**
- Modify: `finance.html:225-280`
- Modify: `financeLedger.html:260-330`
- Modify: `vendors.html:300-860`
- Create: `tests/confirmation_vendor_finance_inventory.test.js`

**Interfaces:**
- Consumes: `runConfirmedAction`; native `addFinanceTransaction`, `updateFinanceTransaction`, delete compatibility, `setFinancePersonStatus`, `payVendor`, `receiveVendorPayment`, `returnProductsToVendor`, `giveProductsToVendor`, `receiveProductsFromVendor`, `setVendorStatus`, vendor delete/update paths.
- Produces: financial/danger/state-change confirmations with exact frozen native payloads.

- [ ] **Step 1: Write failing Finance/Vendor tests**

Assert:
- Finance add/update shows person, transaction type, amount, method/account;
- Finance Person status change uses state-change dialog;
- Vendor Pay and Vendor Receive show vendor, amount, words, method/account;
- Vendor product movements show vendor, product names/quantities and explicit inventory consequence;
- Vendor status uses state-change dialog;
- Vendor destructive actions continue through danger confirmation with required reasons where the backend already requires them.

- [ ] **Step 2: Run and verify RED**

```bash
node tests/confirmation_vendor_finance_inventory.test.js
```

Expected: FAIL.

- [ ] **Step 3: Wrap Finance add/update/status**

Do not confirm Finance Person ordinary creation/edit. Do confirm transaction posting/update and person status. Keep all RPC names and payloads unchanged.

- [ ] **Step 4: Wrap Vendor money movement**

Apply frozen snapshots to `payVendor` and `receiveVendorPayment`. Reuse `banglaAmountInWords_` for actual money movement.

- [ ] **Step 5: Wrap Vendor stock movement**

For `returnProductsToVendor`, `giveProductsToVendor`, and `receiveProductsFromVendor`, summarize product/qty from the frozen payload. No new stock calculation is allowed in the confirmation layer beyond display aggregation.

- [ ] **Step 6: Wrap Vendor status and deletes**

Replace browser `confirm()` for `setVendorStatus`; keep vendor delete/reversal mutation on `confirmDelete`.

- [ ] **Step 7: Run regressions**

```bash
node tests/confirmation_vendor_finance_inventory.test.js
node tests/vendor_workspace_actions_expense_test.js
node tests/deep_review_regressions.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add finance.html financeLedger.html vendors.html tests/confirmation_vendor_finance_inventory.test.js
git commit -m "feat: confirm finance and vendor mutations"
```

---

### Task 8: Protect Inventory and Material State Changes

**Files:**
- Modify: `products.html:450-550`
- Modify: `expenseCategory.html:85-110`
- Modify: `suppliers.html:240-265`
- Modify: `bank.html:275-295`
- Modify: `roles.html:160-185`
- Modify: `users.html:150-180`
- Modify: `finance.html:230-250`
- Modify: `vendors.html:315-335`
- Test: `tests/confirmation_vendor_finance_inventory.test.js`
- Test: `tests/confirmation_system_actions.test.js`

**Interfaces:**
- Consumes: `confirmAction`, `runConfirmedAction`; native status functions and `adjustStock`; existing delete functions/wrappers.
- Produces: stock-adjustment financial/stock confirmation and state-change confirmation for material status changes.

- [ ] **Step 1: Extend tests and verify RED**

Require:
- Stock adjustment summary shows Product, current stock, adjustment, resulting stock, and existing note/reason;
- product status, Supplier status, Bank Account status, Expense Category status, Role status, User status, Finance Person status, Vendor status use `type:'state-change'`;
- Category/Unit removal in Products replaces browser `confirm()` with warning/state-change confirmation;
- ordinary Product edit and ordinary master create/edit remain direct.

- [ ] **Step 2: Wrap stock adjustment**

Use the already-loaded product row to calculate display-only `current + delta` while keeping `adjustStock(authToken, productId, delta, note)` unchanged.

- [ ] **Step 3: Replace material status browser confirms**

For each status toggle, build `{name,current,next}` snapshot, confirm, then call the existing `set...Status` RPC unchanged.

- [ ] **Step 4: Replace Product category/unit removal confirm**

Use warning/state-change variant and preserve the existing message that products already using the value retain it while it is removed from new selections.

- [ ] **Step 5: Run regressions**

```bash
node tests/confirmation_vendor_finance_inventory.test.js
node tests/confirmation_system_actions.test.js
node tests/lot_selling_price.test.js
node tests/opening_balance_actions.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add products.html expenseCategory.html suppliers.html bank.html roles.html users.html finance.html vendors.html tests/confirmation_vendor_finance_inventory.test.js tests/confirmation_system_actions.test.js
git commit -m "feat: confirm stock and material state changes"
```

---

### Task 9: Protect Security/System Actions and Remove Browser `confirm()` from Protected Workflows

**Files:**
- Modify: `javascript.html:370-395`
- Modify: `users.html:150-215`
- Modify: `roles.html:160-185`
- Modify: `invoiceDesign.html:255-275`
- Modify: `customers.html:225-240`
- Test: `tests/confirmation_system_actions.test.js`

**Interfaces:**
- Consumes: shared dialog and `runConfirmedAction`; native `doLogout_`, `resetPassword`, `deleteUser`, `deleteRole`, `removeInvoiceLogo`, `deleteCustomer`.
- Produces: shared confirmations for sign-out, password reset final commit, user/role deletion, invoice logo removal, customer permanent deletion while preserving its existing Delete Confirmation Key.

- [ ] **Step 1: Extend system tests and verify RED**

Assert:
- no protected workflow contains native `confirm(` after migration;
- Sign out uses shared state-change confirmation;
- Reset Password asks for final confirmation after password validation and before `resetPassword` RPC;
- User/Role permanent deletion uses danger dialog;
- Remove invoice logo uses danger/state-change dialog;
- Customer permanent deletion uses danger dialog and still calls `deleteCustomer(authToken, id, key)` with the existing separately collected key.

Run:

```bash
node tests/confirmation_system_actions.test.js
```

Expected: FAIL.

- [ ] **Step 2: Replace logout browser confirm**

Use:

```js
confirmAction({
  type: 'state-change',
  title: 'Sign out?',
  message: 'Your current SherERP session will end.',
  confirmLabel: 'Sign out',
  trigger: document.getElementById('logoutBtn')
}).then(function (r) { if (r.confirmed) doLogout_(); });
```

- [ ] **Step 3: Add final confirmation to password reset**

Keep password validation in `usrResetModal`. On valid password, freeze `userId`, user name, and new password reference; confirm the security action, then call the same `resetPassword` RPC. Never display the password in confirmation details.

- [ ] **Step 4: Replace User/Role/Logo browser confirms**

Use danger for permanent deletion/logo removal and state-change for status actions. Do not add typed `DELETE` requirements.

- [ ] **Step 5: Migrate Customer permanent delete without weakening its key guard**

Replace the browser `confirm()` with shared danger confirmation. After confirmed, request the existing Delete Confirmation Key using the current key-entry mechanism, then call `deleteCustomer` with the same arguments. Do not remove or bypass the server key check in `Customer.gs`.

- [ ] **Step 6: Scan remaining native confirms**

Run:

```bash
grep -RIn --include='*.html' --include='javascript.html' -E '\bconfirm\s*\(' .
```

Every remaining occurrence must be manually classified. Protected workflows must have zero native `confirm()` calls. Any intentionally unprotected browser confirm must be removed anyway if the same action is covered by the spec.

- [ ] **Step 7: Run system regressions**

```bash
node tests/confirmation_system_actions.test.js
node tests/mobile_pwa_ui.test.js
node tests/sidebar_grouped_collapse.test.js
node tests/deep_review_regressions.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add javascript.html users.html roles.html invoiceDesign.html customers.html tests/confirmation_system_actions.test.js
git commit -m "feat: confirm security and system actions"
```

---

### Task 10: Async Safety, Focus, and Mobile Acceptance

**Files:**
- Modify: `javascript.html`
- Modify: `style.html`
- Create: `tests/confirmation_acceptance.test.js`

**Interfaces:**
- Consumes: all confirmation wrappers from Tasks 1-9.
- Produces: proven focus trap, second-Enter requirement, duplicate-submit block, pending-state lock, failure/cancel semantics, responsive bottom sheet.

- [ ] **Step 1: Write failing acceptance tests for interaction safety**

Use a fake DOM/event harness to prove:
- Confirm gets initial focus;
- the same Enter event used to open the dialog cannot resolve it;
- a later Enter resolves confirmed exactly once;
- repeated click/Enter while pending does not invoke native action twice;
- Cancel/Esc/backdrop are blocked while pending;
- Esc before pending resolves cancel;
- focus returns to trigger after cancel;
- a required reason of spaces only does not confirm;
- server failure cannot produce a success resolution or clear the source form;
- mobile CSS contains bottom-sheet layout and sticky actions.

- [ ] **Step 2: Run and verify RED if any safety behavior is incomplete**

```bash
node tests/confirmation_acceptance.test.js
```

Expected: any missing safety behavior fails specifically.

- [ ] **Step 3: Harden `confirmAction` event/pending state**

Keep one state machine with explicit phases:

```text
CLOSED -> OPEN -> PENDING -> CLOSED
            \-> CANCELLED -> CLOSED
```

No phase may resolve the Promise more than once. `runConfirmedAction` must hold `PENDING` until its runner resolves/rejects; no module may bypass that wrapper for a protected asynchronous mutation. Do not use arbitrary multi-second delays for double-Enter protection.

- [ ] **Step 4: Verify responsive/accessibility contract**

Ensure:
- role/aria title binding;
- focus trap cycles Confirm/Cancel/reason/close controls;
- mobile breakpoint renders bottom sheet;
- danger/financial/state-change variants remain distinguishable without relying only on color.

- [ ] **Step 5: Run core + acceptance suites**

```bash
node tests/confirmation_dialog_core.test.js
node tests/confirmation_acceptance.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add javascript.html style.html tests/confirmation_acceptance.test.js
git commit -m "test: harden confirmation interaction safety"
```

---

### Task 11: Spec Coverage Audit and Full Regression Gate

**Files:**
- Modify tests only if an approved requirement lacks executable coverage.
- Test: all `tests/*.test.js`

**Interfaces:**
- Consumes: complete implementation.
- Produces: evidence for every approved requirement and no existing regression.

- [ ] **Step 1: Map all 85 spec checks to executable tests**

Create a table inside `tests/confirmation_acceptance.test.js` comments or a separate test data structure that maps check numbers 1-85 to a test name/file. No check may be represented only by prose.

- [ ] **Step 2: Run every test file**

Run:

```bash
set -e
for f in tests/*.test.js; do
  echo "=== $f ==="
  node "$f"
done
```

Expected: all test files exit 0.

- [ ] **Step 3: Run Apps Script syntax checks**

For every `.gs` file, copy its source into a temporary `.js` file and run Node syntax check:

```bash
set -e
for f in *.gs; do
  cp "$f" /tmp/shererp_check.js
  node --check /tmp/shererp_check.js >/dev/null
done
```

Expected: every `.gs` file parses.

- [ ] **Step 4: Run HTML script-block syntax checks**

Extract each inline `<script>` block from every `.html` partial and parse it with Node after stripping Apps Script template directives. Expected: every block parses.

- [ ] **Step 5: Run RPC target audit**

Collect literal `serverCall('name', ...)` names from production HTML/JS and compare them against top-level functions in `.gs` files. Ignore known test/example strings; expected: zero missing production RPC targets.

- [ ] **Step 6: Run duplicate/global/conflict scans**

Verify:
- zero duplicate top-level server function names;
- zero merge conflict markers;
- zero newly introduced server-side confirmation writers;
- no protected native browser `confirm()` remains;
- no financial mutation function was copied into confirmation code.

- [ ] **Step 7: Diff-audit native mutations**

Use `git diff <baseline>...HEAD -- '*.gs'` and confirm no accounting/stock mutation semantics changed. If `.gs` changes exist, each must be justified by an existing reason-parameter pass-through requirement and covered by regression tests.

- [ ] **Step 8: Commit final test coverage**

```bash
git add tests
git commit -m "test: cover global confirmation acceptance matrix"
```

---

### Task 12: Package and Verify Release ZIPs

**Files:**
- Release artifact only; no production source change expected.

**Interfaces:**
- Consumes: green feature branch.
- Produces: full SherERP ZIP and changed-files-only ZIP relative to `SherERP-Counter-Quick-Add-FIX-FINAL-2026-09-04.zip`.

- [ ] **Step 1: Build the full ZIP from the exact verified tree**

Exclude `.git`, worktrees, temporary files, and test-run scratch artifacts. Keep project-relative paths intact.

- [ ] **Step 2: Build the changed-files-only ZIP by content hash**

Extract the exact baseline `SherERP-Counter-Quick-Add-FIX-FINAL-2026-09-04.zip`, compare hashes file-by-file, and include every created/modified production/test/spec/plan file with its full relative path.

- [ ] **Step 3: Verify ZIP integrity**

Run `unzip -t` on both archives. Expected: no errors.

- [ ] **Step 4: Fresh-extract the full ZIP**

Extract to a clean directory and rerun the entire Task 11 gate from that directory, not from the worktree.

- [ ] **Step 5: Report only evidence-backed results**

Record exact test counts, syntax counts, RPC count, duplicate/conflict count, and changed-file count from the fresh extraction. Do not reuse earlier counts.

---

## Plan Self-Review

### Spec coverage

- Global reusable confirmation service: Tasks 1, 10.
- Financial/danger/state-change variants: Tasks 1, 3-9.
- Contextual party/amount/method/account summaries: Tasks 3-7.
- Bangla amount words including poisha: Tasks 1, 3-7.
- Confirm-first focus and deliberate second Enter: Tasks 1, 10.
- Desktop centered modal / mobile bottom sheet: Tasks 1, 10.
- Reason inside danger dialog: Tasks 2, 4, 7.
- Exact payload freezing: Tasks 3-7, 10.
- Duplicate submission prevention: Task 10.
- `confirmDelete` compatibility: Task 2.
- Browser `confirm()` migration: Tasks 8-9, 11.
- Customer Delete Confirmation Key preservation: Task 9.
- No confirmation for routine actions: tests in Tasks 5-9 and acceptance Task 11.
- No server confirmation state/accounting writer: Global Constraints + Task 11.
- Full 85-check release gate: Task 11.
- Full and changed-only packaging with fresh-extraction retest: Task 12.

### Placeholder scan

The plan contains no TBD/TODO/fill-later steps. Every implementation task names exact existing files/functions and a concrete test command.

### Interface consistency

- Base shared API is consistently named `confirmAction(options)` and returns `{confirmed, reason}`; protected asynchronous mutations consistently use `runConfirmedAction(options, runner)` so pending-state requirements are actually enforceable.
- Shared money-word utility is consistently named `banglaAmountInWords_(value)`; `counterAmountInBangla_` remains a temporary compatibility wrapper.
- Existing delete entry point remains `confirmDelete(opts)` and becomes a compatibility wrapper rather than a second dialog system.
- All protected mutations continue to use their current native RPC names.
