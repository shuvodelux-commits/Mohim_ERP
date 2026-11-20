/**
 * Mohim_ERP GAS — Task 5C3B2A durable funded Sales Return journal.
 *
 * Source-native, but NOT CONNECTED to SalesReturn.gs. Caller must already
 * hold native ScriptLock and require returns:add, active Cash Session,
 * completed source provenance, and the direct read-only schema readiness
 * check before calling any writer here. No automatic recovery or retry.
 *
 * A SpreadsheetApp append/update may commit even if it later throws. Every
 * unknown result is Needs Review; never automatically refund a second time.
 */
function fundedReturnJournalResult_(status,issue,values) {
  const result=Object.assign({
    status:status,postable:false,issues:issue?[String(issue)]:[],receiptRef:null
  },values||{});
  Object.freeze(result.issues);
  return Object.freeze(result);
}

function validFundedReturnJournalIntent_(intent) {
  return !!intent && /^[A-Za-z0-9_-]{12,100}$/.test(String(intent.operationId||'')) &&
    /^[A-Za-z0-9_-]{5,128}$/.test(String(intent.returnId||'')) &&
    !!String(intent.invoiceId||'') && !!String(intent.productId||'') &&
    !!String(intent.actor||'') &&
    /^sha256:[a-f0-9]{64}$/.test(String(intent.fingerprint||''));
}

function fundedReturnJournalDecision_(intent,sourceRows,verifySourceReceipt) {
  const bad=function(code){return fundedReturnJournalResult_('NEEDS_REVIEW',code);};
  if (!validFundedReturnJournalIntent_(intent)||!Array.isArray(sourceRows))
    return bad('INVALID_RETURN_JOURNAL_INTENT');
  const matching=sourceRows.filter(function(row){
    return String(row['Operation ID']||'')===String(intent.operationId);
  });
  if (matching.length>1) return bad('DUPLICATE_RETURN_OPERATION');
  if (sourceRows.some(function(row){
    return String(row['Return ID']||'')===String(intent.returnId) &&
      String(row['Operation ID']||'')!==String(intent.operationId);
  })) return bad('DUPLICATE_RETURN_RECEIPT_ID');

  if (matching.length===1) {
    const row=matching[0];
    if (String(row['Return ID']||'')!==String(intent.returnId) ||
        String(row['Invoice ID']||'')!==String(intent.invoiceId) ||
        String(row['Product ID']||'')!==String(intent.productId) ||
        String(row['Intent Fingerprint']||'')!==String(intent.fingerprint) ||
        String(row.Actor||'')!==String(intent.actor))
      return bad('RETURN_OPERATION_CART_OR_ACTOR_CONFLICT');
    if (row.State!=='Committed' ||
        row['Last Completed Stage']!=='Committed' ||
        String(row['Result Receipt']||'')!==String(intent.returnId))
      return bad('INTERRUPTED_RETURN_NEEDS_REVIEW');
    try {
      if (typeof verifySourceReceipt!=='function' ||
          verifySourceReceipt(intent.returnId,row)!==true)
        return bad('COMMITTED_RETURN_RECEIPT_NOT_VERIFIED');
    } catch(error) {return bad('SOURCE_RETURN_READBACK_UNCERTAIN');}
    return fundedReturnJournalResult_('REPLAY',null,{receiptRef:intent.returnId});
  }
  // No new Sales Return while ANY previously journalled funded refund has
  // unknown cash/customer/lot effects. Globally conservative until recovery.
  if (sourceRows.some(function(row){
    return row.State!=='Committed' ||
      row['Last Completed Stage']!=='Committed' ||
      !row['Result Receipt'] ||
      String(row['Result Receipt'])!==String(row['Return ID']);
  })) return bad('PRIOR_FUNDED_RETURN_PENDING_OR_INVALID');
  return fundedReturnJournalResult_('NEW',null);
}

function fundedReturnJournalOne_(intent) {
  const rows=getAllRows_('FUNDED_RETURN_JOURNAL').filter(function(row){
    return String(row['Operation ID']||'')===String(intent.operationId);
  });
  return rows.length===1?rows[0]:null;
}

