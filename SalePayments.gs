/**
 * Multi-payment calculations for POS V2.
 * Pure helpers only: no Sheets reads/writes, RPCs or account mutations.
 * The caller must obtain trusted BANK_ACCOUNTS rows and validate before posting.
 */

/** Accept only exact money up to two decimals, preserving integer-paisa arithmetic. */
function salePaymentPaisa_(value, label, allowBlank) {
  if (allowBlank && (value === '' || value === null || value === undefined)) return 0;
  const raw = String(value).trim();
  if (!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(raw)) {
    throw new Error((label || 'Amount') + ' must have at most two decimal places.');
  }
  const parts = raw.split('.');
  const whole = parts[0] ? Number(parts[0]) : 0;
  const cents = parts[1] ? Number(parts[1].padEnd(2,'0')) : 0;
  const total = whole * 100 + cents;
  if (!Number.isSafeInteger(total) || total < 0) throw new Error((label || 'Amount') + ' is out of range.');
  return total;
}

/**
 * Server-authoritative split.
 * Cash may have one row and produce change; bank/mobile are applied exactly.
 * Only positive allocations become payment rows and book movements.
 */
function normalizeSalePayments_(grandTotal, inputRows, accountRows) {
  const total = salePaymentPaisa_(grandTotal, 'Invoice total', false);
  if (!Array.isArray(inputRows)) throw new Error('Payment rows are required.');
  if (inputRows.length > 20) throw new Error('Too many payment rows (maximum 20).');
  const accounts = Array.isArray(accountRows) ? accountRows : [];
  const seen = Object.create(null);
  const prepared = [];
  let bankTotal = 0, cashTender = 0, cashCount = 0;

  inputRows.forEach(function (raw, i) {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid payment row.');
    const id = String(raw.id || '').trim();
    if (!id || Object.prototype.hasOwnProperty.call(seen,id)) throw new Error('Missing or duplicate payment row ID.');
    seen[id] = true;
    const method = String(raw.method || '').trim();
    if (['Cash','Bank','Mobile Banking'].indexOf(method) < 0) throw new Error('Unsupported payment method.');
    const tender = salePaymentPaisa_(raw.amount, 'Payment amount', true);
    const accountId = String(raw.accountId || '').trim();
    if (method === 'Cash') {
      if (++cashCount > 1) throw new Error('Only one Cash row is allowed.');
      if (accountId) throw new Error('Cash payment must not select a bank account.');
      cashTender = tender;
    }
    if (!tender) return;
    let bankAccountId = '', bankAccountName = '';
    if (method !== 'Cash') {
      const bank = accounts.filter(function (a) { return String(a['Bank Account ID']) === accountId; })[0];
      if (!bank || bank['Status'] !== 'Active' || String(bank['Is Deleted'] || '').toUpperCase() === 'TRUE') {
        throw new Error('Choose an active payment account.');
      }
      const type = String(bank['Account Type'] || 'Bank');
      if (type !== method) throw new Error('Payment account type does not match the payment method.');
      bankAccountId = accountId;
      bankAccountName = String(bank['Account Name'] || '');
      bankTotal += tender;
      if (!Number.isSafeInteger(bankTotal)) throw new Error('Payment total is out of range.');
    }
    prepared.push({
      rowId:id,rowOrder:i + 1,method:method,bankAccountId:bankAccountId,
      bankAccountName:bankAccountName,tendered:tender,applied:tender,change:0
    });
  });

  if (bankTotal > total) throw new Error('Bank/Mobile payments exceed invoice total.');
  if (total === 0 && cashTender > 0) throw new Error('Cannot tender cash for a zero-value invoice.');
  const cashApplied = Math.min(cashTender, total - bankTotal);
  const cashChange = cashTender - cashApplied;
  const payments = prepared.map(function (p) {
    if (p.method === 'Cash') {
      p.applied = cashApplied;
      p.change = cashChange;
    }
    return p;
  }).filter(function (p) { return p.applied > 0 || (p.method === 'Cash' && p.tendered > 0); }).map(function(p){
    return {
      rowId:p.rowId,rowOrder:p.rowOrder,method:p.method,
      bankAccountId:p.bankAccountId,bankAccountName:p.bankAccountName,
      tendered:p.tendered / 100,applied:p.applied / 100,change:p.change / 100
    };
  });
  const paid = bankTotal + cashApplied, due = total - paid;
  const appliedPayments = payments.filter(function (p) { return p.applied > 0; });
  const one = appliedPayments.length === 1 ? appliedPayments[0] : null;
  return {
    payments:payments,
    paidAmount:paid / 100,dueAmount:due / 100,changeAmount:cashChange / 100,
    paymentType:due === 0 ? 'Cash' : paid ? 'Partial' : 'Due',
    paymentStatus:due === 0 ? 'Paid' : paid ? 'Partial' : 'Due',
    paymentMethod:one ? one.method : appliedPayments.length ? 'Multiple' : '',
    bankAccountId:one ? one.bankAccountId : '',
    bankAccountName:one ? one.bankAccountName : ''
  };
}

