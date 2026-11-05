'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'expenseReport.html'),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
class FixedDate extends Date{
  constructor(...args){super(...(args.length?args:['2026-11-05T12:00:00Z']))}
  static now(){return Date.parse('2026-11-05T12:00:00Z')}
}
function setup(handler=()=>({rows:[],filteredTotal:0})){
  const map=new Map(),calls=[],nav=[],errors=[];
  const node=id=>{let html='';return {
    id, value:'',textContent:'',hidden:false,disabled:false,children:[],listeners:{},
    set innerHTML(v){html=String(v);this.children=[]},get innerHTML(){return html},
    addEventListener(k,fn){this.listeners[k]=fn},appendChild(c){this.children.push(c)},
    dispatch(k){return this.listeners[k]&&this.listeners[k]()}
  }};
  const get=id=>{if(!map.has(id))map.set(id,node(id));return map.get(id)};
  const document={getElementById:get,createElement:node,addEventListener(){}};
  const ctx=vm.createContext({document,Date:FixedDate,Promise,authToken:'token',
    goToPage:k=>nav.push(k),expListLoad:()=>nav.push('history-loaded'),
    withLoader:p=>p,serverCall:(name,token,filters)=>{calls.push({name,token,filters});return Promise.resolve().then(()=>handler(name,token,filters))},
    formatMoney:n=>'৳'+Number(n).toLocaleString('en-US',{maximumFractionDigits:2}),
    escapeHtml:s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),
    showToast:msg=>errors.push(msg)
  });
  vm.runInContext(script,ctx);
  return {ctx,get,calls,nav,errors};
}
const row=(id,date,amount,category,status='Active')=>({expenseId:id,date,amount,category,status,payeeName:'Mohim',paymentMethod:'Cash',description:'Expense '+id});

test('month-to-date defaults and ledger totals exclude cancelled entries',async()=>{
  const p=setup((fn,token,f)=>{
    assert.equal(fn,'getExpenseLedger'); assert.equal(token,'token');
    assert.equal(f.dateFrom,'2026-11-01');assert.equal(f.dateTo,'2026-11-05');
    return {rows:[row('a','2026-11-01',100,'Rent'),row('b','2026-11-05',200,'Salary'),row('void','2026-11-05',900,'Rent','Cancelled')],filteredTotal:300};
  });
  await p.ctx.expRepLoad();
  assert.equal(p.get('expReportDateFrom').value,'2026-11-01');
  assert.equal(p.get('expRepPeriodTotal').textContent,'৳300');
  assert.equal(p.get('expRepPeriodCount').textContent,2);
  assert.equal(p.get('expRepDailyAverage').textContent,'৳60');
  assert.equal(p.get('expRepHighest').textContent,'৳200');
  assert.match(p.get('expRepAppliedRange').textContent,/2026-11-01.*2026-11-05/);
});

test('date input change re-queries server for inclusive selected period',async()=>{
  const p=setup((fn,token,f)=>f.dateFrom==='2026-10-01'?{rows:[row('oct','2026-10-31',75,'Rent')],filteredTotal:75}:{rows:[row('nov','2026-11-05',900,'Salary')],filteredTotal:900});
  await p.ctx.expRepLoad();
  p.get('expReportDateFrom').value='2026-10-01';
  p.get('expReportDateTo').value='2026-10-31';
  await p.get('expReportDateTo').dispatch('change');
  assert.equal(p.calls.length,2);
  assert.equal(p.calls[1].filters.dateTo,'2026-10-31');
  assert.equal(p.get('expRepPeriodTotal').textContent,'৳75');
});

test('breakdowns show category shares and grouped daily amounts',async()=>{
  const p=setup(()=>({rows:[row('a','2026-11-01',100,'Rent'),row('b','2026-11-05',200,'Salary'),row('void','2026-11-01',500,'Rent','Cancelled')],filteredTotal:300}));
  await p.ctx.expRepLoad();
  const cats=p.get('expRepByCategoryBody').children.map(x=>x.innerHTML).join(' ');
  const days=p.get('expRepByDayBody').children.map(x=>x.innerHTML).join(' ');
  assert.match(cats,/33\.3%/);assert.match(cats,/66\.7%/);
  assert.match(days,/2026-11-01/);assert.match(days,/2026-11-05/);
  assert.match(days,/৳100/);assert.match(days,/৳200/);assert.doesNotMatch(days,/৳500/);
});

test('invalid reversed range removes old total without calling server',async()=>{
  const p=setup(()=>({rows:[row('a','2026-11-02',100,'Rent')],filteredTotal:100}));
  await p.ctx.expRepLoad();
  p.get('expReportDateFrom').value='2026-11-05';
  p.get('expReportDateTo').value='2026-11-02';
  await p.get('expReportRunBtn').dispatch('click');
  assert.equal(p.calls.length,1);
  assert.equal(p.get('expRepPeriodTotal').textContent,'—');
  assert.equal(p.get('expReportRangeError').hidden,false);
});

