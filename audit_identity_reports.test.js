'use strict';
const fs = require('fs'), vm = require('vm'), assert = require('assert');
let passed = 0, failed = 0;
function test(name, run) { try { run(); passed++; console.log('PASS', name); } catch (e) { failed++; console.error('FAIL', name, e.stack); } }
function context(rows = {}) {
  const props = {};
  const ctx = { console, Date, Logger: {log: () => {}}, isDeleted_: r => String(r['Is Deleted']).toLowerCase() === 'true',
    getAllRows_: k => rows[k] || [], activeRows_: k => (rows[k] || []).filter(r => !ctx.isDeleted_(r)),
    findRows_: (k,c,v) => (rows[k] || []).filter(r => r[c] === v),
    getSheet_: k => ({getLastRow: () => (rows[k] || []).length + 1, getRange: () => ({getValues: () => (rows[k] || []).map(r => [r[ctx.CONFIG.HEADERS[k][0]]])})}),
    PropertiesService: {getDocumentProperties: () => ({getProperty: k => props[k], setProperty: (k,v) => {props[k]=v;}})},
    requirePermission_: () => ({Role:'Administrator'}), logError_: () => {}, getSettingsMap_: () => ({}),
    Session: {getScriptTimeZone: () => 'Asia/Dhaka'}, Utilities: {formatDate: () => '2026-09-05'},
    CacheService: {getScriptCache: () => ({get: () => null, put: () => {}})},
    computeSettlementDiscountProfit_: () => ({customerDiscountGiven:0,supplierDiscountReceived:0,netProfitImpact:0})
  };
  vm.createContext(ctx);
  for (const file of ['Config.gs','Utils.gs','Reports.gs','PartyLedger.gs','DayBook.gs']) vm.runInContext(fs.readFileSync(file,'utf8'),ctx,{filename:file});
  ctx.CONFIG = vm.runInContext('CONFIG',ctx);
  return {ctx, props};
}
test('every ID family clears sparse stale counters and never reuses deleted IDs', () => {
  const {ctx,props} = context();
  for (const [key,prefix] of Object.entries(ctx.CONFIG.ID_PREFIX)) {
    const rows = {}; rows[key] = [{[ctx.CONFIG.HEADERS[key][0]]:prefix+'-000016','Is Deleted':true}];
    const h = context(rows); h.props['ID_COUNTER_'+key]='4';
    assert.equal(h.ctx.generateId_(key),prefix+'-000017',key);
    assert.equal(h.ctx.generateId_(key),prefix+'-000018',key);
  }
});
for (const counter of ['NaN','Infinity','-7','1.5','bad']) test('invalid ID property cannot issue malformed/reused ID: '+counter, () => {
  const {ctx,props} = context({SALES:[{'Invoice ID':'INV-000016'}]}); props.ID_COUNTER_SALES=counter;
  assert.equal(ctx.generateId_('SALES'),'INV-000017');
  assert.equal(ctx.generateId_('SALES'),'INV-000018');
  const empty = context(); empty.props.ID_COUNTER_SALES=counter;
  assert.equal(empty.ctx.generateId_('SALES'),'INV-000001');
});
test('ID counter rejects exhausted integer range before changing properties', () => {
  const {ctx,props} = context(); props.ID_COUNTER_SALES=String(Number.MAX_SAFE_INTEGER);
  assert.throws(() => ctx.generateId_('SALES'), /range|exhaust|safe/i);
  assert.equal(props.ID_COUNTER_SALES,String(Number.MAX_SAFE_INTEGER));
});
const sales = [
  {'Invoice ID':'INV-1','Customer ID':'C1',Date:'2026-09-05',Subtotal:100,'Grand Total':100},
  {'Invoice ID':'INV-1','Customer ID':'C2',Date:'2026-08-01',Subtotal:500,'Grand Total':500}
];
for (const deleted of [false,true]) test('sales and profit reports reject cross-date duplicate even if other header deleted='+deleted, () => {
  const {ctx}=context({SALES:[sales[0],{...sales[1],'Is Deleted':deleted}]});
  const result=ctx.getSalesReport('token',{from:'2026-09-05',to:'2026-09-05'});
  assert.equal(result.success,false); assert.match(result.message,/Duplicate invoice ID/);
  assert.throws(()=>ctx.computeProfit_({from:'2026-09-05',to:'2026-09-05'}),/Duplicate invoice ID/);
});
test('customer ledger page fails closed on ambiguous invoice before reading ledger', () => {
  const {ctx}=context({SALES:sales}); ctx.partyLedgerBuildAscendingIndex_=()=>[];
  const result=ctx.getCustomerLedgerPage('token','C1',50,'');
  assert.equal(result.success,false); assert.match(result.message,/Duplicate invoice ID/);
});
test('Day Book rejects duplicate invoice rather than aggregating ambiguous money', () => {
  const {ctx}=context({SALES:sales});
  const result=ctx.getDayBookTransactions('token',{});
  assert.equal(result.success,false); assert.match(result.message,/Duplicate invoice ID/);
});
test('1899 time-only sheet cell stays a clock, business dates stay date-only', () => {
  const {ctx}=context();
  assert.equal(ctx.safeTimeOnly_('1899-12-30T14:23:45'),'14:23:45');
  assert.equal(ctx.safeDateOnly_('2026-09-05T23:59:59'),'2026-09-05');
});
test('financial date validation rejects impossible calendar day before backdate authorization', () => {
  const {ctx}=context(); ctx.computeBackdateInfo_=()=>({isBackdated:false});
  assert.throws(()=>ctx.resolveTransactionDate_('token','pos','2026-02-31','','Sale'),/valid.*date/i);
});
console.log(`audit_identity_reports: ${passed}/${passed+failed} PASS`);
if(failed) process.exitCode=1;
