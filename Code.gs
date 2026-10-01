/**
 * Code.gs
 * ---------------------------------------------------------------------
 * MERGED FINAL VERSION: two menu items added to onOpen - "Create First
 * Administrator" (UserManagement.gs) and "Backfill Bank Opening
 * Balances" (BankLedger.gs). Nothing else changed.
 *
 * Web app entry point. Keep this file thin — it only wires the HTTP
 * request to index.html and gives every partial a way to include
 * style.html / javascript.html / the page files.
 * ---------------------------------------------------------------------
 */

function doGet(e) {
  let title = CONFIG.APP_NAME;
  try {
    const settings = getSettingsMap_();
    if (settings['Shop Name']) title = settings['Shop Name'];
  } catch (err) {
    // Sheet not set up yet — fall back to the default title, the app
    // shell itself will prompt for setup once it loads.
  }

  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle(title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Lets index.html pull in style.html / javascript.html / page partials via <?!= include('name'); ?> */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/** Adds a menu inside the Google Sheet for first-time setup and quick access to the app. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Hardware ERP')
    .addItem('Setup / Repair System', 'setupSystem_')
    .addItem('Create First Administrator', 'createFirstAdmin_')
    .addItem('Open App URL', 'showAppUrl_')
    .addSeparator()
    .addItem('Load Demo Data', 'seedDemoData_')
    .addItem('Backfill Bank Opening Balances', 'backfillBankOpeningEntries_')
    .addItem('Sync ID Counters (after manual edits)', 'syncIdCounters_')
    .addItem('Migrate Opening Stock Lots', 'migrateOpeningStockLots_')
    .addItem('Reconcile Product Stock from Lots', 'reconcileProductStocksFromLots_')
    .addItem('Clear All Data (danger)', 'clearAllData_')
    .addToUi();
}

function showAppUrl_() {
  const url = ScriptApp.getService().getUrl();
  const ui = SpreadsheetApp.getUi();
  if (url) {
    ui.alert('Open the app', url, ui.ButtonSet.OK);
  } else {
    ui.alert('Not deployed yet', 'Deploy this project as a web app first (Deploy > New deployment), then run this again.', ui.ButtonSet.OK);
  }
}
