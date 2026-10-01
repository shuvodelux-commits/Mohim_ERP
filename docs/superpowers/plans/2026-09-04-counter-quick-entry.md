# Counter Quick-Entry Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fast Counter workspace for Customer Receive, Supplier Pay, Expense, and Bank Transfer while keeping every financial mutation on the ERP's existing authoritative module functions.

**Architecture:** `Counter.gs` is a permission-aware read-only aggregator that returns only lightweight data needed by the Counter UI. `counter.html` owns selection, quick-entry state, conditional fields, Bangla amount-in-words, duplicate-submit prevention, and reset/focus behavior, while posting calls continue to use `receivePayment`, `paySupplier`, `addExpense`, and `transferBetweenBankAccounts`. Native Customer/Supplier add modals gain only a callback-capable opener so Counter can reuse them and auto-select the newly created party.

**Tech Stack:** Google Apps Script V8, Google Sheets data helpers, vanilla HTML/CSS/JavaScript single-page UI, Node.js regression scripts.

**Spec:** `docs/superpowers/specs/2026-09-04-counter-quick-entry-design.md`

## Global Constraints

- Google Apps Script is the application runtime and Google Sheets is the database.
- Counter is a UI entry layer only. No Counter function may post financial/accounting mutations.
- Customer Receive must call `receivePayment(token, customerId, amount, method, bankAccountId, notes, date, backdatedReason, discountAmount, discountReason)`.
- Supplier Pay must call `paySupplier(token, supplierId, amount, method, bankAccountId, notes, date, backdatedReason, discountAmount, discountReason)`.
- Expense must call `addExpense(token, payload)` and preserve required category + payee fields.
- Bank Transfer must call `transferBetweenBankAccounts(token, {fromAccountId,toAccountId,amount,notes})` and must not invent a transfer date.
- Quick Add Customer/Supplier must continue through `addCustomerChecked` / `addSupplier` using the existing native modal UI.
- Counter must not be added to `PERMISSION_MODULES`; visibility is derived from `customers.edit`, `suppliers.edit`, `expense.add`, or `bank.add`.
- Counter appears directly under POS and preserves the current grouped/collapsible sidebar and mobile navigation behavior.
- Searchable party selectors search locally by name/phone; no RPC per keystroke.
- Successful posts reset only the active form, keep the active transaction type, and focus its first field. Failed posts preserve all entered values.
- Bangla amount-in-words is client-side, uses হাজার/লাখ/কোটি/পয়সা, and describes only the physical `Amount` field.

---

### Task 1: Counter navigation capability and page shell

**Files:**
- Modify: `UI.gs`
- Modify: `javascript.html`
- Modify: `index.html`
- Create: `counter.html`
- Test: `tests/counter_navigation.test.js`

**Interfaces:**
- Consumes: existing `userPermissions`, `allowedModules`, `filterNavByRole_`, `buildNav_`, `goToPage`.
- Produces: NAV item `{key:'counter', icon:'counter', sidebarGroup:0, sidebarOrder:25, actionPermAny:[...]}` and a real `page-counter` section.

- [ ] **Step 1: Write failing navigation test**

Create `tests/counter_navigation.test.js` that asserts:

```js
assert.match(ui, /key:\s*'counter'[\s\S]*sidebarGroup:\s*0[\s\S]*sidebarOrder:\s*25/);
assert.match(ui, /actionPermAny[\s\S]*customers[\s\S]*edit[\s\S]*suppliers[\s\S]*edit[\s\S]*expense[\s\S]*add[\s\S]*bank[\s\S]*add/);
assert.doesNotMatch(ui, /PERMISSION_MODULES[\s\S]*key:\s*'counter'/);
assert.match(index, /id="page-counter"[\s\S]*include\('counter'\)/);
assert.match(js, /function hasActionPermission_/);
assert.match(js, /item\.actionPermAny/);
```

Also assert POS order 20 < Counter 25 < Sales 30 and the existing sidebar divider renderer remains present.

