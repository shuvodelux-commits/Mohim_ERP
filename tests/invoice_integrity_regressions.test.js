const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

function loadUtils({counter, rows}) {
  const props = { value: String(counter), getProperty(){ return this.value; }, setProperty(k,v){ this.value=String(v); } };
  const ctx = {
    console,
    CONFIG: {
      ID_PREFIX: { SALES: 'INV' },
      ID_PAD_LENGTH: 6,
      HEADERS: { SALES: ['Invoice ID'] }
    },
    PropertiesService: { getDocumentProperties: () => props },
    getSheet_: () => ({
      getLastRow: () => rows.length + 1,
      getRange: () => ({ getValues: () => rows.map(r => [r['Invoice ID'] || '']) })
    }),
    getAllRows_: () => rows,
    Session: { getScriptTimeZone: () => 'Asia/Dhaka' },
    Utilities: { formatDate: () => '' }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('Utils.gs','utf8'), ctx, {filename:'Utils.gs'});
  return {ctx, props};
}

function test(name, fn) {
  try { fn(); console.log('PASS', name); }
  catch (e) { console.error('FAIL', name, '\n' + e.stack); process.exitCode=1; }
}

test('generateId_ reconciles sparse sheet maximum even when row count is not above stale counter', () => {
  const {ctx, props} = loadUtils({
    counter: 4,
    rows: [
      {'Invoice ID':'INV-000001'},
      {'Invoice ID':'INV-000002'},
      {'Invoice ID':'INV-000003'},
      {'Invoice ID':'INV-000016'}
    ]
  });
  assert.equal(ctx.generateId_('SALES'), 'INV-000017');
  assert.equal(props.value, '17');
});

test('findUniqueSalesRow_ refuses duplicate invoice IDs', () => {
  const {ctx} = loadUtils({ counter: 0, rows: [] });
  ctx.findRows_ = () => [ {'Invoice ID':'INV-000005'}, {'Invoice ID':'INV-000005'} ];
  assert.throws(() => ctx.findUniqueSalesRow_('INV-000005'), /Duplicate invoice ID detected/);
});

test('shared invoice integrity helper rejects duplicate active invoice IDs', () => {
  const {ctx} = loadUtils({ counter: 0, rows: [] });
  assert.equal(typeof ctx.assertUniqueSalesInvoiceIds_, 'function', 'missing assertUniqueSalesInvoiceIds_');
  assert.throws(() => ctx.assertUniqueSalesInvoiceIds_([
    {'Invoice ID':'INV-000005'}, {'Invoice ID':'INV-000005'}
  ], 'Sales report'), /Duplicate invoice ID detected.*INV-000005/i);
  assert.doesNotThrow(() => ctx.assertUniqueSalesInvoiceIds_([
    {'Invoice ID':'INV-000005'}, {'Invoice ID':'INV-000006'}
  ], 'Sales report'));
});

test('report integrity check catches duplicate IDs whose other header is outside the selected date range', () => {
  const {ctx} = loadUtils({ counter: 0, rows: [] });
  const selected = [{ 'Invoice ID':'INV-000005', Date:'2026-09-05' }];
  const allActive = [
    selected[0],
    { 'Invoice ID':'INV-000005', Date:'2026-08-31' },
    { 'Invoice ID':'INV-000006', Date:'2026-08-31' }
  ];
  assert.throws(
    () => ctx.assertUniqueSalesInvoiceIds_(selected, 'Sales report', allActive),
    /Duplicate invoice ID detected.*INV-000005/i
  );
});

test('invoice and phone-history operational reads exclude deleted sales', () => {
  const invoice = fs.readFileSync('Invoice.gs','utf8');
  assert.match(invoice, /buildInvoicePayload_[\s\S]*?isDeleted_\(sale\)/, 'invoice payload must reject deleted sale');
  const phoneFn = invoice.slice(invoice.indexOf('function findSalesByPhone'), invoice.indexOf('\n}', invoice.indexOf('function findSalesByPhone')) + 2);
  assert.match(phoneFn, /activeRows_\(['"]SALES['"]\)|!isDeleted_\(s\)/, 'phone history must exclude deleted sales');
});

test('sales and profit reports fail closed on duplicate active invoice IDs', () => {
  const reports = fs.readFileSync('Reports.gs','utf8');
  const salesStart = reports.indexOf('function getSalesReport');
  const salesEnd = reports.indexOf('// -------------------------------------------------------- Purchase report', salesStart);
  const salesFn = reports.slice(salesStart, salesEnd);
  assert.match(salesFn, /assertUniqueSalesInvoiceIds_\(sales/);
  const profitStart = reports.indexOf('function computeProfit_');
  const profitEnd = reports.indexOf('/** filters = { from, to }. FIFO-costed profit', profitStart);
  const profitFn = reports.slice(profitStart, profitEnd);
  assert.match(profitFn, /assertUniqueSalesInvoiceIds_\(sales/);
});

test('duplicate invoice rows are explicitly flagged in Sales list and POS phone history', () => {
  const invoice = fs.readFileSync('Invoice.gs','utf8');
  const sm = fs.readFileSync('SalesManagement.gs','utf8');
  assert.match(invoice, /duplicateInvoiceId\s*:/, 'findSalesByPhone must return duplicateInvoiceId');
  assert.match(sm, /duplicateInvoiceId\s*:/, 'Sales list must return duplicateInvoiceId');
  assert.match(sm, /Integrity Error/, 'Sales list must not calculate a normal return status for duplicate invoice IDs');
});

test('duplicate invoice rows expose no operational Actions menu in Sales or POS history UI', () => {
  const salesUi = fs.readFileSync('sales.html','utf8');
  const posUi = fs.readFileSync('pos.html','utf8');
  assert.match(salesUi, /duplicateInvoiceId[\s\S]*Duplicate ID/, 'Sales UI must visibly mark duplicate invoice IDs');
  assert.match(salesUi, /duplicateInvoiceId[\s\S]*disabled/, 'Sales UI must disable actions for duplicate invoice IDs');
  assert.match(posUi, /duplicateInvoiceId[\s\S]*Duplicate ID/, 'POS history must visibly mark duplicate invoice IDs');
  assert.match(posUi, /duplicateInvoiceId[\s\S]*disabled/, 'POS history must disable actions for duplicate invoice IDs');
});

test('Sales Return search flags duplicate invoice IDs and disables ambiguous Load actions', () => {
  const returnGs = fs.readFileSync('SalesReturn.gs','utf8');
  const returnUi = fs.readFileSync('returns.html','utf8');
  const start = returnGs.indexOf('function searchInvoicesForReturn');
  const end = returnGs.indexOf('/** Invoice + every line', start);
  const searchFn = returnGs.slice(start, end);
  assert.match(searchFn, /duplicateInvoiceId\s*:/, 'return search must return duplicateInvoiceId');
  assert.match(returnUi, /duplicateInvoiceId[\s\S]*Duplicate ID/, 'return search UI must visibly mark duplicate invoice IDs');
  assert.match(returnUi, /duplicateInvoiceId[\s\S]*disabled/, 'return search UI must disable Load for duplicate invoice IDs');
});
