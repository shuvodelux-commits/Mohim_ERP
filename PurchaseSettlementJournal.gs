/**
 * Mohim_ERP GAS — Task 5C2A purchase operation journal and crash gate.
 *
 * PRIVATE HELPERS, NOT CONNECTED TO createPurchase YET.
 *
 * All mutating entrypoints are designed to be called by a server-authorized
 * purchase transaction that ALREADY owns LockService.getScriptLock().
 * Google Sheets operations are not transactional; a failed append/update
 * may have committed despite the error. Never conclude a writer may safely
 * retry a business mutation merely because an exception was thrown.
 *
 * These helpers contain no purchase, inventory or Cash/Bank/Supplier writes.
 * A real writer and its source-specific verification/fault-injection test
 * must be reviewed before enabling live settlement.
 */
function purchaseSettlementJournalResult_(status, issue, fields) {
  const out=Object.assign({
    status:status,postable:false,issues:issue?[String(issue)]:[],receiptRef:null
  },fields||{});
  Object.freeze(out.issues);
  return Object.freeze(out);
}

function purchaseSettlementJournalValidIntent_(intent) {
  return !!intent &&
    /^[A-Za-z0-9_-]{12,100}$/.test(String(intent.operationId||'')) &&
    /^[A-Za-z0-9_-]{3,128}$/.test(String(intent.purchaseId||'')) &&
    String(intent.actor||'').length>0 &&
    /^sha256:[a-f0-9]{64}$/.test(String(intent.fingerprint||'')) &&
    Array.isArray(intent.productIds) && intent.productIds.length>0 &&
    intent.productIds.every(function (id) {return !!String(id||'');});
}

/**
 * Read-only authorization to either reserve a brand-new operation OR return
 * an already-verified, committed receipt. A matching operation alone is
 * insufficient: its original source rows must be read back by verifier.
 *
 * The conservative '*' journal marker blocks ALL new purchases while a
 * pending/failed purchase's cash, supplier and stock outcome is uncertain.
 */
function purchaseSettlementJournalDecision_(intent, rows, verifiedReceipt) {
  const review=function(reason){return purchaseSettlementJournalResult_('NEEDS_REVIEW',reason);};
  if (!purchaseSettlementJournalValidIntent_(intent) || !Array.isArray(rows))
    return review('INVALID_PURCHASE_JOURNAL_REQUEST');
  const sameOp=rows.filter(function(row){
    return String(row['Operation ID']||'')===String(intent.operationId);
  });
  if (sameOp.length>1) return review('DUPLICATE_OPERATION_JOURNAL');
  // Even a *committed* operation may not share its Purchase ID with another
  // journal. Never return a seemingly valid receipt while purchase identity
  // is ambiguous across two distinct financial/stock operations.
  if (rows.some(function(row){
    return String(row['Purchase ID']||'')===String(intent.purchaseId) &&
      String(row['Operation ID']||'')!==String(intent.operationId);
  })) return review('DUPLICATE_PURCHASE_ID');
  if (sameOp.length===1) {
    const row=sameOp[0];
    if (String(row['Purchase ID']||'')!==String(intent.purchaseId) ||
        String(row.Actor||'')!==String(intent.actor) ||
        String(row['Intent Fingerprint']||'')!==String(intent.fingerprint))
      return review('OPERATION_ACTOR_OR_CART_CONFLICT');
    if (row.State!=='Committed' || row['Last Completed Stage']!=='Committed' ||
        String(row['Result Receipt']||'')!==String(intent.purchaseId))
      return review('INTERRUPTED_PURCHASE_NEEDS_REVIEW');
    try {
      if (typeof verifiedReceipt!=='function' ||
          verifiedReceipt(String(intent.purchaseId),row)!==true)
        return review('COMMITTED_RECEIPT_NOT_VERIFIED');
    } catch (err) {
      return review('RECEIPT_READBACK_UNCERTAIN');
    }
    return purchaseSettlementJournalResult_('REPLAY',null,{receiptRef:String(intent.purchaseId)});
  }
  if (rows.some(function(row){return String(row['Purchase ID']||'')===String(intent.purchaseId);}))
    return review('DUPLICATE_PURCHASE_ID');
  if (rows.some(function(row){
    // A whole-purchase journal uses '*' (multi-product may involve supplier
    // or bank effects); an unrecognized/blank marker is also global.
    const state=String(row.State||'');
    const product=String(row['Product ID']||'*');
    return state!=='Committed' && (
      product==='*' || intent.productIds.indexOf(product)!==-1
    );
  })) return review('PENDING_PURCHASE_BLOCKS_POSTING');
  return purchaseSettlementJournalResult_('NEW',null);
}

