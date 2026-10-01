/**
 * Diagnostics.gs
 * ---------------------------------------------------------------------
 * A self-test you run from the Apps Script editor when the web app says
 * a server function is missing.
 *
 * WHY THIS FILE EXISTS. Apps Script puts every .gs file into ONE shared
 * global scope. If any single file fails to parse, the whole project
 * fails to load and NONE of the functions are published - so the browser
 * reports the first function it happened to ask for as "missing", which
 * sends you hunting in the wrong file. The real cause is almost never
 * the function named in the error.
 *
 * HOW TO USE IT
 *   1. Extensions -> Apps Script
 *   2. Pick diagnoseProject_ in the function dropdown
 *   3. Run, then View -> Logs
 *
 * If the project has a syntax error, step 3 fails immediately and the
 * editor names the offending FILE AND LINE. That message is the answer;
 * google.script.run can never give it to you.
 *
 * If it runs, the log tells you which expected functions are actually
 * published and which are genuinely absent.
 *
 * THE USUAL CULPRIT: a file pasted as a NEW script file instead of over
 * the existing one, leaving two copies of `const CONFIG` or
 * `const NAV_ITEMS`. Re-declaring a const in the same scope is a hard
 * SyntaxError, so the entire project stops loading. checkForDuplicates_()
 * below catches exactly that.
 * ---------------------------------------------------------------------
 */

/**
 * True when a global function of this name is published.
 * Resolved through globalThis rather than `this`, because inside a nested
 * callback `this` is not the global object in V8 - which would have made
 * every function look missing and sent you chasing a phantom.
 */
function functionExists_(name) {
  // globalThis is the direct route and is what Apps Script's V8 runtime
  // populates with every top-level function in every .gs file.
  try {
    if (typeof globalThis !== 'undefined' && typeof globalThis[name] === 'function') return true;
  } catch (e) { /* fall through */ }
  // Fallback for any scope where declarations are not hung off globalThis.
  // The names come from EXPECTED_SERVER_FUNCTIONS_ above - our own constant,
  // never user input - so there is nothing here to inject.
  try {
    return eval('typeof ' + name) === 'function';
  } catch (e) {
    return false;
  }
}

/** Every server function the client calls, grouped by the page that needs it. */
var EXPECTED_SERVER_FUNCTIONS_ = {
  'Shell / auth': ['doGet', 'getAppShellData', 'login', 'validateSession', 'logout'],
  'Sales':        ['getSalesManagementList', 'getSalesManagementBankAccounts', 'getSaleDetail',
                   'getSaleForUpdate', 'updateSale', 'deleteSalesInvoice'],
  'Purchase':     ['getPurchaseBootstrap', 'createPurchase', 'getPurchaseManagementList',
                   'getPurchaseDetail', 'getPurchaseForUpdate', 'updatePurchase', 'deletePurchase'],
  'POS':          ['completeSale', 'getCashSessionSummary', 'getPosBootstrap'],
  'Products':     ['getProductsBootstrap', 'addProduct', 'updateProduct', 'adjustStock', 'deleteProduct'],
  'Customers':    ['getCustomersBootstrap', 'addCustomerChecked', 'updateCustomer',
                   'getCustomerDetail', 'receivePayment', 'deleteCustomer',
                   'updateCustomerPayment', 'deleteCustomerPayment'],
  'Suppliers':    ['getSuppliers', 'getSuppliersBootstrap', 'addSupplier', 'updateSupplier',
                   'getSupplierDetail', 'paySupplier', 'setSupplierStatus', 'deleteSupplier',
                   'getSupplierPaymentForEdit', 'updateSupplierPayment', 'deleteSupplierPayment'],
  'Expense':      ['getExpenseBootstrap', 'addExpense', 'getExpenseList', 'updateExpense',
                   'cancelExpense', 'deleteExpense'],
  'Finance':      ['getFinanceBootstrap', 'addFinanceTransaction', 'getFinanceLedger',
                   'getFinanceTransactionForEdit', 'updateFinanceTransaction', 'deleteFinanceTransaction'],
  'Bank':         ['getBankLedgerBootstrap', 'getBankLedger', 'addBankManualEntry',
                   'reverseBankEntry', 'deleteBankTransaction'],
  'Day Book':     ['getDayBookBootstrap', 'getDayBookTransactions', 'deleteDayBookEntry'],
  'Reports':      ['getSalesReport', 'getPurchaseReport', 'getStockReport'],
  'Admin':        ['getUsers', 'createUser', 'getRoles', 'updateRole',
                   'getDeletedRecords', 'getDeletableModules']
};

/**
 * Main entry point. Run this from the editor.
 * Reaching the log at all already proves the project parses.
 */
