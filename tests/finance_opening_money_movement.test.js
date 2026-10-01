'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const financeSource = fs.readFileSync(path.join(root, 'FinanceModule.gs'), 'utf8');
const deleteSource = fs.readFileSync(path.join(root, 'DeleteEngine.gs'), 'utf8');

function roundMoney(value) { return Math.round((Number(value) + Number.EPSILON) * 100) / 100; }

function runtime(initialFinance = []) {
  const sheets = {
    FINANCE_PERSONS: [
      { _rowIndex: 2, 'Person ID': 'OWN', 'Person Name': 'Owner', 'Person Type': 'Owner', Roles: 'Owner', Status: 'Active' },
      { _rowIndex: 3, 'Person ID': 'LEN', 'Person Name': 'Lender', 'Person Type': 'Lender', Roles: 'Lender', Status: 'Active' },
      { _rowIndex: 4, 'Person ID': 'BOR', 'Person Name': 'Borrower', 'Person Type': 'Borrower', Roles: 'Borrower', Status: 'Active' }
    ],
    FINANCE_TRANSACTIONS: initialFinance.map((row, i) => ({ _rowIndex: i + 2, ...row })),
    CASH_BOOK: [], BANK_BOOK: []
  };
  let nextId = 1;
  const calls = { session: 0, cashPost: 0, bankPost: 0, cashReverse: 0, bankReverse: 0, deleted: 0 };
  const context = {
    console,
    CONFIG: { LOCK_TIMEOUT_MS: 1000 },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    getAllRows_: key => (sheets[key] || []).map(row => ({ ...row })),
    activeRows_: key => (sheets[key] || []).filter(row => String(row['Is Deleted'] || '').toUpperCase() !== 'TRUE').map(row => ({ ...row })),
    findRowIndex_: (key, col, value) => {
      const row = (sheets[key] || []).find(candidate => candidate[col] === value);
      return row ? row._rowIndex : -1;
    },
    appendRow_: (key, row) => {
      const copy = { _rowIndex: (sheets[key] || []).length + 2, ...row };
      (sheets[key] ||= []).push(copy);
      return copy._rowIndex;
    },
    updateRowFields_: (key, rowIndex, fields) => {
      const row = (sheets[key] || []).find(candidate => candidate._rowIndex === rowIndex);
      if (!row) throw new Error(`missing ${key}:${rowIndex}`);
      Object.assign(row, fields);
    },
    markRowDeleted_: (key, rowIndex) => {
      const row = (sheets[key] || []).find(candidate => candidate._rowIndex === rowIndex);
      if (!row) throw new Error(`missing ${key}:${rowIndex}`);
      row['Is Deleted'] = 'TRUE'; calls.deleted++;
    },
    markMatchingDeleted_: () => { calls.cashReverse++; },
    voidBankEntriesFor_: () => { calls.bankReverse++; },
    generateId_: () => `FIN-${nextId++}`,
    requirePermission_: () => ({ 'Full Name': 'Tester' }),
    requireDeletePermission_: () => ({ 'Full Name': 'Tester' }),
    requireActiveCashSession_: () => { calls.session++; return {}; },
    sanitizeInput_: value => String(value == null ? '' : value).trim(),
    isValidNonNegativeNumber_: value => value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) >= 0,
    roundMoney_: roundMoney,
    resolveBankAccount_: (method, id) => method === 'Bank' || method === 'Mobile Banking' ? { id: id || 'B1', name: 'Bank' } : { id: '', name: '' },
    resolveTransactionDate_: () => ({ dateStr: '2026-09-15', isBackdated: false, backdatedDays: 0, reason: '' }),
    resolveEditedTransactionDate_: (token, module, requested, original) => requested || original || '2026-09-15',
    actorName_: () => 'Tester',
    addCashBookEntry_: () => { calls.cashPost++; },
    addBankBookEntry_: () => { calls.bankPost++; },
    isBankLikePaymentMethod_: method => method === 'Bank' || method === 'Mobile Banking',
    safeDateOnly_: value => String(value || '').slice(0, 10),
    logDeletion_: () => {},
    ok_: data => ({ success: true, data }),
    fail_: message => ({ success: false, message: String(message) }),
    logError_: () => {}
  };
  vm.createContext(context);
  vm.runInContext(financeSource, context, { filename: 'FinanceModule.gs' });
  vm.runInContext(deleteSource, context, { filename: 'DeleteEngine.gs' });
  // DeleteEngine defines its own generic reversal helpers. Replace only those
  // infrastructure edges so these tests observe whether Finance chooses to reverse.
  context.markMatchingDeleted_ = () => { calls.cashReverse++; };
  context.voidBankEntriesFor_ = () => { calls.bankReverse++; };
  return { context, sheets, calls };
}

const openings = [
  ['Opening Owner Capital', 'OWN'],
  ['Opening Loan', 'LEN'],
  ['Opening Borrower Loan', 'BOR']
];

test('all opening transaction types bypass cash session and money books and canonicalize forged method/account fields to blank', () => {
  const { context, sheets, calls } = runtime();
  for (const [transactionType, personId] of openings) {
    const result = context.addFinanceTransaction('T', {
      transactionType, personId, amount: 100,
      paymentMethod: 'Bank', bankAccountId: 'FORGED'
    });
    assert.equal(result.success, true, result.message);
  }
  assert.equal(calls.session, 0);
  assert.equal(calls.cashPost, 0);
  assert.equal(calls.bankPost, 0);
  sheets.FINANCE_TRANSACTIONS.forEach(row => {
    assert.equal(row['Payment Method'], '');
    assert.equal(row['Bank Account ID'], '');
    assert.equal(row['Bank Account Name'], '');
  });
});

