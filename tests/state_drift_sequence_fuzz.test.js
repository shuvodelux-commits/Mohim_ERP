'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function context() {
  const ctx = {
    console,
    isDeleted_: row => row && (row['Is Deleted'] === true || String(row['Is Deleted'] || '').toUpperCase() === 'TRUE'),
    activeRows_: () => [],
    getAllRows_: () => []
  };
  vm.createContext(ctx);
  for (const file of ['Utils.gs', 'SettlementDiscount.gs', 'CustomerSettlement.gs', 'SupplierSettlement.gs']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file });
  }
  return ctx;
}

function rng(seed) {
  let x = seed >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 0x100000000;
  };
}

function money(n) { return Math.round(n * 100) / 100; }
function pick(rand, values) { return values[Math.floor(rand() * values.length)]; }

function buildCustomerCase(seed) {
  const rand = rng(seed);
  const rows = [];
  const returns = [];
  const invoices = [];
  let rowIndex = 2;
  let retSeq = 0;
  const add = row => rows.push({
    _rowIndex: rowIndex++,
    'Ledger ID': 'CL-' + seed + '-' + rowIndex,
    'Customer ID': 'C1',
    'Date': '2026-09-' + String(1 + Math.floor((rowIndex - 2) / 4)).padStart(2, '0'),
    'Is Deleted': '',
    ...row
  });

  if (rand() < 0.5) add({ Type: 'Opening Balance', Debit: money(20 + rand() * 80), Credit: '', Reference: '' });

  const steps = 12 + Math.floor(rand() * 18);
  for (let i = 0; i < steps; i++) {
    const action = rand();
    if (action < 0.42 || invoices.length === 0) {
      const id = 'INV-' + seed + '-' + (invoices.length + 1);
      invoices.push(id);
      add({ Type: 'Sale', Debit: money(5 + rand() * 95), Credit: '', Reference: id });
    } else if (action < 0.75) {
      const payment = money(1 + rand() * 90);
      const discount = 0;
      const target = rand() < 0.55 ? pick(rand, invoices) : '';
      add({
        Type: 'Payment', Debit: '', Credit: money(payment + discount), Reference: 'PAYMENT',
        'Payment Amount': payment, 'Discount Amount': discount,
        'Allocated Invoice ID': target, 'Payment Method': pick(rand, ['Cash', 'Bank', 'Mobile Banking', 'Other'])
      });
    } else if (action < 0.90) {
      const source = pick(rand, invoices);
      const returnId = 'RET-' + seed + '-' + (++retSeq);
      returns.push({ 'Return ID': returnId, 'Invoice ID': source });
      add({ Type: 'Sales Return Credit', Debit: '', Credit: money(1 + rand() * 40), Reference: returnId });
    } else {
      const source = pick(rand, invoices);
      const amount = money(1 + rand() * 30);
      if (rand() < 0.5) add({ Type: 'Sale Update Debit', Debit: amount, Credit: '', Reference: source });
      else add({ Type: 'Sale Update Credit', Debit: '', Credit: amount, Reference: source });
    }
  }
  return { rows, returns };
}

function buildSupplierCase(seed) {
  const rand = rng(seed ^ 0x9e3779b9);
  const rows = [];
  const returns = [];
  const purchases = [];
  let rowIndex = 2;
  let retSeq = 0;
  const add = row => rows.push({
    _rowIndex: rowIndex++,
    'Ledger ID': 'SL-' + seed + '-' + rowIndex,
    'Supplier ID': 'S1',
    'Date': '2026-09-' + String(1 + Math.floor((rowIndex - 2) / 4)).padStart(2, '0'),
    'Is Deleted': '',
    ...row
  });

  if (rand() < 0.5) add({ Type: 'Opening Balance', Debit: money(20 + rand() * 80), Credit: '', Reference: '' });

  const steps = 12 + Math.floor(rand() * 18);
  for (let i = 0; i < steps; i++) {
    const action = rand();
    if (action < 0.42 || purchases.length === 0) {
      const id = 'PUR-' + seed + '-' + (purchases.length + 1);
      purchases.push(id);
      add({ Type: 'Purchase', Debit: money(5 + rand() * 95), Credit: '', Reference: id });
    } else if (action < 0.75) {
      const payment = money(1 + rand() * 90);
      const discount = 0;
      add({
        Type: 'Payment', Debit: '', Credit: money(payment + discount), Reference: 'PAYMENT',
        'Payment Amount': payment, 'Discount Amount': discount,
        'Payment Method': pick(rand, ['Cash', 'Bank', 'Mobile Banking', 'Other'])
      });
    } else if (action < 0.90) {
      const source = pick(rand, purchases);
      const returnId = 'PRET-' + seed + '-' + (++retSeq);
      returns.push({ 'Return ID': returnId, 'Purchase ID': source });
      add({ Type: 'Purchase Return Credit', Debit: '', Credit: money(1 + rand() * 40), Reference: returnId });
    } else {
      const source = pick(rand, purchases);
      const amount = money(1 + rand() * 30);
      if (rand() < 0.5) add({ Type: 'Purchase Update', Debit: amount, Credit: '', Reference: source });
      else add({ Type: 'Purchase Update', Debit: '', Credit: amount, Reference: source });
    }
  }
  return { rows, returns };
}

