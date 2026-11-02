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


/**
 * Version of the EXACT displayed ledger entry, not its sheet row number.
 * Task 6 passes this value for every selected ID to reject stale snapshots.
 */
function whatsAppPartyRowVersion_(row) {
  return JSON.stringify([
    String(row['Ledger ID'] || ''), String(row['Date'] || '').slice(0, 10),
    String(row['Type'] || ''), String(row['Reference'] || ''),
    Number(row['Debit']) || 0, Number(row['Credit']) || 0,
    Number(row['Balance']) || 0
  ]);
}

/** Do not forward raw, unresolved accounting correction history. */
function whatsAppPartyAssertSafeRows_(kind, entityId, rows) {
  const idField = kind === 'customer' ? 'Customer ID' : 'Supplier ID';
  (rows || []).forEach(function (row) {
    if (String(row[idField] || '') !== entityId) {
      throw new Error('Party ledger account mismatch. Refresh the ledger before sharing.');
    }
    const type = String(row['Type'] || '');
    if (kind === 'customer' ? /^(Sale Update Credit|Sale Update Debit)$/.test(type)
        : type === 'Purchase Update') {
      throw new Error('The ledger contains an unresolved correction. Review the ledger before sharing.');
    }
    if (!String(row['Ledger ID'] || '')) {
      throw new Error('Ledger entry is missing an ID; refresh the ledger before sharing.');
    }
  });
}

function whatsAppPartyBalanceKind_(kind, balance) {
  if (Math.abs(balance) < 0.005) return 'settled';
  if (kind === 'customer') return balance > 0 ? 'customer_due' : 'customer_credit';
  return balance > 0 ? 'supplier_payable' : 'supplier_advance';
}

/**
 * Source snapshot ONLY: no message delivery, UI, or financial writes.
 * Periods use the canonical statement method; selected rows use the same
 * clean projection as the existing Customer/Supplier ledger pages.
 */
