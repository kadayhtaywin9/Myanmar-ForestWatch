import { useEffect, useRef, useState } from 'react';
import { MapView } from './MapView';
import { Hotspot, csv, download } from './data';
import './recent.css';
type Feed={product:string;last_success:string|null;last_attempt:string|null;error:string|null;stale:boolean};
type Snapshot={hours:number;rows:Hotspot[];feeds:Feed[];initialized:boolean;server_time:string;stale:boolean;partial:boolean};
const timestamp=(v:string|null)=>v?new Date(v).toLocaleString('en-GB',{timeZone:'Asia/Yangon'})+' MMT':'Never';
export function RecentFires({reserves,t,lang}:{reserves:any;t:(key:string)=>string;lang:string}){
  const [data,setData]=useState<Snapshot|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [hours,setHours]=useState(24),[sensor,setSensor]=useState('both'),[forest,setForest]=useState('all'),[quality,setQuality]=useState(true);
  const [basemap,setBasemap]=useState('satellite'),[picked,setPicked]=useState<Hotspot|null>(null),[tick,setTick]=useState(Date.now()),[retry,setRetry]=useState(0);
  const [alerts,setAlerts]=useState(false),[newCount,setNewCount]=useState(0);
  const seen=useRef<Set<string>|null>(null);
  useEffect(()=>{
    let active=true,pending=false;const controller=new AbortController();
    const refresh=async()=>{
      if(pending)return;pending=true;setBusy(true);
      try{
        const response=await fetch(`/api/recent?hours=${hours}`,{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(40000)])});
        if (response.status === 404 || response.status === 503) {
          if (active) setError('Recent fires needs a running API and a server-side FIRMS_MAP_KEY. Historical observations are available in Project datasets.');
          return;
        }
        if (!response.ok) throw Error('Feed unavailable');
        const next = await response.json();
        if(!Array.isArray(next.rows)||!Array.isArray(next.feeds))throw Error('Invalid response');
        if(active){setData(previous=>{
          if (!previous || previous.hours !== hours || !next.partial) return next;
          const failed = new Set(next.feeds.filter((f:Feed)=>f.error).map((f:Feed)=>f.product));
          const retained = previous.rows.filter(row=>failed.has(row.source));
          const feeds = next.feeds.map((f:Feed)=>failed.has(f.product)?{...f,last_success:previous.feeds.find(old=>old.product===f.product)?.last_success??null}:f);
          return {...next,feeds,rows:[...next.rows,...retained].sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time))};
        });setError('');setPicked(null);}
      }catch{if(active)setError('Unable to refresh. Displayed observations may be outdated. Check connection or service setup.');}
      finally{pending=false;if(active){setBusy(false);setTick(Date.now());}}
    };
    setData(previous=>previous?.hours===hours?previous:null);setPicked(null);void refresh();
    const timer=setInterval(()=>void refresh(),900000),clock=setInterval(()=>setTick(Date.now()),30000);
    window.addEventListener('online',refresh);
    return()=>{active=false;controller.abort();clearInterval(timer);clearInterval(clock);window.removeEventListener('online',refresh);};
  },[hours,retry]);
  const rows=(data?.rows||[]).filter(r=>Date.parse(`${r.date}T${r.time}:00Z`)>=tick-hours*3600000&&(!quality||r.qualified)&&(sensor==='both'||sensor===r.sensor)&&(forest==='all'||forest===r.forest_id));
  const stale=data?.feeds.some(f=>!f.last_success||tick-Date.parse(f.last_success)>3600000);
  useEffect(()=>{seen.current=null;setNewCount(0);},[hours,sensor,forest,quality]);
  useEffect(()=>{
    if(!data?.initialized||data.hours!==hours)return;
    const next=new Set(rows.map(r=>r.id));
    const added=seen.current?rows.filter(r=>!seen.current!.has(r.id)):[];
    if(added.length){setNewCount(added.length);if(alerts&&'Notification' in window&&Notification.permission==='granted')new Notification('Myanmar ForestWatch',{body:`${added.length} new satellite detections in your selected forests. Verify conditions before acting.`});}
    seen.current=next;
  },[data,hours,sensor,forest,quality,alerts]);
  return <section className="map-stage recent-view" aria-label="Recent fire monitoring">
    <MapView rows={rows} reserves={reserves} selectedForestId={forest} onSelectForest={setForest} basemap={basemap} setBasemap={setBasemap} t={t} lang={lang} onPick={setPicked} onCell={()=>{}} showGrid={false} showDensity={false}/>
    <aside className="recent-panel glass">
      <h2>{lang==='mm'?'လတ်တလော မီးအပူကွက်များ':'Recent fires'}</h2>
      <p>Near-real-time satellite detections · 10 forests + Bago Yoma</p>
      <div role="status" className={error||stale||data?.partial?'recent-warning':''}>{busy?'Checking for updates…':error||(!data?.initialized?'Waiting for FIRMS observations.':stale?'Feed stale — one or more satellites have not updated within 1 hour.':data?.partial?'Partial feed — a satellite retrieval failed.':'Feed retrieval current')}</div>
      <label>Observation window<select value={hours} onChange={e=>setHours(Number(e.target.value))}><option value={24}>Last 24 hours</option><option value={48}>Last 48 hours</option><option value={168}>Last 7 days</option></select></label>
      <label>Satellite sensor<select value={sensor} onChange={e=>setSensor(e.target.value)}><option value="both">MODIS + VIIRS</option><option>MODIS</option><option>VIIRS</option></select></label>
      <label>Reserved forest<select value={forest} onChange={e=>setForest(e.target.value)}><option value="all">All study areas</option>{reserves?.features.map((f:any)=><option key={f.properties.forest_id} value={f.properties.forest_id}>{f.properties.name_en}</option>)}</select></label>
      <label><input type="checkbox" checked={quality} onChange={e=>setQuality(e.target.checked)}/> Quality filtered (MODIS ≥30; VIIRS nominal/high)</label>
      <strong>{data?.initialized ? `${rows.length} detections in selected window` : 'Detection count unavailable'}</strong>
      <p>Latest displayed observation: {timestamp(rows[0]?`${rows[0].date}T${rows[0].time}:00Z`:null)}</p>
      <button onClick={()=>setRetry(n=>n+1)} disabled={busy}>Refresh map</button>{' '}
      <button disabled={!rows.length} onClick={()=>download('recent-fire-detections.csv',csv(rows),'text/csv;charset=utf-8')}>Export CSV</button>
      <p role="status">{newCount>0?`${newCount} newly retrieved detections since the previous update.`:''}</p>
      <button onClick={async()=>{if(alerts){setAlerts(false);return;}if(!('Notification' in window)){setError('Browser notifications are not supported on this device.');return;}const permission=await Notification.requestPermission();setAlerts(permission==='granted');if(permission!=='granted')setError('Notifications are blocked. You can enable them in browser settings.');}}>{alerts?'Disable browser alerts':'Enable browser alerts'}</button>
      <p>Alerts work while this monitoring view stays open. First load establishes a baseline; alerts follow the selected filters.</p>
      <details><summary>Satellite feed status</summary>{data?.feeds.map(f=><div key={f.product}><b>{f.product}</b><br/>Last success: {timestamp(f.last_success)}<br/>Last attempt: {timestamp(f.last_attempt)}{f.error&&<p className="recent-warning">{f.error}</p>}</div>)}</details>
      <p>Map checks every 15 minutes while this view is open. Global FIRMS observations usually arrive within about 3 hours of satellite overpass. A hotspot is not a confirmed wildfire. Clouds and overpass gaps can hide fires; no detections does not mean no fire.</p>
      <p>Forest locations use the project’s existing boundaries, including provisional polygons.</p>
      {picked&&<article><button onClick={()=>setPicked(null)} aria-label="Close observation">×</button><h3>{picked.forest_name}</h3><p>{picked.sensor} · {picked.satellite} · {picked.confidence}</p><p>Observed: {timestamp(`${picked.date}T${picked.time}:00Z`)}</p><p>Retrieved: {timestamp(picked.ingested_at)}</p><p>{picked.lat}, {picked.lon} · FRP {picked.frp??'unknown'} MW</p></article>}
    </aside>
  </section>;
}
