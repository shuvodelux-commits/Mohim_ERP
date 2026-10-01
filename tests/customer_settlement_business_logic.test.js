'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const settlementSource = fs.readFileSync(path.join(root, 'SettlementDiscount.gs'), 'utf8');
const customerSettlementSource = fs.readFileSync(path.join(root, 'CustomerSettlement.gs'), 'utf8');

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function createRuntime(initialSheets = {}) {
  const sheets = Object.fromEntries(
    Object.entries(initialSheets).map(([key, rows]) => [key, rows.map(row => ({ ...row }))])
  );
  const reads = {};

  const context = {
    console,
    roundMoney_: roundMoney,
    sanitizeInput_: value => String(value == null ? '' : value).trim(),
    safeDateOnly_: value => String(value == null ? '' : value).slice(0, 10),
    isDeleted_: row => row && (row['Is Deleted'] === true || String(row['Is Deleted'] || '').toUpperCase() === 'TRUE'),
    getAllRows_: sheetKey => {
      reads[sheetKey] = (reads[sheetKey] || 0) + 1;
      return sheets[sheetKey] || [];
    },
    activeRows_: sheetKey => {
      reads[sheetKey] = (reads[sheetKey] || 0) + 1;
      return (sheets[sheetKey] || []).filter(row => !context.isDeleted_(row));
    },
    findUniqueSalesRow_: invoiceId => (sheets.SALES || []).filter(row => row['Invoice ID'] === invoiceId)[0] || null,
    requirePermission_: () => ({ 'Full Name': 'Tester' }),
    ok_: data => ({ success: true, data }),
    fail_: message => ({ success: false, message: String(message) }),
    logError_: () => {},
    isValidNonNegativeNumber_: value => value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) >= 0,
    inRange_: (date, range) => date >= range.from && date <= range.to
  };

  vm.createContext(context);
  vm.runInContext(settlementSource, context, { filename: 'SettlementDiscount.gs' });
  vm.runInContext(customerSettlementSource, context, { filename: 'CustomerSettlement.gs' });
  return { context, reads, sheets };
}

