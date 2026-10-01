/**
 * StockLots.gs
 * ---------------------------------------------------------------------
 * Lot/Batch inventory layer sitting underneath Products.Current Stock.
 * Every purchase line creates its own Stock Lot (own Purchase Price, own
 * Remaining Quantity); sales/adjustments/returns consume or restore
 * specific lots via the helpers below instead of ever touching a single
 * pooled number. Products.Current Stock stays a fast-read cache exactly
 * like before — every caller of these helpers is still responsible for
 * updating it, so every existing screen that reads Current Stock keeps
 * working unchanged (POS grid, Dashboard, low-stock, etc).
 *
 * Review item 10: the client-reachable functions here now require a
 * session token. Apps Script exposes every global function without a
 * trailing underscore to google.script.run, so an ungated one is
 * reachable by anyone holding the web app URL.
 *
 * getProductLots exposed per-lot purchase prices - your cost basis - to
 * anyone with the URL. It now checks 'products':'view'.
 *
 * Review item 12 / P0 #8: consumeStockFIFO_ used to decide AND write in
 * one pass, which made "validate everything before writing anything"
 * impossible for its callers — by the time you knew line 3 was short,
 * lines 1 and 2 had already been drawn down. It is now split into
 * planStockConsumption_ (decides, writes nothing) and
 * applyStockConsumption_ (writes a plan). consumeStockFIFO_ remains as a
 * plan-then-apply wrapper with its original signature and return shape,
 * so Products.adjustStock and SalesManagement.updateSale are untouched.
 *
 * Review item 11 / P0 #7: FIFO consumed lots in 'Created At' order —
 * when the row was WRITTEN. Purchase.gs also stamped the lot's Purchase
 * Date with now() rather than the purchase's own date. So a purchase
 * backdated to last month became the NEWEST lot and FIFO consumed it
 * last, which quietly corrupts cost of goods sold and inventory
 * valuation. Both now use the real purchase date, with Lot ID as a
 * stable tiebreak for lots bought the same day (IDs are zero-padded, so
 * string order is creation order).
 *
 * P3 drift (items 8 & 10): getProductLots() now returns an explicit
 * shape instead of raw sheet rows (which leaked the internal _rowIndex
 * to the browser — every other read endpoint in the app maps its
 * output). consumeStockFIFO_'s LEGACY back-fill no longer re-finds a
 * row it just wrote: createLot_ delegates to createLotWithRow_, which
 * hands back the row index appendRow_ already returned.
 * ---------------------------------------------------------------------
 */

/**
 * FIFO ordering: oldest PURCHASE first, not oldest write. Lot ID breaks
 * ties for same-day purchases — IDs are zero-padded (LOT-000001) so
 * lexicographic order is creation order.
 *
 * Falls back to Created At when a lot has no Purchase Date, which covers
 * rows written before this change.
 */
function compareLotsFifo_(a, b) {
  const da = safeDateOnly_(a['Purchase Date']) || safeDateOnly_(a['Created At']) || '';
  const db = safeDateOnly_(b['Purchase Date']) || safeDateOnly_(b['Created At']) || '';
  if (da !== db) return da < db ? -1 : 1;
  return String(a['Lot ID']).localeCompare(String(b['Lot ID']));
}

/**
 * Returns a lot's own selling price. Legacy lots written before the Sell
 * Price column existed fall back to the product's current/default Selling
 * Price so POS remains usable before the one-time backfill is run.
 */
function lotSellPrice_(lot, productRow) {
  const raw = lot ? lot['Sell Price'] : '';
  if (raw !== '' && raw !== null && raw !== undefined && isValidNonNegativeNumber_(raw)) {
    return Number(raw);
  }
  const fallback = productRow ? productRow['Selling Price'] : 0;
  return isValidNonNegativeNumber_(fallback) ? Number(fallback) : 0;
}

/**
 * Compact FIFO pricing ladder for POS. Adjacent lots with the same sell
 * price are merged so bootstrap payload size grows with price changes, not
 * with every purchase row. Uses the exact same compareLotsFifo_ ordering as
 * stock consumption.
 */
function buildLotPricingLadder_(productId, allLots, productRow) {
  const fallbackSellPrice = lotSellPrice_(null, productRow);
  const lots = (allLots || [])
    .filter(function (l) {
      return l['Product ID'] === productId && (Number(l['Remaining Quantity']) || 0) > 0 && l['Status'] !== 'Deleted';
    })
    .sort(compareLotsFifo_);
  const segments = [];
  lots.forEach(function (lot) {
    const qty = Number(lot['Remaining Quantity']) || 0;
    if (qty <= 0) return;
    const sellPrice = lotSellPrice_(lot, productRow);
    const prev = segments.length ? segments[segments.length - 1] : null;
    if (prev && Math.abs(prev.sellPrice - sellPrice) < 0.0000001) prev.qty += qty;
    else segments.push({ qty: qty, sellPrice: sellPrice });
  });
  return {
    segments: segments,
    fallbackSellPrice: fallbackSellPrice,
    autoSellingPrice: segments.length ? segments[0].sellPrice : fallbackSellPrice
  };
}

/**
 * Server-authoritative automatic sale pricing for a FIFO consumption plan.
 * Unit Price is the 2-decimal display average; Line Total is the exact
 * 2-decimal sum of lot sell-price allocations, so 1-paisa rounding drift
 * cannot accumulate when an average has more than two decimals.
 */
function computePlanSellingPrice_(plan, qty) {
  let total = 0;
  (plan.draws || []).forEach(function (d) {
    total += (Number(d.take) || 0) * (Number(d.unitSellPrice) || 0);
  });
  if ((Number(plan.shortfall) || 0) > 0) {
    total += (Number(plan.shortfall) || 0) * (Number(plan.fallbackSellPrice) || 0);
  }
  const lineTotal = roundMoney_(total);
  const quantity = Number(qty) || 0;
  return {
    unitPrice: quantity > 0 ? roundMoney_(lineTotal / quantity) : 0,
    lineTotal: lineTotal
  };
}