function whatsAppBuildPartySource_(token, request) {
  request = request || {};
  const kind = request.source;
  if (kind !== 'customer' && kind !== 'supplier') throw new Error('Unknown party ledger source.');
  const entityId = String(request.entityId == null ? '' : request.entityId).trim();
  whatsAppAuthorize_(token, kind, entityId, request.accountRole);

  const mode = String(request.mode || '');
  if (['due', 'single', 'selected', 'period'].indexOf(mode) === -1) {
    throw new Error('Unknown WhatsApp party sharing mode.');
  }
  if (kind === 'customer') assertCustomerSalesIntegrity_(entityId);

  const rowIds = request.rowIds == null ? [] : request.rowIds;
  if (!Array.isArray(rowIds)) throw new Error('Select valid ledger row IDs.');
  if ((mode === 'due' || mode === 'period') && rowIds.length) {
    throw new Error('Row IDs are not valid for this sharing mode.');
  }

  let rows = [], business, party, period = null;
  let openingBalance = null, closingBalance = null;
  let totalDebit = 0, totalCredit = 0, summaryLabel;

  if (mode === 'period') {
    // Retains the existing ERP's inclusive date validation and
    // authoritative opening/closing balance calculation.
    const statement = getPartyLedgerStatement_(kind, token, entityId, request.from, request.to);
    party = statement.party;
    business = statement.business;
    period = statement.period;
    rows = statement.rows || [];
    whatsAppPartyAssertSafeRows_(kind, entityId, rows);
    openingBalance = Number(statement.openingBalance) || 0;
    closingBalance = Number(statement.closingBalance) || 0;
    totalDebit = Number(statement.periodDebit) || 0;
    totalCredit = Number(statement.periodCredit) || 0;
    summaryLabel = 'Period statement';
  } else {
    const index = partyLedgerBuildDisplayIndex_(kind, entityId, false);
    whatsAppPartyAssertSafeRows_(kind, entityId, index);
    party = partyLedgerSelectedParty_(kind, entityId, index);
    business = partyLedgerBusinessIdentity_();
    if (mode === 'due') {
      summaryLabel = 'Current balance';
    } else {
      if (mode === 'single' && rowIds.length !== 1) {
        throw new Error('Choose exactly one ledger entry.');
      }
      if (mode === 'selected' && (!rowIds.length || rowIds.length > 25)) {
        throw new Error('Select between 1 and 25 ledger entries.');
      }
      const chosen = new Set();
      rowIds.forEach(function (id) {
        if (typeof id !== 'string' || !id.trim()) throw new Error('Invalid ledger row ID.');
        if (chosen.has(id)) throw new Error('Duplicate ledger row IDs are not allowed.');
        chosen.add(id);
      });
      const matching = index.filter(function (row) {
        return chosen.has(String(row['Ledger ID'] || ''));
      });
      const found = {};
      matching.forEach(function (row) {
        const id = String(row['Ledger ID'] || '');
        if (found[id]) throw new Error('Duplicate authoritative ledger ID; cannot share this entry.');
        found[id] = true;
      });
      if (matching.length !== rowIds.length) {
        throw new Error('A selected ledger entry is missing or has changed. Refresh and reselect.');
      }
      rows = partyLedgerNormalizeFullRows_(kind, matching);
      whatsAppPartyAssertSafeRows_(kind, entityId, rows);
      const versions = request.rowVersions;
      if (!versions || typeof versions !== 'object' || Array.isArray(versions)) {
        throw new Error('Selected ledger row versions are required. Refresh and reselect.');
      }
      rows.forEach(function (row) {
        const id = String(row['Ledger ID'] || '');
        if (!Object.prototype.hasOwnProperty.call(versions, id) ||
            String(versions[id]) !== whatsAppPartyRowVersion_(row)) {
          throw new Error('Selected ledger entry changed since display. Refresh and reselect.');
        }
      });
      rows.forEach(function (row) {
        totalDebit = Math.round((totalDebit + (Number(row['Debit']) || 0)) * 100) / 100;
        totalCredit = Math.round((totalCredit + (Number(row['Credit']) || 0)) * 100) / 100;
      });
      // Non-contiguous selection is NOT a reconciled date-range statement.
      summaryLabel = mode === 'single' ? 'Ledger entry' : 'Selected entries';
    }
  }

  if (!party || String(party.id || '') !== entityId) {
    throw new Error('Party ledger account mismatch or missing account.');
  }
  const currentBalance = Number(party.balance) || 0;
  return {
    source: kind, entityId: entityId, mode: mode, party: party,
    business: business, period: period, rows: rows, rowCount: rows.length,
    currentBalance: currentBalance,
    balanceKind: whatsAppPartyBalanceKind_(kind, currentBalance),
    summaryLabel: summaryLabel, openingBalance: openingBalance,
    closingBalance: closingBalance, totalDebit: totalDebit, totalCredit: totalCredit
  };
}


/**
 * A stable, read-only snapshot signature for one Finance Person Ledger line.
 * Reject a selection when a transaction is edited, backdated, or deleted.
 */
function whatsAppFinanceRowVersion_(row) {
  return JSON.stringify([
    String(row.financeId || ''), String(row.date || ''),
    String(row.transactionType || ''), Number(row.amount) || 0,
    Number(row.balance) || 0, String(row.referenceNo || ''),
    String(row.notes || ''), String(row.account || ''),
    String(row.personId || '')
  ]);
}

function whatsAppFinanceBalanceKind_(role, balance) {
  if (Math.abs(balance) < 0.005) return 'settled';
  if (role === 'Lender') return balance > 0 ? 'lender_credit' : 'lender_debit';
  if (role === 'Borrower') return balance > 0 ? 'borrower_debit' : 'borrower_credit';
  return balance > 0 ? 'owner_credit' : 'owner_debit';
}

