'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');


function fnSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing function ${name}`);
  const brace = source.indexOf('{', start);
  let depth = 0, quote = null, escape = false, lineComment = false, blockComment = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i], next = source[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated function ${name}`);
}

function loadStockFunctions(names, overrides = {}) {
  const source = read('StockLots.gs');
  const context = { console, ...overrides };
  vm.createContext(context);
  const body = names.map(name => fnSource(source, name)).join('\n') +
    '\nthis.__api = {' + names.join(',') + '};';
  vm.runInContext(body, context, { filename: 'StockLots.gs' });
  return context.__api;
}


function loadProductFunctions(names, overrides = {}) {
  const source = read('Products.gs');
  const context = { console, ...overrides };
  vm.createContext(context);
  const body = names.map(name => fnSource(source, name)).join('\n') +
    '\nthis.__api = {' + names.join(',') + '};';
  vm.runInContext(body, context, { filename: 'Products.gs' });
  return context.__api;
}

function loadFileFunctions(file, names, overrides = {}) {
  const source = read(file);
  const context = { console, ...overrides };
  vm.createContext(context);
  const body = names.map(name => fnSource(source, name)).join('\n') +
    '\nthis.__api = {' + names.join(',') + '};';
  vm.runInContext(body, context, { filename: file });
  return context.__api;
}

function loadConfig() {
  const context = {};
  vm.createContext(context);
  vm.runInContext(read('Config.gs') + '\nthis.__CONFIG = CONFIG;', context, { filename: 'Config.gs' });
  return context.__CONFIG;
}

test('stock lot cost correction audit schema is declared', () => {
  const CONFIG = loadConfig();
  assert.equal(CONFIG.SHEETS.STOCK_LOT_COST_CORRECTIONS, 'Stock Lot Cost Corrections');
  assert.equal(CONFIG.ID_PREFIX.STOCK_LOT_COST_CORRECTIONS, 'SLC');
  assert.deepEqual(Array.from(CONFIG.HEADERS.STOCK_LOT_COST_CORRECTIONS), [
    'Correction ID',
    'Date',
    'Lot ID',
    'Product ID',
    'Product Name',
    'Source',
    'Old Purchase Price',
    'New Purchase Price',
    'Original Quantity',
    'Remaining Quantity',
    'Matched Historical Quantity',
    'Affected Invoice Count',
    'Historical COGS Delta',
    'Reason',
    'Corrected By',
    'Created At'
  ]);
});


test('internal cost correction source classification excludes real purchase lots', () => {
  const api = loadStockFunctions(['isInternalCostCorrectionSource_', 'isZeroStoredCost_']);
  assert.equal(api.isInternalCostCorrectionSource_('OPENING'), true);
  assert.equal(api.isInternalCostCorrectionSource_('OPENING-MIGRATION'), true);
  assert.equal(api.isInternalCostCorrectionSource_('OPENING-2025'), true);
  assert.equal(api.isInternalCostCorrectionSource_('ADJUSTMENT'), true);
  assert.equal(api.isInternalCostCorrectionSource_('ADJUSTMENT-MANUAL'), true);
  assert.equal(api.isInternalCostCorrectionSource_('LEGACY'), true);
  assert.equal(api.isInternalCostCorrectionSource_('PUR-000001'), false);
  assert.equal(api.isInternalCostCorrectionSource_(''), false);
  assert.equal(api.isInternalCostCorrectionSource_(null), false);

  assert.equal(api.isZeroStoredCost_(''), true);
  assert.equal(api.isZeroStoredCost_(null), true);
  assert.equal(api.isZeroStoredCost_(undefined), true);
  assert.equal(api.isZeroStoredCost_(0), true);
  assert.equal(api.isZeroStoredCost_('0'), true);
  assert.equal(api.isZeroStoredCost_(10), false);
  assert.equal(api.isZeroStoredCost_(-1), false);
  assert.equal(api.isZeroStoredCost_('abc'), false);
});

test('candidate preview uses exact Lot ID evidence and suggests product master cost', () => {
  const api = loadStockFunctions(['buildInternalStockLotCostCandidate_'], {
    safeDateOnly_: value => String(value || '').slice(0, 10),
    roundMoney_: value => Math.round((Number(value) + Number.EPSILON) * 100) / 100
  });
  const lot = {
    'Lot ID': 'LOT-1',
    'Product ID': 'P1',
    'Product Name': 'Tank',
    'Purchase ID': 'OPENING',
    'Purchase Date': '2026-09-01',
    'Purchase Price': 0,
    'Original Quantity': 2,
    'Remaining Quantity': 1,
    Status: 'Active'
  };
  const product = { 'Product ID': 'P1', 'Purchase Price': 4100 };
  const evidence = [
    { 'Invoice ID': 'INV-1', 'Product ID': 'P1', 'Lot ID': 'LOT-1', Quantity: 1, 'Unit Cost': 0 },
    { 'Invoice ID': 'INV-2', 'Product ID': 'P1', 'Lot ID': 'LOT-X', Quantity: 4, 'Unit Cost': 0 },
    { 'Invoice ID': 'INV-3', 'Product ID': 'P1', 'Lot ID': '', Quantity: 2, 'Unit Cost': 0 }
  ];

  const c = api.buildInternalStockLotCostCandidate_(lot, product, evidence);
  assert.equal(c.lotId, 'LOT-1');
  assert.equal(c.consumedQuantity, 1);
  assert.equal(c.matchedHistoricalQuantity, 1);
  assert.equal(c.affectedInvoiceCount, 1);
  assert.equal(c.historicalCurrentCogs, 0);
  assert.equal(c.historicalCogsDelta, 4100);
  assert.equal(c.suggestedPurchasePrice, 4100);
  assert.equal(c.status, 'Ready');
});

