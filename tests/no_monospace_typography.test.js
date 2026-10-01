'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const htmlFiles = fs.readdirSync(root).filter(function (name) {
  return name.endsWith('.html');
});

const forbidden = [
  { label: 'mono class/font token', pattern: /\bmono\b/i },
  { label: 'generic monospace family', pattern: /monospace/i },
  { label: 'JetBrains Mono', pattern: /JetBrains(?:\+|\s+)Mono/i },
  { label: 'Geist Mono', pattern: /Geist\s+Mono/i },
  { label: 'system mono aliases', pattern: /ui-monospace|SFMono-Regular|Consolas|Liberation\s+Mono/i }
];

htmlFiles.forEach(function (name) {
  const source = fs.readFileSync(path.join(root, name), 'utf8');
  forbidden.forEach(function (rule) {
    assert.doesNotMatch(source, rule.pattern, name + ' still contains ' + rule.label);
  });
});

console.log('PASS production HTML contains no monospace typography');
