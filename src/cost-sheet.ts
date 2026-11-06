import {amount,merchantIdentifier,validateWorkspace} from './workbench-model.ts';
import {isDay} from './profit.ts';
import type {Workspace,CostVersion} from './workbench-model.ts';
export type CostMapping={sku:number;base:number;shipping:number;shippingMode:number;other:number};
export type CostDefaults={shippingMode:'included'|'none'|'extra'|'';shipping:string;other:string;effectiveFrom:string;blankShippingZero?:boolean;skipMissingCost?:boolean;skipMissingSku?:boolean};
export type CostSheetRow={merchantSku:string;row:number;version:CostVersion};
const headers:Record<keyof CostMapping,string[]>={sku:['商家SKU','商家SKU编码','商家编码','型号','型号编码','货品编码','SKU'],base:['含税成本','含税成本价','采购成本','采购价','进货价','成本价','货品成本','成本','单价'],shipping:['运费','物流费','单件运费'],shippingMode:['运费规则','是否有运费','运费类型'],other:['其他费用','其他单件费用']};
export function guessCostMapping(row:any[]):CostMapping{const clean=(x:any)=>String(x??'').trim().replace(/[\s_]/g,'').toLowerCase();return Object.fromEntries(Object.entries(headers).map(([key,names])=>[key,row.findIndex(v=>names.some(n=>clean(v)===clean(n)))])) as CostMapping;}
export function findCostHeader(rows:any[][]){let best=-1,score=7;for(let i=0;i<Math.min(50,rows.length);i++){const m=guessCostMapping(rows[i]),s=(m.sku>=0?4:0)+(m.base>=0?4:0);if(s>score){score=s;best=i;}}return best;}
export const originalCostMapping:CostMapping={sku:0,base:2,shipping:4,shippingMode:-1,other:-1};
export function parseCostSheet(rows:any[][],header:number,m:CostMapping,defaults:CostDefaults):CostSheetRow[]{
 if(m.sku<0||m.base<0||m.sku===m.base)throw Error('请选择不同的商家SKU列和采购成本列');const used=Object.values(m).filter(i=>i>=0);if(new Set(used).size!==used.length)throw Error('不同成本字段不能映射到同一列');if(!isDay(defaults.effectiveFrom))throw Error('请选择成本生效日期');
 const keys=new Set<string>(),out:CostSheetRow[]=[],stamp=new Date().toISOString();
 for(let i=header+1;i<rows.length;i++){const r=rows[i];if(r.every(v=>v===''||v===null))continue;if(['合计','总计','汇总'].includes(String(r[m.sku]).trim()))continue;
  try{if(defaults.skipMissingSku&&!String(r[m.sku]??'').trim())continue;if(defaults.skipMissingCost&&(r[m.base]===''||r[m.base]===null||r[m.base]===undefined))continue;const merchantSku=merchantIdentifier(r[m.sku]);if(keys.has(merchantSku))throw Error('商家SKU重复，需先核实是哪一条成本');keys.add(merchantSku);const base=amount(r[m.base],'采购成本');
   let mode:CostVersion['shippingMode']|''=defaults.shippingMode,shipping=0;
   const flag=m.shippingMode>=0?String(r[m.shippingMode]??'').trim():'';
   if(flag){if(['已含','含运费','已含运费','运费已含','included'].includes(flag))mode='included';else if(['无','无运费','无额外运费','否','none'].includes(flag))mode='none';else if(['有','有运费','另计','另计运费','是','extra'].includes(flag))mode='extra';else throw Error('未识别运费规则“'+flag+'”，请手动核实');}
   let shippingRaw=m.shipping>=0?r[m.shipping]:defaults.shipping;if(defaults.blankShippingZero&&(shippingRaw===''||shippingRaw===null||shippingRaw===undefined))shippingRaw='0';
   if(!mode&&m.shipping>=0&&shippingRaw!==''&&shippingRaw!==null&&shippingRaw!==undefined){shipping=amount(shippingRaw,'运费');mode=shipping>0?'extra':'none';}
   if(!mode)throw Error('缺少运费规则，请指定无额外运费、已含运费或另计运费');
   if(mode==='extra')shipping=amount(shippingRaw,'额外单件运费');
   else if(m.shipping>=0&&shippingRaw!==''&&amount(shippingRaw,'运费')>0)throw Error('运费金额大于0但规则不是另计，请确认是否已包含');
   const other=amount(m.other>=0?r[m.other]:defaults.other,'其他单件费用');
   out.push({merchantSku,row:i+1,version:{effectiveFrom:defaults.effectiveFrom,updatedAt:stamp,base,shippingMode:mode,shipping,commissionBps:0,other}});
  }catch(e){throw Error(`成本校对第${i+1}行：${(e as Error).message}`);}
 }
 if(!out.length)throw Error('成本校对没有可导入记录');return out;
}
export function importCostSheet(w:Workspace,rows:CostSheetRow[],source:{file:string;sheet:string;fingerprint:string}):Workspace{
 if(source.sheet!=='成本校对')throw Error('成本来源必须是“成本校对”工作表');const costs=w.costs.map(c=>({...c,versions:[...c.versions]}));let added=0;
 for(const r of rows){let c=costs.find(c=>c.merchantSku===r.merchantSku);if(!c){c={merchantSku:r.merchantSku,versions:[]};costs.push(c);}if(c.versions.some(v=>v.source?.fingerprint===source.fingerprint))continue;c.versions.push({...r.version,source:{...source,row:r.row}});added++;}
 if(!added)throw Error('这份成本校对及相同导入设置已保存，未重复导入');return validateWorkspace({...w,costs});
}
