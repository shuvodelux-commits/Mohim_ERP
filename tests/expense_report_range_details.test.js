'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'expenseReport.html'), 'utf8');
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1];

function loadReport(rows) {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', textContent: '', hidden: false, innerHTML: '', listeners: {}, children: [],
      addEventListener(name, fn) { this.listeners[name] = fn; },
      appendChild(row) { this.children.push(row); }
    });
    return elements.get(id);
  };
  let calls = 0;
  const toast = [];
  const document = {
    getElementById: get,
    createElement: () => ({ innerHTML: '' }),
    addEventListener() {}
  };
  const context = vm.createContext({
    document, authToken: 'test',
    goToPage() {},
    escapeHtml(value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
    formatMoney: value => '৳' + Number(value).toFixed(0),
    withLoader: promise => promise,
    serverCall: () => { calls += 1; return Promise.resolve(rows); },
    showToast: msg => toast.push(msg)
  });
  vm.runInContext(script, context);
  return { get, context, toast, getCalls: () => calls };
}

test('Run Report re-fetches expenses, applies inclusive date range and excludes cancelled rows', async () => {
  assert.match(source, /id="expReportRunBtn"/);
  const page = loadReport([
    {expenseId:'1', date:'2026-10-01', amount:100, status:'Active', category:'Rent'},
    {expenseId:'2', date:'2026-10-02', amount:200, status:'Active', category:'Salary'},
    {expenseId:'3', date:'2026-10-03', amount:300, status:'Active', category:'Rent'},
    {expenseId:'4', date:'2026-10-02', amount:999, status:'Cancelled', category:'Rent'}
  ]);
  page.get('expReportDateFrom').value='2026-10-01';
  page.get('expReportDateTo').value='2026-10-02';
  await page.get('expReportRunBtn').listeners.click();
  assert.equal(page.getCalls(), 1);
  assert.equal(page.get('expRepPeriodTotal').textContent, '৳300');
  assert.equal(page.get('expRepPeriodCount').textContent, 2);
});

test('invalid reversed date range is explained and never sent to server', async () => {
  const page = loadReport([]);
  page.get('expReportDateFrom').value='2026-11-05';
  page.get('expReportDateTo').value='2026-11-01';
  await page.get('expReportRunBtn').listeners.click();
  assert.equal(page.getCalls(), 0);
  assert.equal(page.get('expReportRangeError').hidden, false);
  assert.match(page.get('expReportRangeError').textContent, /from|before|date|তারিখ/i);
});

test('period details are newest-first, escape source text, and report the actual count', async () => {
  const page = loadReport([
    {expenseId:'older', date:'2026-10-01', amount:100, category:'Rent', payeeName:'Ali', description:'October'},
    {expenseId:'later', date:'2026-10-02', amount:20, category:'Utility', payeeName:'Sam', description:'<img src=x>'},
    {expenseId:'cancel', date:'2026-10-03', amount:500, status:'Cancelled'}
  ]);
  await page.context.expRepLoad();
  const cells = page.get('expRepDetailBody').children.map(row => row.innerHTML).join('\n');
  assert.match(cells, /later/);
  assert.ok(cells.indexOf('later') < cells.indexOf('older'));
  assert.match(cells, /&lt;img src=x&gt;/);
  assert.doesNotMatch(cells, /<img src=x>/);
  assert.doesNotMatch(cells, /cancel/);
  assert.equal(page.get('expRepDetailCount').textContent, 'Showing 2 of 2 entries');
});

test('empty selected period clears detailed rows, shows empty state and zero totals', async () => {
  assert.match(source, /id="expRepDetailEmpty"/);
  const page = loadReport([{expenseId:'out', date:'2026-10-01', amount:50, category:'Rent'}]);
  page.get('expReportDateFrom').value='2026-11-01';
  page.get('expReportDateTo').value='2026-11-05';
  await page.context.expRepLoad();
  assert.equal(page.get('expRepDetailBody').children.length, 0);
  assert.equal(page.get('expRepDetailEmpty').hidden, false);
  assert.equal(page.get('expRepPeriodTotal').textContent, '৳0');
  assert.equal(page.get('expRepPeriodCount').textContent, 0);
});
