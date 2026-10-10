/**
 * Config.gs
 * ---------------------------------------------------------------------
 * Single source of truth for sheet names, column headers, ID prefixes
 * and default settings. Change a sheet name or add a column HERE only —
 * every other file reads through this object, so nothing else needs to
 * change when the shape of the data changes.
 *
 * MERGED FINAL VERSION. Two separate rounds of schema work are folded
 * into this one file:
 *   1. Backdate columns on seven transaction sheets (below).
 *   2. Bank Ledger audit columns on BANK_BOOK (further down).
 * Both are purely additive. Nothing is renamed or removed, so no existing
 * data or code can break. RUN SETUP / REPAIR SYSTEM AFTER PASTING.
 *
 * Backdate columns (prerequisite for the P3 item 6 refactor): eight
 * modules have been writing 'Is Backdated' / 'Backdated Days' /
 * 'Backdated Reason' since the Tier 1 backdate work, and DayBook.gs has
 * been reading them back — but they were never declared here, so
 * appendRow_ silently dropped them on every write and Day Book always
 * read undefined. They are appended to the end of the seven affected
 * HEADERS arrays below; CUSTOMER_LEDGER and SUPPLIER_LEDGER also gain
 * the 'Created At' column their payment writers have been sending.
 *
 * All additive — getSheetHeaders_ self-healing appends the new columns
 * at the end of each sheet on first touch, and existing rows just get
 * blanks. RUN SETUP / REPAIR SYSTEM AFTER PASTING THIS FILE.
 * ---------------------------------------------------------------------
 */

