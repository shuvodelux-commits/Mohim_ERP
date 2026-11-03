/**
 * Phase 6 — read-only audit for an ISOLATED CLONE of Mohim ERP.
 *
 * IMPORTANT: tests/** is excluded by the repository's .claspignore. Do not
 * copy this into the live production or shared preview Apps Script project.
 * Copy it ONLY into a NEW disposable clone after deploying the reviewed PR
 * branch to that clone. It never writes Sheet cells or ERP rows.
 *
 * Before running, fill BOTH IDs from the disposable clone's URLs. Leave
 * source / production IDs out of source control.
 */
var PHASE6_CLONE_EXPECTED_ = {
  spreadsheetId: '', // REQUIRED: isolated CLONE spreadsheet ID
  scriptId: ''       // REQUIRED: isolated CLONE Apps Script project ID
};

function assertPhase6CloneIdentity_(expected, actualSpreadsheetId, actualScriptId) {
  var targetSpreadsheetId = String(expected && expected.spreadsheetId || '').trim();
  var targetScriptId = String(expected && expected.scriptId || '').trim();
  // This script ID is already in the repository's production .clasp.json.
  var productionScriptId = '11zr6QpAODCdXOaYIQwIOYbkiajSukagTOSj_z9TVjBR3TPJgJvgSHg27';
  var sharedPreviewScriptId = '1c1wtUuO0xISTw0JTfAKnqry28UeJaIcW8CWwJVDSo1Y31BbPad4glp4G';
  if (!targetSpreadsheetId || !targetScriptId ||
      /REPLACE|EXAMPLE|PLACEHOLDER/i.test(targetSpreadsheetId + ' ' + targetScriptId)) {
    throw new Error('Phase 6 clone IDs are not configured. Refusing to read business data.');
  }
  if (targetScriptId === productionScriptId || actualScriptId === productionScriptId ||
      targetScriptId === sharedPreviewScriptId || actualScriptId === sharedPreviewScriptId) {
    throw new Error('Phase 6 cannot run in production or the existing shared preview Apps Script project.');
  }
  if (String(actualSpreadsheetId) !== targetSpreadsheetId ||
      String(actualScriptId) !== targetScriptId) {
    throw new Error('Phase 6 clone spreadsheet/script identity mismatch.');
  }
  if (typeof CONFIG === 'undefined' || !CONFIG.SHEETS ||
      typeof readSalePaymentBreakdown_ !== 'function' ||
      typeof assertSalePaymentBookEvidence_ !== 'function') {
    throw new Error('The reviewed multi-payment source is not installed in this clone.');
  }
  return true;
}

/** Direct, read-only Sheet access: never call getSheet_/getAllRows_ here, as
 * those production helpers may opportunistically create/repair schema. */
function phase6ReadCloneRows_(spreadsheet, sheetKey) {
  var tab = spreadsheet.getSheetByName(CONFIG.SHEETS[sheetKey]);
  if (!tab) throw new Error('Missing expected clone sheet ' + sheetKey);
  var rowCount = tab.getLastRow();
  var colCount = tab.getLastColumn();
  if (rowCount < 1 || colCount < 1) throw new Error('Missing headers: ' + sheetKey);
  if (rowCount > 15001) {
    throw new Error(sheetKey + ' exceeds 15,000 rows. Use a smaller sanitized test clone.');
  }
  var headers = tab.getRange(1, 1, 1, colCount).getValues()[0].map(String);
  if (new Set(headers).size !== headers.length) {
    throw new Error('Duplicate column headers in ' + sheetKey);
  }
  if (rowCount === 1) return [];
  return tab.getRange(2, 1, rowCount - 1, colCount).getValues().map(function (values, index) {
    var result = { _rowIndex: index + 2 };
    headers.forEach(function (header, col) { result[header] = values[col]; });
    return result;
  });
}

function phase6IsDeleted_(row) {
  return row && (row['Is Deleted'] === true || String(row['Is Deleted'] || '').toUpperCase() === 'TRUE');
}

/**
 * Recompute BANK_ACCOUNTS Current Balance using the exact same opening and
 * reversal semantics as BankLedger.gs. No accounting rows are modified.
 *
 * Opening Balance is counted through the single backfill row, when present,
 * otherwise directly from the account master; never through both.
 * A Reversed row is normally excluded, except manual correction entries
 * with a linked opposite "Reversal Of" Bank Book entry.
 */
