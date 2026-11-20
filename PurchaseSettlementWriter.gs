/**
 * Mohim_ERP GAS Task 5C2 — opt-in native purchase settlement writer.
 *
 * OFF BY DEFAULT: both CONFIG.PURCHASE_SETTLEMENT_WRITER_RELEASE_APPROVED
 * and a tenant Settings opt-in must be true. The release flag MUST stay
 * false until accounting/return rules, copied-Sheets preview and an
 * independent audit are complete.
 *
 * Calls execute inside createPurchase()'s EXISTING ScriptLock and after
 * its ordinary supplier/product/payment validation. No second lock.
 * It uses existing appendRow_/updateRowFields_ and Cash/Bank/Supplier
 * posting paths. A persistent Writing journal ALWAYS precedes the first
 * purchase/stock/financial write. Google Sheets has no transaction rollback;
 * an unknown write result blocks retry and demands source reconciliation.
 */
function isPurchaseSettlementWriterEnabled_() {
  return CONFIG.PURCHASE_SETTLEMENT_WRITER_RELEASE_APPROVED === true &&
    String(getSettingsMap_()['Oversold Purchase Settlement Writer Enabled']||'').toLowerCase()==='true';
}

function purchaseSettlementWriteMoneyMinor_(value) {
  const n=Number(value), scaled=n*100;
  if (value==='' || value===null || value===undefined || !Number.isFinite(n) ||
      n<0 || !Number.isSafeInteger(Math.round(scaled)) ||
      Math.abs(scaled-Math.round(scaled))>0.0000001)
    throw new Error('Money must be an exact nonnegative paisa amount. Needs Review.');
  return Math.round(scaled);
}

function purchaseSettlementWriteSnapshot_() {
  return {
    purchases:getAllRows_('PURCHASES'),
    purchaseItems:getAllRows_('PURCHASE_ITEMS'),
    products:getAllRows_('PRODUCTS'),
    stockLots:getAllRows_('STOCK_LOTS'),
    movements:getAllRows_('STOCK_MOVEMENT'),
    settlements:getAllRows_('STOCK_LOT_SETTLEMENTS'),
    cashRows:getAllRows_('CASH_BOOK'),
    bankRows:getAllRows_('BANK_BOOK'),
    suppliers:getAllRows_('SUPPLIERS'),
    supplierLedger:getAllRows_('SUPPLIER_LEDGER')
  };
}

function purchaseSettlementWriteReceiptExpected_(input,batch,offset,lotByProduct,supplierDueAfter) {
  const lines=input.lines,quantityScale=1000000;
  return {
    purchaseId:batch.purchaseId,operationId:batch.operationId,
    date:input.dateStr,supplierId:input.supplierRow['Supplier ID'],
    actor:batch.actor,
    subtotalMinor:purchaseSettlementWriteMoneyMinor_(input.subtotal),
    discountMinor:purchaseSettlementWriteMoneyMinor_(input.discount),
    grandTotalMinor:purchaseSettlementWriteMoneyMinor_(input.grandTotal),
    paidMinor:purchaseSettlementWriteMoneyMinor_(input.paidAmount),
    dueMinor:purchaseSettlementWriteMoneyMinor_(input.dueAmount),
    method:input.paymentMethod,bankAccountId:input.bankAccountId,
    supplierDueAfterMinor:purchaseSettlementWriteMoneyMinor_(supplierDueAfter),
    lines:lines.map(function(line) {
      const plan=batch.lines.filter(function(x){return x.productId===line.productId;})[0];
      const newLot=offset.newPurchaseLots.filter(function(x){return x.productId===line.productId;})[0];
      if (!plan || !newLot || newLot.lotId!==lotByProduct[line.productId])
        throw new Error('Missing prepared stock lot source. Needs Review.');
      return {
        productId:line.productId,productName:line.name,
        quantityTicks:plan.quantityTicks,quantityScale:quantityScale,
        unitCostMinor:purchaseSettlementWriteMoneyMinor_(line.price),
        sellPriceMinor:purchaseSettlementWriteMoneyMinor_(line.sellPrice),
        lotId:newLot.lotId,availableQtyTicks:newLot.availableQtyTicks,
        stockAfterTicks:plan.productStockAfterTicks
      };
    }),
    allocations:offset.settlementEvents.map(function(a) {
      return {
        productId:a.productId,purchaseLotId:a.newPurchaseLotId,
        oversoldLotId:a.oversoldLotId,sourceInvoiceId:a.sourceInvoiceId,
        sourceSaleProductId:a.sourceSaleProductId,
        settledQtyTicks:a.settledQtyTicks,quantityScale:a.quantityScale,
        provisionalUnitCostMinor:a.provisionalUnitCostMinor,
        actualUnitCostMinor:a.actualUnitCostMinor,
        provisionalCOGSMinor:a.provisionalCOGSMinor,
        actualCOGSMinor:a.actualCOGSMinor,
        favorableVarianceMinor:a.favorableVarianceMinor
      };
    }),
    oldDebtUpdates:offset.oldDebtUpdates.map(function(u){
      return {lotId:u.lotId,afterTicks:u.afterTicks};
    })
  };
}

