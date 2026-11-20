/** Google Apps Script V8-compatible, exact safe-integer half-up cents.
 * Decompose whole and fractional units to avoid an overflowing raw product.
 * Unsupported inputs/ranges fail closed; never approximate a financial cost. */
function returnScaledPaisa_(ticks,cents,scale) {
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
 * Mohim_ERP GAS Task 5C3B1 — source-linked, READ-ONLY funded OVERSOLD
 * Sales Return reversal planner. It NEVER executes a return/refund.
 *
 * A returned unit from a still-unfunded negative OVERSOLD sale first
 * reduces that exact negative debt toward zero. Any remaining return
 * quantity reverses committed purchase funding LIFO, restoring precisely
 * the real purchased lot that funded the original sale. The original
 * settlement event remains immutable; eventual writer must APPEND a
 * unique funded reversal event, then readback-verify sale return, net stock,
 * purchase lot, original sale cost and Cash/Customer ledger once.
 *
 * This pure function is deliberately NOT called by completeReturn yet:
 * enabling it without a durable cross-sheet journal and corresponding
 * cost-report reversal would produce incorrect business figures.
 */
function planFundedOversoldSaleReturn_(input) {
  function deepFreeze(v) {
    if (v && typeof v === 'object' && !Object.isFrozen(v)) {
      Object.keys(v).forEach(function(k){deepFreeze(v[k]);});
      Object.freeze(v);
    }
    return v;
  }
  function result(status,reason,extra) {
    return deepFreeze(Object.assign({
      status:status,postable:false,issues:reason?[reason]:[],
      debtUpdates:[],purchaseLotUpdates:[],reversalEvents:[],
      saleItemQtyAfterTicks:null,productStockAfterTicks:null,
      stockQtyDeltaTicks:0,newLotsRestoredTicks:0,
      negativeDebtRestoredTicks:0,extraProductStockDeltaTicks:0
    },extra||{}));
  }
  const review=function(reason){return result('NEEDS_REVIEW',reason);};
  if (!input || typeof input!=='object' || Array.isArray(input) ||
      ['products','saleItemLots','stockLots','settlements','purchaseJournals',
       'purchases','reversals','returnJournals','returnReceipts'].some(function(k){
        return !Array.isArray(input[k]);
       })) return review('INCOMPLETE_RETURN_SOURCE_SNAPSHOT');
  const invoice=String(input.invoiceId||'');
  const productId=String(input.productId||'');
  const sourceId=String(input.sourceSaleProductId||'');
  const operationId=String(input.operationId||'');
  const returnId=String(input.returnId||'');
  const scale=Number(input.quantityScale);
  if (!invoice||!productId||!sourceId||
      !/^[A-Za-z0-9_-]{12,100}$/.test(operationId) ||
      !/^[A-Za-z0-9_-]{5,128}$/.test(returnId) ||
      !Number.isSafeInteger(scale)||scale<=0||scale>1000000)
    return review('INVALID_RETURN_OPERATION_OR_UNIT_SCALE');
  function ticks(raw) {
    if (raw===null||raw===undefined||raw===''||!Number.isFinite(Number(raw)))
      return null;
    const n=Number(raw)*scale;
    return Number.isSafeInteger(Math.round(n))&&
      Math.abs(n-Math.round(n))<=0.0000001?Math.round(n):null;
  }
  function minor(raw) {
    if (raw===null||raw===undefined||raw===''||!Number.isFinite(Number(raw))||
        Number(raw)<0) return null;
    const n=Number(raw)*100;
    return Number.isSafeInteger(Math.round(n))&&
      Math.abs(n-Math.round(n))<=0.0000001?Math.round(n):null;
  }
  function exactlyOne(rows,key,id) {
    const arr=rows.filter(function(row){return String(row[key]||'')===id;});
    return arr.length===1?arr[0]:null;
  }
  const returnTicks=ticks(input.returnQty);
  if (returnTicks===null || returnTicks<=0)
    return review('INVALID_RETURN_QUANTITY_PRECISION');
  // A previous return with this operation ID may have committed despite an
  // unavailable response. This planner has no receipt-replay authority.
  if (input.returnReceipts.some(function(r){
    return String(r['Return ID']||'')===returnId;
  }) || input.reversals.some(function(r){
    return String(r['Return Operation ID']||'')===operationId ||
      String(r['Return ID']||'')===returnId;
  })) return review('DUPLICATE_RETURN_RECEIPT_OR_OPERATION');
  if (input.returnJournals.some(function(j){
    return String(j['Operation ID']||'')===operationId ||
      String(j['Return ID']||'')===returnId;
  })) return review('RETURN_OPERATION_ID_CONFLICT');
  if (input.returnJournals.some(function(j){
    const state=String(j.State||'');
    return state!=='Committed' && (j['Invoice ID']===invoice ||
      j['Product ID']===productId || !j['Invoice ID']);
  })) return review('PENDING_RETURN_JOURNAL_NEEDS_REVIEW');
  if (input.purchaseJournals.some(function(j){return j.State!=='Committed';}))
    return review('PENDING_PURCHASE_JOURNAL_NEEDS_REVIEW');

  const product=exactlyOne(input.products,'Product ID',productId);
  if (!product) return review('MISSING_OR_DUPLICATE_PRODUCT');
  const currentStock=ticks(product['Current Stock']);
  if (currentStock===null) return review('INVALID_CURRENT_STOCK');

  const lotById={};
  let totalStock=0;
  for (const lot of input.stockLots) {
    if (!lot || lot['Product ID']!==productId) continue;
    const id=String(lot['Lot ID']||''),qty=ticks(lot['Remaining Quantity']);
    if (!id||lotById[id]) return review('DUPLICATE_OR_MISSING_LOT_ID');
    if (qty===null||!Number.isSafeInteger(totalStock+qty))
      return review('INVALID_LOT_QUANTITY');
    totalStock+=qty;
    lotById[id]=lot;
  }
  if (totalStock!==currentStock) return review('STOCK_CACHE_MISMATCH');
  // Lot ID is a global source reference in SALE_ITEM_LOTS and settlements.
  // Another product with the same ID makes the funding provenance ambiguous,
  // even if the selected product's own stock cache currently reconciles.
  const globalLotCount={};
  input.stockLots.forEach(function(lot){
    const id=String(lot && lot['Lot ID'] || '');
    if (id && lotById[id]) globalLotCount[id]=(globalLotCount[id]||0)+1;
  });
  if (Object.keys(globalLotCount).some(function(id){return globalLotCount[id]!==1;}))
    return review('DUPLICATE_GLOBAL_STOCK_LOT_ID');

  const sourceMatches=input.saleItemLots.filter(function(row) {
    return String(row['Invoice ID']||'')===invoice &&
      String(row['Product ID']||'')===productId &&
      String(row['Source Sale Product ID']||row['Product ID']||'')===sourceId &&
      lotById[String(row['Lot ID']||'')] &&
      lotById[String(row['Lot ID']||'')]['Purchase ID']==='OVERSOLD';
  });
  if (sourceMatches.length!==1)
    return review('MISSING_OR_DUPLICATE_OVERSOLD_SOURCE_SALE_LINK');
  const link=sourceMatches[0],sourceLotId=String(link['Lot ID']||'');
  const debtLot=lotById[sourceLotId];
  if (!Number.isSafeInteger(link._rowIndex)||link._rowIndex<2)
    return review('MISSING_SOURCE_SALE_ROW_IDENTITY');
  const soldTicks=ticks(link.Quantity),oldDebtTicks=ticks(debtLot['Remaining Quantity']);
  const provisionalMinor=minor(link['Unit Cost']);
  if (soldTicks===null||soldTicks<0||
      oldDebtTicks===null||oldDebtTicks>0||
      provisionalMinor===null||minor(debtLot['Purchase Price'])!==provisionalMinor||
      String(debtLot.Status)!==(oldDebtTicks===0?'Consumed':'Oversold'))
    return review('INVALID_OR_UNPRICED_OVERSOLD_SOURCE');
  if (returnTicks>soldTicks)
    return review('RETURN_QUANTITY_EXCEEDS_NET_SOLD');

  const globalIds={}, events=[],fundedByEvent={},fundedByOldLot={};
  const journalMap={};
  for (const j of input.purchaseJournals) {
    const id=String(j['Operation ID']||'');
    if (!id||journalMap[id]) return review('DUPLICATE_OR_INVALID_PURCHASE_JOURNAL');
    journalMap[id]=j;
  }
  for (let i=0;i<input.settlements.length;i++) {
    const e=input.settlements[i];
    const eid=String(e['Settlement ID']||'');
    if (!eid||globalIds[eid]) return review('DUPLICATE_SETTLEMENT_ID');
    globalIds[eid]=true;
    if (e.State!=='Committed') return review('UNCOMMITTED_SETTLEMENT_EVENT');
    if (e['Product ID']!==productId || String(e['Oversold Lot ID'])!==sourceLotId)
      continue;
    if (String(e['Source Invoice ID'])!==invoice ||
        String(e['Source Sale Product ID'])!==sourceId)
      return review('SOURCE_INVOICE_OR_PRODUCT_MISMATCH');
    const purchaseId=String(e['Purchase ID']||'');
    const purchase=exactlyOne(input.purchases,'Purchase ID',purchaseId);
    const journal=journalMap[String(e['Operation ID']||'')];
    if (!purchase||!journal||journal.State!=='Committed'||
        journal['Last Completed Stage']!=='Committed'||
        String(journal['Purchase ID'])!==purchaseId||
        String(journal['Result Receipt'])!==purchaseId)
      return review('MISSING_OR_INCOMPLETE_PURCHASE_JOURNAL');
    if (minor(purchase.Discount)===null||
        minor(purchase.Discount)!==0)
      return review('PURCHASE_DISCOUNT_COST_POLICY_REQUIRED');
    const newLotId=String(e['Purchase Lot ID']||''),lot=lotById[newLotId];
    const actual=Number(e['Actual Unit Cost Minor']);
    const eventProvisional=Number(e['Provisional Unit Cost Minor']);
    const eventQty=Number(e['Quantity Ticks']);
    if (!lot||String(lot['Purchase ID'])!==purchaseId||
        String(lot['Product ID'])!==productId||
        !Number.isSafeInteger(actual)||actual<0||
        !Number.isSafeInteger(eventProvisional)||eventProvisional!==provisionalMinor||
        minor(lot['Purchase Price'])!==actual||
        !Number.isSafeInteger(eventQty)||eventQty<=0||
        Number(e['Quantity Scale'])!==scale)
      return review('SOURCE_LOT_OR_UNIT_COST_MISMATCH');
    const cost=function(costMinor){
      return returnScaledPaisa_(eventQty,costMinor,scale);
    };
    const provisionalCogs=cost(eventProvisional),actualCogs=cost(actual);
    if (!Number.isSafeInteger(provisionalCogs)||!Number.isSafeInteger(actualCogs)||
        Number(e['Provisional COGS Minor'])!==provisionalCogs||
        Number(e['Actual COGS Minor'])!==actualCogs||
        Number(e['Favorable Variance Minor'])!==provisionalCogs-actualCogs)
      return review('EVENT_COGS_VARIANCE_MISMATCH');
    const newRemaining=ticks(lot['Remaining Quantity']),newOriginal=ticks(lot['Original Quantity']);
    if (newRemaining===null||newRemaining<0||newOriginal===null||
        newOriginal<eventQty||newRemaining>newOriginal ||
        String(lot.Status)!==(newRemaining===0?'Consumed':'Active'))
      return review('INVALID_SOURCE_PURCHASE_LOT');
    events.push({event:e,eventId:eid,index:i,newLotId:newLotId,newLot:lot,
      eventQty:eventQty,actualUnitCostMinor:actual});
    fundedByEvent[eid]={eventQty:eventQty,reversed:0};
    fundedByOldLot[sourceLotId]=(fundedByOldLot[sourceLotId]||0)+eventQty;
  }
  if (events.length===0) return review('MISSING_COMMITTED_FUNDED_SETTLEMENT');

  const reversalIds={};
  for (const r of input.reversals) {
    const reversalId=String(r['Reversal ID']||'');
    if (!reversalId||reversalIds[reversalId])
      return review('DUPLICATE_REVERSAL_IDENTITY');
    reversalIds[reversalId]=true;
    if (r.State!=='Committed') return review('PENDING_OR_UNCOMMITTED_REVERSAL');
    const eventId=String(r['Settlement ID']||'');
    if (!fundedByEvent[eventId]) continue;
    const returnReceipt=exactlyOne(input.returnReceipts,'Return ID',String(r['Return ID']||''));
    const originalEvent=events.filter(function(e){return e.eventId===eventId;})[0];
    const amount=Number(r['Quantity Ticks']);
    if (!r['Return Operation ID']||!returnReceipt ||
        String(returnReceipt['Invoice ID'])!==invoice ||
        String(r['Source Invoice ID'])!==invoice ||
        String(r['Source Sale Product ID'])!==sourceId ||
        !Number.isSafeInteger(amount)||amount<=0||
        Number(r['Quantity Scale'])!==scale ||
        !originalEvent)
      return review('REVERSAL_SOURCE_OR_RECEIPT_MISMATCH');
    const allocation=fundedByEvent[eventId];
    allocation.reversed+=amount;
    if (!Number.isSafeInteger(allocation.reversed)||
        allocation.reversed>allocation.eventQty)
      return review('REVERSAL_QUANTITY_EXCEEDS_ORIGINAL_SETTLEMENT');
  }
  const fundedTicks=events.reduce(function(sum,e) {
    return sum+(e.eventQty-fundedByEvent[e.eventId].reversed);
  },0);
  if (!Number.isSafeInteger(fundedTicks)||
      fundedTicks+(-oldDebtTicks)!==soldTicks)
    return review('SALE_QUANTITY_DEBT_AND_FUNDING_MISMATCH');

  let need=returnTicks;
  const unfundedRestored=Math.min(-oldDebtTicks,need);
  need-=unfundedRestored;
  const debtUpdates=unfundedRestored?[{
    lotId:sourceLotId,sourceInvoiceId:invoice,
    rowIndex:debtLot._rowIndex,
    beforeTicks:oldDebtTicks,afterTicks:oldDebtTicks+unfundedRestored,
    quantityScale:scale,
    statusAfter:oldDebtTicks+unfundedRestored===0?'Consumed':'Oversold'
  }]:[];
  const restorationByLot={},reversalEvents=[];
  let totalCogsReversalMinor=0;
  events.slice().sort(function(a,b){return b.index-a.index;}).forEach(function(e){
    if (need===0) return;
    const available=e.eventQty-fundedByEvent[e.eventId].reversed;
    const give=Math.min(available,need);
    if (give<=0) return;
    need-=give;
    if (!restorationByLot[e.newLotId])
      restorationByLot[e.newLotId]={lot:e.newLot,qty:0};
    restorationByLot[e.newLotId].qty+=give;
    // Per-event cumulative rounded paisa deltas telescope exactly over
    // multiple partial customer returns. Calculating round(give * cost)
    // independently can lose/gain paisa on every tiny split.
    const previous=fundedByEvent[e.eventId].reversed;
    const newReversed=previous+give;
    function rounded(qty,cents) {
      return returnScaledPaisa_(qty,cents,scale);
    }
    const provBefore=rounded(previous,provisionalMinor);
    const actualBefore=rounded(previous,e.actualUnitCostMinor);
    const provAfter=rounded(newReversed,provisionalMinor);
    const actualAfter=rounded(newReversed,e.actualUnitCostMinor);
    if (![provBefore,actualBefore,provAfter,actualAfter].every(Number.isSafeInteger))
      throw new Error('Unrepresentable return cost arithmetic; Needs Review.');
    const provReturned=provAfter-provBefore;
    const actualReturned=actualAfter-actualBefore;
    const deltaReversed=provReturned-actualReturned;
    if (![provReturned,actualReturned,deltaReversed,
          totalCogsReversalMinor+deltaReversed].every(Number.isSafeInteger))
      throw new Error('Unrepresentable return cost arithmetic; Needs Review.');
    totalCogsReversalMinor+=deltaReversed;
    reversalEvents.push({
      operationId:operationId,returnId:returnId,
      settlementId:e.eventId,oversoldLotId:sourceLotId,
      purchaseLotId:e.newLotId,sourceInvoiceId:invoice,
      sourceProductId:productId,sourceSaleProductId:sourceId,
      quantityTicks:give,quantityScale:scale,
      provisionalUnitCostMinor:provisionalMinor,
      actualUnitCostMinor:e.actualUnitCostMinor,
      provisionalReturnedCostMinor:provReturned,
      actualReturnedCostMinor:actualReturned,
      cogsDeltaReversalMinor:deltaReversed
    });
  });
  if (need!==0) return review('RETURN_EXCEEDS_AVAILABLE_FUNDED_QUANTITY');
  const purchaseLotUpdates=[];
  let fundedRestored=0;
  for (const rev of reversalEvents) fundedRestored+=rev.quantityTicks;
  for (const id of Object.keys(restorationByLot)) {
    const p=restorationByLot[id],before=ticks(p.lot['Remaining Quantity']);
    const original=ticks(p.lot['Original Quantity']);
    const after=before+p.qty;
    if (!Number.isSafeInteger(after)||after>original ||
        !Number.isSafeInteger(p.lot._rowIndex)||p.lot._rowIndex<2)
      return review('PURCHASE_LOT_RESTORATION_EXCEEDS_SOURCE');
    purchaseLotUpdates.push({
      lotId:id,rowIndex:p.lot._rowIndex,beforeTicks:before,afterTicks:after,
      quantityScale:scale,statusAfter:after===0?'Consumed':'Active'
    });
  }
  if (unfundedRestored>0 &&
      (!Number.isSafeInteger(debtLot._rowIndex)||debtLot._rowIndex<2))
    return review('MISSING_OVERSOLD_ROW_IDENTITY');
  const afterStock=currentStock+returnTicks;
  if (!Number.isSafeInteger(afterStock)||fundedRestored+unfundedRestored!==returnTicks)
    return review('RETURN_STOCK_QUANTITY_CONSERVATION_FAILED');
  return result('READY','',{
    operationId:operationId,returnId:returnId,sourceInvoiceId:invoice,
    sourceSaleProductId:sourceId,productId:productId,
    saleItemRowIndex:link._rowIndex,
    saleItemQtyBeforeTicks:soldTicks,
    saleItemQtyAfterTicks:soldTicks-returnTicks,
    productStockBeforeTicks:currentStock,
    productStockAfterTicks:afterStock,stockQtyDeltaTicks:returnTicks,
    negativeDebtRestoredTicks:unfundedRestored,
    newLotsRestoredTicks:fundedRestored,
    totalCogsDeltaReversalMinor:totalCogsReversalMinor,
    debtUpdates:debtUpdates,
    purchaseLotUpdates:purchaseLotUpdates,
    reversalEvents:reversalEvents
  });
}
