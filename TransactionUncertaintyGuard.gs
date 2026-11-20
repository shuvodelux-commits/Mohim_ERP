/**
 * Task 5C3C: synchronous read-only posting barrier.
 *
 * All financial/stock mutations must call assertNoUncertainTransactionWrites_
 * inside their existing ScriptLock, AFTER authorization and BEFORE the
 * first business write. Unlike getAllRows_ this uses fresh direct Sheet data
 * and does not auto-create/reformat missing journal sheets or trust cache.
 *
 * A prior unknown purchase/return may have committed Product Stock, Customer
 * due, or Cash/Bank but not its receipt. When any journal is ambiguous we
 * freeze subsequent financial writes until an owner-reviewed reconciliation.
 */
function inspectTransactionUncertainty_() {
  const clear=function(){return {safe:true,status:'CLEAR',issues:[]};};
  const blocked=function(issue){return {safe:false,status:'NEEDS_REVIEW',issues:[String(issue)]};};
  try {
    if (!CONFIG || !CONFIG.SHEETS || typeof getSpreadsheet_!=='function')
      return blocked('JOURNAL_READBACK_UNAVAILABLE');
    const ss=getSpreadsheet_();
    // Both halves of the lineage must exist. A deleted event sheet cannot
    // turn a previously funded sale/refund into an apparently clean legacy
    // workbook, even while an optional release flag has since been disabled.
    const pairs=[
      {journal:'PURCHASE_SETTLEMENT_JOURNAL',event:'STOCK_LOT_SETTLEMENTS',
       flag:'PURCHASE_SETTLEMENT_WRITER_RELEASE_APPROVED',receipt:'Purchase ID',
       eventId:'Settlement ID',eventOp:'Operation ID'},
      {journal:'FUNDED_RETURN_JOURNAL',event:'STOCK_LOT_SETTLEMENT_REVERSALS',
       flag:'FUNDED_RETURN_WRITER_RELEASE_APPROVED',receipt:'Return ID',
       eventId:'Reversal ID',eventOp:'Return Operation ID'}
    ];
    function readTable(sheet,required,key) {
      const columns=sheet.getLastColumn(),lastRow=sheet.getLastRow();
      if (!Number.isInteger(columns)||columns<required.length ||
          !Number.isInteger(lastRow)||lastRow<1)
        throw new Error('MALFORMED_JOURNAL_DIMENSIONS_'+key);
      const values=sheet.getRange(1,1,lastRow,columns).getValues();
      if (values.length!==lastRow||!values.length)
        throw new Error('INVALID_JOURNAL_READBACK_'+key);
      const headers=values[0].map(String);
      if (headers.length!==new Set(headers).size ||
          required.some(function(h){return headers.indexOf(h)===-1;}))
        throw new Error('MALFORMED_JOURNAL_HEADER_'+key);
      const indices=required.map(function(h){return headers.indexOf(h);});
      return values.slice(1).filter(function(row){
        return !row.every(function(cell){return cell===''||cell===null||cell===undefined;});
      }).map(function(row){
        return indices.map(function(index){
          const cell=row[index];return cell===null||cell===undefined?'':String(cell);
        });
      });
    }
    for(const pair of pairs) {
      const journalName=CONFIG.SHEETS[pair.journal],eventName=CONFIG.SHEETS[pair.event];
      if (!journalName||!eventName)return blocked('MISSING_LINEAGE_SCHEMA_CONFIG_'+pair.journal);
      const journalSheet=ss.getSheetByName(journalName),eventSheet=ss.getSheetByName(eventName);
      if (!journalSheet||!eventSheet) {
        if (journalSheet||eventSheet||CONFIG[pair.flag]===true)
          return blocked('MISSING_OR_PARTIAL_LINEAGE_SHEETS_'+pair.journal);
        // Original workbook with neither journal nor event Sheet. The
        // offline production release flags must remain disabled.
        continue;
      }
      const journalCols=['Operation ID',pair.receipt,'State','Last Completed Stage','Result Receipt'];
      const eventCols=[pair.eventId,pair.eventOp,pair.receipt,'State'];
      const journals=readTable(journalSheet,journalCols,pair.journal);
      const events=readTable(eventSheet,eventCols,pair.event);
      const byOp=Object.create(null),byReceipt=Object.create(null),eventsByOp=Object.create(null);
      for(const row of journals) {
        const op=row[0],receipt=row[1],state=row[2],stage=row[3],proof=row[4];
        if (!op||!receipt||byOp[op]||byReceipt[receipt] ||
            state!=='Committed'||stage!=='Committed'||proof!==receipt)
          return blocked('UNVERIFIED_OR_DUPLICATE_JOURNAL_'+pair.journal);
        byOp[op]=receipt;byReceipt[receipt]=true;
      }
      const seenEvents=Object.create(null);
      for(const row of events) {
        const eventId=row[0],op=row[1],receipt=row[2],state=row[3];
        if(!eventId||seenEvents[eventId])
          return blocked('DUPLICATE_OR_MISSING_EVENT_ID_'+pair.event);
        seenEvents[eventId]=true;
        if(state!=='Committed')return blocked('UNCOMMITTED_LINEAGE_EVENT_'+pair.event);
        if(!op||!receipt||!byOp[op]||byOp[op]!==receipt)
          return blocked('ORPHAN_OR_MISMATCHED_SOURCE_EVENT_'+pair.event);
        eventsByOp[op]=(eventsByOp[op]||0)+1;
      }
      for(const op of Object.keys(byOp)) {
        if (!eventsByOp[op])
          return blocked('COMMITTED_JOURNAL_MISSING_SOURCE_EVENT_'+pair.journal);
      }
    }
    return clear();
  }catch(error){
    // Only our own fixed validation identifiers may be surfaced; arbitrary
    // SpreadsheetApp error contents (including sheet data) stay private.
    const code=String(error&&error.message||'');
    return blocked(/^MALFORMED_JOURNAL_(?:DIMENSIONS|HEADER)_[A-Z_]+$/.test(code) ||
      /^INVALID_JOURNAL_READBACK_[A-Z_]+$/.test(code)
        ?code:'JOURNAL_LINEAGE_READBACK_UNCERTAIN');
  }
}

