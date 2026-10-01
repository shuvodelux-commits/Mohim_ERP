const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const js = fs.readFileSync('javascript.html', 'utf8');
const css = fs.readFileSync('style.html', 'utf8');

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...names) { names.forEach(n => this.values.add(n)); }
  remove(...names) { names.forEach(n => this.values.delete(n)); }
  toggle(name, force) {
    if (force === undefined) force = !this.values.has(name);
    if (force) this.values.add(name); else this.values.delete(name);
    return !!force;
  }
  contains(name) { return this.values.has(name); }
}

class FakeElement {
  constructor(doc, id, tagName = 'div') {
    this.ownerDocument = doc;
    this.id = id || '';
    this.tagName = tagName.toUpperCase();
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.textContent = '';
    this.innerHTML = '';
    this.placeholder = '';
    this.maxLength = 0;
    this.style = {};
    this.classList = new FakeClassList();
    this.children = [];
    this.listeners = {};
    this.isConnected = true;
    this.offsetParent = {};
    this.dataset = {};
    this.attributes = {};
    this._className = '';
  }
  set className(value) { this._className = String(value || ''); }
  get className() { return this._className; }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value); }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; }
  appendChild(child) { this.children.push(child); return child; }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  dispatch(type, event = {}) {
    event.target ||= this;
    event.currentTarget = this;
    for (const handler of this.listeners[type] || []) handler(event);
  }
  focus() { this.ownerDocument.activeElement = this; this.focusCount = (this.focusCount || 0) + 1; }
  querySelector(selector) {
    if (selector === '.confirm-action-dialog') return this.ownerDocument.elements.confirmActionDialog;
    return null;
  }
  querySelectorAll() {
    return [
      this.ownerDocument.elements.confirmActionClose,
      this.ownerDocument.elements.confirmActionReason,
      this.ownerDocument.elements.confirmActionCancel,
      this.ownerDocument.elements.confirmActionConfirm
    ].filter(el => el && !el.hidden && !el.disabled);
  }
}

class FakeDocument {
  constructor() {
    this.elements = {};
    this.activeElement = null;
    this.listeners = {};
    this.body = new FakeElement(this, 'body', 'body');
    this._make('confirmActionModal');
    this._make('confirmActionDialog');
    this._make('confirmActionTitle', 'h3');
    this._make('confirmActionMessage', 'p');
    this._make('confirmActionDetails');
    this._make('confirmActionReasonRow', 'label').hidden = true;
    this._make('confirmActionReasonLabel', 'span');
    this._make('confirmActionReason', 'textarea');
    this._make('confirmActionReasonError', 'span');
    this._make('confirmActionCancel', 'button');
    this._make('confirmActionConfirm', 'button');
    this._make('confirmActionClose', 'button');
    this.elements.confirmActionModal.hidden = true;
  }
  _make(id, tag = 'div') { const el = new FakeElement(this, id, tag); this.elements[id] = el; return el; }
  getElementById(id) { return this.elements[id] || null; }
  createElement(tag) { return new FakeElement(this, '', tag); }
  querySelector(selector) {
    if (selector === '#confirmActionModal .confirm-action-dialog') return this.elements.confirmActionDialog;
    return null;
  }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  dispatchKey(event) {
    event.prevented = false;
    event.stopped = false;
    event.preventDefault ||= function () { this.prevented = true; };
    event.stopPropagation ||= function () { this.stopped = true; };
    for (const handler of this.listeners.keydown || []) handler(event);
    return event;
  }
}

