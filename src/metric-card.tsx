'use client';
import type {LucideIcon} from 'lucide-react';
export type Metric={name:string;value:string;base:string;big:string;note:string;icon:LucideIcon;color:string};
export default function MetricCard({metric:m}:{metric:Metric}){return <section className={'metric split-metric '+m.color}><div className="metric-label">{m.name}<span><m.icon size={18}/></span></div><small className="overall-label">全店合计</small><strong>{m.value}</strong><div className="metric-split"><div><small><i className="base-dot"/>底板机</small><b>{m.base}</b></div><div><small><i className="big-dot"/>大板机</small><b>{m.big}</b></div></div><small className="metric-definition">{m.note}</small></section>;}
