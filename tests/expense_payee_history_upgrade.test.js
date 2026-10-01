'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

function test(name, fn) {
  try { fn(); console.log('PASS', name); }
  catch (err) { console.error('FAIL', name, '-', err.message); process.exitCode = 1; }
}

const config = read('Config.gs');
const settingsSrc = read('ExpenseSettings.gs');
const expenseSrc = read('Expense.gs');
const expensePage = read('expense.html');
const historyPage = read('expenseList.html');
const ui = read('UI.gs');

function fixture() {
  const sheets = {
    EXPENSE_PAYEES: [
      { 'Payee ID':'P1', 'Payee Name':'Landlord', Phone:'0171', Notes:'Rent', Status:'Active', 'Created At':'2026-09-01', 'Is Deleted':'' },
      { 'Payee ID':'P2', 'Payee Name':'Utility', Phone:'0181', Notes:'Power', Status:'Inactive', 'Created At':'2026-09-01', 'Is Deleted':'' },
      { 'Payee ID':'P3', 'Payee Name':'Old Name', Phone:'0191', Notes:'Old', Status:'Active', 'Created At':'2026-09-01', 'Is Deleted':'TRUE' }
    ],
    EXPENSES: [
      { 'Expense ID':'E1', 'Ledger ID':'P3', 'Ledger Name':'Old Name', Amount:500, Status:'Active' }
    ]
  };
  let locked = false;
  let seq = 3;
  const actor = { 'Full Name':'Audit User' };
  const rows = key => sheets[key] || (sheets[key] = []);
  const ctx = {
    console,
    CONFIG:{ LOCK_TIMEOUT_MS:1 },
    LockService:{ getScriptLock:()=>({ waitLock(){ assert.equal(locked,false); locked=true; }, releaseLock(){ locked=false; } }) },
    getAllRows_: key => rows(key).map((r,i)=>({ ...r, _rowIndex:i+2 })),
    activeRows_: key => rows(key).filter(r => String(r['Is Deleted']||'').toUpperCase() !== 'TRUE').map((r,i)=>({ ...r, _rowIndex: rows(key).indexOf(r)+2 })),
    isDeleted_: row => String(row && row['Is Deleted'] || '').toUpperCase() === 'TRUE',
    findRowIndex_: (key,col,val) => { const i=rows(key).findIndex(r=>r[col]===val); return i<0?-1:i+2; },
    updateRowFields_: (key,index,fields) => Object.assign(rows(key)[index-2], fields),
    appendRow_: (key,row) => { rows(key).push({ ...row }); return rows(key).length+1; },
    generateId_: () => 'P' + (++seq),
    sanitizeInput_: v => String(v == null ? '' : v).trim(),
    requirePermission_: () => actor,
    requireDeletePermission_: () => actor,
    markRowDeleted_: (key,index,user,reason) => Object.assign(rows(key)[index-2], { 'Is Deleted':'TRUE','Deleted By':user['Full Name'],'Deleted At':'NOW','Delete Reason':reason }),
    logDeletion_: () => {},
    logError_: () => {},
    ok_: data => ({ success:true, data }),
    fail_: message => ({ success:false, message })
  };
  vm.createContext(ctx);
  vm.runInContext(settingsSrc, ctx, { filename:'ExpenseSettings.gs' });
  return { ctx, sheets };
}

function success(res) { assert.equal(res.success, true, res.message); return res.data; }

test('EXPENSE_PAYEES schema includes soft-delete audit columns', () => {
  const block = config.match(/EXPENSE_PAYEES:\s*\[[\s\S]*?\n\s*\],/);
  assert(block, 'schema block missing');
  for (const col of ['Is Deleted','Deleted By','Deleted At','Delete Reason']) assert(block[0].includes(col), col + ' missing');
});

