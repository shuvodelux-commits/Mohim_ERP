/**
 * DraftSales.gs
 * Temporary POS draft invoices. Draft operations are deliberately isolated
 * from stock, cash/bank, customer/vendor ledgers, and the real sale writer.
 */
const SALES_DRAFT_JSON_LIMIT_ = 45000;

function generateDraftInvoiceNo_() {
  const props = PropertiesService.getDocumentProperties();
  const year = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy');
  const key = 'DRAFT_INVOICE_COUNTER_' + year;
  const prefix = 'DRAFT-' + year + '-';
  let current = Number(props.getProperty(key) || '0');

  // DocumentProperties can be reset or lag behind imported/restored Sheet
  // data. Reconcile against both live drafts and the immutable audit so a
  // deleted/posted draft number is never silently reused. Read only the Draft
  // No column so this remains cheap as the immutable audit grows.
  ['SALES_DRAFTS', 'SALES_DRAFT_AUDIT'].forEach(function (sheetKey) {
    const headers = CONFIG.HEADERS[sheetKey] || [];
    const draftNoCol = headers.indexOf('Draft No') + 1;
    if (!draftNoCol) return;
    const sheet = getSheet_(sheetKey);
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return;
    sheet.getRange(2, draftNoCol, lastRow - 1, 1).getValues().forEach(function (cell) {
      const value = String(cell[0] || '');
      if (value.indexOf(prefix) !== 0) return;
      const n = Number(value.slice(prefix.length));
      if (Number.isInteger(n) && n > current) current = n;
    });
  });

  const next = current + 1;
  props.setProperty(key, String(next));
  return prefix + String(next).padStart(4, '0');
}

function salesDraftCanManageAll_(user) {
  return hasPermission_(user, 'sales', 'edit');
}

function requireSalesDraftFeatureAccess_(token) {
  const user = getSessionUser_(token);
  if (!hasPermission_(user, 'pos', 'add') && !salesDraftCanManageAll_(user)) {
    throw new Error('You do not have permission to access draft invoices.');
  }
  return user;
}

function requireSalesDraftAccess_(user, row, mode) {
  if (!row) throw new Error('Draft not found.');
  const mine = String(row['Created By ID'] || '') === String(user['User ID'] || '');
  const manageAll = salesDraftCanManageAll_(user);
  if (!mine && !manageAll) throw new Error('You do not have permission to manage this draft.');
  if (mode === 'edit' && !hasPermission_(user, 'pos', 'view')) {
    throw new Error('You do not have permission to view POS.');
  }
  if (mine && !manageAll && !hasPermission_(user, 'pos', 'add')) {
    throw new Error('You do not have permission to manage this draft.');
  }
  return { mine: mine, manageAll: manageAll };
}

function cleanDraftText_(value) {
  return sanitizeInput_(value || '');
}

function validateSalesDraftPayload_(payload) {
  payload = payload || {};
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) throw new Error('Add at least one product before saving a draft.');
  const cleanItems = items.map(function (item, i) {
    const productId = cleanDraftText_(item.productId);
    const name = cleanDraftText_(item.name);
    const qty = Number(item.qty);
    const unitPrice = Number(item.unitPrice);
    const lineTotal = Number(item.lineTotal);
    if (!productId || !name) throw new Error('Line ' + (i + 1) + ': product is required.');
    if (!isValidNonNegativeNumber_(qty) || qty <= 0) throw new Error('Line ' + (i + 1) + ': quantity must be greater than zero.');
    if (!isValidNonNegativeNumber_(unitPrice)) throw new Error('Line ' + (i + 1) + ': price must be a valid number.');
    if (!isValidNonNegativeNumber_(lineTotal)) throw new Error('Line ' + (i + 1) + ': line total must be a valid number.');
    return {
      productId: productId,
      name: name,
      unit: cleanDraftText_(item.unit),
      qty: qty,
      unitPrice: roundMoney_(unitPrice),
      lineTotal: roundMoney_(lineTotal),
      savedPriceMode: ['auto','manual','fixed'].indexOf(item.savedPriceMode) >= 0 ? item.savedPriceMode : 'manual',
      shortageResolution: item.shortageResolution === 'vendor' ? 'vendor' : 'negative',
      vendorId: cleanDraftText_(item.vendorId),
      vendorName: cleanDraftText_(item.vendorName),
      vendorUnitCost: item.vendorUnitCost === '' || item.vendorUnitCost === undefined ? '' : Number(item.vendorUnitCost),
      serialSelections: Array.isArray(item.serialSelections) ? item.serialSelections : [],
      warrantyData: item.warrantyData || null
    };
  });
  const subtotal = Number(payload.subtotal);
  const discount = Number(payload.discount);
  const grandTotal = Number(payload.grandTotal);
  [subtotal, discount, grandTotal].forEach(function (n) {
    if (!isValidNonNegativeNumber_(n)) throw new Error('Draft totals must be valid non-negative numbers.');
  });
  const payment = payload.payment && typeof payload.payment === 'object' ? {
    amountReceived: cleanDraftText_(payload.payment.amountReceived),
    paymentMethod: cleanDraftText_(payload.payment.paymentMethod),
    bankAccountId: cleanDraftText_(payload.payment.bankAccountId)
  } : { amountReceived: '', paymentMethod: '', bankAccountId: '' };
  const itemsJson = JSON.stringify(cleanItems);
  const paymentJson = JSON.stringify(payment);
  if (itemsJson.length > SALES_DRAFT_JSON_LIMIT_ || paymentJson.length > SALES_DRAFT_JSON_LIMIT_) {
    throw new Error('This draft is too large to save. Remove some lines or notes.');
  }
  return {
    customerId: cleanDraftText_(payload.customerId),
    customerName: cleanDraftText_(payload.customerName),
    customerPhone: cleanDraftText_(payload.customerPhone),
    customerFatherName: cleanDraftText_(payload.customerFatherName),
    customerAddress: cleanDraftText_(payload.customerAddress),
    items: cleanItems, itemsJson: itemsJson, payment: payment, paymentJson: paymentJson,
    notes: cleanDraftText_(payload.notes), subtotal: roundMoney_(subtotal), discount: roundMoney_(discount), grandTotal: roundMoney_(grandTotal)
  };
}

