/**
 * Sales.gs
 * ---------------------------------------------------------------------
 * Turns a POS cart into a completed sale: validates stock, writes the
 * Sale + Sale Items rows (Date/Time are always server-generated — never
 * taken from the client), decreases stock with a logged movement per
 * line, and routes money to the Cash Book and/or Customer Ledger
 * depending on payment type. Returns the full invoice in the same call
 * so the client can show/print it immediately.
 *
 * Phase 4 (permission wiring): getPosBootstrap/completeSale now require
 * a session token and check requirePermission_ against the 'pos' module
 * before doing anything.
 *
 * Review item 12 / P0 #8: completeSale is now split into a validation
 * phase and a write phase, with a hard line between them. Previously the
 * SALES header row was appended and then the per-item loop did the stock
 * work — so a failure on line 3 left an invoice with no items, two
 * products already deducted, and their lots already drawn. There is no
 * rollback in Apps Script, so ordering is the only defence.
 *
 * Everything that can reject the sale now happens before the first write:
 * product existence, stock levels, the FIFO draw for every line (via
 * planStockConsumption_, which decides without writing), totals, payment
 * split, bank account, and the transaction date. After the WRITE PHASE
 * marker nothing raises a validation error.
 *
 * It also stopped re-reading Products once per cart line — one
 * getAllRows_ up front replaces a findRowIndex_ plus a getRange per item,
 * which for a ten-line cart was over twenty API calls before any write.
 *
 * Review item 6 / P0 #4: the Cash Book / Bank Book entry this function
 * writes now carries the transaction's own date instead of defaulting to
 * today, so a backdated entry no longer lands on today's cash drawer.
 *
 * Review item 2: completeSale now rejects the same product on two cart
 * lines. Without that guard both lines validated against the SAME
 * pre-read stock figure, so 6 + 6 passed against 10 in stock, and the
 * second updateRowFields_ overwrote the first — leaving Current Stock
 * reduced by only the last line's quantity while consumeStockFIFO_ had
 * correctly drawn both. Stock cache and lot ledger silently diverged.
 * updateSale has had this exact check since it was written; it just was
 * never copied across.
 *
 * P3 drift (items 6 & 7): the backdate preamble and the bank-account
 * lookup are now resolveTransactionDate_() / resolveBankAccount_() in
 * Utils.gs — same checks, same user-facing messages, one definition
 * instead of seven copies. Both throw instead of returning fail_(), and
 * the existing catch below turns that into the identical fail_ response.
 *
 * Phase 8 (bank wiring): completeSale() now requires a bankAccountId
 * when paymentMethod is 'Bank' and the sale actually takes a payment
 * (paidAmount > 0), and writes that portion through addBankBookEntry_
 * instead of unconditionally treating every paid amount as Cash (the
 * previous behavior — there was no Payment Method concept on a sale at
 * all before this). Existing/legacy rows with no Payment Method are
 * treated as Cash on read, matching what actually happened for them.
 *
 * Purchase Price Visibility: getPosBootstrap can additionally send each
 * product's cost price, for staff who are allowed to see it while
 * negotiating a floor price. Read-only and additive — it changes nothing
 * about what completeSale validates, writes, or prices. The cart never
 * sends a cost back, and completeSale neither reads nor trusts one.
 * ---------------------------------------------------------------------
 */

