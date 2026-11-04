'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const sales=read('sales.html');
const products=read('products.html');
const css=read('style.html');
const js=read('javascript.html');

test('Products and Sales share the same icon action menu implementation',()=>{
  assert.match(sales,/openRowActionMenu_\(btn,/);
  assert.match(products,/openRowActionMenu_\(trigger,/);
  assert.doesNotMatch(products,/id="prodActionMenu"/);
  assert.doesNotMatch(products,/menu\.innerHTML\s*=[\s\S]{0,150}data-menu-act="edit"/);
});
test('Products keeps all original actions but dispatches them through shared menu',()=>{
  assert.match(products,/action:\s*'edit',\s*label:\s*'Edit'/);
  assert.match(products,/action:\s*'stock',\s*label:\s*'Adjust Stock'/);
  assert.match(products,/action:\s*'lots',\s*label:\s*'View Lots'/);
  assert.match(products,/action:\s*'delete',\s*label:\s*'Delete',\s*danger:\s*true/);
  assert.match(products,/action:\s*'activate'/);
  assert.match(products,/action:\s*'deactivate'/);
  assert.match(products,/if\s*\(!isBundle\)/);
  assert.match(products,/prodOpenEdit_\(product\)/);
  assert.match(products,/prodOpenStock_\(product\)/);
  assert.match(products,/prodOpenLots_\(product\)/);
  assert.match(products,/prodToggleStatus_\(product,\s*product\['Status'\]\)/);
  assert.match(products,/prodDelete_\(product\['Product ID'\],\s*product\['Product Name'\]\)/);
});
test('Shared icon glyph collection supports every Products menu item',()=>{
  assert.match(js,/glyphs\.stock\s*=/);
  assert.match(js,/glyphs\.lots\s*=/);
  assert.match(js,/glyphs\.activate\s*=/);
  assert.match(js,/glyphs\.deactivate\s*=/);
  assert.match(js,/delete:\s*'<path/);
});
test('Sales and Products share desktop/tablet table header, cell and pinned-heading metrics',()=>{
  assert.match(css,/#page-sales #smTableScroll th,\s*#page-products #prodTable th\s*\{\s*padding:\s*9px 12px;/);
  assert.match(css,/#page-sales #smTableScroll td,\s*#page-products #prodTable td\s*\{\s*padding:\s*8px 12px;\s*line-height:\s*1\.35;/);
  assert.match(css,/\.sm-pinned-sales-header th,\s*\.prod-pinned-header th\s*\{/);
  assert.doesNotMatch(css,/#page-products #prodTable th,\s*#page-products #prodTable td\s*\{\s*padding:\s*7px 8px;/);
  assert.doesNotMatch(css,/#page-products #prodTable th,\s*#page-products #prodTable td\s*\{\s*padding:\s*6px 7px;/);
});
test('Product text matches Sales normal 14px body typography, with one-line name preserved',()=>{
  assert.match(css,/#page-products \.prod-item-name\s*\{[^}]*font-size:\s*14px;[^}]*font-weight:\s*400;/s);
  assert.match(css,/#page-products \.prod-cell-main,\s*#page-products \.prod-price-main\s*\{[^}]*font-size:\s*14px;[^}]*font-weight:\s*400;/s);
  assert.match(css,/#page-products #prodTable \.prod-item-name\s*\{[^}]*text-overflow:\s*ellipsis;/s);
  assert.match(products,/class="prod-cell-main/);
  assert.match(products,/stockUnit\s*\?\s*' <span class="prod-cell-unit">/);
});
test('Sales and Products retain their own sticky header plus top scrollbar and identical action triggers',()=>{
  assert.match(sales,/rowActionTriggerHtml_\(/);
  assert.match(products,/rowActionTriggerHtml_\(/);
  assert.match(sales,/function smEnsurePinnedTopScrollbar_/);
  assert.match(products,/function prodEnsurePinnedTopScrollbar_/);
  assert.match(products,/prodSortKey_\(sortButton\.dataset\.sortKey\)/);
});
