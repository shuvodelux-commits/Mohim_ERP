'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
let passed = 0, failed = 0;
function test(name, run) {
  try { run(); passed++; console.log('PASS', name); }
  catch (error) { failed++; console.error('FAIL', name, error.stack); }
}

// Only Sheets persistence, session authorization, and date services are replaced.
// Transaction handlers, FIFO lots, discount rules, cash/bank writers and reversals
// all run their production implementation against independent row snapshots.
function fixture() {
  const sheets = {}, counters = {};
  let locked = false, writes = 0, sessionOpen = true;
  const copy = value => structuredClone(value);
  const rows = key => sheets[key] || (sheets[key] = []);
  const actor = { 'Full Name': 'Audit Staff' };
  const ctx = { console, CONFIG: { LOCK_TIMEOUT_MS: 1 },
    LockService: { getScriptLock: () => ({
      waitLock() { assert.equal(locked, false, 'nested lock'); locked = true; },
      releaseLock() { locked = false; }
    }) },
    getAllRows_: key => rows(key).map((row, i) => ({ ...copy(row), _rowIndex: i + 2 })),
    findRowIndex_: (key, col, value) => { const i = rows(key).findIndex(row => row[col] === value); return i < 0 ? -1 : i + 2; },
    findFirstRow_: (key, col, value) => ctx.getAllRows_(key).find(row => row[col] === value),
    appendRow_: (key, row) => { assert(locked, 'write without lock'); writes++; rows(key).push(copy(row)); return rows(key).length + 1; },
    appendRows_: (key, batch) => batch.forEach(row => ctx.appendRow_(key, row)),
    updateRowFields_: (key, index, fields) => { assert(locked, 'write without lock'); assert(rows(key)[index - 2], key + ' missing row'); writes++; Object.assign(rows(key)[index - 2], copy(fields)); },
    deleteRow_: (key, index) => { assert(locked); writes++; rows(key).splice(index - 2, 1); },
    requirePermission_: () => actor, requireDeletePermission_: () => actor,
    getSessionUser_: () => actor, actorName_: user => user['Full Name'],
    requireActiveCashSession_: () => { if (!sessionOpen) throw Error('Start your cash session first'); return {}; },
    logError_: () => {}, logDeletion_: () => {},
    getSettingsMap_: () => ({}), invalidateDerivedCachesForSheet_: () => {}
  };
  vm.createContext(ctx);
  for (const file of ['Utils.gs', 'DeleteEngine.gs', 'StockLots.gs', 'SettlementDiscount.gs', 'CustomerSettlement.gs', 'SupplierSettlement.gs', 'CashBook.gs', 'BankBook.gs', 'Purchase.gs', 'PurchaseManagement.gs', 'PurchaseReturn.gs', 'Customer.gs', 'Suppliers.gs', 'Expense.gs', 'FinanceModule.gs', 'Vendors.gs']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file });
  }
  Object.assign(ctx, {
    logError_: () => {},
    generateId_: key => key + '-' + (counters[key] = (counters[key] || 0) + 1),
    safeDateOnly_: value => value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10),
    formatDate_: () => '2026-09-05',
    resolveTransactionDate_: () => ({ dateStr: '2026-09-05', isBackdated: false, backdatedDays: 0, reason: '' }),
    resolveEditedTransactionDate_: (token, module, requested, original) => requested || original,
    computeBackdateInfo_: () => ({ isBackdated: false, backdatedDays: 0 }),
    ledgerSortKey_: row => String(row.Date || '').slice(0, 10),
    ok_: data => ({ success: true, data }), fail_: message => ({ success: false, message })
  });
  sheets.PRODUCTS = [{ 'Product ID': 'P1', 'Product Name': 'Rice', 'Current Stock': 0, 'Purchase Price': 10, 'Selling Price': 15, Status: 'Active' }];
  sheets.SUPPLIERS = [
    { 'Supplier ID': 'S1', 'Supplier Name': 'Matador', 'Current Due': 1000, Status: 'Active' },
    { 'Supplier ID': 'S2', 'Supplier Name': 'Karatoa', 'Current Due': 500, Status: 'Active' }
  ];
  sheets.CUSTOMERS = [{ 'Customer ID': 'C1', 'Customer Name': 'Customer', 'Current Due': 1000, Status: 'Active' }];
  sheets.BANK_ACCOUNTS = [{ 'Bank Account ID': 'B1', 'Account Name': 'Bank One', 'Current Balance': 1000, Status: 'Active' }, { 'Bank Account ID': 'B2', 'Account Name': 'Bank Two', 'Current Balance': 500, Status: 'Active' }];
  sheets.EXPENSE_CATEGORIES = [{ 'Category ID': 'EC1', 'Category Name': 'Rent', Status: 'Active' }];
  sheets.EXPENSE_PAYEES = [{ 'Payee ID': 'EP1', 'Payee Name': 'Landlord', Status: 'Active' }];
  sheets.FINANCE_PERSONS = [{ 'Person ID': 'FP1', 'Person Name': 'Owner', Status: 'Active' }];
  sheets.CASH_BOOK = [{ 'Entry ID': 'OPEN', Type: 'Session Open', Credit: 1000, Debit: '', Balance: 1000 }];
  for (const [key, idCol, id] of [['CUSTOMER_LEDGER', 'Customer ID', 'C1'], ['SUPPLIER_LEDGER', 'Supplier ID', 'S1']]) {
    sheets[key] = [{ 'Ledger ID': 'OPEN', [idCol]: id, Date: '2026-09-01', Type: 'Opening Balance', Debit: 1000, Credit: '' }];
  }
  return { ctx, sheets, rows, writes: () => writes, closeSession: () => { sessionOpen = false; } };
}
function success(result) { assert.equal(result.success, true, result.message); return result.data; }
const expense = overrides => ({ categoryId: 'EC1', payeeId: 'EP1', amount: 100, paymentMethod: 'Cash', ...overrides });
const purchase = overrides => ({ supplierId: 'S1', items: [{ productId: 'P1', name: 'Rice', qty: 10, unitPrice: 10, sellingPrice: 15 }], discount: 0, paidAmount: 40, paymentMethod: 'Cash', reason: 'Correction', ...overrides });