function fundedReturnJournalWritable_(intent) {
  if (!validFundedReturnJournalIntent_(intent)) return null;
  const row=fundedReturnJournalOne_(intent);
  if (!row || !Number.isInteger(row._rowIndex) || row._rowIndex<2 ||
      row.State!=='Writing' ||
      String(row['Return ID']||'')!==String(intent.returnId) ||
      String(row['Invoice ID']||'')!==String(intent.invoiceId) ||
      String(row['Product ID']||'')!==String(intent.productId) ||
      String(row['Intent Fingerprint']||'')!==String(intent.fingerprint) ||
      String(row.Actor||'')!==String(intent.actor)) return null;
  return row;
}

function reserveFundedReturnJournal_(intent) {
  try {
    const decision=fundedReturnJournalDecision_(intent,getAllRows_('FUNDED_RETURN_JOURNAL'));
    if (decision.status!=='NEW') return fundedReturnJournalResult_(
      'NEEDS_REVIEW',decision.issues[0]||'NOT_NEW_RETURN'
    );
    const at=new Date();
    appendRow_('FUNDED_RETURN_JOURNAL',{
      'Operation ID':intent.operationId,'Return ID':intent.returnId,
      'Invoice ID':intent.invoiceId,'Product ID':intent.productId,
      'Intent Fingerprint':intent.fingerprint,
      State:'Writing','Last Completed Stage':'Reserved',
      'Result Receipt':'',Actor:intent.actor,
      'Created At':at,'Updated At':at,Error:''
    });
    const row=fundedReturnJournalWritable_(intent);
    if (!row || String(row['Last Completed Stage'])!=='Reserved')
      return fundedReturnJournalResult_('NEEDS_REVIEW','RETURN_RESERVATION_READBACK_UNCERTAIN');
    return fundedReturnJournalResult_('WRITING',null,{lastStage:'Reserved'});
  } catch(error) {
    return fundedReturnJournalResult_('NEEDS_REVIEW','RETURN_RESERVATION_OUTCOME_UNKNOWN');
  }
}

const FUNDED_RETURN_STAGES_=[
  'Reserved','Return Header','Stock And Source Lots',
  'Reversal Events','Return Items And Movement','Refund','Committed'
];
function advanceFundedReturnJournal_(intent,stage) {
  try {
    const row=fundedReturnJournalWritable_(intent);
    const old=row && FUNDED_RETURN_STAGES_.indexOf(String(row['Last Completed Stage']));
    if (!row || old<0 || old>=FUNDED_RETURN_STAGES_.length-2 ||
        FUNDED_RETURN_STAGES_[old+1]!==stage)
      return fundedReturnJournalResult_('NEEDS_REVIEW','RETURN_JOURNAL_STAGE_OUT_OF_ORDER');
    updateRowFields_('FUNDED_RETURN_JOURNAL',row._rowIndex,{
      'Last Completed Stage':stage,'Updated At':new Date()
    });
    const verified=fundedReturnJournalWritable_(intent);
    if (!verified || verified['Last Completed Stage']!==stage)
      return fundedReturnJournalResult_('NEEDS_REVIEW','RETURN_STAGE_READBACK_MISMATCH');
    return fundedReturnJournalResult_('WRITING',null,{lastStage:stage});
  } catch(error) {
    markFundedReturnNeedsReview_(intent,'RETURN_JOURNAL_STAGE_OUTCOME_UNKNOWN');
    return fundedReturnJournalResult_('NEEDS_REVIEW','RETURN_JOURNAL_STAGE_OUTCOME_UNKNOWN');
  }
}