/**
 * Creates one lot row and returns { id, rowIndex }. appendRow_ already
 * hands back the sheet row it wrote, so a caller that needs to amend the
 * row it just created never has to search for it again.
 */
function createLotWithRow_(productId, productName, purchaseId, purchaseDate, purchasePrice, qty, supplierId, supplierName, sellPrice) {
  assertPositiveInternalLotCost_(purchaseId, qty, purchasePrice);
  let resolvedSellPrice = sellPrice;
  if (!isValidNonNegativeNumber_(resolvedSellPrice)) {
    const product = getAllRows_('PRODUCTS').filter(function (p) { return p['Product ID'] === productId; })[0];
    resolvedSellPrice = product ? Number(product['Selling Price']) || 0 : 0;
  }
  const id = generateId_('STOCK_LOTS');
  const rowIndex = appendRow_('STOCK_LOTS', {
    'Lot ID': id, 'Product ID': productId, 'Product Name': productName,
    'Purchase ID': purchaseId, 'Purchase Date': purchaseDate,
    'Purchase Price': Number(purchasePrice) || 0, 'Sell Price': Number(resolvedSellPrice) || 0,
    'Original Quantity': Number(qty) || 0, 'Remaining Quantity': Number(qty) || 0,
    'Status': 'Active', 'Created At': new Date(),
    'Supplier ID': supplierId || '', 'Supplier Name': supplierName || ''
  });
  return { id: id, rowIndex: rowIndex };
}

/**
 * Creates one lot row. Returns the new Lot ID. supplierId/supplierName are
 * optional and trailing (blank for adjustment/legacy/opening-migration
 * lots, which have no single supplier) so every caller from before
 * multi-supplier stock keeps working unchanged.
 */
function createLot_(productId, productName, purchaseId, purchaseDate, purchasePrice, qty, supplierId, supplierName, sellPrice) {
  return createLotWithRow_(productId, productName, purchaseId, purchaseDate, purchasePrice, qty, supplierId, supplierName, sellPrice).id;
}

/**
 * Draws `qty` units of productId out of its lots, oldest lot first (FIFO).
 * Mutates each drawn-from lot's Remaining Quantity immediately. Does NOT
 * touch Products.Current Stock or write Stock Movement rows — the caller
 * (which already knows the pre-write Current Stock and reference/type,
 * same as the pre-lot code) does that, so batched appends stay intact.
 *
 * Self-healing: if the product's lots don't add up to `qty` (legacy data
 * from before the lot system / before migrateOpeningStockLots ran), the
 * shortfall is recorded as an "OVERSOLD" negative lot at the product's
 * on-file Purchase Price instead of blocking the sale — same spirit as
 * getSheetHeaders_ self-healing missing columns.
 *
 * Returns [{ lotId, qty, unitCost }, ...] — one entry per lot drawn from.
 *
 * FIFO always runs across every supplier lot for the product.
 */
function consumeStockFIFO_(productId, qty) {
  return applyStockConsumption_(planStockConsumption_(productId, qty));
}

/** Remaining own-stock effect of an invoice, already net of returns.
 * Sourcing ledger rows can be edited/deleted independently of the sale, so
 * their current quantity must never determine stock reversal quantities.
 * A sourcing history with no lot consumption means a fully vendor line.
 * Only pre-lot sales with neither kind of evidence use the legacy fallback.
 */
/**
 * One-time/idempotent repair for historical SALE_ITEM_LOTS rows created
 * before Supplier ID was declared in CONFIG.HEADERS. Existing non-blank
 * values are authoritative and never overwritten.
 */
function repairSaleItemLotSupplierIds_() {
  const lotsById = {};
  getAllRows_('STOCK_LOTS').forEach(function (lot) {
    lotsById[String(lot['Lot ID'] || '')] = lot;
  });

  let scanned = 0;
  let repaired = 0;
  let unresolved = 0;

  getAllRows_('SALE_ITEM_LOTS').forEach(function (row) {
    scanned++;
    if (String(row['Supplier ID'] || '').trim()) return;
    const lot = lotsById[String(row['Lot ID'] || '')];
    const supplierId = lot ? String(lot['Supplier ID'] || '').trim() : '';
    if (!supplierId) {
      unresolved++;
      return;
    }
    updateRowFields_('SALE_ITEM_LOTS', row._rowIndex, { 'Supplier ID': supplierId });
    repaired++;
  });

  return { scanned: scanned, repaired: repaired, unresolved: unresolved };
}

function outstandingSaleOwnStockByProduct_(invoiceId, saleItems, returnItems, consumptionRows, vendorSourcingRows) {
  const quantities = {};
  const evidenced = {};
  (consumptionRows || getAllRows_('SALE_ITEM_LOTS')).forEach(function (row) {
    if (row['Invoice ID'] !== invoiceId) return;
    const key = row['Product ID'];
    evidenced[key] = true;
    quantities[key] = (quantities[key] || 0) + Math.max(0, Number(row['Quantity']) || 0);
  });
  (vendorSourcingRows || getAllRows_('VENDOR_SOURCING')).forEach(function (row) {
    if (row['Invoice ID'] !== invoiceId) return;
    const key = row['Product ID'];
    evidenced[key] = true;
    quantities[key] = quantities[key] || 0;
  });
  (saleItems || []).forEach(function (row) {
    const key = row['Product ID'];
    if (!evidenced[key]) quantities[key] = (quantities[key] || 0) + (Number(row['Quantity']) || 0);
  });
  (returnItems || []).forEach(function (row) {
    const key = row['Product ID'];
    if (!evidenced[key]) quantities[key] = Math.max(0, (quantities[key] || 0) - (Number(row['Return Quantity']) || 0));
  });
  return quantities;
}

/**
 * Decides which lots would satisfy `qty`, and WRITES NOTHING. This is the
 * half a caller runs during validation, so it can find out that line 3 is
 * short before line 1 has been touched.
 *
 * Pass `allLots` (one getAllRows_('STOCK_LOTS')) when planning several
 * products in a row, otherwise each call re-reads the whole sheet.
 *
 * Returns { productId, draws: [{ lotId, rowIndex, take, unitCost,
 * remainingAfter }], shortfall, fallbackPrice, fallbackName }.
 */
