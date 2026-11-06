import {makeOverview,selectLatest} from './archive-model';
let manifestPromise:Promise<any>|undefined;
const files=new Map<string,Promise<any>>();
async function json(file:string){const r=await fetch(new URL('data/'+file,document.baseURI),{cache:'no-store'});if(!r.ok)throw new Error('历史档案未能加载，请刷新后重试');return r.json();}
export function manifest(){return manifestPromise??=json('manifest.json');}
export async function reloadArchive(){manifestPromise=undefined;files.clear();return manifest();}
function snapshot(file:string){if(!files.has(file))files.set(file,json(file));return files.get(file)!;}
export async function archiveResponse(url:string){try{const u=new URL(url,location.href),from=u.searchParams.get('from')!,to=u.searchParams.get('to')!;if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)throw new Error('请选择有效的日期范围');const m=await manifest();const selected=selectLatest(m.snapshots).filter(s=>s.date>=from&&s.date<=to);const data=makeOverview(m,await Promise.all(selected.map(s=>snapshot(s.file))),from,to);return Response.json(data);}catch(e){return Response.json({error:(e as Error).message},{status:400});}}
export async function catalog(){const [m,products]=await Promise.all([manifest(),json('catalog.json')]);return {...m,catalog:products};}
export async function downloadSnapshot(id:string){const m=await manifest(),entry=m.snapshots.find((s:any)=>s.id===id);if(!entry)return;const data=await snapshot(entry.file);const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='利润快照_'+entry.date+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);}
