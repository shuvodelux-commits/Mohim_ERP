'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const props = {
  value: '4',
  getProperty() { return this.value; },
  setProperty(k, v) { this.value = String(v); }
};
let requestedRange = null;
const ids = [['INV-000001'], ['INV-000002'], ['INV-000003'], ['INV-000016']];
const ctx = {
  console,
  CONFIG: { ID_PREFIX: { SALES: 'INV' }, ID_PAD_LENGTH: 6, HEADERS: { SALES: ['Invoice ID','Date','Time','Customer'] } },
  PropertiesService: { getDocumentProperties: () => props },
  getSheet_: () => ({
    getLastRow: () => ids.length + 1,
    getRange: (row, col, numRows, numCols) => {
      requestedRange = { row, col, numRows, numCols };
      return { getValues: () => ids };
    }
  }),
  getAllRows_: () => { throw new Error('generateId_ must not load every column of a large sheet'); },
  Session: { getScriptTimeZone: () => 'Asia/Dhaka' },
  Utilities: { formatDate: () => '' }
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('Utils.gs','utf8'), ctx, { filename: 'Utils.gs' });
assert.equal(ctx.generateId_('SALES'), 'INV-000017');
assert.equal(props.value, '17');
assert.deepStrictEqual(requestedRange, { row: 2, col: 1, numRows: 4, numCols: 1 });
console.log('PASS ID counter reconciliation reads only the ID column');
