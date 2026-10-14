'use strict';
// ERP-wide zero-prefilled numeric field behavior, tested through delegated DOM events.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'javascript.html'), 'utf8');
const start = source.indexOf('  // BEGIN ERP ZERO AMOUNT ENTRY');
const end = source.indexOf('  // END ERP ZERO AMOUNT ENTRY', start);
const delegate = start < 0 || end < 0 ? '' : source.slice(start, end);

function setup() {
  assert.ok(delegate, 'Shared ERP numeric-entry behavior must exist in javascript.html');
  const listeners = Object.create(null);
  const document = { addEventListener(type, listener, capture) {
    assert.equal(capture, true, 'Keep delegated handlers before module listeners');
    (listeners[type] ||= []).push(listener);
  }};
  vm.runInNewContext(delegate, { document, WeakMap });
  return { dispatch(type, target, fields={}) {
    for (const fn of listeners[type] || []) fn({ type, target, ...fields });
  }};
}
function number(value='0', opts={}) {
  return {
    tagName:'INPUT', type:'number', value, min:opts.min ?? '0',
    disabled:!!opts.disabled, readOnly:!!opts.readOnly,
    getAttribute(name) {
      return name === 'data-erp-keep-zero' ? (opts.keepZero ? 'true' : null) :
        name === 'aria-readonly' ? (opts.ariaReadonly ? 'true' : null) : null;
    }
  };
}
test('preset zero is ready for typing, including decimal values', () => {
  const ui=setup();const el=number();
  ui.dispatch('focusin',el);assert.equal(el.value,'');
  el.value='500.25';ui.dispatch('input',el);ui.dispatch('blur',el);
  assert.equal(el.value,'500.25');
});
test('untouched zero is restored on blur and before Enter workflows', () => {
  const ui=setup();const el=number();ui.dispatch('focusin',el);
  assert.equal(el.value,'');ui.dispatch('keydown',el,{key:'Enter'});
  assert.equal(el.value,'0');ui.dispatch('blur',el);assert.equal(el.value,'0');
  const next=number();ui.dispatch('focusin',next);ui.dispatch('blur',next);
  assert.equal(next.value,'0');
});
test('intentionally cleared entry is not silently changed to zero', () => {
  const ui=setup();const el=number();ui.dispatch('focusin',el);
  el.value='50';ui.dispatch('input',el);
  el.value='';ui.dispatch('input',el);ui.dispatch('blur',el);
  assert.equal(el.value,'');
});
test('nonzero, positive-min, read-only, disabled, and opted-out fields are untouched', () => {
  const ui=setup();
  for(const el of [number('1250'),number('0',{min:'1'}),number('0',{readOnly:true}),
    number('0',{disabled:true}),number('0',{keepZero:true}),number('0',{ariaReadonly:true})]){
    const before=el.value;ui.dispatch('focusin',el);assert.equal(el.value,before);
  }
});
test('delegation supports dynamic fields and native spinner input events', () => {
  const ui=setup();const el=number();
  ui.dispatch('focusin',el);el.value='1';ui.dispatch('input',el);
  ui.dispatch('blur',el);assert.equal(el.value,'1');
});