test('deleting an earlier expense recalculates cash before the next posting', () => {
  const f = fixture(), c = f.ctx;
  const first = success(c.addExpense('T', expense())).id;
  success(c.addExpense('T', expense({ amount: 50 })));
  success(c.deleteExpense('T', first, 'Duplicate'));
  assert.equal(c.getCashBalance_(), 950);
  success(c.addExpense('T', expense({ amount: 25 })));
  assert.equal(c.getCashBalance_(), 925);
  assert.equal(f.rows('CASH_BOOK').at(-1).Balance, 925);
});

for (const action of ['update', 'cancel']) test('deleted expense rejects stale ' + action + ' without moving money', () => {
  const f = fixture(), c = f.ctx;
  const id = success(c.addExpense('T', expense())).id;
  success(c.deleteExpense('T', id, 'Duplicate'));
  const before = JSON.stringify(f.sheets), count = f.writes();
  const result = action === 'update' ? c.updateExpense('T', id, expense({ amount: 150 })) : c.cancelExpense('T', id, 'Cancel again');
  assert.equal(result.success, false, 'deleted expense was mutated');
  assert.match(result.message, /deleted/i);
  assert.equal(f.writes(), count);
  assert.equal(JSON.stringify(f.sheets), before);
});

test('purchase creation refuses a soft-deleted product before any writes', () => {
  const f = fixture(); f.sheets.PRODUCTS[0]['Is Deleted'] = 'TRUE';
  const result = f.ctx.createPurchase('T', purchase());
  assert.equal(result.success, false, 'deleted product accepted');
  assert.equal(f.writes(), 0);
});

