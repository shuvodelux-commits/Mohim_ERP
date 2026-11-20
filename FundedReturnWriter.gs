/**
 * Mohim_ERP Task 5C3B2B — explicitly disabled native source-linked funded
 * Sales Return posting. Only one actual physical product from ONE original
 * OVERSOLD source lot per return; no mixed carts, kit/bundle/split-payment,
 * unpriced sources, auto-created Store Credit customer or edits/deletes.
 *
 * MUST be invoked inside completeReturn()'s ScriptLock after returns:add,
 * Cash Session and server date validation, and only if both code AND tenant
 * opt-in flags are active. Neither production flag is enabled in this PR.
 * Unknown writes are NEVER rolled back or automatically repeated.
 */
function fundedReturnWriterEnabled_() {
  return CONFIG.FUNDED_RETURN_WRITER_RELEASE_APPROVED === true &&
    String(getSettingsMap_()['Funded Oversold Return Enabled']||'').toLowerCase()==='true';
}

function maybeCompleteFundedOversoldReturn_(payload,ctx) {
  if (!fundedReturnWriterEnabled_()) return null;
  const schema=fundedSaleReturnSchemaReady_();
  if (!schema.ready) throw new Error('Funded return setup incomplete: '+schema.reason+'; Needs Review.');
  // Load provenance only once after preflight. A normal, never-funded return
  // continues down the legacy path with no semantic changes.
  const invoice=String(payload&&payload.invoiceId||'');
  const sourceRows=getAllRows_('SALE_ITEM_LOTS').filter(function(r){return String(r['Invoice ID'])===invoice;});
  const settlementRows=getAllRows_('STOCK_LOT_SETTLEMENTS');
  const requested={};
  (payload.items||[]).forEach(function(item){requested[String(item.productId||'')]=true;});
  const sourceLots={};
  sourceRows.forEach(function(s){
    const sourceSaleId=String(s['Source Sale Product ID']||s['Product ID']||'');
    if (requested[sourceSaleId]) sourceLots[String(s['Lot ID'])]=true;
  });
  const funded=settlementRows.some(function(r){
    return sourceLots[String(r['Oversold Lot ID'])];
  });
  if (!funded) return null;
  if (ctx.isSplitReturn || !payload || !Array.isArray(payload.items) || payload.items.length!==1)
    throw new Error('Funded OVERSOLD returns currently require one ordinary physical item, without split payment or batch. Needs Review.');
  return createFundedOversoldReturn_(payload,ctx,sourceRows,settlementRows);
}

