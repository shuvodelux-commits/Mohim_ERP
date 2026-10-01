/**
 * Reports.gs
 * ---------------------------------------------------------------------
 * Read-only reporting layer. Like DayBook.gs, nothing here owns any
 * data — every figure is derived from sheets another module already
 * writes, so a report can never disagree with the module it reports on.
 * No new sheets, no Config.gs changes.
 *
 * Five reports, all gated on 'reports':'view':
 *   getSalesReport        — sales, returns and net, by day / payment type / customer
 *   getPurchaseReport     — purchases, returns and net, by day / supplier
 *   getStockReport        — per-product stock and FIFO lot valuation (no date filter)
 *   getCashBankReport     — opening/closing balances and movement by type
 *   getProfitReport       — FIFO-costed gross and net profit
 *
 * ---------------------------------------------------------------------
 * HOW PROFIT IS CALCULATED — read this before trusting the number
 * ---------------------------------------------------------------------
 * Owned-stock cost of goods sold comes from SALE_ITEM_LOTS, which records
 * the actual lot each unit was drawn from and that lot's own purchase price.
 * Vendor-sourced shortages carry their cost in VENDOR_SOURCING. Together
 * these are the complete cost evidence for an invoice.
 *
 * One subtlety that makes this work cleanly: restoreStockToLots_()
 * DECREMENTS a SALE_ITEM_LOTS row's Quantity when stock is returned. So
 * that column is not "units originally sold", it is "units sold and not
 * since returned". Summing Quantity x Unit Cost therefore gives COGS
 * already net of every return — no separate return-cost adjustment is
 * needed, and none is applied here.
 *
 * Because COGS is inherently net-of-all-returns and attributed to the
 * original sale, revenue is computed the same way: a return is netted
 * against the period its ORIGINAL INVOICE falls in, not the period the
 * return happened in. Both sides of the margin therefore always describe
 * the same set of goods. (The alternative — booking returns in their own
 * period — would need original-quantity data the lot ledger no longer
 * keeps, and would let a period show revenue with no matching cost.)
 *
 * Invoice-level discount is allocated across lines pro rata, and return
 * lines are scaled by their parent invoice's same discount factor, so
 * the per-product rows sum exactly to the headline net revenue rather
 * than drifting above it.
 *
 * KNOWN GAP, reported rather than hidden: any invoice whose net sold
 * quantity is not fully covered by SALE_ITEM_LOTS plus VENDOR_SOURCING
 * contributes only the cost evidence available. Every profit response
 * carries `coverage`; the legacy response field names still say "LotData"
 * for UI compatibility, but the counts now include both cost sources.
 * ---------------------------------------------------------------------
 */

const REPORT_TYPES = [
  { key: 'sales',    label: 'Sales' },
  { key: 'purchase', label: 'Purchase' },
  { key: 'stock',    label: 'Stock & Valuation' },
  { key: 'cashbank', label: 'Cash & Bank' },
  { key: 'profit',   label: 'Profit' },
  { key: 'balancesheet', label: 'Balance Sheet' }
];

// ---------------------------------------------------------------- helpers

/** Normalizes { from, to } to plain yyyy-MM-dd, defaulting to the current month. */
function reportRange_(filters) {
  filters = filters || {};
  const today = formatDate_(new Date());
  let from = sanitizeInput_(filters.from);
  let to = sanitizeInput_(filters.to);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) from = today.slice(0, 8) + '01';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) to = today;
  if (from > to) { const swap = from; from = to; to = swap; }
  return { from: from, to: to };
}

/** True if a yyyy-MM-dd date sits inside the range, inclusive. */
function inRange_(dateStr, range) {
  if (!dateStr) return false;
  return dateStr >= range.from && dateStr <= range.to;
}

/** Cash Book / Bank Book store a real timestamp; the first 10 chars are its date. */
function tsDateOnly_(value) {
  return String(value || '').slice(0, 10);
}

/** Sorts a { key: {...} } map into an array, biggest `field` first. */
function sortedByDesc_(map, field) {
  return Object.keys(map)
    .map(function (k) { return map[k]; })
    .sort(function (a, b) { return (Number(b[field]) || 0) - (Number(a[field]) || 0); });
}

/**
 * Lot-based (FIFO) inventory valuation at cost across every stock lot,
 * regardless of the product's own active/inactive status: each lot's own
 * remaining quantity at its own purchase price. Dashboard.gs's
 * inventoryValue tile used to carry its own copy of this exact reduce;
 * centralized here so the Balance Sheet's Inventory asset line (below)
 * reuses it too. NOT the same figure as getStockReport's
 * totals.inventoryValue, which deliberately excludes inactive products —
 * that one stays its own computation.
 */