test('candidate preview marks zero-cost product master as Needs Cost', () => {
  const api = loadStockFunctions(['buildInternalStockLotCostCandidate_'], {
    safeDateOnly_: value => String(value || '').slice(0, 10),
    roundMoney_: value => Math.round((Number(value) + Number.EPSILON) * 100) / 100
  });
  const c = api.buildInternalStockLotCostCandidate_({
    'Lot ID': 'LOT-2', 'Product ID': 'P2', 'Product Name': 'Pipe', 'Purchase ID': 'ADJUSTMENT',
    'Purchase Date': '2026-09-02', 'Purchase Price': '', 'Original Quantity': 5, 'Remaining Quantity': 5
  }, { 'Product ID': 'P2', 'Purchase Price': 0 }, []);
  assert.equal(c.suggestedPurchasePrice, 0);
  assert.equal(c.status, 'Needs Cost');
  assert.equal(c.historicalCogsDelta, 0);
});

test('unpriced internal lot preview is permission gated, indexed, and excludes ineligible lots', () => {
  const reads = {};
  const permissionCalls = [];
  const products = [
    { 'Product ID': 'P1', 'Product Name': 'Tank', 'Purchase Price': 4100 },
    { 'Product ID': 'P2', 'Product Name': 'Pipe', 'Purchase Price': 0 },
    { 'Product ID': 'P3', 'Product Name': 'Valve', 'Purchase Price': 999 }
  ];
  const lots = [
    { 'Lot ID': 'LOT-1', 'Product ID': 'P1', 'Product Name': 'Tank', 'Purchase ID': 'OPENING', 'Purchase Date': '2026-09-01', 'Purchase Price': 0, 'Original Quantity': 2, 'Remaining Quantity': 1, Status: 'Active' },
    { 'Lot ID': 'LOT-2', 'Product ID': 'P2', 'Product Name': 'Pipe', 'Purchase ID': 'ADJUSTMENT', 'Purchase Date': '2026-09-02', 'Purchase Price': '', 'Original Quantity': 2, 'Remaining Quantity': 2, Status: 'Active' },
    { 'Lot ID': 'LOT-3', 'Product ID': 'P3', 'Product Name': 'Valve', 'Purchase ID': 'PUR-000001', 'Purchase Date': '2026-09-03', 'Purchase Price': 0, 'Original Quantity': 1, 'Remaining Quantity': 1, Status: 'Active' },
    { 'Lot ID': 'LOT-4', 'Product ID': 'P3', 'Product Name': 'Valve', 'Purchase ID': 'OPENING', 'Purchase Date': '2026-09-04', 'Purchase Price': 100, 'Original Quantity': 1, 'Remaining Quantity': 1, Status: 'Active' },
    { 'Lot ID': 'LOT-5', 'Product ID': 'P1', 'Product Name': 'Tank', 'Purchase ID': 'LEGACY', 'Purchase Date': '2026-09-05', 'Purchase Price': 0, 'Original Quantity': 1, 'Remaining Quantity': 1, Status: 'Deleted' }
  ];
  const evidence = [
    { 'Invoice ID': 'INV-1', 'Product ID': 'P1', 'Lot ID': 'LOT-1', Quantity: 1, 'Unit Cost': 0 },
    { 'Invoice ID': 'INV-2', 'Product ID': 'P2', 'Lot ID': 'LOT-2', Quantity: 0.5, 'Unit Cost': 0 },
    { 'Invoice ID': 'INV-X', 'Product ID': 'P1', 'Lot ID': 'LOT-X', Quantity: 10, 'Unit Cost': 0 }
  ];
  const api = loadStockFunctions([
    'isInternalCostCorrectionSource_',
    'isZeroStoredCost_',
    'buildInternalStockLotCostCandidate_',
    'getUnpricedInternalStockLots'
  ], {
    requirePermission_: (token, module, action) => permissionCalls.push([token, module, action]),
    getAllRows_: key => {
      reads[key] = (reads[key] || 0) + 1;
      if (key === 'PRODUCTS') return products;
      if (key === 'STOCK_LOTS') return lots;
      if (key === 'SALE_ITEM_LOTS') return evidence;
      return [];
    },
    safeDateOnly_: value => String(value || '').slice(0, 10),
    roundMoney_: value => Math.round((Number(value) + Number.EPSILON) * 100) / 100,
    ok_: data => ({ success: true, data }),
    fail_: message => ({ success: false, message }),
    logError_: () => {}
  });

  const result = api.getUnpricedInternalStockLots('TOKEN');
  assert.equal(result.success, true);
  assert.deepEqual(permissionCalls, [['TOKEN', 'products', 'view']]);
  assert.deepEqual(reads, { PRODUCTS: 1, STOCK_LOTS: 1, SALE_ITEM_LOTS: 1 });
  assert.deepEqual(result.data.lots.map(x => x.lotId), ['LOT-1', 'LOT-2']);
  assert.deepEqual(JSON.parse(JSON.stringify(result.data.summary)), {
    candidateCount: 2,
    readyCount: 1,
    needsCostCount: 1,
    remainingQuantity: 3,
    matchedHistoricalQuantity: 1.5,
    projectedHistoricalCogsDelta: 4100
  });
});