function planStockConsumption_(productId, qty, allLots, productRow) {
  let need = Number(qty) || 0;
  const product = productRow || getAllRows_('PRODUCTS').filter(function (p) { return p['Product ID'] === productId; })[0];
  const plan = {
    productId: productId, draws: [], shortfall: 0,
    fallbackPrice: product ? Number(product['Purchase Price']) || 0 : 0,
    fallbackSellPrice: product ? Number(product['Selling Price']) || 0 : 0,
    fallbackName: product ? product['Product Name'] : ''
  };
  if (need <= 0) return plan;

  const lots = (allLots || getAllRows_('STOCK_LOTS'))
    .filter(function (l) {
      return l['Product ID'] === productId && (Number(l['Remaining Quantity']) || 0) > 0;
    })
    .sort(compareLotsFifo_);

  for (let i = 0; i < lots.length && need > 0; i++) {
    const lot = lots[i];
    const available = Number(lot['Remaining Quantity']) || 0;
    const take = Math.min(available, need);
    if (take <= 0) continue;
    plan.draws.push({
      lotId: lot['Lot ID'],
      rowIndex: lot._rowIndex,
      take: take,
      unitCost: Number(lot['Purchase Price']) || 0,
      unitSellPrice: lotSellPrice_(lot, product),
      remainingAfter: available - take
    });
    need -= take;
  }

  if (need > 0) {
    // The product does not have enough physical stock. POS deliberately allows
    // selling past zero, so the shortfall becomes an OVERSOLD lot.
    // zero (see completeSale/updateSale). Recorded as a shortfall now;
    // applyStockConsumption_ back-fills a lot rather than blocking the sale.
    plan.shortfall = need;
  }
  return plan;
}

/**
 * Sale-only planner for a line whose shortage is being sourced from a vendor.
 *
 * Positive lots can temporarily exceed Products.Current Stock when earlier
 * OVERSOLD debt is still present and a later Sales Return/Purchase created
 * positive lots that offset that debt. A vendor shortage must therefore be
 * based on NET shop-owned stock, not the sum of positive lots alone.
 *
 * This deliberately does not replace planStockConsumption_ globally: negative
 * stock sales, returns, purchase returns, delete/reversal and other inventory
 * flows keep their existing lot semantics.
 */
function planSaleVendorConsumption_(productId, qty, allLots, productRow) {
  const requested = Number(qty) || 0;
  const product = productRow || getAllRows_('PRODUCTS').filter(function (p) { return p['Product ID'] === productId; })[0];
  if (requested <= 0) return planStockConsumption_(productId, 0, allLots, product);

  const netOwnedAvailable = Math.max(0, product ? (Number(product['Current Stock']) || 0) : 0);
  const ownTarget = Math.min(requested, netOwnedAvailable);
  const plan = planStockConsumption_(productId, ownTarget, allLots, product);
  const ownDrawn = plan.draws.reduce(function (sum, d) { return sum + (Number(d.take) || 0); }, 0);

  // Any part of the requested sale that cannot be backed by the shop's NET
  // owned stock is the vendor shortage. Do not leave planStockConsumption_'s
  // own shortfall here: completeSale/updateSale will neutralize this amount
  // into VENDOR_SOURCING before applyStockConsumption_ writes anything.
  plan.shortfall = Math.max(0, requested - ownDrawn);
  return plan;
}

/**
 * Writes a plan from planStockConsumption_. Returns the same
 * [{ lotId, qty, unitCost }] shape consumeStockFIFO_ has always returned,
 * so callers that build Stock Movement rows from it need no changes.
 */
function applyStockConsumption_(plan) {
  const consumption = [];

  plan.draws.forEach(function (d) {
    updateRowFields_('STOCK_LOTS', d.rowIndex, { 'Remaining Quantity': d.remainingAfter });
    consumption.push({ lotId: d.lotId, qty: d.take, unitCost: d.unitCost, unitSellPrice: d.unitSellPrice });
  });

  if (plan.shortfall > 0) {
    // Keep the shortfall as a negative remaining quantity. This makes the
    // lot ledger reconcile with Products.Current Stock even when stock is
    // negative, while FIFO ignores the negative lot until a real purchase
    // arrives. The lot is bookkeeping only; no physical stock was consumed.
    const lot = createLotWithRow_(plan.productId, plan.fallbackName, 'OVERSOLD', new Date(), plan.fallbackPrice, plan.shortfall, '', '', plan.fallbackSellPrice);
    updateRowFields_('STOCK_LOTS', lot.rowIndex, {
      'Remaining Quantity': -plan.shortfall,
      'Status': 'Oversold'
    });
    consumption.push({ lotId: lot.id, qty: plan.shortfall, unitCost: plan.fallbackPrice, unitSellPrice: plan.fallbackSellPrice });
  }
  return consumption;
}

/**
 * Restores `qty` units of productId back onto the lots a specific sale
 * (invoiceId) actually drew from — walking its recorded SALE_ITEM_LOTS
 * rows most-recently-consumed-first (LIFO), so a return unwinds a sale
 * the same way it happened. Each SALE_ITEM_LOTS row's own Quantity is
 * decremented as it's used up, so repeated partial returns on the same
 * invoice/product never restore more than was actually sold from a lot.
 * Falls back to a fresh lot (tagged with fallbackReference) for any
 * leftover the recorded consumption can't cover, so a return never
 * silently fails to give stock back.
 *
 * supplierId is optional but should always be passed once the caller knows
 * it: an invoice can have two SALE_ITEMS lines for the same product from
 * different suppliers (or one real supplier and one unattributed — see
 * planStockConsumption_), so Invoice ID + Product ID alone can no longer
 * tell their consumption rows apart. Pass '' to restore only the
 * unattributed line's own consumption; omitting supplierId entirely
 * restores across every line (only safe for callers that predate
 * multi-supplier lines).
 *
 * Returns [{ lotId, qty }, ...] restored, for the caller's Stock Movement rows.
 */