function signedLedgerTotal(rows) {
  return money(rows.reduce((sum, row) => sum + (Number(row.Debit) || 0) - (Number(row.Credit) || 0), 0));
}

function outstandingTotal(obligations) {
  return money(obligations.reduce((sum, ob) => sum + (Number(ob.remaining) || 0), 0));
}

test('customer replay preserves signed ledger balance and never strands due beside customer credit across 300 generated histories', () => {
  const c = context();
  for (let seed = 1; seed <= 300; seed++) {
    const x = buildCustomerCase(seed);
    const state = c.customerSettlementState_('C1', { ledgerRows: x.rows, returnRows: x.returns });
    const signed = signedLedgerTotal(x.rows);
    assert.equal(state.computedNetDue, signed, 'seed ' + seed + ' signed balance drift');
    const outstanding = outstandingTotal(state.obligations);
    assert.ok(!(outstanding > 0.004 && state.customerCredit > 0.004), 'seed ' + seed + ' stranded due and credit coexist');
    assert.equal(state.computedNetDue, money(outstanding - state.customerCredit), 'seed ' + seed + ' net identity');
  }
});

test('supplier replay preserves signed ledger balance and never strands payable beside supplier credit across 300 generated histories', () => {
  const c = context();
  for (let seed = 1; seed <= 300; seed++) {
    const x = buildSupplierCase(seed);
    const state = c.supplierSettlementState_('S1', { ledgerRows: x.rows, returnRows: x.returns });
    const signed = signedLedgerTotal(x.rows);
    assert.equal(state.computedNetDue, signed, 'seed ' + seed + ' signed balance drift');
    const outstanding = outstandingTotal(state.obligations);
    assert.ok(!(outstanding > 0.004 && state.supplierCredit > 0.004), 'seed ' + seed + ' stranded payable and credit coexist');
    assert.equal(state.computedNetDue, money(outstanding - state.supplierCredit), 'seed ' + seed + ' net identity');
  }
});

test('customer cash provenance never exceeds actual cash-backed settlement payments across generated histories', () => {
  const c = context();
  for (let seed = 301; seed <= 500; seed++) {
    const x = buildCustomerCase(seed);
    const state = c.customerSettlementState_('C1', { ledgerRows: x.rows, returnRows: x.returns });
    const availableCashPayments = money(x.rows.filter(r => r.Type === 'Payment' && c.customerSettlementIsCashBackedMethod_(r['Payment Method']))
      .reduce((sum, r) => sum + c.settlementPaymentAmount_(r), 0));
    const attributedCash = money(Object.values(state.cashByInvoice).reduce((a, b) => a + Number(b || 0), 0) + state.cashAdvance);
    assert.ok(attributedCash <= availableCashPayments + 0.005, 'seed ' + seed + ' invented customer cash provenance');
  }
});

test('supplier cash provenance never exceeds actual cash-backed settlement payments across generated histories', () => {
  const c = context();
  for (let seed = 301; seed <= 500; seed++) {
    const x = buildSupplierCase(seed);
    const state = c.supplierSettlementState_('S1', { ledgerRows: x.rows, returnRows: x.returns });
    const availableCashPayments = money(x.rows.filter(r => r.Type === 'Payment' && c.supplierSettlementIsCashBackedMethod_(r['Payment Method']))
      .reduce((sum, r) => sum + c.settlementPaymentAmount_(r), 0));
    const attributedCash = money(Object.values(state.cashByPurchase).reduce((a, b) => a + Number(b || 0), 0) + state.cashAdvance);
    assert.ok(attributedCash <= availableCashPayments + 0.005, 'seed ' + seed + ' invented supplier cash provenance');
  }
});
