'use strict';
const fs = require('fs');
const assert = require('assert');

const cssTemplate = fs.readFileSync('style.html', 'utf8');

const outsideStyle = cssTemplate
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .trim();

assert.strictEqual(
  outsideStyle,
  '',
  'style.html must not contain CSS or visible text outside <style> blocks'
);

console.log('style_encapsulation: PASS');