function purchaseSettlementReplayVerified_(intent,context) {
  const purchaseId=intent.purchaseId;
  const snapshot=purchaseSettlementWriteSnapshot_();
  const original=snapshot.purchases.filter(function(r){
    return String(r['Purchase ID'])===String(purchaseId);
  });
  if (original.length!==1) return false;
  const header=original[0];
  const lots=snapshot.stockLots.filter(function(r){
    return String(r['Purchase ID'])===String(purchaseId);
  });
  const movement=snapshot.movements.filter(function(r){
    return String(r.Reference)===String(purchaseId) && String(r.Type)==='Purchase';
  });
  if (lots.length!==context.lines.length || movement.length!==context.lines.length) return false;
  const originalEvents=snapshot.settlements.filter(function(r){
    return String(r['Purchase ID'])===String(purchaseId);
  });
  if (originalEvents.some(function(r){
    return String(r['Operation ID'])!==String(intent.operationId) ||
      String(r.State)!=='Committed';
  })) return false;
  // This stringent replay proof is deliberately conservative: future
  // purchases/sales may change current balances, in which case operator
  // review is safer than re-posting an otherwise legitimate purchase.
  const verifiedLines=context.lines.map(function(line) {
    const lot=lots.filter(function(r){return String(r['Product ID'])===line.productId;});
    const m=movement.filter(function(r){return String(r['Product ID'])===line.productId;});
    if (lot.length!==1 || m.length!==1) return null;
    return {
      productId:line.productId,productName:line.name,
      quantityTicks:Math.round(line.qty*1000000),quantityScale:1000000,
      unitCostMinor:purchaseSettlementWriteMoneyMinor_(line.price),
      sellPriceMinor:purchaseSettlementWriteMoneyMinor_(line.sellPrice),
      lotId:lot[0]['Lot ID'],
      availableQtyTicks:Math.round(Number(lot[0]['Remaining Quantity'])*1000000),
      stockAfterTicks:Math.round(Number(m[0]['Balance Stock'])*1000000)
    };
  });
  if (verifiedLines.some(function(line){return !line;})) return false;
  const allocations=originalEvents.map(function(a) {
    return {
      productId:String(a['Product ID']),purchaseLotId:String(a['Purchase Lot ID']),
      oversoldLotId:String(a['Oversold Lot ID']),
      sourceInvoiceId:String(a['Source Invoice ID']),
      sourceSaleProductId:String(a['Source Sale Product ID']),
      settledQtyTicks:Number(a['Quantity Ticks']),quantityScale:Number(a['Quantity Scale']),
      provisionalUnitCostMinor:Number(a['Provisional Unit Cost Minor']),
      actualUnitCostMinor:Number(a['Actual Unit Cost Minor']),
      provisionalCOGSMinor:Number(a['Provisional COGS Minor']),
      actualCOGSMinor:Number(a['Actual COGS Minor']),
      favorableVarianceMinor:Number(a['Favorable Variance Minor'])
    };
  });
  const oldDebtUpdates=allocations.map(function(a) {
    const lot=snapshot.stockLots.filter(function(r){return String(r['Lot ID'])===a.oversoldLotId;})[0];
    return {lotId:a.oversoldLotId,afterTicks:lot?Math.round(Number(lot['Remaining Quantity'])*a.quantityScale):null};
  });
  const supp=snapshot.suppliers.filter(function(r){
    return String(r['Supplier ID'])===String(context.supplierRow['Supplier ID']);
  });
  if (supp.length!==1) return false;
  const expected={
    purchaseId:purchaseId,operationId:intent.operationId,
    date:context.dateStr,supplierId:context.supplierRow['Supplier ID'],actor:intent.actor,
    subtotalMinor:purchaseSettlementWriteMoneyMinor_(context.subtotal),
    discountMinor:purchaseSettlementWriteMoneyMinor_(context.discount),
    grandTotalMinor:purchaseSettlementWriteMoneyMinor_(context.grandTotal),
    paidMinor:purchaseSettlementWriteMoneyMinor_(context.paidAmount),
    dueMinor:purchaseSettlementWriteMoneyMinor_(context.dueAmount),
    method:context.paymentMethod,bankAccountId:context.bankAccountId,
    supplierDueAfterMinor:purchaseSettlementWriteMoneyMinor_(supp[0]['Current Due']),
    lines:verifiedLines,allocations:allocations,oldDebtUpdates:oldDebtUpdates
  };
  return verifyPurchaseSettlementReceipt_(Object.assign({expected:expected},snapshot));
}

