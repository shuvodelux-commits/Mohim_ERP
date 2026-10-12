'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const supplier = fs.readFileSync('supplierLedger.html', 'utf8');
const style = fs.readFileSync('style.html', 'utf8');

function createRenderer() {
  const match = supplier.match(/  function supplierLedgerAmountCell_\(row, column\) \{[\s\S]*?\n  \}/);
  assert.ok(match, 'supplier ledger amount renderer exists');
  const ctx = {
    formatMoney: v => '৳' + Number(v).toLocaleString('en-US'),
    escapeHtml: v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  };
  vm.createContext(ctx);
  vm.runInContext(match[0], ctx);
  return (type, column, amount, extras) =>
    ctx.supplierLedgerAmountCell_(Object.assign({'Type':type, [column]:amount}, extras || {}), column);
}

test('purchase invoice Debit shows red invoice label without claiming money went out', () => {
  const render = createRenderer();
  const html = render('Purchase','Debit',12500);
  assert.match(html, /is-purchase-invoice/);
  assert.match(html, /৳12,500[\s\S]*Purchase Invoice/);
  assert.doesNotMatch(html, /Money Out|Money In/);
  assert.match(style, /\.is-purchase-invoice,[\s\S]*color:var\(--color-danger\)/);
});

test('paid-on-invoice appears only for authoritative synthetic purchase projection Credit', () => {
  const render = createRenderer();
  const invoice = render('Purchase','Credit',7000,{_synthetic:true});
  assert.match(invoice, /is-invoice-payment/);
  assert.match(invoice, /৳7,000[\s\S]*Paid on Invoice/);
  assert.doesNotMatch(invoice, /Purchase Invoice/);
  const unprojected = render('Purchase','Credit',500,{_synthetic:false});
  assert.doesNotMatch(unprojected, /Paid on Invoice|Money Out/);
});

test('purchase return credit is green and never marked as incoming cash', () => {
  const html = createRenderer()('Purchase Return Credit','Credit',1600);
  assert.match(html, /is-purchase-return/);
  assert.match(html, /Purchase Return/);
  assert.match(style, /\.is-purchase-return,[\s\S]*color:var\(--color-success\)/);
  assert.doesNotMatch(html, /Money In|Money Out/);
});

test('purchase corrections distinguish payable increase and decrease without false money labels', () => {
  const render = createRenderer();
  const inc = render('Purchase Update','Debit',300);
  const dec = render('Purchase Update','Credit',150);
  assert.match(inc, /is-purchase-adjust-increase[\s\S]*Due Increased/);
  assert.match(dec, /is-purchase-adjust-decrease[\s\S]*Due Reduced/);
  assert.doesNotMatch(inc + dec, /Money In|Money Out/);
});

test('supplier payment, discount-only adjustment and opening retain their established labels', () => {
  const render = createRenderer();
  assert.match(render('Payment','Credit',250,{'Payment Amount':230,'Discount Amount':20}), /is-out[\s\S]*Money Out/);
  assert.match(render('Payment','Credit',20,{'Payment Amount':0,'Discount Amount':20}), /is-adjustment[\s\S]*Adjustment/);
  assert.match(render('Opening Balance','Debit',500), /is-opening[\s\S]*Opening/);
  assert.match(render('Opening Balance','Credit',200), /is-opening[\s\S]*Opening/);
});

test('unknown types and zero values stay plain and neutral', () => {
  const render = createRenderer();
  const oldRow = render('Legacy Correction','Debit',600);
  assert.equal(oldRow, '৳600');
  assert.equal(render('Purchase','Debit',0),'');
  assert.doesNotMatch(oldRow, /Money|Purchase|Due Increased|Due Reduced/);
});

test('supplier ledger table and transactions remain structurally unchanged', () => {
  const header = supplier.match(/<thead>[\s\S]*?<\/thead>/);
  assert.ok(header);
  assert.equal((header[0].match(/<th\b/g)||[]).length,7);
  ['Date','Type','Reference','Debit','Credit','Balance'].forEach(label => assert.ok(header[0].includes(label),label));
  assert.match(supplier, /supplierLedgerAmountCell_\(row, 'Debit'\)/);
  assert.match(supplier, /supplierLedgerAmountCell_\(row, 'Credit'\)/);
  assert.match(supplier, /row\.availableActions/);
  assert.match(supplier, /partyLedgerBalanceTone_\(row\['Balance'\]\)/);
  assert.match(supplier, /Discount Amount/);
  assert.match(supplier, /Payment [^\n]*Discount/);
  assert.doesNotMatch(supplier,/updateRowFields_\(|appendRow_\(/);
});