test('price-only purchase edit refuses a missing product before deleting old lines', () => {
  const f = fixture(), c = f.ctx;
  const id = success(c.createPurchase('T', purchase())).purchaseId;
  f.sheets.PRODUCTS = [];
  const before = f.writes();
  const result = c.updatePurchase('T', id, purchase({ paidAmount: 50 }));
  assert.equal(result.success, false, 'missing product accepted when quantity is unchanged');
  assert.equal(f.writes(), before);
});

test('purchase edit moves the purchase, payable and stock-lot provenance to the newly confirmed supplier', () => {
  const f = fixture(), c = f.ctx;
  const id = success(c.createPurchase('T', purchase({ paidAmount: 0 }))).purchaseId;
  assert.equal(f.sheets.PURCHASES[0]['Supplier ID'], 'S1');
  assert.equal(f.sheets.SUPPLIERS[0]['Current Due'], 1100);
  assert.equal(f.sheets.SUPPLIERS[1]['Current Due'], 500);

  success(c.updatePurchase('T', id, purchase({ supplierId: 'S2', paidAmount: 0 })));

  assert.equal(f.sheets.PURCHASES[0]['Supplier ID'], 'S2');
  assert.equal(f.sheets.PURCHASES[0]['Supplier Name'], 'Karatoa');
  assert.equal(f.sheets.SUPPLIERS[0]['Current Due'], 1000);
  assert.equal(f.sheets.SUPPLIERS[1]['Current Due'], 600);
  assert.equal(f.sheets.STOCK_LOTS[0]['Supplier ID'], 'S2');
  assert.equal(f.sheets.STOCK_LOTS[0]['Supplier Name'], 'Karatoa');

  const oldLedger = f.sheets.SUPPLIER_LEDGER.filter(row => row['Supplier ID'] === 'S1' && row.Reference === id);
  const newLedger = f.sheets.SUPPLIER_LEDGER.filter(row => row['Supplier ID'] === 'S2' && row.Reference === id);
  assert.equal(oldLedger.some(row => row.Type === 'Purchase' && Number(row.Debit) === 100), true);
  assert.equal(oldLedger.some(row => row.Type === 'Purchase Update' && Number(row.Credit) === 100), true);
  assert.equal(newLedger.some(row => row.Type === 'Purchase Update' && Number(row.Debit) === 100), true);

  success(c.deletePurchase('T', id, 'Wrong supplier correction cleanup'));
  assert.equal(f.sheets.SUPPLIERS[0]['Current Due'], 1000);
  assert.equal(f.sheets.SUPPLIERS[1]['Current Due'], 500);
  assert.equal(f.sheets.PRODUCTS[0]['Current Stock'], 0);
});

test('purchase create/edit/delete restores stock, lots, supplier due and both payment books', () => {
  const f = fixture(), c = f.ctx;
  const id = success(c.createPurchase('T', purchase())).purchaseId;
  assert.equal(f.sheets.PRODUCTS[0]['Current Stock'], 10);
  assert.equal(f.sheets.SUPPLIERS[0]['Current Due'], 1060);
  assert.equal(c.getCashBalance_(), 960);
  success(c.updatePurchase('T', id, purchase({ items: [{ productId: 'P1', name: 'Rice', qty: 12, unitPrice: 10, sellingPrice: 16 }], paidAmount: 70, paymentMethod: 'Bank', bankAccountId: 'B1' })));
  assert.equal(f.sheets.PRODUCTS[0]['Current Stock'], 12);
  assert.equal(f.sheets.STOCK_LOTS[0]['Remaining Quantity'], 12);
  assert.equal(f.sheets.SUPPLIERS[0]['Current Due'], 1050);
  assert.equal(c.getCashBalance_(), 1000);
  assert.equal(c.getBankBalance_('B1'), 930);
  success(c.deletePurchase('T', id, 'Reverse test'));
  assert.equal(f.sheets.PRODUCTS[0]['Current Stock'], 0);
  assert.equal(f.sheets.STOCK_LOTS[0]['Remaining Quantity'], 0);
  assert.equal(f.sheets.SUPPLIERS[0]['Current Due'], 1000);
  assert.equal(c.getBankBalance_('B1'), 1000);
  assert.equal(c.getCashBalance_(), 1000);
  assert.equal(c.deletePurchase('T', id, 'Again').success, false);
});

