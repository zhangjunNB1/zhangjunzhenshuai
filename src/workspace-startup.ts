import {addReport,validateWorkspace} from './workbench-model.ts';
import {retainPublishedReports} from './report-storage.ts';
import type {Workspace} from './workbench-model.ts';
// A clean local copy can follow a new published version. An unpublished draft stays intact.
export function startupWorkspace(published:Workspace,localText:string|null,baseText:string|null){
 const current=JSON.stringify(published);if(!localText)return {workspace:published,base:current,remoteNewer:false};
 const local=validateWorkspace(JSON.parse(localText)),previous=baseText?JSON.stringify(validateWorkspace(JSON.parse(baseText))):null;
 if(previous===JSON.stringify(local))return {workspace:published,base:current,remoteNewer:false};
 const localReportIds=new Set(local.reports.map(report=>report.id));
 let workspace=local;
 for(const report of published.reports){
  if(!localReportIds.has(report.id))workspace=addReport(workspace,report);
 }
 workspace=retainPublishedReports(published,workspace);
 const overheadDates=new Set(workspace.overheads.map(entry=>entry.date));
 workspace={...workspace,overheads:[...workspace.overheads,...published.overheads.filter(entry=>!overheadDates.has(entry.date))]};
 return {workspace,base:previous??'',remoteNewer:previous!==current};
}