function getInventoryValueAtCost_() {
  const cacheKey = 'db:v2:derived:inventory-value';
  try {
    const cached = CacheService.getScriptCache().get(cacheKey);
    if (cached !== null && cached !== '') return Number(cached) || 0;
  } catch (e) {}
  const value = getAllRows_('STOCK_LOTS').reduce(function (sum, l) {
    return sum + (Number(l['Remaining Quantity']) || 0) * (Number(l['Purchase Price']) || 0);
  }, 0);
  try { CacheService.getScriptCache().put(cacheKey, String(value), 30); } catch (e) {}
  return value;
}

function getReportsBootstrap(token) {
  try {
    requirePermission_(token, 'reports', 'view');
    const settings = getSettingsMap_();
    const today = formatDate_(new Date());
    return ok_({
      reportTypes: REPORT_TYPES,
      currencySymbol: settings['Currency Symbol'] || '',
      shopName: settings['Shop Name'] || CONFIG.APP_NAME,
      defaultFrom: today.slice(0, 8) + '01',
      defaultTo: today
    });
  } catch (err) {
    logError_('getReportsBootstrap', err);
    return fail_(err.message);
  }
}

// ----------------------------------------------------------- Sales report

/** filters = { from, to }. Sales, returns and net, broken down by day, payment type and customer. */
function getSalesReport(token, filters) {
  try {
    requirePermission_(token, 'reports', 'view');
    const range = reportRange_(filters);

    const allSales = getAllRows_('SALES');
    const sales = allSales.filter(function (s) {
      return !isDeleted_(s) && inRange_(safeDateOnly_(s['Date']), range);
    });
    assertUniqueSalesInvoiceIds_(sales, 'Sales report', allSales);
    const invoiceIds = {};
    const saleByInvoice = {};
    sales.forEach(function (s) {
      invoiceIds[s['Invoice ID']] = true;
      saleByInvoice[s['Invoice ID']] = s;
    });

    // Returns are attributed to their parent invoice's date — see the file
    // header for why this and the profit report agree on that.
    const returnedByInvoice = {};
    activeSalesReturnItems_().forEach(function (ri) {
      if (!invoiceIds[ri['Invoice ID']]) return;
      const parent = saleByInvoice[ri['Invoice ID']];
      returnedByInvoice[ri['Invoice ID']] =
        roundMoney_((returnedByInvoice[ri['Invoice ID']] || 0) + economicReturnLineAmount_(ri, parent['Subtotal'], parent['Grand Total']));
    });

    const salesNeedSettlement = sales.some(function (s) {
      return String(s['Customer ID'] || '') && (Number(s['Due Amount']) || 0) > 0.004;
    });
    const customerLedgerById = {};
    const salesSettlementReturns = salesNeedSettlement ? activeRows_('SALES_RETURN') : [];
    if (salesNeedSettlement) {
      getAllRows_('CUSTOMER_LEDGER').forEach(function (row) {
        const customerId = String(row['Customer ID'] || '');
        if (!customerLedgerById[customerId]) customerLedgerById[customerId] = [];
        customerLedgerById[customerId].push(row);
      });
    }
    const customerStateById = {};

    const byDay = {}, byPaymentType = {}, byCustomer = {};
    let grossSales = 0, discount = 0, returned = 0, paid = 0, due = 0;

    sales.forEach(function (s) {
      const day = safeDateOnly_(s['Date']);
      const gross = Number(s['Grand Total']) || 0;
      const ret = returnedByInvoice[s['Invoice ID']] || 0;
      const net = gross - ret;

      grossSales = roundMoney_(grossSales + gross);
      discount = roundMoney_(discount + (Number(s['Discount']) || 0));
      returned = roundMoney_(returned + ret);
      let paidAmount = Number(s['Paid Amount']) || 0;
      let dueAmount = Number(s['Due Amount']) || 0;
      const customerId = String(s['Customer ID'] || '');
      if (customerId && dueAmount > 0.004 &&
          typeof customerSettlementState_ === 'function' &&
          typeof customerInvoiceSettlementSnapshotFromState_ === 'function') {
        if (!customerStateById[customerId]) {
          customerStateById[customerId] = customerSettlementState_(customerId, {
            ledgerRows: customerLedgerById[customerId] || [],
            returnRows: salesSettlementReturns
          });
        }
        const settlementState = customerStateById[customerId];
        const settlement = customerInvoiceSettlementSnapshotFromState_(s, settlementState);
        if (settlement) {
          // Report "Collected" is actual payment money/value, not non-cash
          // settlement credit (for example a Sales Return credit). The
          // settlement snapshot's paidAmount intentionally includes credits
          // for invoice-status display, so derive report collection from the
          // original payment plus later Payment rows instead.
          paidAmount = roundMoney_(
            (Number(s['Paid Amount']) || 0) +
            (Number((settlementState.paymentByInvoice || {})[s['Invoice ID']]) || 0)
          );
          dueAmount = Number(settlement.dueAmount) || 0;
        }
      }
      paid = roundMoney_(paid + paidAmount);
      due = roundMoney_(due + dueAmount);

      if (!byDay[day]) byDay[day] = { label: day, invoices: 0, gross: 0, returned: 0, net: 0 };
      byDay[day].invoices++; byDay[day].gross = roundMoney_(byDay[day].gross + gross);
      byDay[day].returned = roundMoney_(byDay[day].returned + ret); byDay[day].net = roundMoney_(byDay[day].net + net);

      const pt = s['Payment Type'] || 'Unknown';
      if (!byPaymentType[pt]) byPaymentType[pt] = { label: pt, invoices: 0, gross: 0, net: 0 };
      byPaymentType[pt].invoices++; byPaymentType[pt].gross = roundMoney_(byPaymentType[pt].gross + gross); byPaymentType[pt].net = roundMoney_(byPaymentType[pt].net + net);

      const cname = s['Customer Name'] || 'Walk-in Customer';
      if (!byCustomer[cname]) byCustomer[cname] = { label: cname, invoices: 0, gross: 0, net: 0 };
      byCustomer[cname].invoices++; byCustomer[cname].gross = roundMoney_(byCustomer[cname].gross + gross); byCustomer[cname].net = roundMoney_(byCustomer[cname].net + net);
    });

    return ok_({
      range: range,
      totals: {
        invoices: sales.length,
        grossSales: grossSales,
        discount: discount,
        returned: returned,
        netSales: roundMoney_(grossSales - returned),
        paid: paid,
        due: due
      },
      byDay: Object.keys(byDay).sort().map(function (k) { return byDay[k]; }),
      byPaymentType: sortedByDesc_(byPaymentType, 'net'),
      topCustomers: sortedByDesc_(byCustomer, 'net').slice(0, 15)
    });
  } catch (err) {
    logError_('getSalesReport', err);
    return fail_(err.message);
  }
}