function getPosBootstrap(token) {
  try {
    const actingUser = requirePermission_(token, 'pos', 'view');
    // activeRows_, not getAllRows_: deleting a product is a SOFT delete
    // that stamps 'Is Deleted' and leaves Status alone, so the Status-only
    // filter kept deleted products in this grid — the same slip
    // getPurchaseBootstrap had for suppliers. Safe to hide, because
    // deleteProduct refuses while stock is non-zero or a live sale
    // references it, so nothing sellable disappears this way.
    //
    // CUSTOMERS is activeRows_ for consistency, not because it currently
    // filters anything out: deleteCustomer hard-deletes the row
    // (deleteRow_), so the soft-delete columns the sheet carries are never
    // populated for a customer. This stays correct either way if customer
    // deletion is ever moved onto the soft-delete path the recycle view's
    // DELETED_VIEW_SOURCES_ entry already anticipates.
    const products = activeRows_('PRODUCTS').filter(function (p) { return p['Status'] !== 'Inactive'; });
    const productsById = bundleProductMap_(products);
    const bundleIds = products.filter(function (p) {return bundleProductType_(p) === 'Bundle';}).map(function (p) {return p['Product ID'];});
    const bundleDefinitions = {}, bundleUnavailableById = {};
    const recipeRows = bundleIds.length ? getAllRows_('BUNDLE_COMPONENTS') : [];
    bundleIds.forEach(function (id) {
      try { bundleDefinitions[id] = getBundleDefinitions_([id],productsById,recipeRows)[id]; }
      catch(err) { bundleUnavailableById[id] = err.message; }
    });
    const customers = activeRows_('CUSTOMERS');
    const allLots = getAllRows_('STOCK_LOTS');
    const bankAccounts = getActiveBankAccountsForUI_();
    const settings = getSettingsMap_();
    const sessionResult = getActiveCashSession_();
    if (!sessionResult.success) throw new Error(sessionResult.message || 'Unable to verify the active cash session.');

    // ---- Purchase Price Visibility -------------------------------------
    // Cost basis is the single most sensitive figure on this screen, so it
    // is gated TWICE and the gate lives here, on the server: the shop-wide
    // Settings switch, AND this user's own 'posCost' view permission.
    // Unless both hold, `purchasePrice` is never put on the wire at all —
    // not sent-and-hidden, not sent-and-obfuscated. A user without the
    // right cannot recover it by reading the network response or poking at
    // posState in the console, because it was never in the payload.
    // Deliberately kept to the product's own on-file Purchase Price: it is
    // the same number the Products page shows and the same one FIFO falls
    // back to (planStockConsumption_), and reading it costs nothing extra
    // since PRODUCTS is already loaded above.
    // isSettingEnabled_ rather than === 'true': the sheet hands this back
    // as a real boolean, not the string that was written. See Utils.gs.
    const showPurchasePrice = isSettingEnabled_(settings['POS Show Purchase Price']) &&
      hasPermission_(actingUser, 'posCost', 'view');

    return ok_({
      products: products.filter(function (p) { return !bundleUnavailableById[p['Product ID']]; }).map(function (p) {
        const bundle = bundleProductType_(p) === 'Bundle';
        const definition = bundle ? bundleDefinitions[p['Product ID']] : null;
        const pricing = bundle
          ? {segments: [], fallbackSellPrice:Number(p['Selling Price'])||0, autoSellingPrice:Number(p['Selling Price'])||0}
          : buildLotPricingLadder_(p['Product ID'], allLots, p);
        const out = {
          id: p['Product ID'], name: p['Product Name'], brand: p['Brand'] || '',
          unit: p['Unit'], barcode: p['Barcode'] || '',
          sellingPrice: Number(p['Selling Price']) || 0,
          lotPricing: pricing.segments,
          fallbackSellPrice: pricing.fallbackSellPrice,
          autoSellingPrice: pricing.autoSellingPrice,
          stock: bundle ? getBundleAvailability_(definition,productsById) : (Number(p['Current Stock']) || 0),
          category: p['Category'], productType: bundle ? 'Bundle' : 'Standard',
          bundleRevision: bundle ? definition.revision : 0
        };
        if (showPurchasePrice) out.purchasePrice = Number(p['Purchase Price']) || 0;
        return out;
      }),
      // Lets POS tell "feature is off / not mine to see" (render nothing at
      // all) apart from "on, but this product's cost happens to be 0".
      showPurchasePrice: showPurchasePrice,
      // A profit preview is a sensitive cost-derived figure. Expose only
      // whether the logged-in user's existing report/cost rights allow it.
      canViewCurrentInvoiceProfit: canViewInvoiceProfit_(actingUser),
      multiPaymentEnabled: String(settings['POS Multi Payment Enabled'] || '').toLowerCase() === 'true',
      customers: customers.map(function (c) {
        return { id: c['Customer ID'], name: c['Customer Name'], phone: c['Phone'], address: c['Address'],fatherName:c['Father Name'] || '', due: Number(c['Current Due']) || 0 };
      }),
      // Vendor/Consignment Sourcing's per-line shortage chooser. 'vendors'
      // (active only) feeds the dropdown, 'vendorsAll' (incl. Inactive)
      // feeds the Manage Vendors modal — same active/all split
      // getFinanceBootstrap uses for FINANCE_PERSONS.
      vendors: getActiveVendorsForUI_(),
      vendorsAll: getAllVendorsForUI_(),
      bankAccounts: bankAccounts,
      activeSession: sessionResult.data,
      shopName: settings['Shop Name'] || CONFIG.APP_NAME,
      currencySymbol: settings['Currency Symbol'] || '',
      taxPercent: Number(settings['Tax Percent']) || 0
    });
  } catch (err) {
    logError_('getPosBootstrap', err);
    return fail_(err.message);
  }
}

/**
 * payload = {
 *   customerId, customerName, customerPhone,     // customerId '' + name/phone => quick-create
 *   items: [{ productId, name, qty, unitPrice, priceMode?, vendorId?, vendorUnitCost? }],
 *   discount, paymentType: 'Cash' | 'Due' | 'Partial', paidAmount,
 *   paymentMethod: 'Cash' | 'Bank' (only matters when paidAmount > 0),
 *   bankAccountId (required when paymentMethod is 'Bank' or 'Mobile Banking' and paidAmount > 0)
 * }
 * Supplier is intentionally absent from each sale line. FIFO chooses the
 * oldest available lots across every supplier for the product. A product
 * appears only once per invoice.
 *
 * item.vendorId/vendorUnitCost are only meaningful when this line has a
 * shortfall (qty exceeds what this product+supplier scope has on hand) and
 * the shortage is being sourced from a Vendor rather than left to go
 * negative — see the Vendor/Consignment Sourcing block below. Omit both for
 * ordinary lines and for a shortfall the user wants to leave as today's
 * default Negative Stock Sale.
 */
/**
 * Pure, read-only current-cart profit estimate. Uses the same FIFO cost
 * planner, vendor shortage and bundle demand aggregation as completeSale.
 * This never mutates lots, stock, orders or cash/bank sheets.
 */
