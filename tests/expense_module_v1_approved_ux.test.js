'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const markup=read('expenseReport.html');
const script=markup.match(/<script>([\s\S]*?)<\/script>/)[1];
const today='2026-11-05';
const month=[
  {expenseId:'R1',date:'2026-11-01',amount:100,category:'Rent',status:'Active',payeeName:'Rafi',paymentMethod:'Cash',description:'Rent'},
  {expenseId:'S1',date:'2026-11-05',amount:50,category:'Tea',status:'Active',payeeName:'Ali',paymentMethod:'Cash',description:'Tea'},
  {expenseId:'S2',date:'2026-11-05',amount:25,category:'Tea',status:'Active',payeeName:'Ali',paymentMethod:'Bank',description:'Snacks'},
  {expenseId:'C1',date:'2026-11-05',amount:900,category:'Rent',status:'Cancelled',payeeName:'Rafi',paymentMethod:'Cash'}
];
const october=[{expenseId:'O1',date:'2026-10-31',amount:500,category:'Salary',status:'Active',payeeName:'Kamal',paymentMethod:'Bank'}];
class FixedDate extends Date{
  constructor(...args){super(...(args.length?args:['2026-11-05T12:00:00Z']))}
}
function harness(){
  let calls=[],nav=[],nodes=new Map();
  const node=id=>{let content='';return {
    value:'',textContent:'',disabled:false,hidden:false,children:[],dataset:{},listeners:{},
    set innerHTML(v){content=String(v);this.children=[]},get innerHTML(){return content},
    appendChild(el){this.children.push(el)},addEventListener(k,fn){this.listeners[k]=fn},dispatch(k){return this.listeners[k]&&this.listeners[k]({target:this})},
    querySelectorAll:()=>[],classList:{add(){},remove(){}}
  }};
  const get=id=>{if(!nodes.has(id))nodes.set(id,node(id));return nodes.get(id)};
  const doc={getElementById:get,createElement:()=>node('tr'),addEventListener(){}};
  const cx=vm.createContext({document:doc,authToken:'token',Date:FixedDate,Promise,Map,
    withLoader:p=>p,showToast:()=>{},escapeHtml:s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),
    formatMoney:n=>'৳'+Number(n).toFixed(0),goToPage:page=>nav.push(page),expListLoad:()=>Promise.resolve(),
    serverCall:(name,token,opts)=>{
      calls.push({name,opts});
      assert.equal(name,'getExpenseLedger');
      const src=opts.dateFrom==='2026-10-01'?october:month;
      const rows=src.filter(x=>(!opts.dateFrom||x.date>=opts.dateFrom)&&(!opts.dateTo||x.date<=opts.dateTo));
      return Promise.resolve({rows,filteredTotal:rows.filter(x=>x.status!=='Cancelled').reduce((a,x)=>a+x.amount,0)});
    }
  });
  vm.runInContext(script,cx);
  return {cx,get,calls,nav};
}
test('Today and This Month are independently fetched from authenticated ledger and exclude cancelled expenses',async()=>{
  const h=harness();await h.cx.expRepLoad();
  assert.equal(h.get('expRepToday').textContent,'৳75');
  assert.equal(h.get('expRepMonth').textContent,'৳175');
  assert.match(String(h.get('expRepTodayCount').textContent),/2/);
  assert.match(String(h.get('expRepMonthCount').textContent),/3/);
  assert.equal(h.get('expRepPeriodTotal').textContent,'৳175');
  assert.ok(h.calls.some(c=>c.opts.dateFrom==='2026-11-01'&&c.opts.dateTo===today));
  assert.match(h.get('expRepTodayCategories').innerHTML,/Tea/);
  assert.doesNotMatch(h.get('expRepTodayCategories').innerHTML,/Rent/);
  assert.match(h.get('expRepMonthCategories').innerHTML,/Rent/);
});
test('Selected date preset changes only selected-period data, not Today or Month values',async()=>{
  const h=harness();await h.cx.expRepLoad();
  h.get('expReportDateFrom').value='2026-10-01';
  h.get('expReportDateTo').value='2026-10-31';
  await h.cx.expRepRun_();
  assert.equal(h.get('expRepPeriodTotal').textContent,'৳500');
  assert.equal(h.get('expRepToday').textContent,'৳75');
  assert.equal(h.get('expRepMonth').textContent,'৳175');
  await h.cx.expRepChoosePreset_('today');
  assert.equal(h.get('expReportDateFrom').value,today);
  assert.equal(h.get('expReportDateTo').value,today);
  assert.equal(h.get('expRepPeriodTotal').textContent,'৳75');
});
test('Last Month preset includes its actual final calendar date',async()=>{
  const h=harness();await h.cx.expRepLoad();
  await h.cx.expRepChoosePreset_('last-month');
  assert.equal(h.get('expReportDateFrom').value,'2026-10-01');
  assert.equal(h.get('expReportDateTo').value,'2026-10-31');
  assert.equal(h.get('expRepPeriodTotal').textContent,'৳500');
});
test('Today and monthly breakdown buttons open Expense History with correct dates',async()=>{
  const h=harness();await h.cx.expRepLoad();
  h.cx.expRepOpenHistory_('today');
  assert.equal(h.get('expListDateFrom').value,today);
  assert.equal(h.get('expListDateTo').value,today);
  assert.equal(h.nav.at(-1),'expenseList');
  h.cx.expRepOpenHistory_('month');
  assert.equal(h.get('expListDateFrom').value,'2026-11-01');
  assert.equal(h.get('expListDateTo').value,today);
});
test('Daily chart displays selected dates with exact expense sums and excludes cancelled amounts',async()=>{
  const h=harness();await h.cx.expRepLoad();
  const chart=h.get('expRepDailyChart').innerHTML;
  assert.match(chart,/2026-11-01/);
  assert.match(chart,/2026-11-05/);
  assert.doesNotMatch(chart,/925/);
  assert.match(chart,/75/);
});
test('one native module tab strip matches approved five-page navigation',()=>{
  const ui=read('UI.gs');
  for(const page of ['expenseReports','expense','expenseList','expenseCategories','expensePayees'])
    assert.match(ui,new RegExp("key:\\s*'"+page+"'"),page);
  assert.match(read('index.html'),/include\('expensePayees'\)/);
  for(const name of ['expenseReport.html','expense.html','expenseList.html','expenseCategory.html'])
    assert.doesNotMatch(read(name),/class="expense-module-nav"/,name);
  assert.match(read('javascript.html'),/expensePayees:\s*'exPayLoad'/);
  assert.match(read('expensePayees.html'),/function exPayLoad\(/);
});
test('Approved compact card and mobile layout CSS are module-scoped',()=>{
  const css=read('style.html')+'\n'+read('expenseCompactStyle.html');
  assert.match(css,/#page-expenseReports \.exp-report-overview \.stat-card/);
  assert.match(css,/padding:\s*10px 12px/);
  assert.match(css,/@media\s*\(max-width:\s*540px\)/);
  assert.match(css,/#page-expenseList/);
  assert.match(css,/#page-expenseCategories/);
  assert.match(css,/#page-expense \.form-grid/);
});
test('Approved report controls and preserved write/edit management IDs coexist',()=>{
  assert.match(markup,/data-exp-preset="today"/);
  assert.match(markup,/data-exp-preset="month"/);
  assert.match(markup,/data-exp-preset="last-month"/);
  assert.match(markup,/id="expRepDailyChart"/);
  for(const id of ['expDate','expAmount','expPaymentMethod','expPayee','expCategory','expSaveBtn','expManagePayeesBtn','expBackdatedReason']){
    assert.match(read('expense.html'),new RegExp('id="'+id+'"'));
  }
  for(const id of ['expListExportBtn','expListPrintBtn','expListSearch','expListTableBody']){
    assert.match(read('expenseList.html'),new RegExp('id="'+id+'"'));
  }
});


test('compact category chips and daily chart escape formatted currency text',()=>{
  const h=harness();
  h.cx.formatMoney=()=>'<svg onload=alert(1)>';
  h.cx.expRepCategoryChips_([{category:'<img src=x>',amount:50}], 'expRepTodayCategories');
  const chips=h.get('expRepTodayCategories').innerHTML;
  assert.match(chips,/&lt;img src=x&gt;/);
  assert.doesNotMatch(chips,/<svg/);
  h.cx.expRepDrawChart_([{date:'2026-11-05',amount:50}]);
  assert.doesNotMatch(h.get('expRepDailyChart').innerHTML,/<svg/);
});