// -------------------------------------------------------- Purchase report

/** filters = { from, to }. Purchases, returns and net, by day and by supplier. */
function getPurchaseReport(token, filters) {
  try {
    requirePermission_(token, 'reports', 'view');
    const range = reportRange_(filters);

    const purchases = activeRows_('PURCHASES').filter(function (p) {
      return inRange_(safeDateOnly_(p['Date']), range);
    });
    const purchaseIds = {};
    const purchaseById = {};
    purchases.forEach(function (p) {
      purchaseIds[p['Purchase ID']] = true;
      purchaseById[p['Purchase ID']] = p;
    });

    const returnedByPurchase = {};
    activePurchaseReturnItems_().forEach(function (ri) {
      if (!purchaseIds[ri['Purchase ID']]) return;
      const parent = purchaseById[ri['Purchase ID']];
      returnedByPurchase[ri['Purchase ID']] =
        roundMoney_((returnedByPurchase[ri['Purchase ID']] || 0) + economicReturnLineAmount_(ri, parent['Subtotal'], parent['Grand Total']));
    });

    const purchasesNeedSettlement = purchases.some(function (p) {
      return String(p['Supplier ID'] || '') && (Number(p['Due Amount']) || 0) > 0.004;
    });
    const supplierLedgerById = {};
    const purchaseSettlementReturns = purchasesNeedSettlement ? activeRows_('PURCHASE_RETURN') : [];
    if (purchasesNeedSettlement) {
      getAllRows_('SUPPLIER_LEDGER').forEach(function (row) {
        const supplierId = String(row['Supplier ID'] || '');
        if (!supplierLedgerById[supplierId]) supplierLedgerById[supplierId] = [];
        supplierLedgerById[supplierId].push(row);
      });
    }
    const supplierStateById = {};

    const byDay = {}, bySupplier = {};
    let grossPurchases = 0, discount = 0, returned = 0, paid = 0, due = 0;

    purchases.forEach(function (p) {
      const day = safeDateOnly_(p['Date']);
      const gross = Number(p['Grand Total']) || 0;
      const ret = returnedByPurchase[p['Purchase ID']] || 0;
      const net = gross - ret;

      grossPurchases = roundMoney_(grossPurchases + gross);
      discount = roundMoney_(discount + (Number(p['Discount']) || 0));
      returned = roundMoney_(returned + ret);
      let paidAmount = Number(p['Paid Amount']) || 0;
      let dueAmount = Number(p['Due Amount']) || 0;
      const supplierId = String(p['Supplier ID'] || '');
      if (supplierId && dueAmount > 0.004 &&
          typeof supplierSettlementState_ === 'function' &&
          typeof supplierPurchaseSettlementSnapshotFromState_ === 'function') {
        if (!supplierStateById[supplierId]) {
          supplierStateById[supplierId] = supplierSettlementState_(supplierId, {
            ledgerRows: supplierLedgerById[supplierId] || [],
            returnRows: purchaseSettlementReturns
          });
        }
        const settlementState = supplierStateById[supplierId];
        const settlement = supplierPurchaseSettlementSnapshotFromState_(p, settlementState);
        if (settlement) {
          // Report "Paid" tracks actual payments to the supplier. Purchase
          // Return / other non-cash credits reduce payable but are not money
          // paid, even though settlement snapshots include them for status.
          paidAmount = roundMoney_(
            (Number(p['Paid Amount']) || 0) +
            (Number((settlementState.paymentByPurchase || {})[p['Purchase ID']]) || 0)
          );
          dueAmount = Number(settlement.dueAmount) || 0;
        }
      }
      paid = roundMoney_(paid + paidAmount);
      due = roundMoney_(due + dueAmount);

      if (!byDay[day]) byDay[day] = { label: day, purchases: 0, gross: 0, returned: 0, net: 0 };
      byDay[day].purchases++; byDay[day].gross = roundMoney_(byDay[day].gross + gross);
      byDay[day].returned = roundMoney_(byDay[day].returned + ret); byDay[day].net = roundMoney_(byDay[day].net + net);

      const sname = p['Supplier Name'] || 'Unknown';
      if (!bySupplier[sname]) bySupplier[sname] = { label: sname, purchases: 0, gross: 0, net: 0, due: 0 };
      bySupplier[sname].purchases++; bySupplier[sname].gross = roundMoney_(bySupplier[sname].gross + gross);
      bySupplier[sname].net = roundMoney_(bySupplier[sname].net + net); bySupplier[sname].due = roundMoney_(bySupplier[sname].due + dueAmount);
    });

    return ok_({
      range: range,
      totals: {
        purchases: purchases.length,
        grossPurchases: grossPurchases,
        discount: discount,
        returned: returned,
        netPurchases: roundMoney_(grossPurchases - returned),
        paid: paid,
        due: due
      },
      byDay: Object.keys(byDay).sort().map(function (k) { return byDay[k]; }),
      topSuppliers: sortedByDesc_(bySupplier, 'net').slice(0, 15)
    });
  } catch (err) {
    logError_('getPurchaseReport', err);
    return fail_(err.message);
  }
}

