'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const pos = fs.readFileSync(path.join(__dirname, '..', 'pos.html'), 'utf8');
const begin = pos.indexOf('  var posProfitRequestSequence_ = 0;');
const end = pos.indexOf('  function posRecalcTotals_() {', begin);
assert.ok(begin >= 0 && end > begin, 'POS profit preview function must exist');
const source = pos.slice(begin, end);

function environment(canViewProfit = true) {
  const nodes = new Map();
  const element = id => {
    if (!nodes.has(id)) nodes.set(id, {
      id, hidden:true, style:{display:'none'}, textContent:'', value:'', title:''
    });
    return nodes.get(id);
  };
  const timers = [], pending = [], calls = [];
  let lastTimer = 0;
  const state = {
    canViewProfit,
    cart:[{productId:'P',name:'Product P',qty:1,unitPrice:30,lineTotal:30,
      priceMode:'manual',vendorId:'',vendorUnitCost:'',bundleRevision:0}]
  };
  element('posDiscount').value='0';
  const c = vm.createContext({
    document:{getElementById:element},
    posState:state,authToken:'staff',
    setTimeout(fn){timers.push(fn);return ++lastTimer;},
    clearTimeout(){},
    serverCall(name,token,payload){
      calls.push({name,token,payload});
      return new Promise((resolve,reject)=>pending.push({resolve,reject}));
    },
    formatMoney:value=>'৳'+Number(value).toFixed(2)
  });
  vm.runInContext(source,c);
  return {c,state,element,timers,pending,calls,fire(i){timers[i]();}};
}

test('a POS user without profit rights never requests or displays a profit amount',()=>{
  const h = environment(false);
  h.c.posScheduleProfitPreview_();
  assert.equal(h.calls.length,0);
  assert.equal(h.timers.length,0);
  assert.equal(h.element('posCurrentInvoiceProfitRow').hidden,true);
  assert.equal(h.element('posCurrentInvoiceProfitWarning').hidden,true);
});

test('profit preview uses the latest cart response and never paints a stale estimate',async()=>{
  const h = environment();
  h.c.posScheduleProfitPreview_();
  h.fire(0);
  assert.equal(h.calls.length,1);
  h.state.cart[0].qty=2;
  h.state.cart[0].lineTotal=60;
  h.c.posScheduleProfitPreview_();
  h.fire(1);
  assert.equal(h.calls.length,2);

  h.pending[1].resolve({profit:20,marginPercent:33.33,costComplete:true});
  await new Promise(setImmediate);
  assert.equal(h.element('posCurrentInvoiceProfit').textContent,'৳20.00 (33.3%)');
  h.pending[0].resolve({profit:999,marginPercent:90,costComplete:true});
  await new Promise(setImmediate);
  assert.equal(h.element('posCurrentInvoiceProfit').textContent,'৳20.00 (33.3%)');

  h.state.cart=[];
  h.c.posScheduleProfitPreview_();
  assert.equal(h.element('posCurrentInvoiceProfitRow').hidden,true);
  assert.equal(h.element('posCurrentInvoiceProfitWarning').hidden,true);
});

test('incomplete FIFO/vendor costs show a visible accuracy warning, not just a tooltip',async()=>{
  const h=environment();
  h.c.posScheduleProfitPreview_();
  h.fire(0);
  h.pending[0].resolve({profit:25,marginPercent:83.3,costComplete:false});
  await new Promise(setImmediate);
  const warning=h.element('posCurrentInvoiceProfitWarning');
  assert.equal(warning.hidden,false);
  assert.match(warning.textContent,/cost incomplete/i);
  h.c.posScheduleProfitPreview_();
  h.fire(1);
  h.pending[1].resolve({profit:15,marginPercent:50,costComplete:true});
  await new Promise(setImmediate);
  assert.equal(warning.hidden,true);
});
