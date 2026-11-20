'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const s=fs.readFileSync(path.join(__dirname,'..','reports.html'),'utf8');
test('profit report has a dedicated visible source-linked oversold COGS reconciliation status',()=>{
 assert.match(s,/id="rfCostReconciliationCard"/);
 assert.match(s,/id="rfCostReconciliationMessage"/);
 assert.match(s,/costReconciliation\.status\s*===\s*'PROVISIONAL'/);
 assert.match(s,/provisionalSourceCount/);
});
test('cost warning is hidden for legacy or no-variance reports and displayed for verified cost adjustments',()=>{
 assert.match(s,/costReconciliation\.cogsDeltaMinor/);
 assert.match(s,/rfCostReconciliationCard'\)\.hidden\s*=/);
 assert.match(s,/rfCostReconciliationMessage'\)\.textContent/);
});
