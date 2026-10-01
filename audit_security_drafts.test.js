'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const assert = require('node:assert/strict');
const test = require('node:test');
const root = path.resolve(__dirname, '..');
const sources = fs.readdirSync(root).filter(f => f.endsWith('.gs'));

// Execute the real RPCs and authorization code. Only Apps Script services and
// the Sheets repository boundary are replaced by deterministic in-memory data.
function harness() {
  const db = {}, cache = {}, props = {}, writes = [], reads = [];
  let serial = 0, locked = false;
  const propertyStore = {getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; }};
  const context = vm.createContext({console, Date, JSON, Math, Number, String, Object, Array, isFinite,
    Session: {getScriptTimeZone: () => 'UTC'},
    Utilities: {DigestAlgorithm: {SHA_256: 'sha256'}, Charset: {UTF_8: 'utf8'},
      computeDigest: (_, value) => [...crypto.createHash('sha256').update(String(value)).digest()],
      getUuid: () => crypto.randomUUID(), formatDate: (d, tz, f) => f === 'yyyy' ? '2026' : '2026-09-05'},
    PropertiesService: {getScriptProperties: () => propertyStore, getDocumentProperties: () => propertyStore},
    CacheService: {getScriptCache: () => ({get: k => cache[k] || null, put: (k,v) => {cache[k]=v;}, remove: k => {delete cache[k];}})},
    LockService: {getScriptLock: () => ({waitLock() {if (locked) throw Error('Concurrent write blocked'); locked = true;}, releaseLock() {locked = false;}})}
  });
  for (const file of sources) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, {filename: file});
  const rows = key => (db[key] || []).map((row, i) => ({...row, _rowIndex: i + 2}));
  Object.assign(context, {
    logError_: () => {}, getAllRows_: key => { reads.push(key); return rows(key); },
    findFirstRow_: (key, col, value) => rows(key).find(r => String(r[col]) === String(value)) || null,
    findRowIndex_: (key, col, value) => {const row = rows(key).find(r => String(r[col]) === String(value)); return row ? row._rowIndex : -1;},
    appendRow_: (key, row) => {writes.push({key, operation:'append', locked}); (db[key] ||= []).push({...row});},
    updateRowFields_: (key, index, values) => {writes.push({key, operation:'update', locked}); Object.assign(db[key][index - 2], values);},
    deleteRow_: (key, index) => {writes.push({key, operation:'delete', locked}); db[key].splice(index - 2, 1);},
    generateId_: key => key + '-' + (++serial), generateDraftInvoiceNo_: () => 'DRAFT-2026-' + (++serial),
    getSettingsMap_: () => ({}), buildInvoiceShopPayload_: () => ({}),
    getSheet_: () => {throw Error('Unexpected raw Sheet access');}
  });
  function user(id, role, permissions = {}) {
    (db.USERS ||= []).push({'User ID': id, 'Full Name': id, 'Mobile Number': id, Role:role, Status:'Active', 'Password Hash':'original', 'Password Salt':'original'});
    (db.ROLES ||= []).push({'Role ID': role, 'Role Name':role, Status:'Active', Permissions:JSON.stringify(permissions)});
    (db.SESSIONS ||= []).push({Token:id, 'User ID':id, 'Expires At':new Date(Date.now()+3600000)});
    return rows('USERS').find(r => r['User ID'] === id);
  }
  return {c: context, db, writes, reads, user, cache};
}
const payload = () => ({customerId:'C1', customerName:'Customer', customerPhone:'01700000000', items:[{productId:'P1',name:'Product',qty:2,unitPrice:50,lineTotal:100}], subtotal:100,discount:10,grandTotal:90,payment:{amountReceived:'20',paymentMethod:'Cash'}});
function deny(result, pattern = /permission|Administrator|logged in|Session expired|inactive/i) {
  assert.equal(result.success, false, JSON.stringify(result));
  assert.match(result.error || result.message, pattern);
}