- [ ] **Step 2: Run RED**

Run: `node tests/counter_navigation.test.js`

Expected: FAIL because Counter metadata/page/capability support do not exist.

- [ ] **Step 3: Implement minimal navigation support**

In `UI.gs`, add Counter under POS with `actionPermAny` metadata but do not add it to `PERMISSION_MODULES`.

In `javascript.html`, add:

```js
function hasActionPermission_(moduleKey, action) {
  if (allowedModules === null) return true;
  var p = userPermissions && userPermissions[moduleKey];
  return !!(p && p[action]);
}
```

Teach `navItemVisible_` and direct-route authorization to accept `item.actionPermAny.some(...)` before falling back to key/module visibility.

Add a Counter SVG to `ICONS` and include `counter.html` in `index.html`.

Create a minimal `counter.html` page root with four transaction selector buttons and no posting behavior yet.

- [ ] **Step 4: Run GREEN + existing sidebar regression**

Run:

```bash
node tests/counter_navigation.test.js
node tests/sidebar_grouped_collapse.test.js
```

Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add UI.gs javascript.html index.html counter.html tests/counter_navigation.test.js
git commit -m "feat: add capability-gated counter workspace shell"
```

---

### Task 2: Read-only Counter bootstrap and party refresh endpoints

**Files:**
- Create: `Counter.gs`
- Test: `tests/counter_bootstrap.test.js`

**Interfaces:**
- Consumes: `getSessionUser_`, `hasPermission_`, `getAllRows_`, `isDeleted_`, `getActiveBankAccountsForUI_`, `getExpensePayeesForUI_`, `EXPENSE_PAYMENT_METHODS`, `getSettingsMap_`, `formatDate_`, `ok_`, `fail_`.
- Produces:
  - `getCounterBootstrap(token)`
  - `getCounterCustomers(token)`
  - `getCounterSuppliers(token)`
  - private `counterCapabilities_(user)`, `counterCustomers_()`, `counterSuppliers_()`.

- [ ] **Step 1: Write failing read-model tests**

`tests/counter_bootstrap.test.js` must prove by source inspection/runtime stubs that:

```js
getCounterBootstrap(token)
```

returns capability keys `customerReceive/customerAdd/supplierPay/supplierAdd/expenseAdd/bankTransfer/settlementDiscount`; only loads datasets for permitted actions; filters deleted/inactive Customer/Supplier rows; maps Customers to `{id,name,phone,due}` and Suppliers to `{id,name,phone,payable}`; maps categories/payees/accounts into lightweight shapes; returns `businessDate` and `currencySymbol`; and `Counter.gs` contains no calls to `appendRow_`, `updateRowFields_`, `addCashBookEntry_`, `addBankBookEntry_`, `receivePayment`, `paySupplier`, `addExpense`, or `transferBetweenBankAccounts`.

- [ ] **Step 2: Run RED**

Run: `node tests/counter_bootstrap.test.js`

Expected: FAIL because `Counter.gs` is missing.

- [ ] **Step 3: Implement read-only bootstrap**

Use exact action permissions:

```js
const canCustomerReceive = hasPermission_(user, 'customers', 'edit');
const canSupplierPay = hasPermission_(user, 'suppliers', 'edit');
const canExpense = hasPermission_(user, 'expense', 'add');
const canBankTransfer = hasPermission_(user, 'bank', 'add');
```

Only read Customers/Suppliers/categories/payees/accounts when their matching capability is true. `settlementDiscount` is true only when the existing `settlementDiscount` edit permission is granted (Administrator included).

For `getCounterCustomers` require `customers.edit` or `customers.add`; for `getCounterSuppliers` require `suppliers.edit` or `suppliers.add`; these endpoints return only the lightweight index so quick-add refresh does not rerun the whole bootstrap.

- [ ] **Step 4: Run GREEN**

Run: `node tests/counter_bootstrap.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Counter.gs tests/counter_bootstrap.test.js
git commit -m "feat: add read-only counter bootstrap"
```

---

### Task 3: Bangla money wording and searchable-combobox primitives

**Files:**
- Modify: `counter.html`
- Test: `tests/counter_ui_primitives.test.js`

**Interfaces:**
- Produces:
  - `counterAmountInBangla_(value)` -> string
  - `counterCreateCombobox_(config)` -> controller `{setItems, selectById, clear, focus}`
  - `counterNormalizeSearch_(text)` -> normalized string

- [ ] **Step 1: Write failing utility tests**

Use a VM/DOM-light extraction harness and assert exact output for:

```text
125 -> একশ পঁচিশ টাকা মাত্র
12,500 -> বারো হাজার পাঁচশ টাকা মাত্র
1,25,000 -> এক লাখ পঁচিশ হাজার টাকা মাত্র
1,25,00,000 -> এক কোটি পঁচিশ লাখ টাকা মাত্র
23,000.50 -> তেইশ হাজার টাকা পঞ্চাশ পয়সা মাত্র
0 / blank / invalid -> ""
```

Assert decimal input is rounded/limited to two poisha digits and search matching can find `Rahim Enterprise` by `rah`, `enterprise`, and its phone substring. Assert result rendering caps at 20 items and keyboard handlers include ArrowUp/ArrowDown/Enter/Escape.

- [ ] **Step 2: Run RED**

Run: `node tests/counter_ui_primitives.test.js`

Expected: FAIL because utilities are absent.

- [ ] **Step 3: Implement utilities inside `counter.html`**

Keep Bangla wording deterministic and client-only. Use Indian/Bangladeshi place decomposition (crore, lakh, thousand, hundred, remainder) and a 0-99 Bangla word table. Do not derive numeric posting values from the wording.

Implement one reusable combobox controller used by Customer and Supplier, with a maximum of 20 rendered matches and no server call from `input` events.

- [ ] **Step 4: Run GREEN**

Run: `node tests/counter_ui_primitives.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add counter.html tests/counter_ui_primitives.test.js
git commit -m "feat: add counter search and Bangla amount helpers"
```

---

### Task 4: Reusable native Customer/Supplier quick-add openers

**Files:**
- Modify: `customers.html`
- Modify: `suppliers.html`
- Test: `tests/counter_quick_add_reuse.test.js`

**Interfaces:**
- Produces:
  - `custOpenAdd_(onSaved)` where `onSaved(newCustomerId)` fires only after native `addCustomerChecked` succeeds.
  - `supOpenAdd_(onSaved)` where `onSaved(newSupplierId)` fires only after native `addSupplier` succeeds.
- Existing Customer/Supplier page Add buttons call the same opener with no callback.

- [ ] **Step 1: Write failing reuse tests**

Assert the page Add buttons route through the reusable opener; save handlers still call `addCustomerChecked` / `addSupplier`; callback receives `res.id`; cancel does not invoke callback; edit saves do not invoke add callback; existing page load/reload behavior remains.

- [ ] **Step 2: Run RED**

Run: `node tests/counter_quick_add_reuse.test.js`

Expected: FAIL because callback-capable openers are absent.

- [ ] **Step 3: Refactor only opener/callback plumbing**

Add callback slots to `custState` and `supState`. Extract the current Add button initialization into `custOpenAdd_(onSaved)` / `supOpenAdd_(onSaved)`. In successful add saves, capture callback, clear it, perform current close/toast/reload behavior, then invoke callback with the returned ID. Leave all master validation and server functions unchanged.

- [ ] **Step 4: Run GREEN + native module regression tests**

Run:

```bash
node tests/counter_quick_add_reuse.test.js
node tests/pre_correction_native_actions.test.js
node tests/party_ledger_ui.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add customers.html suppliers.html tests/counter_quick_add_reuse.test.js
git commit -m "refactor: expose native party add modal hooks"
```

---

### Task 5: Customer Receive quick-entry flow

**Files:**
- Modify: `counter.html`
- Test: `tests/counter_customer_receive.test.js`

**Interfaces:**
- Consumes: bootstrap customers/accounts/capabilities, `custOpenAdd_`, `getCounterCustomers`, `receivePayment`, `paymentMethodNeedsAccount_`, `fillBankAccountSelect_`.
- Produces: Customer Receive form state/reset/post flow.

- [ ] **Step 1: Write failing Customer Receive tests**

Assert form includes searchable Customer + Add, Due, Amount + Bangla words, Discount, conditional Discount Reason, Payment Method, conditional account, More Details date/note/backdated reason, Total Settled/Balance After, and primary button showing physical Amount.

Assert posting call signature is exactly:

```js
serverCall('receivePayment', authToken, customerId, amount, method, bankId,
  note, date, backdatedReason, discountAmount, discountReason)
