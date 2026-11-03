'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const supplierLedger = read('supplierLedger.html');
const supplierList = read('suppliers.html');
const sharedJs = read('javascript.html');

function section(src, first, after) {
  const start = src.indexOf(first), end = src.indexOf(after, start + first.length);
  assert.ok(start !== -1 && end > start, 'missing application function boundary');
  return src.slice(start, end);
}

const balanceFunctions = section(sharedJs, '  // UI-only: all ledgers retain', '  function partyLedgerPrintStatement_');
const renderLedger = section(supplierLedger, '  function supplierLedgerRender_() {', '  function supplierLedgerActionAllowed_');
const renderList = section(supplierList, '  function supRender() {', "  document.getElementById('supSearch').addEventListener");
const recalcLedger = section(supplierLedger, '  function supplierLedgerPaymentRecalc_() {', '  function supplierLedgerOpenPayment_() {');
const recalcList = section(supplierList, '  function supPayRecalc_() {', '  function supConfigureOpeningBalance_() {');

function node() {
  const classes = new Set();
  return {
    textContent: '', value: '', hidden: false, disabled: false, checked: false,
    innerHTML: '', children: [], style: {},
    classList: {
      add(name) { classes.add(name); },
      remove(...names) { names.forEach(x => classes.delete(x)); },
      contains(name) { return classes.has(name); }
    },
    appendChild(child) { this.children.push(child); }
  };
}
function environment() {
  const nodes = new Map();
  const el = id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
  const document = {
    getElementById: el, querySelector: el,
    createElement: () => node()
  };
  const c = vm.createContext({
    document,
    formatMoney: value => '৳' + Number(value).toFixed(2),
    escapeHtml: value => String(value),
    supplierLedgerState: {
      party: null, partyCombo: null, rows: [], page: {},
      pageSize: 50, canViewCorrections: false, showCorrections: false
    },
    supplierLedgerCan_: () => true,
    supplierLedgerRenderRows_: () => {},
    supplierLedgerRenderPagination_: () => {},
    supState: {suppliers: [], detailDue: 0},
    supCanSettlementDiscount_: () => true,
    phoneSearchMatches_: () => false,
  });
  vm.runInContext(balanceFunctions + renderLedger + renderList + recalcLedger + recalcList, c);
  return {c, el};
}

test('supplier balance card shows payable as red Credit and receivable as green Debit', () => {
  assert.match(supplierLedger, /id="supplierLedgerBalanceLabel"/);
  const {c, el} = environment();
  const cases = [
    { balance: 1200, label: 'Supplier Payable', value: 'Credit ৳1200.00', note: 'Credit Balance', tone: 'ledger-tone--due' },
    { balance: -150, label: 'Supplier Receivable', value: 'Debit ৳150.00', note: 'Debit Balance', tone: 'ledger-tone--advance' },
    { balance: 0, label: 'Supplier Balance', value: '৳0.00', note: '', tone: 'ledger-tone--neutral' }
  ];
  for (const item of cases) {
    const party = {id:'s-1', name:'Supplier', balance:item.balance, canPay:true};
    c.supplierLedgerState.party = party;
    c.supplierLedgerRender_();
    assert.equal(el('supplierLedgerBalanceLabel').textContent, item.label);
    assert.equal(el('supplierLedgerBalance').textContent, item.value);
    assert.equal(el('supplierLedgerBalanceNote').textContent, item.note);
    assert.equal(el('supplierLedgerBalanceNote').hidden, !item.note);
    assert.ok(el('supplierLedgerBalance').classList.contains(item.tone));
    assert.ok(el('#supplierLedgerSelected .party-ledger-balance-box').classList.contains(item.tone));
    assert.equal(party.balance, item.balance, 'UI must not mutate accounting balance');
  }
});

test('supplier directory shows Credit/red for payable and Debit/green for receivable', () => {
  const {c, el} = environment();
  c.supState.suppliers = [
    {'Supplier ID':'p','Supplier Name':'Payable','Phone':'','Address':'','Status':'Active','Current Due':800},
    {'Supplier ID':'r','Supplier Name':'Receivable','Phone':'','Address':'','Status':'Active','Current Due':-90}
  ];
  c.supRender();
  const rows = el('supTableBody').children;
  assert.equal(rows.length, 2);
  assert.match(rows[0].innerHTML, /badge-danger">Credit ৳800\.00/);
  assert.match(rows[1].innerHTML, /badge-success">Debit ৳90\.00/);
});

test('supplier payment previews change from Credit payable to Debit receivable across zero', () => {
  const {c, el} = environment();
  c.supplierLedgerState.party = {balance:100};
  c.supState.detailDue = 100;
  for (const [payment, expected, tone] of [
    [40, 'Credit ৳60.00', 'ledger-tone--due'],
    [150, 'Debit ৳50.00', 'ledger-tone--advance'],
    [100, '৳0.00', 'ledger-tone--neutral']
  ]) {
    for (const prefix of ['supplierLedger', 'sup']) {
      el(prefix === 'sup' ? 'supPayAmount' : 'supplierLedgerPayAmount').value = String(payment);
      el(prefix === 'sup' ? 'supPayDiscount' : 'supplierLedgerPayDiscount').value = '0';
    }
    c.supplierLedgerPaymentRecalc_();
    c.supPayRecalc_();
    assert.equal(el('supplierLedgerPayBalanceAfter').textContent, expected);
    assert.equal(el('supPayBalanceAfter').textContent, expected);
    assert.ok(el('supplierLedgerPayBalanceAfter').classList.contains(tone));
    assert.ok(el('supPayBalanceAfter').classList.contains(tone));
  }
});