const tokenRpcs = sources.flatMap(file => [...fs.readFileSync(path.join(root,file),'utf8').matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(\s*token\b/gm)].map(m => m[1])).filter(name => !name.endsWith('_') && name !== 'logout');
for (const token of ['', 'invalid', 'restricted']) {
  test('all published token RPCs reject ' + (token || 'missing') + ' authorization before writes', () => {
    const failures = [];
    for (const rpc of tokenRpcs) {
      if (token === 'restricted' && ['validateSession','getCounterBootstrap'].includes(rpc)) continue; // Authentication-only responses; counter filters every capability.
      const h = harness(); h.user('restricted', 'No grants');
      const args = rpc === 'deleteDayBookEntry' ? [token,'sales','record','reason'] : [token,'record',{},'reason'];
      try {
        const result = h.c[rpc](...args);
        assert.equal(result.success, false, JSON.stringify(result));
        assert.equal(h.writes.length, 0, JSON.stringify(h.writes));
        // Some deletes deliberately reject a nonexistent target before checking
        // its date-window permission; those target-specific gates are tested below.
        assert.match(result.error || result.message, /permission|Administrator|logged in|Session expired|not found|does not exist|inactive/i);
      } catch (error) { failures.push(rpc + ': ' + error.message); }
    }
    assert.deepEqual(failures, []);
  });
}

test('long distinct role names cannot share cached permissions', () => {
  const h = harness(), common = 'r'.repeat(100);
  const privileged = h.user('privileged', common+'allowed', {users:{edit:true}});
  const restricted = h.user('restricted', common+'denied', {});
  assert.equal(h.c.hasPermission_(privileged,'users','edit'), true);
  assert.equal(h.c.hasPermission_(restricted,'users','edit'), false);
});

test('existing financial records enforce delete permissions before reversal writes', () => {
  const cases = [
    ['deleteSalesInvoice','SALES',{'Invoice ID':'record',Date:'2026-09-05'}],
    ['deletePurchase','PURCHASES',{'Purchase ID':'record',Date:'2026-09-05'}],
    ['deleteExpense','EXPENSES',{'Expense ID':'record',Date:'2026-09-05'}],
    ['deleteSupplier','SUPPLIERS',{'Supplier ID':'record', 'Created At':'2026-09-05'}],
    ['deleteProduct','PRODUCTS',{'Product ID':'record', 'Created At':'2026-09-05'}]
  ];
  for (const [rpc,sheet,row] of cases) {
    for (const token of ['', 'invalid', 'restricted']) {
      const h = harness(); h.user('restricted','No delete',{sales:{view:true},purchase:{view:true},expense:{view:true}}); h.db[sheet]=[row];
      deny(h.c[rpc](token,'record','Audit denial')); assert.equal(h.writes.length,0,rpc);
    }
  }
});

test('session expiry is enforced both before and after caching', () => {
  for (const warm of [false,true]) {
    const h = harness(); h.user('staff','Staff',{users:{view:true}});
    if (warm) h.c.getSessionUser_('staff');
    if (warm) {
      const key = h.c.sessionCacheKey_('staff'), cached = JSON.parse(h.cache[key]);
      cached.expiresAt = new Date(Date.now()-1); h.cache[key]=JSON.stringify(cached);
    } else h.db.SESSIONS[0]['Expires At']=new Date(Date.now()-1);
    deny(h.c.getUsersBootstrap('staff'), /Session expired/); assert.equal(h.writes.length,0);
  }
});

test('malformed session expiry fails closed in both sheet and cached session', () => {
  for (const warm of [false,true]) {
    const h = harness(); h.user('staff','Staff',{users:{view:true}});
    if (warm) {
      h.c.getSessionUser_('staff');
      const key = h.c.sessionCacheKey_('staff'), cached = JSON.parse(h.cache[key]);
      cached.expiresAt='invalid'; h.cache[key]=JSON.stringify(cached);
    } else h.db.SESSIONS[0]['Expires At']='invalid';
    deny(h.c.getUsersBootstrap('staff'), /Session expired/); assert.equal(h.writes.length,0);
  }
});

