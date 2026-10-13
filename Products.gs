/**
 * Products.gs
 * ---------------------------------------------------------------------
 * CRUD for the Products sheet. Stock is only ever changed here through
 * an explicit, logged Stock Movement row — Purchase.gs and Sales.gs add
 * their own movements rather than writing Current Stock directly, so
 * the Stock Movement sheet always explains every change.
 *
 * Phase 3 (permission wiring): every function here now requires a
 * session token and checks requirePermission_ before doing anything.
 * adjustStock is treated as an 'edit' action (it's a correction to an
 * existing product's stock, not a new record). No product delete
 * function exists (status toggle only), so there's no delete-window
 * wiring in this file.
 * ---------------------------------------------------------------------
 */

function getProductsBootstrap(token) {
  try {
    requirePermission_(token, "products", "view");
    const products = activeRows_("PRODUCTS");
    const productMap = bundleProductMap_(products);
    const bundleIds = products.filter(function (p) { return bundleProductType_(p) === 'Bundle'; }).map(function (p) { return p['Product ID']; });
    const bundleDefinitions = bundleIds.length ? getBundleDefinitions_(bundleIds, productMap, getAllRows_('BUNDLE_COMPONENTS')) : {};
    const settings = getSettingsMap_();
    const categories = getAllRows_("PRODUCT_CATEGORIES").filter(function (c) {
      return c["Status"] !== "Inactive";
    });
    const units = getAllRows_("PRODUCT_UNITS").filter(function (u) {
      return u["Status"] !== "Inactive";
    });

    // Stock value is FIFO/lot based whenever the lot ledger fully explains
    // the product's Current Stock. Some existing/migrated rows can have a
    // zero-cost OPENING/ADJUSTMENT lot, or Current Stock can be ahead of the
    // remaining lot quantity. The old code treated the mere existence of ANY
    // lot row as authoritative, which made Stock Value show 0 even when the
    // product had positive stock and a valid Purchase Price.
    //
    // Keep real purchase lots authoritative (including a legitimate free/0
    // cost purchase). Only unpriced internal opening/adjustment stock and a
    // positive quantity gap fall back to Products.Purchase Price. This fixes
    // the display without replacing normal FIFO valuation.
    const lotStatsByProduct = {};
    getAllRows_("STOCK_LOTS").forEach(function (l) {
      const pid = l["Product ID"];
      if (!pid) return;
      const qty = Number(l["Remaining Quantity"]) || 0;
      const cost = Number(l["Purchase Price"]) || 0;
      const source = String(l["Purchase ID"] || "").toUpperCase();
      const stats = lotStatsByProduct[pid] || { qty: 0, value: 0, unpricedInternalQty: 0, unpricedInternalLotCount: 0 };
      stats.qty += qty;
      stats.value += qty * cost;

      // These sources are created from the product's own Purchase Price, so
      // a positive remaining quantity with a zero stored cost means the lot
      // is incomplete legacy/bad data rather than a genuine free purchase.
      if (qty > 0 && cost === 0 && (
        source === "OPENING" ||
        source === "OPENING-MIGRATION" ||
        source === "ADJUSTMENT" ||
        source === "LEGACY" ||
        source.indexOf("OPENING-") === 0 ||
        source.indexOf("ADJUSTMENT-") === 0
      )) {
        stats.unpricedInternalQty += qty;
        stats.unpricedInternalLotCount++;
      }
      lotStatsByProduct[pid] = stats;
    });

    const productsWithValue = products.map(function (p) {
      const pid = p["Product ID"];
      const isBundle = bundleProductType_(p) === 'Bundle';
      const currentStock = isBundle ? 0 : (Number(p["Current Stock"]) || 0);
      const productCost = Number(p["Purchase Price"]) || 0;
      const stats = lotStatsByProduct[pid];
      let stockValue;

      // Preserve the original no-lot fallback exactly (including negative
      // stock): Current Stock x the product's current Purchase Price.
      if (!stats) {
        stockValue = currentStock * productCost;
      } else {
        stockValue = stats.value;

        // Only fill a positive gap when the lot ledger does not exceed Current
        // Stock. If lot quantity is greater than Current Stock, keep the lot
        // valuation untouched so a reconciliation problem is not silently
        // hidden by this display fallback.
        if (stats.qty <= currentStock) {
          const missingQty = Math.max(0, currentStock - stats.qty);
          stockValue += (stats.unpricedInternalQty + missingQty) * productCost;
        }
      }

      return Object.assign({}, p, {
        'Product Type': isBundle ? 'Bundle' : 'Standard',
        'Bundle Components': isBundle ? bundleDefinitions[p['Product ID']].components : [],
        'Available Sets': isBundle ? getBundleAvailability_(bundleDefinitions[p['Product ID']],productMap) : 0,
        "Stock Value": isBundle ? 0 : stockValue,
        "Unpriced Lot Count": stats ? (stats.unpricedInternalLotCount || 0) : 0,
        "Unpriced Remaining Quantity": stats ? (stats.unpricedInternalQty || 0) : 0
      });
    });

    return ok_({
      products: productsWithValue,
      categories: categories.map(function (c) {
        return { id: c["Category ID"], name: c["Category Name"] };
      }),
      units: units.map(function (u) {
        return { id: u["Unit ID"], name: u["Unit Name"] };
      }),
      currencySymbol: settings["Currency Symbol"] || "",
      lowStockThreshold: Number(settings["Low Stock Threshold"]) || 5,
    });
  } catch (err) {
    logError_("getProductsBootstrap", err);
    return fail_(err.message);
  }
}

