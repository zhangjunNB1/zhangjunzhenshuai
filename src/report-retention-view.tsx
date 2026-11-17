import React,{useMemo,useState} from 'react';
import {Download,ArrowUpRight} from 'lucide-react';
import {dayNow} from './profit.ts';
import {dataDayStatus} from './report-storage.ts';
import type {Report} from './workbench-model.ts';
import {download,Tag,dateTime} from './workbench-ui';

type Props = {
  reports: Report[];
  snapshots: {date:string}[];
  latestPublishedDate: string;
  onView: (date:string, source:'archive'|'workspace')=>void;
};

export function ReportRetentionView({reports,snapshots,latestPublishedDate,onView}: Props) {
  const today = dayNow();
  const [month,setMonth] = useState(today.slice(0,7));
  const [selected,setSelected] = useState('');
  const end = new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10);
  const days = useMemo(()=>dataDayStatus(reports,snapshots,`${month}-01`,end < today ? end : today),[reports,snapshots,month,end,today]);
  const revisions = selected ? reports.filter(report=>report.dates.includes(selected)).reverse() : [];
  const firstDate = [...snapshots.map(s=>s.date),...reports.flatMap(report=>report.dates)].sort()[0];
  const visible = days.filter(day=>!firstDate || day.date >= firstDate);
  const missing = visible.filter(day=>!day.archive&&(!day.sales||!day.ads)).length;
  return <section className="panel import-history"><div className="section-heading"><div><h2>日报留存</h2>
    <p>GitHub 已发布最新业务日 {latestPublishedDate||'—'}。当前月份缺少数据 {missing} 天；本机草稿也会显示在下表。</p></div>
    <label>选择月份 <input type="month" aria-label="日报留存月份" max={today.slice(0,7)} value={month} onChange={event=>{if(event.target.value){setMonth(event.target.value);setSelected('');}}}/></label>
  </div><div className="table-scroll"><table className="data-table"><thead><tr><th>业务日期</th><th>云表归档</th><th>商智</th><th>推广费</th><th>查看</th></tr></thead>
    <tbody>{visible.map(day=><tr key={day.date}><td>{day.date}</td><td>{day.archive?<Tag tone="green">已归档</Tag>:'—'}</td>
      <td>{day.sales?<button className="text-btn" onClick={()=>setSelected(day.date)}>已取得 · {day.salesVersions} 版</button>:<Tag tone={day.archive?'neutral':'amber'}>{day.archive?'归档口径':'缺商智'}</Tag>}</td>
      <td>{day.ads?<button className="text-btn" onClick={()=>setSelected(day.date)}>已取得 · {day.adsVersions} 版</button>:<Tag tone={day.archive?'neutral':'amber'}>{day.archive?'归档口径':'缺推广'}</Tag>}</td>
      <td>{(day.archive||day.sales||day.ads)&&<button className="text-btn" onClick={()=>onView(day.date,day.archive?'archive':'workspace')}>查看明细<ArrowUpRight size={13}/></button>}</td></tr>)}</tbody>
  </table></div>{visible.length===0&&<p className="table-note">该月份早于最早的留存日期。</p>}
  {selected&&<><h3 className="table-note">{selected} 的导入版本</h3><div className="table-scroll"><table className="data-table"><thead><tr><th>类型</th><th>文件</th><th>导入时间</th><th>当天记录</th><th>备份</th></tr></thead>
  <tbody>{revisions.map(report=><tr key={report.id}><td>{report.kind==='sales'?'商智':'推广费'}</td><td>{report.filename}</td><td>{dateTime(report.createdAt)}</td><td>{report.rows.filter(row=>row.date===selected).length} 行</td><td><button className="text-btn" onClick={()=>download(`日报_${selected}_${report.kind}.json`,JSON.stringify(report,null,2),'application/json')}><Download size={14}/>下载该版本</button></td></tr>)}</tbody>
  </table></div></>}
  </section>;
}
