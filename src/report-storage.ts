import {isDay} from './profit.ts';
import {validateWorkspace} from './workbench-model.ts';
import type {Report,Workspace} from './workbench-model.ts';

type ReportReference = Pick<Report,'id'|'kind'|'filename'|'createdAt'|'dates'> & {
  rowCount: number;
  sha256: string;
};

type PublishedWorkspace = Workspace & {reportArchive?: {version: 1; entries: ReportReference[]}};

async function fingerprint(content: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
}

function reportPath(entry: ReportReference) {
  return `data/reports/${[...entry.dates].sort()[0]}/${entry.sha256}.json`;
}

function reference(report: Report, sha256: string): ReportReference {
  return {id:report.id, kind:report.kind, filename:report.filename, createdAt:report.createdAt,
    dates:report.dates, rowCount:report.rows.length, sha256};
}

function isReference(entry: ReportReference) {
  return !!entry && typeof entry.id === 'string' && ['sales', 'ads'].includes(entry.kind)
    && typeof entry.filename === 'string' && typeof entry.createdAt === 'string'
    && Array.isArray(entry.dates) && entry.dates.length > 0 && entry.dates.every(d => typeof d === 'string' && isDay(d))
    && Number.isInteger(entry.rowCount) && entry.rowCount >= 0 && entry.rowCount <= 100000
    && typeof entry.sha256 === 'string' && /^[0-9a-f]{64}$/.test(entry.sha256);
}

/** Each revision keeps its own content hash and remains available after a new import. */
export async function packPublishedWorkspace(workspace: Workspace) {
  validateWorkspace(workspace);
  const {reports} = workspace;
  const records = await Promise.all(reports.map(async report => {
    const content = JSON.stringify(report);
    const entry = reference(report, await fingerprint(content));
    return {entry, file: {path: reportPath(entry), content}};
  }));
  const published: PublishedWorkspace = {...workspace, reports: [], reportArchive:{version:1, entries:records.map(r => r.entry)}};
  return {manifestText:JSON.stringify(published), files:records.map(r => r.file)};
}

export async function hydratePublishedWorkspace(raw: PublishedWorkspace, readText: (path: string) => Promise<string>) {
  if (!raw?.reportArchive) return validateWorkspace(raw);
  const {reportArchive, ...fields} = raw;
  const {entries,version} = reportArchive;
  if (version !== 1 || !Array.isArray(entries) || entries.length > 2000 || !entries.every(isReference)
      || new Set(entries.map(entry => entry.id)).size !== entries.length) {
    throw Error('GitHub日报索引无效，无法载入。');
  }
  validateWorkspace(fields);
  const reports: Report[] = [];
  for (let offset = 0; offset < entries.length; offset += 8) {
    const batch = await Promise.all(entries.slice(offset, offset + 8).map(async entry => {
      const content = await readText(reportPath(entry));
      if (await fingerprint(content) !== entry.sha256) throw Error(`日报文件校验失败：${entry.dates.join('、')}`);
      const report: Report = JSON.parse(content);
      const actual = reference(report, entry.sha256);
      if (Object.keys(actual).some(k => JSON.stringify(actual[k as keyof ReportReference]) !== JSON.stringify(entry[k as keyof ReportReference]))) {
        throw Error(`日报索引与文件内容不一致：${entry.id}`);
      }
      return report;
    }));
    reports.push(...batch);
  }
  // Some deployed clients still save imports inline. Keep these as the newer revisions.
  return validateWorkspace({...fields, reports:[...reports,...fields.reports]});
}

export function publishedReportPaths(workspace: PublishedWorkspace) {
  return new Set(workspace.reportArchive?.entries.map(reportPath) ?? []);
}

export function retainPublishedReports(published: Workspace, draft: Workspace) {
  const history = new Map(published.reports.map(report => [report.id, report]));
  for (const report of draft.reports) {
    const archived = history.get(report.id);
    if (archived && JSON.stringify(archived) !== JSON.stringify(report)) throw Error('已归档的日报版本不能覆盖，请重新导入修订版。');
    history.set(report.id, report);
  }
  return validateWorkspace({...draft, reports:[...history.values()]});
}

export function dataDayStatus(reports: Report[], snapshots: {date: string}[], start: string, end: string) {
  const days = new Map<string,{date:string; archive:boolean; sales?:Report; ads?:Report; salesVersions:number; adsVersions:number}>();
  function at(date: string) {
    let day = days.get(date);
    if (!day) {
      day = {date, archive:false, salesVersions:0, adsVersions:0};
      days.set(date, day);
    }
    return day;
  }
  for (const snapshot of snapshots) at(snapshot.date).archive = true;
  for (const report of reports) for (const date of new Set(report.dates)) {
    const day = at(date);
    day[report.kind] = report;
    day[report.kind === 'sales' ? 'salesVersions' : 'adsVersions']++;
  }
  const interval = [];
  const calendar = new Date(`${start}T00:00:00Z`);
  const last = Date.parse(`${end}T00:00:00Z`);
  for (let offset = 0; offset < 31 && calendar.getTime() <= last; offset++) {
    interval.push(at(calendar.toISOString().slice(0,10)));
    calendar.setUTCDate(calendar.getUTCDate() + 1);
  }
  return interval.reverse();
}

export function reportCoverage(reports: Report[], start: string, end: string) {
  const dates = {sales:new Set<string>(),ads:new Set<string>()};
  for (const report of reports) for (const date of report.dates) {
    if (date >= start && date <= end) dates[report.kind].add(date);
  }
  const dayCount = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
  return {salesDays:dates.sales.size, adsDays:dates.ads.size, salesDates:dates.sales, adsDates:dates.ads, dayCount,
    dates:[...new Set([...dates.sales,...dates.ads])].sort()};
}