function correctionFixture(overrides = {}) {
  const products = overrides.products || [
    { 'Product ID': 'P1', 'Product Name': 'Tank', 'Purchase Price': 4100 }
  ];
  const lots = overrides.lots || [
    { _rowIndex: 2, 'Lot ID': 'LOT-1', 'Product ID': 'P1', 'Product Name': 'Tank', 'Purchase ID': 'OPENING', 'Purchase Price': 0, 'Original Quantity': 2, 'Remaining Quantity': 1, 'Status': 'Active' }
  ];
  const evidence = overrides.evidence || [
    { _rowIndex: 2, 'Invoice ID': 'INV-1', 'Product ID': 'P1', 'Lot ID': 'LOT-1', Quantity: 1, 'Unit Cost': 0 }
  ];
  const writes = [];
  let idSeq = 0;
  const api = loadStockFunctions([
    'isInternalCostCorrectionSource_',
    'isZeroStoredCost_',
    'loadInternalStockLotCostCorrectionContext_',
    'prepareInternalStockLotCostCorrections_',
    'commitInternalStockLotCostCorrections_',
    'correctInternalStockLotCosts'
  ], {
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    CONFIG: { LOCK_TIMEOUT_MS: 1000 },
    requirePermission_: () => ({ name: 'Admin' }),
    sanitizeInput_: value => String(value == null ? '' : value).trim(),
    isValidNonNegativeNumber_: value => Number.isFinite(Number(value)) && Number(value) >= 0,
    roundMoney_: value => Math.round((Number(value) + Number.EPSILON) * 100) / 100,
    getAllRows_: key => {
      if (key === 'PRODUCTS') return products;
      if (key === 'STOCK_LOTS') return lots;
      if (key === 'SALE_ITEM_LOTS') return evidence;
      return [];
    },
    updateRowFields_: (sheet, rowIndex, fields) => writes.push({ type: 'update', sheet, rowIndex, fields }),
    appendRow_: (sheet, row) => writes.push({ type: 'append', sheet, row }),
    generateId_: () => 'SLC-' + String(++idSeq).padStart(6, '0'),
    actorName_: user => user && user.name || 'Admin',
    ok_: data => ({ success: true, data }),
    fail_: message => ({ success: false, message: String(message) }),
    logError_: () => {}
  });
  return { api, products, lots, evidence, writes };
}

test('cost correction rejects every invalid request before the first write', () => {
  const cases = [
    {
      name: 'missing reason',
      payload: { corrections: [{ lotId: 'LOT-1', newPurchasePrice: 4100 }], reason: '' },
      message: /reason/i
    },
    {
      name: 'duplicate lot id in request',
      payload: { corrections: [{ lotId: 'LOT-1', newPurchasePrice: 4100 }, { lotId: 'LOT-1', newPurchasePrice: 4200 }], reason: 'fix' },
      message: /duplicate|more than once/i
    },
    {
      name: 'missing lot',
      payload: { corrections: [{ lotId: 'LOT-X', newPurchasePrice: 4100 }], reason: 'fix' },
      message: /lot.*not found/i
    },
    {
      name: 'deleted lot',
      fixture: { lots: [{ _rowIndex: 2, 'Lot ID': 'LOT-1', 'Product ID': 'P1', 'Product Name': 'Tank', 'Purchase ID': 'OPENING', 'Purchase Price': 0, 'Original Quantity': 2, 'Remaining Quantity': 1, 'Status': 'Deleted' }] },
      payload: { corrections: [{ lotId: 'LOT-1', newPurchasePrice: 4100 }], reason: 'fix' },
      message: /deleted/i
    },
    {
      name: 'purchase origin lot',
      fixture: { lots: [{ _rowIndex: 2, 'Lot ID': 'LOT-1', 'Product ID': 'P1', 'Product Name': 'Tank', 'Purchase ID': 'PUR-000100', 'Purchase Price': 0, 'Original Quantity': 2, 'Remaining Quantity': 1, 'Status': 'Active' }] },
      payload: { corrections: [{ lotId: 'LOT-1', newPurchasePrice: 4100 }], reason: 'fix' },
      message: /opening|adjustment|internal|purchase edit/i
    },
    {
      name: 'already priced lot',
      fixture: { lots: [{ _rowIndex: 2, 'Lot ID': 'LOT-1', 'Product ID': 'P1', 'Product Name': 'Tank', 'Purchase ID': 'OPENING', 'Purchase Price': 100, 'Original Quantity': 2, 'Remaining Quantity': 1, 'Status': 'Active' }] },
      payload: { corrections: [{ lotId: 'LOT-1', newPurchasePrice: 4100 }], reason: 'fix' },
      message: /already|zero|blank/i
    },
    {
      name: 'zero new cost',
      payload: { corrections: [{ lotId: 'LOT-1', newPurchasePrice: 0 }], reason: 'fix' },
      message: /greater than zero|purchase price/i
    },
    {
      name: 'negative new cost',
      payload: { corrections: [{ lotId: 'LOT-1', newPurchasePrice: -1 }], reason: 'fix' },
      message: /greater than zero|purchase price/i
    },
    {
      name: 'non numeric new cost',
      payload: { corrections: [{ lotId: 'LOT-1', newPurchasePrice: 'not-a-number' }], reason: 'fix' },
      message: /valid|purchase price/i
    },
    {
      name: 'missing product master',
      fixture: { products: [] },
      payload: { corrections: [{ lotId: 'LOT-1', newPurchasePrice: 4100 }], reason: 'fix' },
      message: /product.*not found/i
    }
  ];

  cases.forEach(c => {
    const fx = correctionFixture(c.fixture || {});
    const result = fx.api.correctInternalStockLotCosts('TOKEN', c.payload);
    assert.equal(result.success, false, c.name + ' should fail');
    assert.match(result.message, c.message, c.name + ' error');
    assert.deepEqual(fx.writes, [], c.name + ' must not write anything');
  });
});

