'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const financeSource = fs.readFileSync(path.join(root, 'FinanceModule.gs'), 'utf8');
const configSource = fs.readFileSync(path.join(root, 'Config.gs'), 'utf8');

function roundMoney(value) { return Math.round((Number(value) + Number.EPSILON) * 100) / 100; }

function runtime(initialPersons = []) {
  const sheets = {
    FINANCE_PERSONS: initialPersons.map((row, index) => ({ _rowIndex: index + 2, ...row })),
    FINANCE_TRANSACTIONS: [], CASH_BOOK: [], BANK_BOOK: []
  };
  let nextId = 1;
  let writes = 0;
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
      writes++;
      const copy = { _rowIndex: (sheets[key] || []).length + 2, ...row };
      (sheets[key] ||= []).push(copy);
      return copy._rowIndex;
    },
    updateRowFields_: (key, rowIndex, fields) => {
      writes++;
      const row = (sheets[key] || []).find(candidate => candidate._rowIndex === rowIndex);
      if (!row) throw new Error('row missing');
      Object.assign(row, fields);
    },
    generateId_: () => `FP${nextId++}`,
    requirePermission_: () => ({ 'Full Name': 'Tester' }),
    requireActiveCashSession_: () => ({}),
    sanitizeInput_: value => String(value == null ? '' : value).trim(),
    isValidNonNegativeNumber_: value => value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) >= 0,
    roundMoney_: roundMoney,
    resolveBankAccount_: () => ({ id: '', name: '' }),
    resolveTransactionDate_: () => ({ dateStr: '2026-09-15', isBackdated: false, backdatedDays: 0, reason: '' }),
    actorName_: () => 'Tester',
    addCashBookEntry_: () => {},
    addBankBookEntry_: () => {},
    isBankLikePaymentMethod_: method => method === 'Bank' || method === 'Mobile Banking',
    ok_: data => ({ success: true, data }),
    fail_: message => ({ success: false, message: String(message) }),
    logError_: () => {}
  };
  vm.createContext(context);
  vm.runInContext(financeSource, context, { filename: 'FinanceModule.gs' });
  return { context, sheets, writes: () => writes };
}