function markFundedReturnNeedsReview_(intent,message) {
  try {
    const row=fundedReturnJournalOne_(intent);
    if (!row || !Number.isInteger(row._rowIndex) || row._rowIndex<2 ||
        String(row['Return ID']||'')!==String(intent.returnId) ||
        String(row['Invoice ID']||'')!==String(intent.invoiceId) ||
        String(row['Product ID']||'')!==String(intent.productId) ||
        String(row.Actor||'')!==String(intent.actor) ||
        String(row['Intent Fingerprint']||'')!==String(intent.fingerprint))
      return fundedReturnJournalResult_('NEEDS_REVIEW','RETURN_JOURNAL_IDENTITY_MISMATCH');
    if (row.State==='Committed')
      return fundedReturnJournalResult_('NEEDS_REVIEW','COMMITTED_REFUND_REQUIRES_SOURCE_AUDIT');
    if (row.State!=='Needs Review') {
      updateRowFields_('FUNDED_RETURN_JOURNAL',row._rowIndex,{
        State:'Needs Review','Updated At':new Date(),
        Error:String(message||'Uncertain return outcome').slice(0,300)
      });
    }
    return fundedReturnJournalResult_('NEEDS_REVIEW','REFUND_REQUIRES_RECONCILIATION');
  } catch(error) {
    return fundedReturnJournalResult_('NEEDS_REVIEW','RETURN_RECOVERY_STATUS_UNKNOWN');
  }
}

function commitFundedReturnJournal_(intent,verifySourceReceipt) {
  try {
    const row=fundedReturnJournalWritable_(intent);
    if (!row || row['Last Completed Stage']!=='Refund')
      return fundedReturnJournalResult_('NEEDS_REVIEW','RETURN_WRITER_NOT_FINISHED');
    if (typeof verifySourceReceipt!=='function' ||
        verifySourceReceipt(intent.returnId,row)!==true)
      return fundedReturnJournalResult_('NEEDS_REVIEW','RETURN_RECEIPT_NOT_VERIFIED');
    updateRowFields_('FUNDED_RETURN_JOURNAL',row._rowIndex,{
      State:'Committed','Last Completed Stage':'Committed',
      'Result Receipt':intent.returnId,'Updated At':new Date(),Error:''
    });
    const committed=fundedReturnJournalOne_(intent);
    if (!committed||committed.State!=='Committed' ||
        committed['Last Completed Stage']!=='Committed' ||
        String(committed['Result Receipt'])!==String(intent.returnId))
      return fundedReturnJournalResult_('NEEDS_REVIEW','COMMITTED_RETURN_READBACK_UNKNOWN');
    return fundedReturnJournalResult_('COMMITTED',null,{receiptRef:intent.returnId});
  } catch(error) {
    markFundedReturnNeedsReview_(intent,'RETURN_COMMIT_OUTCOME_UNKNOWN');
    return fundedReturnJournalResult_('NEEDS_REVIEW','RETURN_COMMIT_OUTCOME_UNKNOWN');
  }
}

/**
 * Return setup is an explicit admin/copy-workbook operation. The normal
 * GAS helper getSheet_ creates and repairs missing sheets during reads,
 * so this preflight MUST use direct getSheetByName() only.
 */
function fundedSaleReturnSchemaReady_() {
  try {
    if (!CONFIG || !CONFIG.SHEETS || !CONFIG.HEADERS ||
        typeof getSpreadsheet_!=='function')
      return {ready:false,reason:'RETURN_SETUP_REQUIRED'};
    const ss=getSpreadsheet_();
    for (const key of ['STOCK_LOT_SETTLEMENT_REVERSALS','FUNDED_RETURN_JOURNAL']) {
      const name=CONFIG.SHEETS[key],expected=CONFIG.HEADERS[key];
      if (!name || !Array.isArray(expected) || expected.length<10)
        return {ready:false,reason:'MISSING_RETURN_SCHEMA_'+key};
      const sheet=ss.getSheetByName(name);
      if (!sheet) return {ready:false,reason:'MISSING_RETURN_SETUP_'+key};
      const count=sheet.getLastColumn();
      if (!Number.isInteger(count) || count<expected.length)
        return {ready:false,reason:'MISSING_RETURN_COLUMNS_'+key};
      const actual=sheet.getRange(1,1,1,count).getValues()[0].map(String);
      if (actual.length!==new Set(actual).size ||
          expected.some(function(header){return actual.indexOf(header)===-1;}))
        return {ready:false,reason:'MISSING_OR_DUPLICATE_RETURN_COLUMNS_'+key};
    }
    return {ready:true,reason:''};
  } catch(error) {return {ready:false,reason:'RETURN_SCHEMA_READBACK_UNCERTAIN'};}
}

