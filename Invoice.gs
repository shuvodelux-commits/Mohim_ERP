/**
 * Invoice.gs
 * ---------------------------------------------------------------------
 * Review item 10: every function in this file that the browser can
 * reach now requires a session token. Apps Script exposes EVERY global
 * function without a trailing underscore to google.script.run, so an
 * ungated one is reachable by anyone holding the web app URL - no
 * login, no role, nothing.
 *
 * These two were the worst of the set: invoice IDs are sequential
 * (INV-000001, INV-000002...), so findInvoice let anyone walk the
 * entire sales history one number at a time, and findSalesByPhone
 * returned every sale ever made to a phone number. Both are called
 * only from pos.html, so both check the 'pos' module.
 *
 * Assembles everything the invoice template needs (shop details, line
 * items, totals, payment status) from the Sales / Sale Items / Settings
 * sheets. Called once right after completeSale(), and again any time an
 * older invoice is reprinted from the POS search box.
 * ---------------------------------------------------------------------
 */

function buildInvoiceShopPayload_(settings) {
  settings = settings || getSettingsMap_();
  return {
    name: settings['Shop Name'] || CONFIG.APP_NAME,
    nameBangla: settings['Shop Name Bangla'] || '',
    proprietorName: settings['Invoice Proprietor Name'] || '',
    proprietorParagraph: settings['Invoice Proprietor Paragraph'] || '',
    invoiceTitle: settings['Invoice Title'] || 'চালান',
    description: settings['Shop Description'] || '',
    address: settings['Address'] || '',
    phone1: settings['Phone 1'] || '',
    phone2: settings['Phone 2'] || '',
    phone: settings['Phone 1'] || settings['Phone'] || '',
    logoDataUri: resolveInvoiceLogoDataUri_(),
    showBismillah: isSettingEnabled_(settings['Invoice Show Bismillah'], true),
    bismillahText: settings['Invoice Bismillah Text'] || '',
    showSignature: isSettingEnabled_(settings['Invoice Show Signature'], true),
    paymentMethods: settings['Invoice Payment Methods'] || '[]',
    terms: settings['Invoice Terms'] || '[]',
    paymentTermsText: settings['Invoice Payment Terms Text'] || '',
    currencySymbol: settings['Currency Symbol'] || '',
    footer: settings['Invoice Footer'] || '',
    receiptSize: settings['Receipt Size'] || '80mm'
  };
}

function buildInvoicePayload_(invoiceId) {
  const saleMatches = findRows_('SALES', 'Invoice ID', invoiceId);
  if (!saleMatches.length) throw new Error('Invoice not found.');
  if (saleMatches.length > 1) {
    throw new Error('Duplicate invoice ID detected: ' + invoiceId + '. Stop posting sales and repair the invoice ID counter/data before reprinting this invoice.');
  }
  const sale = saleMatches[0];
  if (isDeleted_(sale)) throw new Error('Invoice not found or has been deleted.');

  const items = getAllRows_('SALE_ITEMS').filter(function (i) { return i['Invoice ID'] === invoiceId; });
  const settings = getSettingsMap_();

  // SALE_ITEMS never stored the unit at time of sale, so it's looked up
  // from the current Products sheet instead — fine for a hardware store
  // where a product's unit ('bag', 'pcs', 'kg'...) essentially never
  // changes after creation. Falls back to '' (column just collapses) if
  // the product was since deleted.
  const unitByProductId = {};
  getAllRows_('PRODUCTS').forEach(function (p) { unitByProductId[p['Product ID']] = p['Unit'] || ''; });

  // Sheets auto-types a "date-looking" column into a real Date cell, which
  // getAllRows_ then serializes as 'yyyy-MM-ddTHH:mm:ss' (see Database.gs's
  // serializeCellValue_) instead of the plain 'yyyy-MM-dd' the row was
  // originally written with. Every other module (SalesManagement.gs,
  // DayBook.gs, Reports.gs...) routes through safeDateOnly_ for exactly
  // this reason; this was the one invoice-only path that skipped it, which
  // showed up as the raw timestamp printing on the invoice instead of a
  // formatted Bangla date.
  const saleDate = safeDateOnly_(sale['Date']);
  const paymentTermsDays = Number(settings['Invoice Payment Terms Days']) || 0;
  const dueDate = computeInvoiceDueDate_(saleDate, paymentTermsDays);

  // Father's name only exists on tracked (due-carrying) Customers, not on
  // the Sale row itself — walk-ins print without it, which is expected.
  let customerFatherName = '';
  if (sale['Customer ID']) {
    const customer = getAllRows_('CUSTOMERS').filter(function (c) { return c['Customer ID'] === sale['Customer ID']; })[0];
    if (customer) customerFatherName = customer['Father Name'] || '';
  }

  const settlement = customerInvoiceSettlementSnapshot_(invoiceId) || {
    paidAmount: Number(sale['Paid Amount']) || 0,
    dueAmount: Number(sale['Due Amount']) || 0,
    customerCreditUsed: 0,
    paymentType: sale['Payment Type'] || '',
    paymentStatus: sale['Payment Status'] || ''
  };

  return {
    invoiceId: sale['Invoice ID'], date: saleDate, time: safeTimeOnly_(sale['Time']), dueDate: dueDate,
    customerName: sale['Customer Name'], customerPhone: sale['Customer Phone'],
    customerAddress: sale['Customer Address'], customerId: sale['Customer ID'],
    customerFatherName: customerFatherName,
    items: items.map(function (i) {
      return {
        productId: i['Product ID'], name: i['Product Name'], qty: i['Quantity'],
        unit: unitByProductId[i['Product ID']] || '', unitPrice: i['Unit Price'], lineTotal: i['Line Total'],
        supplierId: i['Supplier ID'] || '', supplierName: i['Supplier Name'] || ''
      };
    }),
    subtotal: sale['Subtotal'], discount: sale['Discount'], grandTotal: sale['Grand Total'],
    paidAmount: settlement.paidAmount, dueAmount: settlement.dueAmount,
    customerCreditUsed: settlement.customerCreditUsed || 0,
    paymentType: settlement.paymentType, paymentStatus: settlement.paymentStatus,
    paymentMethod: sale['Payment Method'] || '', bankAccountName: sale['Bank Account Name'] || '',
    shop: buildInvoiceShopPayload_(settings)
  };
}

