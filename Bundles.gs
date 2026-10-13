/**
 * Virtual sales kits. Bundle stock is derived from physical component stock;
 * bundles never have their own STOCK_LOTS or CURRENT STOCK mutations.
 */
function bundleProductType_(row) {
  return String(row && row['Product Type'] || '').trim() === 'Bundle' ? 'Bundle' : 'Standard';
}
function bundleProductMap_(rows) {
  const out = {};
  (rows || []).forEach(function (row) { out[row['Product ID']] = row; });
  return out;
}
function validateBundleDefinition_(bundleId, components, productsById) {
  if (!Array.isArray(components) || !components.length) throw new Error('Bundle needs at least one component.');
  const seen = {};
  return components.map(function (component) {
    const id = String(component && (component.productId || component['Component Product ID']) || '').trim();
    const qty = Number(component && (component.qtyPerSet === undefined ? component['Quantity Per Set'] : component.qtyPerSet));
    const product = productsById[id];
    if (!id || !product) throw new Error('Bundle component product was not found.');
    if (id === String(bundleId) || bundleProductType_(product) !== 'Standard') {
      throw new Error('A bundle can contain only a standard product.');
    }
    if (String(product.Status || '').toLowerCase() !== 'active' ||
        String(product['Is Deleted'] || '').toUpperCase() === 'TRUE') {
      throw new Error('Bundle component must be active: ' + id);
    }
    if (!Number.isFinite(qty) || qty <= 0) throw new Error('Bundle component quantity must be finite and greater than zero.');
    if (qty > 1000000000) throw new Error('Bundle component quantity exceeds maximum allowed.');
    if (seen[id]) throw new Error('A component appears more than once; combine quantities.');
    seen[id] = true;
    return {productId: id, qtyPerSet: qty, unit: String(product.Unit || component.unit || 'pcs')};
  });
}
function getBundleDefinitions_(bundleIds, productsById, componentRows) {
  const required = {}, definitions = {};
  (bundleIds || []).forEach(function (id) { required[String(id)] = true; });
  (componentRows || []).forEach(function (row) {
    const id = String(row['Bundle Product ID'] || '');
    const product = productsById[id];
    if (!required[id] || !product || bundleProductType_(product) !== 'Bundle') return;
    const revision = Number(product['Bundle Revision']) || 1;
    if (Number(row.Revision) !== revision || String(row.Status || '').toLowerCase() !== 'active') return;
    if (!definitions[id]) definitions[id] = {bundleId: id, revision: revision, components: []};
    definitions[id].components.push({
      productId: String(row['Component Product ID'] || ''),
      qtyPerSet: Number(row['Quantity Per Set']), unit: String(row.Unit || '')
    });
  });
  Object.keys(required).forEach(function (id) {
    if (!productsById[id] || bundleProductType_(productsById[id]) !== 'Bundle') throw new Error('Bundle product not found: ' + id);
    if (!definitions[id] || !definitions[id].components.length) throw new Error('Bundle recipe unavailable: ' + id);
    definitions[id].components = validateBundleDefinition_(id, definitions[id].components, productsById);
  });
  return definitions;
}
function getBundleAvailability_(definition, productsById) {
  if (!definition || !definition.components || !definition.components.length) return 0;
  return Math.max(0, Math.min.apply(null, definition.components.map(function (c) {
    const stock = Number(productsById[c.productId] && productsById[c.productId]['Current Stock']) || 0;
    return Math.floor(Math.max(0, stock) / c.qtyPerSet);
  })));
}
function getSaleBundleSnapshot_(invoiceId, snapshotRows) {
  const definitions = {};
  (snapshotRows || []).forEach(function (row) {
    if (String(row['Invoice ID']) !== String(invoiceId)) return;
    const id = String(row['Bundle Product ID'] || '');
    if (!id) throw new Error('Historical bundle component is missing a bundle ID.');
    if (!definitions[id]) definitions[id] = {
      bundleId: id, revision: Number(row['Bundle Revision']),
      setsSold: Number(row['Sets Sold']), components: []
    };
    const definition = definitions[id];
    if (definition.revision !== Number(row['Bundle Revision']) || definition.setsSold !== Number(row['Sets Sold'])) {
      throw new Error('Inconsistent historical bundle snapshot.');
    }
    const qty = Number(row['Quantity Per Set']);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error('Invalid historical bundle quantity.');
    definition.components.push({productId: String(row['Component Product ID'] || ''), qtyPerSet: qty, unit: String(row.Unit || '')});
  });
  return definitions;
}
function buildSaleStockDemands_(displayLines, definitions, historicalSnapshots) {
  const requirementsByProductId = {}, ownersByProductId = {};
  function add(source, physical, qty) {
    if (!Number.isFinite(qty) || qty <= 0) throw new Error('Invalid physical stock demand.');
    requirementsByProductId[physical] = (requirementsByProductId[physical] || 0) + qty;
    if (!Number.isFinite(requirementsByProductId[physical])) throw new Error('Stock demand exceeds supported amount.');
    if (!ownersByProductId[physical]) ownersByProductId[physical] = [];
    ownersByProductId[physical].push({sourceSaleProductId: source, physicalProductId: physical, qty: qty});
  }
  (displayLines || []).forEach(function (line) {
    const id = String(line.productId || '');
    const qty = Number(line.qty);
    if (!id || !Number.isFinite(qty) || qty <= 0) throw new Error('Invalid sale item quantity.');
    if (line.productType === 'Bundle') {
      if (!Number.isSafeInteger(qty)) throw new Error('Bundle must be sold in whole sets.');
      const recipe = historicalSnapshots && historicalSnapshots[id] || definitions && definitions[id];
      if (!recipe || !recipe.components || !recipe.components.length) throw new Error('Missing bundle definition: ' + id);
      recipe.components.forEach(function (component) { add(id, component.productId, qty * component.qtyPerSet); });
    } else {
      add(id, id, qty);
    }
  });
  return {requirementsByProductId: requirementsByProductId, ownersByProductId: ownersByProductId};
}
/**
 * Splits previously planned FIFO draws into parent-owned lines without
 * planning the same physical lot twice. A shortfall is an OVERSOLD allocation.
 */
