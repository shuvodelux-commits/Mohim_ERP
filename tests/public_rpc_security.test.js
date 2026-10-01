const fs = require('fs');
const assert = require('assert');

const files = fs.readdirSync('.').filter(f => f.endsWith('.gs'));
const funcs = new Map();
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const starts = [];
  let m;
  const re = /^function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm;
  while ((m = re.exec(text))) starts.push({ name: m[1], start: m.index });
  starts.forEach((entry, i) => {
    funcs.set(entry.name, {
      file,
      body: text.slice(entry.start, i + 1 < starts.length ? starts[i + 1].start : text.length)
    });
  });
}

// Diagnostics are editor-only implementation helpers. A trailing underscore is
// Apps Script's private-function convention and prevents google.script.run from
// publishing them to unauthenticated browser clients.
const diagnosticPublic = [...funcs]
  .filter(([, meta]) => meta.file === 'Diagnostics.gs')
  .map(([name]) => name)
  .filter(name => !name.endsWith('_'));
assert.deepStrictEqual(diagnosticPublic, [], 'Diagnostics helpers must stay private from google.script.run.');

// Follow the local call graph, because many public wrappers intentionally route
// to one trusted internal implementation. Every business RPC must eventually hit
// a server-side authentication/authorization guard. Only the platform shell,
// login/logout and ungated branding bootstrap are intentionally public.
const authGuard = /(?:requirePermission_|requireAdmin_|requireDeletePermission_|requireManagementDeletePermission_|requireSalesDraftFeatureAccess_|getSessionUser_|requireRoleAction_|requireSalesDraftAccess_)/;
const publicExempt = new Set(['doGet', 'include', 'onOpen', 'login', 'logout', 'getAppShellData']);

function reachesAuthGuard(name) {
  const seen = new Set();
  function visit(fnName) {
    if (seen.has(fnName)) return false;
    seen.add(fnName);
    const meta = funcs.get(fnName);
    if (!meta) return false;
    if (authGuard.test(meta.body)) return true;
    for (const call of meta.body.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
      const child = call[1];
      if (funcs.has(child) && visit(child)) return true;
    }
    return false;
  }
  return visit(name);
}

const unsecured = [];
for (const [name, meta] of funcs) {
  if (name.endsWith('_') || publicExempt.has(name)) continue;
  if (!reachesAuthGuard(name)) unsecured.push(meta.file + ':' + name);
}
assert.deepStrictEqual(unsecured, [], 'Every published business RPC must reach a server-side auth/permission guard.');

const published = [...funcs].filter(([name]) => !name.endsWith('_')).length;
assert.ok(published >= 150, 'Unexpectedly small public RPC inventory: ' + published);
console.log('public_rpc_security: PASS (' + published + ' published functions audited)');