test('active payee selectors exclude inactive and soft-deleted payees', () => {
  assert.match(settingsSrc, /function getActiveExpensePayeesForUI_\([\s\S]*?(activeRows_|isDeleted_)/);
  assert.match(expenseSrc, /function getExpensePayeesForUI_\([\s\S]*?(activeRows_|isDeleted_)/);
  assert.match(expenseSrc, /Payee not found or inactive/);
});

test('deleted payee name can be recreated while live duplicate is rejected', () => {
  const f = fixture();
  assert.equal(f.ctx.addExpensePayee('T', { name:'Landlord' }).success, false);
  const created = success(f.ctx.addExpensePayee('T', { name:'Old Name', phone:'011' }));
  assert.equal(created.name, 'Old Name');
  assert.equal(f.sheets.EXPENSE_PAYEES.at(-1)['Payee Name'], 'Old Name');
});

test('payee edit, deactivate/reactivate and soft delete preserve expense history', () => {
  const f = fixture();
  success(f.ctx.updateExpensePayee('T','P1',{ name:'Property Owner', phone:'0172', notes:'Updated' }));
  assert.equal(f.sheets.EXPENSE_PAYEES[0]['Payee Name'], 'Property Owner');
  success(f.ctx.setExpensePayeeStatus('T','P1','Inactive'));
  assert.equal(f.sheets.EXPENSE_PAYEES[0].Status, 'Inactive');
  success(f.ctx.setExpensePayeeStatus('T','P1','Active'));
  assert.equal(f.sheets.EXPENSE_PAYEES[0].Status, 'Active');
  assert.equal(f.ctx.deleteExpensePayee('T','P1','').success, false, 'delete reason must be required');
  success(f.ctx.deleteExpensePayee('T','P1','Duplicate payee'));
  assert.equal(f.sheets.EXPENSE_PAYEES[0]['Is Deleted'], 'TRUE');
  assert.equal(f.sheets.EXPENSE_PAYEES[0]['Delete Reason'], 'Duplicate payee');
  assert.deepEqual(f.sheets.EXPENSES[0], { 'Expense ID':'E1', 'Ledger ID':'P3', 'Ledger Name':'Old Name', Amount:500, Status:'Active' });
  assert.equal(f.ctx.setExpensePayeeStatus('T','P1','Active').success, false, 'deleted payee must not be reactivated');
});

test('payee management list shows active and inactive but hides deleted masters', () => {
  const f = fixture();
  const rows = success(f.ctx.getExpensePayeesManagement('T'));
  assert.deepEqual(Array.from(rows, r => r.id), ['P1','P2']);
  assert.equal(rows[1].status, 'Inactive');
});

test('Expenses sidebar merges list and ledger into one Expense History page', () => {
  assert.match(ui, /key:\s*'expenseList',\s*label:\s*'Expense History'/);
  const expenseGroup = ui.match(/key:\s*'expense', label:\s*'Expenses'[\s\S]*?\n\s*\]\n\s*\}/);
  assert(expenseGroup, 'expense nav group missing');
  assert.doesNotMatch(expenseGroup[0], /key:\s*'expenseLedger'/);
});

test('Expense History consumes ledger data and includes management actions plus print/export and running total', () => {
  assert.match(historyPage, /Expense History/);
  assert.match(historyPage, /serverCall\('getExpenseLedger'/);
  assert.match(historyPage, /Running Total/);
  assert.match(historyPage, /expHistTotal/);
  assert.match(historyPage, /expHistFilteredTotal/);
  assert.match(historyPage, /expHistCount/);
  assert.match(historyPage, /printLedgerRange/);
  assert.match(historyPage, /exportRowsToCsv/);
  assert.match(historyPage, /action:\s*'edit'/);
  assert.match(historyPage, /action:\s*'delete'/);
});

test('Add Expense exposes Manage Payees with edit, activate/deactivate and soft-delete RPCs', () => {
  for (const marker of ['expManagePayeesBtn','expPayeeManageModal','expPayeeEditModal','getExpensePayeesManagement','updateExpensePayee','setExpensePayeeStatus','deleteExpensePayee']) {
    assert(expensePage.includes(marker), marker + ' missing');
  }
  assert.match(expensePage, /Historical expenses will be preserved/i);
});
