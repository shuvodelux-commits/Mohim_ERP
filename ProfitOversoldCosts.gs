/**
 * Mohim_ERP · Task 5C3A — source-linked effective purchase-cost overlay.
 *
 * READ-ONLY. Never rewrites SALE_ITEM_LOTS provisional sale-time cost,
 * old invoices, Cash/Bank, supplier payments, or the lot journal. It
 * attributes the real purchase cost after a committed, source-verified
 * OVERSOLD replenishment to the ORIGINAL invoice's reporting period.
 *
 * A partly written allocation, duplicate identity, source return or
 * incomplete accounting lineage must fail CLOSED; it cannot quietly
 * substitute the master product's purchase price or default to zero.
 */
function computeCommittedOversoldCostOverlay_(source) {
  function done(status,code,adjustments,provisionalSourceCount) {
    const a=adjustments||[];
    const result={status:status,issues:code?[code]:[],adjustments:a,
      totalCogsDeltaMinor:a.reduce(function(n,x){return n+x.deltaMinor;},0),
      provisionalSourceCount:provisionalSourceCount||0};
    Object.freeze(result.issues);
    a.forEach(function(x){Object.freeze(x);});
    Object.freeze(a);
    return Object.freeze(result);
  }
  const bad=function(reason){return done('NEEDS_REVIEW',reason,[]);};
  if (!source || ['saleItemLots','stockLots','settlements','journals','purchases'].some(function(key){
    return !Array.isArray(source[key]);
  })) return bad('INCOMPLETE_COST_EVIDENCE');
  const byId=function(rows,idKey){
    const map={};
    rows.forEach(function(row){
      const id=String(row[idKey]||'');
      if (!map[id]) map[id]=[];
      map[id].push(row);
    });
    return map;
  };
  const reversalPresent=['reversals','returnJournals','returnReceipts','returnItems']
    .some(function(k){return Object.prototype.hasOwnProperty.call(source,k);});
  if (reversalPresent && ['reversals','returnJournals','returnReceipts','returnItems']
    .some(function(k){return !Array.isArray(source[k]);}))
    return bad('INCOMPLETE_RETURN_REVERSAL_EVIDENCE');
  const reversals=reversalPresent?source.reversals:[];
  const returnJournals=reversalPresent?source.returnJournals:[];
  const returnReceipts=reversalPresent?source.returnReceipts:[];
  const returnItems=reversalPresent?source.returnItems:[];
  const returnJournalMap=byId(returnJournals,'Operation ID');
  const returnReceiptMap=byId(returnReceipts,'Return ID');
  const reversalByEvent={};
  for (const j of returnJournals) {
    const id=String(j['Operation ID']||'');
    if (!id || returnJournalMap[id].length!==1 ||
      j.State!=='Committed' || j['Last Completed Stage']!=='Committed' ||
      !j['Return ID'] || String(j['Result Receipt'])!==String(j['Return ID']))
      return bad('PENDING_OR_DUPLICATE_RETURN_JOURNAL_NEEDS_REVIEW');
  }
  const journals=byId(source.journals,'Operation ID'),purchases=byId(source.purchases,'Purchase ID');
  const lotMap=byId(source.stockLots,'Lot ID');
  const eventIdMap={};
  const sourceLinks={};
  const debts={};
  const purchaseAllocated={};
  const eventMap={};
  const adjustmentByEvent={};
  const adjustments=[];
  for (const link of source.saleItemLots) {
    const lotId=String(link['Lot ID']||'');
    const key=[link['Invoice ID'],link['Product ID'],
      link['Source Sale Product ID']||link['Product ID'],lotId].map(String).join('|');
    if (!sourceLinks[key]) sourceLinks[key]=[];
    sourceLinks[key].push(link);
  }
  for (const journal of source.journals) {
    if (journal.State!=='Committed' ||
        journal['Last Completed Stage']!=='Committed' ||
        !journal['Result Receipt'] || String(journal['Result Receipt'])!==String(journal['Purchase ID']))
      return bad('PENDING_OR_INVALID_JOURNAL');
    if (!journal['Operation ID'] || journals[String(journal['Operation ID'])].length!==1)
      return bad('DUPLICATE_OR_MISSING_JOURNAL');
  }
  for (const event of source.settlements) {
    const eventId=String(event['Settlement ID']||'');
    if (!eventId || eventIdMap[eventId]) return bad('DUPLICATE_SETTLEMENT_ID');
    eventIdMap[eventId]=true;
    if (event.State!=='Committed') return bad('UNCOMMITTED_SETTLEMENT');
    const op=String(event['Operation ID']||''),purchaseId=String(event['Purchase ID']||'');
    const j=journals[op]||[];
    if (j.length!==1 || String(j[0]['Purchase ID'])!==purchaseId)
      return bad('MISSING_OR_INVALID_PURCHASE_JOURNAL');
    const purchase=purchases[purchaseId]||[];
    if (purchase.length!==1) return bad('MISSING_OR_DUPLICATE_PURCHASE');
    const discount=purchase[0].Discount;
    if (discount===''||discount===null||discount===undefined||!Number.isFinite(Number(discount)))
      return bad('UNVERIFIED_PURCHASE_DISCOUNT_POLICY');
    if (Math.abs(Number(discount))>0.0000001)
      return bad('PURCHASE_DISCOUNT_COST_POLICY_NOT_APPROVED');
    const newLotId=String(event['Purchase Lot ID']||''),oldLotId=String(event['Oversold Lot ID']||'');
    const purchased=lotMap[newLotId]||[],older=lotMap[oldLotId]||[];
    const pid=String(event['Product ID']||''),invoice=String(event['Source Invoice ID']||'');
    const sourceProduct=String(event['Source Sale Product ID']||'');
    if (purchased.length!==1||older.length!==1||
        String(purchased[0]['Product ID'])!==pid ||
        String(purchased[0]['Purchase ID'])!==purchaseId ||
        String(older[0]['Purchase ID'])!=='OVERSOLD' ||
        String(older[0]['Product ID'])!==pid)
      return bad('MISSING_OR_INVALID_SOURCE_LOT');
    const key=[invoice,pid,sourceProduct,oldLotId].join('|');
    const links=sourceLinks[key]||[];
    if (links.length!==1) return bad('MISSING_OR_AMBIGUOUS_SOURCE_SALE_LINK');
    function paisa(raw) {
      if (raw==='' || raw===null || raw===undefined) return null;
      const n=Number(raw)*100;
      return Number.isFinite(n)&&Number.isSafeInteger(Math.round(n))&&
        Math.abs(n-Math.round(n))<0.0000001?Math.round(n):null;
    }
    const scale=Number(event['Quantity Scale']),ticks=Number(event['Quantity Ticks']);
    const provisional=Number(event['Provisional Unit Cost Minor']);
    const actual=Number(event['Actual Unit Cost Minor']);
    if (!Number.isSafeInteger(scale)||scale<=0||scale>1000000||
        !Number.isSafeInteger(ticks)||ticks<=0||
        !Number.isSafeInteger(provisional)||provisional<0||
        !Number.isSafeInteger(actual)||actual<0 ||
        paisa(links[0]['Unit Cost'])!==provisional ||
        paisa(older[0]['Purchase Price'])!==provisional ||
        paisa(purchased[0]['Purchase Price'])!==actual)
      return bad('SOURCE_PROVISIONAL_OR_PURCHASE_COST_MISMATCH');
    const sourceQty=Number(links[0].Quantity)*scale;
    if (!Number.isSafeInteger(Math.round(sourceQty)) ||
        Math.abs(sourceQty-Math.round(sourceQty))>0.0000001 ||sourceQty<0)
      return bad('INVALID_SOURCE_SALE_QUANTITY');
    // Detect quantities exceeding the original net sale before cost-math
    // errors can obscure the underlying source-quantity discrepancy.
    if (!debts[oldLotId]) debts[oldLotId]={productId:pid,scale:scale,qtyTicks:sourceQty,funded:0,lot:older[0]};
    const debt=debts[oldLotId];
    if (debt.productId!==pid || debt.scale!==scale || debt.qtyTicks!==sourceQty)
      return bad('MIXED_SOURCE_QUANTITY_SCALES');
    debt.funded+=ticks;
    // Gross committed funding may exceed net sold quantities AFTER a
    // legitimately returned funded unit. Validate net funding only after
    // all source-verified committed reversal records have been applied.
    if (!Number.isSafeInteger(debt.funded))return bad('FUNDED_QUANTITY_OVERFLOW');
    if (!reversalPresent && debt.funded>debt.qtyTicks)
      return bad('FUNDED_QUANTITY_EXCEEDS_RETURN_ADJUSTED_SALE');
    const roundedMoney=function(cents){
      return Number((BigInt(ticks)*BigInt(cents)+BigInt(scale)/2n)/BigInt(scale));
    };
    const provisionalCogs=roundedMoney(provisional),actualCogs=roundedMoney(actual);
    if (![provisionalCogs,actualCogs].every(Number.isSafeInteger) ||
        Number(event['Provisional COGS Minor'])!==provisionalCogs ||
        Number(event['Actual COGS Minor'])!==actualCogs ||
        Number(event['Favorable Variance Minor'])!==provisionalCogs-actualCogs)
      return bad('INVALID_VARIANCE_OR_COGS_CONSERVATION');
    if (!purchaseAllocated[newLotId]) purchaseAllocated[newLotId]={scale:scale,productId:pid,qty:0,lot:purchased[0]};
    const allocation=purchaseAllocated[newLotId];
    if (allocation.scale!==scale||allocation.productId!==pid) return bad('PURCHASE_UNIT_SCALE_MISMATCH');
    allocation.qty+=ticks;
    if (!Number.isSafeInteger(allocation.qty))
      return bad('PURCHASE_ALLOCATION_OVERFLOW');
    const adj={invoiceId:invoice,sourceSaleProductId:sourceProduct,
      sourceProductId:pid,oversoldLotId:oldLotId,purchaseLotId:newLotId,
      settlementId:eventId,quantityTicks:ticks,quantityScale:scale,
      deltaMinor:actualCogs-provisionalCogs};
    adjustments.push(adj);
    adjustmentByEvent[eventId]=adj;
    eventMap[eventId]=event;
  }
  const seenReversalIds={},returnQtyById={};
  for (const r of reversals) {
    const rid=String(r['Reversal ID']||''),eid=String(r['Settlement ID']||'');
    if (!rid||seenReversalIds[rid])return bad('DUPLICATE_RETURN_REVERSAL_ID');
    seenReversalIds[rid]=true;
    if (r.State!=='Committed')return bad('PENDING_RETURN_REVERSAL_NEEDS_REVIEW');
    const sourceEvent=eventMap[eid],adjustment=adjustmentByEvent[eid];
    if (!sourceEvent||!adjustment)return bad('MISSING_REVERSAL_SOURCE_SETTLEMENT');
    const op=String(r['Return Operation ID']||''),returnId=String(r['Return ID']||'');
    const j=returnJournalMap[op]||[],receipts=returnReceiptMap[returnId]||[];
    if (receipts.length===1 &&
        (String(receipts[0]['Is Deleted']||'').toUpperCase()==='TRUE' ||
         String(receipts[0].Status||'')==='Cancelled'))
      return bad('DELETED_OR_CANCELLED_RETURN_RECEIPT_NEEDS_REVIEW');
    if (j.length!==1||receipts.length!==1||
        String(j[0]['Return ID'])!==returnId||
        String(j[0]['Invoice ID'])!==String(adjustment.invoiceId)||
        String(j[0]['Product ID'])!==String(adjustment.sourceProductId)||
        String(receipts[0]['Return Operation ID'])!==op||
        String(receipts[0]['Invoice ID'])!==String(adjustment.invoiceId))
      return bad('INVALID_RETURN_RECEIPT_OR_JOURNAL');
    if (String(r['Source Invoice ID'])!==String(adjustment.invoiceId)||
        String(r['Source Sale Product ID'])!==String(adjustment.sourceSaleProductId)||
        String(r['Product ID'])!==String(adjustment.sourceProductId)||
        String(r['Oversold Lot ID'])!==String(adjustment.oversoldLotId)||
        String(r['Purchase Lot ID'])!==String(adjustment.purchaseLotId)||
        Number(r['Quantity Scale'])!==adjustment.quantityScale||
        Number(r['Provisional Unit Cost Minor'])!==Number(sourceEvent['Provisional Unit Cost Minor'])||
        Number(r['Actual Unit Cost Minor'])!==Number(sourceEvent['Actual Unit Cost Minor']))
      return bad('REVERSAL_SOURCE_COST_OR_LOT_MISMATCH');
    const qty=Number(r['Quantity Ticks']),previous=reversalByEvent[eid]||0;
    const grossTicks=Number(sourceEvent['Quantity Ticks']),scale=BigInt(adjustment.quantityScale);
    if (!Number.isSafeInteger(qty)||qty<=0||!Number.isSafeInteger(previous+qty)||
        previous+qty>grossTicks)return bad('REVERSAL_QUANTITY_EXCEEDS_PURCHASE_FUNDING');
    function rounded(ticks,cents){
      return Number((BigInt(ticks)*BigInt(cents)+scale/2n)/scale);
    }
    const prov=Number(sourceEvent['Provisional Unit Cost Minor']);
    const actual=Number(sourceEvent['Actual Unit Cost Minor']);
    const pr=rounded(previous+qty,prov)-rounded(previous,prov);
    const ar=rounded(previous+qty,actual)-rounded(previous,actual);
    const returnedDifference=pr-ar;
    if (![pr,ar,returnedDifference].every(Number.isSafeInteger)||
        Number(r['Provisional Returned Cost Minor'])!==pr||
        Number(r['Actual Returned Cost Minor'])!==ar||
        Number(r['Cogs Delta Reversal Minor'])!==returnedDifference)
      return bad('INVALID_RETURN_REVERSAL_COGS_VARIANCE');
    const items=returnItems.filter(function(i){
      return String(i['Return ID'])===returnId &&
        String(i['Invoice ID'])===String(adjustment.invoiceId) &&
        String(i['Product ID'])===String(adjustment.sourceSaleProductId);
    });
    if (items.length!==1)return bad('MISSING_OR_DUPLICATE_SOURCE_RETURN_ITEM');
    const returnedTicks=Number(items[0]['Return Quantity'])*adjustment.quantityScale;
    if (!Number.isSafeInteger(Math.round(returnedTicks))||
        Math.abs(returnedTicks-Math.round(returnedTicks))>0.0000001)
      return bad('INVALID_SOURCE_RETURN_QUANTITY');
    returnQtyById[returnId]=(returnQtyById[returnId]||0)+qty;
    if (returnQtyById[returnId]>Math.round(returnedTicks))
      return bad('REVERSAL_EXCEEDS_RETURN_DOCUMENT_QUANTITY');
    reversalByEvent[eid]=previous+qty;
    adjustment.deltaMinor+=returnedDifference;
    adjustment.quantityTicks-=qty;
    debts[adjustment.oversoldLotId].funded-=qty;
    purchaseAllocated[adjustment.purchaseLotId].qty-=qty;
    if (!Number.isSafeInteger(adjustment.deltaMinor)||
        !Number.isSafeInteger(debts[adjustment.oversoldLotId].funded)||
        !Number.isSafeInteger(purchaseAllocated[adjustment.purchaseLotId].qty))
      return bad('RETURN_ADJUSTMENT_OVERFLOW');
  }
  for (const debtId of Object.keys(debts)) {
    const debt=debts[debtId],remaining=Number(debt.lot['Remaining Quantity'])*debt.scale;
    if (!Number.isSafeInteger(Math.round(remaining)) ||
        Math.abs(remaining-Math.round(remaining))>0.0000001 ||
        remaining>0 || debt.funded<0 || debt.funded>debt.qtyTicks ||
        Math.round(remaining)!==debt.funded-debt.qtyTicks ||
        String(debt.lot.Status)!==(remaining===0?'Consumed':'Oversold'))
      return bad('OLD_DEBT_QUANTITY_NOT_CONSERVED');
  }
  for (const lotId of Object.keys(purchaseAllocated)) {
    const allocation=purchaseAllocated[lotId],lot=allocation.lot;
    const original=Number(lot['Original Quantity'])*allocation.scale;
    const available=Number(lot['Remaining Quantity'])*allocation.scale;
    if (!Number.isSafeInteger(Math.round(original)) ||
        Math.abs(original-Math.round(original))>0.0000001 ||
        !Number.isSafeInteger(Math.round(available)) ||
        Math.abs(available-Math.round(available))>0.0000001 ||
        available<0||original<allocation.qty||
        original-available<allocation.qty)
      return bad('NEW_PURCHASE_LOT_ALLOCATION_MISMATCH');
  }
  // Every still-net-sold OVERSOLD source must reconcile with funded
  // quantities. Otherwise an omitted (or lost) committed settlement row
  // would make profit falsely appear final at the provisional unit cost.
  let pendingSources=0;
  for (const key of Object.keys(sourceLinks)) {
    const links=sourceLinks[key];
    const lotId=String(links[0]['Lot ID']||'');
    const sourceLot=lotMap[lotId]||[];
    if (sourceLot.length!==1 || sourceLot[0]['Purchase ID']!=='OVERSOLD') continue;
    if (links.length!==1) return bad('DUPLICATE_OVERSOLD_SOURCE_SALE_LINK');
    const record=sourceLot[0],matched=debts[lotId];
    const scale=matched?matched.scale:1000000;
    const soldQty=Number(links[0].Quantity)*scale;
    const rem=Number(record['Remaining Quantity'])*scale;
    if (!Number.isSafeInteger(Math.round(soldQty)) ||
        Math.abs(soldQty-Math.round(soldQty))>0.0000001 || soldQty<0 ||
        !Number.isSafeInteger(Math.round(rem)) ||
        Math.abs(rem-Math.round(rem))>0.0000001 || rem>0 ||
        Math.round(rem)!==(matched?matched.funded:0)-Math.round(soldQty) ||
        String(record.Status)!==(rem===0?'Consumed':'Oversold'))
      return bad('MISSING_SOURCE_SETTLEMENT_OR_DEBT_QUANTITY_MISMATCH');
    if (rem<0) pendingSources++;
  }
  const sum=adjustments.reduce(function(n,a){return n+a.deltaMinor;},0);
  if (!Number.isSafeInteger(sum)) return bad('COGS_ADJUSTMENT_OVERFLOW');
  return done(pendingSources?'PROVISIONAL':'READY','',adjustments,pendingSources);
}