function parseSalesDraftRow_(row) {
  let items = [], payment = {};
  try { items = JSON.parse(row['Items JSON'] || '[]'); } catch (e) { items = []; }
  try { payment = JSON.parse(row['Payment JSON'] || '{}'); } catch (e) { payment = {}; }
  return {
    draftId: row['Draft ID'], draftNo: row['Draft No'], draftDate: safeDateOnly_(row['Draft Date']),
    customerId: row['Customer ID'] || '', customerName: row['Customer Name'] || '', customerPhone: row['Customer Phone'] || '',
    customerFatherName: row['Customer Father Name'] || '', customerAddress: row['Customer Address'] || '',
    items: items, payment: payment, notes: row['Notes'] || '', subtotal: Number(row['Subtotal']) || 0,
    discount: Number(row['Discount']) || 0, grandTotal: Number(row['Grand Total']) || 0,
    createdById: row['Created By ID'] || '', createdByName: row['Created By Name'] || '', createdAt: row['Created At'] || '',
    updatedById: row['Updated By ID'] || '', updatedByName: row['Updated By Name'] || '', updatedAt: row['Updated At'] || '',
    version: Number(row['Version']) || 1
  };
}

function appendSalesDraftAudit_(action, row, user, invoiceId, note) {
  const allowed = { CREATED:true, UPDATED:true, DELETED:true, POSTED:true, POST_CLEANUP_RETRY:true };
  if (!allowed[action]) throw new Error('Invalid draft audit action.');
  appendRow_('SALES_DRAFT_AUDIT', {
    'Audit ID': generateId_('SALES_DRAFT_AUDIT'), 'Timestamp': new Date(), 'Action': action,
    'Draft ID': row['Draft ID'], 'Draft No': row['Draft No'], 'Version': Number(row['Version']) || 1,
    'Actor ID': user['User ID'] || '', 'Actor Name': actorName_(user), 'Source Owner ID': row['Created By ID'] || '',
    'Invoice ID': invoiceId || '', 'Note': note || ''
  });
}

function saveSalesDraft(token, payload) {
  const lock = LockService.getScriptLock(); lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    const user = requirePermission_(token, 'pos', 'add');
    const clean = validateSalesDraftPayload_(payload || {}); const now = new Date();
    const row = {
      'Draft ID': generateId_('SALES_DRAFTS'), 'Draft No': generateDraftInvoiceNo_(), 'Draft Date': formatDate_(now),
      'Customer ID': clean.customerId, 'Customer Name': clean.customerName, 'Customer Phone': clean.customerPhone,
      'Customer Father Name': clean.customerFatherName, 'Customer Address': clean.customerAddress,
      'Items JSON': clean.itemsJson, 'Payment JSON': clean.paymentJson, 'Notes': clean.notes,
      'Subtotal': clean.subtotal, 'Discount': clean.discount, 'Grand Total': clean.grandTotal,
      'Created By ID': user['User ID'], 'Created By Name': actorName_(user), 'Created At': now,
      'Updated By ID': user['User ID'], 'Updated By Name': actorName_(user), 'Updated At': now, 'Version': 1
    };
    appendRow_('SALES_DRAFTS', row); appendSalesDraftAudit_('CREATED', row, user, '', '');
    return ok_({ draftId: row['Draft ID'], draftNo: row['Draft No'], version: 1 });
  } catch (err) { logError_('saveSalesDraft', err); return fail_(err.message); } finally { lock.releaseLock(); }
}