test('cost correction validates the whole batch before writing any earlier valid lot', () => {
  const fx = correctionFixture({
    products: [
      { 'Product ID': 'P1', 'Product Name': 'Tank', 'Purchase Price': 4100 },
      { 'Product ID': 'P2', 'Product Name': 'Pipe', 'Purchase Price': 100 }
    ],
    lots: [
      { _rowIndex: 2, 'Lot ID': 'LOT-1', 'Product ID': 'P1', 'Product Name': 'Tank', 'Purchase ID': 'OPENING', 'Purchase Price': 0, 'Original Quantity': 2, 'Remaining Quantity': 1, 'Status': 'Active' },
      { _rowIndex: 3, 'Lot ID': 'LOT-2', 'Product ID': 'P2', 'Product Name': 'Pipe', 'Purchase ID': 'PUR-000100', 'Purchase Price': 0, 'Original Quantity': 2, 'Remaining Quantity': 2, 'Status': 'Active' }
    ]
  });
  const result = fx.api.correctInternalStockLotCosts('TOKEN', {
    reason: 'repair imported opening costs',
    corrections: [
      { lotId: 'LOT-1', newPurchasePrice: 4100 },
      { lotId: 'LOT-2', newPurchasePrice: 100 }
    ]
  });
  assert.equal(result.success, false);
  assert.deepEqual(fx.writes, []);
});


test('successful correction updates only the selected lot and exact matching historical cost evidence', () => {
  const fx = correctionFixture({
    evidence: [
      { _rowIndex: 2, 'Invoice ID': 'INV-1', 'Product ID': 'P1', 'Lot ID': 'LOT-1', Quantity: 1, 'Unit Cost': 0 },
      { _rowIndex: 3, 'Invoice ID': 'INV-2', 'Product ID': 'P1', 'Lot ID': 'LOT-2', Quantity: 1, 'Unit Cost': 0 },
      { _rowIndex: 4, 'Invoice ID': 'INV-3', 'Product ID': 'P1', 'Lot ID': '', Quantity: 1, 'Unit Cost': 0 }
    ]
  });

  const result = fx.api.correctInternalStockLotCosts('TOKEN', {
    reason: 'Opening stock cost was omitted',
    corrections: [{ lotId: 'LOT-1', newPurchasePrice: 4100 }]
  });

  assert.equal(result.success, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)), {
    correctedCount: 1,
    matchedHistoricalQuantity: 1,
    affectedInvoiceCount: 1,
    historicalCogsDelta: 4100,
    lots: [{
      lotId: 'LOT-1',
      newPurchasePrice: 4100,
      matchedHistoricalQuantity: 1,
      affectedInvoiceCount: 1,
      historicalCogsDelta: 4100
    }]
  });

  const stockUpdates = fx.writes.filter(w => w.type === 'update' && w.sheet === 'STOCK_LOTS');
  assert.deepEqual(JSON.parse(JSON.stringify(stockUpdates)), [
    { type: 'update', sheet: 'STOCK_LOTS', rowIndex: 2, fields: { 'Purchase Price': 4100 } }
  ]);
  const evidenceUpdates = fx.writes.filter(w => w.type === 'update' && w.sheet === 'SALE_ITEM_LOTS');
  assert.deepEqual(JSON.parse(JSON.stringify(evidenceUpdates)), [
    { type: 'update', sheet: 'SALE_ITEM_LOTS', rowIndex: 2, fields: { 'Unit Cost': 4100 } }
  ]);
  assert.equal(evidenceUpdates.some(w => w.rowIndex === 3 || w.rowIndex === 4), false, 'same-product or blank Lot ID evidence must be untouched');
  assert.equal(stockUpdates.some(w => Object.prototype.hasOwnProperty.call(w.fields, 'Remaining Quantity')), false, 'stock quantity must not change');

  const audits = fx.writes.filter(w => w.type === 'append' && w.sheet === 'STOCK_LOT_COST_CORRECTIONS');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].row['Lot ID'], 'LOT-1');
  assert.equal(audits[0].row['Old Purchase Price'], 0);
  assert.equal(audits[0].row['New Purchase Price'], 4100);
  assert.equal(audits[0].row['Matched Historical Quantity'], 1);
  assert.equal(audits[0].row['Affected Invoice Count'], 1);
  assert.equal(audits[0].row['Historical COGS Delta'], 4100);
  assert.equal(audits[0].row['Reason'], 'Opening stock cost was omitted');
  assert.equal(audits[0].row['Corrected By'], 'Admin');
  assert.equal(fx.writes.some(w => w.sheet === 'STOCK_MOVEMENT'), false);
});

test('cost correction uses current net SALE_ITEM_LOTS quantity after returns', () => {
  const fx = correctionFixture({
    evidence: [
      { _rowIndex: 2, 'Invoice ID': 'INV-1', 'Product ID': 'P1', 'Lot ID': 'LOT-1', Quantity: 0.5, 'Unit Cost': 0 }
    ]
  });
  const result = fx.api.correctInternalStockLotCosts('TOKEN', {
    reason: 'repair returned sale cost evidence',
    corrections: [{ lotId: 'LOT-1', newPurchasePrice: 4100 }]
  });
  assert.equal(result.success, true);
  assert.equal(result.data.matchedHistoricalQuantity, 0.5);
  assert.equal(result.data.historicalCogsDelta, 2050);
  assert.equal(fx.writes.some(w => /^SALES_RETURN/.test(w.sheet)), false, 'return rows must not be rewritten');
});

test('cost correction delta is based on stored historical Unit Cost when it is already nonzero', () => {
  const fx = correctionFixture({
    evidence: [
      { _rowIndex: 2, 'Invoice ID': 'INV-1', 'Product ID': 'P1', 'Lot ID': 'LOT-1', Quantity: 2, 'Unit Cost': 100 }
    ]
  });
  const result = fx.api.correctInternalStockLotCosts('TOKEN', {
    reason: 'repair inconsistent historical cost',
    corrections: [{ lotId: 'LOT-1', newPurchasePrice: 500 }]
  });
  assert.equal(result.success, true);
  assert.equal(result.data.historicalCogsDelta, 800);
  const audit = fx.writes.find(w => w.type === 'append' && w.sheet === 'STOCK_LOT_COST_CORRECTIONS');
  assert.equal(audit.row['Historical COGS Delta'], 800);
});


