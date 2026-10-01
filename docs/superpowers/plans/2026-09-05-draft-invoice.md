# Draft Invoice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe Draft Invoice workflow to SherERP POS so unfinished carts can be saved, reopened, previewed, and converted into exactly one real sale without affecting stock, accounting, cash/bank, customer due, or invoice numbering before posting.

**Architecture:** Drafts are temporary one-row documents in `Draft Invoices`, with cart/payment state stored as compact JSON and an append-only `Draft Invoice Audit`. `DraftSales.gs` owns draft persistence, ownership, versioning, and post-link cleanup only; `Sales.gs::completeSale()` remains the sole real-sale writer and gains an optional source-draft idempotency boundary. POS restores saved draft economics in an internal `fixed` price mode so exact FIFO-derived line totals cannot silently reprice or drift by one poisha.

**Tech Stack:** Google Apps Script V8, Google Sheets via `Database.gs`, `LockService`, `PropertiesService`, vanilla HTML/CSS/JavaScript SPA, existing invoice renderer, Node.js static/regression tests.

**Spec:** `docs/superpowers/specs/2026-09-05-draft-invoice-design.md`

## Global Constraints

- Google Apps Script V8 is the runtime and Google Sheets is the database.
- Drafts do not reserve stock or serials.
- Saving/updating/deleting a draft must not require an active cash session.
- Draft mutations must never call `completeSale`, `applyStockConsumption_`, `addCashBookEntry_`, `addBankBookEntry_`, `postVendorLedgerEntry_`, or `requireActiveCashSession_`.
- `completeSale(token, payload)` remains the only real sale creation path.
- Real invoice numbering remains unchanged; drafts use `DRF-......` technical IDs and `DRAFT-YYYY-NNNN` display numbers.
- A draft requires at least one product line, but customer and payment fields may be incomplete.
- Saved price, discount, and exact line totals must reopen unchanged.
- `priceMode: 'fixed'` is permitted only for a validated source draft; ordinary POS requests cannot use it.
- `Source Draft ID` on `SALES` is the permanent idempotency key.
- One source draft may create at most one real sale, including retries after the active draft row has already been deleted.
- Cashier ownership is based on `Created By ID`; manage-all capability is derived from `sales.edit`, never from role names.
- `pos.add` allows creating/own-draft management; `pos.view` is required to edit/open inside POS; `sales.edit` allows manage-all draft list/read/delete/update; `completeSale` still requires `pos.add`.
- Draft list must not expose a direct Post action.
- Draft preview/print/JPG must show `DRAFT / খসড়া`, use the Draft No, allocate no real Invoice ID, and suppress the Paid badge.
- All server-side draft writes use one script lock and existing `Database.gs` helpers; no raw Sheet writes are added to HTML/client code.
- JSON cells use a hard application limit of 45,000 characters per serialized field.
- No new `PERMISSION_MODULES` entry is introduced for drafts.
- Existing grouped/collapsible sidebar, floating horizontal scrollbar, mobile layout, invoice pagination, FIFO, negative-stock, vendor sourcing, returns, corrections, and cash-session behavior must remain intact.
- Runtime-only Apps Script/Sheets claims must not be reported as tested from Node static tests.

---

## File Structure Map

### New production files

- `DraftSales.gs` — draft validation, persistence, ownership/version checks, audit trail, draft preview read-model helpers, source-draft retry authorization, and non-throwing post cleanup.
- `draftSales.html` — Draft Invoices list/search/actions and preview/open/delete client behavior.

### Modified production files

- `Config.gs` — `SALES_DRAFTS`, `SALES_DRAFT_AUDIT`, headers/prefixes, and additive `SALES.Source Draft ID`.
- `Sales.gs` — optional source-draft validation, retry detection, `fixed` line semantics, sale source stamp, and post cleanup.
- `Invoice.gs` — reusable shop payload builder so draft preview uses the same invoice branding/settings without pretending a draft is a Sale row.
- `pos.html` — draft state, Save/Update Draft, open/restore, conflict UX, fixed-price behavior, source fields on final post, safe reset/exit.
- `UI.gs` — Draft Invoices child under Sales with `actionPermAny` capability metadata.
- `javascript.html` — generic sub-navigation `actionPermAny` support, `draftSales` page reloader, invoice draft marker/printing/JPG behavior, and delete-confirmation compatibility hook.
- `index.html` — `draftSales.html` page include.
- `style.html` — draft list/cards, POS draft banner/conflict controls, invoice draft marker/watermark.
- `PROJECT.md` — final lifecycle, permissions, no-reservation rule, and idempotency boundary.

### New tests

- `tests/draft_sales_server.test.js`
- `tests/draft_sales_navigation.test.js`
- `tests/draft_sales_pos.test.js`
- `tests/draft_sales_conversion.test.js`
- `tests/draft_sales_invoice.test.js`
- `tests/draft_sales_regression.test.js`

---

### Task 1: Draft schema, persistence, ownership, versioning, and audit

**Files:**
- Modify: `Config.gs:35-78`, `Config.gs:215-253`, `Config.gs:942-979`
- Create: `DraftSales.gs`
- Test: `tests/draft_sales_server.test.js`

**Interfaces:**
- Consumes: `getSessionUser_`, `hasPermission_`, `requirePermission_`, `getAllRows_`, `findFirstRow_`, `appendRow_`, `updateRowFields_`, `deleteRow_`, `generateId_`, `sanitizeInput_`, `isValidNonNegativeNumber_`, `roundMoney_`, `actorName_`, `ok_`, `fail_`.
- Produces:
  - `saveSalesDraft(token, payload)` -> `{draftId,draftNo,version}`
  - `getSalesDraftList(token)` -> lightweight array
  - `getSalesDraft(token, draftId)` -> authorized full draft state
  - `updateSalesDraft(token, draftId, expectedVersion, payload)` -> `{draftId,draftNo,version}`
  - `deleteSalesDraft(token, draftId, expectedVersion, reason)` -> `{draftId}`
  - private `generateDraftInvoiceNo_()`
  - private `salesDraftCanManageAll_(user)`
  - private `requireSalesDraftFeatureAccess_(token)`
  - private `requireSalesDraftAccess_(user,row,mode)`
  - private `validateSalesDraftPayload_(payload)`
  - private `parseSalesDraftRow_(row)`
  - private `appendSalesDraftAudit_(action,row,user,invoiceId,note)`
  - constant `SALES_DRAFT_JSON_LIMIT_ = 45000`

- [ ] **Step 1: Write the failing server/schema test**

Create `tests/draft_sales_server.test.js` using the repository's existing `fs/path/vm/assert` pattern. The first assertions must be:

