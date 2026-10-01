'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

function fnSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `missing function ${name}`);
  let brace = source.indexOf('{', start);
  assert(brace >= 0, `missing opening brace for ${name}`);
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

function blockForHeader(source, key, nextKey) {
  const start = source.indexOf(`${key}: [`);
  assert(start >= 0, `missing ${key} header block`);
  const end = nextKey ? source.indexOf(`${nextKey}: [`, start) : source.indexOf('],', start) + 2;
  assert(end > start, `could not bound ${key} header block`);
  return source.slice(start, end);
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('schema stores purchase-line, stock-lot, and sale-lot selling prices', () => {
  const cfg = read('Config.gs');
  assert.match(blockForHeader(cfg, 'PURCHASE_ITEMS', 'SALES'), /["']Sell Price["']/);
  assert.match(blockForHeader(cfg, 'STOCK_LOTS', 'SALE_ITEM_LOTS'), /["']Sell Price["']/);
  assert.match(blockForHeader(cfg, 'SALE_ITEM_LOTS', 'SETTINGS'), /["']Unit Sell Price["']/);
});

test('setup runs idempotent lot sell-price migration and migration fills blank lots from product default', () => {
  const setup = fnSource(read('Setup.gs'), 'setupSystem_');
  assert.match(setup, /migrateStockLotSellPrices_\(/);
  const migration = fnSource(read('StockLots.gs'), 'migrateStockLotSellPrices_');
  assert.match(migration, /Selling Price/);
  assert.match(migration, /Sell Price/);
  assert.match(migration, /updateRowFields_\(['"]STOCK_LOTS['"]/);
  assert.match(migration, /===\s*['"]['"]|trim\(\)/);
});

test('lot pricing ladder follows FIFO and preserves per-lot sell prices', () => {
  const stock = read('StockLots.gs');
  const ctx = {
    safeDateOnly_: v => String(v || '').slice(0, 10),
    isValidNonNegativeNumber_: v => Number.isFinite(Number(v)) && Number(v) >= 0
  };
  vm.createContext(ctx);
  vm.runInContext(fnSource(stock, 'compareLotsFifo_'), ctx);
  vm.runInContext(fnSource(stock, 'lotSellPrice_'), ctx);
  vm.runInContext(fnSource(stock, 'buildLotPricingLadder_'), ctx);

  const product = { 'Product ID': 'P1', 'Selling Price': 150 };
  const lots = [
    { 'Lot ID': 'LOT-2', 'Product ID': 'P1', 'Purchase Date': '2026-09-02', 'Remaining Quantity': 3, 'Sell Price': 140 },
    { 'Lot ID': 'LOT-1', 'Product ID': 'P1', 'Purchase Date': '2026-09-01', 'Remaining Quantity': 2, 'Sell Price': 120 },
    { 'Lot ID': 'LOT-X', 'Product ID': 'P2', 'Purchase Date': '2026-08-01', 'Remaining Quantity': 99, 'Sell Price': 1 }
  ];
  const pricing = ctx.buildLotPricingLadder_('P1', lots, product);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(pricing.segments)), [
    { qty: 2, sellPrice: 120 },
    { qty: 3, sellPrice: 140 }
  ]);
  assert.strictEqual(pricing.fallbackSellPrice, 150);
  assert.strictEqual(pricing.autoSellingPrice, 120);
});

test('stock consumption plan and apply preserve lot sell price independently from unit cost', () => {
  const stock = read('StockLots.gs');
  const plan = fnSource(stock, 'planStockConsumption_');
  const apply = fnSource(stock, 'applyStockConsumption_');
  assert.match(plan, /unitSellPrice/);
  assert.match(plan, /fallbackSellPrice/);
  assert.match(apply, /unitSellPrice/);
  assert.match(fnSource(stock, 'createLotWithRow_'), /['"]Sell Price['"]/);
});

test('purchase UI captures sell price and submits it per line', () => {
  const ui = read('purchase.html');
  const createLine = fnSource(ui, 'purCreateCartLine_');
  const add = fnSource(ui, 'purAddProductLine_');
  const render = fnSource(ui, 'purRenderLines_');
  assert.match(createLine, /sellingPrice:\s*Number\(product\.sellingPrice\)/);
  assert.match(add, /purStartCartEntry_\(purProductById_\(productId\)\)/);
  assert.match(render, /data-f=["']sellingPrice["']/);
  assert.match(ui, /sellingPrice:\s*l\.sellingPrice/);
});

test('purchase create validates and persists lot sell price and updates product default', () => {
  const body = fnSource(read('Purchase.gs'), 'createPurchase');
  assert.match(body, /item\.sellingPrice/);
  assert.match(body, /sellPrice/);
  assert.match(body, /['"]Sell Price['"]:\s*line\.sellPrice/);
  assert.match(body, /['"]Selling Price['"]:\s*line\.sellPrice/);
  assert.match(body, /createLot_\([^;]*line\.sellPrice/s);
});

test('purchase update loads and persists sell price even when quantity is unchanged', () => {
  const src = read('PurchaseManagement.gs');
  assert.match(fnSource(src, 'getPurchaseForUpdate'), /sellingPrice/);
  const update = fnSource(src, 'updatePurchaseInternal_');
  assert.match(update, /newSellPriceByProduct|sellPriceChanges/);
  assert.match(update, /['"]Sell Price['"]/);
  assert.match(update, /['"]Selling Price['"]/);
});

test('POS automatic pricing computes exact lot total and rounded visible average', () => {
  const ui = read('pos.html');
  const src = fnSource(ui, 'posComputeAutoPricing_');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src, ctx);

  let product = {
    lotPricing: [{ qty: 2, sellPrice: 120 }, { qty: 3, sellPrice: 140 }],
    fallbackSellPrice: 150
  };
  let r = ctx.posComputeAutoPricing_(product, 5);
  assert.strictEqual(r.unitPrice, 132);
  assert.strictEqual(r.lineTotal, 660);

  product = {
    lotPricing: [{ qty: 1, sellPrice: 100.66 }, { qty: 2, sellPrice: 100.67 }],
    fallbackSellPrice: 100.67
  };
  r = ctx.posComputeAutoPricing_(product, 3);
  assert.strictEqual(r.unitPrice, 100.67);
  assert.strictEqual(r.lineTotal, 302);
});

test('POS new cart lines start automatic, manual edit persists across qty changes, and reset exists', () => {
  const ui = read('pos.html');
  const create = fnSource(ui, 'posCreateCartLine_');
  const add = fnSource(ui, 'posAddToCart_');
  const render = fnSource(ui, 'posRenderCart_');
  assert.match(create, /priceMode:\s*['"]auto['"]/);
  assert.match(create, /lineTotal/);
  assert.match(add, /posCreateCartLine_/);
  assert.match(render, /Reset to Lot Price|resetlot/i);
  assert.match(ui, /priceMode\s*=\s*['"]manual['"]/);
  assert.match(ui, /priceMode\s*===\s*['"]auto['"]/);
  assert.match(ui, /posComputeAutoPricing_/);
});

test('POS bootstrap exposes FIFO pricing ladder and quantity-one auto selling price', () => {
  const body = fnSource(read('Sales.gs'), 'getPosBootstrap');
  assert.match(body, /buildLotPricingLadder_/);
  assert.match(body, /lotPricing/);
  assert.match(body, /fallbackSellPrice/);
  assert.match(body, /autoSellingPrice/);
});

test('completeSale recomputes auto-mode line total from server FIFO plan but preserves manual price', () => {
  const body = fnSource(read('Sales.gs'), 'completeSale');
  assert.match(body, /priceMode/);
  assert.match(body, /auto/i);
  assert.match(body, /computePlanSellingPrice_/);
  assert.match(body, /lineTotal/);
  assert.match(body, /subtotal\s*=\s*roundMoney_\(subtotal\s*\+\s*lineTotal\)|subtotal\s*\+=\s*lineTotal/);
});

test('sale lot audit records unit sell price on new sale and sale update consumption', () => {
  assert.match(fnSource(read('Sales.gs'), 'completeSale'), /['"]Unit Sell Price['"]:\s*c\.unitSellPrice/);
  assert.match(fnSource(read('SalesManagement.gs'), 'updateSaleInternal_'), /['"]Unit Sell Price['"]:\s*cons\.unitSellPrice/);
});

test('sales return economics prefer stored line total over rounded display unit price', () => {
  const src = read('SalesReturn.gs');
  assert.match(fnSource(src, 'grossSaleItemLineTotal_'), /Line Total/);
  assert.match(fnSource(src, 'getInvoiceForReturn'), /grossSaleItemLineTotal_/);
  const prepare = fnSource(src, 'prepareSalesReturn_');
  assert.match(prepare, /grossSaleItemLineTotal_/);
  assert.match(prepare, /remainingReturnValue/);
  assert.match(fnSource(src, 'completeReturn'), /prepareSalesReturn_/);
});

test('purchase detail UI shows both purchase and sell price', () => {
  const ui = read('purchase.html');
  assert.match(ui, /Sell Price/);
  assert.match(fnSource(ui, 'purOpenView_'), /sellingPrice/);
  assert.match(fnSource(read('PurchaseManagement.gs'), 'getPurchaseDetail'), /sellingPrice/);
});


test('purchase update rewrites purchase-item Sell Price', () => {
  const body = fnSource(read('PurchaseManagement.gs'), 'updatePurchaseInternal_');
  const start = body.indexOf("appendRows_('PURCHASE_ITEMS'");
  assert(start >= 0, 'missing PURCHASE_ITEMS rewrite');
  const end = body.indexOf('}));', start);
  assert(end > start, 'could not bound PURCHASE_ITEMS rewrite');
  const rewrite = body.slice(start, end + 4);
  assert.match(rewrite, /['"]Sell Price['"]\s*:\s*sellPrice/);
});

test('sale update preserves stored exact line total when visible price and quantity are unchanged', () => {
  const src = read('SalesManagement.gs');
  const helper = fnSource(src, 'saleUpdateLineTotal_');
  const ctx = {
    isValidNonNegativeNumber_: v => Number.isFinite(Number(v)) && Number(v) >= 0,
    roundMoney_: v => Math.round((Number(v) + Number.EPSILON) * 100) / 100
  };
  vm.createContext(ctx);
  vm.runInContext(helper, ctx);

  const oldItem = { 'Quantity': 3, 'Unit Price': 100.67, 'Line Total': 302 };
  assert.strictEqual(ctx.saleUpdateLineTotal_(oldItem, 3, 100.67), 302);
  assert.strictEqual(ctx.saleUpdateLineTotal_(oldItem, 4, 100.67), 402.68);

  const getUpdate = fnSource(src, 'getSaleForUpdate');
  const update = fnSource(src, 'updateSaleInternal_');
  assert.match(getUpdate, /lineTotal/);
  assert.match(update, /saleUpdateLineTotal_/);
  assert.match(update, /newLineTotalByKey/);
  assert.match(fnSource(read('pos.html'), 'posLoadUpdateInvoice_'), /item\.lineTotal/);
});


test('purchase update rejects invalid sell price before writes', () => {
  const update = fnSource(read('PurchaseManagement.gs'), 'updatePurchaseInternal_');
  assert.match(update, /isValidNonNegativeNumber_\(sellPrice\)/);
  const validationPos = update.indexOf('isValidNonNegativeNumber_(sellPrice)');
  const firstWrite = [
    update.indexOf("deleteRow_('PURCHASE_ITEMS'"),
    update.indexOf("appendRows_('PURCHASE_ITEMS'"),
    update.indexOf("updateRowFields_('PRODUCTS'")
  ].filter(i => i >= 0).sort((a, b) => a - b)[0];
  assert(validationPos >= 0 && firstWrite >= 0 && validationPos < firstWrite, 'sell price validation must precede writes');
});

test('POS price wrapper and reset action have layout styles', () => {
  const css = read('style.html');
  assert.match(css, /\.c-price-wrap\s*\{/);
  assert.match(css, /\.c-reset-lot-price\s*\{/);
});

let failed = 0;
for (const t of tests) {
  try {
    t.fn();
    console.log(`PASS ${t.name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL ${t.name}`);
    console.error(`  ${err.message}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
