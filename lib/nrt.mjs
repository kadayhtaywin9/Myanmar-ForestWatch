import Papa from 'papaparse';
import { bbox, booleanPointInPolygon, point } from '@turf/turf';
import { createHash } from 'node:crypto';
export const PRODUCTS=['MODIS_NRT','VIIRS_SNPP_NRT','VIIRS_NOAA20_NRT','VIIRS_NOAA21_NRT'];
export const bounds=forests=>bbox(forests).map(n=>n.toFixed(5)).join(',');
export function normalize(text,product,forests,now=new Date()) {
  const parsed=Papa.parse(text,{header:true,skipEmptyLines:'greedy'});
  if(parsed.errors.length || !['latitude','longitude','acq_date','acq_time','confidence'].every(k=>parsed.meta.fields?.includes(k))) throw Error('Invalid FIRMS CSV');
  const rows=new Map();
  for(const r of parsed.data){
    const lat=Number(r.latitude),lon=Number(r.longitude),raw=String(r.acq_time).padStart(4,'0');
    const time=`${raw.slice(0,2)}:${raw.slice(2)}`,observed_at=`${r.acq_date}T${time}:00Z`,ms=Date.parse(observed_at);
    if(!r.latitude?.trim() || !r.longitude?.trim() || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat)>90 || Math.abs(lon)>180 || !/^\d{4}$/.test(raw) || !Number.isFinite(ms) || new Date(ms).toISOString().slice(0,16)!==observed_at.slice(0,16) || ms>now.getTime()+300000) throw Error('Invalid observation');
    const forest=forests.features.find(f=>booleanPointInPolygon(point([lon,lat]),f));
    if(!forest)continue;
    const sensor=product.startsWith('MODIS')?'MODIS':'VIIRS',satellite=r.satellite||product,confidence=String(r.confidence).toLowerCase();
    const id=createHash('sha256').update(`${product}|${lat}|${lon}|${observed_at}|${satellite}`).digest('hex').slice(0,24);
    const numeric=k=>r[k]?.trim() && Number.isFinite(Number(r[k]))?Number(r[k]):null;
    rows.set(id,{id,lat,lon,date:r.acq_date,time,observed_at,sensor,satellite,confidence,frp:numeric('frp'),scan:numeric('scan'),track:numeric('track'),daynight:r.daynight||'',version:r.version||'',processing_type:'NRT',source:product,ingested_at:now.toISOString(),cell_id:'',qualified:sensor==='MODIS'?confidence.trim()!==''&&Number(confidence)>=30&&Number(confidence)<=100:['n','h','nominal','high'].includes(confidence),forest_id:forest.properties.forest_id,forest_name:forest.properties.name_en,region_en:forest.properties.region_en});
  }
  return [...rows.values()];
}
export function assemble(snapshots,hours,now=Date.now()){
  const feeds=PRODUCTS.map((product,i)=>{const s=snapshots[i];return {product,last_success:s?.last_success||null,last_attempt:s?.last_attempt||null,error:s?.error||null,stale:!s?.last_success||now-Date.parse(s.last_success)>3600000};});
  const rows=snapshots.flatMap(s=>s?.rows||[]).filter(r=>Date.parse(r.observed_at)>=now-hours*3600000&&Date.parse(r.observed_at)<=now).sort((a,b)=>b.observed_at.localeCompare(a.observed_at));
  return {rows,feeds,hours,server_time:new Date(now).toISOString(),stale:feeds.some(f=>f.stale),partial:feeds.some(f=>f.error||!f.last_success),initialized:feeds.some(f=>f.last_success)};
}