function purchaseSettlementJournalReadOne_(intent) {
  const matches=getAllRows_('PURCHASE_SETTLEMENT_JOURNAL').filter(function(row){
    return String(row['Operation ID']||'')===String(intent.operationId);
  });
  return matches.length===1 ? matches[0] : null;
}

/**
 * Reservation append is the FIRST permitted persistent journal mutation,
 * executed only after all cart, supplier, stock, bank and source-lineage
 * validation. If append throws, never retry it inside this invocation.
 */
function reservePurchaseSettlementJournal_(intent) {
  try {
    const decision=purchaseSettlementJournalDecision_(
      intent,getAllRows_('PURCHASE_SETTLEMENT_JOURNAL')
    );
    if (decision.status!=='NEW') return purchaseSettlementJournalResult_(
      'NEEDS_REVIEW',decision.issues[0]||'NOT_NEW_PURCHASE'
    );
    const now=new Date();
    appendRow_('PURCHASE_SETTLEMENT_JOURNAL',{
      'Operation ID':intent.operationId,'Purchase ID':intent.purchaseId,
      'Product ID':'*','Intent Fingerprint':intent.fingerprint,
      State:'Writing','Last Completed Stage':'Reserved',
      'Result Receipt':'',Actor:intent.actor,
      'Created At':now,'Updated At':now,Error:''
    });
    const row=purchaseSettlementJournalReadOne_(intent);
    if (!row || row.State!=='Writing' ||
        row['Last Completed Stage']!=='Reserved' ||
        row['Intent Fingerprint']!==intent.fingerprint ||
        String(row.Actor)!==String(intent.actor))
      return purchaseSettlementJournalResult_('NEEDS_REVIEW','JOURNAL_RESERVATION_UNCERTAIN');
    return purchaseSettlementJournalResult_('WRITING',null,{lastStage:'Reserved'});
  } catch(err) {
    return purchaseSettlementJournalResult_('NEEDS_REVIEW','RESERVATION_WRITE_OUTCOME_UNKNOWN');
  }
}

/** Strict source-ordered stages: no silent repeated or skipped sheet writes. */
const PURCHASE_SETTLEMENT_STAGES_=[
  'Reserved','Purchase Header','Stock And Lots','Settlement Events',
  'Purchase Items','Stock Movements','Payments','Supplier Due','Committed'
];

function purchaseSettlementJournalWritableRow_(intent) {
  if (!purchaseSettlementJournalValidIntent_(intent)) return null;
  const row=purchaseSettlementJournalReadOne_(intent);
  if (!row || !Number.isInteger(row._rowIndex) || row._rowIndex<2 ||
      row.State!=='Writing' ||
      String(row.Actor)!==String(intent.actor) ||
      String(row['Purchase ID'])!==String(intent.purchaseId) ||
      String(row['Intent Fingerprint'])!==String(intent.fingerprint))
    return null;
  return row;
}