for (const party of ['customer', 'supplier']) test(party + ' payment discount survives method edit and reverses exactly once', () => {
  const f = fixture(), c = f.ctx;
  const customer = party === 'customer', sheet = customer ? 'CUSTOMERS' : 'SUPPLIERS', ledger = customer ? 'CUSTOMER_LEDGER' : 'SUPPLIER_LEDGER';
  const create = customer ? c.receivePayment : c.paySupplier;
  success(create('T', customer ? 'C1' : 'S1', 200, 'Cash', '', '', '', '', 50, 'Settlement'));
  const id = f.sheets[ledger].at(-1)['Ledger ID'];
  assert.equal(f.sheets[sheet][0]['Current Due'], 750);
  assert.equal(c.getCashBalance_(), customer ? 1200 : 800);
  success((customer ? c.updateCustomerPayment : c.updateSupplierPayment)('T', id, { amount: 250, discountAmount: 25, discountReason: 'Revised settlement', method: 'Bank', bankAccountId: 'B1' }));
  assert.equal(f.sheets[sheet][0]['Current Due'], 725);
  assert.equal(c.getCashBalance_(), 1000);
  assert.equal(c.getBankBalance_('B1'), customer ? 1250 : 750);
  const remove = customer ? c.deleteCustomerPayment : c.deleteSupplierPayment;
  success(remove('T', id, 'Reverse'));
  assert.equal(f.sheets[sheet][0]['Current Due'], 1000);
  assert.equal(c.getBankBalance_('B1'), 1000);
  assert.equal(remove('T', id, 'Again').success, false);
});

test('finance capital edit from cash to bank and delete restores both books', () => {
  const f = fixture(), c = f.ctx;
  const payload = { transactionType: 'Owner Investment', personId: 'FP1', amount: 300, paymentMethod: 'Cash' };
  const id = success(c.addFinanceTransaction('T', payload)).id;
  success(c.updateFinanceTransaction('T', id, { ...payload, amount: 400, paymentMethod: 'Bank', bankAccountId: 'B1' }));
  assert.equal(c.getOwnerCapital_(), 400);
  assert.equal(c.getCashBalance_(), 1000);
  assert.equal(c.getBankBalance_('B1'), 1400);
  success(c.deleteFinanceTransaction('T', id, 'Reverse'));
  assert.equal(c.getOwnerCapital_(), 0);
  assert.equal(c.getBankBalance_('B1'), 1000);
  assert.equal(c.deleteFinanceTransaction('T', id, 'Again').success, false);
});

test('finance create and edit reject inactive persons and sub-cent amounts before writes', () => {
  const f = fixture(), c = f.ctx;
  f.sheets.FINANCE_PERSONS[0].Status = 'Inactive';
  const inactive = c.addFinanceTransaction('T', {
    transactionType: 'Owner Investment', personId: 'FP1', amount: 10, paymentMethod: 'Cash'
  });
  assert.equal(inactive.success, false);
  assert.match(inactive.message, /inactive/i);
  assert.equal(f.writes(), 0);

  f.sheets.FINANCE_PERSONS[0].Status = 'Active';
  const subCentCreate = c.addFinanceTransaction('T', {
    transactionType: 'Owner Investment', personId: 'FP1', amount: 0.004, paymentMethod: 'Cash'
  });
  assert.equal(subCentCreate.success, false);
  assert.equal(f.writes(), 0);

  const id = success(c.addFinanceTransaction('T', {
    transactionType: 'Owner Investment', personId: 'FP1', amount: 10, paymentMethod: 'Cash'
  })).id;

  f.sheets.FINANCE_PERSONS[0].Status = 'Inactive';
  const beforeInactiveEdit = f.writes();
  const inactiveEdit = c.updateFinanceTransaction('T', id, {
    transactionType: 'Owner Investment', personId: 'FP1', amount: 20, paymentMethod: 'Cash'
  });
  assert.equal(inactiveEdit.success, false);
  assert.match(inactiveEdit.message, /inactive/i);
  assert.equal(f.writes(), beforeInactiveEdit);

  f.sheets.FINANCE_PERSONS[0].Status = 'Active';
  const before = f.writes();
  const subCent = c.updateFinanceTransaction('T', id, {
    transactionType: 'Owner Investment', personId: 'FP1', amount: 0.004, paymentMethod: 'Cash'
  });
  assert.equal(subCent.success, false);
  assert.equal(f.writes(), before);
});