/**
 * Read-only Sales Return restoration planner. It reserves SALE_ITEM_LOTS
 * evidence and STOCK_LOTS remaining quantities in an optional shared virtual
 * state so several child returns can be fully planned before any Sheet write.
 */
function planSaleReturnRestoration_(invoiceId, productId, productName, qty, options) {
  const opts = options || {};
  let need = Number(qty) || 0;
  const plan = {
    invoiceId: invoiceId,
    productId: productId,
    productName: productName,
    qty: need,
    draws: [],
    fallbackQty: 0
  };
  if (need <= 0) return plan;

  const supplierId = opts.supplierId;
  const scoped = supplierId !== undefined && supplierId !== null;
  const saleItemLots = opts.saleItemLots || getAllRows_('SALE_ITEM_LOTS');
  const stockLots = opts.stockLots || getAllRows_('STOCK_LOTS');
  const products = opts.products || getAllRows_('PRODUCTS');
  const virtualState = opts.virtualState || {};
  const saleQtyByRow = virtualState.saleItemLotQtyByRowIndex || (virtualState.saleItemLotQtyByRowIndex = {});
  const lotRemainingByRow = virtualState.lotRemainingByRowIndex || (virtualState.lotRemainingByRowIndex = {});

  const consumedRows = saleItemLots
    .filter(function (r) {
      return r['Invoice ID'] === invoiceId && r['Product ID'] === productId &&
        (!scoped || r['Supplier ID'] === supplierId);
    })
    .sort(function (a, b) { return b._rowIndex - a._rowIndex; });

  const lotsById = opts.lotsById || {};
  if (!opts.lotsById) {
    stockLots.forEach(function (lot) { lotsById[lot['Lot ID']] = lot; });
  }
  const product = products.filter(function (p) { return p['Product ID'] === productId; })[0];
  const fallbackPrice = product ? Number(product['Purchase Price']) || 0 : 0;

  for (let i = 0; i < consumedRows.length && need > 0; i++) {
    const row = consumedRows[i];
    if (!Object.prototype.hasOwnProperty.call(saleQtyByRow, row._rowIndex)) {
      saleQtyByRow[row._rowIndex] = Math.max(0, Number(row['Quantity']) || 0);
    }
    const outstanding = Number(saleQtyByRow[row._rowIndex]) || 0;
    const give = Math.min(outstanding, need);
    if (give <= 0) continue;

    const lot = lotsById[row['Lot ID']];
    const saleItemLotQtyAfter = outstanding - give;
    saleQtyByRow[row._rowIndex] = saleItemLotQtyAfter;

    if (lot && lot['Purchase ID'] !== 'OVERSOLD' && lot['Purchase ID'] !== 'LEGACY') {
      if (!Object.prototype.hasOwnProperty.call(lotRemainingByRow, lot._rowIndex)) {
        lotRemainingByRow[lot._rowIndex] = Number(lot['Remaining Quantity']) || 0;
      }
      const lotRemainingAfter = (Number(lotRemainingByRow[lot._rowIndex]) || 0) + give;
      lotRemainingByRow[lot._rowIndex] = lotRemainingAfter;
      plan.draws.push({
        sourceKind: 'LOT',
        saleItemLotRowIndex: row._rowIndex,
        saleItemLotQtyAfter: saleItemLotQtyAfter,
        lotRowIndex: lot._rowIndex,
        lotRemainingAfter: lotRemainingAfter,
        lotId: row['Lot ID'],
        qty: give,
        supplierId: row['Supplier ID'] || ''
      });
    } else {
      plan.draws.push({
        sourceKind: 'FALLBACK',
        saleItemLotRowIndex: row._rowIndex,
        saleItemLotQtyAfter: saleItemLotQtyAfter,
        lotId: row['Lot ID'] || '',
        qty: give,
        purchasePrice: fallbackPrice,
        supplierId: row['Supplier ID'] || ''
      });
      plan.fallbackQty += give;
    }
    need -= give;
  }

  if (need > 0) {
    plan.draws.push({
      sourceKind: 'FALLBACK',
      saleItemLotRowIndex: null,
      saleItemLotQtyAfter: null,
      lotId: '',
      qty: need,
      purchasePrice: fallbackPrice,
      supplierId: scoped ? supplierId : ''
    });
    plan.fallbackQty += need;
  }
  return plan;
}

/** Apply a previously prepared Sales Return restoration plan. */
function applySaleReturnRestorationPlan_(plan, fallbackReference) {
  const restored = [];
  (plan && plan.draws || []).forEach(function (draw) {
    let lotId = draw.lotId;
    if (draw.sourceKind === 'LOT') {
      updateRowFields_('STOCK_LOTS', draw.lotRowIndex, { 'Remaining Quantity': draw.lotRemainingAfter });
    } else {
      lotId = createLot_(
        plan.productId,
        plan.productName,
        fallbackReference || 'RETURN',
        new Date(),
        Number(draw.purchasePrice) || 0,
        draw.qty,
        draw.supplierId || '',
        ''
      );
    }
    if (draw.saleItemLotRowIndex) {
      updateRowFields_('SALE_ITEM_LOTS', draw.saleItemLotRowIndex, { 'Quantity': draw.saleItemLotQtyAfter });
    }
    restored.push({ lotId: lotId, qty: draw.qty });
  });
  return restored;
}

/** Compatibility wrapper for existing single-return callers. */
function restoreStockToLots_(invoiceId, productId, productName, qty, fallbackReference, supplierId) {
  return applySaleReturnRestorationPlan_(
    planSaleReturnRestoration_(invoiceId, productId, productName, qty, { supplierId: supplierId }),
    fallbackReference
  );
}

/**
 * Reduces the lot a specific purchase line created (Purchase Return —
 * goods physically leaving to go back to the supplier). Falls back to
 * FIFO across whatever lots exist if the purchase predates the lot
 * system (no matching lot row on file), so old purchases can still be
 * returned. Returns [{ lotId, qty }, ...] for the caller's Stock Movement rows.
 */
function reduceLotForPurchaseReturn_(purchaseId, productId, qty) {
  return applyPurchaseReturnLotReduction_(
    planPurchaseReturnLotReduction_(purchaseId, productId, qty)
  );
}

