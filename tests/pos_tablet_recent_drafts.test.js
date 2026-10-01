'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..'),read=n=>fs.readFileSync(path.join(root,n),'utf8');
const pos=read('pos.html'),css=read('style.html');let pass=0,fail=0;
function test(n,fn){try{fn();pass++;console.log('PASS',n)}catch(e){fail++;console.error('FAIL',n);console.error(e.stack||e)}}
function mediaBlock(source,query){const start=source.indexOf('@media '+query+' {');assert.notStrictEqual(start,-1,'missing '+query);let i=source.indexOf('{',start),d=0;for(;i<source.length;i++){if(source[i]==='{')d++;else if(source[i]==='}'&&--d===0)return source.slice(start,i+1)}throw new Error('unclosed '+query)}
test('tablet POS uses adaptive columns with an explicit stacked fallback',()=>{
  const t=mediaBlock(css,'(min-width: 500px) and (max-width: 1023px)');
  assert.match(t,/#page-pos\s+\.pos-layout\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,/);
  assert.match(t,/#page-pos\.pos-is-stacked\s+\.pos-layout\s*\{\s*grid-template-columns:\s*1fr/);
});
test('POS search row exposes recent draft controls',()=>{
  for(const id of ['posRecentDrafts','posRecentDraftsList','posRecentDraftsViewAll'])assert.match(pos,new RegExp('id="'+id+'"'));
});
test('recent drafts reuse existing list RPC and retain newest three client-side',()=>{
  assert.match(pos,/function\s+posLoadRecentDrafts_\s*\(/);assert.match(pos,/serverCall\(['"]getSalesDraftList['"],\s*authToken\)/);
  assert.match(pos,/slice\(0,\s*3\)/);assert.match(pos,/function\s+posRenderRecentDrafts_\s*\(/);
});
test('compact strip shows at most two cards and phone hides it',()=>{
  assert.match(css,/#page-pos\s+\.pos-recent-draft-card:nth-child\(n\+3\)\s*\{\s*display:\s*none/);
  assert.match(css,/@media\s*\(max-width:\s*499px\)[\s\S]*#page-pos\s+\.pos-recent-drafts\s*\{\s*display:\s*none\s*!important/);
});
test('opening draft protects unsaved sale and View All opens Draft Invoices',()=>{
  assert.match(pos,/function\s+posHasUnsavedSale_\s*\(/);
  assert.match(pos,/function\s+posOpenDraft_\s*\(draftId\)[\s\S]*posHasUnsavedSale_\(\)[\s\S]*confirmAction\s*\(/);
  assert.match(pos,/id=['"]posRecentDraftsViewAll['"][\s\S]*addEventListener\(['"]click['"][\s\S]*goToPage\(['"]draftSales['"]\)/);
});
console.log(`\n${pass}/${pass+fail} passed`);if(fail)process.exit(1);