/**
 * Strict, pure readback for a SINGLE-source-product funded return. The
 * eventual locked writer must derive expected from the immutable prewrite
 * plan and read raw, uncached source rows before committing. This verifier
 * NEVER authorizes a refund or mutates a Google Sheet.
 *
 * Return corrections, batch returns, multiple physical bundle components
 * and payment-source corrections require separate contracts. An unknown
 * later stock or customer balance may cause conservative failure rather
 * than a false successful replay.
 */
function verifyFundedReturnReceipt_(snapshot) {
  try {
    if (!snapshot || !snapshot.expected) return false;
    const e=snapshot.expected;
    const keys=['returns','returnItems','products','saleItemLots','stockLots',
      'originalSettlements','reversals','movements','cashRows','customers','customerLedger'];
    if (keys.some(function(key){return !Array.isArray(snapshot[key]);})) return false;
    const returnId=String(e.returnId||''),op=String(e.operationId||'');
    const invoice=String(e.invoiceId||''),pid=String(e.productId||'');
    const sourceProduct=String(e.sourceSaleProductId||'');
    const scale=Number(e.quantityScale),qty=Number(e.returnQtyTicks);
    const money=Number(e.refundMinor),stockAfter=Number(e.stockAfterTicks);
    if (!returnId || !op || !invoice || !pid || !sourceProduct ||
        !Number.isSafeInteger(scale)||scale<=0||scale>1000000||
        !Number.isSafeInteger(qty)||qty<=0||
        !Number.isSafeInteger(money)||money<0||
        !Number.isSafeInteger(stockAfter)||
        !Number.isSafeInteger(e.saleItemLotAfterTicks) ||
        !Array.isArray(e.debtUpdates)||!Array.isArray(e.purchaseLotUpdates)||
        !Array.isArray(e.reversalEvents)||!e.reversalEvents.length)
      return false;
    function qtyTicks(value) {
      if (value===null||value===undefined||value==='') return null;
      const n=Number(value)*scale;
      return Number.isFinite(n) && Number.isSafeInteger(Math.round(n)) &&
        Math.abs(Math.round(n)-n)<0.0000001?Math.round(n):null;
    }
    function minor(value) {
      if (value===null||value===undefined||value==='') return null;
      const n=Number(value)*100;
      return Number.isFinite(n) && Number.isSafeInteger(Math.round(n)) &&
        Math.abs(n-Math.round(n))<0.0000001?Math.round(n):null;
    }
    function zeroMinor(value) {
      return value===null||value===undefined||value===''?0:minor(value);
    }
    function one(list,fn) {
      const found=list.filter(fn);
      return found.length===1?found[0]:null;
    }
    const returnHeader=one(snapshot.returns,function(r){
      return String(r['Return ID']||'')===returnId;
    });
    if (!returnHeader||String(returnHeader['Return Operation ID'])!==op ||
        String(returnHeader['Invoice ID'])!==invoice ||
        String(returnHeader['Customer ID']||'')!==String(e.customerId||'') ||
        String(returnHeader['Refund Method'])!==String(e.refundMethod) ||
        minor(returnHeader['Total Return Amount'])!==money)
      return false;

    // Single sourced physical product with one original Sales Return item.
    // Match the exact customer reimbursement, not a guessed purchase cost.
    const items=snapshot.returnItems.filter(function(row){
      return String(row['Return ID']||'')===returnId;
    });
    if (items.length!==1||String(items[0]['Product ID'])!==pid ||
        String(items[0]['Invoice ID'])!==invoice ||
        qtyTicks(items[0]['Return Quantity'])!==qty ||
        minor(items[0]['Line Total'])!==money)
      return false;
    const product=one(snapshot.products,function(p){return String(p['Product ID'])===pid;});
    const source=one(snapshot.saleItemLots,function(l){
      return String(l['Invoice ID'])===invoice &&
        String(l['Product ID'])===pid &&
        String(l['Source Sale Product ID']||l['Product ID'])===sourceProduct &&
        String(l['Lot ID'])===String(e.oldDebtLotId);
    });
    if (!product||!source||qtyTicks(product['Current Stock'])!==stockAfter ||
        qtyTicks(source.Quantity)!==Number(e.saleItemLotAfterTicks))
      return false;
    const sourceCost=minor(source['Unit Cost']);
    if (sourceCost===null)return false;
    const lotMap={},lotsByProduct=[];
    for(const lot of snapshot.stockLots) {
      const id=String(lot['Lot ID']||'');
      if (!id||lotMap[id]) return false;
      lotMap[id]=lot;
      if(String(lot['Product ID'])===pid)lotsByProduct.push(lot);
    }
    const old=lotMap[String(e.oldDebtLotId)];
    if (!old||old['Purchase ID']!=='OVERSOLD'||String(old['Product ID'])!==pid||
        minor(old['Purchase Price'])!==sourceCost) return false;
    let allSigned=0;
    for(const lot of lotsByProduct){
      const val=qtyTicks(lot['Remaining Quantity']);
      if(val===null||!Number.isSafeInteger(allSigned+val))return false;
      allSigned+=val;
    }
    if(allSigned!==stockAfter)return false;
    const targetLots={},verifiedRestored={},expectedMovementByLot={};
    for(const change of e.debtUpdates.concat(e.purchaseLotUpdates)) {
      const id=String(change.lotId||''),lot=lotMap[id];
      if(!id||targetLots[id]||!lot||String(lot['Product ID'])!==pid||
          !Number.isSafeInteger(change.afterTicks)||
          !Number.isSafeInteger(change.beforeTicks)||
          change.afterTicks<=change.beforeTicks ||
          qtyTicks(lot['Remaining Quantity'])!==change.afterTicks)
        return false;
      expectedMovementByLot[id]=change.afterTicks-change.beforeTicks;
      targetLots[id]=true;
      if(change.afterTicks===0 && String(lot.Status)!=='Consumed')return false;
      if(change.afterTicks>0 && String(lot.Status)!=='Active')return false;
      if(change.afterTicks<0 && String(lot.Status)!=='Oversold')return false;
      if(id!==String(e.oldDebtLotId) && String(lot['Purchase ID'])==='OVERSOLD')
        return false;
    }
    if(e.debtUpdates.length===0) {
      if(qtyTicks(old['Remaining Quantity'])!==0||String(old.Status)!=='Consumed')
        return false;
    }
    const expectedEvents=e.reversalEvents;
    const globalReversalIds={};
    for(const r of snapshot.reversals) {
      const id=String(r['Reversal ID']||'');
      if(!id||globalReversalIds[id])return false;
      globalReversalIds[id]=true;
    }
    const revs=snapshot.reversals.filter(function(r){return String(r['Return ID'])===returnId;});
    if(revs.length!==expectedEvents.length)return false;
    const seenEvents={},reversedByLot={};
    for(const ev of expectedEvents){
      const sid=String(ev.settlementId||'');
      if(!sid||seenEvents[sid] || String(ev.sourceInvoiceId)!==invoice ||
          String(ev.sourceSaleProductId)!==sourceProduct ||
          String(ev.productId||pid)!==pid ||
          String(ev.oversoldLotId)!==String(e.oldDebtLotId) ||
          Number(ev.quantityScale)!==scale||
          !Number.isSafeInteger(ev.quantityTicks)||ev.quantityTicks<=0)
        return false;
      seenEvents[sid]=true;
      const record=one(revs,function(r){return String(r['Settlement ID']||'')===sid;});
      const original=one(snapshot.originalSettlements,function(r){return String(r['Settlement ID']||'')===sid;});
      const purchased=lotMap[String(ev.purchaseLotId||'')];
      if(!record||!original||!purchased||
          original.State!=='Committed' || record.State!=='Committed' ||
          String(original['Source Invoice ID'])!==invoice ||
          String(original['Source Sale Product ID'])!==sourceProduct ||
          String(original['Oversold Lot ID'])!==String(e.oldDebtLotId) ||
          String(original['Purchase Lot ID'])!==String(ev.purchaseLotId) ||
          String(original['Product ID'])!==pid||
          String(purchased['Product ID'])!==pid ||
          String(purchased['Purchase ID'])==='OVERSOLD'||
          Number(original['Quantity Scale'])!==scale||
          Number(original['Provisional Unit Cost Minor'])!==sourceCost||
          Number(original['Actual Unit Cost Minor'])!==Number(ev.actualUnitCostMinor) ||
          minor(purchased['Purchase Price'])!==Number(ev.actualUnitCostMinor))
        return false;
      if(!record['Reversal ID'] ||
          String(record['Return Operation ID'])!==op||
          String(record['Return ID'])!==returnId||
          String(record['Source Invoice ID'])!==invoice ||
          String(record['Source Sale Product ID'])!==sourceProduct||
          String(record['Product ID'])!==pid||
          String(record['Oversold Lot ID'])!==String(e.oldDebtLotId)||
          String(record['Purchase Lot ID'])!==String(ev.purchaseLotId)||
          Number(record['Quantity Ticks'])!==ev.quantityTicks||
          Number(record['Quantity Scale'])!==scale||
          Number(record['Provisional Unit Cost Minor'])!==sourceCost||
          Number(record['Actual Unit Cost Minor'])!==Number(ev.actualUnitCostMinor)||
          Number(record['Provisional Returned Cost Minor'])!==ev.provisionalReturnedCostMinor||
          Number(record['Actual Returned Cost Minor'])!==ev.actualReturnedCostMinor||
          Number(record['Cogs Delta Reversal Minor'])!==ev.cogsDeltaReversalMinor||
          ![ev.provisionalReturnedCostMinor,ev.actualReturnedCostMinor,ev.cogsDeltaReversalMinor]
            .every(Number.isSafeInteger)||
          ev.provisionalReturnedCostMinor-ev.actualReturnedCostMinor!==ev.cogsDeltaReversalMinor)
        return false;
      reversedByLot[ev.purchaseLotId]=(reversedByLot[ev.purchaseLotId]||0)+ev.quantityTicks;
    }
    const purchasedIds=Object.keys(reversedByLot);
    if(purchasedIds.length!==e.purchaseLotUpdates.length ||
       purchasedIds.some(function(id){return !targetLots[id];})) return false;

    // Every return movement identifies the original source, and the exact
    // summed movement quantity equals R. No synthetic extra stock delta.
    const movements=snapshot.movements.filter(function(row){
      return String(row.Reference)===returnId && String(row.Type)==='Sales Return';
    });
    let moved=0;
    const movementByLot={};
    for(const m of movements) {
      const id=String(m['Lot ID']||''),q=qtyTicks(m['Quantity In']);
      if(String(m['Product ID'])!==pid || !targetLots[id] ||
          q===null||q<=0||zeroMinor(m['Quantity Out'])!==0||
          qtyTicks(m['Balance Stock'])!==stockAfter||
          !Number.isSafeInteger(moved+q))return false;
      moved+=q;movementByLot[id]=(movementByLot[id]||0)+q;
    }
    if(moved!==qty ||
       Object.keys(expectedMovementByLot).some(function(id){
         return movementByLot[id]!==expectedMovementByLot[id];
       }) || Object.keys(movementByLot).some(function(id){
         return !Object.prototype.hasOwnProperty.call(expectedMovementByLot,id);
       }))return false;
    for(const id of purchasedIds)if(movementByLot[id]!==reversedByLot[id])return false;

    const cash=snapshot.cashRows.filter(function(r){
      return String(r.Reference)===returnId&&String(r.Type)==='Sales Return';
    });
    const ledger=snapshot.customerLedger.filter(function(r){
      return String(r.Reference)===returnId&&String(r.Type)==='Sales Return Credit';
    });
    if(e.refundMethod==='Cash'){
      if(cash.length!==1||ledger.length!==0||
          minor(cash[0].Debit)!==money||zeroMinor(cash[0].Credit)!==0)return false;
    }else if(e.refundMethod==='Store Credit'){
      const customer=one(snapshot.customers,function(c){
        return String(c['Customer ID'])===String(e.customerId);
      });
      function signedMinor(raw){
        if(raw===null||raw===undefined||raw==='')return null;
        const n=Number(raw)*100;
        return Number.isFinite(n)&&Number.isSafeInteger(Math.round(n))&&
          Math.abs(n-Math.round(n))<0.0000001?Math.round(n):null;
      }
      if(cash.length!==0||ledger.length!==1||!customer ||
          String(ledger[0]['Customer ID'])!==String(e.customerId)||
          minor(ledger[0].Credit)!==money||
          zeroMinor(ledger[0].Debit)!==0||
          signedMinor(customer['Current Due'])!==e.customerDueAfterMinor||
          signedMinor(ledger[0].Balance)!==e.customerDueAfterMinor)
        return false;
    }else return false;
    return true;
  }catch(error){return false;}
}