/**
 * Finance source uses existing getFinanceLedger server running balances.
 * Finance Ledger debit/credit reflect CASH direction, so transaction lines
 * are independently projected using balanceEffect for their relationship
 * account (the exact Finance Person Ledger convention).
 *
 * Never infer a finance person from an unbound legacy free-text name:
 * the read must fail closed rather than understate or leak an obligation.
 */
function whatsAppBuildFinanceSource_(token, request) {
  request = request || {};
  if (request.source !== 'financePerson') throw new Error('Unknown Finance Person sharing source.');
  const entityId = String(request.entityId == null ? '' : request.entityId).trim();
  const accountRole = String(request.accountRole == null ? '' : request.accountRole).trim();
  whatsAppAuthorize_(token, 'financePerson', entityId, accountRole);
  const accounts = { Owner: 'owner', Lender: 'loanPayable', Borrower: 'borrowerReceivable' };
  const account = accounts[accountRole];
  if (!account) throw new Error('Choose a valid Finance Person account role.');

  const mode = String(request.mode || '');
  if (['due', 'single', 'selected', 'period'].indexOf(mode) === -1) {
    throw new Error('Unknown Finance Person WhatsApp sharing mode.');
  }
  const rowIds = request.rowIds == null ? [] : request.rowIds;
  if (!Array.isArray(rowIds)) throw new Error('Select valid Finance ID values.');
  if ((mode === 'due' || mode === 'period') && rowIds.length) {
    throw new Error('Finance row selection is not allowed for this sharing mode.');
  }
  if (mode !== 'period' && (request.from || request.to)) {
    throw new Error('Date range only applies to a period statement.');
  }

  const people = getAllRows_('FINANCE_PERSONS').filter(function (person) {
    return String(person['Person ID'] || '') === entityId && !isDeleted_(person);
  });
  if (people.length !== 1) throw new Error('Finance Person not found or unavailable.');
  const person = people[0];

  // getFinanceLedger returns ok_/fail_; do not use its all-persons mode.
  const result = getFinanceLedger(token, { personId: entityId });
  if (!result || result.success !== true || !result.data || !Array.isArray(result.data.rows)) {
    throw new Error(result && result.message || 'Unable to read Finance Person ledger.');
  }

  const ledgerRows = result.data.rows;
  const seenFinanceIds = new Set();
  const accountRows = [];
  ledgerRows.forEach(function (row) {
    if (String(row.personKey || '') !== 'id:' + entityId) {
      throw new Error('Finance Person account mismatch. Refresh before sharing.');
    }
    if (String(row.personId || '') !== entityId) {
      throw new Error('Legacy finance transaction has unresolved Person ID. Review and link it before WhatsApp sharing.');
    }
    const id = String(row.financeId || '');
    if (!id || seenFinanceIds.has(id)) {
      throw new Error('Missing or duplicate Finance ID. Review the ledger before sharing.');
    }
    seenFinanceIds.add(id);

    const type = financeTransactionType_(row.transactionType);
    if (!type || !type.account || !type.role) {
      throw new Error('Unknown Finance transaction type. Review the ledger before sharing.');
    }
    if (String(row.account || '') !== type.account) {
      throw new Error('Finance transaction account mismatch. Review the ledger before sharing.');
    }
    if (type.account !== account) return;
    if (type.role !== accountRole) {
      throw new Error('Finance Person relationship role mismatch. Review the ledger before sharing.');
    }
    const amount = Number(row.amount), balance = Number(row.balance);
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(balance)) {
      throw new Error('Invalid Finance transaction amount or balance. Review the ledger before sharing.');
    }
    const increased = type.balanceEffect > 0;
    const borrower = account === 'borrowerReceivable';
    accountRows.push({
      financeId: id, date: String(row.date || ''),
      personId: entityId, account: account, accountRole: accountRole,
      transactionType: type.key, transactionTypeLabel: type.label,
      referenceNo: String(row.referenceNo || ''),
      notes: String(row.notes || ''), amount: amount,
      debit: increased === borrower ? amount : 0,
      credit: increased !== borrower ? amount : 0,
      balance: balance
    });
  });

  // Existing getFinanceLedger returns newest first. Its signed per-account
  // running balance already includes all historical (including opening)
  // transaction effects and is not a cash-book movement.
  const currentBalance = accountRows.length ? Number(accountRows[0].balance) || 0 : 0;
  const party = {
    id: entityId, name: String(person['Person Name'] || ''),
    phone: String(person['Phone'] || ''), balance: currentBalance,
    accountRole: accountRole
  };
  const business = partyLedgerBusinessIdentity_();
  let rows = [], period = null, openingBalance = null, closingBalance = null;
  let summaryLabel = 'Current balance';

  if (mode === 'period') {
    period = partyLedgerValidateStatementDates_(request.from, request.to);
    const asc = accountRows.slice().reverse();
    let opening = 0, closing = 0;
    const selected = [];
    asc.forEach(function (row) {
      if (row.date < period.from) opening = row.balance;
      if (row.date <= period.to) closing = row.balance;
      if (row.date >= period.from && row.date <= period.to) selected.push(row);
    });
    rows = selected.reverse();
    openingBalance = opening;
    closingBalance = closing;
    summaryLabel = 'Period statement';
  } else if (mode === 'single' || mode === 'selected') {
    if (mode === 'single' && rowIds.length !== 1) {
      throw new Error('Choose exactly one Finance entry.');
    }
    if (mode === 'selected' && (rowIds.length < 1 || rowIds.length > 25)) {
      throw new Error('Select between 1 and 25 Finance ledger entries.');
    }
    const wanted = new Set();
    rowIds.forEach(function (id) {
      if (typeof id !== 'string' || !id.trim()) throw new Error('Invalid Finance ID.');
      if (wanted.has(id)) throw new Error('Duplicate Finance ID selection is not allowed.');
      wanted.add(id);
    });
    rows = accountRows.filter(function (row) { return wanted.has(row.financeId); });
    if (rows.length !== rowIds.length) {
      throw new Error('Selected Finance transaction is missing, changed or belongs to another role/person. Refresh and reselect.');
    }
    const versions = request.rowVersions;
    if (!versions || typeof versions !== 'object' || Array.isArray(versions)) {
      throw new Error('Selected Finance row versions required. Refresh and reselect.');
    }
    rows.forEach(function (row) {
      if (!Object.prototype.hasOwnProperty.call(versions, row.financeId) ||
          String(versions[row.financeId]) !== whatsAppFinanceRowVersion_(row)) {
        throw new Error('Finance transaction changed since display. Refresh and reselect.');
      }
    });
    summaryLabel = mode === 'single' ? 'Finance ledger entry' : 'Selected entries';
  }
  const totalDebit = rows.reduce(function (sum, row) {
    return Math.round((sum + row.debit) * 100) / 100;
  }, 0);
  const totalCredit = rows.reduce(function (sum, row) {
    return Math.round((sum + row.credit) * 100) / 100;
  }, 0);
  return {
    source: 'financePerson', entityId: entityId,
    accountRole: accountRole, account: account, mode: mode, party: party,
    business: business, period: period, rows: rows, rowCount: rows.length,
    summaryLabel: summaryLabel, openingBalance: openingBalance,
    closingBalance: closingBalance, totalDebit: totalDebit, totalCredit: totalCredit,
    currentBalance: currentBalance, balanceKind: whatsAppFinanceBalanceKind_(accountRole, currentBalance)
  };
}


