'use strict';
const fs = require('fs');
const assert = require('assert');

function read(file) { return fs.readFileSync(file, 'utf8'); }
function test(name, fn) {
  try { fn(); console.log('PASS ' + name); }
  catch (err) { console.error('FAIL ' + name + '\n' + err.stack); process.exitCode = 1; }
}

const pos = read('pos.html');
const purchase = read('purchase.html');
const expenseList = read('expenseList.html');
const customerLedger = read('customerLedger.html');
const supplierLedger = read('supplierLedger.html');
const customers = read('customers.html');
const suppliers = read('suppliers.html');
const finance = read('finance.html');
const financeLedger = read('financeLedger.html');
const bank = read('bank.html');
const returns = read('returns.html');
const vendors = read('vendors.html');
const products = read('products.html');

// High-risk document updates must freeze the record id before the confirmation
// opens. The modal locks the background, but using a captured id also prevents
// asynchronous state refreshes from redirecting a confirmed mutation.
test('Sale update confirmation posts the captured invoice id and frozen payload', () => {
  assert.match(pos, /var\s+targetInvoiceId\s*=\s*posState\.updateInvoiceId\s*\|\|\s*['"]['"]/);
  assert.match(pos, /serverCall\('updateSale',\s*authToken,\s*targetInvoiceId,\s*payload\)/);
});

test('Purchase update confirmation posts the captured purchase id and frozen payload', () => {
  assert.match(purchase, /var\s+targetPurchaseId\s*=\s*purState\.updatePurchaseId\s*\|\|\s*['"]['"]/);
  assert.match(purchase, /serverCall\('updatePurchase',\s*authToken,\s*targetPurchaseId,\s*payload\)/);
});

// This is a concrete regression from the confirmation migration: the page
// captured expListState.editingId but the runner called updateExpense with the
// unrelated expState.editingId global from a different page module.
test('Expense List update confirmation posts the exact captured expense id', () => {
  assert.match(expenseList, /var\s+expenseId\s*=\s*expListState\.editingId\s*;/);
  assert.match(expenseList, /serverCall\('updateExpense',\s*authToken,\s*expenseId,\s*payload\)/);
  assert.doesNotMatch(expenseList, /serverCall\('updateExpense',\s*authToken,\s*expState\.editingId/);
  assert.match(expenseList, /serverCall\('updateExpense',[\s\S]{0,650}expListLoad\(\)/);
  assert.doesNotMatch(expenseList, /serverCall\('updateExpense',[\s\S]{0,650}\bexpLoad\(\)/);
});

// Every confirmation below must submit the same local payload/value set used to
// render the summary. These assertions are intentionally structural: they fail
// if a future refactor starts reading the form again inside the confirmation runner.
test('Customer and supplier settlement confirmations submit captured values', () => {
  assert.match(customers, /runConfirmedAction\([\s\S]{0,2200}serverCall\('receivePayment',\s*authToken,[\s\S]{0,500}amount,[\s\S]{0,500}discountAmount/);
  assert.match(suppliers, /runConfirmedAction\([\s\S]{0,2200}serverCall\('paySupplier',\s*authToken,[\s\S]{0,500}amount,[\s\S]{0,500}discountAmount/);
  assert.match(customerLedger, /runConfirmedAction\([\s\S]{0,2200}serverCall\('updateCustomerPayment',\s*authToken,[\s\S]{0,250}payload\)/);
  assert.match(supplierLedger, /runConfirmedAction\([\s\S]{0,2200}serverCall\('updateSupplierPayment',\s*authToken,[\s\S]{0,250}payload\)/);
});

test('Return confirmations submit the frozen return payload', () => {
  assert.match(returns, /var\s+payloadSingle\s*=\s*\{[\s\S]{0,1800}runConfirmedAction\([\s\S]{0,2600}serverCall\('completeReturn',\s*authToken,\s*payloadSingle\)/);
  assert.match(returns, /var\s+payload\s*=\s*\{[\s\S]{0,1800}runConfirmedAction\([\s\S]{0,2600}serverCall\('completeReturnBatch',\s*authToken,\s*payload\)/);
  assert.match(purchase, /runConfirmedAction\([\s\S]{0,3000}serverCall\(["']completePurchaseReturn["'],\s*authToken,\s*payload\)/);
});

test('Finance, bank and vendor confirmations submit frozen payloads or captured ids', () => {
  assert.match(finance, /runConfirmedAction\([\s\S]{0,2600}serverCall\('addFinanceTransaction',\s*authToken,\s*payload\)/);
  assert.match(financeLedger, /var\s+financeId\s*=\s*finLedState\.editingId;[\s\S]{0,1800}serverCall\('updateFinanceTransaction',\s*authToken,\s*financeId,\s*payload\)/);
  assert.match(bank, /runConfirmedAction\([\s\S]{0,1800}serverCall\('transferBetweenBankAccounts',\s*authToken,\s*payload\)/);
  assert.match(bank, /runConfirmedAction\([\s\S]{0,1800}serverCall\('addBankManualEntry',\s*authToken,\s*payload\)/);
  assert.match(vendors, /serverCall\(handlers\.update,\s*authToken,\s*id,\s*payload\)/);
});

test('Stock adjustment confirmation posts the frozen stock payload', () => {
  assert.match(products, /var\s+stockPayload\s*=\s*\{[\s\S]{0,100}productId:[\s\S]{0,100}delta:[\s\S]{0,100}note:/);
  assert.match(products, /serverCall\('adjustStock',\s*authToken,\s*stockPayload\.productId,\s*stockPayload\.delta,\s*stockPayload\.note\)/);
});

test('High-risk party ledger confirmations freeze the target ids before opening the modal', () => {
  assert.match(customerLedger, /var\s+customerId\s*=\s*customerLedgerState\.partyId\s*;[\s\S]{0,1800}serverCall\('receivePayment',\s*authToken,\s*customerId,/);
  assert.match(customerLedger, /var\s+refundCustomerId\s*=\s*customerLedgerState\.partyId\s*;[\s\S]{0,1800}serverCall\('refundCustomerAdvance',\s*authToken,\s*refundCustomerId,/);
  assert.match(customerLedger, /var\s+paymentLedgerId\s*=\s*customerLedgerState\.editingLedgerId\s*;[\s\S]{0,1800}serverCall\('updateCustomerPayment',\s*authToken,\s*paymentLedgerId,\s*payload\)/);
  assert.match(supplierLedger, /var\s+supplierId\s*=\s*supplierLedgerState\.partyId\s*;[\s\S]{0,1800}serverCall\('paySupplier',\s*authToken,\s*supplierId,/);
  assert.match(supplierLedger, /var\s+paymentLedgerId\s*=\s*supplierLedgerState\.editingLedgerId\s*;[\s\S]{0,1800}serverCall\('updateSupplierPayment',\s*authToken,\s*paymentLedgerId,\s*payload\)/);
  assert.match(customers, /var\s+customerId\s*=\s*custState\.detailId\s*;[\s\S]{0,1800}serverCall\('receivePayment',\s*authToken,\s*customerId,/);
  assert.match(suppliers, /var\s+supplierId\s*=\s*supState\.detailId\s*;[\s\S]{0,1800}serverCall\('paySupplier',\s*authToken,\s*supplierId,/);
});
