import {read,utils} from 'xlsx';
import {identifier,merchantIdentifier,amount} from './workbench-model.ts';
import {isDay} from './profit.ts';
import type {Report,ReportRow} from './workbench-model.ts';

export type Mapping={sku:number;date:number;name:number;merchantSku:number;qty:number;sales:number;ads:number;adRevenue:number};
export const aliases:Record<keyof Mapping,string[]>={sku:['SKUID','SKU编号','商品SKU编号','商品SKU','SKU','商品编号'],date:['日期','统计日期','业务日期','时间','统计时间'],name:['商品名称','SKU名称','商品标题','SKU规格'],merchantSku:['商家SKU','商家编码','商家SKU编码','货号','型号'],qty:['成交商品件数','成交件数','成交商品数量','成交数量','成交单量','数量'],sales:['成交金额','成交金额(元)','成交金额（元）','成交金额(总)','销售额','GMV合计','销售金额'],ads:['花费','总花费','消耗','总消耗','推广费用','推广费','花费(元)','花费（元）'],adRevenue:['广告归因成交额','总订单金额','总成交金额','总订单金额(元)','总订单金额（元）']};
function norm(v:any){return String(v??'').trim().replace(/[\s_]/g,'').toLowerCase();}
export function guessMapping(header:any[]):Mapping{return Object.fromEntries(Object.entries(aliases).map(([k,names])=>[k,header.findIndex(v=>names.some(n=>norm(n)===norm(v)))])) as Mapping;}
export function findHeader(rows:any[][],kind:'sales'|'ads'){let best=0,score=-1;for(let i=0;i<Math.min(50,rows.length);i++){const m=guessMapping(rows[i]),s=(m.sku>=0?5:0)+(kind==='sales'?(m.qty>=0?3:0)+(m.sales>=0?3:0):(m.ads>=0?6:0));if(s>score){best=i;score=s;}}return best;}
export function readReport(buffer:ArrayBuffer){const wb=read(buffer,{type:'array',raw:true,cellDates:false});return wb.SheetNames.map(name=>({name,rows:utils.sheet_to_json<any[]>(wb.Sheets[name],{header:1,defval:'',raw:true,blankrows:false})}));}
export function reportDate(value:any,fallback:string):string{
 if(value===''||value===null||value===undefined){if(!isDay(fallback))throw Error('缺少业务日期，请选择文件日期列或填写业务日期');return fallback;}
 if(typeof value==='number'&&value>20000&&value<100000){const d=new Date(Date.UTC(1899,11,30)+Math.floor(value)*86400000).toISOString().slice(0,10);if(isDay(d))return d;}
 const s=String(value).trim().replace(/[年月/.]/g,'-').replace(/日/g,'');
 const compact=s.match(/^(\d{4})(\d{2})(\d{2})(?:~(\d{4})(\d{2})(\d{2}))?$/);
 if(compact){const d=`${compact[1]}-${compact[2]}-${compact[3]}`;if(compact[4]&&d!==`${compact[4]}-${compact[5]}-${compact[6]}`)throw Error('累计多日金额不能拆成日报，请导出按日数据');if(isDay(d))return d;}
 const parts=s.match(/\d{4}-\d{1,2}-\d{1,2}/g);
 if(parts?.length){const normalized=parts.map(p=>{const [y,m,d]=p.split('-');return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;});if(normalized.some(d=>d!==normalized[0]))throw Error('累计多日金额不能拆成日报，请导出按日数据');if(isDay(normalized[0]))return normalized[0];}
 throw Error('无法识别业务日期：'+String(value).slice(0,50));
}
export function parseReport(rows:any[][],headerIndex:number,mapping:Mapping,kind:'sales'|'ads',fallbackDate:string):{rows:ReportRow[];dates:string[];ignored:number}{
 if(mapping.sku<0||(kind==='sales'&&(mapping.qty<0||mapping.sales<0))||(kind==='ads'&&mapping.ads<0))throw Error('请先指定SKU及必填金额/数量列');
 const relevant=[mapping.sku,...(kind==='sales'?[mapping.qty,mapping.sales]:[mapping.ads]),mapping.date].filter(i=>i>=0);if(new Set(relevant).size!==relevant.length)throw Error('SKU、日期、金额和数量不能映射到同一列');
 if(rows.length>100001)throw Error('文件超过10万行，请按日期拆分导入');
 const parsed:ReportRow[]=[],dates=new Set<string>(),seen=new Set<string>();let ignored=0;
 for(let i=headerIndex+1;i<rows.length;i++){const r=rows[i];if(r.every(v=>v===''||v===null)){ignored++;continue;}const rawSku=String(r[mapping.sku]??'').trim();
  if(['合计','总计','汇总','全部'].includes(rawSku)){ignored++;continue;}
  try{const sku=identifier(r[mapping.sku]),date=reportDate(mapping.date>=0?r[mapping.date]:null,fallbackDate);let qty=0,sales=0,ads=0,adRevenue:number|null=null;
   if(kind==='sales'){const q=String(r[mapping.qty]??'').replace(/[,，]/g,'').trim();if(!/^\d+$/.test(q)||!Number.isSafeInteger(+q)||+q>1e8)throw Error('成交数量须为非负整数，退款数量请单独核对');qty=+q;sales=amount(r[mapping.sales],'成交金额');if(qty===0&&sales!==0)throw Error('成交件数为0但金额不为0');if(seen.has(date+'|'+sku))throw Error('同日SKU重复，请使用按日SKU汇总报表');seen.add(date+'|'+sku);}
   else{ads=amount(r[mapping.ads],'推广费');if(mapping.adRevenue>=0&&r[mapping.adRevenue]!=='')adRevenue=amount(r[mapping.adRevenue],'广告归因成交额');}
   const merchantSku=mapping.merchantSku>=0?String(r[mapping.merchantSku]??'').trim():'';if(merchantSku)merchantIdentifier(merchantSku);
   parsed.push({date,sku,name:mapping.name>=0?String(r[mapping.name]??'').slice(0,300):'',merchantSku,qty,sales,ads,adRevenue});dates.add(date);
  }catch(e){throw Error(`第${i+1}行：${(e as Error).message}`);}
 }
 if(!parsed.length)throw Error('没有可导入明细。请核对工作表、表头行和列映射');return {rows:parsed,dates:[...dates].sort(),ignored};
}
export async function makeReport(buffer:ArrayBuffer,filename:string,kind:'sales'|'ads',parsed:{rows:ReportRow[];dates:string[]}):Promise<Report>{const fileHash=await crypto.subtle.digest('SHA-256',buffer),hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(Array.from(new Uint8Array(fileHash)).join(',')+'|'+JSON.stringify(parsed))),hex=Array.from(new Uint8Array(hash)).map(x=>x.toString(16).padStart(2,'0')).join('');return {id:kind+'-'+hex,kind,filename,createdAt:new Date().toISOString(),...parsed};}
