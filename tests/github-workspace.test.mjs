import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publishWorkspace,loadGithubWorkspace} from '../src/github-workspace.ts';
import {packPublishedWorkspace,hydratePublishedWorkspace} from '../src/report-storage.ts';

const empty = () => ({version:1,products:[],costs:[],bundles:[],reports:[],overheads:[]});
const day = '2026-11-15';
const report = (id, kind) => ({id,kind,filename:`${kind}.csv`,createdAt:'2026-11-17T00:00:00Z',dates:[day],rows:[]});
const head = 'a'.repeat(40);

test('日报按日期与内容保留各版，读取时拒绝损坏文件', async () => {
  const w = {...empty(),reports:[report('a','sales'),report('b','ads'),report('c','sales')]};
  const packed = await packPublishedWorkspace(w);
  const files = new Map(packed.files.map(file => [file.path,file.content]));
  assert.equal(files.size,3);
  assert.ok([...files.keys()].every(path => path.startsWith(`data/reports/${day}/`)));
  const manifest = JSON.parse(packed.manifestText);
  assert.deepEqual(manifest.reports,[]);
  assert.deepEqual(await hydratePublishedWorkspace(manifest, async path=>files.get(path)),w);
  await assert.rejects(hydratePublishedWorkspace(manifest,async path=>`${files.get(path)} `),/校验失败/);
});

test('发布保留已有日报，文件与索引随同一提交生效，远端变化时拒绝写入', async t => {
  const original = {...empty(),reports:[report('a','sales')]};
  const packed = await packPublishedWorkspace(original);
  const existingFile = packed.files[0];
  const mutations = [];
  t.mock.method(globalThis,'fetch',async (url,options) => {
    if (url.endsWith('/git/ref/heads/main')) return Response.json({object:{sha:head}});
    if (url.endsWith('/data/workbench.json')) return new Response(packed.manifestText);
    if (url.endsWith(existingFile.path)) return new Response(existingFile.content);
    if (url.endsWith(`/git/commits/${head}`)) return Response.json({tree:{sha:'old-tree'}});
    assert.equal(options.headers.Authorization,'Bearer test-session');
    const body = JSON.parse(options.body);
    mutations.push({url,body});
    if(url.endsWith('/git/trees'))return Response.json({sha:'new-tree'});
    if(url.endsWith('/git/commits'))return Response.json({sha:'new-commit'});
    if(url.endsWith('/git/refs/heads/main'))return Response.json({object:{sha:'new-commit'}});
    throw Error('Unexpected request');
  });
  assert.deepEqual((await loadGithubWorkspace()).workspace,original);
  const draft = {...empty(),reports:[report('b','ads')]};
  await assert.rejects(publishWorkspace(draft,JSON.stringify(draft),'test-session'),/已有新版本/);
  assert.equal(mutations.length,0);
  const published = await publishWorkspace(draft,JSON.stringify(original),'test-session');
  assert.deepEqual(published.workspace.reports.map(row=>row.id),['a','b']);
  assert.equal(mutations.length,3);
  const entries = mutations[0].body.tree;
  assert.equal(entries.length,2);
  assert.ok(!entries.some(entry=>entry.path===existingFile.path));
  const stored = JSON.parse(entries.find(entry=>entry.path==='data/workbench.json').content);
  assert.equal(stored.reportArchive.entries.length,2);
  assert.deepEqual(mutations[1].body.parents,[head]);
  assert.deepEqual(mutations[2].body,{sha:'new-commit',force:false});
});
