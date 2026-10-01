'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

function fnSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `missing function ${name}`);
  let brace = source.indexOf('{', start);
  assert(brace >= 0, `missing opening brace for ${name}`);
  let depth = 0;
  let quote = null;
  let escape = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i], next = source[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated function ${name}`);
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// ---------- Task 1: return safety ----------
test('sales return rejects deleted parent in search/get/complete', () => {
  const s = read('SalesReturn.gs');
  assert.ok(/activeRows_\(['"]SALES['"]\)/.test(fnSource(s, 'searchInvoicesForReturn')) || /!isDeleted_\(s\)/.test(fnSource(s, 'searchInvoicesForReturn')), 'sales return search must exclude soft-deleted sales');
  assert.match(fnSource(s, 'getInvoiceForReturn'), /isDeleted_\(sale\)/);
  assert.match(fnSource(s, 'prepareSalesReturn_'), /isDeleted_\(sale\)/);
});

test('purchase return rejects deleted parent in search/get/complete', () => {
  const s = read('PurchaseReturn.gs');
  assert.match(fnSource(s, 'searchPurchasesForReturn'), /!isDeleted_\(p\)/);
  assert.match(fnSource(s, 'getPurchaseForReturn'), /isDeleted_\(purchase\)/);
  assert.match(fnSource(s, 'completePurchaseReturn'), /isDeleted_\(purchase\)/);
});

test('return endpoints reject duplicate product payloads', () => {
  assert.match(fnSource(read('SalesReturn.gs'), 'prepareSalesReturn_'), /Duplicate product|appears more than once/i);
  assert.match(fnSource(read('PurchaseReturn.gs'), 'completePurchaseReturn'), /Duplicate product|appears more than once/i);
});

test('sales return amount is server-authoritative and discounted once', () => {
  const source = read('SalesReturn.gs');
  const body = fnSource(source, 'prepareSalesReturn_');
  assert.doesNotMatch(body, /Number\(item\.unitPrice\)/);
  assert.match(body, /effectiveTransactionUnitPrice_/);
  assert.match(body, /maxCashRefund|cashRefund/i);
  assert.match(fnSource(source, 'completeReturn'), /prepareSalesReturn_/);
});

test('purchase return amount is server-authoritative', () => {
  const body = fnSource(read('PurchaseReturn.gs'), 'completePurchaseReturn');
  assert.doesNotMatch(body, /Number\(item\.unitPrice\)/);
  assert.match(body, /effectiveTransactionUnitPrice_|returnUnitPrice|weighted/i);
});

test('sales return allows bounded requested price while purchase return remains server-authoritative', () => {
  const salesUi = read('returns.html');
  const salesPrepare = fnSource(read('SalesReturn.gs'), 'prepareSalesReturn_');
  assert.match(salesUi, /data-f="price"/);
  assert.match(salesUi, /price:\s*Number\(item\._returnPrice\)/);
  assert.match(salesPrepare, /salesReturnRequestedUnitPrice_\(item\.price, effectiveUnitPrice/);
  assert.match(fnSource(read('SalesReturn.gs'), 'salesReturnRequestedUnitPrice_'), /cannot exceed original sale price/);

  const purchaseUi = read('purchase.html');
  assert.doesNotMatch(fnSource(purchaseUi, 'prtRenderCart_'), /data-f=["']price/);
  assert.doesNotMatch(purchaseUi, /unitPrice:\s*\n?\s*item\._returnPrice/);
});

// ---------- Task 2: purchase lots ----------
test('new purchase and purchase edit reject duplicate products', () => {
  assert.match(fnSource(read('Purchase.gs'), 'createPurchase'), /appears more than once|Duplicate product/i);
  assert.match(fnSource(read('PurchaseManagement.gs'), 'updatePurchaseInternal_'), /appears more than once|Duplicate product/i);
});

test('purchase return plans lot mutation before first write', () => {
  const stock = read('StockLots.gs');
  assert.match(stock, /function planPurchaseReturnLotReduction_\(/);
  assert.match(stock, /function applyPurchaseReturnLotReduction_\(/);
  const body = fnSource(read('PurchaseReturn.gs'), 'completePurchaseReturn');
  const planAt = body.indexOf('planPurchaseReturnLotReduction_');
  const firstWriteCandidates = [
    body.indexOf("appendRow_('PURCHASE_RETURN'"),
    body.indexOf("updateRowFields_('PRODUCTS'"),
    body.indexOf("appendRows_('PURCHASE_RETURN_ITEMS'")
  ].filter(i => i >= 0);
  assert(planAt >= 0, 'purchase return missing lot plan');
  assert(firstWriteCandidates.length, 'could not locate purchase return write');
  assert(planAt < Math.min(...firstWriteCandidates), 'lot plan must happen before first write');
});

test('purchase management blocks consumed-lot cost edits and updates unconsumed lot price', () => {
  const body = fnSource(read('PurchaseManagement.gs'), 'updatePurchaseInternal_');
  assert.match(body, /Purchase Price/);
  assert.match(body, /consumed|already been sold|cannot.*price/i);
});

test('purchase deletion handles all matching lots instead of one lot per product', () => {
  const body = fnSource(read('DeleteEngine.gs'), 'deletePurchase');
  assert.match(body, /lotsByProduct|lotListByProduct|lotsForProduct/i);
  assert.doesNotMatch(body, /lotByProduct\[l\['Product ID'\]\]\s*=\s*l/);
});

// ---------- Task 3: reports/dates ----------
test('shared effective unit price helper applies invoice discount exactly once', () => {
  const utils = read('Utils.gs');
  const src = fnSource(utils, 'effectiveTransactionUnitPrice_');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  assert.strictEqual(ctx.effectiveTransactionUnitPrice_(100, 1000, 800), 80);
  assert.strictEqual(ctx.effectiveTransactionUnitPrice_(100, 0, 0), 100);
});

test('sales report and profit use stored economic return line totals without double discount', () => {
  const reports = read('Reports.gs');
  const sales = fnSource(reports, 'getSalesReport');
  const profit = fnSource(reports, 'computeProfit_');
  assert.match(sales, /economicReturnLineAmount_/);
  assert.match(profit, /economicReturnLineAmount_/);
  assert.match(profit, /const scaled = economicReturnLineAmount_/);
});

test('expense update cannot move a posted expense to another date', () => {
  const body = fnSource(read('Expense.gs'), 'updateExpense');
  assert.match(body, /date cannot be changed|posted expense date|cannot change.*date/i);
});

test('bank cash deposit/withdraw contra cash entries use resolved transaction date', () => {
  const body = fnSource(read('BankLedger.gs'), 'addBankManualEntry');
  const contraAt = body.indexOf("if (type.contra === 'cash')");
  assert(contraAt >= 0, 'expected cash contra branch');
  const contra = body.slice(contraAt, body.indexOf('return ok_', contraAt));
  assert.match(contra, /addCashBookEntry_/);
  assert.match(contra, /Date:\s*txDate\.dateStr/);
});

test('editable ledger transactions route requested dates through resolveTransactionDate_', () => {
  const src = read('DeleteEngine.gs');
  [
    'updateSupplierPayment','updateCustomerPayment','updateFinanceTransaction','updateVendorPayment',
    'updateVendorReturn','updateVendorSourcing','updateVendorIssue','updateVendorReceipt','updateVendorReturnReceived'
  ].forEach(name => {
    const body = fnSource(src, name);
    assert.match(body, /resolveEditedTransactionDate_\(/, `${name} must authorize requested date changes`);
  });
});

// ---------- Task 4: auth/hardening ----------
test('inactive roles fail closed in auth permission resolution', () => {
  const src = read('Auth.gs');
  const perms = fnSource(src, 'getUserPermissions_');
  assert.match(perms, /Status/);
  assert.match(perms, /Active/);
});

test('user create/update refuses inactive roles', () => {
  const src = read('UserManagement.gs');
  assert.match(fnSource(src, 'createUser'), /roleRow\['Status'\].*Active|Status.*Active/s);
  assert.match(fnSource(src, 'updateUser'), /roleRow\['Status'\].*Active|Status.*Active/s);
});

test('deactivating a role revokes affected user sessions', () => {
  const body = fnSource(read('RoleManagement.gs'), 'setRoleStatus');
  assert.match(body, /revokeUserSessions_/);
});

test('soft-delete diagnostics are private from google.script.run', () => {
  const src = read('Diagnostics.gs');
  assert.match(src, /function checkDeleteColumns_\(/);
  assert.doesNotMatch(src, /function checkDeleteColumns\(/);
});

test('dashboard and stock report exclude soft-deleted products', () => {
  assert.match(fnSource(read('Dashboard.gs'), 'getDashboardStats'), /activeRows_\(['"]PRODUCTS['"]\)/);
  assert.match(fnSource(read('Reports.gs'), 'getStockReport'), /activeRows_\(['"]PRODUCTS['"]\)/);
});



test('new money transactions reject inactive customer supplier and vendor masters', () => {
  assert.match(fnSource(read('Customer.gs'), 'receivePayment'), /Status.*Inactive|inactive.*Customer/is);
  assert.match(fnSource(read('Suppliers.gs'), 'paySupplier'), /Status.*Inactive|inactive.*Supplier/is);
  assert.match(fnSource(read('Purchase.gs'), 'createPurchase'), /supplierRow.*Status.*Inactive|Status.*Inactive.*supplier/is);
  assert.match(fnSource(read('Vendors.gs'), 'payVendor'), /Status.*Inactive|inactive.*Vendor/is);
  assert.match(fnSource(read('Vendors.gs'), 'receiveVendorPayment'), /Status.*Inactive|inactive.*Vendor/is);
});

test('POS vendor sourcing refuses inactive vendors server-side', () => {
  assert.match(fnSource(read('Sales.gs'), 'completeSale'), /vendorRow.*Status.*Inactive|Status.*Inactive.*vendor/is);
});

test('quick customer resolution does not silently reuse inactive customer', () => {
  assert.match(fnSource(read('Customer.gs'), 'resolveOrCreateCustomer_'), /Status.*Inactive|inactive.*customer/is);
});



test('login throttles repeated failed password attempts', () => {
  const src = read('Auth.gs');
  const login = fnSource(src, 'login');
  assert.match(src, /function checkLoginThrottle_\(/);
  assert.match(src, /function recordLoginFailure_\(/);
  assert.match(src, /function clearLoginFailures_\(/);
  assert.match(login, /checkLoginThrottle_/);
  assert.match(login, /recordLoginFailure_/);
  assert.match(login, /clearLoginFailures_/);
});

test('new and reset passwords require at least eight characters', () => {
  const src = read('UserManagement.gs');
  assert.match(fnSource(src, 'createUser'), /length\s*<\s*8/);
  assert.match(fnSource(src, 'resetPassword'), /length\s*<\s*8/);
  assert.doesNotMatch(fnSource(src, 'createFirstAdmin_'), /6 characters/i);
  assert.doesNotMatch(read('users.html'), /6 characters/i);
});



test('purchase return lot planner spans historical duplicate lots and rejects insufficiency before writes', () => {
  const stock = read('StockLots.gs');
  const ctx = {
    safeDateOnly_: (v) => String(v || ''),
    getAllRows_: () => { throw new Error('unexpected sheet read'); },
    planStockConsumption_: () => { throw new Error('unexpected legacy fallback'); }
  };
  vm.createContext(ctx);
  vm.runInContext(fnSource(stock, 'compareLotsFifo_'), ctx);
  vm.runInContext(fnSource(stock, 'planPurchaseReturnLotReduction_'), ctx);
  const lots = [
    {'Purchase ID':'PO-1','Product ID':'P1','Lot ID':'L1','Purchase Date':'2026-01-01','Remaining Quantity':2,'Purchase Price':10,_rowIndex:2},
    {'Purchase ID':'PO-1','Product ID':'P1','Lot ID':'L2','Purchase Date':'2026-01-02','Remaining Quantity':3,'Purchase Price':11,_rowIndex:3}
  ];
  const plan = ctx.planPurchaseReturnLotReduction_('PO-1','P1',4,lots);
  assert.deepStrictEqual(Array.from(plan.draws, d => d.take), [2,2]);
  assert.throws(() => ctx.planPurchaseReturnLotReduction_('PO-1','P1',6,lots), /only have 5 remaining/i);
});

test('sales return validates stock target and store-credit customer before writing return header', () => {
  const source = read('SalesReturn.gs');
  const prepare = fnSource(source, 'prepareSalesReturn_');
  const commit = fnSource(source, 'commitPreparedSalesReturn_');
  assert.match(prepare, /productsById|product.*no longer exists/i);
  assert.match(prepare, /creditCustomer|Customer.*inactive|custRow/i);
  assert.match(commit, /appendRow_\('SALES_RETURN'/);
  assert.doesNotMatch(prepare, /appendRow_|appendRows_|updateRowFields_|addCashBookEntry_|restoreStockToLots_/);
});



test('sale edit derives prior own-stock consumption from SALE_ITEM_LOTS, not mutable vendor sourcing quantity', () => {
  const body = fnSource(read('SalesManagement.gs'), 'updateSaleInternal_');
  assert.match(body, /SALE_ITEM_LOTS/);
  assert.match(body, /oldOwnQtyByKey|consumedByProduct|ownQtyByProduct/);
  assert.doesNotMatch(body, /const oldOwnQty\s*=\s*oldQty\s*-\s*oldVendorQty/);
});



test('operational return calculations ignore child rows whose return header is deleted', () => {
  const utils = read('Utils.gs');
  assert.match(utils, /function activeSalesReturnItems_\(/);
  assert.match(utils, /function activePurchaseReturnItems_\(/);
  assert.match(fnSource(read('Reports.gs'), 'getSalesReport'), /activeSalesReturnItems_/);
  assert.match(fnSource(read('Reports.gs'), 'getPurchaseReport'), /activePurchaseReturnItems_/);
  assert.match(fnSource(read('Reports.gs'), 'computeProfit_'), /activeSalesReturnItems_/);
  assert.match(fnSource(read('SalesManagement.gs'), 'updateSaleInternal_'), /activeSalesReturnItems_/);
});

test('sales management uses the shared economic return amount', () => {
  const src = read('SalesManagement.gs');
  assert.match(fnSource(src, 'getSalesManagementList'), /economicReturnLineAmount_/);
  assert.match(fnSource(src, 'getSaleDetail'), /economicReturnLineAmount_/);
});



test('edited transaction date authorization happens before the first mutation', () => {
  const src = read('DeleteEngine.gs');
  const names = [
    'updateSupplierPayment','updateCustomerPayment','updateFinanceTransaction','updateVendorPayment',
    'updateVendorReturn','updateVendorSourcing','updateVendorIssue','updateVendorReceipt','updateVendorReturnReceived'
  ];
  const mutationTokens = [
    'updateRowFields_(', 'appendRow_(', 'appendRows_(', 'adjustVendorDue_(', 'adjustVendorReceivable_(',
    'adjustSupplierDue_(', 'adjustCustomerDue_(', 'markMatchingDeleted_(', 'voidBankEntriesFor_(',
    'reverseVendorReturnStockAndDue_(', 'reverseVendorIssueStockAndReceivable_(',
    'reverseVendorReturnReceivedStockAndReceivable_(', 'applyStockConsumption_('
  ];
  names.forEach(name => {
    const body = fnSource(src, name);
    const dateAt = body.indexOf('resolveEditedTransactionDate_(');
    assert(dateAt >= 0, `${name} missing edited-date authorization`);
    const writes = mutationTokens.map(t => body.indexOf(t)).filter(i => i >= 0);
    assert(writes.length, `${name} has no detected mutation`);
    assert(dateAt < Math.min(...writes), `${name} authorizes date after a mutation`);
  });
});

test('vendor stock edits validate and apply only the quantity delta instead of reversing old stock first', () => {
  const src = read('DeleteEngine.gs');
  const ret = fnSource(src, 'updateVendorReturn');
  const issue = fnSource(src, 'updateVendorIssue');
  const received = fnSource(src, 'updateVendorReturnReceived');
  [ret, issue, received].forEach(body => assert.match(body, /stockDelta|qtyDelta|deltaQty/));
  assert.doesNotMatch(ret, /reverseVendorReturnStockAndDue_\(/);
  assert.doesNotMatch(issue, /reverseVendorIssueStockAndReceivable_\(/);
  assert.doesNotMatch(received, /reverseVendorReturnReceivedStockAndReceivable_\(/);
});



test('native sale edit keeps financial adjustment rows on the original invoice business date', () => {
  const body = fnSource(read('SalesManagement.gs'), 'updateSaleInternal_');
  assert.match(body, /const originalDate\s*=\s*safeDateOnly_\(sale\['Date'\]\)/);
  assert.match(body, /const editDate\s*=\s*originalDate/);
  assert.doesNotMatch(body, /correctionMode|resolveCorrectionBusinessDate_/);
  const cashCalls = body.match(/addCashBookEntry_\(\{[^\n]*Sale Update[^\n]*\}\);/g) || [];
  assert(cashCalls.length >= 2, 'expected native cash sale-update adjustment rows');
  cashCalls.forEach(call => assert.match(call, /Date:\s*editDate/));
  const bankLines = body.split('\n').filter(line => line.includes("addBankBookEntry_") && line.includes("Sale Update"));
  assert(bankLines.length >= 4, 'expected native bank sale-update adjustment rows');
  bankLines.forEach(line => assert.match(line, /Date:\s*editDate/));
});



test('backdated sale and purchase dues post customer/supplier ledgers on the transaction date', () => {
  const sale = fnSource(read('Sales.gs'), 'completeSale');
  const purchase = fnSource(read('Purchase.gs'), 'createPurchase');
  const saleLedger = sale.slice(sale.indexOf("appendRow_('CUSTOMER_LEDGER'"));
  const purchaseLedger = purchase.slice(purchase.indexOf("appendRow_('SUPPLIER_LEDGER'"));
  assert.match(saleLedger, /'Date':\s*dateStr/);
  assert.match(saleLedger, /'Created At':\s*now/);
  assert.match(purchaseLedger, /'Date':\s*dateStr/);
  assert.match(purchaseLedger, /'Created At':\s*now/);
});

let failed = 0;
for (const t of tests) {
  try {
    t.fn();
    console.log(`PASS ${t.name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL ${t.name}`);
    console.error(`  ${err.message}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);