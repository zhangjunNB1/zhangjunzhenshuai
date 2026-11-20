import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startupWorkspace} from '../src/workspace-startup.ts';
const empty=()=>({version:1,products:[],costs:[],bundles:[],reports:[],overheads:[]});
test('已发布的本机副本跟随GitHub新版本，未发布修改保留并提示',()=>{const old=empty(),published=empty();published.costs=[{merchantSku:'MODEL',versions:[]}];const next=startupWorkspace(published,JSON.stringify(old),JSON.stringify(old));assert.deepEqual(next.workspace,published);assert.equal(next.remoteNewer,false);const draft=empty();draft.products=[{sku:'1',name:'本机新增',merchantSku:'MODEL',url:'',category:'base',bundleId:'',verified:false}];const kept=startupWorkspace(published,JSON.stringify(draft),JSON.stringify(old));assert.deepEqual(kept.workspace,draft);assert.equal(kept.remoteNewer,true);assert.equal(kept.base,JSON.stringify(old));});

test('旧电脑的未发布草稿会合入新日报，保留编辑和当天费用',()=>{
 const old=empty(),local=empty(),published=empty();
 local.products=[{sku:'1',name:'本机修改的商品',merchantSku:'MODEL',url:'',category:'base',bundleId:'',verified:false}];
 const report=(id,kind,date,sku)=>({id,kind,filename:'来源报表',createdAt:'2026-11-20T06:00:00Z',dates:[date],rows:[{date,sku,name:'新报表商品',merchantSku:'',qty:kind==='sales'?2:0,sales:kind==='sales'?10000:0,ads:kind==='ads'?300:0,adRevenue:null}]});
 published.reports=[report('official-sales','sales','2026-11-19','2'),report('official-ads','ads','2026-11-19','2')];
 published.overheads=[{date:'2026-11-19',amount:331000}];
 local.reports=[report('local-ads','ads','2026-11-19','2')];
 local.reports[0].rows[0].ads=400;
 const next=startupWorkspace(published,JSON.stringify(local),JSON.stringify(old));
 assert.equal(next.workspace.products.find(p=>p.sku==='1').name,'本机修改的商品');
 assert.ok(next.workspace.products.some(p=>p.sku==='2'));
 assert.deepEqual(next.workspace.reports.map(r=>r.id),['official-sales','official-ads','local-ads']);
 assert.deepEqual(next.workspace.overheads,published.overheads);
 assert.equal(local.reports.length,1);
 assert.equal(next.remoteNewer,true);
});
