import {validateWorkspace} from './workbench-model.ts';
import type {Workspace} from './workbench-model.ts';
// A clean local copy can follow a new published version. An unpublished draft stays intact.
export function startupWorkspace(published:Workspace,localText:string|null,baseText:string|null){
 const current=JSON.stringify(published);if(!localText)return {workspace:published,base:current,remoteNewer:false};
 const local=validateWorkspace(JSON.parse(localText)),previous=baseText?JSON.stringify(validateWorkspace(JSON.parse(baseText))):null;
 if(previous===JSON.stringify(local))return {workspace:published,base:current,remoteNewer:false};
 return {workspace:local,base:previous||current,remoteNewer:previous!==null&&previous!==current};
}