/**
 * Read-only Purchase Return planner.  A purchase can have more than one lot
 * for a product in historical data, so every matching lot is considered in
 * FIFO order.  If the purchase predates the lot system and has no matching
 * lot at all, preserve the old legacy fallback by planning FIFO across the
 * product's available lots — but never allow a shortfall/OVERSOLD write from a
 * Purchase Return.
 */
function planPurchaseReturnLotReduction_(purchaseId, productId, qty, allLots) {
  let need = Number(qty) || 0;
  const plan = { purchaseId: purchaseId, productId: productId, draws: [], legacyFallback: false };
  if (need <= 0) return plan;

  const lots = allLots || getAllRows_('STOCK_LOTS');
  const purchaseLotsAll = lots.filter(function (l) {
    return l['Purchase ID'] === purchaseId && l['Product ID'] === productId;
  });

  if (purchaseLotsAll.length) {
    const availableLots = purchaseLotsAll
      .filter(function (l) { return (Number(l['Remaining Quantity']) || 0) > 0; })
      .sort(compareLotsFifo_);

    for (let i = 0; i < availableLots.length && need > 0; i++) {
      const lot = availableLots[i];
      const available = Number(lot['Remaining Quantity']) || 0;
      const take = Math.min(available, need);
      if (take <= 0) continue;
      plan.draws.push({
        lotId: lot['Lot ID'], rowIndex: lot._rowIndex, take: take,
        unitCost: Number(lot['Purchase Price']) || 0,
        remainingAfter: available - take
      });
      need -= take;
    }

    if (need > 0) {
      const remaining = plan.draws.reduce(function (sum, d) { return sum + d.take; }, 0);
      throw new Error('Lots for this purchase only have ' + remaining + ' remaining \u2014 cannot return ' + qty + '.');
    }
    return plan;
  }

  const legacyPlan = planStockConsumption_(productId, need, lots);
  if (legacyPlan.shortfall > 0) {
    const available = need - legacyPlan.shortfall;
    throw new Error('Only ' + available + ' units are available in stock lots \u2014 cannot return ' + need + '.');
  }
  plan.legacyFallback = true;
  plan.draws = legacyPlan.draws;
  return plan;
}

/** Applies a previously validated Purchase Return lot plan. */
function applyPurchaseReturnLotReduction_(plan) {
  const reduced = [];
  (plan && plan.draws ? plan.draws : []).forEach(function (d) {
    updateRowFields_('STOCK_LOTS', d.rowIndex, {
      'Remaining Quantity': d.remainingAfter,
      'Status': d.remainingAfter > 0 ? 'Active' : 'Consumed'
    });
    reduced.push({ lotId: d.lotId, qty: d.take, unitCost: d.unitCost });
  });
  return reduced;
}

/** True when a lot source is internal/non-purchase stock eligible for cost repair. */
function isInternalCostCorrectionSource_(purchaseId) {
  const source = String(purchaseId || '').trim().toUpperCase();
  return source === 'OPENING' ||
    source === 'OPENING-MIGRATION' ||
    source === 'ADJUSTMENT' ||
    source === 'LEGACY' ||
    source.indexOf('OPENING-') === 0 ||
    source.indexOf('ADJUSTMENT-') === 0;
}

/** Prevents positive internal stock from ever being created without a real cost. */
function assertPositiveInternalLotCost_(purchaseId, qty, purchasePrice) {
  if (!isInternalCostCorrectionSource_(purchaseId)) return;
  if ((Number(qty) || 0) <= 0) return;
  if (!isValidNonNegativeNumber_(purchasePrice) || Number(purchasePrice) <= 0) {
    throw new Error("Set this product's Purchase Price before adding stock.");
  }
}

/** Blank/null or numeric zero means the internal lot has no stored cost. */
function isZeroStoredCost_(rawCost) {
  if (rawCost === '' || rawCost === null || rawCost === undefined) return true;
  if (typeof rawCost === 'string' && rawCost.trim() === '') return true;
  const value = Number(rawCost);
  return Number.isFinite(value) && value === 0;
}

function buildInternalStockLotCostCandidate_(lot, product, saleItemLots) {
  const lotId = String(lot && lot['Lot ID'] || '');
  const suggestedCost = product && Number(product['Purchase Price']) > 0
    ? Number(product['Purchase Price'])
    : 0;
  const matches = (saleItemLots || []).filter(function (row) {
    return String(row['Lot ID'] || '') === lotId;
  });
  const invoices = {};
  let matchedHistoricalQuantity = 0;
  let historicalCurrentCogs = 0;
  let historicalCogsDelta = 0;
  matches.forEach(function (row) {
    const qty = Number(row['Quantity']) || 0;
    const oldCost = Number(row['Unit Cost']) || 0;
    matchedHistoricalQuantity += qty;
    historicalCurrentCogs += qty * oldCost;
    historicalCogsDelta += qty * (suggestedCost - oldCost);
    const invoiceId = String(row['Invoice ID'] || '');
    if (invoiceId) invoices[invoiceId] = true;
  });
  const originalQuantity = Number(lot && lot['Original Quantity']) || 0;
  const remainingQuantity = Number(lot && lot['Remaining Quantity']) || 0;
  return {
    lotId: lotId,
    productId: String(lot && lot['Product ID'] || ''),
    productName: String(lot && lot['Product Name'] || (product && product['Product Name']) || ''),
    source: String(lot && lot['Purchase ID'] || ''),
    purchaseDate: safeDateOnly_(lot && lot['Purchase Date']),
    originalQuantity: originalQuantity,
    remainingQuantity: remainingQuantity,
    consumedQuantity: Math.max(0, originalQuantity - remainingQuantity),
    currentPurchasePrice: Number(lot && lot['Purchase Price']) || 0,
    productPurchasePrice: product ? (Number(product['Purchase Price']) || 0) : 0,
    suggestedPurchasePrice: suggestedCost,
    matchedHistoricalQuantity: matchedHistoricalQuantity,
    affectedInvoiceCount: Object.keys(invoices).length,
    historicalCurrentCogs: roundMoney_(historicalCurrentCogs),
    historicalCogsDelta: roundMoney_(historicalCogsDelta),
    status: suggestedCost > 0 ? 'Ready' : 'Needs Cost'
  };
}

