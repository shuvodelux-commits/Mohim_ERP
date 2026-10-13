'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const sources = ['Bundles.gs', 'Products.gs'].map(file =>
  fs.readFileSync(path.join(__dirname, '..', file), 'utf8')).join('\n');

function makeService() {
  const products = [
    { 'Product ID': 'PIPE', 'Product Type': 'Standard', Status: 'Active', _rowIndex: 2 },
    { 'Product ID': 'SET', 'Product Type': 'Bundle', Status: 'Active', 'Bundle Revision': 1, _rowIndex: 3 }
  ];
  const db = { PRODUCTS: products, BUNDLE_COMPONENTS: [
    { 'Bundle Product ID': 'SET', 'Component Product ID': 'PIPE', Revision: 1, Status: 'Active' }
  ] };
  let writes = 0, locks = 0;
  const deps = {
    CONFIG: { LOCK_TIMEOUT_MS: 20000 },
    LockService: { getScriptLock: () => ({
      waitLock: () => { locks++; }, releaseLock: () => { locks--; }
    }) },
    requirePermission_: () => ({}),
    findRowIndex_: (sheet, field, id) =>
      (db[sheet] || []).find(row => row[field] === id)?._rowIndex ?? -1,
    getAllRows_: sheet => db[sheet] || [],
    isDeleted_: () => false,
    updateRowFields_: (sheet, rowIndex, fields) => {
      const row = db[sheet].find(item => item._rowIndex === rowIndex);
      assert.ok(row, 'row exists before update');
      Object.assign(row, fields); writes++;
    },
    ok_: data => ({ success: true, data }),
    fail_: message => ({ success: false, message }),
    logError_: () => {}
  };
  const fn = Function(...Object.keys(deps), sources + '\nreturn setProductStatus;');
  return { setStatus: fn(...Object.values(deps)), products,
    writeCount: () => writes, openLocks: () => locks };
}

test('active component cannot be deactivated; no stock writes', () => {
  const service = makeService();
  const result = service.setStatus('test', 'PIPE', 'Inactive');
  assert.equal(result.success, false);
  assert.match(result.message, /used by an active bundle/i);
  assert.equal(service.products[0].Status, 'Active');
  assert.equal(service.writeCount(), 0);
  assert.equal(service.openLocks(), 0);
});

test('component may be deactivated only after the parent set is deactivated', () => {
  const service = makeService();
  assert.equal(service.setStatus('test', 'SET', 'Inactive').success, true);
  assert.equal(service.setStatus('test', 'PIPE', 'Inactive').success, true);
  assert.equal(service.writeCount(), 2);
  assert.equal(service.openLocks(), 0);
});