function estimatePosInvoiceProfit_(payload, productsById, allLots, bundleDefinitions) {
  payload = payload || {};
  const items = payload.items;
  if (!Array.isArray(items) || !items.length) throw new Error('Cart is empty.');
  if (items.length > 200) throw new Error('Too many POS lines for a single preview.');
  const definitions = bundleDefinitions || {};
  const seen = {};
  const lines = [];
  let subtotal = 0, cogs = 0, costComplete = true;

  function addPlanCost_(plan, vendorCost) {
    (plan.draws || []).forEach(function (draw) {
      const qty = Number(draw.take) || 0, unitCost = Number(draw.unitCost) || 0;
      cogs += qty * unitCost;
      if (qty > 0 && unitCost <= 0) costComplete = false;
    });
    const missing = Number(plan.shortfall) || 0;
    if (missing > 0) {
      const unitCost = vendorCost === null ? (Number(plan.fallbackPrice) || 0) : vendorCost;
      cogs += missing * unitCost;
      if (unitCost <= 0) costComplete = false;
    }
  }

  items.forEach(function (item, i) {
    const productId = String(item && item.productId || '');
    const qty = Number(item && item.qty);
    const product = productsById[productId];
    if (!product || !productId || seen[productId]) throw new Error('Invalid or duplicate POS item: ' + (productId || String(i + 1)));
    seen[productId] = true;
    if (!isValidNonNegativeNumber_(qty) || qty <= 0) throw new Error('Line ' + (i + 1) + ': enter a positive quantity.');
    const isBundle = bundleProductType_(product) === 'Bundle';
    const vendorId = String(item.vendorId || '').trim();
    if (isBundle) {
      const recipe = definitions[productId];
      if (!recipe || !Number.isSafeInteger(qty) || Number(item.bundleRevision) !== Number(recipe.revision)) {
        throw new Error('Bundle recipe changed. Refresh POS before checking profit.');
      }
      if (vendorId) throw new Error('Vendor shortages cannot be sourced inside a bundle.');
    }
    const plan = isBundle ? null : (vendorId
      ? planSaleVendorConsumption_(productId, qty, allLots, product)
      : planStockConsumption_(productId, qty, allLots, product));
    let lineTotal;
    if (item.priceMode === 'auto') {
      lineTotal = isBundle
        ? roundMoney_(qty * (Number(product['Selling Price']) || 0))
        : computePlanSellingPrice_(plan, qty).lineTotal;
    } else if (item.priceMode === 'fixed' && isValidNonNegativeNumber_(item.lineTotal)) {
      lineTotal = roundMoney_(Number(item.lineTotal));
    } else {
      if (!isValidNonNegativeNumber_(item.unitPrice)) throw new Error('Line ' + (i + 1) + ': invalid selling price.');
      lineTotal = roundMoney_(qty * Number(item.unitPrice));
    }
    subtotal = roundMoney_(subtotal + lineTotal);
    if (vendorId && (plan.shortfall <= 0 || !isValidNonNegativeNumber_(item.vendorUnitCost))) {
      throw new Error('Vendor sourcing cost or shortage is not valid.');
    }
    lines.push({productId:productId, qty:qty, productType:isBundle?'Bundle':'Standard',
      vendorId:vendorId, vendorUnitCost:vendorId?Number(item.vendorUnitCost):0, plan:plan});
  });

  const bundleLines = lines.filter(function (l) { return l.productType === 'Bundle'; });
  const overlaps = {};
  if (bundleLines.length) {
    const first = buildSaleStockDemands_(bundleLines, definitions, {});
    const shared = lines.filter(function (l) {
      if (l.productType !== 'Standard' || !Object.prototype.hasOwnProperty.call(first.requirementsByProductId,l.productId)) return false;
      if (l.vendorId) throw new Error('Bundle and vendor-sourced standalone component cannot share an invoice.');
      overlaps[l.productId] = true;
      return true;
    });
    const demand = buildSaleStockDemands_(bundleLines.concat(shared), definitions, {});
    Object.keys(demand.requirementsByProductId).forEach(function (productId) {
      const product = productsById[productId];
      if (!product || bundleProductType_(product) !== 'Standard') throw new Error('Bundle component unavailable.');
      addPlanCost_(planStockConsumption_(productId,demand.requirementsByProductId[productId],allLots,product), null);
    });
  }

  lines.forEach(function (line) {
    if (line.productType !== 'Standard' || overlaps[line.productId]) return;
    addPlanCost_(line.plan, line.vendorId ? line.vendorUnitCost : null);
  });
  if (!isValidNonNegativeNumber_(payload.discount)) throw new Error('Invalid invoice discount.');
  const discount = roundMoney_(Number(payload.discount) || 0);
  const grandTotal = roundMoney_(Math.max(0, subtotal - discount));
  cogs = roundMoney_(cogs);
  const profit = roundMoney_(grandTotal - cogs);
  return {
    subtotal:subtotal, discount:discount, grandTotal:grandTotal, cogs:cogs,
    profit:profit, marginPercent:grandTotal > 0 ? roundMoney_(profit * 100 / grandTotal) : 0,
    costComplete:costComplete, estimated:true
  };
}

/** Authenticated, cost-permission-gated read-only cart preview for POS. */
function previewPosInvoiceProfit(token, payload) {
  try {
    const actingUser = requirePermission_(token,'pos','view');
    if (!canViewInvoiceProfit_(actingUser)) return fail_('No permission to view invoice profit.');
    const productsById = {};
    activeRows_('PRODUCTS').forEach(function (p) { productsById[p['Product ID']] = p; });
    const bundleIds = ((payload && payload.items) || []).filter(function (i) {
      return bundleProductType_(productsById[i.productId]) === 'Bundle';
    }).map(function (i) { return i.productId; });
    const defs = bundleIds.length ? getBundleDefinitions_(bundleIds, productsById, getAllRows_('BUNDLE_COMPONENTS')) : {};
    return ok_(estimatePosInvoiceProfit_(payload, productsById, getAllRows_('STOCK_LOTS'), defs));
  } catch (err) {
    logError_('previewPosInvoiceProfit', err);
    return fail_(err.message);
  }
}