test('expense bank-account edit, cancellation and deletion leave no net money movement', () => {
  const f = fixture(), c = f.ctx;
  const id = success(c.addExpense('T', expense({ paymentMethod: 'Bank', bankAccountId: 'B1' }))).id;
  success(c.updateExpense('T', id, expense({ amount: 150, paymentMethod: 'Bank', bankAccountId: 'B2' })));
  assert.equal(c.getBankBalance_('B1'), 1000);
  assert.equal(c.getBankBalance_('B2'), 350);
  success(c.cancelExpense('T', id, 'Cancel'));
  assert.equal(c.getBankBalance_('B2'), 500);
  success(c.deleteExpense('T', id, 'Remove cancelled'));
  assert.equal(c.getBankBalance_('B1'), 1000);
  assert.equal(c.getBankBalance_('B2'), 500);
});

test('missing bank account and closed cash session reject purchase before any writes', () => {
  const f = fixture();
  assert.equal(f.ctx.createPurchase('T', purchase({ paymentMethod: 'Bank', bankAccountId: 'missing' })).success, false);
  assert.equal(f.writes(), 0);
  f.closeSession();
  assert.equal(f.ctx.createPurchase('T', purchase()).success, false);
  assert.equal(f.writes(), 0);
});

for (const party of ['customer', 'supplier']) test('ambiguous legacy ' + party + ' cash payment delete fails before reversing any balance', () => {
  const f = fixture(), c = f.ctx, customer = party === 'customer';
  const create = customer ? c.receivePayment : c.paySupplier, partyId = customer ? 'C1' : 'S1';
  success(create('T', partyId, 100, 'Cash'));
  success(create('T', partyId, 100, 'Cash'));
  const ledger = f.sheets[customer ? 'CUSTOMER_LEDGER' : 'SUPPLIER_LEDGER'];
  for (const row of f.sheets.CASH_BOOK.slice(1)) row.Reference = partyId;
  // Materialize the empty alternate payment book before the snapshot; the
  // in-memory repository creates an empty array on first read.
  f.rows('BANK_BOOK');
  const before = JSON.stringify(f.sheets), count = f.writes();
  const result = (customer ? c.deleteCustomerPayment : c.deleteSupplierPayment)('T', ledger[1]['Ledger ID'], 'Duplicate');
  assert.equal(result.success, false, 'cannot identify which same-amount legacy cash row belongs to this payment');
  assert.equal(f.writes(), count, 'ambiguity must be detected before restoring party due');
  assert.equal(JSON.stringify(f.sheets), before);
});

test('purchase return uses discounted economics and caps cash by prior refunds', () => {
  const f = fixture(), c = f.ctx;
  const id = success(c.createPurchase('T', purchase({ discount: 20, paidAmount: 40 }))).purchaseId;
  const payload = { purchaseId: id, items: [{ productId: 'P1', qty: 4 }], refundMethod: 'Cash' };
  assert.equal(success(c.completePurchaseReturn('T', payload)).totalReturnAmount, 32);
  assert.equal(f.sheets.PRODUCTS[0]['Current Stock'], 6);
  assert.equal(f.sheets.STOCK_LOTS[0]['Remaining Quantity'], 6);
  assert.equal(c.getCashBalance_(), 992);
  const before = f.writes();
  assert.equal(c.completePurchaseReturn('T', { ...payload, items: [{ productId: 'P1', qty: 2 }] }).success, false);
  assert.equal(f.writes(), before);
  success(c.completePurchaseReturn('T', { ...payload, items: [{ productId: 'P1', qty: 6 }], refundMethod: 'Supplier Credit' }));
  assert.equal(f.sheets.SUPPLIERS[0]['Current Due'], 992);
  assert.equal(f.sheets.PRODUCTS[0]['Current Stock'], 0);
  assert.equal(c.deletePurchase('T', id, 'Has returns').success, false);
});