// ------------------------------------------------- Stock & valuation report

/**
 * Current stock position. No date filter — this is a "right now" snapshot,
 * because Products.Current Stock and the lot ledger only carry today's
 * state, not history. Valuation is the same lot-based figure the Dashboard
 * uses: each lot's remaining quantity at that lot's own purchase price.
 */
function getStockReport(token) {
  try {
    requirePermission_(token, 'reports', 'view');

    const products = activeRows_('PRODUCTS');
    const lotValueByProduct = {}, lotQtyByProduct = {};
    getAllRows_('STOCK_LOTS').forEach(function (l) {
      const pid = l['Product ID'];
      const qty = Number(l['Remaining Quantity']) || 0;
      if (qty <= 0) return;
      lotValueByProduct[pid] = (lotValueByProduct[pid] || 0) + qty * (Number(l['Purchase Price']) || 0);
      lotQtyByProduct[pid] = (lotQtyByProduct[pid] || 0) + qty;
    });

    let totalValue = 0, totalRetailValue = 0, lowStockCount = 0, outOfStockCount = 0, activeCount = 0;
    const rows = products.map(function (p) {
      const pid = p['Product ID'];
      const stock = Number(p['Current Stock']) || 0;
      const minStock = Number(p['Minimum Stock']) || 0;
      const lotValue = lotValueByProduct[pid] || 0;
      const lotQty = lotQtyByProduct[pid] || 0;
      const retail = stock * (Number(p['Selling Price']) || 0);
      const isActive = p['Status'] !== 'Inactive';

      if (isActive) {
        activeCount++;
        totalValue += lotValue;
        totalRetailValue += retail;
        if (stock <= 0) outOfStockCount++;
        else if (stock <= minStock) lowStockCount++;
      }

      return {
        productId: pid,
        name: p['Product Name'],
        category: p['Category'] || 'Uncategorized',
        unit: p['Unit'] || '',
        stock: stock,
        minStock: minStock,
        purchasePrice: Number(p['Purchase Price']) || 0,
        sellingPrice: Number(p['Selling Price']) || 0,
        lotQuantity: lotQty,
        lotValue: lotValue,
        retailValue: retail,
        status: p['Status'] || 'Active',
        // Current Stock is the fast-read cache; the lot ledger is the ledger.
        // They should always agree — when they don't, that's worth seeing.
        lotMismatch: isActive && lotQty !== stock
      };
    }).sort(function (a, b) { return b.lotValue - a.lotValue; });

    const byCategory = {};
    rows.forEach(function (r) {
      if (r.status === 'Inactive') return;
      if (!byCategory[r.category]) byCategory[r.category] = { label: r.category, products: 0, stock: 0, value: 0 };
      byCategory[r.category].products++;
      byCategory[r.category].stock += r.stock;
      byCategory[r.category].value += r.lotValue;
    });

    return ok_({
      totals: {
        products: products.length,
        activeProducts: activeCount,
        inventoryValue: totalValue,
        retailValue: totalRetailValue,
        potentialMargin: totalRetailValue - totalValue,
        lowStockCount: lowStockCount,
        outOfStockCount: outOfStockCount,
        mismatchCount: rows.filter(function (r) { return r.lotMismatch; }).length
      },
      byCategory: sortedByDesc_(byCategory, 'value'),
      products: rows,
      lowStock: rows.filter(function (r) {
        return r.status !== 'Inactive' && r.stock <= r.minStock;
      })
    });
  } catch (err) {
    logError_('getStockReport', err);
    return fail_(err.message);
  }
}

