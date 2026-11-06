import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startupWorkspace} from '../src/workspace-startup.ts';
const empty=()=>({version:1,products:[],costs:[],bundles:[],reports:[],overheads:[]});
test('已发布的本机副本跟随GitHub新版本，未发布修改保留并提示',()=>{const old=empty(),published=empty();published.costs=[{merchantSku:'MODEL',versions:[]}];const next=startupWorkspace(published,JSON.stringify(old),JSON.stringify(old));assert.deepEqual(next.workspace,published);assert.equal(next.remoteNewer,false);const draft=empty();draft.products=[{sku:'1',name:'本机新增',merchantSku:'MODEL',url:'',category:'base',bundleId:'',verified:false}];const kept=startupWorkspace(published,JSON.stringify(draft),JSON.stringify(old));assert.deepEqual(kept.workspace,draft);assert.equal(kept.remoteNewer,true);assert.equal(kept.base,JSON.stringify(old));});
