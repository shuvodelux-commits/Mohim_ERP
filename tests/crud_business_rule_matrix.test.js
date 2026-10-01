const fs = require('fs');
const assert = require('assert');

const files = fs.readdirSync('.').filter(f => f.endsWith('.gs')).sort();
const funcs = new Map();

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const starts = [];
  let m;
  const re = /^function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm;
  while ((m = re.exec(text))) starts.push({ name: m[1], start: m.index });
  starts.forEach((entry, i) => {
    funcs.set(entry.name, {
      file,
      body: text.slice(entry.start, i + 1 < starts.length ? starts[i + 1].start : text.length)
    });
  });
}

function reachableBodies(root) {
  const seen = new Set();
  const bodies = [];
  function visit(name) {
    if (seen.has(name)) return;
    seen.add(name);
    const meta = funcs.get(name);
    if (!meta) return;
    bodies.push({ name, ...meta });
    for (const call of meta.body.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
      if (funcs.has(call[1])) visit(call[1]);
    }
  }
  visit(root);
  return bodies;
}

function reaches(root, re) {
  return reachableBodies(root).some(meta => re.test(meta.body));
}

const authGuard = /(?:requirePermission_|requireAdmin_|requireDeletePermission_|requireManagementDeletePermission_|requireSalesDraftFeatureAccess_|getSessionUser_|requireRoleAction_|requireSalesDraftAccess_)/;
const scriptLock = /LockService\.getScriptLock\s*\(/;
const activeCash = /requireActiveCashSession_\s*\(/;
const repoWrite = /\b(?:appendRow_|updateRow_|updateRowFields_|deleteRow_|softDeleteRow_|markRowDeleted_|markMatchingDeleted_|addCashBookEntry_|addBankBookEntry_)\s*\(/;

// High-risk CRUD/money/stock operations must be serialized and authorized.
// These are the operations where partial writes or unauthorized access can alter
// accounting, stock, or a posted transaction.
const critical = [
  'completeSale', 'updateSale', 'deleteSalesInvoice',
  'createPurchase', 'updatePurchase', 'deletePurchase',
  'completeReturn', 'completePurchaseReturn',
  'receivePayment', 'updateCustomerPayment', 'deleteCustomerPayment',
  'paySupplier', 'updateSupplierPayment', 'deleteSupplierPayment',
  'addExpense', 'updateExpense', 'cancelExpense', 'deleteExpense',
  'addFinanceTransaction', 'updateFinanceTransaction', 'deleteFinanceTransaction',
  'transferBetweenBankAccounts', 'addBankManualEntry', 'reverseBankEntry', 'deleteBankTransaction',
  'payVendor', 'receiveVendorPayment', 'returnProductsToVendor', 'giveProductsToVendor', 'receiveProductsFromVendor',
  'updateVendorPayment', 'deleteVendorPayment', 'updateVendorReturn', 'deleteVendorReturn',
  'updateVendorSourcing', 'deleteVendorSourcing', 'updateVendorIssue', 'deleteVendorIssue',
  'updateVendorReturnReceived', 'deleteVendorReturnReceived',
  'adjustStock', 'startCashSession', 'closeCashSession'
];

const missing = critical.filter(name => !funcs.has(name));
assert.deepStrictEqual(missing, [], 'Critical RPC inventory changed; review matrix: ' + missing.join(', '));

for (const name of critical) {
  assert.ok(reaches(name, authGuard), `${name}: must reach server-side authorization`);
  assert.ok(reaches(name, scriptLock), `${name}: must reach ScriptLock before a multi-row financial/stock mutation`);
  assert.ok(reaches(name, repoWrite), `${name}: expected repository mutation not found; review matrix`);
}

// Posted operational money/stock mutations require an open cash day. Opening
// and closing the cash day are the two deliberate exceptions.
const cashGuarded = critical.filter(name => !['startCashSession', 'closeCashSession'].includes(name));
for (const name of cashGuarded) {
  assert.ok(reaches(name, activeCash), `${name}: must require an active cash session`);
}

// Cash-session lifecycle itself must not recursively require an already-open day.
assert.ok(!reaches('startCashSession', activeCash), 'startCashSession must be able to open the first session');
assert.ok(!reaches('closeCashSession', activeCash), 'closeCashSession uses the active-session lookup, not the normal posting guard');

// Core posted-document deletion rules must retain native dependency checks so a
// parent cannot disappear while an active return still points at it.
const deleteSale = funcs.get('deleteSalesInvoice').body;
assert.match(deleteSale, /activeRows_\(['"]SALES_RETURN['"]\)/, 'Sales delete must block when an active sales return exists');
const deletePurchase = funcs.get('deletePurchase').body;
assert.match(deletePurchase, /activeRows_\(['"]PURCHASE_RETURN['"]\)/, 'Purchase delete must block when an active purchase return exists');

// Negative-stock and stock-adjustment invariants that exist in this build.
const salesText = fs.readFileSync('Sales.gs', 'utf8');
assert.match(salesText, /negative stock|OVERSOLD|oversold/i, 'Sales must retain explicit negative/oversold handling');
const productText = fs.readFileSync('Products.gs', 'utf8');
assert.match(productText, /adjustStock/, 'Product stock adjustment endpoint missing');

console.log(`crud_business_rule_matrix: PASS (${critical.length} critical mutation paths audited)`);