function phase6AuditBankMasters_(accounts, bankBookRows) {
  var issues = [];
  var byAccount = Object.create(null);
  var byEntry = Object.create(null);
  var reversalTargets = Object.create(null);
  var accountRows = Array.isArray(accounts) ? accounts : [];
  var movements = (Array.isArray(bankBookRows) ? bankBookRows : []).filter(function (r) {
    return !phase6IsDeleted_(r);
  });
  function signedPaisa(value,label) {
    if (value === '' || value === null || value === undefined) return 0;
    var raw = String(value).trim();
    if (!/^-?(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(raw)) {
      throw new Error(label + ' is not an exact-paisa value.');
    }
    return (raw.charAt(0) === '-' ? -1 : 1) *
      salePaymentPaisa_(raw.charAt(0) === '-' ? raw.slice(1) : raw,label,false);
  }
  accountRows.forEach(function (a) {
    var id = String(a['Bank Account ID'] || '').trim();
    if (!id || byAccount[id]) {
      issues.push({invoiceId:'',problem:'Duplicate or missing bank account ID'});
    } else byAccount[id] = a;
  });
  movements.forEach(function (row) {
    var entryId = String(row['Entry ID'] || '').trim();
    var accountId = String(row['Bank Account ID'] || '').trim();
    if (!entryId || byEntry[entryId]) {
      issues.push({invoiceId:'',problem:'Duplicate or missing Bank Book entry ID'});
    }
    if (entryId) byEntry[entryId] = row;
    if (row['Reversal Of']) reversalTargets[String(row['Reversal Of'])] = true;
    if (!byAccount[accountId] && String(row.Status) !== 'Reversed') {
      issues.push({invoiceId:'',problem:'Active Bank Book references unknown bank account ' + accountId});
    }
  });
  movements.forEach(function (row) {
    var originalId = String(row['Reversal Of'] || '').trim();
    if (!originalId) return;
    var original = byEntry[originalId];
    if (!original || String(original['Bank Account ID']) !== String(row['Bank Account ID'])) {
      issues.push({invoiceId:'',problem:'Bank reversal refers to missing or different account entry'});
    }
  });
  accountRows.forEach(function (a) {
    var id = String(a['Bank Account ID'] || '').trim();
    if (!id) return;
    try {
      var own = movements.filter(function(r){return String(r['Bank Account ID']) === id;});
      var included = own.filter(function (r) {
        return String(r.Status) !== 'Reversed' || reversalTargets[String(r['Entry ID'] || '')];
      });
      var openings = included.filter(function (r) { return String(r.Type) === 'Opening Balance'; });
      if (openings.length > 1) {
        issues.push({invoiceId:'',problem:'Multiple active opening balance entries for bank account ' + id});
      }
      var net = openings.length ? 0 : signedPaisa(a['Opening Balance'],'Opening Bank Balance');
      included.forEach(function (r) {
        net += salePaymentPaisa_(r.Credit || 0,'Bank Book credit',false) -
          salePaymentPaisa_(r.Debit || 0,'Bank Book debit',false);
        if (!Number.isSafeInteger(net)) throw new Error('Bank ledger paisa total overflow.');
      });
      var actual = signedPaisa(a['Current Balance'],'Stored Bank Balance');
      if (actual !== net) {
        issues.push({invoiceId:'',problem:'Bank master balance mismatch for account ' + id +
          ' (computed ' + net / 100 + ', stored ' + actual / 100 + ')'});
      }
    } catch (err) {
      issues.push({invoiceId:'',problem:'Bank master reconciliation failed for ' + id +
        ': ' + String(err.message || err)});
    }
  });
  return {bankAccountsChecked:accountRows.length,issues:issues};
}

/**
 * Run in the clone Apps Script editor: phase6CloneAudit_()
 * Returns PASS or FAIL with anonymized invoice IDs only; no PII is logged.
 * Never repairs, posts, soft-deletes, or migrates data.
 */
function phase6CloneAudit_() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error('No bound clone spreadsheet.');
  var scriptId = ScriptApp.getScriptId();
  assertPhase6CloneIdentity_(PHASE6_CLONE_EXPECTED_,spreadsheet.getId(),scriptId);

  var keys = ['SALES','SALE_PAYMENTS','SALE_POSTING_JOURNAL',
    'CASH_BOOK','BANK_BOOK','BANK_ACCOUNTS','SALES_RETURN'];
  var rows = {};
  keys.forEach(function (key) { rows[key] = phase6ReadCloneRows_(spreadsheet,key); });
  var salesById = Object.create(null), issues = [];
  var splitCount = 0, checkedCount = 0, deletedCount = 0;
  var bankMasterAudit = phase6AuditBankMasters_(rows.BANK_ACCOUNTS,rows.BANK_BOOK);
  issues = issues.concat(bankMasterAudit.issues);
  rows.SALES.forEach(function (sale) {
    var invoiceId = String(sale['Invoice ID'] || '');
    if (!invoiceId) return;
    if (salesById[invoiceId]) {
      issues.push({invoiceId:invoiceId,problem:'Duplicate invoice ID'});
    }
    salesById[invoiceId] = sale;
  });
  rows.SALES.forEach(function (sale) {
    if (String(sale['Payment Detail Version'] || '') !== '1') return;
    splitCount++;
    var invoiceId = String(sale['Invoice ID'] || '');
    if (phase6IsDeleted_(sale)) {
      deletedCount++;
      return;
    }
    try {
      var payments = readSalePaymentBreakdown_(sale,rows.SALE_PAYMENTS);
      assertSalePaymentBookEvidence_(invoiceId,payments,rows.CASH_BOOK,rows.BANK_BOOK);
      var total = Number(sale['Grand Total']) || 0;
      var paid = Number(sale['Paid Amount']) || 0;
      var due = Number(sale['Due Amount']) || 0;
      if (Math.abs((paid + due) - total) > 0.004) {
        throw new Error('Checkout total, paid and due do not reconcile.');
      }
      checkedCount++;
    } catch (err) {
      issues.push({invoiceId:invoiceId,problem:String(err.message || err)});
    }
  });

  // Active payment children must have one active, versioned parent.
  rows.SALE_PAYMENTS.forEach(function (payment) {
    if (String(payment.Status) !== 'Active') return;
    var invoiceId = String(payment['Invoice ID'] || '');
    var sale = salesById[invoiceId];
    if (!sale || phase6IsDeleted_(sale) || String(sale['Payment Detail Version'] || '') !== '1') {
      issues.push({invoiceId:invoiceId,problem:'Orphan active payment child'});
    }
  });
  var journalIds = Object.create(null), journalNeedsReview = 0;
  rows.SALE_POSTING_JOURNAL.forEach(function (journal) {
    var operationId = String(journal['Operation ID'] || '');
    var invoiceId = String(journal['Invoice ID'] || '');
    if (!operationId) {
      issues.push({invoiceId:invoiceId,problem:'Journal missing operation ID'});
    } else if (journalIds[operationId]) {
      issues.push({invoiceId:invoiceId,problem:'Duplicate journal operation ID'});
    }
    journalIds[operationId] = true;
    if (String(journal.State) !== 'Committed') {
      journalNeedsReview++;
      issues.push({invoiceId:invoiceId,problem:'Posting journal not committed: ' + String(journal.State)});
    }
  });
  rows.SALES_RETURN.forEach(function (ret) {
    if (phase6IsDeleted_(ret)) return;
    var invoiceId = String(ret['Invoice ID'] || '');
    var parent = salesById[invoiceId];
    if (!parent || phase6IsDeleted_(parent)) {
      issues.push({invoiceId:invoiceId,problem:'Active return has no active invoice'});
    }
    // For Cash refund eligibility, verify Customer Settlement attribution
    // separately in the authenticated operator flow. Never guess that
    // cash-only original checkout amount is the sole eligible provenance.
  });

  var report = {
    status:issues.length ? 'FAIL':'PASS',
    mode:'READ_ONLY_ISOLATED_CLONE',
    spreadsheetId:spreadsheet.getId(),
    scriptId:scriptId,
    testedAt:new Date().toISOString(),
    splitInvoices:splitCount,
    activeSplitInvoicesChecked:checkedCount,
    deletedSplitInvoices:deletedCount,
    bankAccountsChecked:bankMasterAudit.bankAccountsChecked,
    uncommittedJournals:journalNeedsReview,
    issues:issues.slice(0,200),
    issueCount:issues.length,
    truncatedIssues:issues.length>200
  };
  Logger.log(JSON.stringify(report));
  return report;
}
