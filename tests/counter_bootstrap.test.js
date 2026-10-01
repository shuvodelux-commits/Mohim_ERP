const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
function test(name, fn){ try{ fn(); console.log('PASS '+name); } catch(e){ console.error('FAIL '+name+'\n'+e.stack); process.exitCode=1; } }

const source = fs.existsSync('Counter.gs') ? fs.readFileSync('Counter.gs','utf8') : '';

test('Counter.gs is read-only and exposes only bootstrap/party refresh reads', () => {
  assert(source.length > 0, 'Counter.gs missing');
  assert.match(source, /function getCounterBootstrap\s*\(/);
  assert.match(source, /function getCounterCustomers\s*\(/);
  assert.match(source, /function getCounterSuppliers\s*\(/);
  ['appendRow_','updateRowFields_','addCashBookEntry_','addBankBookEntry_','receivePayment','paySupplier','addExpense','transferBetweenBankAccounts'].forEach(name => {
    assert(!new RegExp('\\b'+name+'\\s*\\(').test(source), name+' must not be called from Counter.gs');
  });
});

function load(permissionMap){
  const rows = {
    CUSTOMERS: [
      {'Customer ID':'C1','Customer Name':'Rahim','Phone':'0171','Current Due':2500,'Status':'Active','Is Deleted':''},
      {'Customer ID':'C2','Customer Name':'Inactive','Phone':'0181','Current Due':100,'Status':'Inactive','Is Deleted':''},
      {'Customer ID':'C3','Customer Name':'Deleted','Phone':'0191','Current Due':100,'Status':'Active','Is Deleted':'TRUE'}
    ],
    SUPPLIERS: [
      {'Supplier ID':'S1','Supplier Name':'ABC','Phone':'0161','Current Due':3000,'Status':'Active','Is Deleted':''},
      {'Supplier ID':'S2','Supplier Name':'Off','Phone':'0151','Current Due':5,'Status':'Inactive','Is Deleted':''}
    ],
    EXPENSE_CATEGORIES: [
      {'Category ID':'E1','Category Name':'Transport','Status':'Active'},
      {'Category ID':'E2','Category Name':'Old','Status':'Inactive'}
    ]
  };
  const calls=[];
  const ctx = {
    console,
    EXPENSE_PAYMENT_METHODS:['Cash','Bank','Mobile Banking','Other'],
    getSessionUser_: () => ({Role:'Cashier'}),
    hasPermission_: (_u,m,a) => !!(permissionMap[m] && permissionMap[m][a]),
    getAllRows_: (sheet) => { calls.push(sheet); return rows[sheet] || []; },
    isDeleted_: (r) => r && (r['Is Deleted']===true || String(r['Is Deleted']||'').toUpperCase()==='TRUE'),
    getActiveBankAccountsForUI_: () => [{id:'B1',name:'Main Bank',type:'Bank'},{id:'M1',name:'Bkash',type:'Mobile Banking'}],
    getExpensePayeesForUI_: () => [{id:'P1',name:'Landlord',phone:'011'}],
    getSettingsMap_: () => ({'Currency Symbol':'৳'}),
    formatDate_: () => '2026-09-04',
    ok_: (data) => ({success:true,data}),
    fail_: (message) => ({success:false,message}),
    logError_: () => {}
  };
  vm.createContext(ctx); vm.runInContext(source, ctx);
  return {ctx,calls};
}

test('bootstrap returns exact action capabilities and lightweight permitted datasets', () => {
  const {ctx} = load({customers:{edit:true,add:true},suppliers:{edit:true,add:false},expense:{add:true},bank:{add:true},settlementDiscount:{edit:true}});
  const res = ctx.getCounterBootstrap('t');
  assert.equal(res.success,true);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(res.data.capabilities)), {
    customerReceive:true, customerAdd:true, supplierPay:true, supplierAdd:false,
    expenseAdd:true, bankTransfer:true, settlementDiscount:true
  });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(res.data.customers)), [{id:'C1',name:'Rahim',phone:'0171',due:2500}]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(res.data.suppliers)), [{id:'S1',name:'ABC',phone:'0161',payable:3000}]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(res.data.expenseCategories)), [{id:'E1',name:'Transport'}]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(res.data.expensePayees)), [{id:'P1',name:'Landlord',phone:'011'}]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(res.data.paymentAccounts)), [{id:'B1',name:'Main Bank',type:'Bank'},{id:'M1',name:'Bkash',type:'Mobile Banking'}]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(res.data.expensePaymentMethods)), ['Cash','Bank','Mobile Banking','Other']);
  assert.equal(res.data.currencySymbol,'৳');
  assert.equal(res.data.businessDate,'2026-09-04');
});

test('bootstrap does not read datasets for unavailable transaction types', () => {
  const {ctx,calls} = load({bank:{add:true}});
  const res = ctx.getCounterBootstrap('t');
  assert.equal(res.success,true);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(res.data.customers)), []);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(res.data.suppliers)), []);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(res.data.expenseCategories)), []);
  assert(!calls.includes('CUSTOMERS'));
  assert(!calls.includes('SUPPLIERS'));
  assert(!calls.includes('EXPENSE_CATEGORIES'));
  assert.equal(res.data.transferAccounts.length,2);
});

test('party refresh endpoints require posting/add capability and return active lightweight rows', () => {
  let x=load({customers:{edit:true}}); let r=x.ctx.getCounterCustomers('t');
  assert.equal(r.success,true); assert.deepStrictEqual(JSON.parse(JSON.stringify(r.data)), [{id:'C1',name:'Rahim',phone:'0171',due:2500}]);
  x=load({suppliers:{add:true}}); r=x.ctx.getCounterSuppliers('t');
  assert.equal(r.success,true); assert.deepStrictEqual(JSON.parse(JSON.stringify(r.data)), [{id:'S1',name:'ABC',phone:'0161',payable:3000}]);
  x=load({}); r=x.ctx.getCounterCustomers('t'); assert.equal(r.success,false);
});

if (!process.exitCode) console.log('4/4 passed');