```

Assert in-flight guard prevents second call, success resets only this form and focuses Customer search, failure does not clear, quick-add callback refreshes only Customers and selects the returned ID, switching Bank -> Cash clears account, and amount words never include discount.

- [ ] **Step 2: Run RED**

Run: `node tests/counter_customer_receive.test.js`

Expected: FAIL.

- [ ] **Step 3: Implement Customer Receive**

Use native settlement UI semantics: physical `Amount`, settlement=`Amount+Discount`, and respect `capabilities.settlementDiscount`. Date defaults to bootstrap business date; past dates reveal Backdated Reason. Do not introduce any new posting endpoint.

- [ ] **Step 4: Run GREEN**

Run:

```bash
node tests/counter_customer_receive.test.js
node tests/settlement_discount.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add counter.html tests/counter_customer_receive.test.js
git commit -m "feat: add counter customer receipt flow"
```

---

### Task 6: Supplier Pay quick-entry flow

**Files:**
- Modify: `counter.html`
- Test: `tests/counter_supplier_pay.test.js`

**Interfaces:**
- Consumes: bootstrap suppliers/accounts/capabilities, `supOpenAdd_`, `getCounterSuppliers`, `paySupplier`.
- Produces: Supplier Pay form state/reset/post flow mirroring Customer Receive without duplicating accounting logic.

- [ ] **Step 1: Write failing Supplier Pay tests**

Assert Supplier search by name/phone, Payable display, Discount Received semantics, amount words on physical payment only, conditional fields, exact native `paySupplier(...)` signature, quick-add refresh/autoselect, in-flight guard, error preservation, success reset and focus.

- [ ] **Step 2: Run RED**

Run: `node tests/counter_supplier_pay.test.js`

Expected: FAIL.

- [ ] **Step 3: Implement Supplier Pay**

Reuse the same generic Counter form helpers where safe; keep supplier-specific labels/IDs and call only `paySupplier` for mutation.

- [ ] **Step 4: Run GREEN**

Run:

```bash
node tests/counter_supplier_pay.test.js
node tests/settlement_discount.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add counter.html tests/counter_supplier_pay.test.js
git commit -m "feat: add counter supplier payment flow"
```

---

### Task 7: Expense and Bank Transfer quick-entry flows

**Files:**
- Modify: `counter.html`
- Test: `tests/counter_expense_transfer.test.js`

**Interfaces:**
- Expense calls only `addExpense(token, payload)` with `{date,categoryId,payeeId,amount,paymentMethod,bankAccountId,description,referenceNo,notes,backdatedReason}`.
- Transfer calls only `transferBetweenBankAccounts(token,{fromAccountId,toAccountId,amount,notes})`.

- [ ] **Step 1: Write failing Expense/Transfer tests**

Assert Expense visible fields include Category, Payee, Description, Amount + Bangla words, Payment Method; More Details contains Date, Reference, Notes, conditional Backdated Reason; exact payload mapping; success resets and focuses Category; failure preserves.

Assert Bank Transfer contains From, To, Amount + Bangla words, Notes in More Details; client validates From != To and amount > 0; exact native transfer payload has no date; success resets/focuses From; failure preserves.

- [ ] **Step 2: Run RED**

Run: `node tests/counter_expense_transfer.test.js`

Expected: FAIL.

- [ ] **Step 3: Implement both flows**

Populate categories/payees/payment methods/accounts from bootstrap. Use `fillBankAccountSelect_` for account filtering. Keep transfer accounts to active Bank/Mobile Banking rows only. Preserve active transaction type after success.

- [ ] **Step 4: Run GREEN + native module tests**

Run:

```bash
node tests/counter_expense_transfer.test.js
node tests/vendor_workspace_actions_expense_test.js
node tests/deep_review_regressions.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add counter.html tests/counter_expense_transfer.test.js
git commit -m "feat: add counter expense and bank transfer flows"
```

---

### Task 8: Responsive polish, page lifecycle, and full acceptance gate

**Files:**
- Modify: `counter.html`
- Modify: `style.html`
- Modify: `javascript.html` only if lifecycle/mobile More integration requires a shared hook
- Test: `tests/counter_acceptance.test.js`

**Interfaces:**
- Produces: `counterLoad()` registered on first Counter navigation and `registerPageReload('counter', counterLoad)` if supported by existing reload registry; responsive desktop/mobile layout; transaction button visibility by bootstrap capabilities.

- [ ] **Step 1: Write failing acceptance test**

Cover the spec's acceptance matrix, especially:

```text
Counter hidden from nav when no underlying action permission
individual selector buttons capability-gated
one bootstrap RPC on page load
no RPC per combobox keystroke
same active type after success
failure preserves fields
More Details closes on reset
mobile single-column/no horizontal overflow CSS
numeric inputs use decimal inputmode
existing bottom nav primary keys unchanged
Counter has no history/edit/delete UI
Counter.gs has no mutation writer
```

Also assert all four native RPC names are present and no `postCounter*` mutation exists.

- [ ] **Step 2: Run RED**

Run: `node tests/counter_acceptance.test.js`

Expected: FAIL until lifecycle/styles/capability rendering are complete.

- [ ] **Step 3: Implement final lifecycle/responsive behavior**

Keep desktop workspace compact and centered; phone one-column; transaction selector 2x2 at narrow widths; result rows touch-friendly; post button large; no changes to mobile bottom-nav primary destinations.

`counterLoad()` calls `getCounterBootstrap` once per explicit load/reload, applies capabilities, loads local search indexes, sets business dates, and selects the first permitted transaction type if current type is not permitted.

- [ ] **Step 4: Run Counter test set**

Run:

```bash
node tests/counter_navigation.test.js
node tests/counter_bootstrap.test.js
node tests/counter_ui_primitives.test.js
node tests/counter_quick_add_reuse.test.js
node tests/counter_customer_receive.test.js
node tests/counter_supplier_pay.test.js
node tests/counter_expense_transfer.test.js
node tests/counter_acceptance.test.js
```

Expected: all PASS.

- [ ] **Step 5: Run full project regression and structural gates**

Run every `tests/*.test.js`, then parse every `.gs` and every inline `<script>` block as JavaScript after stripping Apps Script template syntax. Verify:

```text
0 failed tests
0 duplicate top-level server functions
0 missing serverCall RPC targets
0 conflict markers
Counter.gs contains no forbidden mutation/write primitives
```

- [ ] **Step 6: Commit**

```bash
git add counter.html style.html javascript.html tests/counter_acceptance.test.js
git commit -m "test: complete counter quick-entry acceptance coverage"
```

- [ ] **Step 7: Package and fresh-extraction verify**

Create:

```text
SherERP-Counter-Quick-Entry-FINAL-2026-09-04.zip
SherERP-Counter-Quick-Entry-CHANGED-FILES-ONLY.zip
```

The changed-files archive must be generated by diffing against the exact `SherERP-Grouped-Collapsible-Sidebar-FINAL-2026-09-04.zip` baseline, preserving relative paths. Extract the full ZIP into a clean directory and rerun the full tests + structural checks there before delivery.