test('password reset and role deactivation revoke cached access on the next RPC', () => {
  for (const operation of ['password','role']) {
    const h = harness(); h.user('admin','Administrator'); h.user('staff','Staff',{users:{view:true}});
    assert.equal(h.c.getUsersBootstrap('staff').success,true);
    const result = operation === 'password' ? h.c.resetPassword('admin','staff','new-password123') : h.c.setRoleStatus('admin','Staff','Inactive');
    assert.equal(result.success,true);
    deny(h.c.getUsersBootstrap('staff'));
  }
});

test('counter bootstrap exposes no business records when all capabilities are denied', () => {
  const h = harness(); h.user('restricted','No grants');
  h.db.CUSTOMERS=[{'Customer ID':'secret','Customer Name':'Secret'}];
  h.db.SUPPLIERS=[{'Supplier ID':'secret','Supplier Name':'Secret'}];
  const result = h.c.getCounterBootstrap('restricted'); assert.equal(result.success,true);
  assert.equal(Object.values(result.data.capabilities).some(Boolean),false);
  for (const key of ['customers','suppliers','expenseCategories','expensePayees','paymentAccounts','transferAccounts']) assert.equal(result.data[key].length,0);
  assert.equal(h.writes.length,0);
});

test('delegated user editor cannot reset an Administrator password', () => {
  const h = harness(); h.user('editor','Editor',{users:{edit:true}}); h.user('admin','Administrator');
  deny(h.c.resetPassword('editor','admin','attacker-password'));
  assert.equal(h.db.USERS[1]['Password Hash'], 'original'); assert.equal(h.writes.length,0);
});

test('last active Administrator cannot be deactivated, demoted or deleted', () => {
  for (const operation of ['status','role','delete']) {
    const h = harness(); h.user('admin','Administrator'); h.user('manager','Manager',{users:{edit:true,delete:true}});
    const result = operation === 'status' ? h.c.setUserStatus('admin','admin','Inactive') : operation === 'role' ? h.c.updateUser('admin','admin',{name:'Admin',mobile:'admin',role:'Manager'}) : h.c.deleteUser('manager','admin');
    deny(result, /active Administrator/); assert.equal(h.writes.length,0);
  }
});

test('concurrent Administrator deactivations cannot both pass the same active count', () => {
  const h = harness(); h.user('admin','Administrator'); h.user('admin2','Administrator');
  const update = h.c.updateRowFields_; let interleaved = false;
  h.c.updateRowFields_ = (key,index,values) => {
    if (key === 'USERS' && !interleaved) {
      interleaved = true;
      try {h.c.setUserStatus('admin2','admin','Inactive');} catch (err) {assert.match(err.message,/Concurrent write blocked/);}
    }
    return update(key,index,values);
  };
  assert.equal(h.c.setUserStatus('admin','admin2','Inactive').success,true);
  assert.equal(h.db.USERS.filter(u => u.Role === 'Administrator' && u.Status === 'Active').length,1);
});

test('non-admin cannot create or promote Administrator accounts', () => {
  const h = harness(); h.user('manager','Manager',{users:{add:true,edit:true}}); h.user('staff','Staff');
  deny(h.c.createUser('manager',{name:'Escalation',mobile:'999',role:'Administrator',password:'password123'}));
  deny(h.c.updateUser('manager','staff',{name:'Staff',mobile:'staff',role:'Administrator'})); assert.equal(h.writes.length,0);
});

