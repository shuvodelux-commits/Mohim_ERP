'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

function runGenerator(counter, activeDrafts, auditRows) {
  const props = {
    value: String(counter),
    getProperty() { return this.value; },
    setProperty(k, v) { this.value = String(v); }
  };
  const byKey = { SALES_DRAFTS: activeDrafts, SALES_DRAFT_AUDIT: auditRows };
  const headers = {
    SALES_DRAFTS: ['Draft ID', 'Draft No'],
    SALES_DRAFT_AUDIT: ['Audit ID', 'Timestamp', 'Action', 'Draft ID', 'Draft No']
  };
  const ctx = {
    console,
    CONFIG: { HEADERS: headers },
    PropertiesService: { getDocumentProperties: () => props },
    Utilities: { formatDate: () => '2026' },
    Session: { getScriptTimeZone: () => 'Asia/Dhaka' },
    getSheet_: (key) => ({
      getLastRow: () => byKey[key].length + 1,
      getRange: () => ({ getValues: () => byKey[key].map(row => [row['Draft No'] || '']) })
    })
  };
  vm.createContext(ctx);
  const src = fs.readFileSync('DraftSales.gs', 'utf8');
  const start = src.indexOf('function generateDraftInvoiceNo_');
  const end = src.indexOf('\nfunction salesDraftCanManageAll_', start);
  vm.runInContext(src.slice(start, end), ctx, { filename: 'DraftSales.gs' });
  return { value: ctx.generateDraftInvoiceNo_(), props };
}

const active = [
  { 'Draft No': 'DRAFT-2026-0002' },
  { 'Draft No': 'DRAFT-2026-0016' }
];
let out = runGenerator(4, active, []);
assert.equal(out.value, 'DRAFT-2026-0017');
assert.equal(out.props.value, '17');

// Deleted drafts are removed from the active sheet, but their numbers remain
// in the immutable audit. A reset counter must not reuse those numbers.
out = runGenerator(1, [], [
  { 'Draft No': 'DRAFT-2026-0024' },
  { 'Draft No': 'DRAFT-2025-0999' }
]);
assert.equal(out.value, 'DRAFT-2026-0025');
assert.equal(out.props.value, '25');

console.log('PASS draft invoice number counter reconciles active and audited history');