test('single-lot correction wrapper delegates to the batch engine without duplicating accounting logic', () => {
  const calls = [];
  const api = loadStockFunctions(['correctInternalStockLotCost'], {
    correctInternalStockLotCosts: (token, payload) => {
      calls.push({ token, payload });
      return { success: true, data: { correctedCount: 1 } };
    }
  });
  const result = api.correctInternalStockLotCost('TOKEN', {
    lotId: 'LOT-1',
    newPurchasePrice: 4100,
    reason: 'opening cost repair'
  });
  assert.equal(result.success, true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{
    token: 'TOKEN',
    payload: {
      corrections: [{ lotId: 'LOT-1', newPurchasePrice: 4100 }],
      reason: 'opening cost repair'
    }
  }]);
});


test('bulk correction applies validated lots in deterministic Lot ID order', () => {
  const fx = correctionFixture({
    products: [
      { 'Product ID': 'P1', 'Product Name': 'Tank', 'Purchase Price': 4100 },
      { 'Product ID': 'P2', 'Product Name': 'Pipe', 'Purchase Price': 100 }
    ],
    lots: [
      { _rowIndex: 2, 'Lot ID': 'LOT-1', 'Product ID': 'P1', 'Product Name': 'Tank', 'Purchase ID': 'OPENING', 'Purchase Price': 0, 'Original Quantity': 1, 'Remaining Quantity': 1, 'Status': 'Active' },
      { _rowIndex: 3, 'Lot ID': 'LOT-2', 'Product ID': 'P2', 'Product Name': 'Pipe', 'Purchase ID': 'ADJUSTMENT', 'Purchase Price': 0, 'Original Quantity': 1, 'Remaining Quantity': 1, 'Status': 'Active' }
    ],
    evidence: []
  });
  const result = fx.api.correctInternalStockLotCosts('TOKEN', {
    reason: 'bulk repair',
    corrections: [
      { lotId: 'LOT-2', newPurchasePrice: 100 },
      { lotId: 'LOT-1', newPurchasePrice: 4100 }
    ]
  });
  assert.equal(result.success, true);
  const audits = fx.writes.filter(w => w.type === 'append' && w.sheet === 'STOCK_LOT_COST_CORRECTIONS');
  assert.deepEqual(audits.map(w => w.row['Lot ID']), ['LOT-1', 'LOT-2']);
});


test('internal lot creation rejects positive zero-cost stock before append while purchase-origin behavior is unchanged', () => {
  const appended = [];
  const api = loadStockFunctions([
    'isInternalCostCorrectionSource_',
    'assertPositiveInternalLotCost_',
    'createLotWithRow_'
  ], {
    isValidNonNegativeNumber_: value => Number.isFinite(Number(value)) && Number(value) >= 0,
    getAllRows_: () => [],
    generateId_: () => 'LOT-NEW',
    appendRow_: (sheet, row) => { appended.push({ sheet, row }); return 2; }
  });

  assert.throws(
    () => api.assertPositiveInternalLotCost_('OPENING', 2, 0),
    /Purchase Price/i
  );
  assert.throws(
    () => api.assertPositiveInternalLotCost_('ADJUSTMENT', 1, ''),
    /Purchase Price/i
  );
  assert.doesNotThrow(() => api.assertPositiveInternalLotCost_('PUR-000001', 2, 0));
  assert.doesNotThrow(() => api.assertPositiveInternalLotCost_('ADJUSTMENT', 0, 0));

  assert.throws(
    () => api.createLotWithRow_('P1', 'Tank', 'OPENING', new Date(), 0, 2, '', '', 5000),
    /Purchase Price/i
  );
  assert.equal(appended.length, 0, 'invalid internal lot must be blocked before append');

  const purchaseLot = api.createLotWithRow_('P1', 'Tank', 'PUR-000001', new Date(), 0, 2, 'S1', 'Supplier', 5000);
  assert.equal(purchaseLot.id, 'LOT-NEW');
  assert.equal(appended.length, 1, 'internal-source guard must not change real Purchase lot behavior');
});


test('product creation requires positive Purchase Price only when Opening Stock is positive', () => {
  function run(stock, purchasePrice) {
    const writes = [];
    const api = loadProductFunctions(['addProduct'], {
      LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
      CONFIG: { LOCK_TIMEOUT_MS: 1000 },
      requirePermission_: () => ({}),
      sanitizeInput_: value => String(value == null ? '' : value).trim(),
      isValidNonNegativeNumber_: value => Number.isFinite(Number(value)) && Number(value) >= 0,
      activeRows_: () => [],
      generateId_: key => key === 'PRODUCTS' ? 'P1' : 'ID-1',
      requireActiveCashSession_: () => ({}),
      appendRow_: (sheet, row) => writes.push({ sheet, row }),
      createLot_: () => { writes.push({ sheet: 'STOCK_LOTS' }); return 'LOT-1'; },
      ok_: data => ({ success: true, data }),
      fail_: message => ({ success: false, message: String(message) }),
      logError_: () => {}
    });
    const result = api.addProduct('TOKEN', {
      name: 'Tank', brand: '', category: 'Tank', unit: 'pcs', barcode: '',
      purchasePrice, sellingPrice: 5000, stock, minStock: 1
    });
    return { result, writes };
  }

  const invalid = run(5, 0);
  assert.equal(invalid.result.success, false);
  assert.match(invalid.result.message, /Purchase Price.*greater than zero|greater than zero.*Purchase Price/i);
  assert.deepEqual(invalid.writes, [], 'positive opening stock with zero cost must fail before any write');

  const zeroStock = run(0, 0);
  assert.equal(zeroStock.result.success, true, 'zero-stock product may still have Purchase Price zero');
  assert.equal(zeroStock.writes.filter(w => w.sheet === 'PRODUCTS').length, 1);
  assert.equal(zeroStock.writes.some(w => w.sheet === 'STOCK_LOTS'), false);
});