function advancePurchaseSettlementJournal_(intent,stage) {
  try {
    const row=purchaseSettlementJournalWritableRow_(intent);
    const before=row && PURCHASE_SETTLEMENT_STAGES_.indexOf(String(row['Last Completed Stage']));
    if (!row || before<0 || before>=PURCHASE_SETTLEMENT_STAGES_.length-2 ||
        PURCHASE_SETTLEMENT_STAGES_[before+1]!==stage)
      return purchaseSettlementJournalResult_('NEEDS_REVIEW','JOURNAL_STAGE_OUT_OF_ORDER');
    updateRowFields_('PURCHASE_SETTLEMENT_JOURNAL',row._rowIndex,{
      'Last Completed Stage':stage,'Updated At':new Date()
    });
    const readback=purchaseSettlementJournalReadOne_(intent);
    if (!readback || readback.State!=='Writing' || readback['Last Completed Stage']!==stage)
      return purchaseSettlementJournalResult_('NEEDS_REVIEW','JOURNAL_STAGE_READBACK_FAILED');
    return purchaseSettlementJournalResult_('WRITING',null,{lastStage:stage});
  } catch(err) {
    markPurchaseSettlementNeedsReview_(intent,'JOURNAL_STAGE_WRITE_OUTCOME_UNKNOWN');
    return purchaseSettlementJournalResult_('NEEDS_REVIEW','JOURNAL_STAGE_WRITE_OUTCOME_UNKNOWN');
  }
}

function markPurchaseSettlementNeedsReview_(intent,why) {
  try {
    const row=purchaseSettlementJournalReadOne_(intent);
    if (!row || !Number.isInteger(row._rowIndex) || row._rowIndex<2 ||
        String(row['Purchase ID']||'')!==String(intent.purchaseId) ||
        String(row.Actor||'')!==String(intent.actor) ||
        String(row['Intent Fingerprint']||'')!==String(intent.fingerprint))
      return purchaseSettlementJournalResult_('NEEDS_REVIEW','JOURNAL_MISSING_OR_MISMATCHED');
    if (row.State==='Committed') return purchaseSettlementJournalResult_(
      'NEEDS_REVIEW','COMMITTED_JOURNAL_REQUIRES_RECEIPT_REVIEW'
    );
    if (row.State!=='Needs Review') {
      updateRowFields_('PURCHASE_SETTLEMENT_JOURNAL',row._rowIndex,{
        State:'Needs Review',Error:String(why||'Unknown write outcome').slice(0,300),
        'Updated At':new Date()
      });
    }
    return purchaseSettlementJournalResult_('NEEDS_REVIEW','PURCHASE_REQUIRES_RECONCILIATION');
  } catch(err) {
    return purchaseSettlementJournalResult_('NEEDS_REVIEW','MARK_NEEDS_REVIEW_UNCERTAIN');
  }
}

/**
 * Caller MUST verify the full original purchase receipt, item quantities,
 * all product/lot movements, settlement events and supplier/cash/bank
 * effects. A false/throw prevents commit; no automatic second posting.
 */
function commitPurchaseSettlementJournal_(intent,verifySourceReceipt) {
  try {
    const row=purchaseSettlementJournalWritableRow_(intent);
    if (!row || row['Last Completed Stage']!=='Supplier Due')
      return purchaseSettlementJournalResult_('NEEDS_REVIEW','JOURNAL_NOT_READY_TO_COMMIT');
    if (typeof verifySourceReceipt!=='function' ||
        verifySourceReceipt(String(intent.purchaseId),row)!==true)
      return purchaseSettlementJournalResult_('NEEDS_REVIEW','PURCHASE_RECEIPT_NOT_VERIFIED');
    updateRowFields_('PURCHASE_SETTLEMENT_JOURNAL',row._rowIndex,{
      State:'Committed','Last Completed Stage':'Committed',
      'Result Receipt':intent.purchaseId,'Updated At':new Date(),Error:''
    });
    const committed=purchaseSettlementJournalReadOne_(intent);
    if (!committed || committed.State!=='Committed' ||
        committed['Last Completed Stage']!=='Committed' ||
        committed['Result Receipt']!==intent.purchaseId)
      return purchaseSettlementJournalResult_('NEEDS_REVIEW','COMMIT_READBACK_UNKNOWN');
    return purchaseSettlementJournalResult_('COMMITTED',null,{receiptRef:intent.purchaseId});
  } catch(err) {
    markPurchaseSettlementNeedsReview_(intent,'COMMIT_WRITE_OUTCOME_UNKNOWN');
    return purchaseSettlementJournalResult_('NEEDS_REVIEW','COMMIT_WRITE_OUTCOME_UNKNOWN');
  }
}

