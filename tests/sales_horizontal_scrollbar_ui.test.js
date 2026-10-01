'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const sales = fs.readFileSync(path.resolve(__dirname, '..', 'sales.html'), 'utf8');

let pass = 0;
let fail = 0;
function test(name, fn) {
  try {
    fn();
    pass++;
    console.log('PASS', name);
  } catch (err) {
    fail++;
    console.error('FAIL', name);
    console.error(err.stack || err);
  }
}

test('Sales table exposes a labeled Action header', () => {
  assert.match(sales, /<th>Action<\/th>/);
});

test('Sales table has a dedicated top horizontal scrollbar', () => {
  assert.match(sales, /id="smTopScroll"/);
  assert.match(sales, /id="smTopScrollInner"/);
  assert.match(sales, /id="smTableScroll"/);
});

test('Sales top scrollbar is shown only when the table overflows', () => {
  assert.match(sales, /function\s+smSyncTopScrollbar_\s*\(/);
  assert.match(sales, /tableScroll\.scrollWidth\s*-\s*tableScroll\.clientWidth\s*>\s*1/);
  assert.match(sales, /top\.style\.display\s*=\s*hasOverflow\s*\?\s*["']block["']\s*:\s*["']none["']/);
});

test('Sales top scrollbar stays synchronized both directions', () => {
  assert.match(sales, /tableScroll\.scrollLeft\s*=\s*top\.scrollLeft/);
  assert.match(sales, /top\.scrollLeft\s*=\s*tableScroll\.scrollLeft/);
  assert.match(sales, /function\s+smWireTopScrollbar_\s*\(/);
});

test('Sales remeasures scrollbar after rows render and on resize', () => {
  assert.match(sales, /requestAnimationFrame\(smSyncTopScrollbar_\)/);
  assert.match(sales, /window\.addEventListener\(["']resize["'],\s*smSyncTopScrollbar_\)/);
});

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