test('normal finance transaction still requires an active cash session and posts its money movement', () => {
  const { context, calls } = runtime();
  const result = context.addFinanceTransaction('T', {
    transactionType: 'Owner Investment', personId: 'OWN', amount: 100, paymentMethod: 'Cash'
  });
  assert.equal(result.success, true, result.message);
  assert.equal(calls.session, 1);
  assert.equal(calls.cashPost, 1);
  assert.equal(calls.bankPost, 0);
});

test('normal to opening edit reverses old money once, posts none, and blanks payment fields', () => {
  const { context, sheets, calls } = runtime([{
    'Finance ID': 'FIN-1', Date: '2026-09-15', 'Transaction Type': 'Owner Investment',
    'Person ID': 'OWN', Person: 'Owner', 'Payment Method': 'Cash', Amount: 100
  }]);
  const result = context.updateFinanceTransaction('T', 'FIN-1', {
    transactionType: 'Opening Owner Capital', personId: 'OWN', amount: 150,
    paymentMethod: 'Bank', bankAccountId: 'FORGED'
  });
  assert.equal(result.success, true, result.message);
  assert.equal(calls.session, 1);
  assert.equal(calls.cashReverse, 1);
  assert.equal(calls.bankReverse, 1);
  assert.equal(calls.cashPost + calls.bankPost, 0);
  assert.equal(sheets.FINANCE_TRANSACTIONS[0]['Payment Method'], '');
  assert.equal(sheets.FINANCE_TRANSACTIONS[0]['Bank Account ID'], '');
});

test('opening to normal edit reverses no old money, requires session, and posts new movement', () => {
  const { context, calls } = runtime([{
    'Finance ID': 'FIN-1', Date: '2026-09-15', 'Transaction Type': 'Opening Owner Capital',
    'Person ID': 'OWN', Person: 'Owner', 'Payment Method': '', Amount: 100
  }]);
  const result = context.updateFinanceTransaction('T', 'FIN-1', {
    transactionType: 'Owner Investment', personId: 'OWN', amount: 150, paymentMethod: 'Cash'
  });
  assert.equal(result.success, true, result.message);
  assert.equal(calls.session, 1);
  assert.equal(calls.cashReverse + calls.bankReverse, 0);
  assert.equal(calls.cashPost, 1);
});

test('opening to opening edit does not require session and never touches money books', () => {
  const { context, calls } = runtime([{
    'Finance ID': 'FIN-1', Date: '2026-09-15', 'Transaction Type': 'Opening Loan',
    'Person ID': 'LEN', Person: 'Lender', 'Payment Method': '', Amount: 100
  }]);
  const result = context.updateFinanceTransaction('T', 'FIN-1', {
    transactionType: 'Opening Loan', personId: 'LEN', amount: 125,
    paymentMethod: 'Cash', bankAccountId: 'FORGED'
  });
  assert.equal(result.success, true, result.message);
  assert.equal(calls.session, 0);
  assert.equal(calls.cashReverse + calls.bankReverse + calls.cashPost + calls.bankPost, 0);
});


test('edit rejects changing to a transaction type whose required role the selected person does not have before reversal', () => {
  const { context, calls } = runtime([{
    'Finance ID': 'FIN-1', Date: '2026-09-15', 'Transaction Type': 'Owner Investment',
    'Person ID': 'OWN', Person: 'Owner', 'Payment Method': 'Cash', Amount: 100
  }]);
  const result = context.updateFinanceTransaction('T', 'FIN-1', {
    transactionType: 'Borrower Loan', personId: 'OWN', amount: 100, paymentMethod: 'Cash'
  });
  assert.equal(result.success, false);
  assert.match(result.message, /Borrower/i);
  assert.equal(calls.cashReverse + calls.bankReverse + calls.cashPost + calls.bankPost, 0);
});

test('delete opening soft-deletes only; delete normal requires session and reverses money', () => {
  const opening = runtime([{
    'Finance ID': 'OPEN-1', Date: '2026-09-15', 'Transaction Type': 'Opening Borrower Loan',
    'Person ID': 'BOR', Person: 'Borrower', 'Payment Method': '', Amount: 100
  }]);
  let result = opening.context.deleteFinanceTransaction('T', 'OPEN-1', 'Remove opening');
  assert.equal(result.success, true, result.message);
  assert.equal(opening.calls.session, 0);
  assert.equal(opening.calls.cashReverse + opening.calls.bankReverse, 0);
  assert.equal(String(opening.sheets.FINANCE_TRANSACTIONS[0]['Is Deleted']).toUpperCase(), 'TRUE');

  const normal = runtime([{
    'Finance ID': 'NORM-1', Date: '2026-09-15', 'Transaction Type': 'Borrower Loan',
    'Person ID': 'BOR', Person: 'Borrower', 'Payment Method': 'Cash', Amount: 100
  }]);
  result = normal.context.deleteFinanceTransaction('T', 'NORM-1', 'Remove normal');
  assert.equal(result.success, true, result.message);
  assert.equal(normal.calls.session, 1);
  assert.equal(normal.calls.cashReverse, 1);
  assert.equal(normal.calls.bankReverse, 1);
  assert.equal(String(normal.sheets.FINANCE_TRANSACTIONS[0]['Is Deleted']).toUpperCase(), 'TRUE');
});
