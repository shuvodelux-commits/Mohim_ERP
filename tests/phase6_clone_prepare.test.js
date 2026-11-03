'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const cp=require('node:child_process');
const root=path.join(__dirname,'..');
const script=path.join(root,'scripts','phase6_prepare_clone.sh');
const original=JSON.parse(fs.readFileSync(path.join(root,'.clasp.json'),'utf8'));
const cloneScriptId='newDisposableScriptAbcdefgh123456789XYZ';
const cloneSpreadsheetId='newDisposableSheetAbcdefgh123456789XYZ';
function invoke(scriptId,spreadsheetId,target){
 return cp.spawnSync('bash',[script,scriptId,spreadsheetId,target],{
  cwd:root,encoding:'utf8',timeout:20000
 });
}
test('Phase 6 prepare does not change live clasp, packages only clone ID and checked audit module',()=>{
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),'mohim-phase6-ci-'));
 try {
  const target=path.join(parent,'qa');
  const originalFile=fs.readFileSync(path.join(root,'.clasp.json'),'utf8');
  const result=invoke(cloneScriptId,cloneSpreadsheetId,target);
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/NO remote writes performed/);
  assert.equal(fs.readFileSync(path.join(root,'.clasp.json'),'utf8'),originalFile);
  const config=JSON.parse(fs.readFileSync(path.join(target,'.clasp.json'),'utf8'));
  assert.equal(config.scriptId,cloneScriptId);
  assert.notEqual(config.scriptId,original.scriptId);
  assert.ok(fs.existsSync(path.join(target,'SalePayments.gs')));
  assert.ok(fs.existsSync(path.join(target,'SalesManagement.gs')));
  assert.ok(fs.existsSync(path.join(target,'Phase6CloneAudit.gs')));
  const audit=fs.readFileSync(path.join(target,'Phase6CloneAudit.gs'),'utf8');
  assert.ok(audit.includes("spreadsheetId: '"+cloneSpreadsheetId+"'"));
  assert.ok(audit.includes("scriptId: '"+cloneScriptId+"'"));
  assert.ok(!fs.existsSync(path.join(target,'tests')));
  assert.ok(!fs.existsSync(path.join(target,'tests/sale_multi_payment_phase6_hardening.test.js')));
  const second=invoke(cloneScriptId,cloneSpreadsheetId,target);
  assert.notEqual(second.status,0,'refuse to overwrite existing QA directory');
 } finally { fs.rmSync(parent,{recursive:true,force:true}); }
});
test('Phase 6 rejects production, existing shared preview and malformed IDs before directory creation',()=>{
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),'mohim-phase6-negative-'));
 try {
  const bad=[
   [original.scriptId,cloneSpreadsheetId],
   ['1c1wtUuO0xISTw0JTfAKnqry28UeJaIcW8CWwJVDSo1Y31BbPad4glp4G',cloneSpreadsheetId],
   ['short',cloneSpreadsheetId],
   [cloneScriptId,cloneScriptId]
  ];
  bad.forEach(([sid,bid],index)=>{
   const target=path.join(parent,'refused-'+index);
   const result=invoke(sid,bid,target);
   assert.notEqual(result.status,0,'reject unsafe '+index);
   assert.equal(fs.existsSync(target),false,'no output created for unsafe '+index);
  });
 } finally { fs.rmSync(parent,{recursive:true,force:true}); }
});
test('Phase 6 clone audit refuses identity mismatch and production ID before inspecting any Sheets',()=>{
 const vm=require('node:vm');
 const text=fs.readFileSync(path.join(root,'tests','phase6_clone_audit.gs'),'utf8');
 const code=text.slice(text.indexOf('function assertPhase6CloneIdentity_('),
   text.indexOf('/** Direct, read-only Sheet access'));
 const context=vm.createContext({CONFIG:{SHEETS:{SALES:'SALES'}},
   readSalePaymentBreakdown_:()=>{},assertSalePaymentBookEvidence_:()=>{}});
 vm.runInContext(code,context);
 const approve={spreadsheetId:cloneSpreadsheetId,scriptId:cloneScriptId};
 assert.equal(context.assertPhase6CloneIdentity_(approve,cloneSpreadsheetId,cloneScriptId),true);
 assert.throws(()=>context.assertPhase6CloneIdentity_(approve,cloneSpreadsheetId,'different-ID'),/mismatch/);
 assert.throws(()=>context.assertPhase6CloneIdentity_(approve,'different-sheet',cloneScriptId),/mismatch/);
 assert.throws(()=>context.assertPhase6CloneIdentity_({spreadsheetId:'',scriptId:''},cloneSpreadsheetId,cloneScriptId),/not configured/);
 assert.throws(()=>context.assertPhase6CloneIdentity_(
  {spreadsheetId:cloneSpreadsheetId,scriptId:original.scriptId},cloneSpreadsheetId,original.scriptId
 ),/production/i);
 assert.throws(()=>context.assertPhase6CloneIdentity_(
  {spreadsheetId:cloneSpreadsheetId,scriptId:'1c1wtUuO0xISTw0JTfAKnqry28UeJaIcW8CWwJVDSo1Y31BbPad4glp4G'},
  cloneSpreadsheetId,'1c1wtUuO0xISTw0JTfAKnqry28UeJaIcW8CWwJVDSo1Y31BbPad4glp4G'
 ),/shared preview/i);
});
