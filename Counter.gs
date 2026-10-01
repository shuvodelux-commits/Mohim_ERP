/**
 * Counter.gs
 * Read-only aggregation for the Counter quick-entry workspace.
 * Financial writes remain owned by Customer/Supplier/Expense/Bank modules.
 */

function counterCapabilities_(user) {
  return {
    customerReceive: hasPermission_(user, 'customers', 'edit'),
    customerAdd: hasPermission_(user, 'customers', 'add'),
    supplierPay: hasPermission_(user, 'suppliers', 'edit'),
    supplierAdd: hasPermission_(user, 'suppliers', 'add'),
    expenseAdd: hasPermission_(user, 'expense', 'add'),
    bankTransfer: hasPermission_(user, 'bank', 'add'),
    settlementDiscount: hasPermission_(user, 'settlementDiscount', 'edit')
  };
}

function counterCustomers_() {
  return getAllRows_('CUSTOMERS')
    .filter(function (row) {
      return !isDeleted_(row) && row['Status'] !== 'Inactive';
    })
    .map(function (row) {
      return {
        id: row['Customer ID'],
        name: row['Customer Name'] || '',
        phone: row['Phone'] || '',
        due: Number(row['Current Due']) || 0
      };
    })
    .sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
}

function counterSuppliers_() {
  return getAllRows_('SUPPLIERS')
    .filter(function (row) {
      return !isDeleted_(row) && row['Status'] !== 'Inactive';
    })
    .map(function (row) {
      return {
        id: row['Supplier ID'],
        name: row['Supplier Name'] || '',
        phone: row['Phone'] || '',
        payable: Number(row['Current Due']) || 0
      };
    })
    .sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
}

function counterExpenseCategories_() {
  return getAllRows_('EXPENSE_CATEGORIES')
    .filter(function (row) { return row['Status'] !== 'Inactive'; })
    .map(function (row) { return { id: row['Category ID'], name: row['Category Name'] || '' }; })
    .sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
}

function getCounterBootstrap(token) {
  try {
    const user = getSessionUser_(token);
    const capabilities = counterCapabilities_(user);
    const needsPaymentAccounts = capabilities.customerReceive || capabilities.supplierPay || capabilities.expenseAdd;
    const needsAnyAccounts = needsPaymentAccounts || capabilities.bankTransfer;
    const accounts = needsAnyAccounts ? getActiveBankAccountsForUI_() : [];
    const settings = getSettingsMap_();

    return ok_({
      capabilities: capabilities,
      customers: capabilities.customerReceive ? counterCustomers_() : [],
      suppliers: capabilities.supplierPay ? counterSuppliers_() : [],
      expenseCategories: capabilities.expenseAdd ? counterExpenseCategories_() : [],
      expensePayees: capabilities.expenseAdd ? getExpensePayeesForUI_() : [],
      paymentAccounts: needsPaymentAccounts ? accounts : [],
      expensePaymentMethods: capabilities.expenseAdd ? EXPENSE_PAYMENT_METHODS.slice() : [],
      transferAccounts: capabilities.bankTransfer ? accounts : [],
      currencySymbol: settings['Currency Symbol'] || '',
      businessDate: formatDate_(new Date())
    });
  } catch (err) {
    logError_('getCounterBootstrap', err);
    return fail_(err.message);
  }
}

function getCounterCustomers(token) {
  try {
    const user = getSessionUser_(token);
    if (!hasPermission_(user, 'customers', 'edit') && !hasPermission_(user, 'customers', 'add')) {
      throw new Error('You do not have permission to use customers here.');
    }
    return ok_(counterCustomers_());
  } catch (err) {
    logError_('getCounterCustomers', err);
    return fail_(err.message);
  }
}

function getCounterSuppliers(token) {
  try {
    const user = getSessionUser_(token);
    if (!hasPermission_(user, 'suppliers', 'edit') && !hasPermission_(user, 'suppliers', 'add')) {
      throw new Error('You do not have permission to use suppliers here.');
    }
    return ok_(counterSuppliers_());
  } catch (err) {
    logError_('getCounterSuppliers', err);
    return fail_(err.message);
  }
}
