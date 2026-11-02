/**
 * Phase 1 WhatsApp sharing foundation.
 * Read-only with respect to all ERP accounting data. Never sends messages.
 */

/** Canonical Bangladesh mobile number for an eventual wa.me handoff. */
function whatsAppNormalizePhone_(raw) {
  const input = String(raw == null ? '' : raw).trim();
  if (!input) throw new Error('Enter a Bangladesh mobile phone number.');
  const ascii = input
    .replace(/[০-৯]/g, function (digit) { return String(digit.charCodeAt(0) - 0x09E6); })
    .replace(/[٠-٩]/g, function (digit) { return String(digit.charCodeAt(0) - 0x0660); })
    .replace(/[۰-۹]/g, function (digit) { return String(digit.charCodeAt(0) - 0x06F0); });
  const compact = ascii.replace(/[\s().-]/g, '');
  if (!/^\+?\d+$/.test(compact)) throw new Error('Invalid Bangladesh mobile phone number.');

  let digits = '';
  if (/^01[3-9]\d{8}$/.test(compact)) digits = '88' + compact;
  else if (/^8801[3-9]\d{8}$/.test(compact)) digits = compact;
  else if (/^\+8801[3-9]\d{8}$/.test(compact)) digits = compact.slice(1);
  else throw new Error('Enter a valid Bangladesh mobile phone number, starting with 01 or +8801.');
  return { digits: digits, display: '+' + digits };
}

/**
 * An operator-entered recipient override is not persisted to customer,
 * supplier, or finance person master data.
 */
function whatsAppResolveRecipient_(storedPhone, recipientOverride, confirmOverride) {
  const alternate = String(recipientOverride == null ? '' : recipientOverride).trim();
  if (!alternate) return Object.assign({ overridden: false }, whatsAppNormalizePhone_(storedPhone));
  const normalized = whatsAppNormalizePhone_(alternate);
  let original = null;
  try { original = whatsAppNormalizePhone_(storedPhone); }
  catch (ignore) { /* A missing stored number permits a confirmed replacement. */ }
  const changed = !original || original.digits !== normalized.digits;
  if (changed && confirmOverride !== true) {
    throw new Error('Confirm the changed WhatsApp recipient phone number before opening WhatsApp.');
  }
  return Object.assign({ overridden: changed }, normalized);
}

/**
 * Require the separate share permission and view permission for the
 * requested source. IDs and Finance Person account roles are authoritative.
 */
function whatsAppAuthorize_(token, source, entityId, accountRole) {
  const sources = {
    customer: { module: 'customers', sheet: 'CUSTOMERS', idKey: 'Customer ID' },
    supplier: { module: 'suppliers', sheet: 'SUPPLIERS', idKey: 'Supplier ID' },
    financePerson: { module: 'finance', sheet: 'FINANCE_PERSONS', idKey: 'Person ID' }
  };
  const cfg = sources[source];
  if (!cfg) throw new Error('Unknown WhatsApp sharing source.');
  const id = String(entityId == null ? '' : entityId).trim();
  if (!id || id.length > 128) throw new Error('Choose a valid person or party before sharing.');

  const actor = requirePermission_(token, 'whatsappShare', 'edit');
  requirePermission_(token, cfg.module, 'view');

  const matches = getAllRows_(cfg.sheet).filter(function (row) {
    return String(row[cfg.idKey] || '') === id && !isDeleted_(row);
  });
  if (matches.length !== 1) throw new Error('WhatsApp recipient account not found or unavailable.');

  if (source === 'financePerson') {
    const role = String(accountRole == null ? '' : accountRole).trim();
    if (['Owner', 'Lender', 'Borrower'].indexOf(role) === -1) {
      throw new Error('Select a valid Finance Person account role.');
    }
    if (financePersonRoles_(matches[0]).indexOf(role) === -1) {
      throw new Error('This Finance Person does not have the selected account role.');
    }
  } else if (accountRole != null && String(accountRole).trim()) {
    throw new Error('Account role is only valid for a Finance Person.');
  }
  return actor;
}
