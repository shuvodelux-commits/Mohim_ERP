/** Google Apps Script V8-compatible, exact safe-integer half-up cents.
 * Decompose whole and fractional units to avoid an overflowing raw product.
 * Unsupported inputs/ranges fail closed; never approximate a financial cost. */
function purchaseSettlementScaledPaisa_(ticks,cents,scale) {
  if (!Number.isSafeInteger(ticks)||ticks<0 ||
      !Number.isSafeInteger(cents)||cents<0 ||
      !Number.isSafeInteger(scale)||scale<=0||scale>1000000) return null;
  const whole=Math.floor(ticks/scale),rem=ticks%scale;
  const wholeCents=whole*cents,frac=rem*cents;
  const biased=frac+Math.floor(scale/2);
  if (!Number.isSafeInteger(wholeCents)||
      !Number.isSafeInteger(frac)||!Number.isSafeInteger(biased)) return null;
  const rounded=wholeCents+Math.floor(biased/scale);
  return Number.isSafeInteger(rounded)?rounded:null;
}

/**
 * Mohim_ERP GAS · Stage 5C1: whole-purchase, read-only settlement preflight.
 *
 * NOT a posting engine: no sheet reads/writes, no LockService, no cash/bank
 * or supplier/COGS mutations. This is the source-native handoff to the
 * future journalled purchase writer. Never treat postable:false as a
 * permission to execute a purchase or historical adjustment.
 */

function freezePurchaseSettlementValue_(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.keys(value).forEach(function (k) { freezePurchaseSettlementValue_(value[k]); });
    Object.freeze(value);
  }
  return value;
}