test('FINANCE_PERSONS schema appends Roles after legacy Person Type', () => {
  assert.match(configSource, /FINANCE_PERSONS:\s*\[\s*[\s\S]*?"Person Type",\s*"Roles",\s*"Phone"/);
});

test('role parser uses canonical multi-role order and falls back to legacy Person Type', () => {
  const { context } = runtime();
  assert.deepEqual(Array.from(context.financePersonRoles_({ Roles: 'Borrower,Owner,Borrower', 'Person Type': 'Lender' })), ['Owner', 'Borrower']);
  assert.deepEqual(Array.from(context.financePersonRoles_({ Roles: '', 'Person Type': 'Lender' })), ['Lender']);
  assert.deepEqual(Array.from(context.financePersonRoles_({ Roles: 'Unknown', 'Person Type': 'Owner' })), ['Owner']);
  assert.deepEqual(Array.from(context.financePersonRoles_({ Roles: '', 'Person Type': '' })), ['Owner']);
  assert.equal(context.financePersonHasRole_({ Roles: 'Owner,Borrower', 'Person Type': 'Owner' }, 'Borrower'), true);
  assert.equal(context.financePersonHasRole_({ Roles: '', 'Person Type': 'Owner' }, 'Lender'), false);
});

test('finance person UI shape includes canonical roles and phone without dropping legacy type', () => {
  const { context } = runtime([
    { 'Person ID': 'P1', 'Person Name': 'Legacy', 'Person Type': 'Lender', Roles: '', Phone: '01700', Status: 'Active' },
    { 'Person ID': 'P2', 'Person Name': 'Multi', 'Person Type': 'Owner', Roles: 'Borrower,Owner', Phone: '01800', Status: 'Inactive' }
  ]);
  const people = context.getAllFinancePersonsForUI_();
  assert.deepEqual(Array.from(people[0].roles), ['Lender']);
  assert.equal(people[0].type, 'Lender');
  assert.equal(people[0].phone, '01700');
  assert.deepEqual(Array.from(people[1].roles), ['Owner', 'Borrower']);
});

test('addFinancePerson requires roles and stores canonical Roles plus first legacy Person Type', () => {
  const { context, sheets } = runtime();
  const missing = context.addFinancePerson('T', { name: 'No Role', roles: [] });
  assert.equal(missing.success, false);
  assert.match(missing.message, /role/i);

  const result = context.addFinancePerson('T', { name: 'Combo', roles: ['Borrower', 'Owner', 'Borrower'], phone: '01900' });
  assert.equal(result.success, true, result.message);
  assert.equal(sheets.FINANCE_PERSONS[0]['Person Type'], 'Owner');
  assert.equal(sheets.FINANCE_PERSONS[0].Roles, 'Owner,Borrower');
  assert.equal(sheets.FINANCE_PERSONS[0].Phone, '01900');
});

test('setFinancePersonRoles updates canonical roles and legacy type but rejects inactive people', () => {
  const { context, sheets } = runtime([
    { 'Person ID': 'P1', 'Person Name': 'Active', 'Person Type': 'Owner', Roles: 'Owner', Status: 'Active' },
    { 'Person ID': 'P2', 'Person Name': 'Inactive', 'Person Type': 'Lender', Roles: 'Lender', Status: 'Inactive' }
  ]);
  const ok = context.setFinancePersonRoles('T', 'P1', ['Borrower', 'Lender']);
  assert.equal(ok.success, true, ok.message);
  assert.equal(sheets.FINANCE_PERSONS[0].Roles, 'Lender,Borrower');
  assert.equal(sheets.FINANCE_PERSONS[0]['Person Type'], 'Lender');

  const inactive = context.setFinancePersonRoles('T', 'P2', ['Owner']);
  assert.equal(inactive.success, false);
  assert.match(inactive.message, /inactive/i);
});

test('server rejects a transaction when the selected active person lacks the required role before any write', () => {
  const { context, writes } = runtime([
    { 'Person ID': 'P1', 'Person Name': 'Owner Only', 'Person Type': 'Owner', Roles: 'Owner', Status: 'Active' }
  ]);
  const result = context.addFinanceTransaction('T', {
    transactionType: 'Borrower Loan', personId: 'P1', amount: 100, paymentMethod: 'Cash'
  });
  assert.equal(result.success, false);
  assert.match(result.message, /Borrower/i);
  assert.equal(writes(), 0);
});

test('finance person UI shape exposes Description with legacy Notes fallback', () => {
  const { context } = runtime([
    { 'Person ID': 'P1', 'Person Name': 'Legacy Notes', 'Person Type': 'Lender', Roles: 'Lender', Phone: '01711', Description: '', Notes: 'Old lender note', Status: 'Active' },
    { 'Person ID': 'P2', 'Person Name': 'New Description', 'Person Type': 'Borrower', Roles: 'Borrower', Phone: '01811', Description: 'Primary borrower', Notes: 'Old ignored note', Status: 'Active' }
  ]);
  const people = context.getAllFinancePersonsForUI_();
  assert.equal(people[0].description, 'Old lender note');
  assert.equal(people[1].description, 'Primary borrower');
});

test('addFinancePerson stores phone and Description as finance person master data', () => {
  const { context, sheets } = runtime();
  const result = context.addFinancePerson('T', {
    name: 'BRAC Bank', roles: ['Lender'], phone: '096123', description: 'Business term loan, Gulshan branch'
  });
  assert.equal(result.success, true, result.message);
  assert.equal(sheets.FINANCE_PERSONS[0].Phone, '096123');
  assert.equal(sheets.FINANCE_PERSONS[0].Description, 'Business term loan, Gulshan branch');
});

test('updateFinancePerson edits name phone description and roles without changing the person ID', () => {
  const { context, sheets } = runtime([
    { 'Person ID': 'P1', 'Person Name': 'Old Name', 'Person Type': 'Lender', Roles: 'Lender', Phone: '01700', Description: 'Old description', Status: 'Active' },
    { 'Person ID': 'P2', 'Person Name': 'Other', 'Person Type': 'Owner', Roles: 'Owner', Phone: '', Description: '', Status: 'Active' }
  ]);
  const result = context.updateFinancePerson('T', 'P1', {
    name: 'Updated Name', phone: '01900', description: 'Updated description', roles: ['Borrower', 'Lender']
  });
  assert.equal(result.success, true, result.message);
  assert.equal(sheets.FINANCE_PERSONS[0]['Person ID'], 'P1');
  assert.equal(sheets.FINANCE_PERSONS[0]['Person Name'], 'Updated Name');
  assert.equal(sheets.FINANCE_PERSONS[0].Phone, '01900');
  assert.equal(sheets.FINANCE_PERSONS[0].Description, 'Updated description');
  assert.equal(sheets.FINANCE_PERSONS[0].Roles, 'Lender,Borrower');
  assert.equal(sheets.FINANCE_PERSONS[0]['Person Type'], 'Lender');

  const duplicate = context.updateFinancePerson('T', 'P1', { name: 'Other', roles: ['Lender'] });
  assert.equal(duplicate.success, false);
  assert.match(duplicate.message, /already exists/i);
});