function diagnoseProject_() {
  var out = [];
  out.push('=================================================');
  out.push(' Sher ERP - project diagnostic');
  out.push(' ' + new Date());
  out.push('=================================================');
  out.push('');
  out.push('This message appearing at all means the project LOADED.');
  out.push('If a function still reports as missing in the browser, it is');
  out.push('not a syntax error - check the list below, then redeploy.');
  out.push('');

  // ---- 1. published functions ----
  var missing = [];
  var present = 0, total = 0;
  out.push('--- 1. Server functions the client expects ---');
  Object.keys(EXPECTED_SERVER_FUNCTIONS_).forEach(function (group) {
    var names = EXPECTED_SERVER_FUNCTIONS_[group];
    var absent = names.filter(function (n) {
      total++;
      var found = functionExists_(n);
      if (found) present++; else missing.push(group + ' :: ' + n);
      return !found;
    });
    out.push('  ' + (absent.length ? 'X' : 'OK') + '  ' + group +
             '  (' + (names.length - absent.length) + '/' + names.length + ')' +
             (absent.length ? '  MISSING: ' + absent.join(', ') : ''));
  });
  out.push('');
  out.push('  Total: ' + present + '/' + total + ' present.');
  out.push('');

  // ---- 2. duplicate declarations ----
  out.push('--- 2. Duplicate-file check ---');
  out.push(checkForDuplicates_().join('\n'));
  out.push('');

  // ---- 3. schema ----
  out.push('--- 3. Sheets ---');
  out.push(checkSheets_().join('\n'));
  out.push('');

  // ---- 4. verdict ----
  out.push('--- Verdict ---');
  if (!missing.length) {
    out.push('  Every expected function is published.');
    out.push('  If the browser still says one is missing, the DEPLOYED');
    out.push('  version is stale. Deploy > Manage deployments > edit >');
    out.push('  New version > Deploy. The /exec URL serves the last');
    out.push('  deployed version, not the code you just saved.');
  } else {
    out.push('  ' + missing.length + ' function(s) genuinely absent:');
    missing.forEach(function (m) { out.push('    - ' + m); });
    out.push('');
    out.push('  These files have not been pasted in yet, or were pasted');
    out.push('  into a file that was then renamed. Add the missing ones.');
  }

  var text = out.join('\n');
  Logger.log(text);
  return text;
}

/**
 * Detects the classic breakage: one script file pasted in twice.
 * Two copies of `const CONFIG` in one scope is a SyntaxError that stops
 * the whole project loading. If you are reading this output at all the
 * project did load, so this checks for the softer version - the same
 * logical sheet or nav entry defined more than once.
 */
function checkForDuplicates_() {
  var out = [];
  try {
    var names = {};
    var dupes = [];
    Object.keys(CONFIG.SHEETS).forEach(function (k) {
      var n = CONFIG.SHEETS[k];
      if (names[n]) dupes.push(n + ' (keys ' + names[n] + ' and ' + k + ')');
      names[n] = k;
    });
    out.push(dupes.length
      ? '  X  Two CONFIG keys point at the same sheet: ' + dupes.join('; ')
      : '  OK  All ' + Object.keys(CONFIG.SHEETS).length + ' CONFIG sheet names are unique.');

    if (typeof NAV_ITEMS !== 'undefined') {
      var seen = {}, navDupes = [];
      NAV_ITEMS.forEach(function (i) {
        if (seen[i.key]) navDupes.push(i.key);
        seen[i.key] = true;
      });
      out.push(navDupes.length
        ? '  X  Duplicate nav keys: ' + navDupes.join(', ')
        : '  OK  Nav has ' + NAV_ITEMS.length + ' unique top-level entries.');
    }
  } catch (e) {
    out.push('  X  Could not inspect CONFIG: ' + e.message);
  }
  return out;
}

/** Confirms every configured sheet exists and reports its width and row count. */
function checkSheets_() {
  var out = [];
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var missing = [];
  Object.keys(CONFIG.SHEETS).forEach(function (key) {
    var name = CONFIG.SHEETS[key];
    var sh = ss.getSheetByName(name);
    if (!sh) { missing.push(name); return; }
    var declared = (CONFIG.HEADERS[key] || []).length;
    var actual = sh.getLastColumn();
    if (declared && actual < declared) {
      out.push('  !  ' + name + ': ' + actual + ' columns on the sheet, ' + declared +
               ' declared. Run Setup / Repair System to add the rest.');
    }
  });
  if (missing.length) out.push('  X  Missing sheets: ' + missing.join(', ') + '  (run Setup / Repair System)');
  if (!out.length) out.push('  OK  All ' + Object.keys(CONFIG.SHEETS).length + ' sheets exist and are wide enough.');
  return out;
}

/**
 * Confirms the soft-delete columns landed on every sheet that needs them.
 * Run once after pasting the new Config.gs and running Setup / Repair.
 */
function checkDeleteColumns_() {
  var need = ['SALES', 'PURCHASES', 'EXPENSES', 'SUPPLIERS', 'PRODUCTS', 'CUSTOMERS',
              'SUPPLIER_LEDGER', 'CUSTOMER_LEDGER', 'CASH_BOOK', 'SALES_RETURN', 'PURCHASE_RETURN',
              'FINANCE_TRANSACTIONS'];
  var out = ['--- Soft-delete columns ---'];
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  need.forEach(function (key) {
    var sheetName = CONFIG.SHEETS[key];
    var sheet = ss.getSheetByName(sheetName);
    var headers = [];
    if (sheet && sheet.getLastColumn() > 0) {
      headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    }
    var have = ['Is Deleted', 'Deleted By', 'Deleted At', 'Delete Reason']
      .filter(function (c) { return headers.indexOf(c) !== -1; });
    out.push('  ' + (have.length === 4 ? 'OK ' : 'X  ') + sheetName +
             ': ' + have.length + '/4');
  });
  var text = out.join('\n');
  Logger.log(text);
  return text;
}