function completeSale(token, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  let postingJournalIndex = -1;
  let postingOperationId = '';
  let postingLastStage = '';
  try {
    const actingUser = requirePermission_(token, 'pos', 'add');
    const multiPayment = payload && Object.prototype.hasOwnProperty.call(payload, 'payments');
    const postingActor = String(actingUser['User ID'] || actorName_(actingUser));
    let postingHash = '';
    if (multiPayment) {
      if (!Array.isArray(payload.payments)) throw new Error('Payment rows must be an array.');
      if (String(getSettingsMap_()['POS Multi Payment Enabled'] || '').toLowerCase() !== 'true') {
        throw new Error('POS multiple payments are not enabled for this business.');
      }
      postingOperationId = sanitizeInput_(payload.operationId);
      if (!/^[A-Za-z0-9_-]{12,100}$/.test(postingOperationId)) {
        throw new Error('A valid unique operation ID is required for multiple payments.');
      }
      postingHash = salePostingPayloadHash_(payload);
      const prior = getAllRows_('SALE_POSTING_JOURNAL').filter(function (r) {
        return String(r['Operation ID']) === postingOperationId;
      });
      if (prior.length > 1) throw new Error('Duplicate operation journal records. Needs Review.');
      if (prior.length) {
        const journal = prior[0];
        if (String(journal['Actor']) !== postingActor) throw new Error('Payment operation belongs to a different user.');
        const decision = salePostingJournalDecision_(journal, postingHash);
        if (decision !== 'replay') throw new Error('Previous payment operation is interrupted. Needs Review; do not repost.');
        const invoice = getAllRows_('SALES').filter(function (r) {
          return String(r['Invoice ID']) === String(journal['Invoice ID']) && !isDeleted_(r);
        });
        if (invoice.length !== 1 || String(invoice[0]['Payment Detail Version']) !== '1') {
          throw new Error('Committed payment invoice is missing or ambiguous. Needs Review.');
        }
        readSalePaymentBreakdown_(invoice[0], getAllRows_('SALE_PAYMENTS'));
        return ok_(buildInvoicePayload_(journal['Invoice ID']));
      }
    }
    if (!payload.items || !payload.items.length) return fail_('Cart is empty.');

    const sourceDraftId = sanitizeInput_(payload.sourceDraftId);
    const sourceDraftVersion = Number(payload.sourceDraftVersion);
    let sourceDraft = null;
    let fixedDraftLines = {};
    if (sourceDraftId) {
      const alreadyPosted = findPostedInvoiceByDraftId_(sourceDraftId);
      if (alreadyPosted) {
        authorizePostedDraftRetry_(actingUser, sourceDraftId, sourceDraftVersion);
        // A stranded new-format sale header is NOT proof of successful
        // posting. Do not clean up its draft or return success unless the
        // original journal committed and all payment children reconcile.
        if (String(alreadyPosted['Payment Detail Version']) === '1') {
          const committed = getAllRows_('SALE_POSTING_JOURNAL').filter(function (r) {
            return String(r['Invoice ID']) === String(alreadyPosted['Invoice ID']) &&
              String(r['Operation Type']) === 'Create';
          });
          if (committed.length !== 1 || String(committed[0]['State']) !== 'Committed') {
            throw new Error('Draft sale posting is interrupted. Needs Review; do not repost.');
          }
          readSalePaymentBreakdown_(alreadyPosted, getAllRows_('SALE_PAYMENTS'));
        }
        removeSalesDraftAfterPost_(sourceDraftId, sourceDraftVersion, alreadyPosted['Invoice ID'], actingUser, true);
        return ok_(buildInvoicePayload_(alreadyPosted['Invoice ID']));
      }
      sourceDraft = prepareSalesDraftForPosting_(actingUser, sourceDraftId, sourceDraftVersion);
      // Never let a modified/stale client silently post split draft payments
      // through the legacy single-account route (or vice versa).
      const savedPayment = sourceDraft.parsed && sourceDraft.parsed.payment || {};
      const savedSplit = Object.prototype.hasOwnProperty.call(savedPayment, 'payments');
      if (savedSplit !== multiPayment) {
        throw new Error('Draft payment format changed. Reload the draft before posting.');
      }
      fixedDraftLines = fixedDraftLineByProduct_(sourceDraft.parsed);
    }

    requireActiveCashSession_(); // every sale now requires an open drawer, not just ones that move cash
    

    const nameInput = sanitizeInput_(payload.customerName);
    const phoneInput = sanitizeInput_(payload.customerPhone);
    if (!nameInput || !phoneInput) return fail_('Customer name and phone are required for every sale.');

    // ================== VALIDATION PHASE — writes nothing ==================
    // Reads for the whole cart up front, instead of a findRowIndex_ plus a
    // getRange per line.
    // activeRows_ so a POS page left open across a product delete cannot
    // still ring one up — the line below turns it into a clean "no longer
    // exists" rejection during validation, before anything is written.
    // Cannot strand a real sale: deleteProduct refuses while stock is
    // non-zero or a live sale references the product.
    //
    // Only NEW sales. updateSale (SalesManagement.gs) and updatePurchase
    // (PurchaseManagement.gs) deliberately keep getAllRows_ — they edit
    // transactions that already exist, whose products the same delete
    // guard has already protected, so narrowing them would add no
    // protection and could block editing legitimate history.
    const productsById = {};
    activeRows_('PRODUCTS').forEach(function (p) { productsById[p['Product ID']] = p; });
    const allLots = getAllRows_('STOCK_LOTS');
    const bundleIds = (payload.items || []).filter(function(item){return bundleProductType_(productsById[item.productId]) === 'Bundle';}).map(function(item){return item.productId;});
    const bundleDefinitions = bundleIds.length ? getBundleDefinitions_(bundleIds,productsById,getAllRows_('BUNDLE_COMPONENTS')) : {};
    const vendorsById = {};
    getAllRows_('VENDORS').forEach(function (v) { vendorsById[v['Vendor ID']] = v; });

    let subtotal = 0;
    const lines = [];
    const seenProduct = {};
    payload.items.forEach(function (item, i) {
      const qty = Number(item.qty);
      const requestedMode = item.priceMode;
      const priceMode = requestedMode === 'auto' ? 'auto' : (requestedMode === 'fixed' ? 'fixed' : 'manual');
      const clientPrice = Number(item.unitPrice);
      if (!isValidNonNegativeNumber_(qty) || qty <= 0) throw new Error('Line ' + (i + 1) + ': quantity must be greater than zero.');
      if ((priceMode === 'manual' || priceMode === 'fixed') && !isValidNonNegativeNumber_(clientPrice)) throw new Error('Line ' + (i + 1) + ': price must be a valid number.');
      if (priceMode === 'fixed' && !sourceDraftId) throw new Error('Fixed draft pricing requires a valid source draft.');
      if (seenProduct[item.productId]) throw new Error(item.name + ' appears more than once — combine it into one line.');
      seenProduct[item.productId] = true;

      const product = productsById[item.productId];
      if (!product) throw new Error('Product ' + item.name + ' no longer exists.');
      const isBundle = bundleProductType_(product) === 'Bundle';
      if (isBundle && (!Number.isSafeInteger(qty) || Number(item.bundleRevision) !== bundleDefinitions[item.productId].revision)) {
        throw new Error(item.name + ': bundle quantity must be whole sets and its recipe must be refreshed.');
      }
      if (isBundle && item.vendorId) throw new Error('Vendor sourcing is not supported inside a bundle sale.');

      // Decide the FIFO draw across every supplier lot. Selling past
      // available stock is allowed on
      // purpose (the shop wants to record a sale even when the shelf is
      // empty) — any shortfall becomes an OVERSOLD lot in the write phase
      // below (see applyStockConsumption_ in StockLots.gs) instead of
      // rejecting the sale, and Current Stock is left to go negative so
      // that's visible until the next purchase brings it back up.
      //
      // Vendor sourcing is the one exception: positive lots can exceed NET
      // Current Stock while older OVERSOLD debt is still outstanding. In that
      // case only net-owned stock is sellable as our own; the rest is the
      // vendor shortage. Negative-stock sales intentionally keep the existing
      // generic lot behavior.
      const requestedVendorId = sanitizeInput_(item.vendorId);
      const plan = isBundle ? null : (requestedVendorId
        ? planSaleVendorConsumption_(item.productId, qty, allLots, product)
        : planStockConsumption_(item.productId, qty, allLots, product));
      // Automatic sale pricing is server-authoritative. Compute it before a
      // vendor resolution neutralizes plan.shortfall: shortage units still
      // sell at the product's current/default selling price.
      const autoPricing = isBundle ? {
        unitPrice: Number(product['Selling Price']) || 0,
        lineTotal: roundMoney_(qty * (Number(product['Selling Price']) || 0))
      } : computePlanSellingPrice_(plan, qty);

      // ---- Vendor/Consignment Sourcing: divert this line's shortfall away
      // from becoming an OVERSOLD lot, and onto a chosen vendor instead.
      // Only one resolution ever applies to a line's WHOLE shortfall (no
      // splitting between vendor and negative-stock) — the vendor takes on
      // exactly plan.shortfall units, at the vendor's own unit cost, and
      // that quantity never touches Current Stock/Stock Lots (it was never
      // this shop's inventory). Omitting item.vendorId leaves plan.shortfall
      // untouched, which is exactly today's unchanged Negative Stock Sale
      // default below.
      let vendorRow = null, vendorQty = 0, vendorUnitCost = 0, vendorTotalCost = 0;
      if (requestedVendorId) {
        if (plan.shortfall <= 0) throw new Error(item.name + ': there is no shortage on this line to source from a vendor.');
        vendorRow = vendorsById[requestedVendorId];
        if (!vendorRow || isDeleted_(vendorRow) || vendorRow['Status'] === 'Inactive') {
          throw new Error(item.name + ': vendor not found or inactive.');
        }
        vendorUnitCost = Number(item.vendorUnitCost);
        if (!isValidNonNegativeNumber_(vendorUnitCost)) throw new Error(item.name + ': enter a valid vendor unit cost.');
        vendorQty = plan.shortfall; // the whole shortfall, never partial
        vendorTotalCost = vendorQty * vendorUnitCost;
        plan.shortfall = 0; // neutralized — applyStockConsumption_ only creates an OVERSOLD lot when shortfall > 0, nothing else reads this field
      }

      const currentStock = Number(product['Current Stock']) || 0;
      let price, lineTotal;
      if (priceMode === 'auto') {
        price = autoPricing.unitPrice;
        lineTotal = autoPricing.lineTotal;
      } else if (priceMode === 'fixed') {
        const saved = fixedDraftLines[String(item.productId)];
        const incomingLineTotal = Number(item.lineTotal);
        if (!saved || Number(saved.qty) !== qty || Number(saved.unitPrice) !== clientPrice || Number(saved.lineTotal) !== incomingLineTotal) {
          throw new Error('Draft line changed. Update the draft or edit the line before posting.');
        }
        price = Number(saved.unitPrice);
        lineTotal = Number(saved.lineTotal);
      } else {
        price = clientPrice;
        lineTotal = roundMoney_(qty * clientPrice);
      }
      lines.push({
        productId: item.productId, name: item.name, qty: qty, price: price, lineTotal: lineTotal, priceMode: priceMode,
        productType: isBundle ? 'Bundle' : 'Standard', bundleRevision: isBundle ? bundleDefinitions[item.productId].revision : 0,
        rowIndex: product._rowIndex, newStock: currentStock - (qty - vendorQty),
        plan: plan,
        vendorId: requestedVendorId || '', vendorName: vendorRow ? vendorRow['Vendor Name'] : '',
        vendorQty: vendorQty, vendorUnitCost: vendorUnitCost, vendorTotalCost: vendorTotalCost
      });
      subtotal = roundMoney_(subtotal + lineTotal);
    });

    // Aggregate once per physical component. The same Pipe may be sold on its
    // own and inside several sets; planning separately would consume one lot
    // twice and make the product stock cache disagree with the lot ledger.
    const bundleLines = lines.filter(function(line){return line.productType === 'Bundle';});
    const bundlePhysicalPlans = {}, bundlePlannedStandalone = {};
    if (bundleLines.length) {
      const firstDemand = buildSaleStockDemands_(bundleLines,bundleDefinitions,{});
      const physicalIds = firstDemand.requirementsByProductId;
      const involvedStandalone = lines.filter(function(line){
        if (line.productType !== 'Standard' || !Object.prototype.hasOwnProperty.call(physicalIds,line.productId)) return false;
        if (line.vendorId) throw new Error('Bundle and vendor-sourced standalone component must be sold on separate invoices: '+line.name);
        bundlePlannedStandalone[line.productId] = true;
        return true;
      });
      const demand = buildSaleStockDemands_(bundleLines.concat(involvedStandalone),bundleDefinitions,{});
      Object.keys(demand.requirementsByProductId).forEach(function(productId){
        const product = productsById[productId];
        if (!product || bundleProductType_(product) !== 'Standard') throw new Error('Bundle component no longer exists.');
        const qty = demand.requirementsByProductId[productId];
        const fifoPlan = planStockConsumption_(productId,qty,allLots,product);
        // Preflight the parent allocation before posting any invoice or lot.
        // applyStockConsumption_ later assigns actual OVERSOLD lot IDs.
        const virtualDraws=fifoPlan.draws.map(function(d){return {lotId:d.lotId,qty:d.take,unitCost:d.unitCost,unitSellPrice:d.unitSellPrice};});
        if(fifoPlan.shortfall>0)virtualDraws.push({lotId:'__PREVIEW_OVERSOLD__',qty:fifoPlan.shortfall,unitCost:fifoPlan.fallbackPrice,unitSellPrice:fifoPlan.fallbackSellPrice});
        attributeBundleConsumption_(demand.ownersByProductId[productId],virtualDraws);
        bundlePhysicalPlans[productId] = {
          plan: fifoPlan, product: product, qty:qty,
          owners:demand.ownersByProductId[productId],
          newStock:(Number(product['Current Stock']) || 0)-qty
        };
      });
    }

    const discount = isValidNonNegativeNumber_(payload.discount) ? Number(payload.discount) : 0;
    const grandTotal = Math.max(0, subtotal - discount);

    let paidAmount, dueAmount, paymentType, paymentStatus, paymentMethod, bankAccountId, bankAccountName;
    let allocations = null;
    if (multiPayment) {
      // All account/amount rejections occur BEFORE journal, stock or money writes.
      // The existing paymentType enum uses Cash to mean fully paid, not
      // necessarily a literal Cash tender.
      allocations = normalizeSalePayments_(roundMoney_(grandTotal), payload.payments, getAllRows_('BANK_ACCOUNTS'));
      paidAmount = allocations.paidAmount;
      dueAmount = allocations.dueAmount;
      paymentType = allocations.paymentType;
      paymentStatus = allocations.paymentStatus;
      paymentMethod = allocations.paymentMethod;
      bankAccountId = allocations.bankAccountId;
      bankAccountName = allocations.bankAccountName;
    } else {
      paymentType = payload.paymentType;
      if (paymentType === 'Cash') {
        paidAmount = grandTotal; dueAmount = 0;
      } else if (paymentType === 'Due') {
        paidAmount = 0; dueAmount = grandTotal;
      } else if (paymentType === 'Partial') {
        paidAmount = isValidNonNegativeNumber_(payload.paidAmount) ? Number(payload.paidAmount) : 0;
        if (paidAmount <= 0 || paidAmount >= grandTotal) throw new Error('Partial payment must be more than 0 and less than the grand total.');
        dueAmount = grandTotal - paidAmount;
      } else {
        throw new Error('Choose a payment type.');
      }
      paymentStatus = dueAmount <= 0 ? 'Paid' : (paidAmount > 0 ? 'Partial' : 'Due');
      paymentMethod = paidAmount > 0 ? (payload.paymentMethod || 'Cash') : '';
      const bankAccount = resolveBankAccount_(paymentMethod, payload.bankAccountId);
      bankAccountId = bankAccount.id;
      bankAccountName = bankAccount.name;
    }

    let customerName = sanitizeInput_(payload.customerName) || 'Walk-in Customer';
    let customerPhone = sanitizeInput_(payload.customerPhone);
    let customerAddress = sanitizeInput_(payload.customerAddress);
    let customerFatherName = sanitizeInput_(payload.customerFatherName);

    // resolveOrCreateCustomer_ rejects this name outright. Catching it here
    // keeps the write phase free of anything that can refuse the sale.
    if (dueAmount > 0 && customerName === 'Walk-in Customer') {
      throw new Error('A customer name and phone are needed to track this against an account.');
    }

    // Throws on a future date, a malformed date, a missing backdate reason,
    // or no backdate permission — so it belongs on this side of the line.
    const txDate = resolveTransactionDate_(token, 'pos', payload.date, payload.backdatedReason, 'Sale');
    const dateStr = txDate.dateStr;

    // ======================== WRITE PHASE ========================
    // Nothing below here raises a validation error. Apps Script has no
    // transactions, so this ordering is what stops a rejected sale from
    // leaving half-written records behind.
    const now = new Date();
    // Reserve the invoice number and journal it before the first financial or
    // stock write. A retry of a Writing/Needs Review operation never reposts.
    const reservedInvoiceId = multiPayment ? generateId_('SALES') : '';
    if (multiPayment) {
      appendRow_('SALE_POSTING_JOURNAL', {
        'Operation ID':postingOperationId, 'Operation Type':'Create',
        'Payload Hash':postingHash, 'Invoice ID':reservedInvoiceId,
        State:'Writing', 'Last Completed Stage':'Reserved',
        Actor:postingActor, 'Created At':now, 'Updated At':now, Error:''
      });
      postingJournalIndex = findRowIndex_('SALE_POSTING_JOURNAL', 'Operation ID', postingOperationId);
      if (postingJournalIndex < 2) throw new Error('Posting journal reservation is missing.');
      postingLastStage = 'Reserved';
    }
    function recordStage_(stage, state) {
      if (postingJournalIndex < 2) return;
      updateRowFields_('SALE_POSTING_JOURNAL', postingJournalIndex, {
        State:state || 'Writing', 'Last Completed Stage':stage, 'Updated At':new Date()
      });
      postingLastStage = stage;
    }

    // Customer first: the sale row needs its ID. If this throws (it can't,
    // given the guard above) the worst case is a customer with no sale,
    // which is harmless and self-evident.
    let customerId = sanitizeInput_(payload.customerId);
    if (dueAmount > 0) {
      // A restored draft may still carry an old customer name/phone snapshot.
      // When the operator selected an explicit Customer ID, that ID is the
      // authoritative identity. Canonicalize the denormalized sale snapshot
      // from the current Customer master before running the strict resolver.
      // This keeps duplicate-phone protection for phone-only sales while
      // preventing a stale draft value from blocking the selected customer.
      if (customerId) {
        const selectedCustomer = getAllRows_('CUSTOMERS').filter(function (c) {
          return String(c['Customer ID'] || '') === customerId;
        })[0];
        if (selectedCustomer && !isDeleted_(selectedCustomer) && selectedCustomer['Status'] !== 'Inactive') {
          customerName = sanitizeInput_(selectedCustomer['Customer Name']) || customerName;
          customerPhone = normalizePhoneDisplay_(selectedCustomer['Phone']) || customerPhone;
          customerAddress = sanitizeInput_(selectedCustomer['Address']);
          customerFatherName = sanitizeInput_(selectedCustomer['Father Name']);
        }
      }
      customerId = resolveOrCreateCustomer_(customerName, customerPhone, customerAddress, customerFatherName, customerId);
    }

    const invoiceId = multiPayment ? reservedInvoiceId : generateId_('SALES');

    appendRow_('SALES', {
      'Invoice ID': invoiceId, 'Date': dateStr, 'Time': Utilities.formatDate(now, Session.getScriptTimeZone(), 'HH:mm:ss'),
      'Customer ID': customerId, 'Customer Name': customerName, 'Customer Phone': customerPhone,
      'Customer Address': customerAddress,
      'Subtotal': subtotal, 'Discount': discount, 'Grand Total': grandTotal,
      'Paid Amount': paidAmount, 'Due Amount': dueAmount, 'Payment Type': paymentType,
      'Payment Status': paymentStatus, 'Created By': actorName_(actingUser),
      'Created At': now,
      'Payment Method': paymentMethod, 'Bank Account ID': bankAccountId, 'Bank Account Name': bankAccountName,
      'Is Backdated': txDate.isBackdated, 'Backdated Days': txDate.backdatedDays, 'Backdated Reason': txDate.reason,
      'Source Draft ID': sourceDraftId || '',
      'Payment Detail Version': multiPayment ? 1 : ''
    });
    recordStage_('Invoice');

    const saleItemRows = [];
    const stockMovementRows = [];
    const saleItemLotRows = [];
    lines.forEach(function (line) {
      saleItemRows.push({
        'Invoice ID': invoiceId, 'Product ID': line.productId, 'Product Name': line.name,
        'Quantity': line.qty, 'Unit Price': line.price, 'Line Total': line.lineTotal,
        'Sold Product Type': line.productType
      });

      if (line.productType === 'Bundle' || bundlePlannedStandalone[line.productId]) return;
      // The plan was decided during validation; this only writes it.
      const consumption = applyStockConsumption_(line.plan);
      updateRowFields_('PRODUCTS', line.rowIndex, { 'Current Stock': line.newStock, 'Updated At': now });

      consumption.forEach(function (c) {
        stockMovementRows.push({
          'Movement ID': generateId_('STOCK_MOVEMENT'), 'Date': now, 'Product ID': line.productId,
          'Product Name': line.name, 'Type': 'Sale', 'Reference': invoiceId,
          'Quantity In': '', 'Quantity Out': c.qty, 'Balance Stock': line.newStock, 'Notes': '', 'Lot ID': c.lotId,
          'Source Sale Product ID': line.productId
        });
        const consumedLot = allLots.filter(function (l) { return l['Lot ID'] === c.lotId; })[0];
        saleItemLotRows.push({
          'Invoice ID': invoiceId, 'Product ID': line.productId, 'Lot ID': c.lotId,
          'Quantity': c.qty, 'Unit Cost': c.unitCost, 'Unit Sell Price': c.unitSellPrice, 'Created At': now,
          'Supplier ID': consumedLot ? (consumedLot['Supplier ID'] || '') : '',
          'Source Sale Product ID': line.productId
        });
      });
    });
    const bundleSnapshotRows = [];
    bundleLines.forEach(function(line) {
      bundleDefinitions[line.productId].components.forEach(function(component){
        bundleSnapshotRows.push({
          'Invoice ID': invoiceId, 'Bundle Product ID': line.productId,
          'Bundle Revision': line.bundleRevision,
          'Component Product ID': component.productId,
          'Quantity Per Set': component.qtyPerSet,
          'Sets Sold': line.qty, 'Component Quantity Sold': line.qty*component.qtyPerSet,
          Unit: component.unit, 'Created At': now
        });
      });
    });
    Object.keys(bundlePhysicalPlans).forEach(function(productId){
      const physical = bundlePhysicalPlans[productId];
      const consumption = applyStockConsumption_(physical.plan);
      updateRowFields_('PRODUCTS',physical.product._rowIndex,{'Current Stock':physical.newStock,'Updated At':now});
      const allocated = attributeBundleConsumption_(physical.owners,consumption);
      allocated.forEach(function(c){
        const consumedLot=allLots.filter(function(row){return row['Lot ID'] === c.lotId;})[0];
        stockMovementRows.push({
          'Movement ID':generateId_('STOCK_MOVEMENT'),'Date':now,'Product ID':productId,
          'Product Name':physical.product['Product Name'],'Type':'Sale','Reference':invoiceId,
          'Quantity In':'','Quantity Out':c.qty,'Balance Stock':physical.newStock,
          'Notes':'Sold as '+c.sourceSaleProductId,'Lot ID':c.lotId,
          'Source Sale Product ID':c.sourceSaleProductId
        });
        saleItemLotRows.push({
          'Invoice ID':invoiceId,'Product ID':productId,'Lot ID':c.lotId,
          'Quantity':c.qty,'Unit Cost':c.unitCost,'Unit Sell Price':c.unitSellPrice,
          'Created At':now,'Supplier ID':consumedLot ? consumedLot['Supplier ID']||'' : '',
          'Source Sale Product ID':c.sourceSaleProductId
        });
      });
    });
    appendRows_('SALE_ITEMS', saleItemRows);
    if (bundleSnapshotRows.length) appendRows_('SALE_BUNDLE_COMPONENTS',bundleSnapshotRows);
    appendRows_('STOCK_MOVEMENT', stockMovementRows);
    appendRows_('SALE_ITEM_LOTS', saleItemLotRows);
    recordStage_('Stock And Items');

    // Vendor/Consignment Sourcing: one row per line that had a vendor
    // resolution, plus a matching VENDOR_LEDGER 'Sourcing' entry that posts
    // the vendor's Current Due up by the full cost (postVendorLedgerEntry_
    // is the one place that ever changes a vendor's due — see Vendors.gs).
    const vendorSourcingRows = [];
    lines.forEach(function (line) {
      if (!line.vendorId) return;
      const sourcingId = generateId_('VENDOR_SOURCING');
      vendorSourcingRows.push({
        'Sourcing ID': sourcingId, 'Date': dateStr, 'Invoice ID': invoiceId,
        'Product ID': line.productId, 'Product Name': line.name,
        'Vendor ID': line.vendorId, 'Vendor Name': line.vendorName,
        'Quantity': line.vendorQty, 'Unit Cost': line.vendorUnitCost, 'Total Cost': line.vendorTotalCost,
        'Created By': actorName_(actingUser), 'Created At': now
      });
      postVendorLedgerEntry_({
        vendorId: line.vendorId, vendorName: line.vendorName, date: dateStr, type: 'Sourcing',
        reference: sourcingId, debit: line.vendorTotalCost,
        notes: 'Sourced ' + line.vendorQty + ' x ' + line.name + ' for Invoice ' + invoiceId,
        createdBy: actorName_(actingUser)
      });
    });
    if (vendorSourcingRows.length) appendRows_('VENDOR_SOURCING', vendorSourcingRows);

    if (multiPayment) {
      const paymentRows = allocations.payments.map(function (p) {
        return {
          'Payment ID':generateId_('SALE_PAYMENTS'),
          'Invoice ID':invoiceId, Revision:1, 'Row Order':p.rowOrder,
          Method:p.method, 'Bank Account ID':p.bankAccountId,
          'Bank Account Name':p.bankAccountName,
          'Tendered Amount':p.tendered, 'Applied Amount':p.applied,
          'Change Amount':p.change, 'Transaction Date':dateStr,
          'Created At':now, 'Created By':actorName_(actingUser),
          'Operation ID':postingOperationId, Status:'Active'
        };
      });
      // Persist tender/change metadata even if an entire Cash tender was
      // returned as change. Only APPLIED amounts go into money books.
      if (paymentRows.length) appendRows_('SALE_PAYMENTS',paymentRows);
      recordStage_('Payment Details');
      allocations.payments.forEach(function (p) {
        if (p.applied <= 0) return;
        if (p.method === 'Cash') {
          addCashBookEntry_({
            Type:'Sale',Reference:invoiceId,Description:'POS sale to '+customerName,
            Debit:'',Credit:p.applied,PaymentMethod:'Cash',Date:dateStr
          });
        } else {
          addBankBookEntry_(p.bankAccountId, {
            Type:'Sale',Reference:invoiceId,Description:'POS sale to '+customerName,
            Debit:'',Credit:p.applied,Date:dateStr
          });
        }
      });
      recordStage_('Money Books');
    } else if (paidAmount > 0) {
      if (isBankLikePaymentMethod_(paymentMethod)) {
        addBankBookEntry_(bankAccountId, {
          Type: 'Sale', Reference: invoiceId, Description: 'POS sale to ' + customerName,
          Debit: '', Credit: paidAmount, Date: dateStr
        });
      } else {
        addCashBookEntry_({
          Type: 'Sale', Reference: invoiceId, Description: 'POS sale to ' + customerName,
          Debit: '', Credit: paidAmount, PaymentMethod: 'Cash', Date: dateStr
        });
      }
    }

    if (dueAmount > 0) {
      const custRowIndex = findRowIndex_('CUSTOMERS', 'Customer ID', customerId);
      const custRow = getAllRows_('CUSTOMERS').filter(function (c) { return c['Customer ID'] === customerId; })[0];
      const newDue = (Number(custRow['Current Due']) || 0) + dueAmount;
      updateRowFields_('CUSTOMERS', custRowIndex, { 'Current Due': newDue });
      appendRow_('CUSTOMER_LEDGER', {
        'Ledger ID': generateId_('CUSTOMER_LEDGER'), 'Date': dateStr, 'Customer ID': customerId,
        'Customer Name': customerName, 'Type': 'Sale', 'Reference': invoiceId,
        'Debit': dueAmount, 'Credit': '', 'Balance': newDue, 'Notes': '',
        'Is Backdated': txDate.isBackdated, 'Backdated Days': txDate.backdatedDays,
        'Backdated Reason': txDate.reason, 'Created By': actorName_(actingUser), 'Created At': now
      });
    }

    recordStage_('Customer Due');
    if (sourceDraftId) removeSalesDraftAfterPost_(sourceDraftId, sourceDraftVersion, invoiceId, actingUser, false);
    recordStage_('Committed','Committed');
    return ok_(buildInvoicePayload_(invoiceId));
  } catch (err) {
    logError_('completeSale', err);
    if (postingJournalIndex >= 2) {
      try {
        updateRowFields_('SALE_POSTING_JOURNAL', postingJournalIndex, {
          State:'Needs Review', 'Last Completed Stage':postingLastStage,
          Error:String(err.message).slice(0,300), 'Updated At':new Date()
        });
      } catch (journalError) { logError_('salePostingJournalRepair',journalError); }
      return fail_('Sale posting interrupted. Needs Review; do not submit as a new sale. ' + err.message);
    }
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}
