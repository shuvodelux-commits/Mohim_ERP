const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const html = fs.readFileSync('counter.html','utf8');
function test(name, fn){ try{ fn(); console.log('PASS '+name); } catch(e){ console.error('FAIL '+name+'\n'+e.stack); process.exitCode=1; } }
function scriptSource(){ return [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).join('\n'); }
function context(){
  const el=()=>({addEventListener:()=>{},classList:{add:()=>{},remove:()=>{},toggle:()=>{}},setAttribute:()=>{},querySelectorAll:()=>[],dataset:{},style:{}});
  const normalizePhoneSearch_=value=>String(value??'').replace(/[০-৯]/g,d=>String('০১২৩৪৫৬৭৮৯'.indexOf(d))).replace(/\D/g,'');
  const ctx={console,setTimeout:()=>{},document:{createElement:el,addEventListener:()=>{},querySelectorAll:()=>[],getElementById:el},escapeHtml:s=>String(s??''),phoneSearchMatches_:(phone,query)=>{const p=normalizePhoneSearch_(phone),q=normalizePhoneSearch_(query);return !!p&&!!q&&p.indexOf(q)!==-1;}};
  vm.createContext(ctx); vm.runInContext(scriptSource(),ctx); return ctx;
}

test('Bangla amount words use Bangladeshi grouping and poisha', () => {
  const c=context(); assert.equal(typeof c.counterAmountInBangla_,'function');
  assert.equal(c.counterAmountInBangla_(125),'একশ পঁচিশ টাকা মাত্র');
  assert.equal(c.counterAmountInBangla_('12,500'),'বারো হাজার পাঁচশ টাকা মাত্র');
  assert.equal(c.counterAmountInBangla_('1,25,000'),'এক লাখ পঁচিশ হাজার টাকা মাত্র');
  assert.equal(c.counterAmountInBangla_('1,25,00,000'),'এক কোটি পঁচিশ লাখ টাকা মাত্র');
  assert.equal(c.counterAmountInBangla_('23,000.50'),'তেইশ হাজার টাকা পঞ্চাশ পয়সা মাত্র');
  assert.equal(c.counterAmountInBangla_(0),'');
  assert.equal(c.counterAmountInBangla_(''),'');
  assert.equal(c.counterAmountInBangla_('oops'),'');
});

test('Counter search normalization matches partial name and phone locally', () => {
  const c=context();
  const items=[{id:'C1',name:'Rahim Enterprise',phone:'01712345678'},{id:'C2',name:'Karim Store',phone:'018999'}];
  assert.deepStrictEqual(JSON.parse(JSON.stringify(c.counterFilterItems_(items,'rah'))).map(x=>x.id),['C1']);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(c.counterFilterItems_(items,'enterprise'))).map(x=>x.id),['C1']);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(c.counterFilterItems_(items,'3456'))).map(x=>x.id),['C1']);
});

test('Search result rendering is capped and keyboard-selectable', () => {
  assert.match(html, /slice\(0,\s*20\)/);
  ['ArrowDown','ArrowUp','Enter','Escape'].forEach(k=>assert(html.includes(k),k+' handler missing'));
  assert.match(html, /function counterCreateCombobox_\s*\(/);
});

if (!process.exitCode) console.log('3/3 passed');