test('vendor payment create/edit/delete restores payable and cash/bank exactly once', () => {
  const f = fixture(), c = f.ctx;
  f.sheets.VENDORS = [{ 'Vendor ID': 'V1', 'Vendor Name': 'Vendor', 'Current Due': 500, Status: 'Active' }];
  const id = success(c.payVendor('T', 'V1', 100, 'Cash')).ledgerId;
  assert.equal(f.sheets.VENDORS[0]['Current Due'], 400);
  success(c.updateVendorPayment('T', id, { amount: 150, method: 'Bank', bankAccountId: 'B1' }));
  assert.equal(f.sheets.VENDORS[0]['Current Due'], 350);
  assert.equal(c.getCashBalance_(), 1000);
  assert.equal(c.getBankBalance_('B1'), 850);
  success(c.deleteVendorPayment('T', id, 'Reverse'));
  assert.equal(f.sheets.VENDORS[0]['Current Due'], 500);
  assert.equal(c.getBankBalance_('B1'), 1000);
  assert.equal(c.deleteVendorPayment('T', id, 'Again').success, false);
});

test('bank transfer conserves total bank assets and rejects same-account writes', () => {
  const f = fixture(), c = f.ctx;
  success(c.transferBetweenBankAccounts('T', { fromAccountId: 'B1', toAccountId: 'B2', amount: 125 }));
  assert.equal(c.getBankBalance_('B1'), 875);
  assert.equal(c.getBankBalance_('B2'), 625);
  const before = f.writes();
  assert.equal(c.transferBetweenBankAccounts('T', { fromAccountId: 'B1', toAccountId: 'B1', amount: 100 }).success, false);
  assert.equal(f.writes(), before);
});

test('carrying the counted cash into a second session does not duplicate cash assets', () => {
  const f = fixture(), c = f.ctx;
  f.sheets.CASH_BOOK = [];
  vm.runInContext(fs.readFileSync(path.join(root, 'CashSession.gs'), 'utf8'), c);
  success(c.startCashSession('T', 1000, 'First day'));
  assert.equal(c.getCashBalance_(), 1000);
  success(c.closeCashSession('T', 1000, 'Balanced'));
  success(c.startCashSession('T', 1000, 'Carry counted cash'));
  assert.equal(success(c.getCashSessionSummary('T')).expectedCash, 1000);
  assert.equal(c.getCashBalance_(), 1000);
});

for (const party of ['customer', 'supplier']) test(party + ' Other-method payment can be edited and deleted without a Cash/Bank movement', () => {
  const f = fixture(), c = f.ctx;
  const isCustomer = party === 'customer';
  const sheet = isCustomer ? 'CUSTOMERS' : 'SUPPLIERS';
  const ledger = isCustomer ? 'CUSTOMER_LEDGER' : 'SUPPLIER_LEDGER';
  const create = isCustomer ? c.receivePayment : c.paySupplier;
  const update = isCustomer ? c.updateCustomerPayment : c.updateSupplierPayment;
  const remove = isCustomer ? c.deleteCustomerPayment : c.deleteSupplierPayment;
  success(create('T', isCustomer ? 'C1' : 'S1', 200, 'Other', '', '', '', '', 0, ''));
  const id = f.sheets[ledger].at(-1)['Ledger ID'];
  assert.equal(f.sheets[sheet][0]['Current Due'], 800);
  const cashBefore = c.getCashBalance_();
  const bankBefore = c.getBankBalance_('B1');

  success(update('T', id, { amount: 250, discountAmount: 0, discountReason: '', method: 'Other', bankAccountId: '', notes: '' }));
  assert.equal(f.sheets[sheet][0]['Current Due'], 750);
  assert.equal(c.getCashBalance_(), cashBefore);
  assert.equal(c.getBankBalance_('B1'), bankBefore);

  success(remove('T', id, 'Reverse Other payment'));
  assert.equal(f.sheets[sheet][0]['Current Due'], 1000);
  assert.equal(c.getCashBalance_(), cashBefore);
  assert.equal(c.getBankBalance_('B1'), bankBefore);
});