/**
 * SHA-256 fingerprint of the FULL server-validated single-source refund
 * intent. Stable operation ID binds network retries, while return ID is
 * generated by the server and stored as a receipt in the journal.
 * Caller, not the browser, must derive actor/quantity/price/period from
 * authenticated original invoice and its own validated request.
 */
function buildFundedReturnIntentHash_(request) {
  if (!request || !Array.isArray(request.lines) || request.lines.length!==1)
    throw new Error('A single source product is required for this refund intent.');
  const op=String(request.operationId||''),actor=String(request.actor||'');
  const invoice=String(request.invoiceId||''),customer=String(request.customerId||'');
  const date=String(request.date||'');
  if (!/^[A-Za-z0-9_-]{12,100}$/.test(op)||!actor||!invoice||
      !/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new Error('Invalid authorized refund operation, actor or date.');
  if (request.refundMethod!=='Cash' && request.refundMethod!=='Store Credit')
    throw new Error('Invalid refund method.');
  function cents(value) {
    const n=Number(value),raw=n*100;
    if (value===null||value===undefined||value===''||
        !Number.isFinite(raw)||n<0||
        !Number.isSafeInteger(Math.round(raw))||
        Math.abs(raw-Math.round(raw))>0.0000001)
      throw new Error('Invalid refund money or price precision in paisa.');
    return Math.round(raw);
  }
  const line=request.lines[0]||{};
  const productId=String(line.productId||'');
  const sourceSaleProductId=String(line.sourceSaleProductId||'');
  if (!productId||!sourceSaleProductId)
    throw new Error('Missing original source product.');
  const scale=Number(line.quantityScale),qty=Number(line.quantity);
  const ticks=scale*qty;
  if (!Number.isSafeInteger(scale)||scale<=0||scale>1000000||
      !Number.isFinite(qty)||qty<=0||
      !Number.isSafeInteger(Math.round(ticks))||
      Math.abs(Math.round(ticks)-ticks)>0.0000001)
    throw new Error('Invalid return quantity precision.');
  const canonical=JSON.stringify({
    version:1,operationId:op,actor:actor,invoiceId:invoice,
    customerId:customer,date:date,
    backdatedReason:String(request.backdatedReason||''),
    refundMethod:request.refundMethod,
    refundMinor:cents(request.refundAmount),
    reason:String(request.reason||''),notes:String(request.notes||''),
    line:{productId:productId,sourceSaleProductId:sourceSaleProductId,
      quantityScale:scale,quantityTicks:Math.round(ticks),
      returnUnitPriceMinor:cents(line.returnUnitPrice)}
  });
  const digest=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,canonical);
  return 'sha256:'+Array.prototype.map.call(digest,function(byte){
    return ('0'+(byte&255).toString(16)).slice(-2);
  }).join('');
}