```js
'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..');
const read=n=>fs.readFileSync(path.join(root,n),'utf8');
const cfg=read('Config.gs');
const draft=()=>read('DraftSales.gs');

assert.match(cfg,/SALES_DRAFTS:\s*["']Draft Invoices["']/);
assert.match(cfg,/SALES_DRAFT_AUDIT:\s*["']Draft Invoice Audit["']/);
assert.match(cfg,/SALES_DRAFTS:\s*\[[\s\S]*["']Draft ID["'][\s\S]*["']Items JSON["'][\s\S]*["']Payment JSON["'][\s\S]*["']Version["']/);
assert.match(cfg,/SALES_DRAFT_AUDIT:\s*\[[\s\S]*["']Action["'][\s\S]*["']Source Owner ID["'][\s\S]*["']Invoice ID["']/);
assert.match(cfg,/SALES:\s*\[[\s\S]*["']Source Draft ID["']/);
assert.match(cfg,/ID_PREFIX:\s*\{[\s\S]*SALES_DRAFTS:\s*["']DRF["'][\s\S]*SALES_DRAFT_AUDIT:\s*["']DRA["']/);

const src=draft();
for(const name of ['saveSalesDraft','getSalesDraftList','getSalesDraft','updateSalesDraft','deleteSalesDraft']) {
  assert.match(src,new RegExp('function\\s+'+name+'\\s*\\('));
}
for(const forbidden of ['completeSale(', 'applyStockConsumption_(', 'addCashBookEntry_(', 'addBankBookEntry_(', 'postVendorLedgerEntry_(', 'requireActiveCashSession_(']) {
  assert.strictEqual(src.includes(forbidden),false,'draft module must not call '+forbidden);
}
assert.match(src,/SALES_DRAFT_JSON_LIMIT_\s*=\s*45000/);
assert.match(src,/This draft was changed by another user\. Reload the latest version\./);
assert.match(src,/hasPermission_\(user,\s*['"]sales['"],\s*['"]edit['"]\)/);
assert.match(src,/Created By ID/);
console.log('PASS draft sales server/schema contract');
```

- [ ] **Step 2: Run RED**

Run:

```bash
node tests/draft_sales_server.test.js
```

Expected: FAIL because `DraftSales.gs` and draft schema entries do not exist.

- [ ] **Step 3: Add exact Sheet schema and prefixes**

In `Config.gs`, add:

```js
SALES_DRAFTS: 'Draft Invoices',
SALES_DRAFT_AUDIT: 'Draft Invoice Audit',
```

Add these header blocks:

```js
SALES_DRAFTS: [
  'Draft ID','Draft No','Draft Date','Customer ID','Customer Name','Customer Phone',
  'Customer Father Name','Customer Address','Items JSON','Payment JSON','Notes',
  'Subtotal','Discount','Grand Total','Created By ID','Created By Name','Created At',
  'Updated By ID','Updated By Name','Updated At','Version'
],
SALES_DRAFT_AUDIT: [
  'Audit ID','Timestamp','Action','Draft ID','Draft No','Version','Actor ID','Actor Name',
  'Source Owner ID','Invoice ID','Note'
],
```

Append `'Source Draft ID'` to `HEADERS.SALES` before the soft-delete columns, and add:

```js
SALES_DRAFTS: 'DRF',
SALES_DRAFT_AUDIT: 'DRA',
```

to `ID_PREFIX`.

- [ ] **Step 4: Implement draft identity, validation, permission, and serialization helpers**

Create `DraftSales.gs` with the following contracts and exact failure messages:

```js
const SALES_DRAFT_JSON_LIMIT_ = 45000;

function generateDraftInvoiceNo_() {
  const props = PropertiesService.getDocumentProperties();
  const year = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy');
  const key = 'DRAFT_INVOICE_COUNTER_' + year;
  const next = Number(props.getProperty(key) || '0') + 1;
  props.setProperty(key, String(next));
  return 'DRAFT-' + year + '-' + String(next).padStart(4, '0');
}

function salesDraftCanManageAll_(user) {
  return hasPermission_(user, 'sales', 'edit');
}

function requireSalesDraftFeatureAccess_(token) {
  const user = getSessionUser_(token);
  if (!hasPermission_(user, 'pos', 'add') && !salesDraftCanManageAll_(user)) {
    throw new Error('You do not have permission to access draft invoices.');
  }
  return user;
}

function requireSalesDraftAccess_(user, row, mode) {
  if (!row) throw new Error('Draft not found.');
  const mine = String(row['Created By ID'] || '') === String(user['User ID'] || '');
  const manageAll = salesDraftCanManageAll_(user);
  if (!mine && !manageAll) throw new Error('You do not have permission to manage this draft.');
  if (mode === 'edit' && !hasPermission_(user, 'pos', 'view')) {
    throw new Error('You do not have permission to view POS.');
  }
  if (mine && !manageAll && !hasPermission_(user, 'pos', 'add')) {
    throw new Error('You do not have permission to manage this draft.');
  }
  return { mine: mine, manageAll: manageAll };
}
```

`validateSalesDraftPayload_(payload)` must validate at least one line; positive finite quantity; nonblank product ID/name; finite nonnegative `unitPrice` and `lineTotal`; nonnegative finite scalar totals; and serialize compact item/payment JSON. Reject either JSON string over 45,000 chars with:

```text
This draft is too large to save. Remove some lines or notes.
```

Do not validate cash session, current stock, vendor existence, bank-account existence, customer completeness, or backdate permission here.

- [ ] **Step 5: Implement create/list/read/update/delete and audit under one lock per mutation**

Creation skeleton:

```js
function saveSalesDraft(token, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    const user = requirePermission_(token, 'pos', 'add');
    const clean = validateSalesDraftPayload_(payload || {});
    const now = new Date();
    const row = {
      'Draft ID': generateId_('SALES_DRAFTS'),
      'Draft No': generateDraftInvoiceNo_(),
      'Draft Date': formatDate_(now),
      'Customer ID': clean.customerId,
      'Customer Name': clean.customerName,
      'Customer Phone': clean.customerPhone,
      'Customer Father Name': clean.customerFatherName,
      'Customer Address': clean.customerAddress,
      'Items JSON': clean.itemsJson,
      'Payment JSON': clean.paymentJson,
      'Notes': clean.notes,
      'Subtotal': clean.subtotal,
      'Discount': clean.discount,
      'Grand Total': clean.grandTotal,
      'Created By ID': user['User ID'],
      'Created By Name': actorName_(user),
      'Created At': now,
      'Updated By ID': user['User ID'],
      'Updated By Name': actorName_(user),
      'Updated At': now,
      'Version': 1
    };
    appendRow_('SALES_DRAFTS', row);
    appendSalesDraftAudit_('CREATED', row, user, '', '');
    return ok_({ draftId: row['Draft ID'], draftNo: row['Draft No'], version: 1 });
  } catch (err) {
    logError_('saveSalesDraft', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}
```

`updateSalesDraft` and `deleteSalesDraft` must load the row while holding the lock, verify `expectedVersion`, then write/audit. Version mismatch must happen before any row/audit write. `deleteSalesDraft` appends `DELETED` then hard-deletes the temporary row with `deleteRow_`.

