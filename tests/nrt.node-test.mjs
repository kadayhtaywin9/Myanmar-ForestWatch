import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize,assemble,PRODUCTS,bounds } from '../lib/nrt.mjs';
import recent from '../api/recent.js';
const forests={type:'FeatureCollection',features:[{type:'Feature',properties:{forest_id:'test',name_en:'Test forest'},geometry:{type:'Polygon',coordinates:[[[95,18],[97,18],[97,22],[95,22],[95,18]],[[95.1,18.1],[95.2,18.1],[95.2,18.2],[95.1,18.2],[95.1,18.1]]]}}]};
const header='latitude,longitude,acq_date,acq_time,confidence,satellite,frp,version';
const line='20,96,2026-11-14,0530,n,N,12,2.0NRT';
const now=new Date('2026-11-15T00:00:00Z');
test('normalization deduplicates, preserves sensor provenance and clips polygons including holes',()=>{
 const rows=normalize(`${header}\n${line}\n${line}\n18.15,95.15,2026-11-14,0530,n,N,12,2\n10,10,2026-11-14,0530,n,N,12,2`,PRODUCTS[1],forests,now);
 assert.equal(rows.length,1);assert.equal(rows[0].qualified,true);assert.equal(rows[0].observed_at,'2026-11-14T05:30:00Z');
 assert.notEqual(rows[0].id,normalize(`${header}\n${line}`,PRODUCTS[2],forests,now)[0].id);
 assert.equal(bounds(forests),'95.00000,18.00000,97.00000,22.00000');
});
test('invalid data cannot replace a valid snapshot; empty header-only downloads are valid',()=>{
 for(const body of ['Invalid MAP_KEY',`${header}\n20,96,2026-02-30,0530,n,N,12,2`,`${header}\n20,96,2026-11-14,2460,n,N,12,2`,`${header}\n,96,2026-11-14,0530,n,N,12,2`])assert.throws(()=>normalize(body,PRODUCTS[1],forests,now));
 assert.deepEqual(normalize(header,PRODUCTS[1],forests,now),[]);
 const modis=normalize(`${header}\n20,96,2026-11-14,530,29,T,12,6.1`,PRODUCTS[0],forests,now)[0];assert.equal(modis.qualified,false);
});
test('rolling windows cross year boundaries and freshness uses retrieval time',()=>{
 const ms=Date.parse('2027-01-01T01:00:00Z');
 const snapshots=PRODUCTS.map(()=>({last_success:new Date(ms).toISOString(),rows:[]}));
 snapshots[0].rows=[{observed_at:'2026-12-31T23:59:00Z',id:'yes'},{observed_at:'2026-12-30T00:00:00Z',id:'old'}];
 assert.equal(assemble(snapshots,24,ms).rows.length,1);assert.equal(assemble(snapshots,24,ms).stale,false);
 snapshots[1].error='failed';assert.equal(assemble(snapshots,24,ms).partial,true);
 assert.equal(assemble(snapshots,24,ms+3600001).stale,true);
 assert.equal(assemble([null,null,null,null],24,ms).initialized,false);
});
const response=()=>({code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(v){this.code=v;return this;},json(v){this.body=v;return this;}});
test('on-demand endpoint fetches four feeds and reports partial and total outages',async()=>{
 const savedKey=process.env.FIRMS_MAP_KEY, savedFetch=globalThis.fetch;
 let calls=0, failures=1;
 try {
  process.env.FIRMS_MAP_KEY='fixture';
  globalThis.fetch=async(url)=>{
   assert.equal(url.hostname,'firms.modaps.eosdis.nasa.gov');
   assert.ok(url.pathname.endsWith('/3'));
   calls++;
   return {ok:calls>failures,text:async()=>header};
  };
  const req={method:'GET',query:{hours:'48'}};
  let res=response(); await recent(req,res);
  assert.equal(calls,4);assert.equal(res.code,200);assert.equal(res.body.partial,true);assert.equal(res.body.feeds.length,4);
  calls=0;failures=4;res=response();await recent(req,res);assert.equal(res.code,502);
  const windows = [];
  globalThis.fetch = async (url) => {
   windows.push(url.pathname.split('/').slice(7));
   return {ok:true,text:async()=>header};
  };
  res=response();await recent({method:'GET',query:{hours:'168'}},res);
  assert.equal(res.code,200);
  assert.equal(windows.length,8);
  assert.equal(windows.filter(parts=>parts[0]==='5').length,4);
  assert.equal(windows.filter(parts=>parts[0]==='3' && /^\d{4}-\d{2}-\d{2}$/.test(parts[1])).length,4);
  delete process.env.FIRMS_MAP_KEY;res=response();await recent(req,res);assert.equal(res.code,503);
 } finally {
  globalThis.fetch=savedFetch;
  if(savedKey===undefined)delete process.env.FIRMS_MAP_KEY;else process.env.FIRMS_MAP_KEY=savedKey;
 }
});
