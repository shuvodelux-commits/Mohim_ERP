'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const props = { value:'4', getProperty(){return this.value;}, setProperty(k,v){this.value=String(v);} };
const headers = {
  SALES_DRAFTS: ['Draft ID','Draft No','Draft Date'],
  SALES_DRAFT_AUDIT: ['Audit ID','Timestamp','Action','Draft ID','Draft No']
};
const values = {
  SALES_DRAFTS: [['DRAFT-2026-0002'],['DRAFT-2026-0016']],
  SALES_DRAFT_AUDIT: [['DRAFT-2026-0014']]
};
const requested=[];
const ctx={
  console,
  CONFIG:{HEADERS:headers},
  PropertiesService:{getDocumentProperties:()=>props},
  Utilities:{formatDate:()=> '2026'}, Session:{getScriptTimeZone:()=> 'Asia/Dhaka'},
  getSheet_:(key)=>({
    getLastRow:()=>values[key].length+1,
    getRange:(row,col,numRows,numCols)=>{requested.push({key,row,col,numRows,numCols});return{getValues:()=>values[key]};}
  }),
  getAllRows_:()=>{throw new Error('draft counter must not load all columns');}
};
vm.createContext(ctx);
const src=fs.readFileSync('DraftSales.gs','utf8');
const start=src.indexOf('function generateDraftInvoiceNo_');
const end=src.indexOf('\nfunction salesDraftCanManageAll_',start);
vm.runInContext(src.slice(start,end),ctx,{filename:'DraftSales.gs'});
assert.equal(ctx.generateDraftInvoiceNo_(),'DRAFT-2026-0017');
assert.equal(props.value,'17');
assert.deepStrictEqual(requested,[
  {key:'SALES_DRAFTS',row:2,col:2,numRows:2,numCols:1},
  {key:'SALES_DRAFT_AUDIT',row:2,col:5,numRows:1,numCols:1}
]);
console.log('PASS Draft counter reconciliation reads only Draft No columns');