test('empty selected period yields zero metrics and empty tables',async()=>{
  const p=setup();await p.ctx.expRepLoad();
  assert.equal(p.get('expRepPeriodTotal').textContent,'৳0');
  assert.equal(p.get('expRepPeriodCount').textContent,0);
  assert.equal(p.get('expRepDailyAverage').textContent,'৳0');
  assert.equal(p.get('expRepHighest').textContent,'৳0');
  assert.equal(p.get('expRepDetailEmpty').hidden,false);
});

test('server error and reconciliation mismatch fail closed',async()=>{
  let mode='ok';
  const p=setup(()=>{if(mode==='throw')throw Error('Google Sheets unavailable');
    return {rows:[row('a','2026-11-05',100,'Rent')],filteredTotal:mode==='mismatch'?110:100}});
  await p.ctx.expRepLoad();mode='mismatch';await p.ctx.expRepRun_();
  assert.equal(p.get('expRepPeriodTotal').textContent,'—');
  assert.match(p.get('expReportRangeError').textContent,/mismatch|match/i);
  mode='throw';await p.ctx.expRepRun_();
  assert.equal(p.get('expRepPeriodTotal').textContent,'—');
  assert.match(p.get('expReportRangeError').textContent,/unavailable/);
});

test('late older response cannot overwrite newer date selection',async()=>{
  const pending=[];
  const p=setup(()=>new Promise(resolve=>pending.push(resolve)));
  p.get('expReportDateFrom').value='2026-10-01';
  p.get('expReportDateTo').value='2026-10-31';
  const old=p.ctx.expRepRun_();await Promise.resolve();await Promise.resolve();
  p.get('expReportDateFrom').value='2026-11-01';
  p.get('expReportDateTo').value='2026-11-05';
  const fresh=p.ctx.expRepRun_();await Promise.resolve();await Promise.resolve();
  assert.equal(pending.length,2);
  pending[1]({rows:[row('new','2026-11-05',200,'Salary')],filteredTotal:200});await fresh;
  pending[0]({rows:[row('old','2026-10-01',100,'Rent')],filteredTotal:100});await old;
  assert.equal(p.get('expRepPeriodTotal').textContent,'৳200');
});

test('View Full History carries dates into Expense History',async()=>{
  const p=setup();await p.ctx.expRepLoad();
  p.get('expRepViewAllBtn').dispatch('click');
  assert.equal(p.get('expListDateFrom').value,'2026-11-01');
  assert.equal(p.get('expListDateTo').value,'2026-11-05');
  assert.deepEqual(p.nav,['expenseList','history-loaded']);
});

test('Expense Ledger server calculates inclusive period total over real Expense.gs logic',()=>{
  const rows=[
    {'Expense ID':'a',Date:'2026-10-01',Amount:25,Status:'Active','Category Name':'Rent'},
    {'Expense ID':'b',Date:'2026-10-31',Amount:75,Status:'Active','Category Name':'Rent'},
    {'Expense ID':'c',Date:'2026-11-01',Amount:500,Status:'Active','Category Name':'Salary'},
    {'Expense ID':'d',Date:'2026-10-15',Amount:999,Status:'Cancelled','Category Name':'Rent'}
  ];
  const ctx=vm.createContext({
    requirePermission_(){},activeRows_:()=>rows,safeDateOnly_:s=>s,sanitizeInput_:s=>String(s||''),
    getExpensePayeesForUI_:()=>[],getSettingsMap_:()=>({'Currency Symbol':'৳'}),
    EXPENSE_PAYMENT_METHODS:['Cash','Bank','Other'],
    ok_:data=>({success:true,data}),fail_:message=>({success:false,message}),logError_(){}
  });
  vm.runInContext(fs.readFileSync(path.join(root,'Expense.gs'),'utf8'),ctx);
  const res=ctx.getExpenseLedger('token',{dateFrom:'2026-10-01',dateTo:'2026-10-31'});
  assert.equal(res.success,true);assert.equal(res.data.filteredTotal,100);
  assert.equal(res.data.rows.filter(x=>x.status!=='Cancelled').length,2);
});


test('recent detail table caps at 25 but selected total and entries include all matching expenses',async()=>{
  const rows=Array.from({length:30},(_,i)=>row('item'+i,'2026-11-05',10,'Rent'));
  const p=setup(()=>({rows,filteredTotal:300}));
  await p.ctx.expRepLoad();
  assert.equal(p.get('expRepPeriodTotal').textContent,'৳300');
  assert.equal(p.get('expRepPeriodCount').textContent,30);
  assert.equal(p.get('expRepDetailBody').children.length,25);
  assert.equal(p.get('expRepDetailCount').textContent,'Showing 25 of 30 entries');
});
