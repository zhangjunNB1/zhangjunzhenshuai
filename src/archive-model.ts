import {resolveCategory} from './category-policy.ts';
export function sumRows(rows:any[]){return rows.reduce((a,r)=>({sales:a.sales+r.sales,cost:a.cost+r.cost,ads:a.ads+r.ads,profit:a.profit+r.profit,qty:a.qty+r.qty,adRevenue:a.adRevenue===null||r.adRevenue===null?null:a.adRevenue+r.adRevenue}),{sales:0,cost:0,ads:0,profit:0,qty:0,adRevenue:0 as number|null});}
export function combineRows(rows:any[]){
 const groups=new Map<string,any>();
 for(const r of rows){const key=[r.shop,r.category||'',r.sku].join('|');let a=groups.get(key);if(!a){a={sku:r.sku,name:r.name,spu:r.spu,category:r.category,qty:0,sales:0,cost:0,ads:0,profit:0,adRevenue:0,actualPrice:null,unitProfit:null,promoPrice:null,included:true,actualSum:0,unitSum:0,actualMissing:false,unitMissing:false};groups.set(key,a);}a.name=r.name;a.spu=r.spu;for(const k of ['qty','sales','cost','ads','profit'])a[k]+=r[k];a.included=a.included&&r.included!==false;if(r.adRevenue===null)a.adRevenue=null;else if(a.adRevenue!==null)a.adRevenue+=r.adRevenue;if(r.qty>0){if(r.actualPrice===null)a.actualMissing=true;else a.actualSum+=r.actualPrice*r.qty;if(r.unitProfit===null)a.unitMissing=true;else a.unitSum+=r.unitProfit*r.qty;}}
 return [...groups.values()].map(({actualSum,unitSum,actualMissing,unitMissing,...a})=>({...a,actualPrice:a.qty>0&&!actualMissing?Math.round(actualSum/a.qty):null,unitProfit:a.qty>0&&!unitMissing?Math.round(unitSum/a.qty):null})).sort((a,b)=>b.profit-a.profit);
}
export function selectLatest(entries:any[]){const result=new Map<string,any>();for(const e of entries){const key=e.date+'|'+e.shop;const old=result.get(key);if(!old||[e.capturedAt,e.importedAt,e.id].join('|')>[old.capturedAt,old.importedAt,old.id].join('|'))result.set(key,e);}return [...result.values()].sort((a,b)=>a.date.localeCompare(b.date));}
export function makeOverview(manifest:any,snapshots:any[],from:string,to:string){
 const dateGroups=new Map<string,any>(),categoryGroups=new Map<string,any>();const rows:any[]=[],categorized:any[]=[],notices:any[]=[];
 const coverageByDay:{date:string;missingCount:number;missingQty:number;missingSales:number}[]=[];
 for(const s of snapshots){if(s.date<from||s.date>to)continue;const totals=sumRows(s.rows),summary=s.summary||totals;let day=dateGroups.get(s.date);if(!day){day={date:s.date,sales:0,cost:0,ads:0,profit:0,adRevenue:0,capturedAt:s.capturedAt,rowCount:0};dateGroups.set(s.date,day);}for(const k of ['sales','cost','ads','profit'])day[k]+=summary[k];day.rowCount+=s.rows.length;day.capturedAt=day.capturedAt>s.capturedAt?day.capturedAt:s.capturedAt;if(totals.adRevenue===null)day.adRevenue=null;else if(day.adRevenue!==null)day.adRevenue+=totals.adRevenue;
  for(const message of s.warnings||[])notices.push({date:s.date,text:message});
  if(s.coverage&&['missingCount','missingQty','missingSales'].every(k=>Number.isFinite(s.coverage[k]))){
   const {missingCount,missingQty,missingSales}=s.coverage;
   coverageByDay.push({date:s.date,missingCount,missingQty,missingSales});
  }
  const snapshotCategories=new Map<string,any>();
  function categoryDay(category:string){
   if(!snapshotCategories.has(category))snapshotCategories.set(category,{date:s.date,category,sales:0,cost:0,ads:0,profit:0,qty:0,adRevenue:0,rowCount:0,summaryBasis:'detail'});
   return snapshotCategories.get(category);
  }
  for(const r of s.rows){
   const category=resolveCategory(r.sku,r.spu,s.date,manifest.rules||[]);
   rows.push({...r,shop:s.shop});
   categorized.push({...r,shop:s.shop,date:s.date,category});
   const d=categoryDay(category);
   for(const k of ['sales','cost','ads','profit','qty'])d[k]+=r[k];
   d.rowCount++;
   if(r.adRevenue===null)d.adRevenue=null;else if(d.adRevenue!==null)d.adRevenue+=r.adRevenue;
  }
  for(const summary of s.categorySummaries||[]){
   const d=categoryDay(summary.category);
   Object.assign(d,summary,{qty:Number.isFinite(summary.qty)?summary.qty:null,summaryBasis:'original'});
  }
  for(const d of snapshotCategories.values()){
   const key=d.date+'|'+d.category,group=categoryGroups.get(key);
   if(!group){categoryGroups.set(key,d);continue;}
   for(const k of ['sales','cost','ads','profit','rowCount'])group[k]+=d[k];
   for(const k of ['qty','adRevenue'])group[k]=Number.isFinite(group[k])&&Number.isFinite(d[k])?group[k]+d[k]:null;
   if(group.summaryBasis!==d.summaryBasis)group.summaryBasis='mixed';
  }
 }
 const dates=[...new Set(manifest.snapshots.map((s:any)=>s.date))].sort() as string[];
 const sourceTimes=snapshots.filter(s=>s.date>=from&&s.date<=to).map(s=>({date:s.date,sales:s.cutoffs?.sales,ads:s.cutoffs?.ads,sheet:s.sheet,basis:s.basis,observedAt:s.observedAt})).sort((a,b)=>a.date.localeCompare(b.date));
 return {from,to,days:[...dateGroups.values()].sort((a,b)=>a.date.localeCompare(b.date)),rows:combineRows(rows),dailyRows:categorized,categoryRows:combineRows(categorized),categoryDays:[...categoryGroups.values()],coverageByDay,history:manifest.snapshots,stats:{days:dates.length,revisions:manifest.snapshots.length,firstDate:dates[0]||null,lastDate:dates.at(-1)||null},notices,sourceTimes,publishedAt:manifest.publishedAt};
}
