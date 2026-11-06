import {validateWorkspace} from './workbench-model.ts';
import type {Workspace} from './workbench-model.ts';
const contents='https://api.github.com/repos/zhangjunNB1/zhangjunzhenshuai/contents/data/workbench.json';
export const BASE_KEY='mi-tv-workbench-cloud-base-v1';
function decode(content:string){const bytes=Uint8Array.from(atob(content.replace(/\s/g,'')),c=>c.charCodeAt(0));return validateWorkspace(JSON.parse(new TextDecoder().decode(bytes)));}
function encode(content:string){const bytes=new TextEncoder().encode(content);let result='';for(let i=0;i<bytes.length;i+=8192)result+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(result);}
async function fileWorkspace(file:any,headers:Record<string,string>){if(file.encoding==='base64'&&file.content)return decode(file.content);const response=await fetch(contents+'?ref=main',{cache:'no-store',headers:{...headers,Accept:'application/vnd.github.raw+json'}});if(!response.ok)throw Error('无法读取完整GitHub资料');return validateWorkspace(await response.json());}
export async function loadGithubWorkspace(){const headers={Accept:'application/vnd.github+json'},response=await fetch(contents+'?ref=main',{cache:'no-store',headers});if(!response.ok)throw Error('无法读取GitHub最新资料，请稍后重试');const file=await response.json();return {workspace:await fileWorkspace(file,headers),sha:file.sha};}
export async function publishWorkspace(workspace:Workspace,base:string,token:string){
 if(!token.trim())throw Error('请填写仅授权本仓库Contents读写权限的GitHub令牌');
 const headers={Accept:'application/vnd.github+json',Authorization:'Bearer '+token.trim(),'Content-Type':'application/json'};
 const current=await fetch(contents+'?ref=main',{headers,cache:'no-store'});if(!current.ok)throw Error(current.status===401?'令牌无效或已过期':'读取仓库失败，请核实令牌对本仓库的权限');
 const file=await current.json(),remote=await fileWorkspace(file,headers);if(JSON.stringify(remote)!==base)throw Error('仓库资料已有新版本。请先备份草稿，再载入仓库最新资料后继续修改，避免覆盖他人的更新');
 const response=await fetch(contents,{method:'PUT',headers,body:JSON.stringify({message:'Update workbench products, costs and reports',branch:'main',sha:file.sha,content:encode(JSON.stringify(validateWorkspace(workspace)))})});
 if(!response.ok)throw Error(response.status===409||response.status===422?'保存发生版本冲突，请载入最新资料后重试':'发布失败，请核实Contents写入权限及仓库保护规则');
 return (await response.json()).commit.html_url as string;
}
