export type Category='base'|'big'|'unclassified';
export type CategoryRule={id:string;level:'sku'|'spu';target:string;category:Category|'inherit';effectiveFrom:string;createdAt:string};
export const categoryLabels:Record<Category,string>={base:'底板机',big:'大板机',unclassified:'未分类'};
export function resolveCategory(sku:string,spu:string,date:string,rules:CategoryRule[]):Category{
 const find=(level:'sku'|'spu',target:string)=>rules.filter(r=>r.level===level&&r.target===target&&r.effectiveFrom<=date).sort((a,b)=>b.effectiveFrom.localeCompare(a.effectiveFrom)||b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id))[0]?.category;
 const skuRule=find('sku',sku);if(skuRule&&skuRule!=='inherit')return skuRule;
 const model=find('spu',spu);return model&&model!=='inherit'?model:'unclassified';
}
// Both precedence and effective business date are enforced in the database query.
export function categoryExpression(date='s.business_date'){
 const rule=(level:string,target:string)=>`(SELECT cr.category FROM classification_rules cr WHERE cr.level='${level}' AND cr.target=${target} AND cr.effective_from<=${date} ORDER BY cr.effective_from DESC,cr.created_at DESC,cr.id DESC LIMIT 1)`;
 return `COALESCE(NULLIF(${rule('sku','r.sku')},'inherit'),${rule('spu','r.spu')},'unclassified')`;
}
