'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync('financeLedger.html', 'utf8');
const getFunction = name => {
  const pattern = new RegExp('  function ' + name + '\\([^\\n]*?\\) \\{[\\s\\S]*?\\n  \\}');
  const match = source.match(pattern);
  assert.ok(match, name + ' exists');
  return match[0];
};
const metadata = source.match(/  var FIN_LED_BALANCE_META = \{[\s\S]*?\n  \};/);
assert.ok(metadata, 'balance mapping exists');

function createHarness() {
  const nodes = {};
  function node(id) {
    if (!nodes[id]) {
      const classes = new Set();
      nodes[id] = {
        id, textContent: '', innerHTML: '', hidden: false,
        classList: {
          add: (...items) => items.forEach(item => classes.add(item)),
          remove: (...items) => items.forEach(item => classes.delete(item)),
          contains: item => classes.has(item)
        }
      };
    }
    return nodes[id];
  }
  const context = {
    document: { getElementById: node },
    finLedState: {
      currencySymbol: '৳', selectedPerson: null, summary: {}
    },
    finLedMoney_: value => '৳' + (Number(value) || 0).toLocaleString('en-US'),
    finLedPersonRoles_: person => person.roles || [],
    escapeHtml: value => String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  };
  vm.createContext(context);
  vm.runInContext([
    metadata[0],
    ...[
      'finLedBalanceMeta_', 'finLedBalanceKind_', 'finLedSetBalanceCardState_',
      'finLedSummaryCard_', 'finLedRenderSummary_',
      'finLedRenderSelectedPersonBalance_'
    ].map(getFunction)
  ].join('\n'), context);
  return { context, node };
}

const summaries = [
  ['finLedCapital', 'ownerCapital', 'positive', 'Credit Balance'],
  ['finLedOwnerAdvance', 'ownerAdvance', 'negative', 'Debit Balance'],
  ['finLedLoan', 'outstandingLoan', 'negative', 'Debit Balance'],
  ['finLedLenderCredit', 'lenderCredit', 'positive', 'Credit Balance'],
  ['finLedBorrowerReceivable', 'borrowerReceivable', 'positive', 'Credit Balance'],
  ['finLedBorrowerCredit', 'borrowerCredit', 'negative', 'Debit Balance']
];

test('every nonzero finance summary card has its approved green/red credit/debit meaning', () => {
  const { context, node } = createHarness();
  const sample = {
    ownerCapital: 100, ownerAdvance: 200, outstandingLoan: 300,
    lenderCredit: 400, borrowerReceivable: 500, borrowerCredit: 600
  };
  context.finLedRenderSummary_(sample);
  for (const [id, key, kind, label] of summaries) {
    assert.equal(node(id).textContent, '৳' + sample[key], id + ' amount preserved');
    assert.ok(node(id + 'Card').classList.contains('is-' + kind), id + ' color');
    assert.equal(node(id + 'Note').textContent, label, id + ' label');
  }
});

test('zero balances are neutral and an amount changing from nonzero clears stale color', () => {
  const { context, node } = createHarness();
  context.finLedRenderSummary_({ outstandingLoan: 9000 });
  assert.ok(node('finLedLoanCard').classList.contains('is-negative'));
  context.finLedRenderSummary_({ outstandingLoan: 0 });
  assert.ok(node('finLedLoanCard').classList.contains('is-neutral'));
  assert.ok(!node('finLedLoanCard').classList.contains('is-negative'));
  assert.equal(node('finLedLoanNote').textContent, '');
  assert.equal(node('finLedLoan').textContent, '৳0');
});

test('selected person cards use the same semantics across lender and borrower roles', () => {
  const { context, node } = createHarness();
  context.finLedState.selectedPerson = { name: 'Sufia Apa', roles: ['Lender', 'Borrower'] };
  context.finLedState.summary = {
    lenderCredit: 0, outstandingLoan: 90000, borrowerCredit: 0, borrowerReceivable: 6000
  };
  context.finLedRenderSelectedPersonBalance_();
  assert.equal(node('finLedSelectedPersonCard').hidden, false);
  assert.match(node('finLedSelectedPersonBalances').innerHTML, /Outstanding Loan[\s\S]*?৳90,000[\s\S]*?Debit Balance/);
  assert.match(node('finLedSelectedPersonBalances').innerHTML, /Borrower Receivable[\s\S]*?৳6,000[\s\S]*?Credit Balance/);
  assert.match(node('finLedSelectedPersonBalances').innerHTML, /is-negative/);
  assert.match(node('finLedSelectedPersonBalances').innerHTML, /is-positive/);
});

test('selected person zero and missing person remain safe', () => {
  const { context, node } = createHarness();
  context.finLedState.selectedPerson = { name: 'Zero', roles: ['Owner'] };
  context.finLedState.summary = { ownerCapital: 0, ownerAdvance: 0 };
  context.finLedRenderSelectedPersonBalance_();
  assert.match(node('finLedSelectedPersonBalances').innerHTML, /is-neutral/);
  context.finLedState.selectedPerson = null;
  context.finLedRenderSelectedPersonBalance_();
  assert.equal(node('finLedSelectedPersonCard').hidden, true);
});

test('previous ledger columns, money-in/out hints, and print/export are preserved', () => {
  const header = source.match(/<thead>[\s\S]*?<\/thead>/);
  assert.ok(header);
  assert.equal((header[0].match(/<th\b/g) || []).length, 11);
  assert.match(source, /finLedMoneyCell_\(r, 'debit'\)/);
  assert.match(source, /finLedMoneyCell_\(r, 'credit'\)/);
  assert.match(source, /data-act="menuTxn"/);
  assert.match(source, /printLedgerRange/);
  assert.match(source, /exportRowsToCsv/);
  assert.match(source, /--color-success/);
  assert.match(source, /--color-danger/);
  assert.match(source, /color-mix/);
});
