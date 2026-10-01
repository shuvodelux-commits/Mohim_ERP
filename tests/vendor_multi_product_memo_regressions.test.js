'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

function fnSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `missing function ${name}`);
  const brace = source.indexOf('{', start);
  let depth = 0, quote = null, escape = false, lineComment = false, blockComment = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i], next = source[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated function ${name}`);
}

function loadFunction(file, name, sandbox) {
  const context = vm.createContext(sandbox);
  vm.runInContext(`${fnSource(read(file), name)}\nthis.__fn = ${name};`, context);
  return { fn: context.__fn, context };
}

function makeLock() { return { waitLock() {}, releaseLock() {} }; }
function ok(data) { return Object.assign({ success: true }, data || {}); }
function fail(message) { return { success: false, message }; }

function test(name, fn) {
  try { fn(); console.log('PASS ' + name); }
  catch (err) { console.error('FAIL ' + name); console.error(err.stack); process.exitCode = 1; }
}

test('multi-product vendor memo validates every FIFO plan before the first write', () => {
  const writes = [];
  const products = [
    { 'Product ID': 'P1', 'Product Name': 'One', 'Current Stock': 5, 'Purchase Price': 10 },
    { 'Product ID': 'P2', 'Product Name': 'Two', 'Current Stock': 5, 'Purchase Price': 20 }
  ];
  const plans = {
    P1: { productId: 'P1', draws: [{ take: 1 }], shortfall: 0 },
    P2: { productId: 'P2', draws: [], shortfall: 1 }
  };
  let id = 0;
  const { fn } = loadFunction('Vendors.gs', 'giveProductsToVendor', {
    LockService: { getScriptLock: makeLock },
    CONFIG: { LOCK_TIMEOUT_MS: 1000 },
    requirePermission_: () => ({ name: 'Admin' }),
    requireActiveCashSession_: () => ({}),
    getAllRows_: (key) => key === 'VENDORS'
      ? [{ 'Vendor ID': 'V1', 'Vendor Name': 'Vendor', 'Status': 'Active' }]
      : key === 'PRODUCTS' ? products : [],
    isDeleted_: () => false,
    isValidNonNegativeNumber_: (n) => Number.isFinite(Number(n)) && Number(n) >= 0,
    resolveTransactionDate_: () => ({ dateStr: '2026-09-20', isBackdated: false, backdatedDays: 0, reason: '' }),
    generateId_: () => 'ID-' + (++id),
    sanitizeInput_: (v) => String(v == null ? '' : v).trim(),
    actorName_: () => 'Admin',
    planStockConsumption_: (productId) => plans[productId],
    applyStockConsumption_: (plan) => { writes.push('apply:' + plan.productId); return []; },
    adjustProductStock_: (productId) => { writes.push('stock:' + productId); return 4; },
    appendRow_: (sheet) => { writes.push('append:' + sheet); },
    postVendorLedgerEntry_: () => { writes.push('ledger'); return 'L1'; },
    ok_: ok,
    fail_: fail,
    logError_: () => {}
  });

  const result = fn('token', {
    vendorId: 'V1',
    items: [
      { productId: 'P1', quantity: 1, unitValue: 10 },
      { productId: 'P2', quantity: 1, unitValue: 20 }
    ]
  });

  assert.strictEqual(result.success, false, 'memo should be rejected when any product lacks physical FIFO lots');
  assert.match(result.message, /stock lots|physical stock|enough stock/i);
  assert.deepStrictEqual(writes, [], 'no stock/accounting writes may occur before all memo lines validate');
});


test('successful multi-product save keeps one memo id while preserving per-line issue ids', () => {
  const issueRows = [], ledgerCalls = [], stockPlansApplied = [];
  const products = [
    { 'Product ID': 'P1', 'Product Name': 'One', 'Current Stock': 5, 'Purchase Price': 10 },
    { 'Product ID': 'P2', 'Product Name': 'Two', 'Current Stock': 7, 'Purchase Price': 20 }
  ];
  let issueSeq = 0, otherSeq = 0;
  const { fn } = loadFunction('Vendors.gs', 'giveProductsToVendor', {
    LockService: { getScriptLock: makeLock }, CONFIG: { LOCK_TIMEOUT_MS: 1000 },
    requirePermission_: () => ({ name: 'Admin' }), requireActiveCashSession_: () => ({}),
    getAllRows_: (key) => key === 'VENDORS' ? [{ 'Vendor ID': 'V1', 'Vendor Name': 'Vendor', 'Status': 'Active' }] : key === 'PRODUCTS' ? products : [],
    isDeleted_: () => false, isValidNonNegativeNumber_: (n) => Number.isFinite(Number(n)) && Number(n) >= 0,
    resolveTransactionDate_: () => ({ dateStr: '2026-09-20', isBackdated: false, backdatedDays: 0, reason: '' }),
    generateId_: (key) => key === 'VENDOR_ISSUES' ? `VIS-${String(++issueSeq).padStart(6,'0')}` : `X-${++otherSeq}`,
    sanitizeInput_: (v) => String(v == null ? '' : v).trim(), actorName_: () => 'Admin',
    planStockConsumption_: (productId, qty) => ({ productId, draws: [{ lotId: 'LOT-'+productId, qty, take: qty }], shortfall: 0 }),
    applyStockConsumption_: (plan) => { stockPlansApplied.push(plan.productId); return [{ lotId: 'LOT-'+plan.productId, qty: plan.draws[0].take }]; },
    adjustProductStock_: (productId, delta) => products.find(p => p['Product ID'] === productId)['Current Stock'] + delta,
    appendRow_: (sheet, row) => { if (sheet === 'VENDOR_ISSUES') issueRows.push(row); },
    postVendorLedgerEntry_: (fields) => { ledgerCalls.push(fields); return 'LED-'+ledgerCalls.length; },
    ok_: ok, fail_: fail, logError_: () => {}
  });
  const result = fn('token', { vendorId: 'V1', notes: 'memo', items: [
    { productId: 'P1', quantity: 2, unitValue: 11 }, { productId: 'P2', quantity: 3, unitValue: 22 }
  ]});
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.memoId, 'VIS-000001');
  assert.deepStrictEqual(Array.from(result.issueIds), ['VIS-000001','VIS-000002']);
  assert.strictEqual(issueRows.length, 2);
  assert.deepStrictEqual(issueRows.map(r => r['Memo ID']), ['VIS-000001','VIS-000001']);
  assert.deepStrictEqual(issueRows.map(r => r['Issue ID']), ['VIS-000001','VIS-000002']);
  assert.deepStrictEqual(issueRows.map(r => r['Unit Value']), [11,22]);
  assert.deepStrictEqual(stockPlansApplied, ['P1','P2']);
  assert.strictEqual(ledgerCalls.length, 2);
  ledgerCalls.forEach(c => assert.match(c.notes, /Memo VIS-000001/));
});

test('memo edit validates every line before calling the per-line write engine', () => {
  const updateCalls = [];
  const rows = [
    { 'Issue ID':'I1','Memo ID':'M1','Vendor ID':'V1','Product ID':'P1','Product Name':'One','Quantity':2,'Unit Value':10,'Date':'2026-09-20' },
    { 'Issue ID':'I2','Memo ID':'M1','Vendor ID':'V1','Product ID':'P2','Product Name':'Two','Quantity':2,'Unit Value':20,'Date':'2026-09-20' }
  ];
  const products = [
    { 'Product ID':'P1','Product Name':'One','Current Stock':10 },
    { 'Product ID':'P2','Product Name':'Two','Current Stock':10 }
  ];
  const { fn } = loadFunction('DeleteEngine.gs', 'updateVendorIssueMemo', {
    LockService: { getScriptLock: makeLock }, CONFIG:{LOCK_TIMEOUT_MS:1000},
    requirePermission_:()=>({}), requireActiveCashSession_:()=>({}),
    activeRows_:(key)=> key==='VENDOR_ISSUES'?rows : key==='VENDOR_RETURNS_RECEIVED'?[]:[],
    getAllRows_:(key)=> key==='PRODUCTS'?products:[], isDeleted_:()=>false,
    isValidNonNegativeNumber_:(n)=>Number.isFinite(Number(n))&&Number(n)>=0,
    planStockConsumption_:(productId)=>({productId,shortfall:productId==='P2'?1:0}),
    resolveEditedTransactionDate_:()=> '2026-09-20', sanitizeInput_:(v)=>String(v||'').trim(),
    updateVendorIssueInternal_:(...args)=>{ updateCalls.push(args); return ok({}); },
    ok_:ok, fail_:fail, logError_:()=>{}
  });
  const result = fn('token','M1',{date:'2026-09-20',items:[
    {issueId:'I1',quantity:3,unitValue:10},{issueId:'I2',quantity:3,unitValue:20}
  ]});
  assert.strictEqual(result.success,false);
  assert.match(result.message,/stock lots|physical stock/i);
  assert.deepStrictEqual(updateCalls,[]);
});

test('memo delete blocks before writes when any line has an active return received', () => {
  const writes=[];
  const rows=[
    { 'Issue ID':'I1','Memo ID':'M1','Date':'2026-09-20' },
    { 'Issue ID':'I2','Memo ID':'M1','Date':'2026-09-20' }
  ];
  const { fn } = loadFunction('DeleteEngine.gs','deleteVendorIssueMemo',{
    LockService:{getScriptLock:makeLock},CONFIG:{LOCK_TIMEOUT_MS:1000},sanitizeInput_:(v)=>String(v||'').trim(),
    activeRows_:(key)=>key==='VENDOR_ISSUES'?rows:key==='VENDOR_RETURNS_RECEIVED'?[{'Issue ID':'I2'}]:[],
    requireDeletePermission_:()=>({}),requireActiveCashSession_:()=>({}),
    reverseVendorIssueStockAndReceivable_:()=>writes.push('reverse'),markRowDeleted_:()=>writes.push('mark'),
    markMatchingDeleted_:()=>writes.push('ledger'),logDeletion_:()=>writes.push('log'),ok_:ok,fail_:fail,logError_:()=>{}
  });
  const result=fn('token','M1','reason');
  assert.strictEqual(result.success,false);
  assert.match(result.message,/received back|Return Received/i);
  assert.deepStrictEqual(writes,[]);
});

test('memo delete reverses and soft-deletes every product line together', () => {
  const events=[];
  const rows=[
    { 'Issue ID':'I1','Memo ID':'M1','Date':'2026-09-20','_rowIndex':2 },
    { 'Issue ID':'I2','Memo ID':'M1','Date':'2026-09-20','_rowIndex':3 }
  ];
  const { fn } = loadFunction('DeleteEngine.gs','deleteVendorIssueMemo',{
    LockService:{getScriptLock:makeLock},CONFIG:{LOCK_TIMEOUT_MS:1000},sanitizeInput_:(v)=>String(v||'').trim(),
    activeRows_:(key)=>key==='VENDOR_ISSUES'?rows:key==='VENDOR_RETURNS_RECEIVED'?[]:[],
    requireDeletePermission_:()=>({name:'Admin'}),requireActiveCashSession_:()=>({}),
    reverseVendorIssueStockAndReceivable_:(row)=>events.push('reverse:'+row['Issue ID']),
    markRowDeleted_:(sheet,idx)=>events.push('mark:'+idx),
    markMatchingDeleted_:(sheet,predicate)=>{ rows.forEach(r=>{ if(predicate({'Reference':r['Issue ID'],'Type':'Issue'})) events.push('ledger:'+r['Issue ID']); }); },
    logDeletion_:(module,id)=>events.push('log:'+id),ok_:ok,fail_:fail,logError_:()=>{}
  });
  const result=fn('token','M1','reason');
  assert.strictEqual(result.success,true);
  assert.strictEqual(result.deletedLines,2);
  assert(events.includes('reverse:I1')&&events.includes('reverse:I2'));
  assert(events.includes('mark:2')&&events.includes('mark:3'));
  assert(events.includes('log:I1')&&events.includes('log:I2'));
});

test('vendor master update changes name phone and address only on the vendor row', () => {
  const updates=[];
  const vendor={ 'Vendor ID':'V1','Vendor Name':'Old','Phone':'1','Address':'A','_rowIndex':2 };
  const { fn }=loadFunction('Vendors.gs','updateVendor',{
    LockService:{getScriptLock:makeLock},CONFIG:{LOCK_TIMEOUT_MS:1000},requirePermission_:()=>({}),
    findVendor_:()=>vendor,isDeleted_:()=>false,sanitizeInput_:(v)=>String(v==null?'':v).trim(),
    activeRows_:()=>[vendor],findRowIndex_:()=>2,updateRowFields_:(sheet,rowIndex,fields)=>updates.push({sheet,rowIndex,fields}),
    ok_:ok,fail_:fail,logError_:()=>{}
  });
  const result=fn('token','V1',{name:'New',phone:'01700',address:'Dhaka'});
  assert.strictEqual(result.success,true);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(updates)),[{sheet:'VENDORS',rowIndex:2,fields:{'Vendor Name':'New','Phone':'01700','Address':'Dhaka'}}]);
});

test('vendor workspace UI auto-fills purchase price and keeps added qty/unit value editable', () => {
  const ui=read('vendors.html'), workspace=read('vendorWorkspace.html'), server=read('Vendors.gs');
  assert.match(server,/purchasePrice:\s*Number\(p\['Purchase Price'\]\)/);
  assert.match(ui,/function vlPopulateGiveUnitValue_[\s\S]*product\.purchasePrice/);
  assert.match(ui,/data-vl-give-field="quantity"/);
  assert.match(ui,/data-vl-give-field="unitValue"/);
  assert.match(ui,/items:\s*vlState\.giveItems\.map/);
  assert.match(workspace,/id="vlGiveItemsBody"/);
  assert.match(workspace,/Memo Total/);
});

test('vendor edit UI is available from list and workspace with name phone address', () => {
  const ui=read('vendors.html'), workspace=read('vendorWorkspace.html');
  assert.match(ui,/id="vlName"/); assert.match(ui,/id="vlPhone"/); assert.match(ui,/id="vlAddress"/);
  assert.match(ui,/serverCall\('updateVendor',\s*authToken/);
  assert.match(ui,/action:\s*'editVendor'/);
  assert.match(ui,/vlWorkspaceEditVendorBtn/);
  assert.match(workspace,/id="vlWorkspaceEditVendorBtn"/);
});


test('stateful create edit delete cycle preserves vendor stock and receivable invariants', () => {
  const sheets = {
    VENDORS: [{ 'Vendor ID':'V1','Vendor Name':'Vendor','Phone':'','Address':'','Current Due':0,'Current Receivable':0,'Status':'Active','_rowIndex':2 }],
    PRODUCTS: [
      { 'Product ID':'P1','Product Name':'One','Current Stock':10,'Purchase Price':4,'_rowIndex':2 },
      { 'Product ID':'P2','Product Name':'Two','Current Stock':10,'Purchase Price':6,'_rowIndex':3 }
    ],
    VENDOR_ISSUES: [], VENDOR_LEDGER: [], VENDOR_RETURNS_RECEIVED: [], STOCK_MOVEMENT: []
  };
  const counters = {};
  const prefixes = { VENDOR_ISSUES:'VIS', VENDOR_LEDGER:'VLD', STOCK_MOVEMENT:'MOV' };
  const active = (key) => (sheets[key] || []).filter(r => !r.Deleted);
  const getAll = (key) => sheets[key] || [];
  const findIdx = (key, field, value) => {
    const row = (sheets[key] || []).find(r => r[field] === value);
    return row ? row._rowIndex : -1;
  };
  const update = (key, rowIndex, fields) => {
    const row = (sheets[key] || []).find(r => r._rowIndex === rowIndex);
    if (!row) throw new Error(`missing row ${key}#${rowIndex}`);
    Object.assign(row, fields);
  };
  const append = (key, row) => {
    if (!sheets[key]) sheets[key] = [];
    row._rowIndex = sheets[key].length + 2;
    sheets[key].push(row);
  };
  const generate = (key) => {
    counters[key] = (counters[key] || 0) + 1;
    return `${prefixes[key] || key}-${String(counters[key]).padStart(6,'0')}`;
  };
  const plan = (productId, qty) => {
    const p = sheets.PRODUCTS.find(x => x['Product ID'] === productId);
    const q = Number(qty) || 0;
    return { productId, draws: q > 0 ? [{ lotId:'LOT-'+productId+'-'+Date.now(), take:q, qty:q }] : [], shortfall: p && Number(p['Current Stock']) >= q ? 0 : q };
  };
  const adjustStock = (productId, delta) => {
    const p = sheets.PRODUCTS.find(x => x['Product ID'] === productId);
    p['Current Stock'] = (Number(p['Current Stock']) || 0) + Number(delta || 0);
    return p['Current Stock'];
  };
  const sandbox = {
    LockService:{getScriptLock:makeLock}, CONFIG:{LOCK_TIMEOUT_MS:1000},
    requirePermission_:()=>({name:'Admin'}), requireDeletePermission_:()=>({name:'Admin'}), requireActiveCashSession_:()=>({}),
    getSessionUser_:()=>({name:'Admin'}), actorName_:(u)=>u && u.name || 'Admin',
    getAllRows_:getAll, activeRows_:active, findRowIndex_:findIdx, findVendor_:(vendorId)=>sheets.VENDORS.find(v=>v['Vendor ID']===vendorId)||null, updateRowFields_:update, appendRow_:append,
    isDeleted_:(r)=>!!(r && r.Deleted), isValidNonNegativeNumber_:(n)=>Number.isFinite(Number(n)) && Number(n)>=0,
    sanitizeInput_:(v)=>String(v==null?'':v).trim(),
    resolveTransactionDate_:()=>({dateStr:'2026-09-20',isBackdated:false,backdatedDays:0,reason:''}),
    resolveEditedTransactionDate_:()=> '2026-09-20', generateId_:generate,
    planStockConsumption_:plan, applyStockConsumption_:(pl)=>pl.draws.map(d=>({lotId:d.lotId,qty:d.take,unitCost:0})),
    adjustProductStock_:adjustStock, createLot_:()=>generate('LOT'), logReversalMovement_:()=>{},
    markRowDeleted_:(key,rowIndex)=>update(key,rowIndex,{Deleted:true}),
    markMatchingDeleted_:(key,predicate)=>{ (sheets[key]||[]).forEach(r=>{ if(!r.Deleted && predicate(r)) r.Deleted=true; }); },
    logDeletion_:()=>{}, ok_:ok, fail_:fail, logError_:()=>{}
  };
  const ctx = vm.createContext(sandbox);
  const sources = [
    fnSource(read('Vendors.gs'),'adjustVendorReceivable_'),
    fnSource(read('Vendors.gs'),'postVendorLedgerEntry_'),
    fnSource(read('Vendors.gs'),'giveProductsToVendor'),
    fnSource(read('DeleteEngine.gs'),'reverseVendorIssueStockAndReceivable_'),
    fnSource(read('DeleteEngine.gs'),'updateVendorIssueInternal_'),
    fnSource(read('DeleteEngine.gs'),'updateVendorIssueMemo'),
    fnSource(read('DeleteEngine.gs'),'deleteVendorIssueMemo')
  ].join('\n');
  vm.runInContext(sources + '\nthis.api={giveProductsToVendor,updateVendorIssueMemo,deleteVendorIssueMemo};',ctx);

  let r = ctx.api.giveProductsToVendor('token',{vendorId:'V1',date:'2026-09-20',items:[
    {productId:'P1',quantity:2,unitValue:10},{productId:'P2',quantity:3,unitValue:20}
  ]});
  assert.strictEqual(r.success,true);
  const memoId=r.memoId;
  assert.strictEqual(sheets.PRODUCTS[0]['Current Stock'],8);
  assert.strictEqual(sheets.PRODUCTS[1]['Current Stock'],7);
  assert.strictEqual(sheets.VENDORS[0]['Current Receivable'],80);
  assert.strictEqual(active('VENDOR_ISSUES').length,2);
  assert.strictEqual(active('VENDOR_LEDGER').filter(x=>x.Type==='Issue').length,2);

  const issues=active('VENDOR_ISSUES');
  r = ctx.api.updateVendorIssueMemo('token',memoId,{date:'2026-09-20',notes:'edited',items:[
    {issueId:issues[0]['Issue ID'],quantity:4,unitValue:12},
    {issueId:issues[1]['Issue ID'],quantity:2,unitValue:25}
  ]});
  assert.strictEqual(r.success,true,r.message);
  assert.strictEqual(sheets.PRODUCTS[0]['Current Stock'],6);
  assert.strictEqual(sheets.PRODUCTS[1]['Current Stock'],8);
  assert.strictEqual(sheets.VENDORS[0]['Current Receivable'],98);
  assert.strictEqual(active('VENDOR_LEDGER').filter(x=>x.Type==='Issue').length,2);
  assert.strictEqual(sheets.VENDOR_LEDGER.filter(x=>x.Type==='Issue' && x.Deleted).length,2);

  r = ctx.api.deleteVendorIssueMemo('token',memoId,'cancel memo');
  assert.strictEqual(r.success,true);
  assert.strictEqual(sheets.PRODUCTS[0]['Current Stock'],10);
  assert.strictEqual(sheets.PRODUCTS[1]['Current Stock'],10);
  assert.strictEqual(sheets.VENDORS[0]['Current Receivable'],0);
  assert.strictEqual(active('VENDOR_ISSUES').length,0);
  assert.strictEqual(active('VENDOR_LEDGER').filter(x=>x.Type==='Issue').length,0);
});

if (!process.exitCode) console.log('9/9 passed');
