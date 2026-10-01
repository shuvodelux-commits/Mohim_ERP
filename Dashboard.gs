/**
 * Dashboard.gs
 * ---------------------------------------------------------------------
 * Lightweight operational dashboard only. Detailed analysis belongs in
 * Reports. The endpoint intentionally reads only the sheets needed for
 * the daily/operational cards shown on Dashboard.
 */

/**
 * Net revenue for the supplied invoice rows, using the same economic return
 * value rule as Reports -> Profit. This keeps Today Sales return-aware
 * without invoking FIFO COGS/profit aggregation.
 */
function dashboardTodayNetSales_(sales) {
  if (!sales || !sales.length) return 0;
  const saleByInvoice = {};
  let grossSales = 0;
  (sales || []).forEach(function (s) {
    saleByInvoice[s['Invoice ID']] = s;
    grossSales += Number(s['Grand Total']) || 0;
  });

  let returnedTotal = 0;
  activeSalesReturnItems_().forEach(function (ri) {
    const parent = saleByInvoice[ri['Invoice ID']];
    if (!parent) return;
    returnedTotal += economicReturnLineAmount_(ri, parent['Subtotal'], parent['Grand Total']);
  });

  return roundMoney_(grossSales - returnedTotal);
}

/** Actual customer money received today: POS paid amounts plus later customer
 * payments. Settlement discounts are excluded because they do not move money.
 * Legacy Payment rows without Payment Amount fall back to Credit minus discount.
 */
function dashboardTodayCollection_(todaySales, customerLedgerRows, today) {
  let total = (todaySales || []).reduce(function (sum, sale) {
    return sum + Math.max(0, Number(sale['Paid Amount']) || 0);
  }, 0);

  (customerLedgerRows || []).forEach(function (row) {
    if (safeDateOnly_(row['Date']) !== today || row['Type'] !== 'Payment') return;

    const rawPayment = row['Payment Amount'];
    let money;
    if (rawPayment !== '' && rawPayment !== null && rawPayment !== undefined) {
      money = Number(rawPayment) || 0;
    } else {
      money = (Number(row['Credit']) || 0) - (Number(row['Discount Amount']) || 0);
    }
    total += Math.max(0, money);
  });

  return roundMoney_(total);
}

function dashboardTodayExpense_(rows, today) {
  return roundMoney_((rows || []).reduce(function (sum, row) {
    if (safeDateOnly_(row['Date']) !== today || row['Status'] === 'Cancelled') return sum;
    return sum + (Number(row['Amount']) || 0);
  }, 0));
}

function dashboardTodayPurchase_(rows, today) {
  return roundMoney_((rows || []).reduce(function (sum, row) {
    if (safeDateOnly_(row['Date']) !== today) return sum;
    return sum + (Number(row['Grand Total']) || 0);
  }, 0));
}

function getDashboardStats(token) {
  try {
    requirePermission_(token, 'dashboard', 'view');
    const today = formatDate_(new Date());

    const sales = activeRows_('SALES');
    const todaySales = sales.filter(function (s) {
      return safeDateOnly_(s['Date']) === today;
    });
    assertUniqueSalesInvoiceIds_(todaySales, 'Dashboard today sales', sales);

    const todaySalesTotal = dashboardTodayNetSales_(todaySales);
    const todayCollectionTotal = dashboardTodayCollection_(todaySales, activeRows_('CUSTOMER_LEDGER'), today);
    const todayExpenseTotal = dashboardTodayExpense_(activeRows_('EXPENSES'), today);
    const todayPurchaseTotal = dashboardTodayPurchase_(activeRows_('PURCHASES'), today);

    const dueReceivable = activeRows_('CUSTOMERS').reduce(function (sum, c) {
      return sum + Math.max(0, Number(c['Current Due']) || 0);
    }, 0);

    const supplierPayable = activeRows_('SUPPLIERS').reduce(function (sum, s) {
      return sum + Math.max(0, Number(s['Current Due']) || 0);
    }, 0);

    const lowStockCount = activeRows_('PRODUCTS').reduce(function (count, p) {
      if (p['Status'] === 'Inactive') return count;
      return count + (Number(p['Current Stock']) <= Number(p['Minimum Stock']) ? 1 : 0);
    }, 0);

    // Reuse the Finance module's signed per-person balance logic so Dashboard
    // always matches Business Finance after repayments, credits, edits or deletes.
    const financeSummary = financeBalanceSummary_(activeRows_('FINANCE_TRANSACTIONS'));
    const settings = getSettingsMap_();

    return ok_({
      todaySalesTotal: todaySalesTotal,
      todayCollectionTotal: todayCollectionTotal,
      todayExpenseTotal: todayExpenseTotal,
      todayPurchaseTotal: todayPurchaseTotal,
      dueReceivable: roundMoney_(dueReceivable),
      borrowerReceivable: financeSummary.borrowerReceivable,
      supplierPayable: roundMoney_(supplierPayable),
      outstandingLoan: financeSummary.outstandingLoan,
      cashBalance: getCashBalance_(),
      lowStockCount: lowStockCount,
      currencySymbol: settings['Currency Symbol'] || ''
    });
  } catch (err) {
    logError_('getDashboardStats', err);
    return fail_(err.message);
  }
}