/**
 * Existing SALES records are never rewritten to synthesize payment children.
 * Payment Detail Version=1 means the active child rows are authoritative,
 * including legitimately empty children for an entirely due invoice.
 */
function readSalePaymentBreakdown_(sale, childRows) {
  const paid = salePaymentPaisa_(sale['Paid Amount'] || 0, 'Paid Amount', false);
  const version = String(sale['Payment Detail Version'] || '').trim();
  if (!version) {
    if (!paid) return [];
    const method = String(sale['Payment Method'] || 'Cash');
    return [{
      rowId:'legacy',method:method,
      bankAccountId:String(sale['Bank Account ID'] || ''),
      bankAccountName:String(sale['Bank Account Name'] || ''),
      tendered:paid / 100,applied:paid / 100,change:0,legacy:true
    }];
  }
  if (version !== '1') throw new Error('Unsupported sale payment detail version.');
  const rows = (Array.isArray(childRows) ? childRows : [])
    .filter(function (r) { return r['Invoice ID'] === sale['Invoice ID'] && String(r['Status']) === 'Active'; })
    .sort(function (a,b) { return (Number(a['Row Order'])||0) - (Number(b['Row Order'])||0); });
  const revisions = {};
  rows.forEach(function (r) { revisions[String(r['Revision'] || 1)] = true; });
  if (Object.keys(revisions).length > 1) throw new Error('Payment data integrity error: mixed active revisions.');
  const payments = rows.map(function (r) {
    const applied = salePaymentPaisa_(r['Applied Amount'], 'Stored applied amount', false);
    const tendered = salePaymentPaisa_(r['Tendered Amount'],'Stored tendered amount',false);
    const change = salePaymentPaisa_(r['Change Amount']||0,'Stored change amount',false);
    if (!applied && !(r['Method'] === 'Cash' && tendered > 0 && change === tendered)) {
      throw new Error('Payment data integrity error: unexpected zero-value active payment.');
    }
    return {
      rowId:String(r['Payment ID']),method:String(r['Method']),
      bankAccountId:String(r['Bank Account ID']||''),
      bankAccountName:String(r['Bank Account Name']||''),
      tendered:tendered/100,
      applied:applied/100,
      change:change/100,
      legacy:false
    };
  });
  const appliedSum = payments.reduce(function (sum,p) { return sum + Math.round(p.applied * 100); },0);
  if (appliedSum !== paid) throw new Error('Payment data integrity mismatch: invoice paid amount differs from payment rows.');
  return payments;
}

/** Single decision rule; never replay an ambiguous in-progress financial write. */
function salePostingJournalDecision_(existing, payloadHash) {
  if (!existing) return 'new';
  if (String(existing['Payload Hash']) !== String(payloadHash)) {
    throw new Error('Operation ID was already used with different payment payload.');
  }
  if (existing['State'] === 'Committed') return 'replay';
  if (['Prepared','Writing','Needs Review'].indexOf(existing['State']) >= 0) return 'review';
  throw new Error('Unknown posting journal state.');
}

/**
 * A retry must use the exact original payload. SHA-256 avoids retaining
 * sensitive POS customer details in the posting journal.
 */
function salePostingPayloadHash_(payload) {
  const raw = JSON.stringify(payload);
  if (!raw || raw.length > 100000) throw new Error('Sale payload is too large.');
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw)
    .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); })
    .join('');
}
