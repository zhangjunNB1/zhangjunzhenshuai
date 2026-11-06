import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {adaptFirstSheet} from '../src/first-sheet-adapter.ts';
const root=fileURLToPath(new URL('../',import.meta.url)),input=process.argv[2];
if(!input)throw Error('用法：node scripts/import-first-sheet.mjs 已提取的工作簿.json');
const raw=JSON.parse(await fs.readFile(input,'utf8')),manifestPath=path.join(root,'data/manifest.json'),old=JSON.parse(await fs.readFile(manifestPath,'utf8'));
const id='first-sheet-'+crypto.createHash('sha256').update(raw.sha256+'|SPU投产测算表').digest('hex').slice(0,20),snapshot={id,...adaptFirstSheet(raw,new Date().toISOString())},file='snapshots/'+id+'.json';
let active=old.snapshots.filter(s=>s.basis==='first-sheet'),retired=[...(old.retiredSnapshots||[]),...old.snapshots.filter(s=>s.basis!=='first-sheet').map(s=>({...s,retiredReason:'更正为第一Sheet日表口径，原实时快照文件保留但不参与日表计算'}))];
if(!active.some(s=>s.id===id)){
 await fs.writeFile(path.join(root,'data',file),JSON.stringify(snapshot));
 active.push({id,date:snapshot.date,capturedAt:snapshot.capturedAt,importedAt:snapshot.observedAt,source:snapshot.source,shop:snapshot.shop,status:snapshot.status,rowCount:snapshot.rows.length,...snapshot.summary,file,basis:'first-sheet'});
}
active.sort((a,b)=>a.date.localeCompare(b.date)||a.importedAt.localeCompare(b.importedAt));
const manifest={...old,version:2,basis:'first-sheet',sourceSheet:'SPU投产测算表',publishedAt:new Date().toISOString(),snapshots:active,retiredSnapshots:retired,firstDate:active[0].date,latestDate:active.at(-1).date};
await fs.writeFile(manifestPath,JSON.stringify(manifest));
await fs.writeFile(path.join(root,'data/catalog.json'),JSON.stringify(snapshot.rows.map(({sku,name,spu})=>({sku,name,spu}))));
console.log(JSON.stringify({id,date:snapshot.date,sheet:snapshot.sheet,summary:snapshot.summary,categories:snapshot.categorySummaries,rows:snapshot.rows.length,transacting:snapshot.rows.filter(r=>r.qty>0).length,computed:snapshot.provenance.computed,warnings:snapshot.warnings,retiredSnapshots:retired.length},null,2));
