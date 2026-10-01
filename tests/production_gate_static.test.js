const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = process.cwd();
const gsFiles = fs.readdirSync(ROOT).filter(f => f.endsWith('.gs')).sort();
const htmlFiles = fs.readdirSync(ROOT).filter(f => f.endsWith('.html')).sort();
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}
function topLevelFunctions() {
  const out = new Map();
  for (const f of gsFiles) {
    const text = read(f); let m;
    const re = /^function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
    while ((m = re.exec(text))) {
      if (!out.has(m[1])) out.set(m[1], []);
      out.get(m[1]).push(f);
    }
  }
  return out;
}
function functionBlock(file, name) {
  const text = read(file);
  const start = text.search(new RegExp('^function\\s+' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\(', 'm'));
  assert.ok(start >= 0, `${file}: missing ${name}`);
  const rest = text.slice(start);
  const next = rest.slice(1).search(/^function\s+[A-Za-z_$][\w$]*\s*\(/m);
  return next < 0 ? rest : rest.slice(0, next + 1);
}
function test(name, fn) {
  try { fn(); console.log('PASS', name); }
  catch (e) { console.error('FAIL', name, '\n' + e.stack); process.exitCode = 1; }
}

const funcs = topLevelFunctions();

test('all Apps Script sources parse', () => {
  for (const f of gsFiles) new Function(read(f));
  assert.ok(gsFiles.length >= 40, `unexpected .gs inventory: ${gsFiles.length}`);
});

test('all inline HTML scripts parse', () => {
  let scripts = 0;
  for (const f of htmlFiles) {
    const text = read(f); let m; const re = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi;
    while ((m = re.exec(text))) {
      const body = m[1].replace(/<\?[\s\S]*?\?>/g, '');
      if (body.trim()) { new Function(body); scripts++; }
    }
  }
  assert.ok(scripts >= 25, `unexpected script inventory: ${scripts}`);
});

test('top-level server functions are globally unique', () => {
  const duplicates = [...funcs].filter(([, files]) => files.length > 1);
  assert.deepStrictEqual(duplicates, []);
  assert.ok(funcs.size >= 400, `unexpected server function inventory: ${funcs.size}`);
});

test('every literal client RPC resolves to a server function', () => {
  const missing = new Set(); let rpcCalls = 0;
  for (const f of htmlFiles) {
    const text = stripComments(read(f)); let m;
    const re = /\bserverCall\(\s*['"]([A-Za-z_$][\w$]*)['"]/g;
    while ((m = re.exec(text))) { rpcCalls++; if (!funcs.has(m[1])) missing.add(m[1]); }
  }
  assert.deepStrictEqual([...missing], []);
  assert.ok(rpcCalls >= 120, `unexpected RPC inventory: ${rpcCalls}`);
});

test('no executable Session.getActiveUser identity dependency remains', () => {
  const offenders = [];
  for (const f of gsFiles) if (/Session\.getActiveUser\s*\(/.test(stripComments(read(f)))) offenders.push(f);
  assert.deepStrictEqual(offenders, []);
});

test('no merge conflict markers remain in production sources', () => {
  for (const f of [...gsFiles, ...htmlFiles]) assert.doesNotMatch(read(f), /^(?:<<<<<<<|=======|>>>>>>>)/m, f);
});

test('CONFIG sheet/header/id-prefix schema is internally consistent', () => {
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(read('Config.gs') + '\nthis.__CONFIG = CONFIG;', ctx, {filename:'Config.gs'});
  const c = ctx.__CONFIG;
  const sheetKeys = Object.keys(c.SHEETS || {});
  const headerKeys = Object.keys(c.HEADERS || {});
  assert.ok(sheetKeys.length >= 40, `unexpected sheet inventory ${sheetKeys.length}`);
  assert.deepStrictEqual(headerKeys.filter(k => !sheetKeys.includes(k)), [], 'headers without configured sheet');
  assert.deepStrictEqual(sheetKeys.filter(k => !headerKeys.includes(k)), [], 'configured sheets without headers');
  assert.equal(new Set(Object.values(c.SHEETS)).size, sheetKeys.length, 'duplicate physical sheet names');
  for (const [k, hs] of Object.entries(c.HEADERS)) {
    assert.ok(Array.isArray(hs) && hs.length, `${k}: empty headers`);
    assert.equal(new Set(hs).size, hs.length, `${k}: duplicate headers`);
  }
  for (const k of Object.keys(c.ID_PREFIX || {})) {
    assert.ok(c.SHEETS[k], `${k}: ID prefix lacks sheet`);
    assert.ok(c.HEADERS[k] && c.HEADERS[k].length, `${k}: ID prefix lacks headers`);
  }
});

test('literal repository sheet keys all exist in CONFIG', () => {
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(read('Config.gs') + '\nthis.__CONFIG = CONFIG;', ctx);
  const keys = new Set(Object.keys(ctx.__CONFIG.SHEETS));
  const missing = new Set();
  const calls = /\b(?:getAllRows_|activeRows_|getSheet_|appendRow_|findRowIndex_|findRows_|findFirstRow_|updateRow_|deleteRow_|softDeleteRow_)\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g;
  for (const f of gsFiles) { let m; const text = stripComments(read(f)); while ((m = calls.exec(text))) if (!keys.has(m[1])) missing.add(`${f}:${m[1]}`); }
  assert.deepStrictEqual([...missing], []);
});

test('literal DOM references resolve or are documented optional compatibility hooks', () => {
  const ids = new Set();
  for (const f of htmlFiles) {
    const t = read(f); let m;
    for (const re of [/\bid\s*=\s*["']([^"']+)["']/g, /\.id\s*=\s*["']([^"']+)["']/g, /setAttribute\(\s*["']id["']\s*,\s*["']([^"']+)["']/g]) while ((m = re.exec(t))) ids.add(m[1]);
  }
  const optional = new Set(['dbMethod','dbShowDeleted','posManageVendorsBtn']);
  const missing = [];
  let refs = 0;
  for (const f of htmlFiles) {
    const t = read(f); let m; const re = /getElementById\(\s*["']([^"']+)["']\s*\)/g;
    while ((m = re.exec(t))) { refs++; if (!ids.has(m[1]) && !optional.has(m[1])) missing.push(`${f}:${m[1]}`); }
  }
  assert.deepStrictEqual(missing, []);
  assert.ok(refs >= 1000, `unexpected DOM reference inventory: ${refs}`);
});

test('critical financial writes lock and authorize before first repository mutation', () => {
  const cases = [
    ['Sales.gs','completeSale','pos'],
    ['Purchase.gs','createPurchase','purchase'],
    ['SalesReturn.gs','completeReturn','returns','commitPreparedSalesReturn_'],
    ['SalesReturn.gs','completeReturnBatch','returns','commitPreparedSalesReturn_'],
    ['PurchaseReturn.gs','completePurchaseReturn','purchase'],
    ['Customer.gs','receivePayment','customers'],
    ['Suppliers.gs','paySupplier','suppliers'],
    ['Expense.gs','addExpense','expense'],
    ['FinanceModule.gs','addFinanceTransaction','finance'],
    ['BankBook.gs','transferBetweenBankAccounts','bank'],
    ['BankLedger.gs','addBankManualEntry','bank'],
    ['BankLedger.gs','reverseBankEntry','bank'],
    ['Products.gs','adjustStock','products']
  ];
  const mutationRe = /\b(?:appendRow_|appendRows_|updateRow_|updateRowFields_|deleteRow_|softDeleteRow_|addBankBookEntry_|addCashBookEntry_)\s*\(/;
  for (const [file, name, module, delegate] of cases) {
    const block = functionBlock(file, name);
    const firstWrite = block.search(mutationRe);
    const delegateIndex = delegate ? block.indexOf(delegate + '(') : -1;
    const boundary = firstWrite > 0 ? firstWrite : delegateIndex;
    assert.ok(boundary > 0, `${name}: no repository write or approved write delegate found`);
    if (delegate) {
      const delegateBlock = functionBlock(file, delegate);
      assert.match(delegateBlock, mutationRe, `${delegate}: delegated path must contain the repository writes`);
    }
    const lock = block.indexOf('LockService.getScriptLock');
    const permission = block.indexOf('requirePermission_');
    const cash = block.indexOf('requireActiveCashSession_');
    assert.ok(lock >= 0 && lock < boundary, `${name}: lock must precede first write/delegate`);
    assert.ok(permission >= 0 && permission < boundary, `${name}: permission must precede first write/delegate`);
    assert.ok(block.slice(permission, Math.min(boundary, permission + 220)).includes(`'${module}'`) || block.slice(permission, Math.min(boundary, permission + 220)).includes(`"${module}"`), `${name}: expected ${module} permission`);
    assert.ok(cash >= 0 && cash < boundary, `${name}: cash-session guard must precede first write/delegate`);
  }
});

test('invoice integrity guards cover view history reporting and returns', () => {
  assert.match(read('Utils.gs'), /function\s+findUniqueSalesRow_/);
  assert.match(read('Utils.gs'), /function\s+duplicateSalesInvoiceIdMap_/);
  assert.match(read('Utils.gs'), /function\s+assertUniqueSalesInvoiceIds_/);
  assert.match(read('Invoice.gs'), /duplicateInvoiceId\s*:/);
  assert.match(read('SalesManagement.gs'), /Integrity Error/);
  assert.match(read('Reports.gs'), /assertUniqueSalesInvoiceIds_\(sales[\s\S]*?allSales/);
  assert.match(read('SalesReturn.gs'), /duplicateInvoiceId\s*:/);
});

if (!process.exitCode) {
  console.log(`production_gate_static: PASS (${gsFiles.length} GS files, ${htmlFiles.length} HTML files, ${funcs.size} server functions)`);
}