test('draft CRUD preserves owner identity, optimistic version and financial isolation', () => {
  const h = harness(); h.user('owner','Cashier',{pos:{view:true,add:true}}); h.user('other','Other',{pos:{view:true,add:true}});
  const malicious = {...payload(),createdById:'other',version:999};
  const saved = h.c.saveSalesDraft('owner',malicious); assert.equal(saved.success,true);
  const id = saved.data.draftId;
  assert.equal(h.c.getSalesDraft('owner',id).data.createdById,'owner');
  assert.equal(h.c.getSalesDraftList('other').data.length,0);
  for (const result of [h.c.getSalesDraft('other',id),h.c.getSalesDraftPreview('other',id),h.c.updateSalesDraft('other',id,1,payload()),h.c.deleteSalesDraft('other',id,1,'reason')]) deny(result);
  const before = h.writes.length;
  deny(h.c.updateSalesDraft('owner',id,99,payload()), /changed by another/);
  deny(h.c.deleteSalesDraft('owner',id,99,'reason'), /changed by another/);
  deny(h.c.deleteSalesDraft('owner',id,1,''), /Reason/); assert.equal(h.writes.length,before);
  assert.equal(h.c.updateSalesDraft('owner',id,1,payload()).data.version,2);
  const preview = h.c.getSalesDraftPreview('owner',id); assert.equal(preview.success,true); assert.equal(preview.data.isDraft,true);
  assert.equal(h.c.deleteSalesDraft('owner',id,2,'No longer needed').success,true);
  assert.equal(h.c.getSalesDraftList('owner').data.length,0);
  assert.deepEqual(h.db.SALES_DRAFT_AUDIT.map(r => r.Action),['CREATED','UPDATED','DELETED']);
  assert.deepEqual([...new Set(h.writes.map(w => w.key))].sort(),['SALES_DRAFTS','SALES_DRAFT_AUDIT']);
});

test('draft conversion rejects another owner and stale versions before accounting writes', () => {
  const h = harness(); h.user('owner','Cashier',{pos:{view:true,add:true}}); h.user('other','Other',{pos:{view:true,add:true}});
  const id = h.c.saveSalesDraft('owner',payload()).data.draftId; const before = h.writes.length;
  deny(h.c.completeSale('other',{...payload(),sourceDraftId:id,sourceDraftVersion:1}));
  deny(h.c.completeSale('owner',{...payload(),sourceDraftId:id,sourceDraftVersion:2}), /changed by another/);
  assert.equal(h.writes.length,before);
});

test('draft invalid payloads reject before any draft or financial writes', () => {
  for (const bad of [{...payload(),items:[]},{...payload(),grandTotal:-1},{...payload(),items:[{...payload().items[0],qty:0}]},{...payload(),items:[{...payload().items[0],warrantyData:'x'.repeat(46000)}]}]) {
    const h = harness(); h.user('owner','Cashier',{pos:{view:true,add:true}});
    assert.equal(h.c.saveSalesDraft('owner',bad).success,false); assert.equal(h.writes.length,0);
  }
});

test('sales editor can manage another owner draft without changing creator identity', () => {
  const h = harness(); h.user('owner','Cashier',{pos:{view:true,add:true}}); h.user('manager','Manager',{sales:{edit:true},pos:{view:true}});
  const id = h.c.saveSalesDraft('owner',payload()).data.draftId;
  assert.equal(h.c.getSalesDraftList('manager').data.length,1);
  assert.equal(h.c.updateSalesDraft('manager',id,1,payload()).success,true);
  const result = h.c.getSalesDraft('manager',id); assert.equal(result.data.createdById,'owner'); assert.equal(result.data.updatedById,'manager');
  deny(h.c.completeSale('manager',{...payload(),sourceDraftId:id,sourceDraftVersion:2}));
});

test('draft posting retry remains authorized after recovering a failed initial audit write', () => {
  const h = harness(); const owner = h.user('owner','Cashier',{pos:{view:true,add:true}});
  const id = h.c.saveSalesDraft('owner',payload()).data.draftId;
  // Financial sale already committed; first cleanup could not append POSTED.
  h.db.SALES = [{'Invoice ID':'INV1','Source Draft ID':id}];
  const append = h.c.appendRow_; h.c.appendRow_ = () => {throw Error('temporary sheet failure');};
  assert.equal(h.c.removeSalesDraftAfterPost_(id,1,'INV1',owner,false),false);
  h.c.appendRow_ = append;
  assert.equal(h.c.authorizePostedDraftRetry_(owner,id,1),true);
  assert.equal(h.c.removeSalesDraftAfterPost_(id,1,'INV1',owner,true),true);
  assert.equal(h.c.authorizePostedDraftRetry_(owner,id,1),true);
  assert.equal(h.db.SALES.length,1); assert.equal(h.db.SALES_DRAFTS.length,0);
});

console.log('Behavioral token RPC inventory: ' + tokenRpcs.length);
