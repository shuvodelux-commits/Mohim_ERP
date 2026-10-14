/**
 * UI.gs
 * ---------------------------------------------------------------------
 * Server-side helpers that feed the navigation shell in index.html.
 * Business-logic modules plug their own functions in; this file only owns
 * the shell itself: what pages exist, and what the header shows.
 *
 * ---------------------------------------------------------------------
 * NAVIGATION vs PERMISSIONS — two lists, on purpose
 * ---------------------------------------------------------------------
 * NAV_ITEMS is presentation: what the sidebar shows, and which pages sit
 * underneath which. PERMISSION_MODULES is policy: what a role can be
 * granted. They used to be the same list, which stopped working the
 * moment a page moved.
 *
 * Returns is now a tab under Sales, and Users/Roles are tabs under
 * Settings — but Returns still needs its OWN permission, because "may
 * ring up a sale" and "may refund one" are different rights. Deriving the
 * permission grid from the sidebar would have silently revoked Returns
 * from every non-admin role the moment it stopped being a top-level item.
 *
 * A child whose key equals its parent's is that group's own landing page
 * (Sales > Invoices, Settings > General).
 *
 * The `key` doubles as the data-page attribute in index.html, the module
 * key in Auth.gs, and the ICONS lookup in javascript.html — keep those in
 * step when adding a page.
 * ---------------------------------------------------------------------
 */

// Every entry's optional `bn` is a short, everyday-Bangla helper shown as a
// small secondary line under the English label (sidebar, sub-nav tabs, and
// the topbar title all read it straight off these same objects — see
// buildNav_/renderSubNav_/goToPage in javascript.html). Purely cosmetic:
// never read for routing/permissions, so it's safe to reword freely.
const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard',     icon: 'dashboard', bn: 'আজকের অবস্থা', sidebarGroup: 0, sidebarOrder: 10 },
  {
    key: 'pos', label: 'POS', icon: 'pos', bn: 'ক্যাশ কাউন্টার', sidebarGroup: 0, sidebarOrder: 20, landingKey: 'posv2',
    // POS V2 is the only user-facing POS route. The shared operational
    // runtime still lives in pos.html; Classic is intentionally not exposed.
    children: [
      { key: 'posv2', label: 'POS V2', bn: 'SherHisab ডিজাইন', permKey: 'pos' }
    ]
  },
  { key: 'counter',   label: 'Counter',       icon: 'counter',   bn: 'দ্রুত লেনদেন', sidebarGroup: 0, sidebarOrder: 25, actionPermAny: [
    { module: 'customers', action: 'edit' },
    { module: 'suppliers', action: 'edit' },
    { module: 'expense', action: 'add' },
    { module: 'bank', action: 'add' }
  ] },
  {
    key: 'sales', label: 'Sales', icon: 'sales', bn: 'বিক্রি', sidebarGroup: 1, sidebarOrder: 30,
    children: [
      { key: 'sales',         label: 'Sales Invoice', bn: 'বিক্রির রশিদ' },
      { key: 'draftSales', label: 'Draft Invoices', bn: 'খসড়া বিক্রি', actionPermAny: [
        { module: 'pos', action: 'add' },
        { module: 'sales', action: 'edit' }
      ] },
      { key: 'returns',       label: 'New Return',    bn: 'বিক্রি ফেরত' },
      // Rides on the 'returns' permission (not its own PERMISSION_MODULES
      // entry) via permKey — New Return and Return History are the same
      // right ("may process a refund"), just two separate pages now instead
      // of one page with an internal tab strip. See subNavVisible_.
      { key: 'returnHistory', label: 'Return History', bn: 'আগের ফেরতের তালিকা', permKey: 'returns' }
    ]
  },
  { key: 'purchase',  label: 'Purchases',     icon: 'purchase',  bn: 'কেনা', sidebarGroup: 2, sidebarOrder: 50 },
  {
    key: 'suppliers', label: 'Suppliers', icon: 'suppliers', bn: 'সাপ্লায়ার ও বাকি', sidebarGroup: 2, sidebarOrder: 60,
    children: [
      { key: 'suppliers', label: 'Suppliers', bn: 'সাপ্লায়ার তালিকা' },
      { key: 'supplierLedger', label: 'Supplier Ledger', bn: 'সাপ্লায়ার খতিয়ান', permKey: 'suppliers' }
    ]
  },
  // Vendor is a grouped workspace: the existing ledger/manage list plus
  // a dedicated transaction workspace. Both ride on the same 'vendors'
  // permission module; vendorWorkspace is presentation only.
  {
    key: 'vendors', label: 'Vendor', icon: 'vendors', bn: 'ভেন্ডর', sidebarGroup: 2, sidebarOrder: 70,
    children: [
      { key: 'vendors', label: 'Vendor Ledger', bn: 'ভেন্ডরের হিসাব' },
      { key: 'vendorWorkspace', label: 'Vendor Workspace', bn: 'ভেন্ডরের কাজ', permKey: 'vendors' }
    ]
  },
  { key: 'products',  label: 'Products',      icon: 'products',  bn: 'পণ্য ও স্টক', sidebarGroup: 1, sidebarOrder: 45 },
  {
    key: 'customers', label: 'Customers', icon: 'customers', bn: 'কাস্টমার ও বাকি', sidebarGroup: 1, sidebarOrder: 40,
    children: [
      { key: 'customers', label: 'Customers', bn: 'কাস্টমার তালিকা' },
      { key: 'customerLedger', label: 'Customer Ledger', bn: 'কাস্টমার খতিয়ান', permKey: 'customers' }
    ]
  },
  { key: 'bank',      label: 'Bank Accounts', icon: 'bank',      bn: 'ব্যাংকের হিসাব', sidebarGroup: 4, sidebarOrder: 100 },
  {
    key: 'expense', label: 'Expenses', icon: 'expense', bn: 'খরচ', sidebarGroup: 4, sidebarOrder: 110,
    // Flat direct pages — no nested tab strip inside any of them. All
    // ride on the single 'expense' permission via permKey where the page's
    // own key doesn't literally match it (same pattern as Sales > Return
    // History riding on 'returns').
    children: [
      { key: 'expense',            label: 'Add Expense',        bn: 'খরচ লিখুন' },
      { key: 'expenseList',        label: 'Expense History',    bn: 'খরচের ইতিহাস',  permKey: 'expense' },
      { key: 'expenseCategories',  label: 'Expense Categories', bn: 'খরচের ধরন',     permKey: 'expense' },
      { key: 'expenseReports',     label: 'Report',             bn: 'খরচের রিপোর্ট', permKey: 'expense' }
    ]
  },
  {
    key: 'finance', label: 'Business Finance', icon: 'finance', bn: 'মালিকের টাকা ও ঋণ', sidebarGroup: 4, sidebarOrder: 120,
    children: [
      { key: 'finance',       label: 'Business Finance', bn: 'টাকা জমা বা তোলা' },
      { key: 'financeLedger', label: 'Finance Ledger',   bn: 'লেনদেনের হিসাব', permKey: 'finance' },
      { key: 'financePersonLedger', label: 'Person Ledger', bn: 'ব্যক্তির হিসাব', permKey: 'finance' }
    ]
  },
  { key: 'daybook',   label: 'Day Book',      icon: 'daybook', bn: 'আজকের সব লেনদেন', sidebarGroup: 4, sidebarOrder: 90 },
  { key: 'cashReconciliation', label: 'Cash Reconciliation', icon: 'cashReconciliation', bn: 'ক্যাশ মিল', sidebarGroup: 4, sidebarOrder: 95 },
  { key: 'reports',   label: 'Reports',       icon: 'reports', bn: 'ব্যবসার রিপোর্ট', sidebarGroup: 5, sidebarOrder: 130 },
  {
    key: 'settings', label: 'Settings', icon: 'settings', bn: 'দোকানের সেটিং', sidebarGroup: 6, sidebarOrder: 140,
    children: [
      { key: 'settings', label: 'General', bn: 'সাধারণ সেটিং' },
      { key: 'invoiceDesign', label: 'Invoice Design', bn: 'রশিদের ডিজাইন' },
      // Users and Roles are Administrator-only via requireAdmin_, not via
      // the permission grid, so they are flagged rather than granted.
      { key: 'users', label: 'Users', bn: 'কর্মচারীর তালিকা' },
      { key: 'roles', label: 'Roles', bn: 'কে কী করতে পারবে' }
    ]
  }
];

