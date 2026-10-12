'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const customer = fs.readFileSync('customerLedger.html', 'utf8');
const supplier = fs.readFileSync('supplierLedger.html', 'utf8');
const style = fs.readFileSync('style.html', 'utf8');

function harness(source, prefix) {
  const funcs = [
    prefix + 'AmountCell_',
    ...(prefix === 'customerLedger' ? [prefix + 'PaintBalanceCard_'] : [])
  ];
  const snippets = funcs.map(name => {
    const match = source.match(new RegExp('  function ' + name + '\\([^\\n]*\\) \\{[\\s\\S]*?\\n  \\}'));
    assert.ok(match, name + ' exists');
    return match[0];
  });
  const nodes = {};
  const getNode = id => {
    if (!nodes[id]) {
      const classes = new Set();
      nodes[id] = {
        classList: {
          add: value => classes.add(value),
          remove: (...values) => values.forEach(value => classes.delete(value)),
          contains: value => classes.has(value)
        },
        hidden: true
      };
    }
    return nodes[id];
  };
  const context = {
    document: {getElementById: getNode},
    formatMoney: value => '৳' + Number(value).toLocaleString('en-US'),
    escapeHtml: value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  };
  vm.createContext(context);
  vm.runInContext(snippets.join('\n'), context);
  return { context, getNode };
}

test('both party ledgers preserve existing seven-column transaction tables and actions', () => {
  for (const source of [customer, supplier]) {
    const header = source.match(/<thead>[\s\S]*?<\/thead>/);
    assert.ok(header);
    assert.equal((header[0].match(/<th\b/g) || []).length, 7);
    ['Date','Type','Reference','Debit','Credit','Balance']
      .forEach(label => assert.ok(header[0].includes(label), label));
    assert.match(source, /openRowActionMenu_/);
    assert.match(source, /partyLedgerBalanceTone_/);
    assert.match(source, /partyLedgerPrintStatement_/);
    assert.match(source, /Discount Amount/);
    assert.match(source, /\+ Discount/);
  }
});

test('customer payment is Money In, credit refund Money Out, and opening is neutral', () => {
  const {context} = harness(customer, 'customerLedger');
  const render = (row, column) => context.customerLedgerAmountCell_(row, column);
  assert.match(render({'Type':'Payment', Credit:100, 'Payment Amount':100}, 'Credit'), /is-in[\s\S]*Money In/);
  assert.match(render({'Type':'Advance Refund', Debit:25}, 'Debit'), /is-out[\s\S]*Money Out/);
  assert.match(render({'Type':'Opening Balance', Debit:50}, 'Debit'), /is-opening[\s\S]*Opening/);
  assert.match(render({'Type':'Opening Balance', Credit:50}, 'Credit'), /is-opening[\s\S]*Opening/);
});

test('supplier payment is Money Out despite credit column; cash-free discount is Adjustment', () => {
  const {context} = harness(supplier, 'supplierLedger');
  const render = (row, column) => context.supplierLedgerAmountCell_(row, column);
  assert.match(render({'Type':'Payment', Credit:300, 'Payment Amount':280, 'Discount Amount':20}, 'Credit'), /is-out[\s\S]*Money Out/);
  assert.match(render({'Type':'Payment', Credit:20, 'Payment Amount':0, 'Discount Amount':20}, 'Credit'), /is-adjustment[\s\S]*Adjustment/);
  assert.match(render({'Type':'Opening Balance', Debit:100}, 'Debit'), /is-opening[\s\S]*Opening/);
});

test('noncash invoice or return is not mislabelled as money movement', () => {
  const customerRender = harness(customer, 'customerLedger').context.customerLedgerAmountCell_;
  const supplierRender = harness(supplier, 'supplierLedger').context.supplierLedgerAmountCell_;
  for (const html of [
    customerRender({'Type':'Sale',Debit:200},'Debit'),
    customerRender({'Type':'Sales Return Credit',Credit:40},'Credit'),
    supplierRender({'Type':'Purchase',Debit:300},'Debit'),
    supplierRender({'Type':'Purchase Return Credit',Credit:60},'Credit')
  ]) {
    assert.match(html, /৳/);
    assert.doesNotMatch(html, /Money In|Money Out|Opening/);
  }
});

test('customer due and customer credit color independently, and zero resets', () => {
  const {context,getNode} = harness(customer, 'customerLedger');
  context.customerLedgerPaintBalanceCard_('due','dueNote',100,'is-receivable');
  context.customerLedgerPaintBalanceCard_('credit','creditNote',50,'is-payable');
  assert.ok(getNode('due').classList.contains('is-receivable'));
  assert.ok(getNode('credit').classList.contains('is-payable'));
  assert.equal(getNode('dueNote').hidden,false);
  context.customerLedgerPaintBalanceCard_('due','dueNote',0,'is-receivable');
  assert.ok(getNode('due').classList.contains('is-neutral'));
  assert.equal(getNode('dueNote').hidden,true);
  assert.ok(!getNode('due').classList.contains('is-receivable'));
});

test('semantic labels/cards use existing theme colors; no ledger backend changes', () => {
  assert.match(customer, /id="customerLedgerDueCard"/);
  assert.match(customer, /id="customerLedgerCreditCard"/);
  assert.match(supplier, /id="supplierLedgerBalanceNote"/);
  assert.match(supplier, /'To Pay'/);
  assert.match(supplier, /'Credit Available'/);
  assert.match(style, /#page-customerLedger \.party-ledger-balance-item\.is-receivable/);
  assert.match(style, /#page-customerLedger \.party-ledger-balance-item\.is-payable/);
  assert.match(style, /--color-success/);
  assert.match(style, /--color-danger/);
});
