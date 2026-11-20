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
  const safe=function(){return {safe:true,status:'CLEAR',issues:[]};};
  const blocked=function(reason){return {safe:false,status:'NEEDS_REVIEW',issues:[String(reason)]};};
  try {
    if (!CONFIG || !CONFIG.SHEETS || typeof getSpreadsheet_!=='function')
      return blocked('JOURNAL_READBACK_UNAVAILABLE');
    const ss=getSpreadsheet_();
    const targets=[
      {key:'PURCHASE_SETTLEMENT_JOURNAL',receipt:'Purchase ID',flag:'PURCHASE_SETTLEMENT_WRITER_RELEASE_APPROVED'},
      {key:'FUNDED_RETURN_JOURNAL',receipt:'Return ID',flag:'FUNDED_RETURN_WRITER_RELEASE_APPROVED'}
    ];
    for (const target of targets) {
      const name=CONFIG.SHEETS[target.key];
      if (!name) return blocked('MISSING_JOURNAL_CONFIG_'+target.key);
      const sheet=ss.getSheetByName(name);
      if (!sheet) {
        if (CONFIG[target.flag]===true) return blocked('MISSING_ACTIVE_JOURNAL_'+target.key);
        continue;
      }
      const col=sheet.getLastColumn(),lastRow=sheet.getLastRow();
      if (!Number.isInteger(col)||col<5||!Number.isInteger(lastRow)||lastRow<1)
        return blocked('INVALID_JOURNAL_DIMENSIONS_'+target.key);
      const data=sheet.getRange(1,1,lastRow,col).getValues();
      if (!data.length)return blocked('MISSING_JOURNAL_HEADER_'+target.key);
      const header=data[0].map(String),required=['Operation ID',target.receipt,'State','Last Completed Stage','Result Receipt'];
      if (header.length!==new Set(header).size || required.some(function(key){return header.indexOf(key)<0;}))
        return blocked('MALFORMED_JOURNAL_HEADER_'+target.key);
      const indices=required.map(function(key){return header.indexOf(key);});
      const seenOperations={},seenReceipts={};
      for (let r=1;r<data.length;r++) {
        const raw=data[r];
        if (raw.every(function(cell){return cell===''||cell===null||cell===undefined;}))continue;
        const values=indices.map(function(i){return String(raw[i]===null||raw[i]===undefined?'':raw[i]);});
        const operation=values[0],receipt=values[1],state=values[2],stage=values[3],proof=values[4];
        if (!operation||!receipt||seenOperations[operation]||seenReceipts[receipt] ||
            state!=='Committed'||stage!=='Committed'||proof!==receipt)
          return blocked('UNVERIFIED_OR_DUPLICATE_JOURNAL_'+target.key);
        seenOperations[operation]=true;seenReceipts[receipt]=true;
      }
    }
    return safe();
  } catch(error) {return blocked('JOURNAL_READBACK_UNCERTAIN');}
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
