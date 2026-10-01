'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function financeRuntime(rows) {
  const context = {
    console,
    roundMoney_: roundMoney,
    activeRows_: key => key === 'FINANCE_TRANSACTIONS'
      ? rows.filter(row => !(row['Is Deleted'] === true || String(row['Is Deleted'] || '').toUpperCase() === 'TRUE'))
      : []
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'FinanceModule.gs'), 'utf8'), context, { filename: 'FinanceModule.gs' });
  return context;
}

function bankRuntime(accounts) {
  const sheets = {
    BANK_ACCOUNTS: accounts.map((row, index) => ({ _rowIndex: index + 2, ...row })),
    BANK_BOOK: [],
    BANK_TRANSFERS: []
  };
  const calls = { reads: {}, writes: [] };
  let nextId = 1;
  const read = key => {
    calls.reads[key] = (calls.reads[key] || 0) + 1;
    return sheets[key] || [];
  };
  const context = {
    console,
    CONFIG: { LOCK_TIMEOUT_MS: 1000 },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    getAllRows_: read,
    findRowIndex_: (key, column, value) => {
      const row = read(key).find(candidate => candidate[column] === value);
      return row ? row._rowIndex : -1;
    },
    appendRow_: (key, row) => {
      const copy = { _rowIndex: (sheets[key] || []).length + 2, ...row };
      (sheets[key] ||= []).push(copy);
      calls.writes.push({ operation: 'append', key, row: copy });
      return copy._rowIndex;
    },
    updateRowFields_: (key, rowIndex, fields) => {
      const row = (sheets[key] || []).find(candidate => candidate._rowIndex === rowIndex);
      if (!row) throw new Error(`Missing ${key} row ${rowIndex}`);
      Object.assign(row, fields);
      calls.writes.push({ operation: 'update', key, rowIndex, fields: { ...fields } });
    },
    generateId_: key => `${key}-${nextId++}`,
    requirePermission_: () => ({ 'Full Name': 'Tester' }),
    requireActiveCashSession_: () => ({ id: 'SESSION-1' }),
    isValidNonNegativeNumber_: value => value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) >= 0,
    sanitizeInput_: value => String(value == null ? '' : value).trim(),
    actorName_: user => user['Full Name'],
    roundMoney_: roundMoney,
    ok_: data => ({ success: true, data }),
    fail_: message => ({ success: false, message: String(message) }),
    logError_: () => {}
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'BankBook.gs'), 'utf8'), context, { filename: 'BankBook.gs' });
  return { context, sheets, calls };
}

test('owner capital follows investment minus withdrawal and ignores deleted rows', () => {
  const context = financeRuntime([
    { 'Transaction Type': 'Opening Owner Capital', Amount: 1000 },
    { 'Transaction Type': 'Owner Investment', Amount: 250 },
    { 'Transaction Type': 'Owner Withdrawal', Amount: 100 },
    { 'Transaction Type': 'Owner Investment', Amount: 900, 'Is Deleted': 'TRUE' },
    { 'Transaction Type': 'Loan Received', Amount: 500 }
  ]);

  assert.equal(context.getOwnerCapital_(), 1150);
});

test('outstanding loan follows receipts minus repayments and ignores capital rows', () => {
  const context = financeRuntime([
    { 'Transaction Type': 'Opening Loan', Amount: 1000 },
    { 'Transaction Type': 'Loan Received', Amount: 250 },
    { 'Transaction Type': 'Loan Repayment', Amount: 400 },
    { 'Transaction Type': 'Owner Investment', Amount: 500 }
  ]);

  assert.equal(context.getOutstandingLoan_(), 850);
});

test('finance balances return currency values rounded to two decimals', () => {
  const context = financeRuntime([
    { 'Transaction Type': 'Owner Investment', Amount: 0.1 },
    { 'Transaction Type': 'Owner Investment', Amount: 0.2 },
    { 'Transaction Type': 'Loan Received', Amount: 10.1 },
    { 'Transaction Type': 'Loan Received', Amount: 10.2 }
  ]);

  assert.equal(context.getOwnerCapital_(), 0.3);
  assert.equal(context.getOutstandingLoan_(), 20.3);
});

