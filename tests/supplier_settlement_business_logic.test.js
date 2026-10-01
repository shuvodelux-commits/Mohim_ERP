'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const supplierPath = path.join(root, 'SupplierSettlement.gs');
const settlementSource = fs.readFileSync(path.join(root, 'SettlementDiscount.gs'), 'utf8');
const supplierSource = fs.existsSync(supplierPath) ? fs.readFileSync(supplierPath, 'utf8') : '';

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function createRuntime(initialSheets = {}) {
  assert.equal(fs.existsSync(supplierPath), true, 'SupplierSettlement.gs must exist');
  const sheets = Object.fromEntries(Object.entries(initialSheets).map(([k, rows]) => [k, rows.map(r => ({ ...r }))]));
  const context = {
    console,
    roundMoney_: roundMoney,
    sanitizeInput_: value => String(value == null ? '' : value).trim(),
    safeDateOnly_: value => String(value == null ? '' : value).slice(0, 10),
    isDeleted_: row => row && (row['Is Deleted'] === true || String(row['Is Deleted'] || '').toUpperCase() === 'TRUE'),
    getAllRows_: key => sheets[key] || [],
    activeRows_: key => (sheets[key] || []).filter(row => !context.isDeleted_(row)),
    findFirstRow_: (key, col, value) => (sheets[key] || []).find(row => String(row[col]) === String(value)) || null,
    isValidNonNegativeNumber_: value => value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) >= 0
  };
  vm.createContext(context);
  vm.runInContext(settlementSource, context, { filename: 'SettlementDiscount.gs' });
  vm.runInContext(supplierSource, context, { filename: 'SupplierSettlement.gs' });
  return { context, sheets };
}

function ledgerRow(overrides = {}) {
  return {
    _rowIndex: 2,
    'Ledger ID': 'L1', Date: '2026-09-01',
    'Supplier ID': 'S1', 'Supplier Name': 'Supplier',
    Type: 'Purchase', Reference: 'PUR-1', Debit: 0, Credit: 0,
    'Payment Amount': '', 'Discount Amount': '', 'Payment Method': '', 'Is Deleted': '',
    ...overrides
  };
}

function plain(value) { return JSON.parse(JSON.stringify(value)); }

test('later supplier payment settles purchase due and records refundable payment provenance', () => {
  const { context } = createRuntime({
    PURCHASES: [{ 'Purchase ID': 'PUR-1', 'Supplier ID': 'S1', 'Paid Amount': 0, 'Due Amount': 100, 'Payment Method': 'Cash', 'Payment Status': 'Due' }],
    SUPPLIER_LEDGER: [
      ledgerRow({ _rowIndex: 2, 'Ledger ID': 'PUR-DUE', Type: 'Purchase', Reference: 'PUR-1', Debit: 100 }),
      ledgerRow({ _rowIndex: 3, 'Ledger ID': 'PAY-1', Type: 'Payment', Reference: 'PAYMENT', Credit: 100, 'Payment Amount': 100, 'Payment Method': 'Cash' })
    ],
    PURCHASE_RETURN: []
  });

  const state = context.supplierSettlementState_('S1');
  assert.equal(state.purchaseRemaining['PUR-1'] || 0, 0);
  assert.equal(state.paymentByPurchase['PUR-1'], 100);
  assert.equal(state.cashByPurchase['PUR-1'], 100);
  assert.equal(state.computedNetDue, 0);
  assert.deepEqual(plain(context.supplierPurchaseSettlementSnapshot_('PUR-1')), {
    paidAmount: 100,
    dueAmount: 0,
    supplierCreditUsed: 0,
    paymentStatus: 'Paid'
  });
  assert.equal(context.supplierPurchaseCashPaid_('PUR-1'), 100);
});

