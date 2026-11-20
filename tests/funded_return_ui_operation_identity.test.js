'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','returns.html'),'utf8');
test('single and customer-batch single-invoice returns send stable operation identity',()=>{
 assert.match(source,/singlePayload\.operationId\s*=\s*rtReturnOperationId_\(\)/);
 assert.match(source,/payloadSingle\.operationId\s*=\s*rtReturnOperationId_\(\)/);
 assert.match(source,/returnAttemptFingerprint\s*=\s*fingerprint/);
});
test('funded writer release remains frozen in checked-in production Config',()=>{
 const config=fs.readFileSync(path.join(__dirname,'..','Config.gs'),'utf8');
 assert.match(config,/FUNDED_RETURN_WRITER_RELEASE_APPROVED:\s*false/);
 assert.match(config,/PURCHASE_SETTLEMENT_WRITER_RELEASE_APPROVED:\s*false/);
});
