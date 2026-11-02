'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'), vm=require('node:vm'), path=require('node:path');
const root=path.join(__dirname,'..');
function harness({role='Administrator',allowed=[],db={}}={}){
  const user={Role:role,'User ID':'USR-1'}, checks=[], perms=new Set(allowed);
  const data=Object.assign({
    CUSTOMERS:[{'Customer ID':'CUS-1',Phone:'01712345678'}],
    SUPPLIERS:[{'Supplier ID':'SUP-1',Phone:'01812345678'}],
    FINANCE_PERSONS:[{'Person ID':'FPER-1',Roles:'Lender,Borrower',Status:'Active',Phone:'01912345678'}]
  },db);
  const ctx=vm.createContext({
    requirePermission_(token,module,action){
      checks.push([module,action]);
      if(token!=='valid')throw Error('Session invalid');
      if(role!=='Administrator'&&!perms.has(module+':'+action))throw Error('Permission denied');
      return user;
    },
    getAllRows_:sheet=>data[sheet]||[],
    isDeleted_:row=>String(row['Is Deleted']||'').toUpperCase()==='TRUE',
    financePersonRoles_:row=>String(row.Roles||'').split(',').map(x=>x.trim()).filter(Boolean)
  });
  for(const name of ['UI.gs','WhatsAppService.gs']){
    const file=path.join(root,name);
    if(fs.existsSync(file))vm.runInContext(fs.readFileSync(file,'utf8'),ctx,{filename:name});
  }
  return {call(name,...args){ctx.__args=args;return vm.runInContext(name+'(...__args)',ctx)},ctx,checks};
}
test('normalize_BD_local_and_international_phone',()=>{
 const h=harness();
 for(const number of ['01712345678','+8801712345678','8801712345678','+88 01712-345678']){
  assert.equal(h.call('whatsAppNormalizePhone_',number).digits,'8801712345678');
  assert.equal(h.call('whatsAppNormalizePhone_',number).display,'+8801712345678');
 }
});
test('normalize_Bangla_digits',()=>{
 const h=harness();
 assert.equal(h.call('whatsAppNormalizePhone_','০১৭১২৩৪৫৬৭৮').digits,'8801712345678');
 assert.equal(h.call('whatsAppNormalizePhone_','+৮৮০১৭১২৩৪৫৬৭৮').digits,'8801712345678');
});
test('reject_empty_short_or_ambiguous_phone',()=>{
 const h=harness();
 for(const v of ['',null,' ','017123','1712345678','+88017123456789','0171234567x','01712345678,01812345678','01212345678']){
  assert.throws(()=>h.call('whatsAppNormalizePhone_',v),/phone|mobile|number/i);
 }
});
test('share permission exists as edit-only and is absent from navigation',()=>{
 const h=harness(), modules=vm.runInContext('PERMISSION_MODULES',h.ctx);
 const share=modules.find(m=>m.key==='whatsappShare');
 assert.ok(share);assert.equal(share.permissionMode,'editOnly');
 assert.equal(vm.runInContext('NAV_ITEMS',h.ctx).some(m=>m.key==='whatsappShare'),false);
});
test('deny_without_source_view_or_share_edit',()=>{
 assert.throws(()=>harness({role:'Staff',allowed:['customers:view']}).call('whatsAppAuthorize_','valid','customer','CUS-1'),/permission/i);
 assert.throws(()=>harness({role:'Staff',allowed:['whatsappShare:edit']}).call('whatsAppAuthorize_','valid','customer','CUS-1'),/permission/i);
 assert.throws(()=>harness().call('whatsAppAuthorize_','invalid','customer','CUS-1'),/session/i);
});
test('allow_admin_with_valid_source',()=>{
 const h=harness();
 assert.equal(h.call('whatsAppAuthorize_','valid','customer','CUS-1').Role,'Administrator');
 assert.equal(h.call('whatsAppAuthorize_','valid','supplier','SUP-1').Role,'Administrator');
 assert.equal(h.call('whatsAppAuthorize_','valid','financePerson','FPER-1','Lender').Role,'Administrator');
 assert.deepEqual(h.checks,[
 ['whatsappShare','edit'],['customers','view'],
 ['whatsappShare','edit'],['suppliers','view'],
 ['whatsappShare','edit'],['finance','view']
 ]);
});
test('allow_staff_only_with_both_share_and_source_view_permissions',()=>{
 const h=harness({role:'Staff',allowed:['whatsappShare:edit','customers:view']});
 assert.equal(h.call('whatsAppAuthorize_','valid','customer','CUS-1').Role,'Staff');
 assert.throws(()=>h.call('whatsAppAuthorize_','valid','supplier','SUP-1'),/permission/i);
});
test('deny_unknown_finance_role_or_wrong_or_deleted_entity',()=>{
 const h=harness();
 for(const role of ['Owner','Investor','',undefined])assert.throws(()=>h.call('whatsAppAuthorize_','valid','financePerson','FPER-1',role),/role/i);
 assert.throws(()=>h.call('whatsAppAuthorize_','valid','financePerson','FPER-99','Lender'),/not found/i);
 assert.throws(()=>h.call('whatsAppAuthorize_','valid','customer','CUS-99'),/not found/i);
 assert.throws(()=>h.call('whatsAppAuthorize_','valid','invented','CUS-1'),/source/i);
 const d=harness({db:{CUSTOMERS:[{'Customer ID':'CUS-1','Is Deleted':'TRUE'}]}});
 assert.throws(()=>d.call('whatsAppAuthorize_','valid','customer','CUS-1'),/not found/i);
});
test('changed recipient requires explicit confirmation and is not persisted',()=>{
 const h=harness();
 assert.equal(h.call('whatsAppResolveRecipient_','01712345678',null,false).overridden,false);
 assert.throws(()=>h.call('whatsAppResolveRecipient_','01712345678','01912345678',false),/confirm/i);
 const overridden=h.call('whatsAppResolveRecipient_','01712345678','01912345678',true);
 assert.equal(overridden.digits,'8801912345678');assert.equal(overridden.overridden,true);
 assert.equal(h.call('whatsAppResolveRecipient_','01712345678','+8801712345678',false).overridden,false);
 assert.equal(h.call('whatsAppResolveRecipient_','','01812345678',true).digits,'8801812345678');
});