function attributeBundleConsumption_(owners, consumed) {
  const allocations = [];
  const reservations = (owners || []).map(function (owner) {
    return {sourceSaleProductId: owner.sourceSaleProductId, physicalProductId: owner.physicalProductId, need: Number(owner.qty)};
  });
  (consumed || []).forEach(function (draw) {
    let available = Number(draw.qty);
    reservations.forEach(function (owner) {
      if (available <= 0 || owner.need <= 0) return;
      const quantity = Math.min(available, owner.need);
      allocations.push({
        sourceSaleProductId: owner.sourceSaleProductId, productId: owner.physicalProductId,
        lotId: draw.lotId, qty: quantity, unitCost: draw.unitCost, unitSellPrice: draw.unitSellPrice
      });
      owner.need -= quantity;
      available -= quantity;
    });
    if (available > 0.0000001) throw new Error('Unowned FIFO consumption would cause stock drift.');
  });
  if (reservations.some(function (o) { return o.need > 0.0000001; })) {
    throw new Error('Component FIFO consumption did not cover all allocated sales.');
  }
  return allocations;
}
function bundleRecipeRows_(bundleId, revision, components, time) {
  return components.map(function (component) {
    return {'Bundle Product ID': bundleId, 'Component Product ID': component.productId,
      'Quantity Per Set': component.qtyPerSet, Unit: component.unit,
      Revision: revision, Status: 'Active', 'Updated At': time};
  });
}
function addBundleProduct(token, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    requirePermission_(token, 'products', 'add');
    payload = payload || {};
    const name = sanitizeInput_(payload.name), price = Number(payload.sellingPrice);
    if (!name) throw new Error('Bundle name is required.');
    if (!isValidNonNegativeNumber_(payload.sellingPrice)) throw new Error('Bundle selling price must be valid.');
    const products = activeRows_('PRODUCTS');
    if (products.some(function (p) { return String(p['Product Name']).toLowerCase() === name.toLowerCase(); })) {
      throw new Error('A product with this name already exists.');
    }
    const id = generateId_('PRODUCTS'), now = new Date();
    const components = validateBundleDefinition_(id, payload.components, bundleProductMap_(products));
    appendRow_('PRODUCTS', {
      'Product ID': id, 'Product Name': name, Brand: sanitizeInput_(payload.brand),
      Category: sanitizeInput_(payload.category) || 'Uncategorized', Unit: 'set',
      Barcode: sanitizeInput_(payload.barcode), 'Purchase Price': 0, 'Selling Price': price,
      'Current Stock': 0, 'Minimum Stock': 0, 'Product Type': 'Bundle', 'Bundle Revision': 1,
      Status: 'Active', 'Created At': now, 'Updated At': now
    });
    appendRows_('BUNDLE_COMPONENTS', bundleRecipeRows_(id, 1, components, now));
    return ok_({id: id});
  } catch(err) {
    logError_('addBundleProduct', err);
    return fail_(err.message);
  } finally {lock.releaseLock();}
}
function updateBundleProduct(token, bundleId, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  try {
    requirePermission_(token, 'products', 'edit');
    payload = payload || {};
    const products = getAllRows_('PRODUCTS');
    const p = products.filter(function (row) {return row['Product ID'] === bundleId;})[0];
    if (!p || bundleProductType_(p) !== 'Bundle' || String(p['Is Deleted'] || '').toUpperCase() === 'TRUE') throw new Error('Bundle not found.');
    const name = sanitizeInput_(payload.name);
    if (!name || !isValidNonNegativeNumber_(payload.sellingPrice)) throw new Error('Enter a valid bundle name and selling price.');
    if (products.some(function (row) {return row['Product ID'] !== bundleId && String(row['Product Name']).toLowerCase() === name.toLowerCase() && !isDeleted_(row);})) {
      throw new Error('A product with this name already exists.');
    }
    const components = validateBundleDefinition_(bundleId, payload.components, bundleProductMap_(products));
    const before = getBundleDefinitions_([bundleId], bundleProductMap_(products), getAllRows_('BUNDLE_COMPONENTS'))[bundleId];
    const signature = values => JSON.stringify(values.map(function (c) {return [c.productId, c.qtyPerSet, c.unit];}).sort(function (a,b) {return a[0].localeCompare(b[0]);}));
    const changed = signature(before.components) !== signature(components);
    const revision = (Number(p['Bundle Revision']) || 1) + (changed ? 1 : 0);
    const now = new Date();
    updateRowFields_('PRODUCTS', p._rowIndex, {
      'Product Name': name, Brand: sanitizeInput_(payload.brand),
      Category: sanitizeInput_(payload.category) || 'Uncategorized',
      Barcode: sanitizeInput_(payload.barcode),
      'Selling Price': Number(payload.sellingPrice), 'Updated At': now,
      'Bundle Revision': revision
    });
    if (changed) appendRows_('BUNDLE_COMPONENTS', bundleRecipeRows_(bundleId, revision, components, now));
    return ok_({id: bundleId, revision: revision});
  } catch(err) {
    logError_('updateBundleProduct', err);
    return fail_(err.message);
  } finally {lock.releaseLock();}
}