`getSalesDraftList` must not parse `Items JSON`; map only scalar list fields and sort by `Updated At` descending. Own-only users receive only rows whose `Created By ID` matches. Manage-all users receive all rows.

`getSalesDraft` parses JSON only after server authorization and returns the stored version plus `mine/canManage` metadata.

`appendSalesDraftAudit_` accepts only these workflow action strings from draft code paths: `CREATED`, `UPDATED`, `DELETED`, `POSTED`, and `POST_CLEANUP_RETRY`. Every audit row stores Draft ID, Draft No, Version, Actor ID/Name, original `Created By ID` as `Source Owner ID`, optional Invoice ID, timestamp, and note.

- [ ] **Step 6: Run GREEN and setup regression**

Run:

```bash
node tests/draft_sales_server.test.js
node tests/deep_review_regressions.test.js
```

Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add Config.gs DraftSales.gs tests/draft_sales_server.test.js
git commit -m "feat: add draft invoice persistence and audit"
```

---

### Task 2: Draft Invoices navigation and list workspace

**Files:**
- Modify: `UI.gs:45-56`
- Modify: `javascript.html:273-317`, `javascript.html:2491-2511`
- Modify: `index.html:84-92`
- Create: `draftSales.html`
- Modify: `style.html`
- Test: `tests/draft_sales_navigation.test.js`

**Interfaces:**
- Consumes: `getSalesDraftList(token)`, `getSalesDraft(token,draftId)`, `serverCall`, `withLoader`, `goToPage`, `registerPageReload`, `formatMoney`, `escapeHtml`, `hasActionPermission_`.
- Produces:
  - NAV child `{key:'draftSales', label:'Draft Invoices', bn:'খসড়া বিক্রি', actionPermAny:[...]}`
  - `draftSalesLoad()`
  - `draftSalesRender_()`
  - `draftSalesOpen_(draftId)`
  - `draftSalesPreview_(draftId)` hook used by Task 5
  - `draftSalesDelete_(draftId)` hook completed in Task 6

- [ ] **Step 1: Write failing navigation/list tests**

Create `tests/draft_sales_navigation.test.js` and assert:

```js
const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..');
const read=n=>fs.readFileSync(path.join(root,n),'utf8');
const ui=read('UI.gs'), js=read('javascript.html'), index=read('index.html');
const page=()=>read('draftSales.html');