/**
 * Resolves the Drive file ID stored in the 'Invoice Logo' setting into an
 * embeddable data: URI, or '' if no logo is set / the file is missing.
 * Fetching the blob and inlining it here — rather than pointing <img> at a
 * Drive URL — means the invoice never depends on the file's Drive sharing
 * settings and works identically in the on-screen preview, window.print(),
 * and the canvas-drawn JPG (which can draw a data: image without tainting).
 */
function resolveInvoiceLogoDataUri_() {
  const fileId = getSettingsMap_()['Invoice Logo'];
  if (!fileId) return '';
  try {
    const blob = DriveApp.getFileById(fileId).getBlob();
    return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
  } catch (e) {
    return '';
  }
}

/**
 * Sale date + 'Invoice Payment Terms Days' -> 'yyyy-MM-dd', or '' when no
 * terms are configured (0/unset) — the template hides the due-date row
 * entirely in that case rather than showing a fabricated value.
 * Builds the Date from y/m/d parts, not new Date(dateStr) directly, to
 * avoid the UTC-parse day-shift trap noted elsewhere (DayBook.gs, Utils.gs).
 */
function computeInvoiceDueDate_(saleDateStr, days) {
  if (!days || days <= 0 || !saleDateStr) return '';
  const parts = String(saleDateStr).split('-');
  if (parts.length !== 3) return '';
  const base = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  if (isNaN(base.getTime())) return '';
  base.setDate(base.getDate() + days);
  return formatDate_(base);
}

/** Look up any past invoice by ID for reprinting. */
function findInvoice(token, invoiceId) {
  try {
    requirePermission_(token, 'pos', 'view');
    const id = sanitizeInput_(invoiceId);
    if (!id) return fail_('Enter an invoice ID.');
    return ok_(buildInvoicePayload_(id));
  } catch (err) {
    return fail_(err.message);
  }
}

/**
 * Every past sale to a given phone number, newest first — for when a
 * customer comes back for a return and you need to find what they paid.
 * Works for walk-ins too, since the phone is saved on the sale itself
 * whether or not that person ever became a tracked (due-carrying) Customer.
 */
function findSalesByPhone(token, phone, customerId) {
  try {
    requirePermission_(token, 'pos', 'view');
    const p = normalizePhoneDisplay_(phone);
    if (!p) return fail_('Enter a phone number.');
    const requestedCustomerId = sanitizeInput_(customerId);
    const activeSales = activeRows_('SALES');
    const duplicateIds = duplicateSalesInvoiceIdMap_(activeSales);
    const matches = activeSales
      .filter(function (s) {
        const sameCustomer = !!requestedCustomerId && String(s['Customer ID'] || '') === requestedCustomerId;
        return sameCustomer || phoneNumbersEqual_(s['Customer Phone'], p);
      })
      .sort(function (a, b) { return new Date(b['Created At']) - new Date(a['Created At']); });

    // Phone history is a current invoice-status view, not a transaction-time
    // audit log. Later customer payments live in CUSTOMER_LEDGER, so replay
    // that ledger once and reuse one state per customer rather than showing
    // the stale Payment Status stored when the sale was first created.
    const needsSettlement = matches.some(function (s) {
      return !duplicateIds[s['Invoice ID']] && String(s['Customer ID'] || '') &&
        (Number(s['Due Amount']) || 0) > 0.004;
    });
    const ledgerByCustomer = {};
    const settlementReturns = needsSettlement ? activeRows_('SALES_RETURN') : [];
    if (needsSettlement) {
      getAllRows_('CUSTOMER_LEDGER').forEach(function (row) {
        const id = String(row['Customer ID'] || '');
        if (!id) return;
        if (!ledgerByCustomer[id]) ledgerByCustomer[id] = [];
        ledgerByCustomer[id].push(row);
      });
    }
    const stateByCustomer = {};

    return ok_(matches.map(function (s) {
      const invoiceId = String(s['Invoice ID'] || '');
      const duplicateInvoiceId = !!duplicateIds[invoiceId];
      const id = String(s['Customer ID'] || '');
      let paymentStatus = s['Payment Status'];
      if (!duplicateInvoiceId && id && (Number(s['Due Amount']) || 0) > 0.004 &&
          typeof customerSettlementState_ === 'function' &&
          typeof customerInvoiceSettlementSnapshotFromState_ === 'function') {
        if (!stateByCustomer[id]) {
          stateByCustomer[id] = customerSettlementState_(id, {
            ledgerRows: ledgerByCustomer[id] || [],
            returnRows: settlementReturns
          });
        }
        const settlement = customerInvoiceSettlementSnapshotFromState_(s, stateByCustomer[id]);
        if (settlement) paymentStatus = settlement.paymentStatus;
      }
      return {
        invoiceId: invoiceId, date: safeDateOnly_(s['Date']), time: safeTimeOnly_(s['Time']),
        customerName: s['Customer Name'], grandTotal: s['Grand Total'],
        paymentStatus: paymentStatus, duplicateInvoiceId: duplicateInvoiceId
      };
    }));
  } catch (err) {
    logError_('findSalesByPhone', err);
    return fail_(err.message);
  }
}
