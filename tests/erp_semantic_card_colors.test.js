'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const js = fs.readFileSync('javascript.html', 'utf8');
const css = fs.readFileSync('style.html', 'utf8');
const htmls = [
  'dashboard.html','finance.html','bank.html','daybook.html',
  'cashReconciliation.html','expenseList.html','expenseReport.html',
  'reports.html','customers.html','suppliers.html',
  'vendorWorkspace.html','counter.html','pos.html','returns.html'
];
const ui = htmls.map(path => fs.readFileSync(path, 'utf8')).join('\n');
const feature = js.slice(js.indexOf('  // ERP-wide visual semantics for cards/balances.'));
assert.match(feature, /function initErpSemanticCards_\(/);

function harness(elements) {
  const hooks = [];
  const byId = {};
  function makeNode(id, text, parent) {
    const classSet = new Set();
    const node = {
      id, textContent:text, hidden:false, dataset:{}, parentElement:parent || null,
      children:[], classList: {
        add: (...classes) => classes.forEach(c => classSet.add(c)),
        remove: (...classes) => classes.forEach(c => classSet.delete(c)),
        contains: c => classSet.has(c)
      },
      appendChild(child) { this.children.push(child); child.parentElement=this; },
      closest(selector) { return selector === '.stat-card' ? this.parentElement : null; }
    };
    return node;
  }
  Object.entries(elements || {}).forEach(([id, item]) => {
    const parent = makeNode(id + 'Card', '', null);
    byId[id] = makeNode(id, item, parent);
  });
  const context = {
    document:{
      getElementById: id => byId[id] || null,
      createElement: tag => makeNode(tag, '', null)
    },
    MutationObserver:class {
      constructor(cb) { this.cb=cb; }
      observe(node,opts) { hooks.push({node,cb:this.cb,opts}); }
    }
  };
  vm.createContext(context);
  vm.runInContext(feature.replace(/<\/script>[\s\S]*$/, ''),context);
  return {context,byId,hooks};
}

test('the explicit semantic-card configuration covers only real existing IDs', () => {
  const {context} = harness({});
  for (const [setName,cardOnly] of [
    ['ERP_SEMANTIC_CARDS_',true],
    ['ERP_SEMANTIC_DETAILS_',false],
    ['ERP_SEMANTIC_INLINE_',false]
  ]) {
    const map = context[setName];
    assert.ok(map && Object.keys(map).length > 0, setName);
    for (const id of Object.keys(map)) {
      assert.match(ui, new RegExp('id=["\\\']' + id + '["\\\']'), id);
      if (cardOnly) {
        const line = ui.split('\n').find(s => s.includes('id="' + id + '"'));
        assert.match(line, /class="stat-card"/, id);
      }
    }
  }
});

test('customer due red, supplier payable red, signed cash and profit follow their sign', () => {
  const {context:c} = harness({});
  assert.equal(c.erpSemanticTone_(c.ERP_SEMANTIC_CARDS_.dashDue, '৳15,000'), 'negative');
  assert.equal(c.erpSemanticTone_(c.ERP_SEMANTIC_CARDS_.rsDue, '৳15,000'), 'negative');
  assert.equal(c.erpSemanticLabel_(c.ERP_SEMANTIC_CARDS_.dashDue, 'negative'), 'To Receive');
  assert.equal(c.erpSemanticTone_(c.ERP_SEMANTIC_INLINE_.counterCustomerDue, '৳500'), 'negative');
  assert.equal(c.erpSemanticTone_(c.ERP_SEMANTIC_INLINE_.posDueAmountDisplay, '৳500'), 'negative');
  assert.equal(c.erpSemanticTone_(c.ERP_SEMANTIC_INLINE_.counterCustomerAdvance, '৳200'), 'positive');
  assert.equal(c.erpSemanticTone_(c.ERP_SEMANTIC_INLINE_.counterAdvanceRefundAvailable, '৳200'), 'positive');
  assert.equal(c.erpSemanticTone_(c.ERP_SEMANTIC_CARDS_.dashPayable, '৳5,000'), 'negative');
  assert.equal(c.erpSemanticTone_(c.ERP_SEMANTIC_CARDS_.dashCash, '৳-50'), 'negative');
  assert.equal(c.erpSemanticTone_(c.ERP_SEMANTIC_CARDS_.rfNet, '৳1,250.75'), 'positive');
  assert.equal(c.erpSemanticTone_(c.ERP_SEMANTIC_CARDS_.rfNet, '৳-120'), 'negative');
  assert.equal(c.erpSemanticLabel_(c.ERP_SEMANTIC_CARDS_.dashPayable, 'negative'), 'To Pay');
});

test('money flow types are accurate; purchase totals are not falsely called money out', () => {
  const {context:c} = harness({});
  assert.equal(c.erpSemanticLabel_(c.ERP_SEMANTIC_CARDS_.rcIn, 'positive'), 'Money In');
  assert.equal(c.erpSemanticLabel_(c.ERP_SEMANTIC_CARDS_.rcOut, 'negative'), 'Money Out');
  assert.equal(c.erpSemanticLabel_(c.ERP_SEMANTIC_CARDS_.rpGross, 'negative'), 'Purchases');
  assert.ok(!Object.prototype.hasOwnProperty.call(c.ERP_SEMANTIC_CARDS_,'dashPurchase'));
  assert.ok(!Object.prototype.hasOwnProperty.call(c.ERP_SEMANTIC_CARDS_,'bnkLedOpening'));
});

test('zero and unset, Bangla digits, and accounting negatives are handled', () => {
  const {context:c} = harness({});
  assert.equal(c.erpSemanticAmount_('৳১২,৩৪৫.৫০'), 12345.5);
  assert.equal(c.erpSemanticAmount_('৳−৯০'), -90);
  assert.equal(c.erpSemanticAmount_('৳(300)'), -300);
  assert.equal(c.erpSemanticAmount_('--'), null);
  assert.equal(c.erpSemanticTone_(c.ERP_SEMANTIC_CARDS_.dashDue, '৳0'), 'neutral');
  assert.equal(c.erpSemanticTone_(c.ERP_SEMANTIC_CARDS_.rkLow, '7'), 'negative');
  assert.equal(c.erpSemanticTone_(c.ERP_SEMANTIC_CARDS_.rkLow, '0'), 'neutral');
});

test('party details correctly invert named customer/supplier credit', () => {
  const {context:c} = harness({});
  assert.equal(c.erpSemanticTone_(c.ERP_SEMANTIC_DETAILS_.custDetailDue, '৳200'), 'negative');
  assert.equal(c.erpSemanticTone_(c.ERP_SEMANTIC_DETAILS_.custDetailDue, 'Credit ৳200'), 'positive');
  assert.equal(c.erpSemanticLabel_(c.ERP_SEMANTIC_DETAILS_.custDetailDue, 'negative'), 'To Receive');
  assert.equal(c.erpSemanticLabel_(c.ERP_SEMANTIC_DETAILS_.custDetailDue, 'positive'), 'Credit to Refund');
  assert.equal(c.erpSemanticTone_(c.ERP_SEMANTIC_DETAILS_.supDetailDue, '৳200'), 'negative');
  assert.equal(c.erpSemanticTone_(c.ERP_SEMANTIC_DETAILS_.supDetailDue, 'Credit ৳200'), 'positive');
  assert.equal(c.erpSemanticLabel_(c.ERP_SEMANTIC_DETAILS_.supDetailDue,'positive'),'Credit Available');
});

test('card updates when amount changes, not when note is painted; zero removes old status', () => {
  const {context,byId,hooks} = harness({dashDue:'--'});
  context.initErpSemanticCards_();
  const el=byId.dashDue,host=el.parentElement,notice=host.children[0];
  assert.ok(host.classList.contains('erp-semantic--neutral'));
  assert.equal(notice.hidden, true);
  el.textContent='৳500';
  hooks.find(h => h.node === el).cb();
  assert.ok(host.classList.contains('erp-semantic--negative'));
  assert.equal(notice.textContent,'To Receive');
  assert.equal(notice.hidden,false);
  el.textContent='৳0';
  hooks.find(h => h.node === el).cb();
  assert.ok(host.classList.contains('erp-semantic--neutral'));
  assert.equal(notice.hidden,true);
  assert.equal(hooks.length,1);
  context.initErpSemanticCards_();
  assert.equal(hooks.length,1,'double init must not duplicate observers');
});

test('styles are scoped to semantic cards and preserve all ledger table rendering', () => {
  assert.match(css, /\.erp-semantic-card\.erp-semantic--positive/);
  assert.match(css, /\.erp-semantic-card\.erp-semantic--negative/);
  assert.match(css, /--color-success/);
  assert.match(css, /--color-danger/);
  assert.match(js, /initErpSemanticCards_\(\);/);
  assert.doesNotMatch(feature, /serverCall\(|getSheet_|save|updateFinanceTransaction/);
});
