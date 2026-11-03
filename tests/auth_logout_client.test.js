'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the real browser sign-out function. Only the remote RPC, toast,
// localStorage boundary and location.reload are substituted.
const source = fs.readFileSync(path.join(__dirname, '..', 'javascript.html'), 'utf8');
const start = source.indexOf('  function doLogout_() {');
const end = source.indexOf('  function showLogin_() {', start);
assert.ok(start !== -1 && end > start, 'shared doLogout_ source must be present');
const logoutSource = source.slice(start, end);

function harness(serverResult) {
  const cleared = [], reloaded = [], toasts = [], calls = [];
  const c = vm.createContext({
    authToken: 'live-session-token',
    currentUser: {id:'staff', role:'Staff'},
    allowedModules: ['pos'],
    userPermissions: {pos:{view:true}},
    clearStoredToken_() { cleared.push(true); },
    serverCall(name, token) {
      calls.push([name, token]);
      return serverResult;
    },
    showToast(message, type) { toasts.push({message, type}); },
    window: {location:{reload() { reloaded.push(true); }}}
  });
  vm.runInContext(logoutSource, c, {filename:'javascript.html:doLogout_'});
  return {c, cleared, reloaded, toasts, calls};
}

test('failed logout RPC retains the token and does not falsely claim sign-out', async () => {
  const h = harness(Promise.reject(new Error('Network unavailable')));
  await h.c.doLogout_();
  await new Promise(setImmediate);
  assert.equal(h.c.authToken, 'live-session-token');
  assert.equal(h.c.currentUser.id, 'staff');
  assert.equal(h.cleared.length, 0);
  assert.equal(h.reloaded.length, 0);
  assert.equal(h.calls.length, 1);
  assert.equal(h.toasts.length, 1);
  assert.equal(h.toasts[0].type, 'error');
});

test('successful logout RPC clears local token and reloads once', async () => {
  const h = harness(Promise.resolve('logged out'));
  await h.c.doLogout_();
  await new Promise(setImmediate);
  assert.equal(h.c.authToken, '');
  assert.equal(h.c.currentUser, null);
  assert.equal(h.cleared.length, 1);
  assert.equal(h.reloaded.length, 1);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][0], 'logout');
  assert.equal(h.calls[0][1], 'live-session-token');
});