const CONFIG = {
  APP_NAME: "Hardware Store ERP",

  // ---- Sheet names ----------------------------------------------------
  SHEETS: {
    PRODUCTS: "Products",
    SUPPLIERS: "Suppliers",
    SUPPLIER_LEDGER: "Supplier Ledger",
    STOCK_LOTS: "Stock Lots",
    SALE_ITEM_LOTS: "Sale Item Lots",
    STOCK_LOT_COST_CORRECTIONS: "Stock Lot Cost Corrections",
    PURCHASES: "Purchases",
    PURCHASE_ITEMS: "Purchase Items",
    SALES: "Sales",
    SALES_DRAFTS: "Draft Invoices",
    SALES_DRAFT_AUDIT: "Draft Invoice Audit",
    SALE_ITEMS: "Sale Items",
    CUSTOMERS: "Customers",
    CUSTOMER_LEDGER: "Customer Ledger",
    EXPENSES: "Expenses",
    EXPENSE_CATEGORIES: "Expense Categories",
    EXPENSE_PAYEES: "Expense Payees",
    CASH_BOOK: "Cash Book",
    STOCK_MOVEMENT: "Stock Movement",
    SETTINGS: "Settings",
    SALES_RETURN: "Sales Return",
    SALES_RETURN_ITEMS: "Sales Return Items",
    PURCHASE_RETURN: "Purchase Return",
    PURCHASE_RETURN_ITEMS: "Purchase Return Items",
    CASH_SESSIONS: "Cash Sessions",
    INVOICE_EDIT_LOG: "Invoice Edit Log",
    USERS: "Users",
    ROLES: "Roles",
    SESSIONS: "Sessions",
    LOGS: "Logs",
    DELETE_LOG: "Delete Log",
    OPENING_BALANCE_EDIT_LOG: "Opening Balance Edit Log",
    BANK_ACCOUNTS: "Bank Accounts",
    BANK_BOOK: "Bank Book",
    BANK_TRANSFERS: "Bank Transfers",
    FINANCE_TRANSACTIONS: "Finance Transactions",
    FINANCE_PERSONS: "Finance Persons",
    PRODUCT_CATEGORIES: "Product Categories",
    PRODUCT_UNITS: "Product Units",
    VENDORS: "Vendors",
    VENDOR_SOURCING: "Vendor Sourcing",
    VENDOR_LEDGER: "Vendor Ledger",
    VENDOR_RETURNS: "Vendor Returns",
    VENDOR_ISSUES: "Vendor Issues",
    VENDOR_RETURNS_RECEIVED: "Vendor Returns Received",
  },

  // ---- Column headers, in the exact order they'll appear on sheet ----
  HEADERS: {
    PRODUCTS: [
      "Product ID",
      "Product Name",
      "Brand",
      "Category",
      "Unit",
      "Barcode",
      "Purchase Price",
      "Selling Price",
      "Current Stock",
      "Minimum Stock",
      "Status",
      "Created At",
      "Updated At",

      // ---- Soft delete (Delete System). Additive: getSheetHeaders_ appends
      // these to the live sheet on first touch, and every existing row just
      // gets them blank -- which isDeleted_() reads as not-deleted.
      // 'Is Deleted' holds the string 'TRUE' when deleted, blank otherwise.
      "Is Deleted",
      "Deleted By",
      "Deleted At",
      "Delete Reason"
    ],
    SUPPLIERS: [
      "Supplier ID",
      "Supplier Name",
      "Phone",
      "Address",
      "Opening Balance",
      "Current Due",
      "Notes",
      "Status",
      "Created At",

      // ---- Soft delete (Delete System). Additive: getSheetHeaders_ appends
      // these to the live sheet on first touch, and every existing row just
      // gets them blank -- which isDeleted_() reads as not-deleted.
      // 'Is Deleted' holds the string 'TRUE' when deleted, blank otherwise.
      "Is Deleted",
      "Deleted By",
      "Deleted At",
      "Delete Reason"
    ],
    SUPPLIER_LEDGER: [
      "Ledger ID",
      "Date",
      "Supplier ID",
      "Supplier Name",
      "Type",
      "Reference",
      "Debit",
      "Credit",
      "Balance",
      "Notes",
      "Payment Method",
      // Settlement discount: Credit is total settled; Payment Amount is actual money moved.
      "Payment Amount",
      "Discount Amount",
      "Discount Reason",
      // Backdate audit trail. This module has been writing these three
      // since the Tier 1 backdate work; without them declared here
      // appendRow_ dropped them and DayBook.gs read back undefined.
      "Is Backdated",
      "Backdated Days",
      "Backdated Reason",
      // Who recorded this ledger entry. Never existed here, so
      // receivePayment/paySupplier had nowhere to stamp the acting app user
      // and Day Book's Entry By column read blank for every Due Payment.
      "Created By",
      // Real entry time, kept separate from the (backdatable) Date column.
      "Created At",

      // ---- Soft delete (Delete System). Additive: getSheetHeaders_ appends
      // these to the live sheet on first touch, and every existing row just
      // gets them blank -- which isDeleted_() reads as not-deleted.
      // 'Is Deleted' holds the string 'TRUE' when deleted, blank otherwise.
      "Is Deleted",
      "Deleted By",
      "Deleted At",
      "Delete Reason",
],
    PURCHASES: [
      "Purchase ID",
      "Date",
      "Supplier ID",
      "Supplier Name",
      "Subtotal",
      "Discount",
      "Grand Total",
      "Paid Amount",
      "Due Amount",
      "Payment Status",
      "Notes",
      // Purchase.gs has written 'Created By' since the backdate work and
      // DayBook.gs reads it back, but the column was never declared here -
      // so every purchase recorded its actor into nowhere and Day Book's
      // Created By stayed blank for purchase rows. Same silent-drop bug as
      // the backdate columns, found while merging. Additive, like the rest.
      "Created By",
      "Created At",
      // Backdate audit trail. This module has been writing these three
      // since the Tier 1 backdate work; without them declared here
      // appendRow_ dropped them and DayBook.gs read back undefined.
      "Is Backdated",
      "Backdated Days",
      "Backdated Reason",

      // ---- Soft delete (Delete System). Additive: getSheetHeaders_ appends
      // these to the live sheet on first touch, and every existing row just
      // gets them blank -- which isDeleted_() reads as not-deleted.
      // 'Is Deleted' holds the string 'TRUE' when deleted, blank otherwise.
      "Is Deleted",
      "Deleted By",
      "Deleted At",
      "Delete Reason",

      // ---- Bank payment on a purchase. Purchases used to be cash-only, so
      // the Day Book was forced to assume 'Cash' for every purchase row.
      // Mirrors the same three columns SALES already carries.
      "Payment Method",
      "Bank Account ID",
      "Bank Account Name",
],
    PURCHASE_ITEMS: [
      "Purchase ID",
      "Product ID",
      "Product Name",
      "Quantity",
      "Unit Price",
      "Sell Price",
      "Line Total",
    ],
    SALES: [
      "Invoice ID",
      "Date",
      "Time",
      "Customer ID",
      "Customer Name",
      "Customer Phone",
      "Customer Address",
      "Subtotal",
      "Discount",
      "Grand Total",
      "Paid Amount",
      "Due Amount",
      "Payment Type",
      "Payment Status",
      "Created By",
      "Created At",
      // Phase 8: only meaningful when Paid Amount > 0; self-healing adds
      // these columns, existing rows just get them blank (treated as Cash,
      // matching completeSale's previous unconditional Cash Book behavior).
      "Payment Method",
      "Bank Account ID",
      "Bank Account Name",
      // Backdate audit trail. This module has been writing these three
      // since the Tier 1 backdate work; without them declared here
      // appendRow_ dropped them and DayBook.gs read back undefined.
      "Is Backdated",
      "Backdated Days",
      "Backdated Reason",
      "Source Draft ID",

      // ---- Soft delete (Delete System). Additive: getSheetHeaders_ appends
      // these to the live sheet on first touch, and every existing row just
      // gets them blank -- which isDeleted_() reads as not-deleted.
      // 'Is Deleted' holds the string 'TRUE' when deleted, blank otherwise.
      "Is Deleted",
      "Deleted By",
      "Deleted At",
      "Delete Reason",
],
    SALES_DRAFTS: [
      "Draft ID", "Draft No", "Draft Date", "Customer ID", "Customer Name", "Customer Phone",
      "Customer Father Name", "Customer Address", "Items JSON", "Payment JSON", "Notes",
      "Subtotal", "Discount", "Grand Total", "Created By ID", "Created By Name", "Created At",
      "Updated By ID", "Updated By Name", "Updated At", "Version"
    ],
    SALES_DRAFT_AUDIT: [
      "Audit ID", "Timestamp", "Action", "Draft ID", "Draft No", "Version", "Actor ID", "Actor Name",
      "Source Owner ID", "Invoice ID", "Note"
    ],
    SALE_ITEMS: [
      "Invoice ID",
      "Product ID",
      "Product Name",
      "Quantity",
      "Unit Price",
      "Line Total",

    ],
    CUSTOMERS: [
      "Customer ID",
      "Customer Name",
      "Father Name",
      "Phone",
      "Address",
      "Opening Balance",
      "Current Due",
      "Status",
      "Notes",
      "Created At",

      // ---- Soft delete (Delete System). Additive: getSheetHeaders_ appends
      // these to the live sheet on first touch, and every existing row just
      // gets them blank -- which isDeleted_() reads as not-deleted.
      // 'Is Deleted' holds the string 'TRUE' when deleted, blank otherwise.
      "Is Deleted",
      "Deleted By",
      "Deleted At",
      "Delete Reason"
    ],
    CUSTOMER_LEDGER: [
      "Ledger ID",
      "Date",
      "Customer ID",
      "Customer Name",
      "Type",
      "Reference",
      "Debit",
      "Credit",
      "Balance",
      "Notes",
      "Payment Method",
      // Settlement discount: Credit is total settled; Payment Amount is actual money moved.
      "Payment Amount",
      "Discount Amount",
      "Discount Reason",
      // Optional invoice target for customer payments. Blank means automatic
      // oldest-due-first allocation; historical rows therefore need no rewrite.
      "Allocated Invoice ID",
      // Backdate audit trail. This module has been writing these three
      // since the Tier 1 backdate work; without them declared here
      // appendRow_ dropped them and DayBook.gs read back undefined.
      "Is Backdated",
      "Backdated Days",
      "Backdated Reason",
      // Who recorded this ledger entry. Never existed here, so
      // receivePayment had nowhere to stamp the acting app user and Day
      // Book's Entry By column read blank for every Due Payment.
      "Created By",
      // Real entry time, kept separate from the (backdatable) Date column.
      "Created At",

      // ---- Soft delete (Delete System). Additive: getSheetHeaders_ appends
      // these to the live sheet on first touch, and every existing row just
      // gets them blank -- which isDeleted_() reads as not-deleted.
      // 'Is Deleted' holds the string 'TRUE' when deleted, blank otherwise.
      "Is Deleted",
      "Deleted By",
      "Deleted At",
      "Delete Reason",
],
    EXPENSES: [
      "Expense ID",
      "Date",
      "Category ID",
      "Category Name",
      "Ledger ID",
      "Ledger Name",
      "Amount",
      "Payment Method",
      "Description",
      "Reference No",
      "Notes",
      "Status",
      "Created By",
      "Created At",
      // Phase 8: only populated when Payment Method === 'Bank'; self-healing
      // adds this column, existing rows just get it blank.
      "Bank Account ID",
      "Bank Account Name",
      // Backdate audit trail. This module has been writing these three
      // since the Tier 1 backdate work; without them declared here
      // appendRow_ dropped them and DayBook.gs read back undefined.
      "Is Backdated",
      "Backdated Days",
      "Backdated Reason",

      // ---- Soft delete (Delete System). Additive: getSheetHeaders_ appends
      // these to the live sheet on first touch, and every existing row just
      // gets them blank -- which isDeleted_() reads as not-deleted.
      // 'Is Deleted' holds the string 'TRUE' when deleted, blank otherwise.
      "Is Deleted",
      "Deleted By",
      "Deleted At",
      "Delete Reason",
],
    EXPENSE_CATEGORIES: [
      "Category ID",
      "Category Name",
      "Description",
      "Status",
      "Created At",
    ],
    // Master data for the Expense Payee dropdown. Expenses store the selected
    // payee in their existing Ledger ID / Ledger Name fields.
    EXPENSE_PAYEES: [
      "Payee ID",
      "Payee Name",
      "Phone",
      "Notes",
      "Status",
      "Created At",
      "Is Deleted",
      "Deleted By",
      "Deleted At",
      "Delete Reason",
    ],
    CASH_BOOK: [
      "Entry ID",
      "Date",
      "Type",
      "Reference",
      "Description",
      "Debit",
      "Credit",
      "Balance",
      "Payment Method",
      // Posting time is distinct from the backdatable transaction Date.
      // Day Book uses it to place each cash movement next to its source row.
      "Created At",

      // ---- Soft delete (Delete System). Additive: getSheetHeaders_ appends
      // these to the live sheet on first touch, and every existing row just
      // gets them blank -- which isDeleted_() reads as not-deleted.
      // 'Is Deleted' holds the string 'TRUE' when deleted, blank otherwise.
      "Is Deleted",
      "Deleted By",
      "Deleted At",
      "Delete Reason"
    ],
    // STOCK_MOVEMENT headers — append 'Lot ID' (self-healing adds the column, old rows just get it blank):
    STOCK_MOVEMENT: [
      "Movement ID",
      "Date",
      "Product ID",
      "Product Name",
      "Type",
      "Reference",
      "Quantity In",
      "Quantity Out",
      "Balance Stock",
      "Notes",
      "Lot ID",
    ],
    // new HEADERS entries:
    STOCK_LOTS: [
      "Lot ID",
      "Product ID",
      "Product Name",
      "Purchase ID",
      "Purchase Date",
      "Purchase Price",
      "Sell Price",
      "Original Quantity",
      "Remaining Quantity",
      "Status",
      "Created At",

      // Multi-supplier stock: which supplier this specific batch came
      // from, so a sale can be scoped to draw from one supplier's lots
      // only. Blank for lots with no single supplier (manual adjustment,
      // legacy back-fill, opening migration). Additive.
      "Supplier ID",
      "Supplier Name",
    ],
    SALE_ITEM_LOTS: [
      "Invoice ID",
      "Product ID",
      "Lot ID",
      "Quantity",
      "Unit Cost",
      "Unit Sell Price",
      "Created At",
      // Multi-supplier sale lineage. Sales.gs already supplies this value;
      // declaring it here makes Database.gs persist it on live sheets.
      "Supplier ID",

    ],
    STOCK_LOT_COST_CORRECTIONS: [
      "Correction ID",
      "Date",
      "Lot ID",
      "Product ID",
      "Product Name",
      "Source",
      "Old Purchase Price",
      "New Purchase Price",
      "Original Quantity",
      "Remaining Quantity",
      "Matched Historical Quantity",
      "Affected Invoice Count",
      "Historical COGS Delta",
      "Reason",
      "Corrected By",
      "Created At",
    ],
    SETTINGS: ["Key", "Value"],
    SALES_RETURN: [
      "Return ID",
      "Date",
      "Invoice ID",
      "Customer ID",
      "Customer Name",
      "Customer Phone",
      "Refund Method",
      "Total Return Amount",
      "Reason",
      "Notes",
      "Processed By",
      "Created At",
      // Backdate audit trail. This module has been writing these three
      // since the Tier 1 backdate work; without them declared here
      // appendRow_ dropped them and DayBook.gs read back undefined.
      "Is Backdated",
      "Backdated Days",
      "Backdated Reason",

      // ---- Soft delete (Delete System). Additive: getSheetHeaders_ appends
      // these to the live sheet on first touch, and every existing row just
      // gets them blank -- which isDeleted_() reads as not-deleted.
      // 'Is Deleted' holds the string 'TRUE' when deleted, blank otherwise.
      "Is Deleted",
      "Deleted By",
      "Deleted At",
      "Delete Reason",
      // Optional grouping metadata for one operator action spanning several
      // source invoices. Accounting still keys every child by Return ID.
      "Batch ID",
],
    SALES_RETURN_ITEMS: [
      "Return ID",
      "Invoice ID",
      "Product ID",
      "Product Name",
      "Return Quantity",
      "Return Price",
      "Line Total",

      // Optional legacy/audit field. Current product-level Sales Returns do
      // not trust a client-supplied supplier; stock lineage is restored from
      // the source invoice's SALE_ITEM_LOTS evidence instead.
      "Supplier ID",
      // New rows store the already-discounted/economic return value. Blank
      // legacy rows are interpreted as pre-discount values by reports.
      "Pricing Basis",
    ],
    PURCHASE_RETURN: [
      "Return ID",
      "Date",
      "Purchase ID",
      "Supplier ID",
      "Supplier Name",
      "Refund Method",
      "Total Return Amount",
      "Reason",
      "Notes",
      "Processed By",
      "Created At",
      // Backdate audit trail. This module has been writing these three
      // since the Tier 1 backdate work; without them declared here
      // appendRow_ dropped them and DayBook.gs read back undefined.
      "Is Backdated",
      "Backdated Days",
      "Backdated Reason",

      // ---- Soft delete (Delete System). Additive: getSheetHeaders_ appends
      // these to the live sheet on first touch, and every existing row just
      // gets them blank -- which isDeleted_() reads as not-deleted.
      // 'Is Deleted' holds the string 'TRUE' when deleted, blank otherwise.
      "Is Deleted",
      "Deleted By",
      "Deleted At",
      "Delete Reason",
],
    PURCHASE_RETURN_ITEMS: [
      "Return ID",
      "Purchase ID",
      "Product ID",
      "Product Name",
      "Return Quantity",
      "Return Price",
      "Line Total",
      "Pricing Basis",
    ],
    CASH_SESSIONS: [
      "Session ID",
      "Date",
      "Opened At",
      "Opening Cash",
      "Closed At",
      "Expected Cash",
      "Counted Cash",
      "Variance",
      "Status",
      "Notes",
      "Opening Explanation Entry IDs",
      "Closing Explanation Entry IDs",
    ],
    INVOICE_EDIT_LOG: [
      "Log ID",
      "Invoice ID",
      "Edit Date",
      "Reason",
      "Before Grand Total",
      "After Grand Total",
    ],
    USERS: [
      "User ID",
      "Full Name",
      "Mobile Number",
      "Password Hash",
      "Password Salt",
      "Role",
      "Status",
      "Created By",
      "Created At",
      "Last Login",
    ],
    ROLES: [
      "Role ID",
      "Role Name",
      "Allowed Modules",
      "Permissions",
      "Status",
      "Created At",
    ],
    // ...
    DELETE_LOG: [
      "Log ID",
      "Date",
      "Time",
      "Module",
      "Record ID",
      "Invoice No",
      "Reason",
      "Deleted By",
      "Deleted By Mobile",
    ],
    OPENING_BALANCE_EDIT_LOG: [
      "Audit ID",
      "Changed At",
      "Entity Type",
      "Entity ID",
      "Entity Name",
      "Old Opening Balance",
      "New Opening Balance",
      "Delta",
      "Current Due Before",
      "Current Due After",
      "Reason",
      "Changed By",
    ],
    SESSIONS: [
      "Token",
      "User ID",
      "Mobile Number",
      "Created At",
      "Expires At",
      "Last Activity",
    ],
    LOGS: ["Timestamp", "Context", "Message"],
    // Phase 7 (Bank Module): CRUD + opening balance + disable, mirrors
    // Suppliers.gs's shape. "Current Balance" starts equal to Opening
    // Balance and is otherwise untouched until Phase 8's Bank Book
    // writer starts updating it per transaction (mirrors Current Due).
    BANK_ACCOUNTS: [
      "Bank Account ID",
      "Account Name",
      "Bank Name",
      "Account Number",
      "Opening Balance",
      "Current Balance",
      "Notes",
      "Status",
      "Created At",
      // Additive (self-healing via getSheetHeaders_): 'Bank' or 'Mobile
      // Banking'. UI-only distinction — every ledger/transaction function
      // (addBankBookEntry_, getBankLedger, resolveBankAccount_, etc.)
      // treats both the same; this column only drives which accounts a
      // dropdown shows for a given payment method. Old rows read back ''
      // and are treated as 'Bank' wherever this is consumed.
      "Account Type",
    ],
    // Phase 8: parallel to CASH_BOOK, but per-account — Balance here is
    // that one account's running balance, not a global figure, so
    // addBankBookEntry_ reads/writes BANK_ACCOUNTS.'Current Balance'
    // for the given account rather than "the last row" like Cash Book.
    BANK_BOOK: [
      "Entry ID",
      "Date",
      "Bank Account ID",
      "Bank Account Name",
      "Type",
      "Reference",
      "Description",
      "Debit",
      "Credit",
      "Balance",
      // Bank Ledger (audit). All additive — getSheetHeaders_ appends them
      // to the existing sheet on first touch and old rows just get blanks.
      "Notes",
      // 'Active' or 'Reversed'. A reversed entry keeps its amounts and stays
      // in the ledger forever; reverseBankEntry_ writes the opposite entry.
      "Status",
      // On a reversal row, the Entry ID it reverses.
      "Reversal Of",
      // The app's own session user. Not Session.getActiveUser(), which
      // returns '' for everyone in a web app deployed as its owner.
      "Created By",
      // Real wall-clock write time, kept separate from the (backdatable)
      // Date column above.
      "Created At",
      "Is Backdated",
      "Backdated Days",
      "Backdated Reason",
    ],
    // Phase 9: the audit "header" record for a transfer, mirroring every
    // other transaction type (Purchase/Sale/Expense) having its own row
    // plus book entries. Transfer ID is what links the two Bank Book
    // rows a transfer writes (one Debit on the source, one Credit on the
    // destination) via their Reference field.
    BANK_TRANSFERS: [
      "Transfer ID",
      "Date",
      "From Account ID",
      "From Account Name",
      "To Account ID",
      "To Account Name",
      "Amount",
      "Notes",
      "Created By",
      "Created At",
      // Soft delete (Delete System)
      "Is Deleted",
      "Deleted By",
      "Deleted At",
      "Delete Reason",
    ],
    // Business Finance module: owner capital and loans, all in one sheet
    // per the spec ("Store all finance transactions in this single
    // sheet"). Owner Capital / Outstanding Loan are never stored as their
    // own figure anywhere — they are always summed live from this sheet's
    // active rows (see getOwnerCapital_/getOutstandingLoan_ in
    // FinanceModule.gs), the same "derived, not a second source of truth"
    // rule Reports.gs and Dashboard.gs already follow. That is also what
    // makes edit/delete trivial: correcting or soft-deleting a row here
    // is the whole recalculation, nothing else needs to be re-summed by
    // hand. Only the Cash Book / Bank Book side (real money) needs an
    // explicit reverse-then-reapply, same as Supplier/Customer payments.
    FINANCE_TRANSACTIONS: [
      "Finance ID",
      "Date",
      "Transaction Type",
      "Person",
      "Payment Method",
      "Bank Account ID",
      "Bank Account Name",
      "Amount",
      "Reference No",
      "Notes",
      "Created By",
      "Created At",
      "Is Backdated",
      "Backdated Days",
      "Backdated Reason",

      // ---- Soft delete (Delete System). Additive: getSheetHeaders_ appends
      // these to the live sheet on first touch, and every existing row just
      // gets them blank -- which isDeleted_() reads as not-deleted.
      // 'Is Deleted' holds the string 'TRUE' when deleted, blank otherwise.
      "Is Deleted",
      "Deleted By",
      "Deleted At",
      "Delete Reason",

      // Links this row to a FINANCE_PERSONS row. Additive — getSheetHeaders_
      // appends it on first touch; a transaction recorded before the Person
      // ledger existed just has this blank and keeps whatever free-text name
      // it already has in 'Person' (which stays the display column for both
      // old and new rows, same ID+Name pairing every other module uses —
      // Bank Account ID/Name, Category ID/Name, etc.).
      "Person ID",
],
    // Master data for the Business Finance module's Person dropdown (who an
    // Owner Investment/Withdrawal or Loan Received/Repayment is with). Same
    // shape as other master-data tables: unique name, phone/description,
    // multi-role Owner/Lender/Borrower, Active/Inactive, never hard-deleted.
    // Legacy 'Person Type' remains for compatibility; Roles is authoritative.
    FINANCE_PERSONS: [
      "Person ID",
      "Person Name",
      "Person Type",
      "Roles",
      "Phone",
      "Description",
      "Notes",
      "Status",
      "Created At",
    ],
    // Master data for the Products module's Category/Unit dropdowns. Same
    // shape as EXPENSE_CATEGORIES: unique name, Active/Inactive, never
    // hard-deleted. PRODUCTS.Category / PRODUCTS.Unit still store the plain
    // text name directly (unchanged) — these two lists only control what's
    // offered when adding/editing a product; deactivating an entry here
    // never touches a product that already has that value.
    PRODUCT_CATEGORIES: [
      "Category ID",
      "Category Name",
      "Status",
      "Created At",
    ],
    PRODUCT_UNITS: [
      "Unit ID",
      "Unit Name",
      "Status",
      "Created At",
    ],
    // Master data for POS's Vendor/Consignment Sourcing shortage chooser.
    // Deliberately minimal — same add + Active/Inactive shape as
    // PRODUCT_CATEGORIES/PRODUCT_UNITS/FINANCE_PERSONS, no rename, never
    // hard-deleted. Distinct from SUPPLIERS on purpose (a vendor sourced
    // for a one-off shortage is not necessarily a purchasing supplier).
    // 'Current Due' is a stored running balance (like SUPPLIERS.'Current
    // Due'), not derived, because there is no dedicated ledger sheet in
    // this minimal scope to sum it from on every read.
    VENDORS: [
      "Vendor ID",
      "Vendor Name",
      "Phone",
      "Address",
      "Current Due",
      "Status",
      "Created At",
      // Two-way vendor transactions: 'Current Due' is what WE owe THEM
      // (Payable — Sourcing/Payment/Return); 'Current Receivable' is what
      // THEY owe US (Issue/Receipt/Return Received — see VENDOR_ISSUES and
      // VENDOR_RETURNS_RECEIVED below). Deliberately two separate stored
      // numbers, not one netted figure — the user wants both balances
      // visible at once, not merged.
      "Current Receivable",

      // ---- Soft delete (Vendor master)
      "Is Deleted",
      "Deleted By",
      "Deleted At",
      "Delete Reason",
    ],
    // One row per sale line whose shortfall was sourced from a vendor
    // instead of becoming an OVERSOLD stock lot. Never touches Current
    // Stock/Stock Lots — this sheet IS the audit trail for that bypass,
    // and what completeSale/updateSale/deleteSalesInvoice key off of to
    // create/reverse a vendor's Current Due. Soft-deleted like every
    // other transactional record so a sale edit/delete can cascade-reverse
    // it via the same DeleteEngine.gs conventions.
    VENDOR_SOURCING: [
      "Sourcing ID",
      "Date",
      "Invoice ID",
      "Product ID",
      "Product Name",
      "Vendor ID",
      "Vendor Name",
      "Quantity",
      "Unit Cost",
      "Total Cost",
      "Created By",
      "Created At",

      // ---- Soft delete (Delete System)
      "Is Deleted",
      "Deleted By",
      "Deleted At",
      "Delete Reason",
],
    // The vendor's financial history — mirrors SUPPLIER_LEDGER exactly,
    // extended to carry BOTH directions of a two-way vendor relationship.
    // 'Balance Type' says which of Vendors.'Current Due' (Payable) or
    // 'Current Receivable' this row affects:
    //   Payable:    Sourcing (Debit, vendor gave us stock), Payment
    //               (Credit, we paid cash), Return (Credit, we gave stock
    //               back to settle — see VENDOR_RETURNS).
    //   Receivable: Issue (Debit, we gave vendor stock — see
    //               VENDOR_ISSUES), Receipt (Credit, vendor paid us cash),
    //               Return Received (Credit, vendor gave stock back to
    //               settle — see VENDOR_RETURNS_RECEIVED).
    // Debit always means "this row's own Balance Type increases", Credit
    // "decreases" — Payable mirrors Supplier Ledger's convention,
    // Receivable mirrors Customer Ledger's (vendor-owes-us is exactly a
    // customer due, just on a vendor). 'Balance' is a stored point-in-time
    // snapshot of whichever Balance Type the row is, not recomputed on
    // read — Vendors.'Current Due'/'Current Receivable' are the actual
    // live numbers everything else reads. Editing/deleting a Sourcing or
    // Issue row here never touches the original sale/invoice — see
    // VENDOR_SOURCING's own note; Payment/Return/Receipt/Return Received
    // rows own real money/stock movement and reverse that in full instead.
    VENDOR_LEDGER: [
      "Ledger ID",
      "Date",
      "Vendor ID",
      "Vendor Name",
      "Type",
      "Reference",
      "Debit",
      "Credit",
      "Balance",
      "Notes",
      "Payment Method",
      "Is Backdated",
      "Backdated Days",
      "Backdated Reason",
      "Created By",
      "Created At",

      // ---- Soft delete (Delete System)
      "Is Deleted",
      "Deleted By",
      "Deleted At",
      "Delete Reason",

      // Appended (not inserted) to stay additive-only, per Database.gs's
      // self-healing convention — existing sheets read/write by header
      // name, so column position past creation never matters.
      "Balance Type",
],
    // One row per "settle a vendor's due with stock instead of cash"
    // transaction — the Purchase-Return analog for Vendors. Always links
    // back to the VENDOR_SOURCING row it's settling (Sourcing ID), and a
    // Sourcing row's returnable quantity is capped by what's already been
    // returned against it (sum of active rows here for that Sourcing ID).
    VENDOR_RETURNS: [
      "Return ID",
      "Date",
      "Vendor ID",
      "Vendor Name",
      "Sourcing ID",
      "Product ID",
      "Product Name",
      "Quantity",
      "Unit Cost",
      "Total Value",
      "Notes",
      "Created By",
      "Created At",

      // ---- Soft delete (Delete System)
      "Is Deleted",
      "Deleted By",
      "Deleted At",
      "Delete Reason",
],
    // The other direction: one row per "we hand the vendor OUR stock"
    // transaction — creates a Receivable (they owe us), the mirror image
    // of VENDOR_SOURCING. Real stock leaves Current Stock/Stock Lots
    // immediately (unlike Sourcing, which is the vendor's stock and never
    // touches ours) — same FIFO consumption path as any other stock-out,
    // blocked if we don't actually have the quantity on hand.
    VENDOR_ISSUES: [
      "Issue ID",
      "Memo ID",
      "Date",
      "Vendor ID",
      "Vendor Name",
      "Product ID",
      "Product Name",
      "Quantity",
      "Unit Value",
      "Total Value",
      "Notes",
      "Created By",
      "Created At",

      // ---- Soft delete (Delete System)
      "Is Deleted",
      "Deleted By",
      "Deleted At",
      "Delete Reason",
],
    // Settles a Receivable with stock instead of cash — the vendor brings
    // products back to us. The mirror image of VENDOR_RETURNS: always
    // linked back to the VENDOR_ISSUES row it's settling (Issue ID),
    // capped the same way (sum of active rows here for that Issue ID).
    // Stock always increases here, so unlike VENDOR_RETURNS there is no
    // "do we have enough on hand" question at creation time.
    VENDOR_RETURNS_RECEIVED: [
      "Return ID",
      "Date",
      "Vendor ID",
      "Vendor Name",
      "Issue ID",
      "Product ID",
      "Product Name",
      "Quantity",
      "Unit Value",
      "Total Value",
      "Notes",
      "Created By",
      "Created At",

      // ---- Soft delete (Delete System)
      "Is Deleted",
      "Deleted By",
      "Deleted At",
      "Delete Reason",
],
  },

  // ---- Sequential ID prefixes (e.g. PUR-000001) -----------------------
  ID_PREFIX: {
    PRODUCTS: "PRD",
    SUPPLIERS: "SUP",
    PURCHASES: "PUR",
    STOCK_LOTS: "LOT",
    STOCK_LOT_COST_CORRECTIONS: "SLC",
    SALES: "INV",
    SALES_DRAFTS: "DRF",
    SALES_DRAFT_AUDIT: "DRA",
    CUSTOMERS: "CUS",
    EXPENSES: "EXP",    EXPENSE_CATEGORIES: "ECAT",
    EXPENSE_PAYEES: "EPAY",
    CUSTOMER_LEDGER: "LED",
    SUPPLIER_LEDGER: "SLD",
    CASH_BOOK: "CB",
    STOCK_MOVEMENT: "SM",
    SALES_RETURN: "SRT",
    PURCHASE_RETURN: "PRT",
    CASH_SESSIONS: "CS",
    INVOICE_EDIT_LOG: "IEL",
    USERS: "USR",
    ROLES: "ROL",
    DELETE_LOG: "DEL",
    OPENING_BALANCE_EDIT_LOG: "OBL",
    BANK_ACCOUNTS: "BNK",
    BANK_BOOK: "BB",
    BANK_TRANSFERS: "TRF",
    FINANCE_TRANSACTIONS: "FIN",
    FINANCE_PERSONS: "FPER",
    PRODUCT_CATEGORIES: "PCAT",    PRODUCT_UNITS: "PUNT",
    VENDORS: "VEN",
    VENDOR_SOURCING: "VSR",
    VENDOR_LEDGER: "VLD",
    VENDOR_RETURNS: "VRT",
    VENDOR_ISSUES: "VIS",
    VENDOR_RETURNS_RECEIVED: "VRR",
    // SESSIONS deliberately has no prefix here — session tokens are random
    // (generateToken_() in Auth.gs), not sequential IDs from generateId_().
  },
  ID_PAD_LENGTH: 6,

  // ---- Defaults written into the Settings sheet on first setup --------
  DEFAULT_SETTINGS: {
    "Shop Name": "My Hardware Store",
    "Shop Name Bangla": "",
    "Shop Description": "",
    Address: "",
    "Phone 1": "",
    "Phone 2": "",
    Email: "",
    "Currency Symbol": "\u09F3",
    "Currency Code": "BDT",
    "Tax Percent": "0",
    "Default Discount": "0",
    "Low Stock Threshold": "5",
    "Invoice Logo": "",
    "Invoice Payment Methods": "[]",
    "Invoice Terms": "[]",
    "Invoice Payment Terms Days": "0",
    "Invoice Payment Terms Text": "",
    "Invoice Footer": "\u09A7\u09A8\u09CD\u09AF\u09AC\u09BE\u09A6 \u2014 \u0986\u09AA\u09A8\u09BE\u09B0 \u0986\u09B8\u09CD\u09A5\u09BE \u0986\u09AE\u09BE\u09A6\u09C7\u09B0 \u0985\u0997\u09CD\u09B0\u09AF\u09BE\u09A4\u09CD\u09B0\u09BE\u09B0 \u09B6\u0995\u09CD\u09A4\u09BF",
    "Invoice Proprietor Name": "",
    "Invoice Proprietor Paragraph": "",
    "Invoice Title": "\u099A\u09BE\u09B2\u09BE\u09A8",
    "Invoice Show Bismillah": "true",
    "Invoice Bismillah Text": "\u0628\u0650\u0633\u0652\u0645\u0650 \u0627\u0644\u0644\u0647\u0650 \u0627\u0644\u0631\u064E\u0651\u062D\u0652\u0645\u0670\u0646\u0650 \u0627\u0644\u0631\u064E\u0651\u062D\u0650\u064A\u0652\u0645\u0650",
    "Invoice Show Signature": "true",
    "Drive Folder Id": "",
    Timezone: "Asia/Dhaka",
    "Receipt Size": "80mm",
    "Delete Confirmation Key": "",
    "Day Book Editable Days": "0",
    "Default Bank Account": "",
    "Session Timeout Hours": "12",
    // Purchase Price Visibility — off by default. Turning it on is only half
    // the gate; a user also needs the 'posCost' view permission before
    // getPosBootstrap will send any cost figure. See Sales.gs.
    "POS Show Purchase Price": "false",
  },

  LOCK_TIMEOUT_MS: 15000,
};