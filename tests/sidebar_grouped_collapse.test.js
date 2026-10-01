'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..'),read=n=>fs.readFileSync(path.join(root,n),'utf8');
const ui=read('UI.gs'),js=read('javascript.html'),css=read('style.html'),index=read('index.html');let pass=0,fail=0;
function test(n,fn){try{fn();pass++;console.log('PASS',n)}catch(e){fail++;console.error('FAIL',n);console.error(e.stack||e)}}
function navMeta(key){const m=ui.match(new RegExp("\\{\\s*key:\\s*'"+key+"'[\\s\\S]*?\\}",'m'));assert.ok(m,'missing '+key);return m[0]}
test('sidebar metadata encodes current grouped desktop order',()=>{
 const expected=[['dashboard',0,10],['pos',0,20],['counter',0,25],['sales',1,30],['customers',1,40],['products',1,45],['purchase',2,50],['suppliers',2,60],['vendors',2,70],['daybook',4,90],['bank',4,100],['expense',4,110],['finance',4,120],['reports',5,130],['settings',6,140]];
 expected.forEach(([k,g,o])=>{const b=navMeta(k);assert.match(b,new RegExp('sidebarGroup:\\s*'+g+'\\b'),k+' group');assert.match(b,new RegExp('sidebarOrder:\\s*'+o+'\\b'),k+' order')});
});
test('renderer sorts sidebarOrder and inserts dividers between visible groups',()=>{
 assert.match(js,/function\s+sidebarItemsInOrder_\s*\(/);assert.match(js,/sidebarOrder/);assert.match(js,/item\.sidebarGroup/);assert.match(js,/className\s*=\s*['"]nav-divider['"]/);assert.match(js,/nav\.appendChild\(divider\)/);
});
test('desktop shell uses 68px rail with overlay expansion',()=>{
 assert.match(css,/--sidebar-collapsed-width:\s*68px/);assert.match(css,/\.main\s*\{[^}]*margin-left:\s*var\(--sidebar-collapsed-width\)/);assert.match(css,/\.topbar\s*\{[^}]*left:\s*var\(--sidebar-collapsed-width\)/);
 assert.match(css,/#app:not\(\.sidebar-collapsed\)\s+\.sidebar\s*\{[^}]*width:\s*min\(var\(--sidebar-width\),\s*78vw\)/);assert.match(css,/#app:not\(\.sidebar-collapsed\)\s+\.sidebar-backdrop\s*\{\s*display:\s*block/);
});
test('collapsed rail hides labels, centers icons and keeps native tooltips',()=>{
 assert.match(css,/#app\.sidebar-collapsed[\s\S]*\.nav-item-text[\s\S]*display:\s*none/);assert.match(css,/#app\.sidebar-collapsed[\s\S]*\.nav-item[\s\S]*justify-content:\s*center/);assert.match(js,/el\.title\s*=\s*item\.label/);assert.match(js,/aria-label/);
});
test('sidebar state persists and defaults collapsed for every non-phone viewport',()=>{
 assert.match(js,/localStorage\.getItem\(SIDEBAR_COLLAPSED_KEY\)/);assert.match(js,/if\s*\(saved\s*===\s*null\)\s*collapsed\s*=\s*true/);assert.match(js,/if\s*\(!window\.innerWidth\s*\|\|\s*isPhoneViewport_\(\)\)\s*return/);assert.match(js,/localStorage\.setItem\(SIDEBAR_COLLAPSED_KEY/);
});
test('menu toggle and phone More sheet remain available',()=>{
 assert.match(index,/id="menuToggle"/);assert.match(js,/function\s+toggleDesktopSidebar_\s*\(/);for(const id of ['mobileBottomNav','mobileMoreSheet','mobileMoreList'])assert.match(index,new RegExp('id="'+id+'"'));assert.match(js,/isPhoneViewport_\(\)[\s\S]{0,120}?openMobileMore_\(\)/);
});
console.log(`\n${pass}/${pass+fail} passed`);if(fail)process.exit(1);