// ------------------------------------------------------ Cash & Bank report

/**
 * Opening balance, movement by type, closing balance — for the cash drawer
 * and for every active bank account.
 *
 * Opening and closing balances are rebuilt from live movements in business-
 * date order. Stored Balance cells follow posting order and cannot be used
 * for a dated report once backdated or voided entries exist.
 */
function getCashBankReport(token, filters) {
  try {
    requirePermission_(token, 'reports', 'view');
    const range = reportRange_(filters);

    let cashOpening = 0;
    const cashInRange = [];
    activeRows_('CASH_BOOK')
      .slice()
      .sort(function (a, b) {
        const ad = tsDateOnly_(a['Date']), bd = tsDateOnly_(b['Date']);
        if (ad !== bd) return ad < bd ? -1 : 1;
        return String(a['Entry ID'] || '').localeCompare(String(b['Entry ID'] || ''));
      })
      .forEach(function (r) {
        const d = tsDateOnly_(r['Date']);
        const delta = (Number(r['Credit']) || 0) - (Number(r['Debit']) || 0);
        if (d < range.from) cashOpening = roundMoney_(cashOpening + delta);
        else if (d <= range.to) cashInRange.push(r);
      });

    const cashByType = {};
    let cashIn = 0, cashOut = 0;
    cashInRange.forEach(function (r) {
      const t = r['Type'] || 'Other';
      const credit = Number(r['Credit']) || 0;
      const debit = Number(r['Debit']) || 0;
      cashIn = roundMoney_(cashIn + credit); cashOut = roundMoney_(cashOut + debit);
      if (!cashByType[t]) cashByType[t] = { label: t, entries: 0, inflow: 0, outflow: 0, net: 0 };
      cashByType[t].entries++; cashByType[t].inflow = roundMoney_(cashByType[t].inflow + credit);
      cashByType[t].outflow = roundMoney_(cashByType[t].outflow + debit);
      cashByType[t].net = roundMoney_(cashByType[t].net + credit - debit);
    });
    const cashClosing = roundMoney_(cashOpening + cashIn - cashOut);

    const allBankRows = getAllRows_('BANK_BOOK');
    const bankReversalTargets = {};
    allBankRows.forEach(function (r) {
      if (r['Reversal Of']) bankReversalTargets[String(r['Reversal Of'])] = true;
    });
    const bankRows = allBankRows.filter(function (r) {
      return r['Status'] !== 'Reversed' || bankReversalTargets[String(r['Entry ID'] || '')];
    });
    const banks = getAllRows_('BANK_ACCOUNTS')
      .filter(function (b) { return b['Status'] !== 'Inactive'; })
      .map(function (acct) {
        const id = acct['Bank Account ID'];
        const accountRows = bankRows.filter(function (r) { return r['Bank Account ID'] === id; })
          .sort(function (a, b) {
            const ad = tsDateOnly_(a['Date']), bd = tsDateOnly_(b['Date']);
            if (ad !== bd) return ad < bd ? -1 : 1;
            return String(a['Entry ID'] || '').localeCompare(String(b['Entry ID'] || ''));
          });
        const hasOpeningRow = accountRows.some(function (r) { return r['Type'] === 'Opening Balance'; });
        let opening = hasOpeningRow ? 0 : roundMoney_(Number(acct['Opening Balance']) || 0);
        const rowsInRange = [];
        accountRows.forEach(function (r) {
          const d = tsDateOnly_(r['Date']);
          const delta = (Number(r['Credit']) || 0) - (Number(r['Debit']) || 0);
          if (d < range.from) opening = roundMoney_(opening + delta);
          else if (d <= range.to) rowsInRange.push(r);
        });
        let inflow = 0, outflow = 0;
        rowsInRange.forEach(function (r) {
          inflow = roundMoney_(inflow + (Number(r['Credit']) || 0));
          outflow = roundMoney_(outflow + (Number(r['Debit']) || 0));
        });
        return {
          id: id,
          name: acct['Account Name'],
          bankName: acct['Bank Name'] || '',
          opening: opening,
          inflow: inflow,
          outflow: outflow,
          closing: roundMoney_(opening + inflow - outflow),
          entries: rowsInRange.length,
          currentBalance: roundMoney_(Number(acct['Current Balance']) || 0)
        };
      });

    const bankTotals = banks.reduce(function (acc, b) {
      acc.opening = roundMoney_(acc.opening + b.opening); acc.inflow = roundMoney_(acc.inflow + b.inflow);
      acc.outflow = roundMoney_(acc.outflow + b.outflow); acc.closing = roundMoney_(acc.closing + b.closing);
      return acc;
    }, { opening: 0, inflow: 0, outflow: 0, closing: 0 });

    return ok_({
      range: range,
      cash: {
        opening: cashOpening,
        inflow: cashIn,
        outflow: cashOut,
        closing: cashClosing,
        entries: cashInRange.length,
        byType: sortedByDesc_(cashByType, 'inflow')
      },
      banks: banks,
      bankTotals: bankTotals,
      combined: {
        opening: roundMoney_(cashOpening + bankTotals.opening),
        closing: roundMoney_(cashClosing + bankTotals.closing)
      }
    });
  } catch (err) {
    logError_('getCashBankReport', err);
    return fail_(err.message);
  }
}

