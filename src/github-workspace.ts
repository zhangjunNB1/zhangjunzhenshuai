import {hydratePublishedWorkspace,packPublishedWorkspace,publishedReportPaths,retainPublishedReports} from './report-storage.ts';
import type {Workspace} from './workbench-model.ts';

const repository = 'zhangjunNB1/zhangjunzhenshuai';
const api = `https://api.github.com/repos/${repository}`;
const raw = `https://raw.githubusercontent.com/${repository}`;
const headers = {Accept:'application/vnd.github+json'};
export const BASE_KEY = 'mi-tv-workbench-cloud-base-v1';

async function json(path: string, method = 'GET', token?: string, body?: unknown) {
  const response = await fetch(api + path, {
    method, cache:'no-store',
    headers:{...headers, ...(token && {Authorization:`Bearer ${token}`}), ...(body && {'Content-Type':'application/json'})},
    body:body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    if (response.status === 401) throw Error('令牌无效或已过期');
    if (response.status === 409 || response.status === 422) throw Error('发布遇到版本冲突，请载入最新资料后重试');
    throw Error(`GitHub 请求失败（${response.status}）。请检查网络、令牌权限或仓库保护规则。`);
  }
  return response.json();
}

async function readAt(path: string, commit: string) {
  const response = await fetch(`${raw}/${commit}/${path}`, {cache:'no-store'});
  if (!response.ok) throw Error(`GitHub 资料读取失败：${path}`);
  return response.text();
}

async function readWorkspace(commit: string) {
  const file = JSON.parse(await readAt('data/workbench.json', commit));
  const workspace = await hydratePublishedWorkspace(file, path => readAt(path, commit));
  return {file,workspace};
}

async function head(token?: string) {
  const {object:{sha}} = await json('/git/ref/heads/main','GET',token);
  if (!/^[0-9a-f]{40}$/.test(sha)) throw Error('无法确认 GitHub 主分支版本');
  return sha as string;
}

export async function loadGithubWorkspace() {
  const sha = await head();
  const {workspace} = await readWorkspace(sha);
  return {workspace,sha};
}

export async function publishWorkspace(workspace: Workspace,base: string,token: string) {
  token = token.trim();
  if (!token) throw Error('请填写仅授权本仓库 Contents 读写权限的 GitHub 令牌');
  const sha = await head(token);
  const {file,workspace:published} = await readWorkspace(sha);
  if (JSON.stringify(published) !== base) {
    throw Error('仓库资料已有新版本。请先备份草稿，再载入 GitHub 最新资料。');
  }
  const retained = retainPublishedReports(published, workspace);
  const output = await packPublishedWorkspace(retained);
  const known = publishedReportPaths(file);
  const files = output.files.filter(entry => !known.has(entry.path));
  files.push({path:'data/workbench.json',content:output.manifestText});

  // Files and the index become visible together after advancing the branch reference.
  const current = await json(`/git/commits/${sha}`,'GET',token);
  let tree = current.tree.sha as string;
  for (let offset = 0; offset < files.length; offset += 10) {
    const entries = files.slice(offset, offset + 10).map(file => ({...file,mode:'100644',type:'blob'}));
    tree = (await json('/git/trees','POST',token,{base_tree:tree,tree:entries})).sha;
  }
  const next = await json('/git/commits','POST',token,{message:'Archive workbench data and report revisions',tree,parents:[sha]});
  await json('/git/refs/heads/main','PATCH',token,{sha:next.sha,force:false});
  return {url:`https://github.com/${repository}/commit/${next.sha}`,workspace:retained};
}