function assertNoUncertainTransactionWrites_() {
  const report=inspectTransactionUncertainty_();
  if (!report.safe) throw new Error('Business write blocked: an interrupted transaction needs review; do not retry the sale, return, purchase or refund.');
  return true;
}

/**
 * Source-linked returns/purchase lots may not be manually edited or
 * reversed through a generic editor: that would invalidate immutable actual
 * purchase cost allocations or a committed funded-return cost reversal.
 * Query directly without getSheet_ auto-create and without cached rows.
 */
function hasAuthoritativeSourceLink_(sheetKey,column,id) {
  if (!id || !CONFIG || !CONFIG.SHEETS || !CONFIG.SHEETS[sheetKey]) return false;
  try {
    const sheet=getSpreadsheet_().getSheetByName(CONFIG.SHEETS[sheetKey]);
    if (!sheet)return false; // legacy workbook with no settlement writer
    const lastColumn=sheet.getLastColumn(),lastRow=sheet.getLastRow();
    if (!Number.isInteger(lastColumn)||lastColumn<2||
        !Number.isInteger(lastRow)||lastRow<1)throw new Error('Invalid source document dimensions. Needs Review.');
    const header=sheet.getRange(1,1,1,lastColumn).getValues()[0].map(String);
    if (header.length!==new Set(header).size || header.indexOf(column)<0)
      throw new Error('Ambiguous source-link schema. Needs Review.');
    if(lastRow<2)return false;
    const index=header.indexOf(column);
    return sheet.getRange(2,1,lastRow-1,lastColumn).getValues().some(function(row){
      return String(row[index])===String(id);
    });
  } catch(error) {
    throw new Error('Source-link readback uncertain. Needs Review; do not modify transaction.');
  }
}
function assertSourceLinkedPurchaseNotModified_(purchaseId) {
  if (hasAuthoritativeSourceLink_('STOCK_LOT_SETTLEMENTS','Purchase ID',purchaseId))
    throw new Error('Purchase already funds an OVERSOLD sale; source-linked purchase return/edit requires Needs Review.');
}
function assertSourceLinkedReturnNotCorrected_(returnId) {
  if (hasAuthoritativeSourceLink_('STOCK_LOT_SETTLEMENT_REVERSALS','Return ID',returnId))
    throw new Error('Funded Sales Return has immutable cost reversal; edit/delete requires source-linked review.');
}

/** Historic invoice identity is immutable while any genuine purchase lot
 * allocation or return reversal refers to it. Deleting it through the old
 * Sales/Delete Engine would strand source COGS even if every unit returned. */
function assertSourceLinkedSaleNotDeleted_(invoiceId) {
  if (hasAuthoritativeSourceLink_('STOCK_LOT_SETTLEMENTS','Source Invoice ID',invoiceId) ||
      hasAuthoritativeSourceLink_('STOCK_LOT_SETTLEMENT_REVERSALS','Source Invoice ID',invoiceId))
    throw new Error('Source-linked OVERSOLD invoice deletion requires Needs Review; preserve original funded sale.');
}