// ---------------------------------------------------------- Profit report

/**
 * The shared profit engine. Both getProfitReport() and Dashboard.gs call
 * this, so the Dashboard's "Today's Profit" tile and the Profit report can
 * never disagree — they are the same function with a different date range.
 *
 * See the file header for the full costing basis. Returns raw numbers; the
 * callers decide what to show.
 */
function computeProfit_(range) {
  // Dashboard and Profit Report often ask for the same ranges. Keep a short
  // materialized result cache so those requests do not repeatedly rescan all
  // sales, sale items, lot-consumption rows, returns and expenses.
  range = range || { from: '', to: '' };
  // Check identity before a cached total can hide an imported duplicate.
  const allSales = getAllRows_('SALES');
  const sales = allSales.filter(function (s) {
    return !isDeleted_(s) && inRange_(safeDateOnly_(s['Date']), range);
  });
  assertUniqueSalesInvoiceIds_(sales, 'Profit report', allSales);
  const generation = (function () {
    try { return CacheService.getScriptCache().get('db:v2:derived:generation:profit') || '0'; }
    catch (e) { return '0'; }
  })();
  const cacheKey = 'db:v2:derived:profit:' + generation + ':' + String(range.from) + ':' + String(range.to);
  try {
    const cached = CacheService.getScriptCache().get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch (e) {}

  // Per-invoice discount factor: Grand Total / Subtotal. Applied to sale
  // lines AND to return lines so the per-product rows reconcile exactly
  // with the headline figure.
  const factorByInvoice = {}, saleByInvoice = {}, inScope = {};
  let grossSales = 0, discountTotal = 0;
  sales.forEach(function (s) {
    const id = s['Invoice ID'];
    const subtotal = Number(s['Subtotal']) || 0;
    const grand = Number(s['Grand Total']) || 0;
    factorByInvoice[id] = subtotal > 0 ? grand / subtotal : 1;
    saleByInvoice[id] = s;
    inScope[id] = true;
    grossSales += grand;
    discountTotal += Number(s['Discount']) || 0;
  });

  const byProduct = {};
  const netQtyByInvoiceProduct = {};
  const costQtyByInvoiceProduct = {};
  function addInvoiceProductQty_(map, invoiceId, productId, qty) {
    if (!map[invoiceId]) map[invoiceId] = {};
    map[invoiceId][productId] = (map[invoiceId][productId] || 0) + (Number(qty) || 0);
  }
  function bucket_(pid, name) {
    if (!byProduct[pid]) {
      byProduct[pid] = {
        productId: pid, label: name || pid,
        qtySold: 0, qtyReturned: 0, revenue: 0, cost: 0, profit: 0
      };
    }
    if (name && byProduct[pid].label === pid) byProduct[pid].label = name;
    return byProduct[pid];
  }

  getAllRows_('SALE_ITEMS').forEach(function (i) {
    const id = i['Invoice ID'];
    if (!inScope[id]) return;
    const b = bucket_(i['Product ID'], i['Product Name']);
    const soldQty = Number(i['Quantity']) || 0;
    b.qtySold += soldQty;
    addInvoiceProductQty_(netQtyByInvoiceProduct, id, i['Product ID'], soldQty);
    const rawLineTotal = i['Line Total'];
    const grossLineTotal = rawLineTotal !== '' && rawLineTotal !== null && rawLineTotal !== undefined && isValidNonNegativeNumber_(rawLineTotal)
      ? Number(rawLineTotal)
      : (Number(i['Quantity']) || 0) * (Number(i['Unit Price']) || 0);
    b.revenue += grossLineTotal * factorByInvoice[id];
  });

  let returnedTotal = 0;
  activeSalesReturnItems_().forEach(function (ri) {
    const id = ri['Invoice ID'];
    if (!inScope[id]) return;
    const b = bucket_(ri['Product ID'], ri['Product Name']);
    const parent = saleByInvoice[id];
    const scaled = economicReturnLineAmount_(ri, parent['Subtotal'], parent['Grand Total']);
    b.qtyReturned += Number(ri['Return Quantity']) || 0;
    addInvoiceProductQty_(netQtyByInvoiceProduct, id, ri['Product ID'], -(Number(ri['Return Quantity']) || 0));
    b.revenue -= scaled;
    returnedTotal += scaled;
  });

  // SALE_ITEM_LOTS.Quantity is already net of returns (restoreStockToLots_
  // decrements it), so this is COGS net of returns with no adjustment.
  let cogs = 0;
  getAllRows_('SALE_ITEM_LOTS').forEach(function (l) {
    const id = l['Invoice ID'];
    if (!inScope[id]) return;
    const lineCost = (Number(l['Quantity']) || 0) * (Number(l['Unit Cost']) || 0);
    cogs += lineCost;
    bucket_(l['Product ID'], '').cost += lineCost;
    addInvoiceProductQty_(costQtyByInvoiceProduct, id, l['Product ID'], Number(l['Quantity']) || 0);
  });

  // Vendor-sourced shortages bypass owned stock lots, but they still carry a
  // real cost that belongs in COGS. Active sourcing rows are the authoritative
  // cost evidence for those quantities.
  activeRows_('VENDOR_SOURCING').forEach(function (v) {
    const id = v['Invoice ID'];
    if (!inScope[id]) return;
    const qty = Number(v['Quantity']) || 0;
    const rawTotal = v['Total Cost'];
    const lineCost = rawTotal !== '' && rawTotal !== null && rawTotal !== undefined && isValidNonNegativeNumber_(rawTotal)
      ? Number(rawTotal)
      : qty * (Number(v['Unit Cost']) || 0);
    cogs += lineCost;
    bucket_(v['Product ID'], v['Product Name']).cost += lineCost;
    addInvoiceProductQty_(costQtyByInvoiceProduct, id, v['Product ID'], qty);
  });

  Object.keys(byProduct).forEach(function (pid) {
    byProduct[pid].profit = byProduct[pid].revenue - byProduct[pid].cost;
  });

  const expenseByCategory = {};
  let expenses = 0;
  activeRows_('EXPENSES').forEach(function (e) {
    if (e['Status'] === 'Cancelled') return;
    if (!inRange_(safeDateOnly_(e['Date']), range)) return;
    const amt = Number(e['Amount']) || 0;
    expenses += amt;
    const cat = e['Category Name'] || 'Uncategorized';
    if (!expenseByCategory[cat]) expenseByCategory[cat] = { label: cat, entries: 0, amount: 0 };
    expenseByCategory[cat].entries++;
    expenseByCategory[cat].amount += amt;
  });

  const netRevenue = grossSales - returnedTotal;
  const grossProfit = netRevenue - cogs;
  const settlementDiscount = computeSettlementDiscountProfit_(range);
  const netProfit = roundMoney_(grossProfit - expenses + settlementDiscount.netProfitImpact);
  const missing = sales.filter(function (s) {
    const id = s['Invoice ID'];
    const required = netQtyByInvoiceProduct[id] || {};
    const productIds = Object.keys(required);
    if (!productIds.length) return true;
    return productIds.some(function (productId) {
      const netQty = Math.max(0, Number(required[productId]) || 0);
      const coveredQty = Number((costQtyByInvoiceProduct[id] || {})[productId]) || 0;
      return coveredQty + 0.0000001 < netQty;
    });
  });

  const result = {
    range: range,
    totals: {
      invoices: sales.length,
      grossSales: grossSales,
      discount: discountTotal,
      returned: returnedTotal,
      netRevenue: netRevenue,
      cogs: cogs,
      grossProfit: grossProfit,
      grossMarginPercent: netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0,
      expenses: expenses,
      customerSettlementDiscount: settlementDiscount.customerDiscountGiven,
      supplierSettlementDiscountReceived: settlementDiscount.supplierDiscountReceived,
      settlementDiscountNetImpact: settlementDiscount.netProfitImpact,
      netProfit: netProfit,
      netMarginPercent: netRevenue > 0 ? (netProfit / netRevenue) * 100 : 0
    },
    coverage: {
      invoicesInRange: sales.length,
      invoicesWithLotData: sales.length - missing.length,
      invoicesMissingLotData: missing.length,
      missingSample: missing.slice(0, 10).map(function (s) {
        return {
          invoiceId: s['Invoice ID'],
          date: safeDateOnly_(s['Date']),
          grandTotal: Number(s['Grand Total']) || 0
        };
      })
    },
    byProduct: sortedByDesc_(byProduct, 'profit'),
    expenseByCategory: sortedByDesc_(expenseByCategory, 'amount')
  };

  try {
    const raw = JSON.stringify(result);
    if (raw.length <= 90000) CacheService.getScriptCache().put(cacheKey, raw, 30);
  } catch (e) {}
  return result;}

/** filters = { from, to }. FIFO-costed profit for the range. */
function getProfitReport(token, filters) {
  try {
    requirePermission_(token, 'reports', 'view');
    const result = computeProfit_(reportRange_(filters));
    result.topProducts = result.byProduct.slice(0, 15);
    result.lossMakers = result.byProduct.filter(function (p) { return p.profit < 0; }).slice(0, 10);
    return ok_(result);
  } catch (err) {
    logError_('getProfitReport', err);
    return fail_(err.message);
  }
}

// -------------------------------------------------------- Balance Sheet

/**
 * A snapshot as-of-now, like getStockReport — no date range, because these
 * are all live balances rather than period activity. Deliberately scoped
 * to exactly what the Business Finance spec asks for: Cash/Bank/Mobile
 * Banking/Inventory as assets, Outstanding Loan as the one liability,
 * Owner Capital as equity. Customer/Supplier dues and retained profit are
 * intentionally left out (not part of the spec), so Assets will not equal
 * Liabilities + Equity the way a full accounting balance sheet would —
 * this is a lightweight capital/loan snapshot, not a complete ledger.
 * Every figure is read from the sheet that already owns it (Cash Book,
 * Bank Accounts, Stock Lots, Finance Transactions) rather than stored
 * anywhere new.
 */
function getBalanceSheetReport(token) {
  try {
    requirePermission_(token, 'reports', 'view');

    const cash = getCashBalance_();
    let bank = 0, mobileBanking = 0;
    getAllRows_('BANK_ACCOUNTS').filter(function (b) { return b['Status'] !== 'Inactive'; }).forEach(function (b) {
      const bal = Number(b['Current Balance']) || 0;
      if (sanitizeAccountType_(b['Account Type']) === 'Mobile Banking') mobileBanking += bal;
      else bank += bal;
    });
    const inventory = getInventoryValueAtCost_();
    const totalAssets = cash + bank + mobileBanking + inventory;

    const outstandingLoan = getOutstandingLoan_();
    const ownerCapital = getOwnerCapital_();

    return ok_({
      asOf: formatDate_(new Date()),
      assets: { cash: cash, bank: bank, mobileBanking: mobileBanking, inventory: inventory, total: totalAssets },
      liabilities: { outstandingLoan: outstandingLoan, total: outstandingLoan },
      equity: { ownerCapital: ownerCapital, total: ownerCapital }
    });
  } catch (err) {
    logError_('getBalanceSheetReport', err);
    return fail_(err.message);
  }
}
