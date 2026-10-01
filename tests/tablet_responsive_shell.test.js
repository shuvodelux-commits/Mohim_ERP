'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..'),read=n=>fs.readFileSync(path.join(root,n),'utf8');
const css=read('style.html'),js=read('javascript.html'),pos=read('pos.html');let pass=0,fail=0;
function test(n,fn){try{fn();pass++;console.log('PASS',n)}catch(e){fail++;console.error('FAIL',n);console.error(e.stack||e)}}
function mediaBlock(source,query){const start=source.indexOf('@media '+query+' {');assert.notStrictEqual(start,-1,'missing '+query);let i=source.indexOf('{',start),d=0;for(;i<source.length;i++){if(source[i]==='{')d++;else if(source[i]==='}'&&--d===0)return source.slice(start,i+1)}throw new Error('unclosed '+query)}
test('non-phone widths use fixed desktop shell with collapsed rail clearance',()=>{
 const d=mediaBlock(css,'(min-width: 541px)');assert.match(d,/\.sidebar\s*\{[\s\S]*position:\s*fixed/);assert.match(d,/\.main\s*\{[^}]*margin-left:\s*var\(--sidebar-collapsed-width\)/);assert.match(d,/\.topbar\s*\{[^}]*left:\s*var\(--sidebar-collapsed-width\)/);assert.match(css,/@media\s*\(min-width:\s*500px\)\s*and\s*\(max-width:\s*1023px\)/);
});
test('phone app-shell UI uses 540px boundary',()=>{assert.match(css,/@media\s*\(max-width:\s*540px\)/);assert.doesNotMatch(css,/@media\s*\(max-width:\s*640px\)/);assert.match(js,/max-width:\s*540px/);assert.doesNotMatch(js,/max-width:\s*640px/)});
test('isPhoneViewport recognizes short coarse landscape phones',()=>{assert.match(js,/function\s+isPhoneViewport_\s*\(/);assert.match(js,/orientation:\s*landscape/);assert.match(js,/max-height:\s*540px/);assert.match(js,/pointer:\s*coarse/);assert.match(pos,/isPhoneViewport_\(\)/)});
test('phone CSS resets desktop shell offsets',()=>{assert.match(css,/@media\s*\(max-width:\s*540px\)\s*,\s*\(orientation:\s*landscape\)\s*and\s*\(max-height:\s*540px\)\s*and\s*\(pointer:\s*coarse\)/);assert.match(css,/@media\s*\(max-width:\s*540px\)[\s\S]{0,2600}?\.main\s*\{[^}]*margin-left:\s*0/);assert.match(css,/@media\s*\(max-width:\s*540px\)[\s\S]{0,3200}?\.topbar\s*\{[^}]*left:\s*0/)});
test('sidebar defaults collapsed for non-phone viewports and phone menu opens More',()=>{assert.match(js,/function\s+restoreSidebarState_\s*\([\s\S]*?isPhoneViewport_\(\)[\s\S]*?saved\s*===\s*null[\s\S]*?collapsed\s*=\s*true/);assert.match(js,/menuToggle[\s\S]{0,260}?isPhoneViewport_\(\)[\s\S]{0,120}?openMobileMore_\(\)/)});
console.log(`\n${pass}/${pass+fail} passed`);if(fail)process.exit(1);