/**
 * Pure text helpers: never read accounting data or output HTML markup.
 * Escape only when inserting into the browser DOM, not in WhatsApp text.
 */
function whatsAppPlainText_(value) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001F\u007F-\u009F]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function whatsAppMoneyText_(amount, currencySymbol) {
  const n = Number(amount);
  if (!Number.isFinite(n)) throw new Error('Invalid WhatsApp financial amount.');
  const symbol = whatsAppPlainText_(currencySymbol == null ? '৳' : currencySymbol);
  return symbol + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function whatsAppSignedMoneyText_(amount, currencySymbol) {
  const n = Number(amount);
  if (!Number.isFinite(n)) throw new Error('Invalid WhatsApp financial balance.');
  return (n < -0.004 ? '-' : '') + whatsAppMoneyText_(n, currencySymbol);
}

function whatsAppBalanceCopy_(kind, language) {
  const en = {
    customer_due: 'Outstanding due', customer_credit: 'Customer credit',
    supplier_payable: 'Supplier payable', supplier_advance: 'Supplier advance',
    lender_credit: 'Lender credit', lender_debit: 'Lender debit / advance',
    borrower_debit: 'Borrower receivable', borrower_credit: 'Borrower credit',
    owner_credit: 'Owner capital', owner_debit: 'Owner debit',
    settled: 'No outstanding balance'
  };
  const bn = {
    customer_due: 'বকেয়া পাওনা', customer_credit: 'গ্রাহকের জমা/অগ্রিম',
    supplier_payable: 'সরবরাহকারীর পাওনা', supplier_advance: 'সরবরাহকারীকে অগ্রিম',
    lender_credit: 'ঋণদাতার পাওনা', lender_debit: 'ঋণদাতার কাছে অগ্রিম',
    borrower_debit: 'ঋণগ্রহীতার কাছে পাওনা', borrower_credit: 'ঋণগ্রহীতার জমা',
    owner_credit: 'মালিকের মূলধন', owner_debit: 'মালিকের ডেবিট',
    settled: 'কোনো বকেয়া নেই'
  };
  const map = language === 'bn' ? bn : en;
  if (!Object.prototype.hasOwnProperty.call(map, kind)) {
    throw new Error('Unrecognized WhatsApp balance type.');
  }
  return map[kind];
}

function whatsAppEntryLine_(row, language, symbol) {
  const isFinance = Object.prototype.hasOwnProperty.call(row, 'financeId');
  const date = whatsAppPlainText_(isFinance ? row.date : row['Date']);
  const kind = whatsAppPlainText_(isFinance ? (row.transactionTypeLabel || row.transactionType) : row['Type']);
  const reference = whatsAppPlainText_(isFinance ? (row.referenceNo || row.financeId) : (row['Reference'] || row['Ledger ID']));
  const debit = Number(isFinance ? row.debit : row['Debit']) || 0;
  const credit = Number(isFinance ? row.credit : row['Credit']) || 0;
  const debitName = language === 'bn' ? 'ডেবিট' : 'Debit';
  const creditName = language === 'bn' ? 'ক্রেডিট' : 'Credit';
  return [date, kind, reference, debitName + ' ' + whatsAppMoneyText_(debit, symbol),
    creditName + ' ' + whatsAppMoneyText_(credit, symbol)].join(' | ');
}

/** Produce only Unicode text from a previously authorized server view. */
function whatsAppComposeText_(view, language) {
  if (language !== 'bn' && language !== 'en') throw new Error('Choose Bangla or English.');
  if (!view || !view.party || !view.business) throw new Error('WhatsApp source is unavailable.');
  const bn = language === 'bn';
  const currency = view.currencySymbol == null ? '৳' : view.currencySymbol;
  const name = whatsAppPlainText_(bn && view.business.nameBangla ? view.business.nameBangla : view.business.name) || 'Mohim ERP';
  const person = whatsAppPlainText_(view.party.name) || (bn ? 'নাম নেই' : 'Unnamed account');
  const roleLabel = view.source === 'financePerson' ? view.accountRole :
    view.source === 'supplier' ? (bn ? 'সরবরাহকারী' : 'Supplier') : (bn ? 'গ্রাহক' : 'Customer');
  if (!roleLabel) throw new Error('WhatsApp finance role is required.');
  const current = whatsAppMoneyText_(view.currentBalance, currency);
  const lines = [name];

  if (view.mode === 'due') {
    lines.push(whatsAppPlainText_(roleLabel) + ': ' + person);
    lines.push(whatsAppBalanceCopy_(view.balanceKind, language) + ': ' + current);
  } else {
    let heading = bn ? 'হিসাবের বিবরণ' : 'Ledger entries';
    if (view.mode === 'period') heading = bn ? 'হিসাব বিবরণী' : 'Ledger statement';
    else if (view.mode === 'single') heading = bn ? 'লেনদেনের বিবরণ' : 'Ledger entry';
    else if (view.mode === 'selected') heading = bn ? 'নির্বাচিত লেনদেন' : 'Selected entries';
    else throw new Error('Unknown WhatsApp sharing mode.');
    lines.push(heading + ' — ' + whatsAppPlainText_(roleLabel) + ': ' + person);
    const rows = Array.isArray(view.rows) ? view.rows : [];
    if (view.mode === 'period') {
      if (!view.period || !view.period.from || !view.period.to) throw new Error('Statement dates are missing.');
      lines.push((bn ? 'সময়কাল: ' : 'Period: ') + whatsAppPlainText_(view.period.from) +
        (bn ? ' থেকে ' : ' to ') + whatsAppPlainText_(view.period.to));
      lines.push((bn ? 'শুরুর জের: ' : 'Opening balance: ') + whatsAppSignedMoneyText_(view.openingBalance, currency));
    }
    if (!rows.length) {
      lines.push(bn ? 'এই সময়ে কোনো লেনদেন নেই' : 'No transactions in this period');
    } else {
      lines.push(bn ? 'লেনদেন:' : 'Transactions:');
      const limit = view.mode === 'period' ? 12 : rows.length;
      rows.slice(0, limit).forEach(function (row) {
        lines.push(whatsAppEntryLine_(row, language, currency));
      });
      if (view.mode === 'period' && rows.length > limit) {
        lines.push(bn ? 'দেখানো হয়েছে ' + rows.length + 'টির মধ্যে ' + limit + 'টি লেনদেন' :
          'Showing ' + limit + ' of ' + rows.length + ' entries');
      }
    }

    const allCount = rows.length;
    const totalSuffix = view.mode === 'period' && allCount > 12
      ? (bn ? ' (সব ' + allCount + 'টি)' : ' (all ' + allCount + ')') : '';
    lines.push((bn ? 'মোট ডেবিট' : 'Total debit') + totalSuffix + ': ' + whatsAppMoneyText_(view.totalDebit, currency));
    lines.push((bn ? 'মোট ক্রেডিট' : 'Total credit') + totalSuffix + ': ' + whatsAppMoneyText_(view.totalCredit, currency));
    if (view.mode === 'period') {
      lines.push((bn ? 'শেষ জের: ' : 'Closing balance: ') + whatsAppSignedMoneyText_(view.closingBalance, currency));
    }
    lines.push((bn ? 'বর্তমান হিসাবের জের: ' : 'Current account balance: ') + whatsAppSignedMoneyText_(view.currentBalance, currency));
  }
  lines.push(bn ? 'অনুগ্রহ করে হিসাবটি যাচাই করুন। ধন্যবাদ।' :
    'Please review your balance. Thank you.');
  return lines.join('\n');
}

/**
 * Authenticated RPC: compose from authoritative server state, never request
 * amounts/party names. No sending, contact updates, ledger writes or log here.
 */
function prepareWhatsAppMessage(token, request) {
  try {
    // Public RPC: refuse invalid sessions before disclosing validation details.
    // The selected source builder still enforces its own per-module view rights.
    requirePermission_(token, 'whatsappShare', 'edit');
    request = request || {};
    const language = request.language == null ? 'bn' : String(request.language);
    if (language !== 'bn' && language !== 'en') throw new Error('Language must be bn or en.');
    const source = request.source;
    if (source !== 'customer' && source !== 'supplier' && source !== 'financePerson') {
      throw new Error('Invalid WhatsApp sharing source.');
    }
    const snapshot = source === 'financePerson'
      ? whatsAppBuildFinanceSource_(token, request)
      : whatsAppBuildPartySource_(token, request);
    const settings = getSettingsMap_();
    const view = Object.assign({}, snapshot, { currencySymbol: settings['Currency Symbol'] || '৳' });
    const text = whatsAppComposeText_(view, language);

    // If the stored contact number is absent, allow a Copy-only preview.
    // An explicitly supplied alternate number must be valid and confirmed.
    const override = String(request.recipientOverride == null ? '' : request.recipientOverride).trim();
    const warnings = [];
    let recipient = null;
    if (override) {
      recipient = whatsAppResolveRecipient_(view.party.phone, override, request.confirmOverride);
    } else {
      try {
        recipient = whatsAppResolveRecipient_(view.party.phone, null, false);
      } catch (err) {
        warnings.push(language === 'bn'
          ? 'হোয়াটসঅ্যাপ নম্বর অনুপস্থিত বা ভুল। নম্বর যোগ করুন, অথবা মেসেজ কপি করুন।'
          : 'WhatsApp phone number is missing or invalid. Add a number or copy the message.');
      }
    }
    const rows = Array.isArray(view.rows) ? view.rows : [];
    const shown = view.mode === 'period' ? Math.min(rows.length, 12) : rows.length;
    if (view.mode === 'period' && rows.length > 12) {
      warnings.push(language === 'bn'
        ? 'প্রথম ১২টি লেনদেন দেখানো হয়েছে; সব লেনদেনের মোট হিসাব অন্তর্ভুক্ত।'
        : 'Showing 12 entries; totals include all period transactions.');
    }
    // 8,000 encoded characters is a conservative compatibility guard,
    // not a documented WhatsApp provider limit. Client builds URL on click.
    const fitsLink = encodeURIComponent(text).length + 30 + (recipient ? recipient.digits.length : 0) <= 8000;
    if (!fitsLink) {
      warnings.push(language === 'bn'
        ? 'মেসেজটি অনেক দীর্ঘ। কপি করে হোয়াটসঅ্যাপে পেস্ট করুন।'
        : 'Message is too long for the direct link. Copy and paste it into WhatsApp.');
    }
    const title = view.mode === 'due'
      ? (language === 'bn' ? 'বকেয়া ও জের' : 'Account balance')
      : view.mode === 'period' ? (language === 'bn' ? 'হিসাব বিবরণী' : 'Ledger statement')
      : view.mode === 'single' ? (language === 'bn' ? 'লেনদেন' : 'Ledger entry')
      : (language === 'bn' ? 'নির্বাচিত লেনদেন' : 'Selected entries');
    return ok_({
      recipient: recipient, partyName: whatsAppPlainText_(view.party.name),
      title: title, text: text, warnings: warnings, lineCount: shown,
      mode: view.mode, source: view.source, entityId: view.entityId,
      currentBalance: view.currentBalance,
      canOpenLink: !!recipient && fitsLink
    });
  } catch (err) {
    return fail_(err && err.message ? err.message : String(err));
  }
}


/**
 * Record an operator's attempt to open a manual wa.me draft, NOT sending or delivery.
 * Separate append-only sheet; never stores complete phone numbers or messages.
 * The current server ledger is reauthorized/revalidated to obtain true row count.
 */
function recordWhatsAppShare(token, request) {
  let lock = null, acquired = false;
  try {
    // Auth FIRST: public Google Apps Script RPC must not reveal request
    // validation, person identity, or audit logs to unauthenticated callers.
    const actor = requirePermission_(token, 'whatsappShare', 'edit');
    request = request || {};
    const eventKey = request.eventKey;
    if (typeof eventKey !== 'string' || !/^[a-zA-Z0-9_-]{16,90}$/.test(eventKey)) {
      throw new Error('Invalid WhatsApp open attempt identifier.');
    }
    const source = request.source;
    if (source !== 'customer' && source !== 'supplier' && source !== 'financePerson') {
      throw new Error('Invalid WhatsApp sharing source.');
    }

    const actorId = String(actor && actor['User ID'] || '').trim();
    if (!actorId) throw new Error('Unable to identify current ERP user.');
    // Validate the selected source and optional version fingerprints AGAIN at
    // click time. Never trust browser-supplied row totals or recipient digits.
    const snapshot = source === 'financePerson'
      ? whatsAppBuildFinanceSource_(token, request)
      : whatsAppBuildPartySource_(token, request);
    if (!snapshot || !snapshot.party) throw new Error('Unable to verify WhatsApp source.');
    if (String(snapshot.source || '') !== source ||
      String(snapshot.entityId || '') !== String(request.entityId || '') ||
      String(snapshot.mode || '') !== String(request.mode || '') ||
      (source === 'financePerson'
        ? String(snapshot.accountRole || '') !== String(request.accountRole || '')
        : !!String(request.accountRole || '').trim())) {
      throw new Error('WhatsApp source and account role mismatch.');
    }
    const recipient = whatsAppResolveRecipient_(snapshot.party.phone,
      request.recipientOverride, request.confirmOverride);
    const last4 = recipient.digits.slice(-4);
    const role = source === 'financePerson' ? String(snapshot.accountRole || '') : '';
    const entityId = String(snapshot.entityId || '');
    const mode = String(snapshot.mode || '');
    const rowCount = Number(snapshot.rowCount);
    if (!entityId || !['due','single','selected','period'].includes(mode) ||
      !Number.isSafeInteger(rowCount) || rowCount < 0 || (source === 'financePerson' && !role)) {
      throw new Error('WhatsApp source verification is incomplete.');
    }

    // The same key can only refer to the same actor and same canonical
    // attempt. Enforce idempotency under a cross-execution GAS ScriptLock.
    lock = LockService.getScriptLock();
    lock.waitLock(10000);
    acquired = true;
    const history = getAllRows_('WHATSAPP_SHARE_LOG');
    const prior = history.filter(function (r) { return String(r['Event Key'] || '') === eventKey; });
    if (prior.length > 1) throw new Error('Duplicate audit identifiers need review.');
    if (prior.length === 1) {
      const stored = prior[0];
      if (String(stored.Actor) !== actorId ||
          String(stored.Source) !== source || String(stored['Entity ID']) !== entityId ||
          String(stored['Account Role'] || '') !== role ||
          String(stored.Mode) !== mode ||
          String(stored['Recipient Last4']) !== last4 ||
          String(stored['Recipient Override']).toLowerCase() !== String(!!recipient.overridden)) {
        throw new Error('This WhatsApp audit identifier belongs to another attempt.');
      }
      return ok_({ eventId: String(stored['Event ID']), status: 'OPEN_ATTEMPTED', duplicate: true });
    }

    const eventId = generateId_('WHATSAPP_SHARE_LOG');
    appendRow_('WHATSAPP_SHARE_LOG', {
      'Event ID': eventId,
      'Event Key': eventKey,
      'Timestamp': new Date().toISOString(),
      'Actor': actorId,
      'Source': source,
      'Entity ID': entityId,
      'Account Role': role,
      'Mode': mode,
      'Row Count': rowCount,
      'Recipient Last4': last4,
      'Recipient Override': !!recipient.overridden,
      'Status': 'OPEN_ATTEMPTED'
    });
    return ok_({ eventId: eventId, status: 'OPEN_ATTEMPTED', duplicate: false });
  } catch (err) {
    // An audit failure cannot retroactively stop a synchronously opened link,
    // and is never a sent/delivered confirmation.
    return fail_(err && err.message ? err.message : String(err));
  } finally {
    if (acquired && lock) lock.releaseLock();
  }
}