test('supplier cash advance settles a later purchase before remaining as supplier credit', () => {
  const { context } = createRuntime({
    PURCHASES: [{ 'Purchase ID': 'PUR-1', 'Supplier ID': 'S1', 'Paid Amount': 0, 'Due Amount': 100, 'Payment Method': 'Cash', 'Payment Status': 'Due' }],
    SUPPLIER_LEDGER: [
      ledgerRow({ _rowIndex: 2, 'Ledger ID': 'PAY-ADV', Type: 'Payment', Reference: 'PAYMENT', Credit: 150, 'Payment Amount': 150, 'Payment Method': 'Cash' }),
      ledgerRow({ _rowIndex: 3, 'Ledger ID': 'PUR-DUE', Date: '2026-09-02', Type: 'Purchase', Reference: 'PUR-1', Debit: 100 })
    ],
    PURCHASE_RETURN: []
  });
  const state = context.supplierSettlementState_('S1');
  assert.equal(state.purchaseRemaining['PUR-1'] || 0, 0);
  assert.equal(state.cashByPurchase['PUR-1'], 100);
  assert.equal(state.cashAdvance, 50);
  assert.equal(state.supplierCredit, 50);
  assert.equal(state.computedNetDue, -50);
});

test('supplier settlement discount clears due without increasing refundable payment provenance', () => {
  const { context } = createRuntime({
    PURCHASES: [{ 'Purchase ID': 'PUR-1', 'Supplier ID': 'S1', 'Paid Amount': 0, 'Due Amount': 100, 'Payment Method': 'Cash', 'Payment Status': 'Due' }],
    SUPPLIER_LEDGER: [
      ledgerRow({ _rowIndex: 2, 'Ledger ID': 'PUR-DUE', Type: 'Purchase', Reference: 'PUR-1', Debit: 100 }),
      ledgerRow({ _rowIndex: 3, 'Ledger ID': 'PAY-1', Type: 'Payment', Reference: 'PAYMENT', Credit: 100, 'Payment Amount': 90, 'Discount Amount': 10, 'Payment Method': 'Cash' })
    ],
    PURCHASE_RETURN: []
  });
  const state = context.supplierSettlementState_('S1');
  assert.equal(state.purchaseRemaining['PUR-1'] || 0, 0);
  assert.equal(state.paymentByPurchase['PUR-1'], 90);
  assert.equal(state.cashByPurchase['PUR-1'], 90);
  assert.equal(context.supplierPurchaseCashPaid_('PUR-1'), 90);
});

test('purchase return credit applies to its source purchase before becoming supplier credit', () => {
  const { context } = createRuntime({
    PURCHASES: [{ 'Purchase ID': 'PUR-1', 'Supplier ID': 'S1', 'Paid Amount': 0, 'Due Amount': 80, 'Payment Method': 'Cash', 'Payment Status': 'Due' }],
    SUPPLIER_LEDGER: [
      ledgerRow({ _rowIndex: 2, 'Ledger ID': 'PUR-DUE', Type: 'Purchase', Reference: 'PUR-1', Debit: 80 }),
      ledgerRow({ _rowIndex: 3, 'Ledger ID': 'RET-CREDIT', Type: 'Purchase Return Credit', Reference: 'RET-1', Credit: 100 })
    ],
    PURCHASE_RETURN: [{ 'Return ID': 'RET-1', 'Purchase ID': 'PUR-1' }]
  });
  const state = context.supplierSettlementState_('S1');
  assert.equal(state.purchaseRemaining['PUR-1'] || 0, 0);
  assert.equal(state.nonCashCreditByPurchase['PUR-1'], 80);
  assert.equal(state.supplierCredit, 20);
  assert.equal(state.computedNetDue, -20);
});

test('direct purchase paid by Other is settled but not refundable cash provenance', () => {
  const { context } = createRuntime({
    PURCHASES: [{ 'Purchase ID': 'PUR-OTHER', 'Supplier ID': 'S1', 'Paid Amount': 100, 'Due Amount': 0, 'Payment Method': 'Other', 'Payment Status': 'Paid', 'Is Deleted': '' }],
    SUPPLIER_LEDGER: [],
    PURCHASE_RETURN: []
  });
  assert.equal(context.supplierPurchaseSettlementSnapshot_('PUR-OTHER').paidAmount, 100);
  assert.equal(context.supplierPurchaseCashPaid_('PUR-OTHER'), 0);
});
