import {identifier,merchantIdentifier,amount,rateBps,validateWorkspace,linkLabels} from './workbench-model.ts';
import type {Workspace,Product,LinkType} from './workbench-model.ts';
import {reportDate} from './report-import.ts';
import {isDay} from './profit.ts';

export const productColumns={sku:'平台SKU',merchantSku:'商家SKU',name:'商品名称',url:'销售链接',bundle:'套装类型',linkType:'链接类型',costSku:'关联成本SKU',base:'SKU基础成本（元）',rate:'平台扣点（%）',date:'生效日期',verified:'对应关系核实'};
export type ProductMapping=Record<keyof typeof productColumns,number>;
export type ProductSheetRow={row:number;product:Product;added:boolean;warnings:string[]};
const aliases:Record<keyof ProductMapping,string[]>={sku:['平台SKU','SKUID','SKU编号','商品SKU','商品SKU编号'],merchantSku:['商家SKU','商家SKU编码','商家编码','货号'],name:['商品名称','SKU规格','SKU名称','商品标题'],url:['销售链接','商品链接','前端链接','链接'],bundle:['套装类型','商品类型','套装'],linkType:['链接类型','补贴类型'],costSku:['关联成本SKU','成本关联SKU','成本SKU'],base:['SKU基础成本（元）','SKU基础成本(元)','SKU基础成本','覆盖基础成本'],rate:['平台扣点（%）','平台扣点(%)','平台扣点','佣金扣点','佣金（%）','扣点','佣金'],date:['生效日期','成本生效日期'],verified:['对应关系核实','核实状态','已核实']};
const clean=(v:unknown)=>String(v??'').trim().replace(/[\s_]/g,'').toLowerCase();
export function guessProductMapping(header:any[]):ProductMapping{return Object.fromEntries(Object.entries(aliases).map(([k,names])=>[k,header.findIndex(v=>names.some(n=>clean(v)===clean(n)))])) as ProductMapping;}
export function findProductHeader(rows:any[][]){let best=0,score=-1;for(let i=0;i<Math.min(rows.length,50);i++){const m=guessProductMapping(rows[i]),s=(m.sku>=0?10:0)+Object.values(m).filter(n=>n>=0).length;if(s>score){score=s;best=i;}}return best;}
export function parseProductSheet(rows:any[][],header:number,m:ProductMapping,w:Workspace,date:string):ProductSheetRow[]{
 if(m.sku<0)throw Error('请指定平台SKU列');if(!isDay(date))throw Error('请选择默认生效日期');
 const used=Object.values(m).filter(i=>i>=0);if(new Set(used).size!==used.length)throw Error('不同字段不能映射到同一列');
 if(rows.length>50001)throw Error('单次最多导入5万个商品');
 const out:ProductSheetRow[]=[],seen=new Set<string>(),stamp=new Date().toISOString();
 for(let i=header+1;i<rows.length;i++){
  const r=rows[i];if(used.every(c=>r[c]===undefined||r[c]===null||String(r[c]).trim()===''))continue;
  if(['合计','总计','汇总'].includes(String(r[m.sku]).trim()))continue;
  try{
   const sku=identifier(r[m.sku]);if(seen.has(sku))throw Error('平台SKU重复，请合并为一行后再导入');seen.add(sku);
   const previous=w.products.find(p=>p.sku===sku),p:Product=previous?{...previous}:{sku,name:'',merchantSku:'',url:'',bundleId:'',category:'unclassified',verified:false};
   const value=(k:keyof ProductMapping)=>m[k]>=0?String(r[m[k]]??'').trim():'';
   const effectiveFrom=value('date')?reportDate(r[m.date],date):date;
   if(value('merchantSku'))p.merchantSku=merchantIdentifier(r[m.merchantSku]);
   if(value('name'))p.name=value('name');
   if(!p.merchantSku||!p.name)throw Error('新增商品必须填写商家SKU和商品名称');
   if(value('url')){if(!/^https?:\/\//i.test(value('url')))throw Error('销售链接须以https://或http://开头');p.url=value('url');}
   if(value('bundle')){const name=value('bundle')==='安装版'?'安装板':value('bundle'),matches=w.bundles.filter(b=>b.name===name||b.id===name);if(matches.length!==1)throw Error('套装类型“'+name+'”未找到唯一规则，请先到产品成本库建立此类型');p.bundleId=matches[0].id;}
   if(value('linkType')){const names:Record<string,LinkType>={正常:'normal',普通:'normal',国补:'national',百补:'hundred',normal:'normal',national:'national',hundred:'hundred',...Object.fromEntries(Object.entries(linkLabels).map(([id,label])=>[label,id]))} as any;const id=names[value('linkType')];if(!id)throw Error('链接类型请填写正常链接、国补链接或百补链接');p.linkType=id;}
   if(value('costSku')){const costSku=merchantIdentifier(value('costSku'));if(!w.costs.some(c=>c.merchantSku===costSku))throw Error('关联成本SKU在成本库不存在');p.costSku=costSku;}
   if(value('base')){const base=['跟随','跟随成本库'].includes(value('base'))?null:amount(value('base'),'SKU基础成本');p.baseOverrides=[...(p.baseOverrides||[]),{effectiveFrom,updatedAt:stamp,base}];}
   if(value('rate')){const raw=value('rate'),bps=['跟随','跟随链接类型'].includes(raw)?null:rateBps(raw.replace(/[%％]$/,''));p.commissionOverrides=[...(p.commissionOverrides||[]),{effectiveFrom,updatedAt:stamp,bps}];}
   if(previous&&(p.merchantSku!==previous.merchantSku||p.bundleId!==previous.bundleId||p.costSku!==previous.costSku))p.verified=false;
   if(value('verified')){if(['已核实','是','true','1'].includes(value('verified')))p.verified=true;else if(['待核实','否','false','0'].includes(value('verified')))p.verified=false;else throw Error('对应关系核实请填写已核实或待核实');}
   const warnings:string[]=[];if(!w.costs.some(c=>c.merchantSku===(p.costSku||p.merchantSku)&&c.versions.length))warnings.push('成本库待补');if(!p.bundleId)warnings.push('套装未标记');if(!p.verified)warnings.push('对应关系待核实');
   out.push({row:i+1,product:p,added:!previous,warnings});
  }catch(e){throw Error(`前端商品第${i+1}行：${(e as Error).message}`);}
 }
 if(!out.length)throw Error('没有可导入商品，请核对表头行和列映射');return out;
}
export function importProductSheet(w:Workspace,rows:ProductSheetRow[]):Workspace{
 const products=new Map(w.products.map(p=>[p.sku,p]));for(const r of rows)products.set(r.product.sku,r.product);
 const costs=[...w.costs],known=new Set(costs.map(c=>c.merchantSku));for(const r of rows)if(!known.has(r.product.merchantSku)){known.add(r.product.merchantSku);costs.push({merchantSku:r.product.merchantSku,versions:[]});}
 return validateWorkspace({...w,products:[...products.values()],costs});
}