function addProduct(token, payload) {
  if (payload && payload.productType === 'Bundle') return addBundleProduct(token, payload);
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    requirePermission_(token, "products", "add");
    const name = sanitizeInput_(payload.name);
    if (!name) return fail_("Product name is required.");
    if (!isValidNonNegativeNumber_(payload.purchasePrice))
      return fail_("Purchase price must be a valid number.");
    if (!isValidNonNegativeNumber_(payload.sellingPrice))
      return fail_("Selling price must be a valid number.");
    if (!isValidNonNegativeNumber_(payload.stock))
      return fail_("Opening stock must be a valid number.");
    if (!isValidNonNegativeNumber_(payload.minStock))
      return fail_("Minimum stock must be a valid number.");
    const stock = Number(payload.stock);
    if (stock > 0 && Number(payload.purchasePrice) <= 0)
      return fail_("Purchase Price must be greater than zero when Opening Stock is greater than zero.");
    // activeRows_, same reason as addSupplier: products are soft-deleted,
    // so getAllRows_ let a deleted product keep its name reserved and
    // blocked re-creating it. Nothing resolves a product by name — every
    // lookup uses Product ID — so a deleted row sharing a name is safe.
    const duplicate = activeRows_("PRODUCTS").some(function (p) {
      return String(p["Product Name"]).toLowerCase() === name.toLowerCase();
    });
    if (duplicate) return fail_("A product with this name already exists.");

    const id = generateId_("PRODUCTS");
    if (stock > 0) requireActiveCashSession_();
    const now = new Date();

    appendRow_("PRODUCTS", {
      "Product ID": id,
      "Product Name": name,
      Brand: sanitizeInput_(payload.brand),
      Category: sanitizeInput_(payload.category) || "Uncategorized",
      Unit: sanitizeInput_(payload.unit) || "pcs",
      Barcode: sanitizeInput_(payload.barcode),
      "Purchase Price": Number(payload.purchasePrice),
      "Selling Price": Number(payload.sellingPrice),
      "Current Stock": stock,
      "Minimum Stock": Number(payload.minStock),
      Status: "Active",
      "Created At": now,
      "Updated At": now,
    });
    if (stock > 0) {
      const lotId = createLot_(
        id,
        name,
        "OPENING",
        now,
        Number(payload.purchasePrice),
        stock
      );
      appendRow_("STOCK_MOVEMENT", {
        "Movement ID": generateId_("STOCK_MOVEMENT"),
        Date: now,
        "Product ID": id,
        "Product Name": name,
        Type: "Opening Stock",
        Reference: id,
        "Quantity In": stock,
        "Quantity Out": "",
        "Balance Stock": stock,
        Notes: "Initial stock on product creation",
        "Lot ID": lotId,
      });
    }

    return ok_({ id: id });
  } catch (err) {
    logError_("addProduct", err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Edits product details. A changed Opening/Current Stock value is applied
 * here too (e.g. correcting a typo made at product creation), but it is
 * never written to Products directly — it goes through the same
 * add-a-lot / consume-FIFO path as adjustStock() and logs an identical
 * Stock Movement row, so the lot ledger and movement history never
 * silently drift from Current Stock.
 */
function updateProduct(token, productId, payload) {
  if (payload && payload.productType === 'Bundle') return updateBundleProduct(token, productId, payload);
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    requirePermission_(token, "products", "edit");
    const rowIndex = findRowIndex_("PRODUCTS", "Product ID", productId);
    if (rowIndex === -1) return fail_("Product not found.");

    const name = sanitizeInput_(payload.name);
    if (!name) return fail_("Product name is required.");
    if (!isValidNonNegativeNumber_(payload.purchasePrice))
      return fail_("Purchase price must be a valid number.");
    if (!isValidNonNegativeNumber_(payload.sellingPrice))
      return fail_("Selling price must be a valid number.");
    if (!isValidNonNegativeNumber_(payload.minStock))
      return fail_("Minimum stock must be a valid number.");
    if (!isValidNonNegativeNumber_(payload.stock))
      return fail_("Opening stock must be a valid number.");

    const product = getAllRows_("PRODUCTS").filter(function (p) {
      return p["Product ID"] === productId;
    })[0];
    if (bundleProductType_(product) === 'Bundle') throw new Error('Bundle stock cannot be edited. Change its components instead.');
    const currentStock = Number(product["Current Stock"]) || 0;
    const newStock = Number(payload.stock);
    const delta = newStock - currentStock;

    if (delta > 0 && Number(payload.purchasePrice) <= 0)
      return fail_("Purchase Price must be greater than zero when increasing stock.");
    if (delta !== 0) requireActiveCashSession_();

    const fields = {
      "Product Name": name,
      Brand: sanitizeInput_(payload.brand),
      Category: sanitizeInput_(payload.category) || "Uncategorized",
      Unit: sanitizeInput_(payload.unit) || "pcs",
      Barcode: sanitizeInput_(payload.barcode),
      "Purchase Price": Number(payload.purchasePrice),
      "Selling Price": Number(payload.sellingPrice),
      "Minimum Stock": Number(payload.minStock),
      "Updated At": new Date(),
    };
    if (delta !== 0) fields["Current Stock"] = newStock;
    updateRowFields_("PRODUCTS", rowIndex, fields);

    if (delta !== 0) {
      let lotIdsTouched;
      if (delta > 0) {
        lotIdsTouched = [addAdjustmentLot_(productId, name, delta)];
      } else {
        lotIdsTouched = consumeStockFIFO_(productId, Math.abs(delta)).map(
          function (c) {
            return c.lotId;
          },
        );
      }
      appendRow_("STOCK_MOVEMENT", {
        "Movement ID": generateId_("STOCK_MOVEMENT"),
        Date: new Date(),
        "Product ID": productId,
        "Product Name": name,
        Type: "Adjustment",
        Reference: "MANUAL",
        "Quantity In": delta > 0 ? delta : "",
        "Quantity Out": delta < 0 ? Math.abs(delta) : "",
        "Balance Stock": newStock,
        Notes: "Stock corrected via product edit",
        "Lot ID": lotIdsTouched.join(", "),
      });
    }

    return ok_({ id: productId });
  } catch (err) {
    logError_("updateProduct", err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Manual stock correction (damage, recount, etc). Always logs a Stock
 * Movement row — never silently edits the number. Positive deltas open a
 * new lot at the product's current Purchase Price; negative deltas draw
 * FIFO from existing lots via consumeStockFIFO_. Treated as an 'edit'
 * permission, not a separate action.
 *
 * supplierId is optional and only meaningful on a positive delta: pass an
 * already-linked supplier to attribute the added stock to them (so it's
 * sellable through them in POS); omit it for a genuinely unattributed
 * correction, which still counts toward Current Stock but isn't scoped to
 * any supplier until adjusted again with one. Negative deltas always draw
 * FIFO across all suppliers — removing stock for a recount/damage doesn't
 * need attribution the way selling it does.
 */
function adjustStock(token, productId, deltaQty, note) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    requirePermission_(token, "products", "edit");
    requireActiveCashSession_();
    const rowIndex = findRowIndex_("PRODUCTS", "Product ID", productId);
    if (rowIndex === -1) return fail_("Product not found.");
    const delta = Number(deltaQty);
    if (isNaN(delta) || delta === 0)
      return fail_(
        "Enter a non-zero adjustment amount (positive to add, negative to remove).",
      );

    const product = getAllRows_("PRODUCTS").filter(function (p) {
      return p["Product ID"] === productId;
    })[0];
    if (bundleProductType_(product) === 'Bundle') throw new Error('Bundle stock cannot be adjusted.');
    const newStock = (Number(product["Current Stock"]) || 0) + delta;
    if (delta > 0 && (Number(product["Purchase Price"]) || 0) <= 0)
      return fail_("Set this product's Purchase Price before adding stock.");
    // Only a negative adjustment (removing stock) is floored at zero — a
    // positive one (adding stock) can only move Current Stock toward
    // positive and must never be blocked, even if it's still negative
    // afterward (POS deliberately allows selling past zero — see
    // completeSale in Sales.gs).
    if (delta < 0 && newStock < 0)
      return fail_(
        "That would take stock below zero. Current stock is " +
          product["Current Stock"] +
          ".",
      );

    let lotIdsTouched;
    if (delta > 0) {
      const lotId = addAdjustmentLot_(productId, product["Product Name"], delta);
      lotIdsTouched = [lotId];
    } else {
      lotIdsTouched = consumeStockFIFO_(productId, Math.abs(delta)).map(
        function (c) {
          return c.lotId;
        },
      );
    }

    updateRowFields_("PRODUCTS", rowIndex, {
      "Current Stock": newStock,
      "Updated At": new Date(),
    });

    appendRow_("STOCK_MOVEMENT", {
      "Movement ID": generateId_("STOCK_MOVEMENT"),
      Date: new Date(),
      "Product ID": productId,
      "Product Name": product["Product Name"],
      Type: "Adjustment",
      Reference: "MANUAL",
      "Quantity In": delta > 0 ? delta : "",
      "Quantity Out": delta < 0 ? Math.abs(delta) : "",
      "Balance Stock": newStock,
      Notes: sanitizeInput_(note),
      "Lot ID": lotIdsTouched.join(", "),
    });

    return ok_({ newStock: newStock });
  } catch (err) {
    logError_("adjustStock", err);
    return fail_(err.message);
  } finally {
    lock.releaseLock();
  }
}

function setProductStatus(token, productId, status) {
  try {
    requirePermission_(token, "products", "edit");
    const rowIndex = findRowIndex_("PRODUCTS", "Product ID", productId);
    if (rowIndex === -1) return fail_("Product not found.");
    updateRowFields_("PRODUCTS", rowIndex, {
      Status: status === "Active" ? "Active" : "Inactive",
      "Updated At": new Date(),
    });
    return ok_({ id: productId, status: status });
  } catch (err) {
    logError_("setProductStatus", err);
    return fail_(err.message);
  }
}