/**
 * Load source evidence only if the two journal sheets ALREADY EXIST.
 * NEVER call getSheet_ merely to decide whether an optional legacy
 * workbook has begun using the settlement writer: getSheet_() INSERTS
 * missing Sheets and can repair headers during what looks like a read.
 *
 * A half-created settlement setup is ambiguous and is NOT silently
 * interpreted as zero cost adjustments.
 */
function loadCommittedOversoldCostOverlay_() {
  const review=function(reason){return {status:'NEEDS_REVIEW',issues:[reason],adjustments:[],totalCogsDeltaMinor:0};};
  try {
    const keys=['STOCK_LOT_SETTLEMENTS','PURCHASE_SETTLEMENT_JOURNAL'];
    if (!CONFIG || !CONFIG.SHEETS || !CONFIG.HEADERS)
      return review('SETTLEMENT_SCHEMA_NOT_CONFIGURED');
    const ss=getSpreadsheet_();
    const existing=keys.map(function(key){
      return ss.getSheetByName(CONFIG.SHEETS[key]);
    });
    if (!existing[0] && !existing[1])
      return {status:'LEGACY_NO_SETTLEMENT',issues:[],adjustments:[],totalCogsDeltaMinor:0};
    if (!existing[0] || !existing[1])
      return review('SETTLEMENT_SETUP_INCOMPLETE_NEEDS_REVIEW');
    for (let i=0;i<keys.length;i++) {
      const headers=CONFIG.HEADERS[keys[i]];
      const sheet=existing[i],lastCol=sheet.getLastColumn();
      if (!Array.isArray(headers) || !headers.length || lastCol<headers.length)
        return review('SETTLEMENT_SCHEMA_MISSING_HEADERS');
      const actual=sheet.getRange(1,1,1,lastCol).getValues()[0].map(String);
      if (new Set(actual).size!==actual.length ||
          headers.some(function(header){return actual.indexOf(String(header))===-1;}))
        return review('SETTLEMENT_SCHEMA_AMBIGUOUS_NEEDS_REVIEW');
    }
    const source={
      saleItemLots:getAllRows_('SALE_ITEM_LOTS'),
      stockLots:getAllRows_('STOCK_LOTS'),
      settlements:getAllRows_('STOCK_LOT_SETTLEMENTS'),
      journals:getAllRows_('PURCHASE_SETTLEMENT_JOURNAL'),
      purchases:getAllRows_('PURCHASES')
    };
    // A legacy workbook may lack both additive reversal sheets. One
    // missing member of a partly created pair cannot mean zero reversals.
    const reversalKeys=['STOCK_LOT_SETTLEMENT_REVERSALS','FUNDED_RETURN_JOURNAL'];
    if (reversalKeys.every(function(k){return !!CONFIG.SHEETS[k];})) {
      const reversalSheets=reversalKeys.map(function(k){return ss.getSheetByName(CONFIG.SHEETS[k]);});
      if (!!reversalSheets[0]!==!!reversalSheets[1])
        return review('PARTIAL_RETURN_REVERSAL_SCHEMA_NEEDS_REVIEW');
      if (reversalSheets[0] && reversalSheets[1]) {
        for (let i=0;i<reversalKeys.length;i++) {
          const expected=CONFIG.HEADERS[reversalKeys[i]],sheet=reversalSheets[i];
          const lastCol=sheet.getLastColumn();
          if (!expected||lastCol<expected.length)
            return review('MISSING_RETURN_REVERSAL_HEADERS');
          const actual=sheet.getRange(1,1,1,lastCol).getValues()[0].map(String);
          if (new Set(actual).size!==actual.length || expected.some(function(h){return actual.indexOf(h)===-1;}))
            return review('AMBIGUOUS_RETURN_REVERSAL_HEADERS');
        }
        source.reversals=getAllRows_('STOCK_LOT_SETTLEMENT_REVERSALS');
        source.returnJournals=getAllRows_('FUNDED_RETURN_JOURNAL');
        source.returnReceipts=getAllRows_('SALES_RETURN');
        source.returnItems=getAllRows_('SALES_RETURN_ITEMS');
      }
    }
    return computeCommittedOversoldCostOverlay_(source);
  } catch(err) {
    return review('SETTLEMENT_SOURCE_READBACK_FAILED_NEEDS_REVIEW');
  }
}