function prepareOversoldPurchaseBatch_(input) {
  function invalid(issue) {
    return freezePurchaseSettlementValue_({
      status:'NEEDS_REVIEW', postable:false, issues:[String(issue)],
      lines:[], allocations:[], totalFavorableVarianceMinor:0
    });
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid('INVALID_REQUEST');
  const source = input;
  const operationId = String(source.operationId || '').trim();
  const purchaseId = String(source.purchaseId || '').trim();
  const businessDate = safeDateOnly_(source.date);
  const actor = String(source.actor || '').trim();
  const supplierId = String(source.supplierId || '').trim();
  if (!/^[A-Za-z0-9_-]{12,100}$/.test(operationId) ||
      !/^PUR-[A-Za-z0-9_-]{3,128}$/.test(purchaseId) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(businessDate) ||
      !actor || !supplierId) return invalid('INVALID_PURCHASE_INTENT');
  for (const field of ['lines','products','stockLots','sales','saleItemLots','operationJournal','settlementHistory']) {
    if (!Array.isArray(source[field])) return invalid('MISSING_SOURCE_' + field.toUpperCase());
  }
  if (!source.lines.length) return invalid('EMPTY_PURCHASE');

  // An interrupted prior multi-Sheet purchase cannot be repaired by a fresh
  // operation ID. A committed same-ID purchase cannot be replayed by this
  // preflight: replay must verify the full-cart immutable fingerprint and
  // the entire original receipt in the future journalled writer.
  const journalRecords = source.operationJournal.map(function (r) {
    return {
      operationId:String(r['Operation ID'] || r.operationId || ''),
      purchaseId:String(r['Purchase ID'] || r.purchaseId || ''),
      productId:String(r['Product ID'] || r.productId || ''),
      state:String(r['State'] || r.state || '').toUpperCase(),
      intentFingerprint:String(r['Intent Fingerprint'] || r.intentFingerprint || ''),
      receiptRef:String(r['Result Receipt'] || r.receiptRef || '')
    };
  });
  if (journalRecords.some(function (j) {return j.operationId === operationId;}))
    return invalid('OPERATION_CONFLICT_NEEDS_WHOLE_CART_RECEIPT');
  if (journalRecords.some(function (j) {return j.purchaseId === purchaseId;}))
    return invalid('DUPLICATE_PURCHASE_ID');

  // Settlement IDs are globally unique, not unique only per product.
  // Duplicate identifiers across two products make event-based profit
  // attribution and future exact reversal unsafe.
  const eventIds = {};
  for (const event of source.settlementHistory) {
    const id = String(event && (event['Settlement ID'] || event.settlementId) || '');
    if (!id || eventIds[id]) return invalid('DUPLICATE_SETTLEMENT_IDENTITY');
    eventIds[id] = true;
  }

  const ids = {};
  const productsById = {};
  source.products.forEach(function (p) {
    const id = String(p && p['Product ID'] || '');
    if (id) {
      if (!productsById[id]) productsById[id] = [];
      productsById[id].push(p);
    }
  });
  const touched = source.lines.map(function (line) {
    return String(line && line.productId || '');
  });
  if (journalRecords.some(function (j) {
    return j.state !== 'COMMITTED' && (j.productId === '*' || !j.productId ||
      touched.indexOf(j.productId) !== -1);
  })) return invalid('UNRESOLVED_WRITE');

  // Require non-ambiguous source sale / lot data for ALL affected products.
  // Only prevalidated, authorized source snapshots may be passed here.
  const rows = [], allocations = [];
  let totalVariance = 0;
  for (const inputLine of source.lines) {
    const line = inputLine || {};
    const id = String(line.productId || '');
    if (!id || ids[id]) return invalid('DUPLICATE_PRODUCT_OR_MISSING_ID');
    ids[id] = true;
    const productMatches = productsById[id] || [];
    if (productMatches.length !== 1) return invalid('MISSING_PRODUCT_OR_DUPLICATE_PRODUCT');
    const product = productMatches[0];
    if (product['Is Deleted'] === true || String(product['Is Deleted']).toUpperCase() === 'TRUE')
      return invalid('DELETED_PRODUCT');

    const productHistory = source.settlementHistory.filter(function (record) {
      return String(record['Product ID'] || record.productId || '') === id;
    });
    if (productHistory.some(function (event) {
      const scale = Number(event['Quantity Scale'] !== undefined ?
        event['Quantity Scale'] : event.quantityScale);
      return !Number.isSafeInteger(scale) || scale !== Number(line.quantityScale);
    })) return invalid('QUANTITY_SCALE_MISMATCH');

    const history = productHistory.map(function (record) {
      return {
        settlementId:String(record['Settlement ID'] || record.settlementId || ''),
        productId:id,
        oversoldLotId:String(record['Oversold Lot ID'] || record.oversoldLotId || ''),
        sourceInvoiceId:String(record['Source Invoice ID'] || record.sourceInvoiceId || ''),
        sourceSaleProductId:String(record['Source Sale Product ID'] || record.sourceSaleProductId || ''),
        purchaseLotId:String(record['Purchase Lot ID'] || record.purchaseLotId || ''),
        operationId:String(record['Operation ID'] || record.operationId || ''),
        settledQtyTicks:Number(record['Quantity Ticks'] !== undefined ? record['Quantity Ticks'] : record.settledQtyTicks),
        actualUnitCostMinor:Number(record['Actual Unit Cost Minor'] !== undefined ? record['Actual Unit Cost Minor'] : record.actualUnitCostMinor),
        state:String(record['State'] || record.state || '').toUpperCase()
      };
    });
    const plan = planOversoldPurchaseSettlement_({
      productId:id, product:product,
      purchase:{
        operationId:operationId,purchaseId:purchaseId,date:businessDate,
        quantity:line.quantity,quantityScale:line.quantityScale,unitCost:line.unitCost
      },
      stockLots:source.stockLots,sales:source.sales,saleItemLots:source.saleItemLots,
      operationJournal:[],settlementHistory:history
    });
    if (plan.status !== 'READY' && plan.status !== 'NO_DEBT') {
      return invalid(plan.issues.map(function (e) {return e.code || 'UNSAFE_SETTLEMENT';}).join(','));
    }
    rows.push({
      productId:id,quantityScale:Number(line.quantityScale),
      quantityTicks:plan.purchaseQtyTicks,
      settledTicks:plan.settledQtyTicks,
      newLotAvailableTicks:plan.newLotRemainingQtyTicks,
      productStockBeforeTicks:plan.currentStockBeforeTicks,
      productStockAfterTicks:plan.currentStockAfterTicks
    });
    plan.allocations.forEach(function (a) {
      allocations.push(Object.assign({purchaseProductId:id,quantityScale:Number(line.quantityScale)}, a));
    });
    if (!Number.isSafeInteger(totalVariance + plan.favorableVarianceMinor))
      return invalid('UNSAFE_VARIANCE_ARITHMETIC');
    totalVariance += plan.favorableVarianceMinor;
  }
  return freezePurchaseSettlementValue_({
    status:'READY',postable:false,issues:[],operationId:operationId,purchaseId:purchaseId,
    businessDate:businessDate,actor:actor,supplierId:supplierId,
    lines:rows,allocations:allocations,totalFavorableVarianceMinor:totalVariance
  });
}

/**
 * Pure mutation *proposal* only. The eventual journalled writer must verify
 * all source row identity/quantities again under ScriptLock, must NOT execute
 * this proposal directly, and must not increment Products.Current Stock for
 * a settlement: the native purchase entry already increases it by +Q.
 */
function buildOversoldPurchaseOffsetSet_(batch, purchaseLotIdByProduct, oldLots) {
  function review(reason) {
    return freezePurchaseSettlementValue_({status:'NEEDS_REVIEW',postable:false,issues:[reason],
      newPurchaseLots:[],oldDebtUpdates:[],settlementEvents:[],
      projectedProductStockChanges:[],extraProductStockDeltaTicks:0});
  }
  if (!batch || batch.status !== 'READY' || batch.postable !== false ||
      !purchaseLotIdByProduct || !Array.isArray(oldLots)) return review('INVALID_BATCH');
  const mapped = {}, usedLotIds = {}, existing = {}, oldDebtUpdates = [], events = [], newLots = [];
  oldLots.forEach(function (lot) {
    const id = String(lot && lot['Lot ID'] || '');
    if (id) {
      if (!existing[id]) existing[id]=[];
      existing[id].push(lot);
    }
  });
  for (const line of batch.lines) {
    const id = String(purchaseLotIdByProduct[line.productId] || '');
    if (!id || usedLotIds[id] || existing[id]) return review('INVALID_NEW_PURCHASE_LOT_ID');
    usedLotIds[id]=true; mapped[line.productId]=id;
    if (!Number.isSafeInteger(line.quantityTicks) ||
        !Number.isSafeInteger(line.settledTicks) ||
        line.quantityTicks < line.settledTicks ||
        line.newLotAvailableTicks !== line.quantityTicks - line.settledTicks) {
      return review('PURCHASE_QUANTITY_CONSERVATION_FAILED');
    }
    newLots.push({
      productId:line.productId,lotId:id,
      originalQtyTicks:line.quantityTicks,availableQtyTicks:line.newLotAvailableTicks,
      quantityScale:line.quantityScale,statusAfter:line.newLotAvailableTicks ? 'Active':'Consumed'
    });
  }
  const perDebt = {};
  for (const a of batch.allocations) {
    const source = existing[a.oversoldLotId] || [];
    if (source.length !== 1 || perDebt[a.oversoldLotId] || source[0]['Product ID']!==a.purchaseProductId ||
      source[0]['Purchase ID']!=='OVERSOLD') return review('AMBIGUOUS_OR_DUPLICATE_OLD_DEBT');
    perDebt[a.oversoldLotId]=true;
    const before = Number(source[0]['Remaining Quantity']) * a.quantityScale;
    const after = before + a.settledQtyTicks;
    if (!Number.isSafeInteger(before) || !Number.isSafeInteger(after) ||
        after !== -a.remainingDebtAfterTicks || after>0) return review('OLD_DEBT_CONSERVATION_FAILED');
    oldDebtUpdates.push({
      lotId:a.oversoldLotId,productId:a.purchaseProductId,
      beforeTicks:before,afterTicks:after,quantityScale:a.quantityScale,
      statusAfter:after===0?'Consumed':'Oversold'
    });
    events.push({
      sourceInvoiceId:a.sourceInvoiceId,
      sourceSaleProductId:a.sourceSaleProductId,
      oversoldLotId:a.oversoldLotId,
      newPurchaseLotId:mapped[a.purchaseProductId],
      productId:a.purchaseProductId,purchaseId:batch.purchaseId,
      operationId:batch.operationId,
      settledQtyTicks:a.settledQtyTicks,quantityScale:a.quantityScale,
      provisionalUnitCostMinor:a.provisionalUnitCostMinor,
      actualUnitCostMinor:a.actualUnitCostMinor,
      provisionalCOGSMinor:a.provisionalCOGSMinor,
      actualCOGSMinor:a.actualCOGSMinor,
      favorableVarianceMinor:a.favorableVarianceMinor
    });
  }
  return freezePurchaseSettlementValue_({
    status:'READY',postable:false,issues:[],newPurchaseLots:newLots,
    oldDebtUpdates:oldDebtUpdates,settlementEvents:events,
    projectedProductStockChanges:batch.lines.map(function (line) {
      return {productId:line.productId,deltaTicks:line.quantityTicks,
        beforeTicks:line.productStockBeforeTicks,afterTicks:line.productStockAfterTicks};
    }),
    extraProductStockDeltaTicks:0
  });
}

/**
 * SHA-256 idempotency identity for the *complete* signed purchase intent.
 * The future purchase writer must derive its arguments AFTER server-side
 * authorization and canonical unit/payment validation; never trust a hash
 * calculated by the browser. Purchase ID is assigned later and stored on
 * its journal receipt; operation ID is the stable retry identity.
 */
function buildPurchaseSettlementIntentHash_(request) {
  if (!request || !Array.isArray(request.lines) || !request.lines.length ||
      !request.payment) throw new Error('Invalid complete purchase intent.');
  const operationId = String(request.operationId || '');
  const actor = String(request.actor || '');
  const supplierId = String(request.supplierId || '');
  const date = safeDateOnly_(request.date);
  if (!/^[A-Za-z0-9_-]{12,100}$/.test(operationId) || !actor || !supplierId ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid purchase actor, date or operation ID.');
  function minor(value, field) {
    const n = Number(value);
    if (value === null || value === undefined || value === '' ||
        !Number.isFinite(n) || n < 0 || !Number.isSafeInteger(Math.round(n*100)) ||
        Math.abs(n*100-Math.round(n*100)) > 0.0000001)
      throw new Error('Invalid money precision in ' + field + '.');
    return Math.round(n*100);
  }
  function qtyTicks(line) {
    const quantity = Number(line.quantity), scale = Number(line.quantityScale);
    const raw = quantity * scale;
    if (!Number.isSafeInteger(scale) || scale <= 0 || scale > 1000000 ||
        !Number.isFinite(quantity) || quantity <= 0 || !Number.isSafeInteger(Math.round(raw)) ||
        Math.abs(raw-Math.round(raw)) > 0.0000001)
      throw new Error('Invalid quantity precision or canonical unit scale.');
    return Math.round(raw);
  }
  const ids = {};
  const lines = request.lines.map(function (line) {
    const productId = String(line.productId || '');
    if (!productId || ids[productId]) throw new Error('Missing or duplicate product in purchase intent.');
    ids[productId]=true;
    return {
      productId:productId,scale:Number(line.quantityScale),qtyTicks:qtyTicks(line),
      unitCostMinor:minor(line.unitCost,'purchase price'),
      sellingPriceMinor:minor(line.sellingPrice,'selling price')
    };
  }).sort(function (a,b) {return a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0;});
  const payment = request.payment;
  const purchaseDiscountMinor = minor(payment.discount === undefined?0:payment.discount,'discount');
  const paidMinor = minor(payment.paidAmount === undefined?0:payment.paidAmount,'paid amount');
  const subtotalMinor = lines.reduce(function (total,line) {
    const rounded = purchaseSettlementScaledPaisa_(line.qtyTicks,line.unitCostMinor,line.scale);
    if (rounded===null || !Number.isSafeInteger(total+rounded))
      throw new Error('Purchase line money overflow.');
    return total+rounded;
  },0);
  if (purchaseDiscountMinor>subtotalMinor || paidMinor>subtotalMinor-purchaseDiscountMinor)
    throw new Error('Purchase discount or payment exceeds verified subtotal.');
  const canon = JSON.stringify({
    version:1,operationId:operationId,actor:actor,supplierId:supplierId,date:date,
    backdatedReason:String(request.backdatedReason||''),
    lines:lines,
    discountMinor:purchaseDiscountMinor,paidMinor:paidMinor,
    paymentMethod:String(payment.paymentMethod||''),bankAccountId:String(payment.bankAccountId||''),
    notes:String(payment.notes||'')
  });
  // GAS Utilities is the only hash provider used in production. The test
  // adapter supplies the same SHA-256 digest; no Node dependency ships.
  const digest=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,canon);
  return 'sha256:'+Array.prototype.map.call(digest,function(b){
    return ('0'+(b&255).toString(16)).slice(-2);
  }).join('');
}