test('positive stock adjustment with zero Product Purchase Price is blocked before writes while negative adjustment remains allowed', () => {
  function run(delta) {
    const writes = [];
    const api = loadProductFunctions(['adjustStock'], {
      LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
      CONFIG: { LOCK_TIMEOUT_MS: 1000 },
      requirePermission_: () => ({}),
      requireActiveCashSession_: () => ({}),
      findRowIndex_: () => 2,
      getAllRows_: key => key === 'PRODUCTS' ? [{ 'Product ID': 'P1', 'Product Name': 'Tank', 'Current Stock': 5, 'Purchase Price': 0 }] : [],
      addAdjustmentLot_: () => { writes.push({ sheet: 'STOCK_LOTS' }); return 'LOT-A'; },
      consumeStockFIFO_: () => [{ lotId: 'LOT-OLD' }],
      updateRowFields_: (sheet, rowIndex, fields) => writes.push({ sheet, rowIndex, fields }),
      appendRow_: (sheet, row) => writes.push({ sheet, row }),
      generateId_: () => 'SM-1',
      sanitizeInput_: value => String(value == null ? '' : value).trim(),
      ok_: data => ({ success: true, data }),
      fail_: message => ({ success: false, message: String(message) }),
      logError_: () => {}
    });
    return { result: api.adjustStock('TOKEN', 'P1', delta, 'count correction'), writes };
  }

  const positive = run(2);
  assert.equal(positive.result.success, false);
  assert.match(positive.result.message, /Purchase Price/i);
  assert.deepEqual(positive.writes, [], 'positive adjustment must fail before lot/product/movement writes');

  const negative = run(-1);
  assert.equal(negative.result.success, true, 'negative adjustment consumes existing FIFO and does not create a new cost lot');
  assert.equal(negative.writes.some(w => w.sheet === 'STOCK_LOTS'), false);
  assert.equal(negative.writes.some(w => w.sheet === 'PRODUCTS'), true);
  assert.equal(negative.writes.some(w => w.sheet === 'STOCK_MOVEMENT'), true);
});

test('product edit that increases stock rejects submitted zero Purchase Price before updating Product or lots', () => {
  const writes = [];
  const api = loadProductFunctions(['updateProduct'], {
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    CONFIG: { LOCK_TIMEOUT_MS: 1000 },
    requirePermission_: () => ({}),
    findRowIndex_: () => 2,
    sanitizeInput_: value => String(value == null ? '' : value).trim(),
    isValidNonNegativeNumber_: value => Number.isFinite(Number(value)) && Number(value) >= 0,
    getAllRows_: key => key === 'PRODUCTS' ? [{ 'Product ID': 'P1', 'Product Name': 'Tank', 'Current Stock': 10, 'Purchase Price': 100 }] : [],
    requireActiveCashSession_: () => ({}),
    updateRowFields_: (sheet, rowIndex, fields) => writes.push({ sheet, rowIndex, fields }),
    addAdjustmentLot_: () => { writes.push({ sheet: 'STOCK_LOTS' }); return 'LOT-A'; },
    consumeStockFIFO_: () => [],
    appendRow_: (sheet, row) => writes.push({ sheet, row }),
    generateId_: () => 'SM-1',
    ok_: data => ({ success: true, data }),
    fail_: message => ({ success: false, message: String(message) }),
    logError_: () => {}
  });
  const result = api.updateProduct('TOKEN', 'P1', {
    name: 'Tank', brand: '', category: 'Tank', unit: 'pcs', barcode: '',
    purchasePrice: 0, sellingPrice: 5000, stock: 12, minStock: 1
  });
  assert.equal(result.success, false);
  assert.match(result.message, /Purchase Price.*greater than zero|greater than zero.*Purchase Price/i);
  assert.deepEqual(writes, [], 'stock-increase Product edit must reject before the Product row is updated');
});


test('opening-lot migration skips and reports positive-stock products whose Purchase Price is zero', () => {
  const createdLots = [];
  const alerts = [];
  const api = loadStockFunctions(['migrateOpeningStockLots_'], {
    SpreadsheetApp: {
      getUi: () => ({
        ButtonSet: { OK: 'OK' },
        alert: (...args) => alerts.push(args)
      }),
      flush: () => {}
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    CONFIG: { LOCK_TIMEOUT_MS: 1000 },
    getAllRows_: key => {
      if (key === 'PRODUCTS') return [
        { 'Product ID': 'P1', 'Product Name': 'No Cost', 'Current Stock': 5, 'Purchase Price': 0, 'Selling Price': 100, 'Created At': new Date('2026-09-01') },
        { 'Product ID': 'P2', 'Product Name': 'Priced', 'Current Stock': 3, 'Purchase Price': 50, 'Selling Price': 80, 'Created At': new Date('2026-09-01') },
        { 'Product ID': 'P3', 'Product Name': 'Zero Stock', 'Current Stock': 0, 'Purchase Price': 0, 'Selling Price': 0, 'Created At': new Date('2026-09-01') }
      ];
      if (key === 'STOCK_LOTS') return [];
      return [];
    },
    createLot_: (...args) => { createdLots.push(args); return 'LOT-' + createdLots.length; },
    ok_: data => ({ success: true, data }),
    fail_: message => ({ success: false, message: String(message) }),
    logError_: () => {}
  });

  const result = api.migrateOpeningStockLots_();
  assert.equal(result.success, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)), { created: 1, unresolved: 1 });
  assert.deepEqual(createdLots.map(args => args[0]), ['P2']);
  assert.equal(alerts.length, 1);
  assert.match(String(alerts[0][1]), /Created:\s*1/i);
  assert.match(String(alerts[0][1]), /Unresolved:\s*1/i);
});


