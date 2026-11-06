import {isDay} from './profit.ts';
import {validateWorkspace,linkLabels} from './workbench-model.ts';
import type {Workspace,LinkType} from './workbench-model.ts';
export type BulkChange={bundleId?:string;category?:'base'|'big'|'unclassified';costMode?:'match'|'override'|'reset';costSku?:string;base?:number;linkType?:LinkType|'';rateMode?:'policy'|'override';bps?:number;effectiveFrom:string;verified?:boolean};
export function applyBulk(w:Workspace,selected:string[],change:BulkChange):Workspace{
 const ids=new Set(selected);if(!ids.size)throw Error('请先勾选商品');if([...ids].some(sku=>!w.products.some(p=>p.sku===sku)))throw Error('部分选中商品已不存在，请重新选择');
 if(!isDay(change.effectiveFrom))throw Error('请选择有效的生效日期');
 if(change.bundleId!==undefined&&change.bundleId&&!w.bundles.some(b=>b.id===change.bundleId))throw Error('所选套装规则不存在');
 if(change.costMode==='match'&&!w.costs.some(c=>c.merchantSku===change.costSku))throw Error('请选择成本库里的货品');
 if(change.costMode==='override'&&(!Number.isSafeInteger(change.base)||change.base!<0||change.base!>1e12))throw Error('基础成本覆盖金额无效');
 if(change.rateMode==='override'&&(!Number.isSafeInteger(change.bps)||change.bps!<0||change.bps!>10000))throw Error('单独扣点须在0%到100%之间');
 if(change.linkType&& !Object.hasOwn(linkLabels,change.linkType))throw Error('链接类型无效');
 if(Object.keys(change).every(k=>k==='effectiveFrom'))throw Error('请至少选择一个批量修改项目');
 const stamp=new Date().toISOString(),date=change.effectiveFrom;
 const products=w.products.map(p=>{if(!ids.has(p.sku))return p;const next={...p};if(change.bundleId!==undefined)next.bundleId=change.bundleId;if(change.category!==undefined)next.category=change.category;if(change.linkType!==undefined)next.linkType=change.linkType;if(change.verified!==undefined)next.verified=change.verified;
  if(change.costMode==='match'){next.costSku=change.costSku;next.baseOverrides=[...(p.baseOverrides||[]),{effectiveFrom:date,updatedAt:stamp,base:null}];}
  if(change.costMode==='override'||change.costMode==='reset')next.baseOverrides=[...(p.baseOverrides||[]),{effectiveFrom:date,updatedAt:stamp,base:change.costMode==='override'?change.base!:null}];
  if(change.rateMode)next.commissionOverrides=[...(p.commissionOverrides||[]),{effectiveFrom:date,updatedAt:stamp,bps:change.rateMode==='override'?change.bps!:null}];
  return next;
 });return validateWorkspace({...w,products});
}
