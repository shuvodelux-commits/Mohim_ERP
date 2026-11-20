'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('pinned Playwright browser gate runs on a supported Ubuntu image, not moving ubuntu-latest',()=>{
 const workflow=fs.readFileSync(path.join(__dirname,'..','.github','workflows','regression-tests.yml'),'utf8');
 assert.match(workflow,/runs-on:\s*ubuntu-24\.04/);
 assert.doesNotMatch(workflow,/runs-on:\s*ubuntu-latest/);
 assert.match(workflow,/playwright@1\.55\.0/);
 assert.match(workflow,/playwright install --with-deps chromium/);
});