test('Products bootstrap exposes unresolved internal lot count and quantity without counting zero-cost Purchase lots', () => {
  const api = loadProductFunctions(['getProductsBootstrap'], {
    requirePermission_: () => ({}),
    activeRows_: key => key === 'PRODUCTS' ? [
      { 'Product ID': 'P1', 'Product Name': 'Tank', 'Current Stock': 3, 'Purchase Price': 100, Status: 'Active' }
    ] : [],
    getSettingsMap_: () => ({ 'Currency Symbol': '৳', 'Low Stock Threshold': 5 }),
    getAllRows_: key => {
      if (key === 'PRODUCT_CATEGORIES' || key === 'PRODUCT_UNITS') return [];
      if (key === 'STOCK_LOTS') return [
        { 'Product ID': 'P1', 'Purchase ID': 'OPENING', 'Purchase Price': 0, 'Remaining Quantity': 2 },
        { 'Product ID': 'P1', 'Purchase ID': 'PUR-000001', 'Purchase Price': 0, 'Remaining Quantity': 1 }
      ];
      return [];
    },
    ok_: data => ({ success: true, data }),
    fail_: message => ({ success: false, message: String(message) }),
    logError_: () => {}
  });

  const result = api.getProductsBootstrap('TOKEN');
  assert.equal(result.success, true);
  const product = result.data.products[0];
  assert.equal(product['Unpriced Lot Count'], 1);
  assert.equal(product['Unpriced Remaining Quantity'], 2);
  assert.equal(product['Stock Value'], 200, 'existing valuation fallback remains unchanged');
});


test('getProductLots returns explicit correction eligibility and exact historical impact for the browser', () => {
  const reads = {};
  const api = loadStockFunctions([
    'isInternalCostCorrectionSource_',
    'isZeroStoredCost_',
    'buildInternalStockLotCostCandidate_',
    'getProductLots'
  ], {
    requirePermission_: () => ({}),
    sanitizeInput_: value => String(value == null ? '' : value).trim(),
    getAllRows_: key => {
      reads[key] = (reads[key] || 0) + 1;
      if (key === 'PRODUCTS') return [{ 'Product ID': 'P1', 'Product Name': 'Tank', 'Purchase Price': 4100, 'Selling Price': 5000 }];
      if (key === 'STOCK_LOTS') return [
        { 'Lot ID': 'LOT-1', 'Product ID': 'P1', 'Product Name': 'Tank', 'Purchase ID': 'OPENING', 'Purchase Date': '2026-09-01', 'Purchase Price': 0, 'Sell Price': 5000, 'Original Quantity': 2, 'Remaining Quantity': 1, 'Status': 'Active', 'Created At': new Date('2026-09-01') },
        { 'Lot ID': 'LOT-2', 'Product ID': 'P1', 'Product Name': 'Tank', 'Purchase ID': 'PUR-000001', 'Purchase Date': '2026-09-02', 'Purchase Price': 0, 'Sell Price': 5100, 'Original Quantity': 1, 'Remaining Quantity': 1, 'Status': 'Active', 'Created At': new Date('2026-09-02') }
      ];
      if (key === 'SALE_ITEM_LOTS') return [
        { 'Invoice ID': 'INV-1', 'Product ID': 'P1', 'Lot ID': 'LOT-1', Quantity: 0.5, 'Unit Cost': 100 },
        { 'Invoice ID': 'INV-2', 'Product ID': 'P1', 'Lot ID': 'LOT-X', Quantity: 1, 'Unit Cost': 0 }
      ];
      return [];
    },
    compareLotsFifo_: (a, b) => String(a['Lot ID']).localeCompare(String(b['Lot ID'])),
    safeDateOnly_: value => String(value || '').slice(0, 10),
    lotSellPrice_: lot => Number(lot && lot['Sell Price']) || 0,
    roundMoney_: value => Math.round((Number(value) + Number.EPSILON) * 100) / 100,
    ok_: data => ({ success: true, data }),
    fail_: message => ({ success: false, message: String(message) }),
    logError_: () => {}
  });

  const result = api.getProductLots('TOKEN', 'P1');
  assert.equal(result.success, true);
  assert.deepEqual(reads, { PRODUCTS: 1, STOCK_LOTS: 1, SALE_ITEM_LOTS: 1 });
  const opening = result.data[0];
  assert.equal(opening.costCorrectionEligible, true);
  assert.equal(opening.productPurchasePrice, 4100);
  assert.equal(opening.suggestedPurchasePrice, 4100);
  assert.equal(opening.matchedHistoricalQuantity, 0.5);
  assert.equal(opening.affectedInvoiceCount, 1);
  assert.equal(opening.historicalCurrentCogs, 50);
  assert.equal(opening.historicalCogsDelta, 2000);
  assert.equal(result.data[1].costCorrectionEligible, false, 'real Purchase lot is never eligible in this workflow');
});


