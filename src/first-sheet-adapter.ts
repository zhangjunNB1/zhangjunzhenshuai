import {cents,cleanRow,total} from './profit.ts';
import type {Row} from './profit.ts';

export const FIRST_SHEET='SPU投产测算表';
export function adaptFirstSheet(raw:any,observedAt:string){
 const first=Object.keys(raw.sheets)[0];
 if(first!==FIRST_SHEET)throw new Error('第一个Sheet应为“'+FIRST_SHEET+'”，当前为“'+first+'”；停止导入，禁止回退到实时表');
 const g=raw.sheets[first],f=raw.formulas[first],salesSource=raw.sheets['商智SKU商品明细'],adsSource=raw.sheets['推广费'];
 if(!g||!f||!salesSource||!adsSource)throw new Error('缺少首表或其对应的日表来源');
 for(const [i,label] of [[1,'SKUID'],[15,'到手价'],[16,'数量'],[17,'GMV合计'],[18,'单品利润'],[20,'合计利润'],[22,'推广费用']] as const)if(g[3]?.[i]!==label)throw new Error('首表字段发生变化：'+label);
 const periods=[...new Set(salesSource.slice(1).filter((r:any)=>r[1]).map((r:any)=>String(r[0])))];
 const match=periods.length===1&&periods[0].match(/^(\d{4}-\d{2}-\d{2})~(\d{4}-\d{2}-\d{2})$/);
 if(!match||match[1]!==match[2])throw new Error('无法确认首表对应的单日业务日期，不能按上传日猜测');
 const date=match[1],compact=date.replaceAll('-','');
 const adPeriods=[...new Set(adsSource.slice(2).filter((r:any)=>/^[1-9]\d+$/.test(String(r[0]))).map((r:any)=>String(r[2])))];
 if(adPeriods.length!==1||adPeriods[0]!==compact+'~'+compact)throw new Error('首表的日表商智与推广费日期不一致');
 const included=new Set<number>();let formulaCount=0;
 for(let i=4;i<g.length;i++){const formula=String(f[i]?.[20]||'');if(!formula)continue;const ranges=[...formula.matchAll(/Q\$?(\d+):Q\$?(\d+)/g)];if(!formula.includes('SUMPRODUCT')||!ranges.length)throw new Error('首表第'+(i+1)+'行分组利润公式未识别');for(const m of ranges)for(let n=+m[1];n<=+m[2];n++){if(included.has(n))throw new Error('首表分组利润范围重叠：第'+n+'行');included.add(n);}formulaCount++;}
 if(!formulaCount)throw new Error('缺少首表分组利润公式');
 const sourceRows=salesSource.slice(2).filter((r:any)=>/^\d+$/.test(String(r[1]))),salesMap=new Map(sourceRows.map((r:any)=>[String(r[1]).replace(/^'/,''),r]));
 const adRows=adsSource.slice(2).filter((r:any)=>/^[1-9]\d+$/.test(String(r[0]))),adMap=new Map(adRows.map((r:any)=>[String(r[0]).replace(/^'/,''),r]));
 if(salesMap.size!==sourceRows.length||adMap.size!==adRows.length)throw new Error('日表来源存在重复SKU');
 const unknownPrices:string[]=[];
 const rows:Row[]=g.slice(4).map((r:any,i:number)=>({r,rowNo:i+5})).filter(({r}:any)=>r[1]).map(({r,rowNo}:any)=>{
  const sku=String(r[1]).trim().replace(/^'/,''),qty=Number(r[16]);if(!Number.isInteger(qty)||qty<0)throw new Error('首表第'+rowNo+'行成交数量无效');
  const sr:any=salesMap.get(sku),ad:any=adMap.get(sku);if(qty>0&&(!sr||Number(sr[8])!==qty))throw new Error('首表第'+rowNo+'行成交件数与日表商智不一致');
  const hasActual=qty>0&&typeof sr?.[13]==='number'&&Number(sr[13])>=0;
  if(qty>0&&!hasActual)unknownPrices.push(sku);
  const unit=cents(r[18],qty===0),gross=included.has(rowNo)?(unit??0)*qty:0,sales=cents(r[17])!,ads=cents(r[22])!;
  const normalized=cleanRow({sku,name:String(r[3]||r[2]||sku),spu:String(r[2]||'未分组'),qty,sales,cost:sales-gross,ads,profit:gross-ads,actualPrice:hasActual?cents(r[15],true):null,promoPrice:cents(r[4],true),unitProfit:hasActual?unit:null,adRevenue:ad?cents(ad[11],true):0,included:included.has(rowNo)});
  // cleanRow的通用回填不能用于本报表：没有真实成交价时必须保持缺失。
  if(!hasActual){normalized.actualPrice=null;normalized.unitProfit=null;}
  return normalized;
 });
 if(new Set(rows.map(r=>r.sku)).size!==rows.length)throw new Error('首表存在重复SKU');
 function summary(row:number){const r=g[row],sales=cents(r[24])!,gross=cents(r[20])!,ads=cents(r[22])!,profit=cents(r[23])!;return {sales,cost:sales-gross,ads,profit};}
 const summaryTotal=summary(0),categorySummaries=[{category:'base',...summary(1),qty:Number(g[1][18])},{category:'big',...summary(2),qty:Number(g[2][18])}];
 const known=new Set(rows.map(r=>r.sku)),missing=sourceRows.filter((r:any)=>Number(r[8])>0&&!known.has(String(r[1]))),missingSales=missing.reduce((a:number,r:any)=>a+cents(r[7])!,0),missingQty=missing.reduce((a:number,r:any)=>a+Number(r[8]),0);
 const warnings=[`数据来自第一个Sheet“${first}”，业务日期${date}；上传或发布日不等于业务日期。`,`全店与底板/大板卡片分别沿用首表第1、2、3行汇总。全店推广费包含S1京挑客${(cents(g[0][18])!/100).toFixed(2)}元，未强行分摊至商品。`];
 if(missing.length)warnings.push(`日表商智另有${missing.length}个已成交SKU未列入首表，${missingQty}件、销售额${(missingSales/100).toFixed(2)}元尚未计算成本及利润。`);
 if(unknownPrices.length)warnings.push(`${unknownPrices.length}个成交SKU缺少可核验的真实件单价，单件利润留空。`);
 return {date,capturedAt:observedAt,observedAt,source:`手动上传Excel / ${raw.file} / 第一个Sheet：${first}`,sheet:first,basis:'first-sheet',shop:'小米电视专卖店',status:'日表快照',rows,summary:summaryTotal,categorySummaries,cutoffs:{sales:null,ads:null},warnings,coverage:{profitSkus:rows.length,missingCount:missing.length,missingQty,missingSales},provenance:{sourceSha256:raw.sha256,sheet:first,sourcePeriod:date,observedAt,summaryCells:{sales:'Y1',grossProfit:'U1',ads:'W1',profit:'X1'},categoryCells:{base:'第2行 U/W/X/Y',big:'第3行 U/W/X/Y'},computed:total(rows),realPriceBasis:'首表P列到手价，先核验日表商智真实成交；无成交或缺失真实件单价时留空',skuProfitBasis:'首表分组SUMPRODUCT覆盖范围内的Q×S−W；不将组级U/X重复分配给每条SKU',sourceTimeNote:'日表未提供精确截止时刻；capturedAt为本次读取归档时间，不是实时来源截止时间'}};
}