/** Loads all data needed for a cost correction once, then indexes it. */
function loadInternalStockLotCostCorrectionContext_() {
  const products = getAllRows_('PRODUCTS');
  const lots = getAllRows_('STOCK_LOTS');
  const saleItemLots = getAllRows_('SALE_ITEM_LOTS');
  const productsById = {};
  const lotsById = {};
  const evidenceByLotId = {};

  products.forEach(function (p) {
    const productId = String(p['Product ID'] || '');
    if (productId) productsById[productId] = p;
  });
  lots.forEach(function (lot) {
    const lotId = String(lot['Lot ID'] || '');
    if (!lotId) return;
    if (!lotsById[lotId]) lotsById[lotId] = [];
    lotsById[lotId].push(lot);
  });
  saleItemLots.forEach(function (row) {
    const lotId = String(row['Lot ID'] || '');
    if (!lotId) return;
    if (!evidenceByLotId[lotId]) evidenceByLotId[lotId] = [];
    evidenceByLotId[lotId].push(row);
  });

  return {
    productsById: productsById,
    lotsById: lotsById,
    evidenceByLotId: evidenceByLotId
  };
}

/**
 * Validates an entire requested correction batch without writing anything.
 * Exact Lot ID is the only historical linkage accepted.
 */
function prepareInternalStockLotCostCorrections_(payload, context) {
  payload = payload || {};
  context = context || {};
  const reason = sanitizeInput_(payload.reason);
  if (!reason) throw new Error('Enter a reason for this stock lot cost correction.');

  const corrections = Array.isArray(payload.corrections) ? payload.corrections : [];
  if (!corrections.length) throw new Error('Select at least one stock lot to correct.');

  const seen = {};
  const prepared = corrections.map(function (correction, index) {
    correction = correction || {};
    const lotId = sanitizeInput_(correction.lotId);
    if (!lotId) throw new Error('Correction ' + (index + 1) + ': Lot ID is required.');
    if (seen[lotId]) throw new Error('Duplicate Lot ID in correction request: ' + lotId + '.');
    seen[lotId] = true;

    const lotRows = (context.lotsById && context.lotsById[lotId]) || [];
    if (!lotRows.length) throw new Error('Stock lot not found: ' + lotId + '.');
    if (lotRows.length !== 1) throw new Error('Stock lot ID is not unique: ' + lotId + '.');
    const lot = lotRows[0];
    if (String(lot['Status'] || '').trim().toLowerCase() === 'deleted') {
      throw new Error('Stock lot ' + lotId + ' has been deleted.');
    }
    if (!isInternalCostCorrectionSource_(lot['Purchase ID'])) {
      throw new Error('Only internal Opening/Adjustment/Legacy lots can be corrected here. Use Purchase Edit for purchase-origin lots.');
    }
    if (!isZeroStoredCost_(lot['Purchase Price'])) {
      throw new Error('Stock lot ' + lotId + ' already has a Purchase Price; this correction only repairs blank/zero-cost internal lots.');
    }

    const newPurchasePrice = Number(correction.newPurchasePrice);
    if (!isValidNonNegativeNumber_(correction.newPurchasePrice) || newPurchasePrice <= 0) {
      throw new Error('Correction ' + lotId + ': Purchase Price must be a valid number greater than zero.');
    }

    const productId = String(lot['Product ID'] || '');
    const product = context.productsById && context.productsById[productId];
    if (!product) throw new Error('Product not found for stock lot ' + lotId + '.');

    const sourceRows = (context.evidenceByLotId && context.evidenceByLotId[lotId]) || [];
    const matchedRows = [];
    const invoices = {};
    let matchedHistoricalQuantity = 0;
    let historicalCogsDelta = 0;
    sourceRows.forEach(function (row) {
      if (String(row['Lot ID'] || '') !== lotId) return;
      const qty = Number(row['Quantity']) || 0;
      const oldUnitCost = Number(row['Unit Cost']) || 0;
      matchedHistoricalQuantity += qty;
      historicalCogsDelta += qty * (newPurchasePrice - oldUnitCost);
      const invoiceId = String(row['Invoice ID'] || '');
      if (invoiceId) invoices[invoiceId] = true;
      matchedRows.push({
        rowIndex: row._rowIndex,
        invoiceId: invoiceId,
        quantity: qty,
        oldUnitCost: oldUnitCost
      });
    });

    return {
      lot: lot,
      lotRowIndex: lot._rowIndex,
      product: product,
      newPurchasePrice: newPurchasePrice,
      matchedRows: matchedRows,
      matchedHistoricalQuantity: matchedHistoricalQuantity,
      affectedInvoiceCount: Object.keys(invoices).length,
      historicalCogsDelta: roundMoney_(historicalCogsDelta)
    };
  });

  return prepared;
}