assert.match(ui,/key:\s*['"]draftSales['"][\s\S]*label:\s*['"]Draft Invoices['"]/);
assert.match(ui,/draftSales[\s\S]*actionPermAny[\s\S]*module:\s*['"]pos['"][\s\S]*action:\s*['"]add['"][\s\S]*module:\s*['"]sales['"][\s\S]*action:\s*['"]edit['"]/);
assert.doesNotMatch(ui,/PERMISSION_MODULES[\s\S]*key:\s*['"]draftSales['"]/);
assert.match(js,/function subNavVisible_[\s\S]*child\.actionPermAny/);
assert.match(js,/draftSales:\s*['"]draftSalesLoad['"]/);
assert.match(index,/id="page-draftSales"[\s\S]*include\('draftSales'\)/);
const html=page();
for(const label of ['Draft No','Updated','Customer','Phone','Amount','Created By','Actions']) assert.match(html,new RegExp(label));
assert.doesNotMatch(html,/>\s*Post\s*</i);
console.log('PASS draft navigation/list contract');
```

- [ ] **Step 2: Run RED**

Run:

```bash
node tests/draft_sales_navigation.test.js
```

Expected: FAIL because the child/page do not exist and sub-nav does not yet honor child `actionPermAny`.

- [ ] **Step 3: Add capability-derived Sales child and generic sub-nav support**

In `UI.gs`, insert between Sales Invoice and New Return:

```js
{
  key: 'draftSales', label: 'Draft Invoices', bn: 'খসড়া বিক্রি',
  actionPermAny: [
    { module: 'pos', action: 'add' },
    { module: 'sales', action: 'edit' }
  ]
},
```

In `javascript.html::subNavVisible_`, check `child.actionPermAny` before `permKey`:

```js
if (child.actionPermAny) return actionPermAnyVisible_(child);
```

Do not add a `draftSales` permission module.

- [ ] **Step 4: Add page include and loader registration**

In `index.html` add:

```html
<section class="page" id="page-draftSales" data-page="draftSales" hidden>
  <?!= include('draftSales'); ?>
</section>
```

In `PAGE_LOADERS_` add:

```js
draftSales: 'draftSalesLoad',
```

- [ ] **Step 5: Build searchable desktop table + mobile-card list**

`draftSales.html` must keep an in-memory `draftSalesState_ = { rows: [], query: '' }`, call only `getSalesDraftList` on load/refresh, filter locally by Draft No/customer/phone/creator, and render actions:

```text
Open
Print / Preview
Save JPG
Delete
```

There must be no Post action. `Open` calls `posOpenDraft_(draftId)` after routing to POS. If `pos.view` is not granted, show Preview/Delete only and do not expose Open.

Use existing `mobile-card-table` conventions so compact mobile cards are produced by the shared enhancer rather than a second mobile-only data source.

- [ ] **Step 6: Run GREEN + navigation regressions**

Run:

```bash
node tests/draft_sales_navigation.test.js
node tests/sidebar_grouped_collapse.test.js
node tests/counter_navigation.test.js
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add UI.gs javascript.html index.html draftSales.html style.html tests/draft_sales_navigation.test.js
git commit -m "feat: add draft invoice list workspace"
```

---

### Task 3: POS Save Draft, Update Draft, Open Draft, and exact fixed-price restore

**Files:**
- Modify: `pos.html:92-130`, `pos.html:212-249`, `pos.html:653-790`, `pos.html:994-1075`, `pos.html:1228-1325`
- Test: `tests/draft_sales_pos.test.js`

**Interfaces:**
- Consumes: `saveSalesDraft`, `updateSalesDraft`, `getSalesDraft`, existing `posLoad`, `posRenderCart_`, `posApplyAutomaticPricing_`, `posApplyManualLineTotal_`, `posClearCustomer_`, `posRenderSessionUI_`, `serverCall`, `withLoader`.
- Produces:
  - `posState.draftId`, `draftNo`, `draftVersion`
  - `posBuildDraftPayload_()`
  - `posSaveDraft_()`
  - `posOpenDraft_(draftId)`
  - `posRestoreDraft_(draft)`
  - `posExitDraftMode_(clearForm)`
  - `posResetSaleForm_()` shared by normal sale success and draft-save success
  - internal cart mode `priceMode: 'fixed'`

- [ ] **Step 1: Write failing POS draft tests**

Create `tests/draft_sales_pos.test.js` and assert:

```js
const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'pos.html'),'utf8');

assert.match(html,/id="posSaveDraftBtn"/);
assert.match(html,/id="posDraftBanner"/);
assert.match(html,/function posBuildDraftPayload_/);
assert.match(html,/serverCall\(['"]saveSalesDraft['"]/);
assert.match(html,/serverCall\(['"]updateSalesDraft['"]/);
assert.match(html,/function posOpenDraft_/);
assert.match(html,/priceMode:\s*['"]fixed['"]/);
assert.match(html,/savedPriceMode/);
assert.match(html,/sourceDraftId/);
assert.match(html,/sourceDraftVersion/);
assert.match(html,/line\.priceMode\s*===\s*['"]fixed['"][\s\S]*line\.priceMode\s*=\s*['"]manual['"]/);
assert.match(html,/Reset to Lot Price/);
assert.match(html,/function posResetSaleForm_/);
console.log('PASS POS draft contract');
```

- [ ] **Step 2: Run RED**

Run:

```bash
node tests/draft_sales_pos.test.js
```

Expected: FAIL because the POS has no draft state/buttons/functions.

- [ ] **Step 3: Add draft banner/actions without coupling Save Draft to cash-session state**

Add near the existing update banner:

```html
<div id="posDraftBanner" class="session-banner is-open pos-draft-banner" hidden>
  <div>Editing <strong class="mono" id="posDraftBannerNo"></strong></div>
  <div class="toolbar-spacer"></div>
  <button class="btn" id="posExitDraftBtn" type="button">Exit Draft</button>
</div>
```

Change checkout actions to:

```html
<div class="pos-checkout-actions">
  <button class="btn" id="posSaveDraftBtn" type="button">Save Draft</button>
  <button class="btn btn-primary" id="posCompleteBtn">Complete Sale</button>
</div>
```

`posRenderSessionUI_()` continues to disable only `posCompleteBtn`; `posSaveDraftBtn` is enabled whenever the cart has at least one line and does not depend on `posState.activeSession`.

- [ ] **Step 4: Extend POS state and extract one safe form reset helper**

Extend the state object with:

```js
draftId: null,
draftNo: '',
draftVersion: null,
```

Extract the existing successful-sale clearing block into:

```js
function posResetSaleForm_() {
  posState.cart = [];
  posState._addVendorForLineIndex = null;
  document.getElementById('posDiscount').value = 0;
  document.getElementById('posAmountReceived').value = '';
  document.getElementById('posPaymentMethod').value = 'Cash';
  document.getElementById('posBankAccount').value = '';
  document.getElementById('posBankAccountRow').style.display = 'none';
  posClearCustomer_();
  document.getElementById('posChangeRow').style.display = 'none';
  document.getElementById('posDueRow').style.display = 'none';
  posSetCustomerMoreExpanded_(false);
  posUpdateCustomerDueDisplay_(0);
  posRenderCart_();
}
```

Normal sale success and draft save/update success both call this helper.

- [ ] **Step 5: Build the exact draft snapshot and Save/Update behavior**

`posBuildDraftPayload_()` returns visible user state, not derived accounting rows:

```js
function posBuildDraftPayload_() {
  var subtotal = posState.cart.reduce(function (sum, line) { return sum + (Number(line.lineTotal) || 0); }, 0);
  var discount = Number(document.getElementById('posDiscount').value) || 0;
  return {
    customerId: document.getElementById('posCustomerName').dataset.customerId || '',
    customerName: document.getElementById('posCustomerName').value.trim(),
    customerPhone: document.getElementById('posCustomerPhone').value.trim(),
    customerFatherName: document.getElementById('posCustomerFatherName').value.trim(),
    customerAddress: document.getElementById('posCustomerAddress').value.trim(),
    items: posState.cart.map(function (line) {
      return {
        productId: line.productId,
        name: line.name,
        unit: line.unit || '',
        qty: Number(line.qty) || 0,
        unitPrice: Number(line.unitPrice) || 0,
        lineTotal: Number(line.lineTotal) || 0,
        savedPriceMode: line.savedPriceMode || line.priceMode || 'manual',
        shortageResolution: line.shortageResolution || 'negative',
        vendorId: line.vendorId || '',
        vendorName: line.vendorName || '',
        vendorUnitCost: line.vendorUnitCost === '' ? '' : Number(line.vendorUnitCost),
        serialSelections: Array.isArray(line.serialSelections) ? line.serialSelections : [],
        warrantyData: line.warrantyData || null
      };
    }),
    payment: {
      amountReceived: document.getElementById('posAmountReceived').value,
      paymentMethod: document.getElementById('posPaymentMethod').value,
      bankAccountId: document.getElementById('posBankAccount').value
    },
    notes: '',
    subtotal: subtotal,
    discount: discount,
    grandTotal: Math.max(0, subtotal - discount)
  };
}
```

`posSaveDraft_()` rejects only an empty cart locally, then calls `saveSalesDraft` for a new draft or `updateSalesDraft(authToken,draftId,draftVersion,payload)` while editing. Success toast includes the Draft No, then exits draft mode and clears the register for the next customer.

- [ ] **Step 6: Restore a draft only after a fresh POS bootstrap**

`posOpenDraft_(draftId)` must route to POS and execute:

```js
function posOpenDraft_(draftId) {
  goToPage('pos');
  return withLoader(Promise.all([
    posLoad(),
    serverCall('getSalesDraft', authToken, draftId)
  ])).then(function (results) {
    posRestoreDraft_(results[1]);
  }).catch(function (err) {
    showToast(err.message, 'error');
  });
}
```

`posRestoreDraft_()` maps each stored line to current product metadata. Existing products restore with:

```js
{
  productId: item.productId,
  name: item.name,
  unit: item.unit || (product ? product.unit : ''),
  qty: Number(item.qty) || 1,
  unitPrice: Number(item.unitPrice) || 0,
  lineTotal: Number(item.lineTotal) || 0,
  priceMode: 'fixed',
  savedPriceMode: item.savedPriceMode || 'manual',
  shortageResolution: item.shortageResolution || 'negative',
  vendorId: item.vendorId || '',
  vendorName: item.vendorName || '',
  vendorUnitCost: item.vendorUnitCost,
  unavailable: !product
}
```

Missing/inactive products remain visible with an unavailable badge and may be removed; they are never silently substituted.

Restore payment/customer fields from the saved snapshot, set `draftId/draftNo/draftVersion`, show the banner, change Save Draft label to `Update Draft`, and keep Complete Sale available only when the active-session rule allows it.

- [ ] **Step 7: Make fixed mode exact and user-editable**

Update cart behavior:

```js
if (line.priceMode === 'auto') {
  posApplyAutomaticPricing_(line);
} else if (line.priceMode === 'fixed') {
  // preserve saved exact lineTotal while qty/price are unchanged
} else if (line.lineTotal === undefined) {
  posApplyManualLineTotal_(line);
}
```

When quantity is edited:

```js
if (line.priceMode === 'auto') {
  posApplyAutomaticPricing_(line);
} else {
  if (line.priceMode === 'fixed') line.priceMode = 'manual';
  posApplyManualLineTotal_(line);
}
```

Price editing already sets `manual`; keep that. Show Reset to Lot Price for both `manual` and `fixed` lines outside invoice-update mode. Reset sets `auto` and applies current lot pricing.

- [ ] **Step 8: Include source identity only when posting from draft mode**

When building the normal sale payload, add:

```js
if (posState.draftId) {
  payload.sourceDraftId = posState.draftId;
  payload.sourceDraftVersion = posState.draftVersion;
  payload.items.forEach(function (item, i) {
    item.lineTotal = Number(posState.cart[i].lineTotal) || 0;
  });
}
```

Do not change ordinary POS payloads when `draftId` is null.

- [ ] **Step 9: Run GREEN + POS price regressions**

Run:

```bash
node tests/draft_sales_pos.test.js
node tests/lot_selling_price.test.js
node tests/compact_pos_mockup.test.js
node tests/mobile_pwa_ui.test.js
```

Expected: all PASS.

- [ ] **Step 10: Commit**

```bash
git add pos.html tests/draft_sales_pos.test.js
git commit -m "feat: add POS draft save and restore flow"
```

---

### Task 4: Idempotent draft-to-sale conversion in `completeSale()`

**Files:**
- Modify: `DraftSales.gs`
- Modify: `Sales.gs:166-419`
- Test: `tests/draft_sales_conversion.test.js`

**Interfaces:**
- Consumes: Task 1 draft schema/access/audit helpers, Task 3 `sourceDraftId/sourceDraftVersion` and `fixed` cart mode.
- Produces:
  - private `findPostedInvoiceByDraftId_(draftId)` -> Sale row or null
  - private `findPostedDraftAudit_(draftId)` -> latest `POSTED` audit or null
  - private `prepareSalesDraftForPosting_(actingUser,draftId,expectedVersion)` -> `{row, parsed, access}`
  - private `authorizePostedDraftRetry_(actingUser,draftId,expectedVersion)`
  - private `fixedDraftLineByProduct_(draftParsed)` -> map
  - private `removeSalesDraftAfterPost_(draftId,version,invoiceId,actingUser,retry)` -> non-throwing

- [ ] **Step 1: Write failing conversion/idempotency tests**

Create `tests/draft_sales_conversion.test.js` and assert source order and contracts:

```js
const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..');
const read=n=>fs.readFileSync(path.join(root,n),'utf8');
const sales=read('Sales.gs'), draft=read('DraftSales.gs');

assert.match(sales,/sourceDraftId/);
assert.match(sales,/sourceDraftVersion/);
assert.match(sales,/Source Draft ID/);
assert.match(sales,/priceMode\s*===\s*['"]fixed['"]/);
assert.match(sales,/findPostedInvoiceByDraftId_/);
assert.match(sales,/removeSalesDraftAfterPost_/);
assert.match(draft,/POST_CLEANUP_RETRY/);
assert.match(draft,/findPostedDraftAudit_/);

const linkedPos=sales.indexOf('findPostedInvoiceByDraftId_');
const invoiceIdPos=sales.indexOf("generateId_('SALES')");
assert(linkedPos>=0 && invoiceIdPos>linkedPos,'linked-sale check must precede new invoice ID generation');

const sourceWrite=sales.indexOf("'Source Draft ID'");
const firstSaleAppend=sales.indexOf("appendRow_('SALES'");
assert(sourceWrite>firstSaleAppend,'sale row must stamp Source Draft ID');
console.log('PASS draft conversion/idempotency contract');
```

Add a source inspection assertion that ordinary no-draft path still reaches the existing cash-session and validation blocks unchanged.

- [ ] **Step 2: Run RED**

Run:

```bash
node tests/draft_sales_conversion.test.js
```

Expected: FAIL because source-draft conversion logic does not exist.

- [ ] **Step 3: Implement posted-sale lookup and retry authorization before new-sale validation**

In `DraftSales.gs`:

```js
function findPostedInvoiceByDraftId_(draftId) {
  const id = sanitizeInput_(draftId);
  if (!id) return null;
  return getAllRows_('SALES').filter(function (row) {
    return String(row['Source Draft ID'] || '') === id;
  })[0] || null;
}

function findPostedDraftAudit_(draftId) {
  const id = sanitizeInput_(draftId);
  const rows = getAllRows_('SALES_DRAFT_AUDIT').filter(function (row) {
    return row['Draft ID'] === id && row['Action'] === 'POSTED';
  });
  rows.sort(function (a,b) { return new Date(b['Timestamp']) - new Date(a['Timestamp']); });
  return rows[0] || null;
}
```

`authorizePostedDraftRetry_` must accept the current user only if the active draft is still authorized **or** the `POSTED` audit's `Source Owner ID` equals the user ID **or** `sales.edit` is granted. It must also compare the audit/draft version to `expectedVersion` before cleanup retry.

This audit fallback is required because a successful first request may have deleted the active draft before its HTTP response was lost.

- [ ] **Step 4: Add source-draft preamble to `completeSale()` before cash/stock/customer validation**

Immediately after `actingUser` and empty-cart validation, add conceptually:

```js
const sourceDraftId = sanitizeInput_(payload.sourceDraftId);
const sourceDraftVersion = Number(payload.sourceDraftVersion);
let sourceDraft = null;
let fixedDraftLines = {};

if (sourceDraftId) {
  const alreadyPosted = findPostedInvoiceByDraftId_(sourceDraftId);
  if (alreadyPosted) {
    authorizePostedDraftRetry_(actingUser, sourceDraftId, sourceDraftVersion);
    removeSalesDraftAfterPost_(sourceDraftId, sourceDraftVersion, alreadyPosted['Invoice ID'], actingUser, true);
    return ok_(buildInvoicePayload_(alreadyPosted['Invoice ID']));
  }
  sourceDraft = prepareSalesDraftForPosting_(actingUser, sourceDraftId, sourceDraftVersion);
  fixedDraftLines = fixedDraftLineByProduct_(sourceDraft.parsed);
}
```

Then continue the existing `requireActiveCashSession_()` and sale validation. There must still be no financial/stock write before all validation finishes.

- [ ] **Step 5: Add safe `fixed` line pricing without changing ordinary manual/auto semantics**

Inside line validation:

```js
const requestedMode = item.priceMode;
const priceMode = requestedMode === 'auto' ? 'auto' : (requestedMode === 'fixed' ? 'fixed' : 'manual');
if (priceMode === 'fixed' && !sourceDraftId) {
  throw new Error('Fixed draft pricing requires a valid source draft.');
}
```

For `fixed`, look up the authorized saved line by product ID and require exact saved quantity/unit price/line total match. If any mismatch occurs, reject before writes:

```text
Draft line changed. Update the draft or edit the line before posting.
```

Use the server-loaded stored draft `lineTotal` as authoritative for fixed mode. `auto` keeps `computePlanSellingPrice_`; `manual` keeps `roundMoney_(qty * clientPrice)`.

This is the one-poisha protection for blended FIFO pricing.

- [ ] **Step 6: Stamp the source and perform non-throwing post cleanup only after the existing sale writes complete**

Add to the `SALES` append object:

```js
'Source Draft ID': sourceDraftId || ''
```

After cash/bank/due/customer-ledger writes and immediately before the final invoice return:

```js
if (sourceDraftId) {
  removeSalesDraftAfterPost_(sourceDraftId, sourceDraftVersion, invoiceId, actingUser, false);
}
return ok_(buildInvoicePayload_(invoiceId));
```

`removeSalesDraftAfterPost_` must:

1. catch/log its own failures;
2. append `POSTED` (or `POST_CLEANUP_RETRY`) audit before deleting the active draft;
3. never delete the draft if the required POSTED audit append failed;
4. hard-delete the temporary row only after audit evidence exists;
5. never throw back into `completeSale()` after the financial sale has been written.

- [ ] **Step 7: Run GREEN + sale/stock regressions**

Run:

```bash
node tests/draft_sales_conversion.test.js
node tests/lot_selling_price.test.js
node tests/deep_review_regressions.test.js
node tests/pre_correction_native_actions.test.js
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add Sales.gs DraftSales.gs tests/draft_sales_conversion.test.js
git commit -m "feat: make draft conversion idempotent"
```

---

### Task 5: Draft preview, print/PDF, thermal, and JPG using the existing invoice renderer

**Files:**
- Modify: `Invoice.gs:23-103`
- Modify: `DraftSales.gs`
- Modify: `draftSales.html`
- Modify: `javascript.html:1695-1903`, `javascript.html:1922-1987`
- Modify: `style.html`
- Test: `tests/draft_sales_invoice.test.js`

**Interfaces:**
- Consumes: existing `renderInvoiceHtml_`, `renderInvoiceHtmlThermal_`, `renderInvoicePrintHtml_`, `printInvoice_`, `downloadInvoiceJpg_`, `getSettingsMap_`, `resolveInvoiceLogoDataUri_`.
- Produces:
  - `buildInvoiceShopPayload_(settings)` in `Invoice.gs`
  - private `buildSalesDraftPreviewPayload_(draftRow)` in `DraftSales.gs`
  - public `getSalesDraftPreview(token,draftId)`
  - client `buildInvDraftMark_(inv)`
  - `invoice-paper is-draft` print class

- [ ] **Step 1: Write failing invoice-preview tests**

Create `tests/draft_sales_invoice.test.js` and assert:

```js
const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..');
const read=n=>fs.readFileSync(path.join(root,n),'utf8');
const invoice=read('Invoice.gs'), draft=read('DraftSales.gs'), js=read('javascript.html');

assert.match(invoice,/function buildInvoiceShopPayload_/);
assert.match(draft,/function getSalesDraftPreview/);
assert.match(draft,/isDraft:\s*true/);
assert.match(draft,/invoiceId:\s*row\[['"]Draft No['"]\]/);
assert.match(js,/function buildInvDraftMark_/);
assert.match(js,/DRAFT/);
assert.match(js,/খসড়া/);
assert.match(js,/if\s*\(inv\.isDraft\)[\s\S]*return\s*['"]["']/);
assert.match(js,/is-draft/);
assert.match(js,/inv\.isDraft[\s\S]*PAID/);
console.log('PASS draft invoice preview contract');
```

- [ ] **Step 2: Run RED**

Run:

```bash
node tests/draft_sales_invoice.test.js
```

Expected: FAIL because draft preview/marking does not exist.

- [ ] **Step 3: Extract invoice shop/settings assembly once**

Move the `shop: { ... }` object from `buildInvoicePayload_()` into:

```js
function buildInvoiceShopPayload_(settings) {
  settings = settings || getSettingsMap_();
  return {
    name: settings['Shop Name'] || CONFIG.APP_NAME,
    nameBangla: settings['Shop Name Bangla'] || '',
    proprietorName: settings['Invoice Proprietor Name'] || '',
    proprietorParagraph: settings['Invoice Proprietor Paragraph'] || '',
    invoiceTitle: settings['Invoice Title'] || 'চালান',
    description: settings['Shop Description'] || '',
    address: settings['Address'] || '',
    phone1: settings['Phone 1'] || '',
    phone2: settings['Phone 2'] || '',
    phone: settings['Phone 1'] || settings['Phone'] || '',
    logoDataUri: resolveInvoiceLogoDataUri_(),
    showBismillah: isSettingEnabled_(settings['Invoice Show Bismillah'], true),
    bismillahText: settings['Invoice Bismillah Text'] || '',
    showSignature: isSettingEnabled_(settings['Invoice Show Signature'], true),
    paymentMethods: settings['Invoice Payment Methods'] || '[]',
    terms: settings['Invoice Terms'] || '[]',
    paymentTermsText: settings['Invoice Payment Terms Text'] || '',
    currencySymbol: settings['Currency Symbol'] || '',
    footer: settings['Invoice Footer'] || '',
    receiptSize: settings['Receipt Size'] || '80mm'
  };
}
```

`buildInvoicePayload_()` must call this helper so posted invoices remain byte-for-byte equivalent in data shape.

- [ ] **Step 4: Build authorized draft preview payload without allocating a real invoice ID**

`getSalesDraftPreview` authorizes using the same access helper as `getSalesDraft`, then maps the draft snapshot to:

```js
{
  isDraft: true,
  draftNo: row['Draft No'],
  invoiceId: row['Draft No'],
  date: row['Draft Date'],
  time: '',
  dueDate: '',
  customerId: row['Customer ID'],
  customerName: row['Customer Name'],
  customerPhone: row['Customer Phone'],
  customerFatherName: row['Customer Father Name'],
  customerAddress: row['Customer Address'],
  items: parsed.items,
  subtotal: Number(row['Subtotal']) || 0,
  discount: Number(row['Discount']) || 0,
  grandTotal: Number(row['Grand Total']) || 0,
  paidAmount: provisionalPaid,
  dueAmount: provisionalDue,
  paymentType: 'Draft',
  paymentStatus: 'Draft',
  paymentMethod: parsed.payment.paymentMethod || '',
  bankAccountName: '',
  shop: buildInvoiceShopPayload_(getSettingsMap_())
}
```

`provisionalPaid` is `min(max(amountReceived,0),grandTotal)` and `provisionalDue = max(0, grandTotal-provisionalPaid)`. These are display-only; no ledger/cash write is made.

- [ ] **Step 5: Mark every renderer as draft and suppress Paid**

Add:

```js
function buildInvDraftMark_(inv) {
  return inv && inv.isDraft ? '<div class="inv-draft-mark"><strong>DRAFT</strong><span>খসড়া</span></div>' : '';
}
```

Insert it into every screen `.invoice-page` and thermal page. `buildInvPaidBadge_` starts with:

```js
if (inv && inv.isDraft) return '';
```

In `printInvoice_`, add `is-draft` class to the `.invoice-paper` wrapper when `invoiceData.isDraft`. Print CSS must render a fixed translucent `DRAFT / খসড়া` marker for draft print/PDF so Chrome repeats it on physical A4 pages; screen multi-page rendering also gets one marker per `.invoice-page`.

In `drawReceiptCanvas_`, add a centered `DRAFT / খসড়া` row before the invoice title and change the PAID line condition to:

```js
if (!inv.isDraft && due === 0 && grand > 0) {
  rows.push({ text: 'PAID', size: 13, bold: true, align: 'center', color: '#12805c' });
}
```

JPG filename remains `<draftNo>.jpg` because `invoiceId` is the draft number.

- [ ] **Step 6: Wire Preview / Print / Save JPG actions**

`draftSalesPreview_(draftId, action)` calls `getSalesDraftPreview`, then:

```js
posRenderInvoice_(preview);
openModal('invoiceModal');
if (action === 'print') setTimeout(function () { printInvoice_(false, preview); }, 150);
if (action === 'jpg') downloadInvoiceJpg_(preview);
```

This reuses the existing modal/renderers and does not call `completeSale`.

- [ ] **Step 7: Run GREEN + invoice regressions**

Run:

```bash
node tests/draft_sales_invoice.test.js
node tests/mockup_module_design.test.js
node tests/compact_pos_mockup.test.js
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add Invoice.gs DraftSales.gs draftSales.html javascript.html style.html tests/draft_sales_invoice.test.js
git commit -m "feat: add draft invoice preview and export"
```

---

### Task 6: Delete confirmation compatibility, version-conflict UX, and draft exit safety

**Files:**
- Modify: `javascript.html:2193-2240`
- Modify: `draftSales.html`
- Modify: `pos.html`
- Modify: `style.html`
- Test: `tests/draft_sales_regression.test.js`

**Interfaces:**
- Consumes: current shared `confirmDelete`, future/approved `confirmAction` when present, `deleteSalesDraft`, `getSalesDraft`, Task 3 draft state.
- Produces:
  - optional `confirmDelete({successMessage})` support
  - `draftSalesDelete_(row)`
  - `posShowDraftConflict_(draftId)`
  - `posReloadDraftLatest_()`
  - `posExitDraftMode_(clearForm)` finalized

- [ ] **Step 1: Write failing safety/UX tests**

Extend/create `tests/draft_sales_regression.test.js` with:

```js
const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..');
const read=n=>fs.readFileSync(path.join(root,n),'utf8');
const page=read('draftSales.html'), pos=read('pos.html'), js=read('javascript.html'), draft=read('DraftSales.gs');

assert.match(page,/function draftSalesDelete_/);
assert.match(page,/typeof confirmAction\s*===\s*['"]function['"]/);
assert.match(page,/confirmDelete\s*\(/);
assert.match(js,/successMessage/);
assert.match(pos,/Reload Latest/);
assert.match(pos,/function posShowDraftConflict_/);
assert.match(pos,/function posReloadDraftLatest_/);
assert.match(draft,/deleteSalesDraft[\s\S]*expectedVersion/);
assert.match(draft,/deleteSalesDraft[\s\S]*DELETED/);
console.log('PASS draft delete/conflict contract');
```

- [ ] **Step 2: Run RED**

Run:

```bash
node tests/draft_sales_regression.test.js
```

Expected: FAIL because delete/conflict compatibility is unfinished.

- [ ] **Step 3: Make current shared delete modal accept draft-specific success copy**

Change the shared success toast from a hard-coded stock/balance sentence to:

```js
showToast(deleteCtx_.successMessage || 'Deleted. Stock and balances have been reversed.', 'success');
```

No existing caller changes behavior unless it supplies `successMessage`.

- [ ] **Step 4: Implement delete with future global-confirmation compatibility**

`draftSalesDelete_(row)` must prefer the approved global confirmation service when present:

```js
function draftSalesDelete_(row) {
  var summary = 'Draft: ' + escapeHtml(row.draftNo) + '<br>Customer: ' +
    escapeHtml(row.customerName || 'Not selected') + '<br>Amount: ' + formatMoney(row.grandTotal);

  if (typeof confirmAction === 'function') {
    confirmAction({
      type: 'danger',
      title: 'Delete Draft?',
      message: 'This removes the unfinished draft only. No posted sale or accounting entry exists.',
      details: [
        { label: 'Draft', value: row.draftNo },
        { label: 'Customer', value: row.customerName || 'Not selected' },
        { label: 'Amount', value: formatMoney(row.grandTotal) }
      ],
      confirmLabel: 'Delete Draft',
      cancelLabel: 'Cancel',
      reason: { required: true, label: 'Reason', placeholder: 'Why are you deleting this draft?' }
    }).then(function (result) {
      if (!result || !result.confirmed) return;
      return withLoader(serverCall('deleteSalesDraft', authToken, row.draftId, row.version, result.reason))
        .then(function () { showToast('Draft deleted.', 'success'); return draftSalesLoad(); });
    }).catch(function (err) { showToast(err.message, 'error'); });
    return;
  }

  confirmDelete({
    title: 'Delete Draft?',
    summary: summary + '<br><br>This removes the unfinished draft only. No posted sale or accounting entry exists.',
    fn: 'deleteSalesDraft',
    args: [row.draftId, row.version],
    reloadPages: ['draftSales'],
    successMessage: 'Draft deleted.'
  });
}
```

This avoids adding a draft-only native `confirm()` and automatically upgrades to `confirmAction` after the separately approved confirmation system lands.

- [ ] **Step 5: Implement explicit stale-version recovery without losing local edits**

When Save/Update or Complete Sale returns exactly:

```text
This draft was changed by another user. Reload the latest version.
```

show a persistent conflict strip in POS containing:

```text
This draft changed on another screen.
[Reload Latest] [Keep My Screen]
```

`Reload Latest` calls `getSalesDraft` and `posRestoreDraft_`; `Keep My Screen` hides the strip and performs no server write. Do not auto-reload and destroy the user's local edits.

- [ ] **Step 6: Finalize Exit Draft behavior**

`Exit Draft` clears only local draft mode and resets the POS to a clean sale screen. It does not call `deleteSalesDraft` and does not update the stored row.

Ensure invoice-update mode and draft-edit mode are mutually exclusive; entering one must clear the other mode's banner/state.

- [ ] **Step 7: Run GREEN + confirmation regressions**

Run:

```bash
node tests/draft_sales_regression.test.js
node tests/pre_correction_native_actions.test.js
node tests/counter_acceptance.test.js
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add javascript.html draftSales.html pos.html style.html tests/draft_sales_regression.test.js
git commit -m "feat: harden draft deletion and conflict recovery"
```

---

### Task 7: Full invariant regression, documentation, syntax/reference checks, and runtime acceptance checklist

**Files:**
- Modify: `PROJECT.md`
- Modify: `docs/superpowers/specs/2026-09-05-draft-invoice-design.md` only if implementation names differ from this plan; behavioral requirements must not be weakened.
- Test: all new draft tests plus existing adjacent tests.

**Interfaces:**
- Consumes: all Tasks 1-6.
- Produces: documented final lifecycle and a verified static build ready for Apps Script runtime testing.

- [ ] **Step 1: Add an accounting-boundary regression test section**

In `tests/draft_sales_regression.test.js`, assert the bodies of `saveSalesDraft`, `updateSalesDraft`, and `deleteSalesDraft` contain none of these writer/session calls:

```js
const forbidden = [
  'completeSale(', 'applyStockConsumption_(', 'addCashBookEntry_(',
  'addBankBookEntry_(', 'postVendorLedgerEntry_(', 'requireActiveCashSession_('
];
```

Also assert `draftSales.html` has no action whose visible label is Post and no server call to `completeSale`.

- [ ] **Step 2: Document final production behavior in `PROJECT.md`**

Add a Draft Invoice section containing these exact invariants:

```text
Draft is temporary working data, not a financial transaction.
Draft save/update/delete never changes stock, cash, bank, ledgers, customer due, vendor due, Day Book, or reports.
Drafts do not reserve stock.
Drafts use DRF technical IDs and DRAFT-YYYY-NNNN display numbers.
Posting always re-enters the ordinary completeSale path.
SALES.Source Draft ID prevents one draft from creating more than one real sale.
Posted-draft audit authorizes retry even after active draft cleanup.
Saved exact line totals reopen in fixed mode; editing quantity/price leaves fixed mode.
```

Document permission behavior without role names.

- [ ] **Step 3: Run every new draft test**

Run:

```bash
node tests/draft_sales_server.test.js
node tests/draft_sales_navigation.test.js
node tests/draft_sales_pos.test.js
node tests/draft_sales_conversion.test.js
node tests/draft_sales_invoice.test.js
node tests/draft_sales_regression.test.js
```

Expected: all PASS.

- [ ] **Step 4: Run adjacent financial/UI regressions**

Run:

```bash
node tests/deep_review_regressions.test.js
node tests/lot_selling_price.test.js
node tests/pre_correction_native_actions.test.js
node tests/compact_pos_mockup.test.js
node tests/mobile_pwa_ui.test.js
node tests/sidebar_grouped_collapse.test.js
node tests/counter_acceptance.test.js
node tests/counter_navigation.test.js
node tests/party_ledger_workspace.test.js
node tests/settlement_discount.test.js
```

Expected: all PASS.

- [ ] **Step 5: Syntax-check every Apps Script file**

Run:

```bash
rm -rf /tmp/shererp-gscheck && mkdir -p /tmp/shererp-gscheck
for f in *.gs; do cp "$f" "/tmp/shererp-gscheck/${f%.gs}.js"; done
for f in /tmp/shererp-gscheck/*.js; do node --check "$f" || exit 1; done
```

Expected: no syntax errors.

- [ ] **Step 6: Syntax-check embedded client scripts**

Run:

```bash
rm -rf /tmp/shererp-htmlcheck && mkdir -p /tmp/shererp-htmlcheck
python - <<'PYHTML'
from pathlib import Path
import re
out=Path('/tmp/shererp-htmlcheck')
for src in Path('.').glob('*.html'):
    text=src.read_text()
    blocks=re.findall(r'<script(?:\s[^>]*)?>([\s\S]*?)</script>',text,re.I)
    for i,block in enumerate(blocks):
        if '<?' in block:
            continue
        (out/f'{src.stem}-{i}.js').write_text(block)
PYHTML
for f in /tmp/shererp-htmlcheck/*.js; do node --check "$f" || exit 1; done
```

Expected: no syntax errors.

- [ ] **Step 7: Perform static reference checks**

Run:

```bash
rg -n "serverCall\('(?:saveSalesDraft|updateSalesDraft|getSalesDraft|getSalesDraftList|getSalesDraftPreview|deleteSalesDraft|completeSale)'" *.html javascript.html
rg -n "function (saveSalesDraft|updateSalesDraft|getSalesDraft|getSalesDraftList|getSalesDraftPreview|deleteSalesDraft|completeSale)\(" *.gs
rg -n "Source Draft ID|SALES_DRAFTS|SALES_DRAFT_AUDIT|DRAFT_INVOICE_COUNTER_" Config.gs DraftSales.gs Sales.gs
```

Verify every client endpoint has exactly one intended global server function and private helpers retain trailing underscores.

- [ ] **Step 8: Execute real Apps Script runtime acceptance before production sign-off**

On a copy of the production spreadsheet/web app:

```text
1. Run Setup / Repair System and confirm Draft Invoices + Draft Invoice Audit sheets and SALES.Source Draft ID appear without damaging existing rows.
2. Cashier: save a draft with no open cash session, blank customer, one product. Confirm no Sales/Sale Items/Stock Movement/Cash/Bank/Ledger row changes.
3. Reopen it after changing stock and selling price. Confirm current stock refreshes but saved price and exact line total do not change.
4. Use Reset to Lot Price and confirm only that line adopts current pricing.
5. Open the same draft on two sessions; save B, then save stale A. Confirm A is rejected and B remains intact.
6. Post a valid draft with an open cash session. Confirm one sale, one source-draft link, correct stock/cash/bank/due effects, POSTED audit, and active draft removal.
7. Replay the same final conversion request after cleanup. Confirm the existing invoice is returned and no second stock/cash/bank/ledger effect appears.
8. Force a cleanup failure after sale write. Confirm the sale returns success, Source Draft ID is present, and retry performs cleanup without reposting.
9. Preview/print A4, thermal, and JPG. Confirm DRAFT / খসড়া is visible, no INV number is allocated, and Paid badge is absent.
10. Verify manager-like `sales.edit` user can manage all drafts; cashier sees only own; user with neither `pos.add` nor `sales.edit` cannot access Draft Invoices.
```

Do not mark runtime acceptance complete until these are observed on real Apps Script/Sheets.

- [ ] **Step 9: Commit documentation and final test adjustments**

```bash
git add PROJECT.md docs/superpowers/specs/2026-09-05-draft-invoice-design.md tests/draft_sales_*.test.js
git commit -m "docs: finalize draft invoice workflow and verification"
```

---

## Completion Gate

The feature is ready for release only when:

- all six draft-specific Node tests pass;
- all listed adjacent regressions pass;
- `.gs` and embedded client JavaScript syntax checks pass;
- ordinary POS sales without `sourceDraftId` remain unchanged;
- Save/Update/Delete Draft have zero financial/stock effect;
- stale versions fail before mutation;
- one source draft cannot produce two sales;
- exact saved line totals survive reopen/post without one-poisha drift;
- Draft list has no Post action;
- DRAFT / খসড়া appears in screen, A4/PDF, thermal, and JPG outputs;
- the real Apps Script runtime acceptance checklist has been completed.