test('correcting LOT-000481 repairs invoice and Profit Report COGS without rewriting sale economics', () => {
  const roundMoney = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  const sheets = {
    PRODUCTS: [
      { 'Product ID': 'P-TANK', 'Product Name': 'Tank N.M Black 500 L', 'Purchase Price': 4100 },
      { 'Product ID': 'P-OTHER', 'Product Name': 'Other Item', 'Purchase Price': 703 }
    ],
    STOCK_LOTS: [
      { _rowIndex: 2, 'Lot ID': 'LOT-000481', 'Product ID': 'P-TANK', 'Product Name': 'Tank N.M Black 500 L', 'Purchase ID': 'OPENING', 'Purchase Price': 0, 'Original Quantity': 2, 'Remaining Quantity': 1, Status: 'Active' },
      { _rowIndex: 3, 'Lot ID': 'LOT-OTHER', 'Product ID': 'P-OTHER', 'Product Name': 'Other Item', 'Purchase ID': 'OPENING', 'Purchase Price': 703, 'Original Quantity': 1, 'Remaining Quantity': 0, Status: 'Consumed' }
    ],
    SALE_ITEM_LOTS: [
      { _rowIndex: 2, 'Invoice ID': 'INV-000070', 'Product ID': 'P-TANK', 'Lot ID': 'LOT-000481', Quantity: 1, 'Unit Cost': 0 },
      { _rowIndex: 3, 'Invoice ID': 'INV-000070', 'Product ID': 'P-OTHER', 'Lot ID': 'LOT-OTHER', Quantity: 1, 'Unit Cost': 703 }
    ]
  };
  const sales = [{
    'Invoice ID': 'INV-000070', Date: '2026-09-21', Subtotal: 4980, 'Grand Total': 4980,
    Discount: 0, 'Paid Amount': 4980, 'Due Amount': 0, 'Payment Type': 'Cash', 'Customer Name': 'Buyer'
  }];
  const saleItems = [
    { 'Invoice ID': 'INV-000070', 'Product ID': 'P-TANK', 'Product Name': 'Tank N.M Black 500 L', Quantity: 1, 'Unit Price': 4277, 'Line Total': 4277 },
    { 'Invoice ID': 'INV-000070', 'Product ID': 'P-OTHER', 'Product Name': 'Other Item', Quantity: 1, 'Unit Price': 703, 'Line Total': 703 }
  ];
  const saleSnapshot = JSON.stringify(sales);
  const saleItemsSnapshot = JSON.stringify(saleItems);

  const invoiceProfitApi = loadFileFunctions('SalesManagement.gs', ['buildSalesInvoiceProfitMetrics_'], {
    roundMoney_: roundMoney,
    economicReturnLineAmount_: () => 0,
    getAllRows_: key => key === 'SALE_ITEM_LOTS' ? sheets.SALE_ITEM_LOTS : [],
    activeRows_: () => [],
    isValidNonNegativeNumber_: value => value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) >= 0
  });
  const before = invoiceProfitApi.buildSalesInvoiceProfitMetrics_(sales, saleItems, [], {});
  assert.equal(before['INV-000070'].profit, 4277);

  const correctionApi = loadStockFunctions([
    'isInternalCostCorrectionSource_',
    'isZeroStoredCost_',
    'loadInternalStockLotCostCorrectionContext_',
    'prepareInternalStockLotCostCorrections_',
    'commitInternalStockLotCostCorrections_',
    'correctInternalStockLotCosts'
  ], {
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    CONFIG: { LOCK_TIMEOUT_MS: 1000 },
    requirePermission_: () => ({ name: 'Admin' }),
    getAllRows_: key => sheets[key] || [],
    sanitizeInput_: value => String(value == null ? '' : value).trim(),
    isValidNonNegativeNumber_: value => value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) >= 0,
    roundMoney_: roundMoney,
    updateRowFields_: (key, rowIndex, fields) => Object.assign(sheets[key].find(row => row._rowIndex === rowIndex), fields),
    appendRow_: () => {},
    generateId_: () => 'SLC-000001',
    actorName_: user => user.name,
    ok_: data => ({ success: true, ...data }),
    fail_: message => ({ success: false, message }),
    logError_: () => {}
  });
  const corrected = correctionApi.correctInternalStockLotCosts('TOKEN', {
    corrections: [{ lotId: 'LOT-000481', newPurchasePrice: 4100 }],
    reason: 'Opening stock purchase cost was omitted during setup'
  });
  assert.equal(corrected.success, true);
  assert.equal(sheets.STOCK_LOTS[0]['Purchase Price'], 4100);
  assert.equal(sheets.SALE_ITEM_LOTS[0]['Unit Cost'], 4100);

  const after = invoiceProfitApi.buildSalesInvoiceProfitMetrics_(sales, saleItems, [], {});
  assert.equal(after['INV-000070'].profit, 177);
  assert.ok(Math.abs(after['INV-000070'].profitMarginPercent - (177 / 4980 * 100)) < 0.000001);

  const reportApi = loadFileFunctions('Reports.gs', ['inRange_', 'sortedByDesc_', 'computeProfit_'], {
    getAllRows_: key => {
      if (key === 'SALES') return sales;
      if (key === 'SALE_ITEMS') return saleItems;
      if (key === 'SALE_ITEM_LOTS') return sheets.SALE_ITEM_LOTS;
      return [];
    },
    activeSalesReturnItems_: () => [],
    activeRows_: () => [],
    isDeleted_: () => false,
    safeDateOnly_: value => String(value || '').slice(0, 10),
    assertUniqueSalesInvoiceIds_: () => {},
    CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) },
    economicReturnLineAmount_: () => 0,
    isValidNonNegativeNumber_: value => value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) >= 0,
    computeSettlementDiscountProfit_: () => ({ customerDiscountGiven: 0, supplierDiscountReceived: 0, netProfitImpact: 0 }),
    roundMoney_: roundMoney
  });
  const report = reportApi.computeProfit_({ from: '2026-09-21', to: '2026-09-21' });
  assert.equal(report.totals.netRevenue, 4980);
  assert.equal(report.totals.cogs, 4803);
  assert.equal(report.totals.grossProfit, 177);
  assert.equal(report.totals.grossProfit, after['INV-000070'].profit);
  assert.equal(JSON.stringify(sales), saleSnapshot, 'sale header economics must not change');
  assert.equal(JSON.stringify(saleItems), saleItemsSnapshot, 'sale line revenue and quantity must not change');
});