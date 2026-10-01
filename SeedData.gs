/**
 * SeedData.gs
 * ---------------------------------------------------------------------
 * Optional helpers for getting realistic sample data into the sheets
 * before the Products / Purchase / POS / Customers screens exist
 * (Phases 2-4), and for wiping that sample data back out once you're
 * ready to go live. Neither is required — you can also just type rows
 * straight into the sheets; see README.md for the manual guide.
 * ---------------------------------------------------------------------
 */

function seedDemoData_() {
  const ui = SpreadsheetApp.getUi();
  const settings = getSettingsMap_();
  if (settings['Demo Data Loaded'] === 'yes') {
    ui.alert('Demo data already loaded', 'Run "Clear All Data" first if you want to reload it.', ui.ButtonSet.OK);
    return fail_('Already loaded');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    const products = seedProducts_(seedSuppliers_());
    seedStockMovement_(products);
    const customers = seedCustomers_();
    seedCustomerLedger_(customers);
    seedCashBookOpening_();

    setSetting_('Demo Data Loaded', 'yes');
    SpreadsheetApp.flush();

    ui.alert(
      'Demo data loaded',
      '4 suppliers, 11 products, 3 customers with dues, opening stock and an opening cash balance were added. Check the Products, Customers and Cash Book sheets.',
      ui.ButtonSet.OK
    );
    return ok_('seeded');
  } catch (err) {
    logError_('seedDemoData', err);
    ui.alert('Something went wrong: ' + err.message);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

function seedSuppliers_() {
  const list = [
    { name: 'RFL Plastic',      phone: '01711-000001', address: 'Tejgaon, Dhaka' },
    { name: 'Gazi Pipe',        phone: '01711-000002', address: 'Savar, Dhaka' },
    { name: 'Bengal Plastic',   phone: '01711-000003', address: 'Narayanganj' },
    { name: 'National Polymer', phone: '01711-000004', address: 'Gazipur' }
  ];
  const seeded = list.map(function (s) {
    const id = generateId_('SUPPLIERS');
    return {
      id: id,
      row: {
        'Supplier ID': id, 'Supplier Name': s.name, 'Phone': s.phone,
        'Address': s.address, 'Notes': 'Demo supplier', 'Status': 'Active',
        'Created At': new Date()
      }
    };
  });
  appendRows_('SUPPLIERS', seeded.map(function (s) { return s.row; }));
  const map = {};
  seeded.forEach(function (s) { map[s.row['Supplier Name']] = s.id; });
  return map; // { 'RFL Plastic': 'SUP-000001', ... }
}

function seedProducts_() {
  // [name, category, supplierName, unit, purchasePrice, sellingPrice, stock, minStock]
  const list = [
    ['PVC Pipe 1"',                 'Pipe',       'RFL Plastic',      'pcs',    220,  260, 150, 20],
    ['CPVC Pipe 3/4"',              'Pipe',       'Gazi Pipe',        'pcs',    260,  300,  90, 15],
    ['UPVC Pipe 2"',                'Pipe',       'Bengal Plastic',   'pcs',    340,  390,  60, 10],
    ['Elbow 1"',                    'Fitting',    'RFL Plastic',      'pcs',     18,   25, 300, 40],
    ['Tee 1"',                      'Fitting',    'RFL Plastic',      'pcs',     22,   30, 250, 40],
    ['Socket 1"',                   'Fitting',    'Gazi Pipe',        'pcs',     12,   18, 300, 40],
    ['Valve 1" Ball',               'Tap & Valve','National Polymer', 'pcs',    180,  230,  45, 10],
    ['Tap - Bib Cock',              'Tap & Valve','National Polymer', 'pcs',    150,  200,  60, 10],
    ['Glue - Solvent Cement 250ml', 'Adhesive',   'Bengal Plastic',   'bottle',  90,  120,  40,  8],
    ['Water Tank 500L',             'Tank',       'RFL Plastic',      'pcs',   5200, 5800,   8,  2],
    ['Fittings - Reducer 1x0.75',   'Fitting',    'Gazi Pipe',        'pcs',     15,   22, 200, 30]
  ];
  const seeded = list.map(function (p) {
    const id = generateId_('PRODUCTS');
    return {
      id: id, name: p[0], stock: p[6],
      row: {
        'Product ID': id, 'Product Name': p[0], 'Category': p[1],
        'Supplier': p[2], 'Unit': p[3], 'Barcode': '',
        'Purchase Price': p[4], 'Selling Price': p[5],
        'Current Stock': p[6], 'Minimum Stock': p[7], 'Status': 'Active',
        'Created At': new Date(), 'Updated At': new Date()
      }
    };
  });
  appendRows_('PRODUCTS', seeded.map(function (s) { return s.row; }));
  return seeded; // [{ id, name, stock }, ...]
}

function seedStockMovement_(products) {
  const rows = products.map(function (p) {
    return {
      'Movement ID': generateId_('STOCK_MOVEMENT'), 'Date': new Date(),
      'Product ID': p.id, 'Product Name': p.name, 'Type': 'Opening Stock',
      'Reference': 'DEMO', 'Quantity In': p.stock, 'Quantity Out': '',
      'Balance Stock': p.stock, 'Notes': 'Demo seed data'
    };
  });
  appendRows_('STOCK_MOVEMENT', rows);
}

function seedCustomers_() {
  // [name, phone, address, due]
  const list = [
    ['Karim Hardware & Sons',  '01911-100001', 'Mirpur, Dhaka',       4500],
    ['Rahim Traders',          '01911-100002', 'Uttara, Dhaka',       1200],
    ['Nasir Plumbing Works',   '01911-100003', 'Mohammadpur, Dhaka',   800]
  ];
  const seeded = list.map(function (c) {
    const id = generateId_('CUSTOMERS');
    return {
      id: id, name: c[0], due: c[3],
      row: {
        'Customer ID': id, 'Customer Name': c[0], 'Phone': c[1],
        'Address': c[2], 'Opening Balance': c[3], 'Current Due': c[3],
        'Status': 'Active', 'Notes': 'Demo customer', 'Created At': new Date()
      }
    };
  });
  appendRows_('CUSTOMERS', seeded.map(function (s) { return s.row; }));
  return seeded; // [{ id, name, due }, ...]
}

function seedCustomerLedger_(customers) {
  const rows = customers.map(function (c) {
    return {
      'Ledger ID': generateId_('CUSTOMER_LEDGER'), 'Date': new Date(),
      'Customer ID': c.id, 'Customer Name': c.name, 'Type': 'Opening Balance',
      'Reference': 'DEMO', 'Debit': c.due, 'Credit': '', 'Balance': c.due,
      'Notes': 'Demo seed data'
    };
  });
  appendRows_('CUSTOMER_LEDGER', rows);
}

function seedCashBookOpening_() {
  addCashBookEntry_({
    Type: 'Opening Balance', Reference: 'DEMO', Description: 'Demo opening cash balance',
    Debit: '', Credit: 50000, PaymentMethod: 'Cash'
  });
}

/**
 * Wipes every transactional sheet back to just its header row and resets
 * the matching ID counters. Always asks for confirmation first — this
 * cannot be undone.
 *
 * Review item 4. The old version listed 15 sheets by hand and missed
 * twelve: Supplier Ledger, Stock Lots, Sale Item Lots, Purchase Return
 * Items, Expense Categories, Expense Ledgers, Invoice Edit Log, all
 * three Bank sheets, Delete Log and Sessions. Then it reset EVERY ID
 * counter to zero. Two things went wrong as a result:
 *
 *   - Surviving Stock Lots rows kept live Remaining Quantity, so cleared
 *     stock reappeared through FIFO, and the next generateId_('STOCK_LOTS')
 *     handed out LOT-000001 again — colliding with a lot that still existed.
 *   - Supplier dues survived with no supplier rows behind them.
 *
 * Now the list is derived from CONFIG.SHEETS minus an explicit keep-list,
 * so a sheet added to Config in future is cleared automatically instead of
 * being silently forgotten. Counters are reset ONLY for the sheets that
 * were actually cleared — resetting USR/ROL while Users and Roles survive
 * would hand out IDs that already exist.
 */

/**
 * Sheets that survive "Clear All Data": configuration and identity, not
 * transactions. Everything else in CONFIG.SHEETS gets emptied.
 */
const CLEAR_ALL_KEEP_KEYS = ['SETTINGS', 'LOGS', 'USERS', 'ROLES', 'SESSIONS'];
function clearAllData_() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.alert(
    'Clear all data?',
    'This deletes every row in Products, Suppliers, Purchases, Sales, Customers, Ledger, Expenses, Cash Book, Stock Movement and Returns. Settings are kept. This cannot be undone.',
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return fail_('Cancelled');

  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    // Derived, not hand-listed — a new sheet in Config.gs is covered
    // automatically instead of being quietly left behind.
    const keysToClear = Object.keys(CONFIG.SHEETS).filter(function (key) {
      return CLEAR_ALL_KEEP_KEYS.indexOf(key) === -1;
    });
    keysToClear.forEach(function (key) {
      const sheet = getSheet_(key);
      const lastRow = sheet.getLastRow();
      if (lastRow > 1) sheet.deleteRows(2, lastRow - 1);
    });
    // This is the one place that writes to sheets without going through
    // Database.gs, so it has to drop the per-execution read cache itself -
    // otherwise setSetting_ below would still see the pre-wipe rows.
    invalidateSheetCache_();

    // Only the counters whose sheet was actually emptied. Resetting a
    // counter for a sheet that still holds rows would reissue IDs that
    // already exist.
    const props = PropertiesService.getDocumentProperties();
    Object.keys(CONFIG.ID_PREFIX).forEach(function (key) {
      if (keysToClear.indexOf(key) === -1) return;
      props.setProperty('ID_COUNTER_' + key, '0');
    });
    setSetting_('Demo Data Loaded', 'no');

    SpreadsheetApp.flush();
    ui.alert(
      'All data cleared',
      keysToClear.length + ' sheet(s) emptied and their ID counters reset.\n\n' +
      'Kept: ' + CLEAR_ALL_KEEP_KEYS.join(', ') + '.',
      ui.ButtonSet.OK
    );
    return ok_('cleared');
  } catch (err) {
    logError_('clearAllData', err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}