function getSalesDraftList(token) {
  try {
    const user = requireSalesDraftFeatureAccess_(token); const all = salesDraftCanManageAll_(user);
    const rows = getAllRows_('SALES_DRAFTS').filter(function (r) { return all || String(r['Created By ID']) === String(user['User ID']); });
    rows.sort(function (a,b) { return new Date(b['Updated At']) - new Date(a['Updated At']); });
    return ok_(rows.map(function (r) { return {
      draftId:r['Draft ID'], draftNo:r['Draft No'], draftDate:safeDateOnly_(r['Draft Date']), customerId:r['Customer ID']||'',
      customerName:r['Customer Name']||'', customerPhone:r['Customer Phone']||'', subtotal:Number(r['Subtotal'])||0,
      discount:Number(r['Discount'])||0, grandTotal:Number(r['Grand Total'])||0, createdById:r['Created By ID']||'',
      createdByName:r['Created By Name']||'', updatedAt:r['Updated At']||'', version:Number(r['Version'])||1,
      mine:String(r['Created By ID'])===String(user['User ID']), canManage:all || String(r['Created By ID'])===String(user['User ID'])
    }; }));
  } catch (err) { logError_('getSalesDraftList', err); return fail_(err.message); }
}

function getSalesDraft(token, draftId) {
  try {
    const user = requireSalesDraftFeatureAccess_(token); const row = findFirstRow_('SALES_DRAFTS','Draft ID',sanitizeInput_(draftId));
    const access = requireSalesDraftAccess_(user,row,'edit'); const parsed = parseSalesDraftRow_(row); parsed.mine=access.mine; parsed.canManage=access.manageAll||access.mine;
    return ok_(parsed);
  } catch (err) { logError_('getSalesDraft', err); return fail_(err.message); }
}

function updateSalesDraft(token, draftId, expectedVersion, payload) {
  const lock=LockService.getScriptLock(); lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    const user=requireSalesDraftFeatureAccess_(token), id=sanitizeInput_(draftId), row=findFirstRow_('SALES_DRAFTS','Draft ID',id);
    requireSalesDraftAccess_(user,row,'edit');
    if (Number(row['Version']) !== Number(expectedVersion)) throw new Error('This draft was changed by another user. Reload the latest version.');
    const clean=validateSalesDraftPayload_(payload||{}), now=new Date(), next=Number(row['Version'])+1;
    updateRowFields_('SALES_DRAFTS',row._rowIndex,{
      'Customer ID':clean.customerId,'Customer Name':clean.customerName,'Customer Phone':clean.customerPhone,'Customer Father Name':clean.customerFatherName,
      'Customer Address':clean.customerAddress,'Items JSON':clean.itemsJson,'Payment JSON':clean.paymentJson,'Notes':clean.notes,
      'Subtotal':clean.subtotal,'Discount':clean.discount,'Grand Total':clean.grandTotal,'Updated By ID':user['User ID'],'Updated By Name':actorName_(user),'Updated At':now,'Version':next
    });
    const updated=findFirstRow_('SALES_DRAFTS','Draft ID',id); appendSalesDraftAudit_('UPDATED',updated,user,'','');
    return ok_({draftId:id,draftNo:row['Draft No'],version:next});
  } catch(err){ logError_('updateSalesDraft',err); return fail_(err.message); } finally { lock.releaseLock(); }
}

function deleteSalesDraft(token,draftId,expectedVersion,reason) {
  const lock=LockService.getScriptLock(); lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    const user=requireSalesDraftFeatureAccess_(token), id=sanitizeInput_(draftId), row=findFirstRow_('SALES_DRAFTS','Draft ID',id);
    requireSalesDraftAccess_(user,row,'manage');
    if (Number(row['Version']) !== Number(expectedVersion)) throw new Error('This draft was changed by another user. Reload the latest version.');
    const why=cleanDraftText_(reason); if(!why) throw new Error('Reason is required.');
    appendSalesDraftAudit_('DELETED',row,user,'',why); deleteRow_('SALES_DRAFTS',row._rowIndex);
    return ok_({draftId:id});
  } catch(err){ logError_('deleteSalesDraft',err); return fail_(err.message); } finally { lock.releaseLock(); }
}

// ---------------- Draft -> posted sale idempotency helpers ----------------
function findPostedInvoiceByDraftId_(draftId) {
  const id = sanitizeInput_(draftId);
  if (!id) return null;
  return getAllRows_('SALES').filter(function (row) {
    return String(row['Source Draft ID'] || '') === id;
  })[0] || null;
}