function createFundedOversoldReturn_(payload,ctx,sourceRows,settlementRows) {
  const op=String(payload.operationId||'');
  if (!/^[A-Za-z0-9_-]{12,100}$/.test(op))
    throw new Error('Stable funded-return operation ID is required; Needs Review.');
  const prepared=prepareSalesReturn_(payload,{txDate:ctx.txDate,skipPhysicalRestoration:true,requireExistingCustomer:true});
  if (prepared.validatedItems.length!==1 || prepared.validatedItems[0].productType!=='Standard' ||
      prepared.needsCustomerResolution ||
      (prepared.refundMethod==='Store Credit' && !prepared.creditCustomer))
    throw new Error('Funded return requires one existing real product and known Store Credit customer. Needs Review.');
  const line=prepared.validatedItems[0],productId=line.productId;
  const sources=sourceRows.filter(function(r){return String(r['Product ID'])===String(productId);});
  const matched=sources.filter(function(row){
    return settlementRows.some(function(evt){return String(evt['Oversold Lot ID'])===String(row['Lot ID']);});
  });
  if (matched.length!==1 || sources.length!==1)
    throw new Error('Ambiguous original sale-item funding source; Needs Review.');
  const actor=String(ctx.actingUser['User ID']||actorName_(ctx.actingUser));
  const hash=buildFundedReturnIntentHash_({
    operationId:op,actor:actor,invoiceId:prepared.invoiceId,
    customerId:prepared.customerId,date:prepared.dateStr,
    backdatedReason:prepared.txDate.reason,
    refundMethod:prepared.refundMethod,refundAmount:prepared.totalReturnAmount,
    reason:prepared.reason,notes:prepared.notes,
    lines:[{productId:productId,sourceSaleProductId:productId,
      quantity:line.qty,quantityScale:1000000,returnUnitPrice:line.price}]
  });
  const journalRows=getAllRows_('FUNDED_RETURN_JOURNAL');
  if (journalRows.some(function(row){return String(row['Operation ID'])===op;})) {
    // A committed receipt cannot be replayed from one incomplete source
    // snapshot after later legitimate stock movement. Manual reconciliation
    // is safer than a second Cash payout or duplicate Store Credit.
    throw new Error('Original funded-return operation already exists. Needs Review; do not repay.');
  }
  const returnId=generateId_('SALES_RETURN');
  const intent={operationId:op,returnId:returnId,invoiceId:prepared.invoiceId,
    productId:productId,actor:actor,fingerprint:hash};
  if (fundedReturnJournalDecision_(intent,journalRows).status!=='NEW')
    throw new Error('Prior funded-return journal requires reconciliation. Needs Review.');
  const saleItemLots=getAllRows_('SALE_ITEM_LOTS');
  const stockLots=getAllRows_('STOCK_LOTS');
  const products=getAllRows_('PRODUCTS');
  const sourcePlans=planFundedOversoldSaleReturn_({
    invoiceId:prepared.invoiceId,productId:productId,sourceSaleProductId:productId,
    operationId:op,returnId:returnId,returnQty:line.qty,quantityScale:1000000,
    products:products,saleItemLots:saleItemLots,stockLots:stockLots,
    settlements:settlementRows,purchaseJournals:getAllRows_('PURCHASE_SETTLEMENT_JOURNAL'),
    purchases:getAllRows_('PURCHASES'),
    reversals:getAllRows_('STOCK_LOT_SETTLEMENT_REVERSALS'),
    returnJournals:journalRows,returnReceipts:getAllRows_('SALES_RETURN')
  });
  if (sourcePlans.status!=='READY' || sourcePlans.reversalEvents.length===0)
    throw new Error('Funded return source is unverified or only unfunded stock remains; '+
      sourcePlans.issues.join(',')+'; Needs Review.');
  // Validate all source ledger identities before writing anything.
  const product=products.filter(function(p){return String(p['Product ID'])===String(productId);});
  if (product.length!==1 || !Number.isInteger(product[0]._rowIndex))
    throw new Error('Invalid product stock source. Needs Review.');
  const customer=prepared.refundMethod==='Store Credit'?prepared.creditCustomer:null;
  const newDue=customer?roundMoney_((Number(customer['Current Due'])||0)-prepared.totalReturnAmount):null;
  if (customer && (!Number.isFinite(newDue)||!Number.isInteger(customer._rowIndex)))
    throw new Error('Invalid customer balance. Needs Review.');
  const now=new Date(),scale=1000000;
  let reserved=false;
  const reversalIds=[];
  function stage(name){
    const status=advanceFundedReturnJournal_(intent,name);
    if(status.status!=='WRITING')throw new Error('Funded return stage '+name+' uncertain. Needs Review.');
  }
  try {
    const r=reserveFundedReturnJournal_(intent);
    if(r.status!=='WRITING')return fail_('Funded return journal reservation uncertain. Needs Review; do not retry.');
    reserved=true;
    appendRow_('SALES_RETURN',{
      'Return ID':returnId,Date:prepared.dateStr,'Invoice ID':prepared.invoiceId,
      'Customer ID':prepared.customerId,'Customer Name':prepared.sale['Customer Name'],
      'Customer Phone':prepared.sale['Customer Phone'],
      'Refund Method':prepared.refundMethod,'Total Return Amount':prepared.totalReturnAmount,
      Reason:prepared.reason,Notes:prepared.notes,'Processed By':actorName_(ctx.actingUser),
      'Created At':now,'Is Backdated':prepared.txDate.isBackdated,
      'Backdated Days':prepared.txDate.backdatedDays,
      'Backdated Reason':prepared.txDate.reason,'Batch ID':'','Return Operation ID':op
    });
    stage('Return Header');
    updateRowFields_('PRODUCTS',product[0]._rowIndex,{
      'Current Stock':sourcePlans.productStockAfterTicks/scale,'Updated At':now
    });
    sourcePlans.debtUpdates.concat(sourcePlans.purchaseLotUpdates).forEach(function(ch){
      updateRowFields_('STOCK_LOTS',ch.rowIndex,{
        'Remaining Quantity':ch.afterTicks/scale,Status:ch.statusAfter
      });
    });
    const link=matched[0];
    updateRowFields_('SALE_ITEM_LOTS',sourcePlans.saleItemRowIndex,{
      Quantity:sourcePlans.saleItemQtyAfterTicks/scale,
      'Return Consumption Link ID':String(link['Return Consumption Link ID']||op)
    });
    stage('Stock And Source Lots');
    sourcePlans.reversalEvents.forEach(function(e){
      const revId=generateId_('STOCK_LOT_SETTLEMENT_REVERSALS');
      reversalIds.push(revId);
      appendRow_('STOCK_LOT_SETTLEMENT_REVERSALS',{
        'Reversal ID':revId,'Return Operation ID':op,'Return ID':returnId,
        'Settlement ID':e.settlementId,'Source Invoice ID':e.sourceInvoiceId,
        'Source Sale Product ID':e.sourceSaleProductId,'Product ID':productId,
        'Oversold Lot ID':e.oversoldLotId,'Purchase Lot ID':e.purchaseLotId,
        'Quantity Ticks':e.quantityTicks,'Quantity Scale':e.quantityScale,
        'Provisional Unit Cost Minor':e.provisionalUnitCostMinor,
        'Actual Unit Cost Minor':e.actualUnitCostMinor,
        'Provisional Returned Cost Minor':e.provisionalReturnedCostMinor,
        'Actual Returned Cost Minor':e.actualReturnedCostMinor,
        'Cogs Delta Reversal Minor':e.cogsDeltaReversalMinor,
        State:'Writing','Created At':now,Actor:actor
      });
    });
    stage('Reversal Events');
    appendRow_('SALES_RETURN_ITEMS',{
      'Return ID':returnId,'Invoice ID':prepared.invoiceId,'Product ID':productId,
      'Product Name':line.name,'Return Quantity':line.qty,
      'Return Price':line.price,'Line Total':line.lineTotal,
      'Pricing Basis':'NetAfterInvoiceDiscount','Sold Product Type':'Standard'
    });
    sourcePlans.debtUpdates.concat(sourcePlans.purchaseLotUpdates).forEach(function(ch){
      appendRow_('STOCK_MOVEMENT',{
        'Movement ID':generateId_('STOCK_MOVEMENT'),Date:now,'Product ID':productId,
        'Product Name':line.name,Type:'Sales Return',Reference:returnId,
        'Quantity In':(ch.afterTicks-ch.beforeTicks)/scale,'Quantity Out':'',
        'Balance Stock':sourcePlans.productStockAfterTicks/scale,Notes:'',
        'Lot ID':ch.lotId,'Source Sale Product ID':productId,
        'Source Consumption Link ID':String(link['Return Consumption Link ID']||op)
      });
    });
    stage('Return Items And Movement');
    if(prepared.refundMethod==='Cash'){
      addCashBookEntry_({Type:'Sales Return',Reference:returnId,
        Description:'Cash refund for '+prepared.invoiceId,
        Debit:prepared.totalReturnAmount,Credit:'',PaymentMethod:'Cash',Date:prepared.dateStr});
    } else {
      updateRowFields_('CUSTOMERS',customer._rowIndex,{'Current Due':newDue});
      appendRow_('CUSTOMER_LEDGER',{
        'Ledger ID':generateId_('CUSTOMER_LEDGER'),Date:prepared.dateStr,
        'Customer ID':prepared.customerId,'Customer Name':customer['Customer Name'],
        Type:'Sales Return Credit',Reference:returnId,Debit:'',
        Credit:prepared.totalReturnAmount,Balance:newDue,
        Notes:'Store credit for return '+returnId,
        'Created By':actorName_(ctx.actingUser),'Created At':now
      });
    }
    stage('Refund');
    reversalIds.forEach(function(id){
      const row=findRowIndex_('STOCK_LOT_SETTLEMENT_REVERSALS','Reversal ID',id);
      if(row<2)throw new Error('Missing reversal receipt ID. Needs Review.');
      updateRowFields_('STOCK_LOT_SETTLEMENT_REVERSALS',row,{State:'Committed'});
    });
    const expected={
      returnId:returnId,operationId:op,invoiceId:prepared.invoiceId,
      productId:productId,actor:actor,sourceSaleProductId:productId,
      oldDebtLotId:sourcePlans.debtUpdates[0]?sourcePlans.debtUpdates[0].lotId:
        sourcePlans.reversalEvents[0].oversoldLotId,
      saleItemLotAfterTicks:sourcePlans.saleItemQtyAfterTicks,
      returnQtyTicks:sourcePlans.stockQtyDeltaTicks,quantityScale:scale,
      stockAfterTicks:sourcePlans.productStockAfterTicks,
      refundMethod:prepared.refundMethod,refundMinor:Math.round(prepared.totalReturnAmount*100),
      customerId:prepared.customerId,customerDueAfterMinor:newDue===null?0:Math.round(newDue*100),
      debtUpdates:sourcePlans.debtUpdates,
      purchaseLotUpdates:sourcePlans.purchaseLotUpdates,
      reversalEvents:sourcePlans.reversalEvents
    };
    const status=commitFundedReturnJournal_(intent,function(receiptId){
      return String(receiptId)===returnId && verifyFundedReturnReceipt_({
        expected:expected,returns:getAllRows_('SALES_RETURN'),
        returnItems:getAllRows_('SALES_RETURN_ITEMS'),
        products:getAllRows_('PRODUCTS'),saleItemLots:getAllRows_('SALE_ITEM_LOTS'),
        stockLots:getAllRows_('STOCK_LOTS'),originalSettlements:getAllRows_('STOCK_LOT_SETTLEMENTS'),
        reversals:getAllRows_('STOCK_LOT_SETTLEMENT_REVERSALS'),
        movements:getAllRows_('STOCK_MOVEMENT'),cashRows:getAllRows_('CASH_BOOK'),
        customers:getAllRows_('CUSTOMERS'),customerLedger:getAllRows_('CUSTOMER_LEDGER')
      });
    });
    if(status.status!=='COMMITTED')throw new Error('Funded return source receipt failed readback. Needs Review.');
    return ok_({returnId:returnId,totalReturnAmount:prepared.totalReturnAmount,
      customerId:prepared.customerId,newDue:newDue});
  } catch(error) {
    if(reserved)markFundedReturnNeedsReview_(intent,String(error&&error.message||error));
    return fail_('Funded Sales Return interrupted. Needs Review; never pay twice. '+String(error&&error.message||error));
  }
}