/**
 * Pure exact-source receipt verification. This NEVER reads Google Sheets
 * itself; its trusted caller must supply fresh uncached rows under
 * ScriptLock, or a committed replay must explicitly reread all sources.
 *
 * The receipt can be marked Committed only after the purchase header/items,
 * per-product net stock, each purchased + old OVERSOLD lot, immutable
 * settlement entries, stock movements and matching supplier payment/ledger
 * effects reconcile to the validated whole-purchase intent.
 *
 * Invalid or ambiguous evidence returns false; there is no "best effort"
 * success based merely on the existence of a purchase header.
 */
function verifyPurchaseSettlementReceipt_(snapshot) {
  try {
    if (!snapshot || !snapshot.expected) return false;
    const e=snapshot.expected;
    const pid=String(e.purchaseId||'');
    if (!pid || !String(e.operationId||'') || !String(e.supplierId||'') ||
        !Array.isArray(e.lines) || !e.lines.length ||
        !Array.isArray(e.allocations) || !String(e.date||''))
      return false;
    const keys=['purchases','purchaseItems','products','stockLots','movements','settlements',
      'cashRows','bankRows','suppliers','supplierLedger'];
    if (keys.some(function(key){return !Array.isArray(snapshot[key]);})) return false;
    function minor(x) {
      if (x===null || x===undefined || x==='') return null;
      const n=Number(x), scaled=n*100;
      if (!Number.isFinite(n) || n<0 ||
          !Number.isSafeInteger(Math.round(scaled)) ||
          Math.abs(scaled-Math.round(scaled))>0.0000001) return null;
      return Math.round(scaled);
    }
    function cents(raw) {return raw===''||raw===null||raw===undefined?0:minor(raw);}
    function ticks(raw,scale) {
      if (raw===null || raw===undefined || raw==='') return null;
      const n=Number(raw)*scale;
      if (!Number.isSafeInteger(Math.round(n)) ||
          Math.abs(n-Math.round(n))>0.0000001) return null;
      return Math.round(n);
    }
    function one(rows,fn) {
      const found=rows.filter(fn);
      return found.length===1?found[0]:null;
    }
    const grand=e.subtotalMinor-e.discountMinor;
    if (![e.subtotalMinor,e.discountMinor,e.grandTotalMinor,e.paidMinor,e.dueMinor,
      e.supplierDueAfterMinor].every(Number.isSafeInteger) ||
      e.discountMinor<0 || grand<0 || grand!==e.grandTotalMinor ||
      e.paidMinor<0 || e.dueMinor<0 || e.paidMinor+e.dueMinor!==grand)
      return false;

    const purchase=one(snapshot.purchases,function(r){return String(r['Purchase ID'])===pid;});
    if (!purchase || String(purchase.Date).slice(0,10)!==String(e.date) ||
        String(purchase['Supplier ID'])!==String(e.supplierId) ||
        minor(purchase.Subtotal)!==e.subtotalMinor ||
        minor(purchase.Discount)!==e.discountMinor ||
        minor(purchase['Grand Total'])!==grand ||
        minor(purchase['Paid Amount'])!==e.paidMinor ||
        minor(purchase['Due Amount'])!==e.dueMinor)
      return false;

    const itemRows=snapshot.purchaseItems.filter(function(r){return String(r['Purchase ID'])===pid;});
    const movements=snapshot.movements.filter(function(r){return String(r.Reference)===pid &&
      String(r.Type)==='Purchase';});
    if (itemRows.length!==e.lines.length || movements.length!==e.lines.length) return false;
    const seen={}, newLotIds={},lineById={};
    let expectedSubtotal=0;
    for (const line of e.lines) {
      const productId=String(line.productId||''), scale=Number(line.quantityScale);
      if (!productId || seen[productId] || !Number.isSafeInteger(scale) || scale<=0 ||
          !Number.isSafeInteger(line.quantityTicks) || line.quantityTicks<=0 ||
          !Number.isSafeInteger(line.availableQtyTicks) ||
          line.availableQtyTicks<0 || line.availableQtyTicks>line.quantityTicks ||
          !Number.isSafeInteger(line.unitCostMinor) || line.unitCostMinor<0 ||
          !Number.isSafeInteger(line.sellPriceMinor) || line.sellPriceMinor<0 ||
          !Number.isSafeInteger(line.stockAfterTicks))
        return false;
      seen[productId]=true;
      lineById[productId]=line;
      const lotId=String(line.lotId||'');
      if (!lotId || newLotIds[lotId]) return false;
      newLotIds[lotId]=true;
      const item=one(itemRows,function(r){return String(r['Product ID'])===productId;});
      const product=one(snapshot.products,function(r){return String(r['Product ID'])===productId;});
      const lot=one(snapshot.stockLots,function(r){return String(r['Lot ID'])===lotId;});
      const movement=one(movements,function(r){return String(r['Product ID'])===productId;});
      const lineValue=Number((BigInt(line.quantityTicks)*BigInt(line.unitCostMinor)+
        BigInt(scale)/2n)/BigInt(scale));
      if (!Number.isSafeInteger(lineValue) || !Number.isSafeInteger(expectedSubtotal+lineValue))
        return false;
      expectedSubtotal+=lineValue;
      if (!item || !product || !lot || !movement ||
          ticks(item.Quantity,scale)!==line.quantityTicks ||
          minor(item['Unit Price'])!==line.unitCostMinor ||
          minor(item['Sell Price'])!==line.sellPriceMinor ||
          minor(item['Line Total'])!==lineValue ||
          ticks(product['Current Stock'],scale)!==line.stockAfterTicks ||
          String(lot['Product ID'])!==productId || String(lot['Purchase ID'])!==pid ||
          ticks(lot['Original Quantity'],scale)!==line.quantityTicks ||
          ticks(lot['Remaining Quantity'],scale)!==line.availableQtyTicks ||
          minor(lot['Purchase Price'])!==line.unitCostMinor ||
          String(lot.Status)!==(line.availableQtyTicks>0?'Active':'Consumed') ||
          String(movement['Lot ID'])!==lotId ||
          ticks(movement['Quantity In'],scale)!==line.quantityTicks ||
          cents(movement['Quantity Out'])!==0 ||
          ticks(movement['Balance Stock'],scale)!==line.stockAfterTicks)
        return false;
      const signed=snapshot.stockLots.filter(function(r){return String(r['Product ID'])===productId;})
        .reduce(function(sum,r){
          const n=ticks(r['Remaining Quantity'],scale);
          return n===null?NaN:sum+n;
        },0);
      if (signed!==line.stockAfterTicks) return false;
    }
    if (expectedSubtotal!==e.subtotalMinor) return false;

    const settled=snapshot.settlements.filter(function(r){return String(r['Purchase ID'])===pid;});
    if (settled.length!==e.allocations.length) return false;
    const eventIds={}, matched={}, fundedByProduct={};
    for (const expected of e.allocations) {
      const srcLine=lineById[expected.productId];
      if (!srcLine || String(expected.purchaseLotId)!==String(srcLine.lotId) ||
          Number(expected.quantityScale)!==Number(srcLine.quantityScale) ||
          !Number.isSafeInteger(expected.settledQtyTicks) || expected.settledQtyTicks<=0 ||
          !Number.isSafeInteger(expected.provisionalUnitCostMinor) ||
          !Number.isSafeInteger(expected.actualUnitCostMinor) ||
          expected.actualUnitCostMinor!==srcLine.unitCostMinor)
        return false;
      // Derive both sides of the signed cost adjustment independently in
      // integer paisa. Never round a per-unit variance before multiplying.
      const scale=BigInt(srcLine.quantityScale),qty=BigInt(expected.settledQtyTicks);
      const prov=Number((qty*BigInt(expected.provisionalUnitCostMinor)+scale/2n)/scale);
      const actual=Number((qty*BigInt(expected.actualUnitCostMinor)+scale/2n)/scale);
      if (!Number.isSafeInteger(prov) || !Number.isSafeInteger(actual) ||
          expected.provisionalCOGSMinor!==prov || expected.actualCOGSMinor!==actual ||
          expected.favorableVarianceMinor!==prov-actual)
        return false;
      fundedByProduct[expected.productId]=(fundedByProduct[expected.productId]||0)+expected.settledQtyTicks;
      const key=[expected.productId,expected.oversoldLotId,expected.sourceInvoiceId,
        expected.sourceSaleProductId,expected.purchaseLotId].join('|');
      if (matched[key]) return false;
      matched[key]=true;
      const found=one(settled,function(r){
        return [r['Product ID'],r['Oversold Lot ID'],r['Source Invoice ID'],
          r['Source Sale Product ID'],r['Purchase Lot ID']].map(String).join('|')===key;
      });
      if (!found || !found['Settlement ID'] || eventIds[String(found['Settlement ID'])] ||
          String(found['Operation ID'])!==String(e.operationId) ||
          String(found.State)!=='Committed' ||
          Number(found['Quantity Ticks'])!==expected.settledQtyTicks ||
          Number(found['Quantity Scale'])!==expected.quantityScale ||
          Number(found['Provisional Unit Cost Minor'])!==expected.provisionalUnitCostMinor ||
          Number(found['Actual Unit Cost Minor'])!==expected.actualUnitCostMinor ||
          Number(found['Provisional COGS Minor'])!==expected.provisionalCOGSMinor ||
          Number(found['Actual COGS Minor'])!==expected.actualCOGSMinor ||
          Number(found['Favorable Variance Minor'])!==expected.favorableVarianceMinor)
        return false;
      eventIds[String(found['Settlement ID'])]=true;
    }
    // The original purchase increases Products.Current Stock by Q exactly
    // once. Settlement consumes ONLY Q-funded from the new purchase lot;
    // every sourced old debt lot increases by that same funded amount.
    for (const line of e.lines) {
      const funded=fundedByProduct[line.productId]||0;
      if (!Number.isSafeInteger(funded) || funded<0 ||
          funded+line.availableQtyTicks!==line.quantityTicks) return false;
    }
    const oldById={};
    e.allocations.forEach(function(a){
      if (!oldById[a.oversoldLotId]) oldById[a.oversoldLotId]={
        productId:a.productId,scale:a.quantityScale,settled:0
      };
      const o=oldById[a.oversoldLotId];
      if (o.productId!==a.productId || o.scale!==a.quantityScale) o.invalid=true;
      o.settled+=a.settledQtyTicks;
    });
    for (const oldId of Object.keys(oldById)) {
      const old=oldById[oldId],row=one(snapshot.stockLots,function(l){return String(l['Lot ID'])===oldId;});
      if (!row || old.invalid || String(row['Purchase ID'])!=='OVERSOLD' ||
          String(row['Product ID'])!==old.productId) return false;
      const remaining=ticks(row['Remaining Quantity'],old.scale);
      if (remaining===null || remaining>0 ||
          String(row.Status)!==(remaining===0?'Consumed':'Oversold'))
        return false;
      // Source rows may have previously funded quantities; exact after-tick
      // proof belongs to caller's prewrite snapshot, not just receipt alone.
      const linked=e.oldDebtUpdates && e.oldDebtUpdates.filter(function(u){return u.lotId===oldId;});
      if (!linked || linked.length!==1 || remaining!==linked[0].afterTicks)
        return false;
    }

    const cash=snapshot.cashRows.filter(function(r){return String(r.Reference)===pid &&
      String(r.Type)==='Purchase Payment';});
    const bank=snapshot.bankRows.filter(function(r){return String(r.Reference)===pid &&
      String(r.Type)==='Purchase Payment';});
    if (e.paidMinor===0) {
      if (cash.length || bank.length) return false;
    } else if (String(e.method)==='Cash') {
      if (cash.length!==1 || bank.length || minor(cash[0].Debit)!==e.paidMinor ||
          cents(cash[0].Credit)!==0) return false;
    } else {
      if (cash.length || bank.length!==1 || String(bank[0]['Bank Account ID'])!==String(e.bankAccountId) ||
          minor(bank[0].Debit)!==e.paidMinor || cents(bank[0].Credit)!==0) return false;
    }
    const supplier=one(snapshot.suppliers,function(r){return String(r['Supplier ID'])===String(e.supplierId);});
    if (!supplier || minor(supplier['Current Due'])!==e.supplierDueAfterMinor) return false;
    const ledger=snapshot.supplierLedger.filter(function(r){return String(r.Reference)===pid && String(r.Type)==='Purchase';});
    if (e.dueMinor>0) {
      if (ledger.length!==1 || String(ledger[0]['Supplier ID'])!==String(e.supplierId) ||
          minor(ledger[0].Debit)!==e.dueMinor || cents(ledger[0].Credit)!==0)
        return false;
    } else if (ledger.length!==0) return false;
    return true;
  } catch(err) {
    return false;
  }
}