/** Applies a fully validated correction batch. No business validation lives here. */
function commitInternalStockLotCostCorrections_(user, reason, prepared) {
  const now = new Date();
  const items = (prepared || []).slice().sort(function (a, b) {
    return String(a.lot['Lot ID']).localeCompare(String(b.lot['Lot ID']));
  });
  const result = {
    correctedCount: 0,
    matchedHistoricalQuantity: 0,
    affectedInvoiceCount: 0,
    historicalCogsDelta: 0,
    lots: []
  };
  const affectedInvoices = {};

  items.forEach(function (item) {
    updateRowFields_('STOCK_LOTS', item.lotRowIndex, {
      'Purchase Price': item.newPurchasePrice
    });
    item.matchedRows.forEach(function (row) {
      updateRowFields_('SALE_ITEM_LOTS', row.rowIndex, {
        'Unit Cost': item.newPurchasePrice
      });
      if (row.invoiceId) affectedInvoices[row.invoiceId] = true;
    });
    appendRow_('STOCK_LOT_COST_CORRECTIONS', {
      'Correction ID': generateId_('STOCK_LOT_COST_CORRECTIONS'),
      'Date': now,
      'Lot ID': item.lot['Lot ID'],
      'Product ID': item.product['Product ID'],
      'Product Name': item.product['Product Name'],
      'Source': item.lot['Purchase ID'],
      'Old Purchase Price': Number(item.lot['Purchase Price']) || 0,
      'New Purchase Price': item.newPurchasePrice,
      'Original Quantity': Number(item.lot['Original Quantity']) || 0,
      'Remaining Quantity': Number(item.lot['Remaining Quantity']) || 0,
      'Matched Historical Quantity': item.matchedHistoricalQuantity,
      'Affected Invoice Count': item.affectedInvoiceCount,
      'Historical COGS Delta': item.historicalCogsDelta,
      'Reason': reason,
      'Corrected By': actorName_(user),
      'Created At': now
    });

    result.correctedCount++;
    result.matchedHistoricalQuantity += item.matchedHistoricalQuantity;
    result.historicalCogsDelta += item.historicalCogsDelta;
    result.lots.push({
      lotId: item.lot['Lot ID'],
      newPurchasePrice: item.newPurchasePrice,
      matchedHistoricalQuantity: item.matchedHistoricalQuantity,
      affectedInvoiceCount: item.affectedInvoiceCount,
      historicalCogsDelta: item.historicalCogsDelta
    });
  });

  result.affectedInvoiceCount = Object.keys(affectedInvoices).length;
  result.historicalCogsDelta = roundMoney_(result.historicalCogsDelta);
  return result;
}