function ledgerRow(overrides) {
  return {
    _rowIndex: 2,
    'Ledger ID': 'L1',
    Date: '2026-09-01',
    'Customer ID': 'C1',
    Type: 'Sale',
    Reference: 'INV-1',
    Debit: 0,
    Credit: 0,
    'Payment Amount': '',
    'Discount Amount': '',
    'Allocated Invoice ID': '',
    'Payment Method': '',
    'Is Deleted': '',
    ...overrides
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('untargeted payments settle the oldest invoice before a newer invoice', () => {
  const { context } = createRuntime();
  const state = context.customerSettlementState_('C1', {
    returnRows: [],
    ledgerRows: [
      ledgerRow({ _rowIndex: 2, 'Ledger ID': 'S1', Date: '2026-09-01', Reference: 'INV-1', Debit: 100 }),
      ledgerRow({ _rowIndex: 3, 'Ledger ID': 'S2', Date: '2026-09-02', Reference: 'INV-2', Debit: 80 }),
      ledgerRow({ _rowIndex: 4, 'Ledger ID': 'P1', Date: '2026-09-03', Type: 'Payment', Reference: 'PAYMENT', Credit: 120, 'Payment Amount': 120, 'Payment Method': 'Cash' })
    ]
  });

  assert.deepEqual(plain(state.invoiceRemaining), { 'INV-2': 60 });
  assert.deepEqual(plain(state.paymentByInvoice), { 'INV-1': 100, 'INV-2': 20 });
  assert.deepEqual(plain(state.cashByInvoice), { 'INV-1': 100, 'INV-2': 20 });
  assert.equal(state.computedNetDue, 60);
});

test('same-date ledger replay uses sheet row order before ledger ID', () => {
  const { context } = createRuntime();
  const state = context.customerSettlementState_('C1', {
    returnRows: [],
    ledgerRows: [
      ledgerRow({ _rowIndex: 3, 'Ledger ID': 'A-PAY', Type: 'Payment', Credit: 50, 'Payment Amount': 50, 'Payment Method': 'Cash' }),
      ledgerRow({ _rowIndex: 2, 'Ledger ID': 'Z-SALE', Type: 'Sale', Reference: 'INV-1', Debit: 50 })
    ]
  });

  assert.equal(state.invoiceRemaining['INV-1'] || 0, 0);
  assert.equal(state.cashAdvance, 0);
  assert.equal(state.cashByInvoice['INV-1'], 50);
});

test('cash overpayment becomes an advance and funds a later invoice', () => {
  const { context } = createRuntime();
  const state = context.customerSettlementState_('C1', {
    returnRows: [],
    ledgerRows: [
      ledgerRow({ _rowIndex: 2, 'Ledger ID': 'P1', Type: 'Payment', Credit: 150, 'Payment Amount': 150, 'Payment Method': 'Cash' }),
      ledgerRow({ _rowIndex: 3, 'Ledger ID': 'S1', Date: '2026-09-02', Type: 'Sale', Reference: 'INV-1', Debit: 100 })
    ]
  });

  assert.equal(state.cashAdvance, 50);
  assert.equal(state.customerCredit, 50);
  assert.equal(state.invoiceRemaining['INV-1'] || 0, 0);
  assert.equal(state.cashByInvoice['INV-1'], 100);
  assert.equal(state.paymentByInvoice['INV-1'], 100);
  assert.equal(state.computedNetDue, -50);
});

test('settlement discount reduces due without creating refundable cash', () => {
  const { context } = createRuntime();
  const state = context.customerSettlementState_('C1', {
    returnRows: [],
    ledgerRows: [
      ledgerRow({ _rowIndex: 2, 'Ledger ID': 'S1', Reference: 'INV-1', Debit: 100 }),
      ledgerRow({
        _rowIndex: 3,
        'Ledger ID': 'P1',
        Type: 'Payment',
        Credit: 100,
        'Payment Amount': 90,
        'Discount Amount': 10,
        'Payment Method': 'Cash'
      })
    ]
  });

  assert.equal(state.invoiceRemaining['INV-1'] || 0, 0);
  assert.equal(state.paymentByInvoice['INV-1'], 90);
  assert.equal(state.cashByInvoice['INV-1'], 90);
  assert.equal(state.customerCredit, 0);
  assert.equal(state.paymentIssues.P1.appliedDiscount, 10);
});

test('sales-return credit settles its source invoice and excess becomes store credit', () => {
  const { context } = createRuntime();
  const state = context.customerSettlementState_('C1', {
    returnRows: [{ 'Return ID': 'RET-1', 'Invoice ID': 'INV-1' }],
    ledgerRows: [
      ledgerRow({ _rowIndex: 2, 'Ledger ID': 'S1', Reference: 'INV-1', Debit: 80 }),
      ledgerRow({ _rowIndex: 3, 'Ledger ID': 'R1', Type: 'Sales Return Credit', Reference: 'RET-1', Credit: 100 })
    ]
  });

  assert.equal(state.invoiceRemaining['INV-1'] || 0, 0);
  assert.equal(state.nonCashCreditByInvoice['INV-1'], 80);
  assert.equal(state.customerCredit, 20);
  assert.equal(state.computedNetDue, -20);
});

test('deleted ledger rows and deleted sales returns have no settlement effect', () => {
  const { context } = createRuntime();
  const state = context.customerSettlementState_('C1', {
    returnRows: [
      { 'Return ID': 'RET-DELETED', 'Invoice ID': 'INV-1', 'Is Deleted': 'TRUE' }
    ],
    ledgerRows: [
      ledgerRow({ _rowIndex: 2, 'Ledger ID': 'S1', Reference: 'INV-1', Debit: 100 }),
      ledgerRow({ _rowIndex: 3, 'Ledger ID': 'P-DELETED', Type: 'Payment', Credit: 100, 'Payment Amount': 100, 'Is Deleted': 'TRUE' }),
      ledgerRow({ _rowIndex: 4, 'Ledger ID': 'R1', Type: 'Sales Return Credit', Reference: 'RET-DELETED', Credit: 25 })
    ]
  });

  assert.equal(state.invoiceRemaining['INV-1'], 75);
  assert.equal(state.paymentByInvoice['INV-1'] || 0, 0);
});

test('credit refund rejects an amount above credit available on the selected date', () => {
  const { context } = createRuntime({
    CUSTOMER_LEDGER: [
      ledgerRow({ _rowIndex: 2, 'Ledger ID': 'P1', Date: '2026-09-01', Type: 'Payment', Credit: 40, 'Payment Amount': 40, 'Payment Method': 'Cash' })
    ],
    SALES_RETURN: []
  });

  assert.throws(
    () => context.customerCreditRefundPreview_('C1', '2026-09-02', 40.01),
    /enough available Customer Credit/
  );
  const state = context.customerCreditRefundPreview_('C1', '2026-09-02', 40);
  assert.equal(state.customerCredit, 0);
});

test('targeted payment rejects another customer invoice and a date before the invoice', () => {
  const { context } = createRuntime({
    SALES: [
      { 'Invoice ID': 'INV-1', 'Customer ID': 'C2', Date: '2026-09-01', 'Due Amount': 100 },
      { 'Invoice ID': 'INV-2', 'Customer ID': 'C1', Date: '2026-09-05', 'Due Amount': 100 }
    ],
    CUSTOMER_LEDGER: [],
    SALES_RETURN: []
  });

  assert.throws(
    () => context.customerPaymentPreview_('C1', '2026-09-06', 50, 0, 'INV-1', '', 'Cash'),
    /different customer/
  );
  assert.throws(
    () => context.customerPaymentPreview_('C1', '2026-09-04', 50, 0, 'INV-2', '', 'Cash'),
    /cannot be before/
  );
});

test('invoice snapshot separates paid money from customer credit and remaining due', () => {
  const { context } = createRuntime();
  const sale = {
    'Invoice ID': 'INV-1',
    'Customer ID': 'C1',
    'Paid Amount': 20,
    'Due Amount': 80,
    'Payment Status': 'Partial',
    'Payment Type': 'Partial'
  };
  const state = {
    paymentByInvoice: { 'INV-1': 30 },
    nonCashCreditByInvoice: { 'INV-1': 10 },
    creditByInvoice: { 'INV-1': 10 },
    invoiceRemaining: { 'INV-1': 40 }
  };

  assert.deepEqual(plain(context.customerInvoiceSettlementSnapshotFromState_(sale, state)), {
    paidAmount: 60,
    dueAmount: 40,
    customerCreditUsed: 10,
    paymentStatus: 'Partial',
    paymentType: 'Partial'
  });
});

test('customer payment context reads each required sheet once for any ledger size', () => {
  const ledgerRows = [];
  for (let index = 0; index < 500; index += 1) {
    ledgerRows.push(ledgerRow({
      _rowIndex: index + 2,
      'Ledger ID': `S${index}`,
      'Customer ID': index % 2 ? 'C2' : 'C1',
      Reference: `INV-${index}`,
      Debit: 10
    }));
  }
  const { context, reads } = createRuntime({
    CUSTOMERS: [{ 'Customer ID': 'C1', 'Customer Name': 'Customer', 'Current Due': 2500, Status: 'Active' }],
    CUSTOMER_LEDGER: ledgerRows,
    SALES_RETURN: [],
    SALES: []
  });

  const result = context.getCustomerPaymentContext('TOKEN', 'C1');

  assert.equal(result.success, true);
  assert.deepEqual(reads, { CUSTOMERS: 1, SALES_RETURN: 1, CUSTOMER_LEDGER: 1, SALES: 1 });
});

test('targeted full-balance payment settles other outstanding invoices before creating customer credit', () => {
  const { context } = createRuntime();
  const state = context.customerSettlementState_('C1', {
    returnRows: [],
    ledgerRows: [
      ledgerRow({ _rowIndex: 2, 'Ledger ID': 'S-OLD', Date: '2026-09-07', Reference: 'INV-OLD', Debit: 63 }),
      ledgerRow({ _rowIndex: 3, 'Ledger ID': 'S-NEW', Date: '2026-09-08', Reference: 'INV-NEW', Debit: 1158 }),
      ledgerRow({
        _rowIndex: 4,
        'Ledger ID': 'P-FULL',
        Date: '2026-09-08',
        Type: 'Payment',
        Reference: 'PAYMENT',
        Credit: 1221,
        'Payment Amount': 1221,
        'Allocated Invoice ID': 'INV-NEW',
        'Payment Method': 'Cash'
      })
    ]
  });

  assert.equal(state.invoiceRemaining['INV-OLD'] || 0, 0);
  assert.equal(state.invoiceRemaining['INV-NEW'] || 0, 0);
  assert.equal(state.customerCredit, 0);
  assert.equal(state.cashAdvance, 0);
  assert.equal(state.paymentByInvoice['INV-OLD'], 63);
  assert.equal(state.paymentByInvoice['INV-NEW'], 1158);
  assert.equal(state.computedNetDue, 0);
});

test('repeated Sale Update Credit/Debit corrections do not become paid money or customer credit', () => {
  const { context } = createRuntime();
  const state = context.customerSettlementState_('C1', {
    returnRows: [],
    ledgerRows: [
      ledgerRow({ _rowIndex: 2, 'Ledger ID': 'OPEN', Date: '2026-09-06', Type: 'Opening Balance', Reference: 'C1', Debit: 11660 }),
      ledgerRow({ _rowIndex: 3, 'Ledger ID': 'SALE', Date: '2026-09-08', Type: 'Sale', Reference: 'INV-000030', Debit: 7730 }),
      ledgerRow({ _rowIndex: 4, 'Ledger ID': 'UC1', Date: '2026-09-08', Type: 'Sale Update Credit', Reference: 'INV-000030', Credit: 7730 }),
      ledgerRow({ _rowIndex: 5, 'Ledger ID': 'UD1', Date: '2026-09-08', Type: 'Sale Update Debit', Reference: 'INV-000030', Debit: 7750 }),
      ledgerRow({ _rowIndex: 6, 'Ledger ID': 'UC2', Date: '2026-09-08', Type: 'Sale Update Credit', Reference: 'INV-000030', Credit: 7750 }),
      ledgerRow({ _rowIndex: 7, 'Ledger ID': 'UD2', Date: '2026-09-08', Type: 'Sale Update Debit', Reference: 'INV-000030', Debit: 7730 })
    ]
  });

  assert.equal(state.invoiceRemaining['INV-000030'], 7730);
  assert.equal(state.paymentByInvoice['INV-000030'] || 0, 0);
  assert.equal(state.creditByInvoice['INV-000030'] || 0, 0);
  assert.equal(state.nonCashCreditByInvoice['INV-000030'] || 0, 0);
  assert.equal(state.customerCredit, 0);
  assert.equal(state.computedNetDue, 19390);
});

test('direct sale paid by Other is not refundable cash provenance', () => {
  const { context } = createRuntime({
    SALES: [{
      'Invoice ID': 'INV-OTHER', 'Customer ID': 'C1', Date: '2026-09-08',
      'Paid Amount': 100, 'Due Amount': 0, 'Payment Method': 'Other', 'Is Deleted': ''
    }],
    CUSTOMER_LEDGER: [],
    SALES_RETURN: []
  });

  assert.equal(context.customerInvoiceCashCollected_('INV-OTHER'), 0);
});

test('customer payment context does not classify direct Other-method invoice payment as refundable cash', () => {
  const { context } = createRuntime({
    CUSTOMERS: [{ 'Customer ID': 'C1', 'Customer Name': 'Customer', 'Current Due': 60, Status: 'Active' }],
    CUSTOMER_LEDGER: [
      ledgerRow({ _rowIndex: 2, 'Ledger ID': 'SALE-DUE', Type: 'Sale', Reference: 'INV-OTHER-PARTIAL', Debit: 60 })
    ],
    SALES_RETURN: [],
    SALES: [{
      'Invoice ID': 'INV-OTHER-PARTIAL', 'Customer ID': 'C1', Date: '2026-09-08',
      'Grand Total': 100, 'Paid Amount': 40, 'Due Amount': 60,
      'Payment Method': 'Other', 'Payment Status': 'Partial', 'Is Deleted': ''
    }]
  });

  const result = context.getCustomerPaymentContext('TOKEN', 'C1');
  assert.equal(result.success, true);
  assert.equal(result.data.invoices.length, 1);
  assert.equal(result.data.invoices[0].remainingDue, 60);
  assert.equal(result.data.invoices[0].cashCollected, 0);
});

test('backdated return before an existing targeted payment cannot recreate due beside customer credit', () => {
  const { context } = createRuntime();
  const state = context.customerSettlementState_('C1', {
    returnRows: [{ 'Return ID': 'RET-1', 'Invoice ID': 'INV-1' }],
    ledgerRows: [
      ledgerRow({ _rowIndex: 2, 'Ledger ID': 'S1', Date: '2026-09-01', Reference: 'INV-1', Debit: 50 }),
      ledgerRow({ _rowIndex: 3, 'Ledger ID': 'S2', Date: '2026-09-01', Reference: 'INV-2', Debit: 50 }),
      // This payment was originally valid for INV-1.
      ledgerRow({ _rowIndex: 4, 'Ledger ID': 'P1', Date: '2026-09-03', Type: 'Payment', Reference: 'PAYMENT', Debit: '', Credit: 50, 'Payment Amount': 50, 'Allocated Invoice ID': 'INV-1', 'Payment Method': 'Cash' }),
      // A later-created backdated return now sorts before the payment and settles INV-1 first.
      ledgerRow({ _rowIndex: 5, 'Ledger ID': 'R1', Date: '2026-09-02', Type: 'Sales Return Credit', Reference: 'RET-1', Debit: '', Credit: 50 })
    ]
  });

  assert.equal(state.invoiceRemaining['INV-1'] || 0, 0);
  assert.equal(state.invoiceRemaining['INV-2'] || 0, 0);
  assert.equal(state.customerCredit, 0);
  assert.equal(state.computedNetDue, 0);
  assert.equal(state.paymentIssues.P1.targetAppliedPayment, 0);
  assert.equal(state.paymentIssues.P1.appliedPayment, 50);
});

test('new targeted payment still rejects a selected invoice with no due even when another invoice is outstanding', () => {
  const { context } = createRuntime({
    SALES: [
      { 'Invoice ID': 'INV-1', 'Customer ID': 'C1', Date: '2026-09-01', 'Due Amount': 100, 'Paid Amount': 0, 'Is Deleted': '' },
      { 'Invoice ID': 'INV-2', 'Customer ID': 'C1', Date: '2026-09-03', 'Due Amount': 50, 'Paid Amount': 0, 'Is Deleted': '' }
    ],
    CUSTOMER_LEDGER: [
      ledgerRow({ _rowIndex: 2, 'Ledger ID': 'S1', Date: '2026-09-01', Reference: 'INV-1', Debit: 100 }),
      ledgerRow({ _rowIndex: 3, 'Ledger ID': 'P1', Date: '2026-09-02', Type: 'Payment', Reference: 'PAYMENT', Debit: '', Credit: 100, 'Payment Amount': 100, 'Payment Method': 'Cash' }),
      ledgerRow({ _rowIndex: 4, 'Ledger ID': 'S2', Date: '2026-09-03', Reference: 'INV-2', Debit: 50 })
    ],
    SALES_RETURN: []
  });

  assert.throws(
    () => context.customerPaymentPreview_('C1', '2026-09-04', 50, 0, 'INV-1', '', 'Cash'),
    /selected invoice has no outstanding due/i
  );
});