/**
 * Non-mutating schema readiness check. Database.gs:getSheet_ CREATES a
 * missing Sheet on read, so the future purchase writer MUST call this gate
 * on an explicitly prepared copy/live workbook before getAllRows_ on either
 * journal. Missing/duplicate columns are never self-healed during posting.
 */
function purchaseSettlementWriterSchemaReady_() {
  try {
    if (typeof getSpreadsheet_!=='function' ||
        !CONFIG || !CONFIG.SHEETS || !CONFIG.HEADERS)
      return {ready:false,reason:'SETUP_REQUIRED'};
    const ss=getSpreadsheet_();
    for (const key of ['PURCHASE_SETTLEMENT_JOURNAL','STOCK_LOT_SETTLEMENTS']) {
      const sheetName=CONFIG.SHEETS[key], expected=CONFIG.HEADERS[key];
      if (!sheetName || !Array.isArray(expected) || !expected.length)
        return {ready:false,reason:'MISSING_CONFIG_SCHEMA_'+key};
      // Direct spreadsheet API: getSheetByName() is read-only, unlike
      // getSheet_(), which inserts missing sheets and formats headers.
      const sheet=ss.getSheetByName(sheetName);
      if (!sheet) return {ready:false,reason:'MISSING_SETUP_SHEET_'+key};
      const size=sheet.getLastColumn();
      if (!Number.isInteger(size) || size<expected.length)
        return {ready:false,reason:'MISSING_REQUIRED_HEADERS_'+key};
      const headers=sheet.getRange(1,1,1,size).getValues()[0].map(String);
      if (new Set(headers).size!==headers.length ||
          expected.some(function(h){return headers.indexOf(String(h))===-1;}))
        return {ready:false,reason:'MISSING_OR_DUPLICATE_HEADERS_'+key};
    }
    return {ready:true,reason:''};
  } catch(err) {
    return {ready:false,reason:'SCHEMA_READBACK_UNCERTAIN'};
  }
}