test('purchase return cash refund recognizes a later verified supplier payment on the purchase due', () => {
  const f = fixture(), c = f.ctx;
  // Isolate this scenario from the fixture's opening supplier payable so the
  // later payment is deterministically allocated to this purchase.
  f.sheets.SUPPLIERS[0]['Current Due'] = 0;
  f.sheets.SUPPLIER_LEDGER = [];
  const id = success(c.createPurchase('T', purchase({ paidAmount: 0, paymentMethod: 'Cash' }))).purchaseId;
  assert.equal(f.sheets.SUPPLIERS[0]['Current Due'], 100);
  success(c.paySupplier('T', 'S1', 100, 'Cash', '', '', '', '', 0, ''));
  assert.equal(f.sheets.SUPPLIERS[0]['Current Due'], 0);

  const result = c.completePurchaseReturn('T', {
    purchaseId: id,
    items: [{ productId: 'P1', name: 'Rice', qty: 10 }],
    refundMethod: 'Cash',
    reason: 'Full return', notes: ''
  });
  success(result);
  assert.equal(c.getCashBalance_(), 1000, 'supplier payment out and purchase return cash refund should net to zero');
});


for (const party of ['customer', 'supplier']) {
  for (const transition of [
    ['Cash', 'Other'],
    ['Other', 'Cash'],
    ['Bank', 'Other'],
    ['Other', 'Bank']
  ]) test(party + ' payment method transition ' + transition[0] + ' -> ' + transition[1] + ' reverses/posts money exactly once', () => {
    const f = fixture(), c = f.ctx;
    const isCustomer = party === 'customer';
    const ledger = isCustomer ? 'CUSTOMER_LEDGER' : 'SUPPLIER_LEDGER';
    const create = isCustomer ? c.receivePayment : c.paySupplier;
    const update = isCustomer ? c.updateCustomerPayment : c.updateSupplierPayment;
    const remove = isCustomer ? c.deleteCustomerPayment : c.deleteSupplierPayment;
    const idArg = isCustomer ? 'C1' : 'S1';
    const from = transition[0], to = transition[1];
    const fromBank = from === 'Bank' ? 'B1' : '';
    const toBank = to === 'Bank' ? 'B1' : '';

    success(create('T', idArg, 200, from, fromBank, '', '', '', 0, ''));
    const ledgerId = f.sheets[ledger].at(-1)['Ledger ID'];
    success(update('T', ledgerId, {
      amount: 250, discountAmount: 0, discountReason: '', method: to,
      bankAccountId: toBank, notes: ''
    }));

    assert.equal(f.sheets[isCustomer ? 'CUSTOMERS' : 'SUPPLIERS'][0]['Current Due'], 750);
    const expectedCash = to === 'Cash' ? (isCustomer ? 1250 : 750) : 1000;
    const expectedBank = to === 'Bank' ? (isCustomer ? 1250 : 750) : 1000;
    assert.equal(c.getCashBalance_(), expectedCash, 'cash book must reflect only the new method');
    assert.equal(c.getBankBalance_('B1'), expectedBank, 'bank book must reflect only the new method');

    success(remove('T', ledgerId, 'Reverse transition'));
    assert.equal(f.sheets[isCustomer ? 'CUSTOMERS' : 'SUPPLIERS'][0]['Current Due'], 1000);
    assert.equal(c.getCashBalance_(), 1000);
    assert.equal(c.getBankBalance_('B1'), 1000);
  });
}