test('bank transfer conserves combined balance and writes one entry per account', () => {
  const { context, sheets } = bankRuntime([
    { 'Bank Account ID': 'B1', 'Account Name': 'Cash Bank', 'Current Balance': 1000, Status: 'Active' },
    { 'Bank Account ID': 'B2', 'Account Name': 'Mobile Wallet', 'Current Balance': 200, Status: 'Active' }
  ]);

  const result = context.transferBetweenBankAccounts('TOKEN', {
    fromAccountId: 'B1', toAccountId: 'B2', amount: 125.5, notes: 'Move funds'
  });

  assert.equal(result.success, true);
  assert.equal(sheets.BANK_ACCOUNTS[0]['Current Balance'], 874.5);
  assert.equal(sheets.BANK_ACCOUNTS[1]['Current Balance'], 325.5);
  assert.equal(sheets.BANK_ACCOUNTS.reduce((sum, row) => sum + row['Current Balance'], 0), 1200);
  assert.equal(sheets.BANK_BOOK.length, 2);
  assert.equal(sheets.BANK_TRANSFERS.length, 1);
});

test('invalid bank transfer finishes validation without writing', () => {
  const { context, calls } = bankRuntime([
    { 'Bank Account ID': 'B1', 'Account Name': 'Cash Bank', 'Current Balance': 1000, Status: 'Active' }
  ]);

  const result = context.transferBetweenBankAccounts('TOKEN', {
    fromAccountId: 'B1', toAccountId: 'MISSING', amount: 50
  });

  assert.equal(result.success, false);
  assert.equal(calls.writes.length, 0);
});

test('bank transfer rejects an inactive source or destination before writing', () => {
  const { context, calls } = bankRuntime([
    { 'Bank Account ID': 'B1', 'Account Name': 'Inactive Bank', 'Current Balance': 100, Status: 'Inactive' },
    { 'Bank Account ID': 'B2', 'Account Name': 'Active Bank', 'Current Balance': 100, Status: 'Active' }
  ]);

  const result = context.transferBetweenBankAccounts('TOKEN', {
    fromAccountId: 'B1', toAccountId: 'B2', amount: 10
  });

  assert.equal(result.success, false);
  assert.match(result.message, /inactive/i);
  assert.equal(calls.writes.length, 0);
});

test('bank transfer stores both account balances as two-decimal currency values', () => {
  const { context, sheets } = bankRuntime([
    { 'Bank Account ID': 'B1', 'Account Name': 'Cash Bank', 'Current Balance': 0.3, Status: 'Active' },
    { 'Bank Account ID': 'B2', 'Account Name': 'Mobile Wallet', 'Current Balance': 0.1, Status: 'Active' }
  ]);

  const result = context.transferBetweenBankAccounts('TOKEN', {
    fromAccountId: 'B1', toAccountId: 'B2', amount: 0.1
  });

  assert.equal(result.success, true);
  assert.equal(sheets.BANK_ACCOUNTS[0]['Current Balance'], 0.2);
  assert.equal(sheets.BANK_ACCOUNTS[1]['Current Balance'], 0.2);
});

test('combined active bank balance is rounded to two-decimal currency', () => {
  const { context } = bankRuntime([
    { 'Bank Account ID': 'B1', 'Account Name': 'Bank One', 'Current Balance': 0.1, Status: 'Active' },
    { 'Bank Account ID': 'B2', 'Account Name': 'Bank Two', 'Current Balance': 0.2, Status: 'Active' },
    { 'Bank Account ID': 'B3', 'Account Name': 'Inactive', 'Current Balance': 50, Status: 'Inactive' }
  ]);

  assert.equal(context.getTotalBankBalance_(), 0.3);
});

test('bank transfer reads the bank-account sheet once before applying both sides', () => {
  const { context, calls } = bankRuntime([
    { 'Bank Account ID': 'B1', 'Account Name': 'Cash Bank', 'Current Balance': 1000, Status: 'Active' },
    { 'Bank Account ID': 'B2', 'Account Name': 'Mobile Wallet', 'Current Balance': 200, Status: 'Active' }
  ]);

  const result = context.transferBetweenBankAccounts('TOKEN', {
    fromAccountId: 'B1', toAccountId: 'B2', amount: 50
  });

  assert.equal(result.success, true);
  assert.equal(calls.reads.BANK_ACCOUNTS, 1);
});
