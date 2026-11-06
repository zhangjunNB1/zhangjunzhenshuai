import {isDay} from './profit.ts';
import {resolveCategory} from './category-policy.ts';
import type {Category} from './category-policy.ts';

export type LinkType='normal'|'national'|'hundred';
export type BaseOverride={effectiveFrom:string;updatedAt:string;base:number|null};
export type RateOverride={effectiveFrom:string;updatedAt:string;bps:number|null};
export type Product={sku:string;name:string;merchantSku:string;url:string;bundleId:string;category:Category;verified:boolean;costSku?:string;linkType?:LinkType|'';baseOverrides?:BaseOverride[];commissionOverrides?:RateOverride[]};
export type CostVersion={effectiveFrom:string;updatedAt:string;base:number;shippingMode:'included'|'none'|'extra';shipping:number;commissionBps:number;other:number;source?:{file:string;sheet:string;row:number;fingerprint:string}};
export type CommissionPolicy={id:LinkType;versions:{effectiveFrom:string;updatedAt:string;bps:number}[]};
export type Cost={merchantSku:string;versions:CostVersion[]};
export type BundleVersion={effectiveFrom:string;updatedAt:string;extra:number};
export type Bundle={id:string;name:string;versions:BundleVersion[]};
export type ReportRow={date:string;sku:string;name:string;merchantSku:string;qty:number;sales:number;ads:number;adRevenue:number|null};
export type Report={id:string;kind:'sales'|'ads';filename:string;createdAt:string;dates:string[];rows:ReportRow[]};
export type Workspace={version:1;products:Product[];costs:Cost[];bundles:Bundle[];reports:Report[];overheads:{date:string;amount:number}[];commissions?:CommissionPolicy[]};
export type Result={date:string;sku:string;name:string;merchantSku:string;category:Category;bundle:string;qty:number;sales:number;ads:number|null;adRevenue:number|null;cost:number|null;productCost:number|null;commission:number|null;commissionBps:number|null;linkType:string;profit:number|null;actualPrice:number|null;unitProfit:number|null;issues:string[]};
export const STORAGE_KEY='mi-tv-workbench-v1';
const idPattern=/^[A-Za-z0-9_+.-]{1,120}$/;
export function identifier(v:unknown){if(typeof v==='number'&&!Number.isSafeInteger(v))throw Error('SKU数字超出安全精度，请在源文件中按文本保存');const s=String(v??'').trim().replace(/^'/,'');if(!idPattern.test(s)||/e\+\d/i.test(s))throw Error('SKU须为完整文本，不能包含空格或科学计数法');return s;}
export function merchantIdentifier(v:unknown){const s=String(v??'').trim().replace(/^'/,'');if(!s||s.length>120||/[\x00-\x1f<>]/.test(s)||/e\+\d/i.test(s))throw Error('商家SKU须为完整编码，最多120个字符');return s;}
export function amount(v:unknown,label='金额'){const s=String(v??'').trim().replace(/[,，￥¥\s]/g,'');if(!s||!/^\d+(\.\d{1,2})?$/.test(s))throw Error(label+'须为非负金额，最多两位小数');const n=Math.round(Number(s)*100);if(!Number.isSafeInteger(n)||n>1e12)throw Error(label+'超出有效范围');return n;}
export function rateBps(v:unknown){const n=amount(v,'佣金费率');if(n>10000)throw Error('佣金费率须在0%到100%之间');return n;}
function dated<T extends {effectiveFrom:string;updatedAt:string}>(versions:T[],date:string):T|undefined{return versions.map((v,index)=>({v,index})).filter(({v})=>v.effectiveFrom<=date).sort((a,b)=>b.v.effectiveFrom.localeCompare(a.v.effectiveFrom)||b.v.updatedAt.localeCompare(a.v.updatedAt)||b.index-a.index)[0]?.v;}
function commissionAmount(sales:number,bps:number){return Number((BigInt(sales)*BigInt(bps)+5000n)/10000n);}
export function costAt(w:Workspace,merchantSku:string,date:string){return dated(w.costs.find(c=>c.merchantSku===merchantSku)?.versions||[],date);}
export function bundleAt(w:Workspace,id:string,date:string){return dated(w.bundles.find(b=>b.id===id)?.versions||[],date);}
export const linkLabels:Record<LinkType,string>={normal:'正常链接',national:'国补链接',hundred:'百补链接'};
export function commissionAt(w:Workspace,p:Product,date:string){const custom=dated(p.commissionOverrides||[],date);if(custom&&custom.bps!==null)return {bps:custom.bps,origin:'该SKU单独扣点'};const v=dated(w.commissions?.find(c=>c.id===p.linkType)?.versions||[],date);return {bps:v?.bps??null,origin:p.linkType?linkLabels[p.linkType]:'未标记链接类型'};}
export function createWorkspace(snapshot:any,manifest:any):Workspace{
 const products:Product[]=snapshot.rows.map((r:any)=>({sku:r.sku,name:r.name,merchantSku:r.spu,url:/^\d+$/.test(r.sku)?'https://item.jd.com/'+r.sku+'.html':'',bundleId:'',category:resolveCategory(r.sku,r.spu,snapshot.date,manifest.rules),verified:false}));
 return {version:1,products,costs:[...new Set(products.map(p=>p.merchantSku))].sort().map(merchantSku=>({merchantSku,versions:[]})),bundles:[{id:'single',name:'单品',versions:[{effectiveFrom:'2000-01-01',updatedAt:'2000-01-01T00:00:00Z',extra:0}]},{id:'install',name:'安装板',versions:[]},{id:'mobile',name:'移动电视版',versions:[]},{id:'cinema',name:'影院版',versions:[]}],reports:[],overheads:[]};
}
export function unitCost(w:Workspace,p:Product,date:string){
 const c=costAt(w,p.costSku||p.merchantSku,date),b=bundleAt(w,p.bundleId,date),override=dated(p.baseOverrides||[],date);const issues:string[]=[];
 if(!p.verified)issues.push('商品对应关系待核实');if(!p.bundleId)issues.push('未标记套装');if(!c)issues.push('缺少当日有效货品成本');if(p.bundleId&&!b)issues.push('缺少当日有效套装成本');
 return {cost:c&&b?(override?.base??c.base)+(c.shippingMode==='extra'?c.shipping:0)+b.extra+c.other:null,base:override?.base??c?.base,c,b,issues};
}
export function simulate(input:{price:number;qty:number;base:number;shipping:number;extra:number;other:number;commissionBps:number;ads:number}){
 for(const [k,n] of Object.entries(input))if(!Number.isSafeInteger(n)||n<0||n>1e12)throw Error('试算参数无效：'+k);
 if(input.qty<1||input.qty>1e6||input.commissionBps>10000)throw Error('试算数量或佣金费率无效');
 const sales=input.price*input.qty,productCost=(input.base+input.shipping+input.extra+input.other)*input.qty;if(!Number.isSafeInteger(sales)||!Number.isSafeInteger(productCost))throw Error('试算金额超出有效范围');const commission=commissionAmount(sales,input.commissionBps),profit=sales-productCost-commission-input.ads;
 if(![sales,productCost,commission,profit].every(Number.isSafeInteger))throw Error('试算金额超出有效范围');
 const denominator=1-input.commissionBps/10000,breakEven=denominator>0?Math.ceil((productCost+input.ads)/input.qty/denominator):null;
 return {sales,productCost,commission,ads:input.ads,profit,rate:sales?profit/sales*100:null,breakEven};
}
export function addReport(w:Workspace,report:Report){
 if(w.reports.some(r=>r.id===report.id))throw Error('这份文件已导入，未重复计入');
 const products=[...w.products];const known=new Set(products.map(p=>p.sku));
 for(const r of report.rows)if(!known.has(r.sku)){known.add(r.sku);products.push({sku:r.sku,name:r.name||r.sku,merchantSku:r.merchantSku,url:/^\d+$/.test(r.sku)?'https://item.jd.com/'+r.sku+'.html':'',bundleId:'',category:'unclassified',verified:false});}
 return {...w,products,reports:[...w.reports,report]};
}
export function calculate(w:Workspace,from:string,to:string):Result[]{
 const latest=new Map<string,Report>();for(const r of w.reports)for(const d of r.dates)latest.set(r.kind+'|'+d,r);
 const dates=[...new Set(w.reports.flatMap(r=>r.dates))].filter(d=>d>=from&&d<=to).sort(),products=new Map(w.products.map(p=>[p.sku,p])),result:Result[]=[];
 for(const date of dates){
  const salesReport=latest.get('sales|'+date),adsReport=latest.get('ads|'+date),salesRows=new Map<string,ReportRow>(),adsRows=new Map<string,ReportRow>();
  for(const r of salesReport?.rows||[])if(r.date===date)salesRows.set(r.sku,r);
  for(const r of adsReport?.rows||[])if(r.date===date){const old=adsRows.get(r.sku);adsRows.set(r.sku,old?{...r,ads:old.ads+r.ads,adRevenue:old.adRevenue===null||r.adRevenue===null?null:old.adRevenue+r.adRevenue}:r);}
  const skus=new Set([...salesRows.keys(),...adsRows.keys()]);
  for(const sku of skus){const s=salesRows.get(sku),a=adsRows.get(sku),p=products.get(sku);const qty=s?.qty||0,sales=s?.sales||0,ads=adsReport?(a?.ads||0):null,unit=p?unitCost(w,p,date):null;const issues:string[]=[];
   if(!salesReport)issues.push('缺少当日商智数据');if(!adsReport)issues.push('缺少当日推广数据');if(!p)issues.push('未关联商品');
   const rate=p?commissionAt(w,p,date):{bps:null,origin:'未关联商品'};
   if(qty>0){issues.push(...(unit?.issues||[]));if(rate.bps===null)issues.push('缺少当日有效链接扣点');}
   if(qty===0&&sales!==0)issues.push('有金额但成交件数为零，需核实');
   const rawProductCost=qty===0?0:unit?.cost!==null&&unit?.cost!==undefined?unit.cost*qty:null;
   const productCost=rawProductCost===null||!Number.isSafeInteger(rawProductCost)?null:rawProductCost;
   if(rawProductCost!==null&&productCost===null)issues.push('货品成本总额超出有效精度');
   const commission=qty===0?0:rate.bps===null?null:commissionAmount(sales,rate.bps);
   const cost=productCost===null||commission===null?null:productCost+commission;
   const profit=issues.length||cost===null||ads===null?null:sales-cost-ads;
   result.push({date,sku,name:p?.name||s?.name||a?.name||sku,merchantSku:p?.merchantSku||'',category:p?.category||'unclassified',bundle:w.bundles.find(b=>b.id===p?.bundleId)?.name||'未标记',qty,sales,ads,adRevenue:adsReport?a?.adRevenue??null:null,cost,productCost,commission,commissionBps:rate.bps,linkType:rate.origin,profit,actualPrice:qty?Math.round(sales/qty):null,unitProfit:qty&&cost!==null&&!unit?.issues.length?Math.round((sales-cost)/qty):null,issues});
  }
 }
 return result;
}
export function validateWorkspace(raw:any):Workspace{
 const fail=()=>{throw Error('备份格式无效或包含不合法数据，未覆盖现有资料');};
 const cash=(n:any)=>Number.isSafeInteger(n)&&n>=0&&n<=1e12;const day=(s:any)=>typeof s==='string'&&isDay(s);const stamp=(s:any)=>typeof s==='string'&&Number.isFinite(Date.parse(s));const text=(s:any,max=300)=>typeof s==='string'&&s.length<=max;
 if(!raw||raw.version!==1||!['products','costs','bundles','reports','overheads'].every(k=>Array.isArray(raw[k])))fail();
 if(raw.products.length>50000||raw.reports.length>2000)fail();
 for(const p of raw.products){try{identifier(p.sku);if(p.merchantSku)merchantIdentifier(p.merchantSku);}catch{fail();}if(!text(p.sku,120)||!text(p.merchantSku,120)||!text(p.name)||!text(p.url,2000)||!text(p.bundleId,120)||typeof p.verified!=='boolean'||!['base','big','unclassified'].includes(p.category)||p.url&&!/^https?:\/\//i.test(p.url))fail();}
 if(new Set(raw.products.map((p:any)=>p.sku)).size!==raw.products.length)fail();
 for(const p of raw.products){if(p.costSku!==undefined&&!text(p.costSku,120))fail();if(p.costSku){try{merchantIdentifier(p.costSku);}catch{fail();}}if(p.linkType!==undefined&&p.linkType!==''&&!Object.hasOwn(linkLabels,p.linkType))fail();for(const [field,key,max] of [['baseOverrides','base',1e12],['commissionOverrides','bps',10000]] as const){if(p[field]!==undefined){if(!Array.isArray(p[field]))fail();for(const v of p[field])if(!day(v.effectiveFrom)||!stamp(v.updatedAt)||v[key]!==null&&(!cash(v[key])||v[key]>max))fail();}}}
 if(raw.commissions!==undefined){if(!Array.isArray(raw.commissions)||new Set(raw.commissions.map((p:any)=>p.id)).size!==raw.commissions.length)fail();for(const p of raw.commissions){if(!Object.hasOwn(linkLabels,p.id)||!Array.isArray(p.versions))fail();for(const v of p.versions)if(!day(v.effectiveFrom)||!stamp(v.updatedAt)||!cash(v.bps)||v.bps>10000)fail();}}
 for(const c of raw.costs){try{merchantIdentifier(c.merchantSku);}catch{fail();}if(!text(c.merchantSku,120)||!Array.isArray(c.versions))fail();for(const v of c.versions){if(!day(v.effectiveFrom)||!stamp(v.updatedAt)||!['base','shipping','other','commissionBps'].every(k=>cash(v[k]))||v.commissionBps>10000||!['included','none','extra'].includes(v.shippingMode))fail();if(v.source&&(!text(v.source.file)||v.source.sheet!=='成本校对'||!Number.isSafeInteger(v.source.row)||v.source.row<1||typeof v.source.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(v.source.fingerprint)))fail();}}
 if(new Set(raw.costs.map((c:any)=>c.merchantSku)).size!==raw.costs.length)fail();
 for(const b of raw.bundles){if(!text(b.id,120)||!b.id||!text(b.name,80)||!b.name||!Array.isArray(b.versions))fail();for(const v of b.versions)if(!day(v.effectiveFrom)||!stamp(v.updatedAt)||!cash(v.extra))fail();}
 if(new Set(raw.bundles.map((b:any)=>b.id)).size!==raw.bundles.length)fail();
 for(const p of raw.products)if(p.bundleId&&!raw.bundles.some((b:any)=>b.id===p.bundleId))fail();
 for(const r of raw.reports){if(!text(r.id,150)||!['sales','ads'].includes(r.kind)||!text(r.filename)||!stamp(r.createdAt)||!Array.isArray(r.dates)||!r.dates.length||!r.dates.every(day)||!Array.isArray(r.rows)||r.rows.length>100000)fail();const keys=new Set();for(const row of r.rows){try{identifier(row.sku);}catch{fail();}if(!day(row.date)||!r.dates.includes(row.date)||!text(row.name)||!text(row.merchantSku,120)||!['qty','sales','ads'].every(k=>cash(row[k]))||row.adRevenue!==null&&!cash(row.adRevenue))fail();const key=row.date+'|'+row.sku;if(r.kind==='sales'&&keys.has(key))fail();keys.add(key);}}
 if(new Set(raw.reports.map((r:any)=>r.id)).size!==raw.reports.length)fail();
 for(const v of raw.overheads)if(!day(v.date)||!cash(v.amount))fail();
 if(new Set(raw.overheads.map((v:any)=>v.date)).size!==raw.overheads.length)fail();
 return raw as Workspace;
}