for (const party of ['customer', 'supplier']) test(party + ' Other-method payment with discount edits and deletes without phantom book movement', () => {
  const f = fixture(), c = f.ctx;
  const isCustomer = party === 'customer';
  const ledger = isCustomer ? 'CUSTOMER_LEDGER' : 'SUPPLIER_LEDGER';
  const create = isCustomer ? c.receivePayment : c.paySupplier;
  const update = isCustomer ? c.updateCustomerPayment : c.updateSupplierPayment;
  const remove = isCustomer ? c.deleteCustomerPayment : c.deleteSupplierPayment;
  success(create('T', isCustomer ? 'C1' : 'S1', 200, 'Other', '', '', '', '', 50, 'Settlement'));
  const id = f.sheets[ledger].at(-1)['Ledger ID'];
  assert.equal(f.sheets[isCustomer ? 'CUSTOMERS' : 'SUPPLIERS'][0]['Current Due'], 750);
  assert.equal(c.getCashBalance_(), 1000);
  assert.equal(c.getBankBalance_('B1'), 1000);

  success(update('T', id, {
    amount: 250, discountAmount: 25, discountReason: 'Revised', method: 'Other', bankAccountId: '', notes: ''
  }));
  assert.equal(f.sheets[isCustomer ? 'CUSTOMERS' : 'SUPPLIERS'][0]['Current Due'], 725);
  assert.equal(c.getCashBalance_(), 1000);
  assert.equal(c.getBankBalance_('B1'), 1000);

  success(remove('T', id, 'Reverse'));
  assert.equal(f.sheets[isCustomer ? 'CUSTOMERS' : 'SUPPLIERS'][0]['Current Due'], 1000);
  assert.equal(c.getCashBalance_(), 1000);
  assert.equal(c.getBankBalance_('B1'), 1000);
});


for (const party of ['customer', 'supplier']) test(party + ' replayed settlement state stays equal to stored Current Due through create/edit/delete', () => {
  const f = fixture(), c = f.ctx;
  const isCustomer = party === 'customer';
  const partyId = isCustomer ? 'C1' : 'S1';
  const partySheet = isCustomer ? 'CUSTOMERS' : 'SUPPLIERS';
  const ledgerSheet = isCustomer ? 'CUSTOMER_LEDGER' : 'SUPPLIER_LEDGER';
  const create = isCustomer ? c.receivePayment : c.paySupplier;
  const update = isCustomer ? c.updateCustomerPayment : c.updateSupplierPayment;
  const remove = isCustomer ? c.deleteCustomerPayment : c.deleteSupplierPayment;
  const replay = () => isCustomer ? c.customerSettlementState_(partyId) : c.supplierSettlementState_(partyId);
  const storedDue = () => Number(f.sheets[partySheet][0]['Current Due']) || 0;

  assert.equal(replay().computedNetDue, storedDue(), 'opening balance must reconcile');
  success(create('T', partyId, 200, 'Cash', '', '', '', '', 50, 'Settlement'));
  const ledgerId = f.sheets[ledgerSheet].at(-1)['Ledger ID'];
  assert.equal(storedDue(), 750);
  assert.equal(replay().computedNetDue, storedDue(), 'payment + discount must reconcile');

  success(update('T', ledgerId, {
    amount: 250, discountAmount: 25, discountReason: 'Revised', method: 'Other', bankAccountId: '', notes: ''
  }));
  assert.equal(storedDue(), 725);
  assert.equal(replay().computedNetDue, storedDue(), 'edited payment must reconcile');

  success(remove('T', ledgerId, 'Reverse settlement'));
  assert.equal(storedDue(), 1000);
  assert.equal(replay().computedNetDue, storedDue(), 'deleted payment must reconcile');
});

console.log(`\n${passed}/${passed + failed} financial CRUD scenarios passed`);
if (failed) process.exitCode = 1;