/**
 * The modules a role can be granted, in the order the Roles grid shows
 * them. Dashboard, Users and Roles are explicitly grantable. Everything
 * else is here — including 'returns', which no longer
 * appears in the sidebar but is still separately grantable.
 */
const PERMISSION_MODULES = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'pos',       label: 'POS' },
  { key: 'sales',     label: 'Sales' },
  { key: 'returns',   label: 'Sales Return' },
  { key: 'purchase',  label: 'Purchases' },
  { key: 'suppliers', label: 'Suppliers' },
  { key: 'vendors',   label: 'Vendor' },
  { key: 'products',  label: 'Products' },
  { key: 'customers', label: 'Customers' },
  { key: 'bank',      label: 'Bank Accounts' },
  { key: 'expense',   label: 'Expenses' },
  { key: 'finance',   label: 'Business Finance' },
  { key: 'daybook',   label: 'Day Book' },
  { key: 'cashReconciliation', label: 'Cash Reconciliation' },
  { key: 'reports',   label: 'Reports' },
  { key: 'settings',  label: 'Settings' },
  { key: 'users',     label: 'Users' },
  { key: 'roles',     label: 'Roles' },
  // Special non-navigation right. Only the Edit checkbox is meaningful.
  { key: 'openingBalance', label: 'Opening Balance Edit', permissionMode: 'editOnly' },
  { key: 'settlementDiscount', label: 'Settlement Discount', permissionMode: 'editOnly' },
  // Purchase Price Visibility. Grantable but deliberately NOT a NAV_ITEMS
  // entry — there is no 'posCost' page, this is a right to SEE one extra
  // figure on the POS cart, not somewhere to navigate to. Only 'view' is
  // ever read (getPosBootstrap in Sales.gs); the grid's Add/Edit/Delete
  // columns are meaningless here, exactly as they already are for
  // 'dashboard'. Being in allowedModules is harmless: filterNavByRole_
  // matches allowedModules against NAV_ITEMS keys, and nothing routes here.
  { key: 'posCost',   label: 'POS Purchase Price' }
];

/** Called once from javascript.html on load to fill the header and sidebar. */
function getAppShellData() {
  try {
    const settings = getSettingsMap_();
    return ok_({
      shopName: settings['Shop Name'] || CONFIG.APP_NAME,
      currencySymbol: settings['Currency Symbol'] || '',
      navItems: NAV_ITEMS
    });
  } catch (err) {
    logError_('getAppShellData', err);
    return fail_('System is not set up yet. In the Google Sheet, use the "Hardware ERP" menu \u2192 "Setup / Repair System", then reload this page.');
  }
}