function makeHarness() {
  const document = new FakeDocument();
  const timers = [];
  const context = { document, console, Promise, setTimeout(fn) { timers.push(fn); return timers.length; } };
  vm.createContext(context);
  const start = js.indexOf('// ---------------- Global confirmation safety layer ----------------');
  const end = js.indexOf('function selectedOptionText_', start);
  assert.ok(start >= 0 && end > start, 'confirmation implementation must be extractable');
  vm.runInContext(js.slice(start, end), context);
  return {
    context,
    document,
    flushTimers() { while (timers.length) timers.shift()(); },
    event(key, timeStamp = Date.now()) {
      return { key, timeStamp, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
    }
  };
}

async function microtasks() { await Promise.resolve(); await Promise.resolve(); }

(async function run() {
  // Initial focus + deliberate second Enter. The opening key event is consumed.
  {
    const h = makeHarness();
    const trigger = new FakeElement(h.document, 'trigger', 'button');
    trigger.focus();
    const openingEvent = h.event('Enter', 101);
    const promise = h.context.confirmAction({ title: 'Receive?', trigger, openingEvent });
    assert.equal(h.document.activeElement, trigger, 'confirm is focused on the next event cycle, not synchronously');
    h.flushTimers();
    assert.equal(h.document.activeElement, h.document.elements.confirmActionConfirm, 'Confirm gets initial focus');
    h.document.dispatchKey(openingEvent);
    assert.ok(h.context.confirmActionState_, 'the same opening Enter must not confirm');
    h.document.dispatchKey(h.event('Enter', 102));
    assert.deepEqual(await promise, { confirmed: true, reason: '' }, 'a deliberate second Enter confirms');
    assert.equal(h.context.confirmActionState_, null, 'dialog resolves exactly once');
  }

  // Esc cancels before posting and returns focus to the trigger.
  {
    const h = makeHarness();
    const trigger = new FakeElement(h.document, 'trigger', 'button');
    const promise = h.context.confirmAction({ title: 'Cancel?', trigger });
    h.flushTimers();
    h.document.dispatchKey(h.event('Escape', 201));
    assert.deepEqual(await promise, { confirmed: false, reason: '' });
    assert.equal(h.document.activeElement, trigger, 'Cancel must restore trigger focus');
  }

  // Whitespace-only required reason blocks confirmation.
  {
    const h = makeHarness();
    const promise = h.context.confirmAction({ title: 'Delete?', type: 'danger', reason: { required: true } });
    h.flushTimers();
    h.document.elements.confirmActionReason.value = '   ';
    h.document.dispatchKey(h.event('Enter', 301));
    assert.ok(h.context.confirmActionState_, 'blank required reason must keep dialog open');
    assert.equal(h.document.elements.confirmActionReasonError.style.display, 'block');
    assert.equal(h.document.activeElement, h.document.elements.confirmActionReason);
    h.document.elements.confirmActionReason.value = 'duplicate entry';
    h.document.elements.confirmActionConfirm.focus();
    h.document.dispatchKey(h.event('Enter', 302));
    assert.deepEqual(await promise, { confirmed: true, reason: 'duplicate entry' });
  }

  // Pending state blocks all duplicate submission/cancel routes, then the next
  // dialog must start with clean enabled controls.
  {
    const h = makeHarness();
    let resolveRunner;
    let runnerCalls = 0;
    const runnerPromise = new Promise(resolve => { resolveRunner = resolve; });
    const promise = h.context.runConfirmedAction({ title: 'Receive?', loadingLabel: 'Receiving...' }, () => {
      runnerCalls += 1;
      return runnerPromise;
    });
    h.flushTimers();
    h.document.elements.confirmActionConfirm.dispatch('click', h.event('click', 401));
    await microtasks();
    assert.equal(runnerCalls, 1, 'native runner starts once');
    assert.equal(h.context.confirmActionState_.pending, true);
    assert.equal(h.document.elements.confirmActionConfirm.disabled, true);
    assert.equal(h.document.elements.confirmActionCancel.disabled, true);
    assert.equal(h.document.elements.confirmActionClose.disabled, true);

    h.document.elements.confirmActionConfirm.dispatch('click', h.event('click', 402));
    h.document.elements.confirmActionCancel.dispatch('click', h.event('click', 403));
    h.document.elements.confirmActionModal.dispatch('click', { target: h.document.elements.confirmActionModal });
    h.document.dispatchKey(h.event('Escape', 404));
    h.document.dispatchKey(h.event('Enter', 405));
    await microtasks();
    assert.equal(runnerCalls, 1, 'pending dialog must never run the mutation twice');
    assert.ok(h.context.confirmActionState_, 'Cancel/Esc/backdrop are locked while pending');

    resolveRunner('posted');
    assert.equal(await promise, 'posted');
    assert.equal(h.context.confirmActionState_, null);

    const second = h.context.confirmAction({ title: 'Next action' });
    h.flushTimers();
    assert.equal(h.document.elements.confirmActionConfirm.disabled, false, 'new dialog Confirm must be enabled');
    assert.equal(h.document.elements.confirmActionCancel.disabled, false, 'new dialog Cancel must be enabled');
    assert.equal(h.document.elements.confirmActionClose.disabled, false, 'new dialog Close must be enabled');
    h.document.dispatchKey(h.event('Escape', 406));
    await second;
  }

  // Failure rejects, preserves caller-owned source data, and restores focus so
  // the user can correct the original form.
  {
    const h = makeHarness();
    const trigger = new FakeElement(h.document, 'trigger', 'button');
    const source = { customer: 'Shuvo', amount: '5000' };
    const expected = new Error('server rejected payment');
    const promise = h.context.runConfirmedAction({ title: 'Receive?', trigger }, () => Promise.reject(expected));
    h.flushTimers();
    h.document.elements.confirmActionConfirm.dispatch('click', h.event('click', 501));
    await assert.rejects(promise, /server rejected payment/);
    assert.deepEqual(source, { customer: 'Shuvo', amount: '5000' }, 'confirmation failure must not mutate source form state');
    assert.equal(h.document.activeElement, trigger, 'runner failure returns focus to original trigger');
  }

  // Focus trap cycles at the edges.
  {
    const h = makeHarness();
    const promise = h.context.confirmAction({ title: 'Trap focus', reason: { required: true } });
    h.flushTimers();
    const first = h.document.elements.confirmActionClose;
    const last = h.document.elements.confirmActionConfirm;
    first.focus();
    h.document.dispatchKey({ ...h.event('Tab', 601), shiftKey: true });
    assert.equal(h.document.activeElement, last, 'Shift+Tab from first wraps to last');
    last.focus();
    h.document.dispatchKey({ ...h.event('Tab', 602), shiftKey: false });
    assert.equal(h.document.activeElement, first, 'Tab from last wraps to first');
    h.document.dispatchKey(h.event('Escape', 603));
    await promise;
  }

  // Responsive/mobile and non-color severity contract.
  assert.match(css, /@media\s*\(max-width:\s*540px\)[\s\S]*?\.confirm-action-overlay\s*\{[^}]*align-items\s*:\s*flex-end/i,
    'mobile confirmation must render as a bottom sheet');
  assert.match(css, /@media\s*\(max-width:\s*540px\)[\s\S]*?\.confirm-action-footer\s*\{[^}]*position\s*:\s*sticky/i,
    'mobile confirmation actions must remain sticky');
  assert.match(js, /data-confirm-kind|confirmKind/i,
    'dialog must expose a textual severity cue, not color alone');
  assert.match(css, /content\s*:\s*attr\(data-confirm-kind\)/i,
    'severity cue must be visibly rendered in text');

  console.log('confirmation_acceptance: PASS');
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