function findPostedDraftAudit_(draftId) {
  const id = sanitizeInput_(draftId);
  const rows = getAllRows_('SALES_DRAFT_AUDIT').filter(function (row) {
    return String(row['Draft ID'] || '') === id &&
      (row['Action'] === 'POSTED' || row['Action'] === 'POST_CLEANUP_RETRY');
  });
  rows.sort(function (a,b) { return new Date(b['Timestamp']) - new Date(a['Timestamp']); });
  return rows[0] || null;
}

function prepareSalesDraftForPosting_(actingUser, draftId, expectedVersion) {
  const row = findFirstRow_('SALES_DRAFTS', 'Draft ID', sanitizeInput_(draftId));
  const access = requireSalesDraftAccess_(actingUser, row, 'edit');
  if (Number(row['Version']) !== Number(expectedVersion)) {
    throw new Error('This draft was changed by another user. Reload the latest version.');
  }
  return { row: row, parsed: parseSalesDraftRow_(row), access: access };
}

function authorizePostedDraftRetry_(actingUser, draftId, expectedVersion) {
  const active = findFirstRow_('SALES_DRAFTS', 'Draft ID', sanitizeInput_(draftId));
  if (active) {
    requireSalesDraftAccess_(actingUser, active, 'edit');
    if (Number(active['Version']) !== Number(expectedVersion)) throw new Error('This draft was changed by another user. Reload the latest version.');
    return true;
  }
  const audit = findPostedDraftAudit_(draftId);
  if (!audit) throw new Error('Draft posting history could not be verified.');
  if (Number(audit['Version']) !== Number(expectedVersion)) throw new Error('This draft was changed by another user. Reload the latest version.');
  const mine = String(audit['Source Owner ID'] || '') === String(actingUser['User ID'] || '');
  if (!mine && !salesDraftCanManageAll_(actingUser)) throw new Error('You do not have permission to manage this draft.');
  return true;
}

function fixedDraftLineByProduct_(draftParsed) {
  const map = {};
  (draftParsed && draftParsed.items || []).forEach(function (line) { map[String(line.productId)] = line; });
  return map;
}

function removeSalesDraftAfterPost_(draftId, version, invoiceId, actingUser, retry) {
  try {
    const row = findFirstRow_('SALES_DRAFTS', 'Draft ID', sanitizeInput_(draftId));
    if (!row) return true;
    if (Number(row['Version']) !== Number(version)) {
      logError_('removeSalesDraftAfterPost_', new Error('Post cleanup skipped because draft version changed.'));
      return false;
    }
    // Audit evidence must exist before the temporary row can be removed.
    appendSalesDraftAudit_(retry ? 'POST_CLEANUP_RETRY' : 'POSTED', row, actingUser, invoiceId, '');
    deleteRow_('SALES_DRAFTS', row._rowIndex);
    return true;
  } catch (err) {
    // The real financial sale is already written. Cleanup must never turn
    // a successful sale into a client-visible failure that invites reposting.
    logError_('removeSalesDraftAfterPost_', err);
    return false;
  }
}

function buildSalesDraftPreviewPayload_(row) {
  const parsed = parseSalesDraftRow_(row);
  const grand = Number(row['Grand Total']) || 0;
  const receivedRaw = Number(parsed.payment && parsed.payment.amountReceived);
  const provisionalPaid = Math.min(Math.max(isFinite(receivedRaw) ? receivedRaw : 0, 0), grand);
  return {
    isDraft: true,
    draftNo: row['Draft No'],
    invoiceId: row['Draft No'],
    date: safeDateOnly_(row['Draft Date']),
    time: '', dueDate: '',
    customerId: row['Customer ID'] || '', customerName: row['Customer Name'] || '', customerPhone: row['Customer Phone'] || '',
    customerFatherName: row['Customer Father Name'] || '', customerAddress: row['Customer Address'] || '',
    items: parsed.items || [], subtotal: Number(row['Subtotal']) || 0, discount: Number(row['Discount']) || 0, grandTotal: grand,
    paidAmount: provisionalPaid, dueAmount: Math.max(0, grand - provisionalPaid), paymentType: 'Draft', paymentStatus: 'Draft',
    paymentMethod: parsed.payment && parsed.payment.paymentMethod || '', bankAccountName: '',
    shop: buildInvoiceShopPayload_(getSettingsMap_())
  };
}

function getSalesDraftPreview(token, draftId) {
  try {
    const user = requireSalesDraftFeatureAccess_(token);
    const row = findFirstRow_('SALES_DRAFTS', 'Draft ID', sanitizeInput_(draftId));
    requireSalesDraftAccess_(user, row, 'manage');
    return ok_(buildSalesDraftPreviewPayload_(row));
  } catch (err) {
    logError_('getSalesDraftPreview', err);
    return fail_(err.message);
  }
}
