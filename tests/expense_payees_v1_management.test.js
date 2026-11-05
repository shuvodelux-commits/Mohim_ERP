'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('expensePayees.html','utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
function setup(){
  const map=new Map(),calls=[],dialogs=[],deletes=[];
  const get=id=>{
    if(!map.has(id))map.set(id,{
      value:'',textContent:'',hidden:true,disabled:false,children:[],listeners:{},dataset:{},
      set innerHTML(value){this._html=String(value);this.children=[]},get innerHTML(){return this._html||''},
      addEventListener(k,f){this.listeners[k]=f},appendChild(n){this.children.push(n)},focus(){}
    });
    return map.get(id);
  };
  const list=[
    {id:'P1',name:'Electricity',phone:'0171',notes:'Power',status:'Active'},
    {id:'P2',name:'<img src=x>',phone:'0181',notes:'',status:'Inactive'}
  ];
  const serverCall=(name,token,...args)=>{
    calls.push({name,args});
    if(name==='getExpensePayeesManagement')return Promise.resolve(list);
    if(name==='updateExpensePayee'){list[0]={...list[0],...args[1]};return Promise.resolve({id:'P1'});}
    if(name==='addExpensePayee'){list.push({id:'P3',status:'Active',...args[0]});return Promise.resolve({id:'P3'});}
    if(name==='setExpensePayeeStatus'){const row=list.find(r=>r.id===args[0]);row.status=args[1];return Promise.resolve({id:row.id});}
    return Promise.reject(Error('Unexpected RPC: '+name));
  };
  const doc={getElementById:get,createElement:()=>({innerHTML:''}),addEventListener(){}};
  const cx=vm.createContext({
    document:doc,authToken:'token',serverCall,withLoader:p=>p,
    escapeHtml:x=>String(x??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),
    openModal:id=>dialogs.push(id),closeModal:id=>dialogs.push('close:'+id),
    showToast(){},reloadPage_(){},confirmDelete:opts=>deletes.push(opts),Promise
  });
  vm.runInContext(script,cx);
  return {cx,get,calls,dialogs,deletes,list};
}
test('payees screen loads active and inactive rows and escapes untrusted names',async()=>{
  const p=setup();await p.cx.exPayLoad();
  assert.equal(p.calls[0].name,'getExpensePayeesManagement');
  assert.equal(p.get('exPayBody').children.length,2);
  const table=p.get('exPayBody').children.map(x=>x.innerHTML).join(' ');
  assert.match(table,/Electricity/);assert.match(table,/Inactive/);
  assert.match(table,/&lt;img src=x&gt;/);assert.doesNotMatch(table,/<img src=x>/);
});
test('payee manager filters without altering server records',async()=>{
  const p=setup();await p.cx.exPayLoad();
  p.get('exPayStatus').value='Inactive';p.cx.exPayRender_();
  assert.equal(p.get('exPayBody').children.length,1);
  assert.equal(p.list.length,2);
});
test('payee editor uses existing authorized add and update RPCs',async()=>{
  const p=setup();await p.cx.exPayLoad();
  p.cx.exPayOpen_(p.list[0]);
  p.get('exPayName').value='Updated Landlord';
  await p.cx.exPaySave_();
  assert.ok(p.calls.some(c=>c.name==='updateExpensePayee'&&c.args[0]==='P1'&&c.args[1].name==='Updated Landlord'));
  p.cx.exPayOpen_(null);
  p.get('exPayName').value='New Supplier';
  await p.cx.exPaySave_();
  assert.ok(p.calls.some(c=>c.name==='addExpensePayee'&&c.args[0].name==='New Supplier'));
});
test('payee status and delete actions keep existing permission-checked backend',async()=>{
  const p=setup();await p.cx.exPayLoad();
  await p.cx.exPayToggle_(p.list[0]);
  assert.ok(p.calls.some(c=>c.name==='setExpensePayeeStatus'&&c.args[0]==='P1'&&c.args[1]==='Inactive'));
  p.cx.exPayDelete_(p.list[0]);
  assert.equal(p.deletes.length,1);
  assert.equal(p.deletes[0].fn,'deleteExpensePayee');
  assert.equal(p.deletes[0].args[0],'P1');
});
