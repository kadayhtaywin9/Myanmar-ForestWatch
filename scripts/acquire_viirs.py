"""Discover matched NASA CMR VNP14IMG / VNP03IMG Collection 002 swaths.

Discovery is public. --download requires EARTHDATA_TOKEN in the local process
environment. No token is written. Review the manifest and assign contiguous
granules to pass_id before the coverage importer is run.
"""
import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

import requests

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from backend.evidence import save_json


def discover(product, start, end, bbox):
    entries=[]
    for page in range(1,101):
        response=requests.get('https://cmr.earthdata.nasa.gov/search/granules.json',params={
            'short_name':product,'version':'002' if product=='VNP14IMG' else '2',
            'temporal':f'{start}T00:00:00Z,{end}T23:59:59Z','bounding_box':bbox,
            'page_size':2000,'page_num':page,'sort_key':'start_date'},timeout=90)
        response.raise_for_status();rows=response.json()['feed']['entry'];entries.extend(rows)
        if len(rows)<2000:return entries
    raise ValueError('CMR result too large; request a smaller time interval')


def downloadable(entry):
    title=entry.get('producer_granule_id',entry.get('title',''))
    match=re.search(r'(VNP14IMG|VNP03IMG)\.A(\d{7})\.(\d{4})\.002\.[\w.]+',title)
    if not match:return None
    links=[link['href'] for link in entry.get('links',[]) if not link.get('inherited')
           and 'data#' in link.get('rel','') and link.get('href','').startswith('https://')]
    links=[url for url in links if urlparse(url).hostname.endswith('.nasa.gov') and urlparse(url).path.endswith(('.nc','.h5','.hdf'))]
    if not links:return None
    return {'key':match.group(2)+'.'+match.group(3),'filename':match.group(0),'url':links[0],
            'cmr_id':entry['id'],'time_start':entry['time_start'],'time_end':entry['time_end']}


def download(record, folder, token):
    path=folder/record['filename']
    if not path.exists():
        with requests.get(record['url'],headers={'Authorization':'Bearer '+token},stream=True,timeout=120) as response:
            if response.status_code in (401,403):raise RuntimeError('Earthdata authorization failed; check local access and token')
            response.raise_for_status()
            if 'text/html' in response.headers.get('Content-Type',''):raise RuntimeError('Received a login page instead of a science granule')
            temporary=path.with_suffix(path.suffix+'.part')
            with temporary.open('wb') as destination:
                for chunk in response.iter_content(1024*1024):destination.write(chunk)
            temporary.replace(path)
    return str(path), hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--start',required=True);p.add_argument('--end',required=True);p.add_argument('--download',action='store_true');a=p.parse_args()
    from shapely.geometry import shape
    aoi=json.loads((ROOT/'public/data/aoi.geojson').read_text());bbox=','.join(map(str,shape(aoi.get('geometry',aoi)).bounds))
    folder=ROOT/'data/raw/evidence/viirs'/f'{a.start}_{a.end}';folder.mkdir(parents=True,exist_ok=True)
    found={product:[r for entry in discover(product,a.start,a.end,bbox) if (r:=downloadable(entry))] for product in ('VNP14IMG','VNP03IMG')}
    save_json(folder/'discovery.json',found)
    geo={r['key']:r for r in found['VNP03IMG']};pairs=[]
    token=os.environ.get('EARTHDATA_TOKEN')
    if a.download and not token:raise SystemExit('Discovery saved. EARTHDATA_TOKEN is required for downloads; no swaths acquired.')
    for fire in found['VNP14IMG']:
        match=geo.get(fire['key'])
        if not match:continue
        pair={'granule':fire['key'],'fire_source':fire,'geolocation_source':match,'status':'discovered'}
        if a.download:
            pair['fire'],pair['fire_sha256']=download(fire,folder,token)
            pair['geolocation'],pair['geolocation_sha256']=download(match,folder,token)
            pair['status']='acquired'
        pairs.append(pair)
    save_json(folder/'pairs.json',{'pairs':pairs,'land_mask_source':'REQUIRED: cite a dated binary land mask',
        'next_step':'Assign pass_id to contiguous same-overpass granules (not each granule) and provide a complete 0-water/1-land GeoTIFF. Cross-month passes must be split.',
        'unmatched_fire_granules':len(found['VNP14IMG'])-len(pairs)})
    print(json.dumps({'matched_pairs':len(pairs),'downloaded':sum(p['status']=='acquired' for p in pairs),'manifest':str(folder/'pairs.json')}))

if __name__=='__main__':main()