function createPurchaseWithSettlement_(payload,context) {
  const op=String(payload.operationId||'');
  if (!/^[A-Za-z0-9_-]{12,100}$/.test(op))
    throw new Error('Unique purchase operation ID required for audited settlement. Needs Review.');
  const actor=String(context.actingUser['User ID']||actorName_(context.actingUser));
  const scale=1000000;
  const hash=buildPurchaseSettlementIntentHash_({
    operationId:op,actor:actor,supplierId:payload.supplierId,date:context.dateStr,
    backdatedReason:context.txDate.reason,
    lines:context.lines.map(function(line) {
      return {productId:line.productId,quantity:line.qty,quantityScale:scale,
        unitCost:line.price,sellingPrice:line.sellPrice};
    }),
    payment:{discount:context.discount,paidAmount:context.paidAmount,
      paymentMethod:context.paymentMethod,bankAccountId:context.bankAccountId,
      notes:sanitizeInput_(payload.notes)}
  });
  // Database.gs:getSheet_ creates missing Sheets while reading; check
  // existence and exact headers *without* invoking that helper first.
  const schema=purchaseSettlementWriterSchemaReady_();
  if (!schema.ready) throw new Error('Purchase settlement setup required ('+schema.reason+'). Needs Review.');
  const prior=getAllRows_('PURCHASE_SETTLEMENT_JOURNAL');
  const matches=prior.filter(function(r){return String(r['Operation ID'])===op;});
  if (matches.length>1) throw new Error('Duplicate purchase operation evidence. Needs Review.');
  if (matches.length===1) {
    const intent={operationId:op,purchaseId:String(matches[0]['Purchase ID']),
      actor:actor,fingerprint:hash,productIds:context.lines.map(function(l){return l.productId;})};
    const result=purchaseSettlementJournalDecision_(intent,prior,function(){
      return purchaseSettlementReplayVerified_(intent,context);
    });
    if (result.status!=='REPLAY')
      throw new Error('Purchase retry interrupted or conflicting. Needs Review ('+
        result.issues.join(',')+'). Do not submit a new purchase.');
    const existing=getAllRows_('PURCHASES').filter(function(r){
      return String(r['Purchase ID'])===intent.purchaseId;
    })[0];
    return ok_({purchaseId:intent.purchaseId,
      grandTotal:Number(existing['Grand Total']),dueAmount:Number(existing['Due Amount'])});
  }

  // If any previous purchase is pending or Needs Review, its supplier
  // balance and affected stock are ambiguous: no new posting is allowed.
  if (prior.some(function(j){return String(j.State)!=='Committed';}))
    throw new Error('Another purchase has an interrupted journal. Needs Review before new posting.');

  const purchaseId=generateId_('PURCHASES');
  const intent={operationId:op,purchaseId:purchaseId,actor:actor,fingerprint:hash,
    productIds:context.lines.map(function(line){return line.productId;})};
  const stockLots=getAllRows_('STOCK_LOTS');
  const settlementHistory=getAllRows_('STOCK_LOT_SETTLEMENTS');
  const batch=prepareOversoldPurchaseBatch_({
    operationId:op,purchaseId:purchaseId,date:context.dateStr,
    actor:actor,supplierId:payload.supplierId,
    lines:context.lines.map(function(l) {
      return {productId:l.productId,quantity:l.qty,unitCost:l.price,quantityScale:scale};
    }),
    products:Object.keys(context.productsById).map(function(id){return context.productsById[id];}),
    stockLots:stockLots,sales:getAllRows_('SALES'),
    saleItemLots:getAllRows_('SALE_ITEM_LOTS'),
    settlementHistory:settlementHistory,operationJournal:prior
  });
  if (batch.status!=='READY')
    throw new Error('Purchase stock source needs reconciliation ('+
      batch.issues.join(',')+'). Needs Review.');

  const lotIds={};
  context.lines.forEach(function(line){lotIds[line.productId]=generateId_('STOCK_LOTS');});
  const offset=buildOversoldPurchaseOffsetSet_(batch,lotIds,stockLots);
  if (offset.status!=='READY') throw new Error('Stock offsets not safe ('+offset.issues.join(',')+'). Needs Review.');
  const supplierBefore=Number(context.supplierRow['Current Due'])||0;
  const dueAfter=supplierBefore+context.dueAmount;
  if (!Number.isFinite(dueAfter)) throw new Error('Invalid supplier balance. Needs Review.');
  const receiptExpected=purchaseSettlementWriteReceiptExpected_(context,batch,offset,lotIds,dueAfter);
  let reserved=false;
  function stage_(stage) {
    const result=advancePurchaseSettlementJournal_(intent,stage);
    if (result.status!=='WRITING') throw new Error('Purchase journal stage uncertain ('+stage+'). Needs Review.');
  }
  try {
    const reservation=reservePurchaseSettlementJournal_(intent);
    if (reservation.status!=='WRITING') {
      return fail_('Purchase journal reservation uncertain. Needs Review; do not resubmit as a new purchase.');
    }
    reserved=true;
    const now=context.now;
    appendRow_('PURCHASES',{
      'Purchase ID':purchaseId,Date:context.dateStr,'Supplier ID':payload.supplierId,
      'Supplier Name':context.supplierRow['Supplier Name'],
      Subtotal:context.subtotal,Discount:context.discount,
      'Grand Total':context.grandTotal,'Paid Amount':context.paidAmount,
      'Due Amount':context.dueAmount,'Payment Status':context.paymentStatus,
      Notes:sanitizeInput_(payload.notes),
      'Payment Method':context.paymentMethod,'Bank Account ID':context.bankAccountId,
      'Bank Account Name':context.bankAccountName,
      'Created By':actorName_(context.actingUser),'Created At':now,
      'Is Backdated':context.txDate.isBackdated,'Backdated Days':context.txDate.backdatedDays,
      'Backdated Reason':context.txDate.reason
    });
    stage_('Purchase Header');

    // Original native purchase stock increase +Q exactly once per product.
    // Source-linked settlement has net stock delta ZERO.
    context.lines.forEach(function(line) {
      const newLot=offset.newPurchaseLots.filter(function(x){return x.productId===line.productId;})[0];
      updateRowFields_('PRODUCTS',line.rowIndex,{
        'Current Stock':line.newStock,'Selling Price':line.sellPrice,'Updated At':now
      });
      appendRow_('STOCK_LOTS',{
        'Lot ID':newLot.lotId,'Product ID':line.productId,'Product Name':line.name,
        'Purchase ID':purchaseId,'Purchase Date':context.dateStr,
        'Purchase Price':line.price,'Sell Price':line.sellPrice,
        'Original Quantity':line.qty,'Remaining Quantity':newLot.availableQtyTicks/scale,
        Status:newLot.statusAfter,'Created At':now,
        'Supplier ID':payload.supplierId,'Supplier Name':context.supplierRow['Supplier Name']
      });
    });
    offset.oldDebtUpdates.forEach(function(u) {
      const old=stockLots.filter(function(r){return String(r['Lot ID'])===String(u.lotId);});
      if (old.length!==1 || !Number.isInteger(old[0]._rowIndex))
        throw new Error('Old OVERSOLD source row is ambiguous. Needs Review.');
      updateRowFields_('STOCK_LOTS',old[0]._rowIndex,{
        'Remaining Quantity':u.afterTicks/u.quantityScale,
        Status:u.statusAfter
      });
    });
    stage_('Stock And Lots');

    const settlementIds=[];
    offset.settlementEvents.forEach(function(evt){
      const id=generateId_('STOCK_LOT_SETTLEMENTS');
      settlementIds.push(id);
      appendRow_('STOCK_LOT_SETTLEMENTS',{
        'Settlement ID':id,'Operation ID':op,'Product ID':evt.productId,
        'Purchase ID':purchaseId,'Purchase Lot ID':evt.newPurchaseLotId,
        'Oversold Lot ID':evt.oversoldLotId,'Source Invoice ID':evt.sourceInvoiceId,
        'Source Sale Product ID':evt.sourceSaleProductId,
        'Quantity Ticks':evt.settledQtyTicks,'Quantity Scale':evt.quantityScale,
        'Provisional Unit Cost Minor':evt.provisionalUnitCostMinor,
        'Actual Unit Cost Minor':evt.actualUnitCostMinor,
        'Provisional COGS Minor':evt.provisionalCOGSMinor,
        'Actual COGS Minor':evt.actualCOGSMinor,
        'Favorable Variance Minor':evt.favorableVarianceMinor,
        State:'Writing','Created At':now,Actor:actor
      });
    });
    stage_('Settlement Events');

    appendRows_('PURCHASE_ITEMS',context.lines.map(function(line) {
      return {
        'Purchase ID':purchaseId,'Product ID':line.productId,
        'Product Name':line.name,Quantity:line.qty,'Unit Price':line.price,
        'Sell Price':line.sellPrice,'Line Total':line.qty*line.price
      };
    }));
    stage_('Purchase Items');
    appendRows_('STOCK_MOVEMENT',context.lines.map(function(line){
      return {
        'Movement ID':generateId_('STOCK_MOVEMENT'),Date:now,
        'Product ID':line.productId,'Product Name':line.name,
        Type:'Purchase',Reference:purchaseId,
        'Quantity In':line.qty,'Quantity Out':'','Balance Stock':line.newStock,
        Notes:'','Lot ID':lotIds[line.productId]
      };
    }));
    stage_('Stock Movements');
    if (context.paidAmount>0 && isBankLikePaymentMethod_(context.paymentMethod)) {
      addBankBookEntry_(context.bankAccountId,{
        Type:'Purchase Payment',Reference:purchaseId,
        Description:'Payment to '+context.supplierRow['Supplier Name'],
        Debit:context.paidAmount,Credit:'',Date:context.dateStr
      });
    } else if (context.paidAmount>0) {
      addCashBookEntry_({
        Type:'Purchase Payment',Reference:purchaseId,
        Description:'Payment to '+context.supplierRow['Supplier Name'],
        Debit:context.paidAmount,Credit:'',
        PaymentMethod:'Cash',Date:context.dateStr
      });
    }
    stage_('Payments');
    if (context.dueAmount>0) {
      const supplierRowIndex=findRowIndex_('SUPPLIERS','Supplier ID',payload.supplierId);
      if (supplierRowIndex<2) throw new Error('Supplier evidence missing. Needs Review.');
      updateRowFields_('SUPPLIERS',supplierRowIndex,{'Current Due':dueAfter});
      appendRow_('SUPPLIER_LEDGER',{
        'Ledger ID':generateId_('SUPPLIER_LEDGER'),Date:context.dateStr,
        'Supplier ID':payload.supplierId,
        'Supplier Name':context.supplierRow['Supplier Name'],
        Type:'Purchase',Reference:purchaseId,Debit:context.dueAmount,
        Credit:'',Balance:dueAfter,Notes:'',
        'Is Backdated':context.txDate.isBackdated,
        'Backdated Days':context.txDate.backdatedDays,
        'Backdated Reason':context.txDate.reason,
        'Created By':actorName_(context.actingUser),'Created At':now
      });
    }
    stage_('Supplier Due');

    // Finalize all source-linked allocation events only after the entire
    // money/stock purchase was written. If this status update is unknown,
    // the Writing journal still blocks any repeat purchase automatically.
    settlementIds.forEach(function(id) {
      const rowIndex=findRowIndex_('STOCK_LOT_SETTLEMENTS','Settlement ID',id);
      if (rowIndex<2) throw new Error('Missing settlement event. Needs Review.');
      updateRowFields_('STOCK_LOT_SETTLEMENTS',rowIndex,{State:'Committed'});
    });
    const committed=commitPurchaseSettlementJournal_(intent,function(receiptId){
      return receiptId===purchaseId && verifyPurchaseSettlementReceipt_(
        Object.assign({expected:receiptExpected},purchaseSettlementWriteSnapshot_())
      );
    });
    if (committed.status!=='COMMITTED')
      throw new Error('Purchase readback cannot be verified. Needs Review.');
    return ok_({purchaseId:purchaseId,grandTotal:context.grandTotal,
      dueAmount:context.dueAmount});
  } catch(err) {
    if (reserved) {
      markPurchaseSettlementNeedsReview_(intent,String(err.message));
      return fail_('Purchase posting interrupted. Needs Review; do not submit a new purchase. '+err.message);
    }
    return fail_('Purchase reservation uncertain. Needs Review; do not blindly retry. '+err.message);
  }
}