/** Corrects one or more zero-cost internal stock lots after full batch validation. */
function correctInternalStockLotCosts(token, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    const user = requirePermission_(token, 'products', 'edit');
    const context = loadInternalStockLotCostCorrectionContext_();
    const prepared = prepareInternalStockLotCostCorrections_(payload, context);
    const reason = sanitizeInput_(payload && payload.reason);
    return ok_(commitInternalStockLotCostCorrections_(user, reason, prepared));
  } catch (err) {
    logError_('correctInternalStockLotCosts', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

/** Thin single-lot wrapper over the validated batch correction engine. */
function correctInternalStockLotCost(token, payload) {
  payload = payload || {};
  return correctInternalStockLotCosts(token, {
    corrections: [{
      lotId: payload.lotId,
      newPurchasePrice: payload.newPurchasePrice
    }],
    reason: payload.reason
  });
}

/**
 * Adds a brand-new lot for a positive manual stock adjustment, at the
 * product's current Purchase Price. supplierId/supplierName are optional —
 * pass them when the correction is known to belong to one already-linked
 * supplier (attributes the added stock so it's sellable through that
 * supplier in POS); omit for a genuinely unattributed correction (the
 * stock still counts toward Products.Current Stock, it just isn't scoped
 * to any supplier until adjusted again with one).
 */
function addAdjustmentLot_(productId, productName, qty, supplierId, supplierName) {
  const product = getAllRows_('PRODUCTS').filter(function (p) { return p['Product ID'] === productId; })[0];
  const price = product ? Number(product['Purchase Price']) || 0 : 0;
  const sellPrice = product ? Number(product['Selling Price']) || 0 : 0;
  return createLot_(productId, productName, 'ADJUSTMENT', new Date(), price, qty, supplierId, supplierName, sellPrice);
}

/** Lists zero/blank-cost internal lots with exact historical COGS impact previews. */
function getUnpricedInternalStockLots(token) {
  try {
    requirePermission_(token, 'products', 'view');
    const products = getAllRows_('PRODUCTS');
    const lots = getAllRows_('STOCK_LOTS');
    const saleItemLots = getAllRows_('SALE_ITEM_LOTS');

    const productsById = {};
    products.forEach(function (p) { productsById[p['Product ID']] = p; });

    const evidenceByLotId = {};
    saleItemLots.forEach(function (row) {
      const lotId = String(row['Lot ID'] || '');
      if (!lotId) return;
      if (!evidenceByLotId[lotId]) evidenceByLotId[lotId] = [];
      evidenceByLotId[lotId].push(row);
    });

    const candidates = lots.filter(function (lot) {
      return String(lot['Status'] || '').toLowerCase() !== 'deleted' &&
        isInternalCostCorrectionSource_(lot['Purchase ID']) &&
        isZeroStoredCost_(lot['Purchase Price']);
    }).map(function (lot) {
      return buildInternalStockLotCostCandidate_(
        lot,
        productsById[lot['Product ID']] || null,
        evidenceByLotId[String(lot['Lot ID'] || '')] || []
      );
    }).sort(function (a, b) {
      return String(a.lotId).localeCompare(String(b.lotId));
    });

    const summary = candidates.reduce(function (out, c) {
      out.candidateCount++;
      if (c.status === 'Ready') out.readyCount++;
      else out.needsCostCount++;
      out.remainingQuantity += Number(c.remainingQuantity) || 0;
      out.matchedHistoricalQuantity += Number(c.matchedHistoricalQuantity) || 0;
      out.projectedHistoricalCogsDelta += Number(c.historicalCogsDelta) || 0;
      return out;
    }, {
      candidateCount: 0,
      readyCount: 0,
      needsCostCount: 0,
      remainingQuantity: 0,
      matchedHistoricalQuantity: 0,
      projectedHistoricalCogsDelta: 0
    });
    summary.projectedHistoricalCogsDelta = roundMoney_(summary.projectedHistoricalCogsDelta);

    return ok_({ lots: candidates, summary: summary });
  } catch (err) {
    logError_('getUnpricedInternalStockLots', err);
    return fail_(err.message);
  }
}

/** Every lot for one product, oldest first — powers the Products page "Lots" drill-down. */
function getProductLots(token, productId) {
  try {
    requirePermission_(token, 'products', 'view');
    const id = sanitizeInput_(productId);
    if (!id) return fail_('Product ID is required.');
    const productRow = getAllRows_('PRODUCTS').filter(function (p) { return p['Product ID'] === id; })[0];
    const lots = getAllRows_('STOCK_LOTS')
      .filter(function (l) { return l['Product ID'] === id; })
      .sort(compareLotsFifo_);
    const evidenceByLotId = {};
    getAllRows_('SALE_ITEM_LOTS').forEach(function (row) {
      const lotId = String(row['Lot ID'] || '');
      if (!lotId) return;
      if (!evidenceByLotId[lotId]) evidenceByLotId[lotId] = [];
      evidenceByLotId[lotId].push(row);
    });

    // Explicit shape rather than the raw row: _rowIndex is an internal
    // bookkeeping field and has no business crossing to the browser.
    return ok_(lots.map(function (l) {
      const status = l['Status'] || 'Active';
      const eligible = String(status).toLowerCase() !== 'deleted' &&
        isInternalCostCorrectionSource_(l['Purchase ID']) &&
        isZeroStoredCost_(l['Purchase Price']);
      const candidate = eligible
        ? buildInternalStockLotCostCandidate_(l, productRow || null, evidenceByLotId[String(l['Lot ID'] || '')] || [])
        : null;
      return {
        lotId: l['Lot ID'],
        productId: l['Product ID'],
        productName: l['Product Name'],
        purchaseId: l['Purchase ID'],
        purchaseDate: safeDateOnly_(l['Purchase Date']),
        supplierId: l['Supplier ID'] || '',
        supplierName: l['Supplier Name'] || '',
        purchasePrice: Number(l['Purchase Price']) || 0,
        sellPrice: lotSellPrice_(l, productRow),
        originalQuantity: Number(l['Original Quantity']) || 0,
        remainingQuantity: Number(l['Remaining Quantity']) || 0,
        status: status,
        createdAt: l['Created At'],
        costCorrectionEligible: eligible,
        productPurchasePrice: productRow ? (Number(productRow['Purchase Price']) || 0) : 0,
        suggestedPurchasePrice: candidate ? candidate.suggestedPurchasePrice : 0,
        matchedHistoricalQuantity: candidate ? candidate.matchedHistoricalQuantity : 0,
        affectedInvoiceCount: candidate ? candidate.affectedInvoiceCount : 0,
        historicalCurrentCogs: candidate ? candidate.historicalCurrentCogs : 0,
        historicalCogsDelta: candidate ? candidate.historicalCogsDelta : 0
      };
    }));
  } catch (err) {
    logError_('getProductLots', err);
    return fail_(err.message);
  }
}

/**
 * One-time (safe to re-run) migration: gives every product that has no
 * lot on file yet a single "Opening Lot" matching its current Current
 * Stock / Purchase Price, so FIFO has clean data to draw from instead of
 * relying on consumeStockFIFO_'s ad-hoc LEGACY fallback later. Products
 * that already have at least one lot are left untouched.
 */

/**
 * Idempotent additive migration for installs that already have Stock Lots.
 * Only blank Sell Price cells are filled; any explicitly-entered lot price,
 * including zero, is preserved exactly.
 */
function migrateStockLotSellPrices_() {
  const productsById = {};
  getAllRows_('PRODUCTS').forEach(function (p) { productsById[p['Product ID']] = p; });
  let updated = 0;
  getAllRows_('STOCK_LOTS').forEach(function (lot) {
    const raw = lot['Sell Price'];
    if (raw !== '' && raw !== null && raw !== undefined && String(raw).trim() !== '') return;
    const product = productsById[lot['Product ID']];
    const sellPrice = product && isValidNonNegativeNumber_(product['Selling Price']) ? Number(product['Selling Price']) : 0;
    updateRowFields_('STOCK_LOTS', lot._rowIndex, { 'Sell Price': sellPrice });
    updated++;
  });
  return { updated: updated };
}

/**
 * Rebuilds Products.Current Stock from the lot ledger.
 * Only products that already have at least one lot are changed, so products
 * without migrated lot history are left untouched.
 */
function reconcileProductStocksFromLots_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    const lots = getAllRows_('STOCK_LOTS');
    const totals = {};
    lots.forEach(function (l) {
      totals[l['Product ID']] = (totals[l['Product ID']] || 0) + (Number(l['Remaining Quantity']) || 0);
    });

    const products = getAllRows_('PRODUCTS');
    let updated = 0;
    products.forEach(function (p) {
      if (totals[p['Product ID']] === undefined) return;
      const value = totals[p['Product ID']];
      if ((Number(p['Current Stock']) || 0) !== value) {
        updateRowFields_('PRODUCTS', p._rowIndex, {
          'Current Stock': value,
          'Updated At': new Date()
        });
        updated++;
      }
    });
    SpreadsheetApp.flush();
    return ok_({ updated: updated });
  } catch (err) {
    logError_('reconcileProductStocksFromLots', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

function migrateOpeningStockLots_() {
  const ui = SpreadsheetApp.getUi();
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    const products = getAllRows_('PRODUCTS');
    const existingLotProductIds = {};
    getAllRows_('STOCK_LOTS').forEach(function (l) { existingLotProductIds[l['Product ID']] = true; });

    let created = 0;
    let unresolved = 0;
    products.forEach(function (p) {
      if (existingLotProductIds[p['Product ID']]) return;
      const stock = Number(p['Current Stock']) || 0;
      if (stock <= 0) return;
      const purchasePrice = Number(p['Purchase Price']) || 0;
      if (purchasePrice <= 0) {
        unresolved++;
        return;
      }
      createLot_(p['Product ID'], p['Product Name'], 'OPENING-MIGRATION', p['Created At'] || new Date(), purchasePrice, stock, '', '', p['Selling Price']);
      created++;
    });

    SpreadsheetApp.flush();
    ui.alert(
      'Stock Lots migration complete',
      'Created: ' + created + ' opening lot(s).\n' +
        'Unresolved: ' + unresolved + ' product(s) have positive stock but no Purchase Price.\n' +
        'Products with existing lots or zero stock were left untouched.',
      ui.ButtonSet.OK
    );
    return ok_({ created: created, unresolved: unresolved });
  } catch (err) {
    logError_('migrateOpeningStockLots', err);
    ui.alert('Something went wrong: ' + err.message);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}