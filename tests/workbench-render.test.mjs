import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {build} from 'esbuild';
import {createWorkspace} from '../src/workbench-model.ts';
test('真实归档商品可渲染多选维护页和成本校对导入弹窗，无缺失组件引用',async()=>{
 const root=new URL('../',import.meta.url),outdir=new URL('../.private/render-tests/',import.meta.url);
 await build({absWorkingDir:fileURLToPath(root),entryPoints:['src/product-manager.tsx','src/cost-sheet-view.tsx','src/product-sheet-view.tsx'],bundle:true,format:'esm',platform:'node',jsx:'automatic',packages:'external',outdir:'.private/render-tests',outExtension:{'.js':'.mjs'}});
 const {ProductManager}=await import(new URL('product-manager.mjs',outdir).href),{CostSheetImporter}=await import(new URL('cost-sheet-view.mjs',outdir).href);
 const m=JSON.parse(await fs.readFile(new URL('data/manifest.json',root),'utf8')),seed=JSON.parse(await fs.readFile(new URL('data/'+m.snapshots.at(-1).file,root),'utf8')),w=createWorkspace(seed,m),props={w,commit:()=>true,notify:()=>{}};
 const html=renderToStaticMarkup(React.createElement(ProductManager,props));for(const label of ['选择本页全部商品','批量标记 / 成本 / 扣点','平台链接扣点','成本按商家SKU关联'])assert.ok(html.includes(label),label);
 assert.equal((html.match(/aria-label="选择商品 /g)||[]).length,12);
 const modal=renderToStaticMarkup(React.createElement(CostSheetImporter,{...props,close:()=>{}}));assert.ok(modal.includes('上传成本校对工作簿'));assert.ok(modal.includes('成本校对'));
 const {ProductSheetImporter}=await import(new URL('product-sheet-view.mjs',outdir).href),productModal=renderToStaticMarkup(React.createElement(ProductSheetImporter,{...props,close:()=>{}}));for(const content of [modal,productModal]){assert.ok(content.includes('下载空白模板'));assert.ok(content.includes('下载填写示例'));assert.ok(content.includes('templates/'));}assert.ok(html.includes('表格导入前端商品'));assert.ok(productModal.includes('确认导入前端商品'));
});
