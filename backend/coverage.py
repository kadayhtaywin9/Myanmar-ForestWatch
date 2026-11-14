"""Aggregate paired VNP14IMG/VNP03IMG granules on an explicit land-mask grid.

This uses nearest source pixel centres within 375 m on a 375 m UTM grid.
The result is an area approximation per observed overpass, not monthly absence.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import h5py
import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.features import geometry_mask
from rasterio.transform import from_origin, xy
from scipy.spatial import cKDTree
from shapely.geometry import shape, mapping
from shapely.ops import transform

from .evidence import DATA, save_json
from .optical import read_aligned

PRODUCT_PATTERN = re.compile(r'(VNP14IMG|VNP03IMG)\.A(\d{7})\.(\d{4})\.(\d{3})\.')


def paired_metadata(fire_path, geo_path):
    fire = PRODUCT_PATTERN.search(Path(fire_path).name)
    geo = PRODUCT_PATTERN.search(Path(geo_path).name)
    if not fire or not geo or fire.group(1) != 'VNP14IMG' or geo.group(1) != 'VNP03IMG':
        raise ValueError('Expected standard VNP14IMG and VNP03IMG granule filenames')
    if fire.groups()[1:] != geo.groups()[1:]:
        raise ValueError('Granule acquisition time and collection must match')
    if fire.group(4) != '002':
        raise ValueError('This decoder is verified for Collection 002')
    stamp = datetime.strptime(fire.group(2)+fire.group(3), '%Y%j%H%M').replace(tzinfo=timezone.utc)
    return {'timestamp': stamp.isoformat(), 'platform': 'S-NPP', 'collection':'002',
            'granule':fire.group(2)+'.'+fire.group(3)}


def decode_flags(mask, qa, geo_quality):
    if mask.shape != qa.shape or mask.shape != geo_quality.shape:
        raise ValueError('Fire mask, QA and geolocation dimensions differ')
    excluded = ((qa.astype('uint32') & ((1<<5)|(1<<22))) != 0) | (geo_quality != 0)
    return {'usable':np.isin(mask,[5,7,8,9]) & ~excluded,
            'qualifying_fire':np.isin(mask,[8,9]) & ~excluded,
            'low_confidence_fire':(mask==7) & ~excluded,
            'cloud':(mask==4) & ~excluded, 'excluded':excluded}


def load_swath(pair):
    metadata = paired_metadata(pair['fire'],pair['geolocation'])
    with h5py.File(pair['fire'],'r') as source:
        mask=np.asarray(source['fire mask']);qa=np.asarray(source['algorithm QA'])
    with h5py.File(pair['geolocation'],'r') as source:
        group=source['geolocation_data']
        latitude=np.asarray(group['latitude']);longitude=np.asarray(group['longitude'])
        quality=np.asarray(group['quality_flag'])
    if latitude.shape!=mask.shape or longitude.shape!=mask.shape:
        raise ValueError('Full swath latitude and longitude must match fire mask dimensions')
    flags=decode_flags(mask,qa,quality)
    valid=np.isfinite(latitude)&np.isfinite(longitude)&(np.abs(latitude)<=90)&(np.abs(longitude)<=180)
    metadata['sha256']={key:hashlib.sha256(Path(pair[key]).read_bytes()).hexdigest() for key in ['fire','geolocation']}
    return metadata,latitude,longitude,mask,flags,valid


def aggregate(manifest, land_mask_path, grid):
    project=Transformer.from_crs(4326,32647,always_xy=True).transform
    polygons=[transform(project,shape(f['geometry'])) for f in grid['features']]
    left=min(p.bounds[0] for p in polygons);bottom=min(p.bounds[1] for p in polygons)
    right=max(p.bounds[2] for p in polygons);top=max(p.bounds[3] for p in polygons)
    resolution=375
    left=np.floor(left/resolution)*resolution;top=np.ceil(top/resolution)*resolution
    width=int(np.ceil((right-left)/resolution));height=int(np.ceil((top-bottom)/resolution))
    profile={'crs':'EPSG:32647','transform':from_origin(left,top,resolution,resolution),'width':width,'height':height}
    land=read_aligned(land_mask_path,profile,categorical=True)
    if not np.isin(land[np.isfinite(land)],[0,1]).all():
        raise ValueError('Land mask must contain 1 land, 0 water, and nodata')
    rr,cc=np.indices((height,width));xx,yy=xy(profile['transform'],rr.ravel(),cc.ravel())
    targets=np.column_stack([xx,yy]);passes=defaultdict(list);seen=set();sources=[]
    for pair in manifest['pairs']:
        meta=paired_metadata(pair['fire'],pair['geolocation'])
        if meta['granule'] in seen:
            continue
        seen.add(meta['granule']);passes[pair['pass_id']].append(pair)
    output=[]
    for pass_id,pairs in sorted(passes.items()):
        stamps=[datetime.fromisoformat(paired_metadata(p['fire'],p['geolocation'])['timestamp']) for p in pairs]
        if (max(stamps)-min(stamps)).total_seconds()>1200:
            raise ValueError('A pass must group contiguous granules within 20 minutes')
        if len({stamp.strftime('%Y-%m') for stamp in stamps}) != 1:
            raise ValueError('Split a cross-month overpass into separate month-specific pass IDs')
        best_distance=np.full(len(targets),np.inf);states=np.full(len(targets),-1,dtype='int16')
        usable=np.zeros(len(targets),dtype=bool);fire=np.zeros(len(targets),dtype=bool)
        for pair in pairs:
            meta,lat,lon,mask,flags,valid=load_swath(pair);sources.append(meta)
            valid &= ~flags['excluded']
            # Crop geolocation before constructing the tree; prevent invalid fills entering projection.
            valid &= (lon>94)&(lon<98)&(lat>16)&(lat<21)
            indices=np.flatnonzero(valid)
            if not len(indices):continue
            x,y=project(lon.ravel()[indices],lat.ravel()[indices])
            tree=cKDTree(np.column_stack([x,y]))
            distance,nearest=tree.query(targets,distance_upper_bound=resolution)
            take=np.isfinite(distance)&(distance<best_distance)
            source_indices=indices[nearest[take]]
            states[take]=mask.ravel()[source_indices]
            usable[take]=flags['usable'].ravel()[source_indices]
            fire[take]=flags['qualifying_fire'].ravel()[source_indices]
            best_distance[take]=distance[take]
        for feature,polygon in zip(grid['features'],polygons):
            inside=geometry_mask([mapping(polygon)],(height,width),profile['transform'],invert=True)
            cell=inside.ravel();land_pixels=cell & (land.ravel()==1)
            denominator=int(land_pixels.sum());known_mask=int((cell & np.isfinite(land.ravel())).sum())
            land_mask_complete=known_mask==int(cell.sum()) and bool(cell.sum())
            observed=land_pixels & (states>=0)
            usable_count=int((land_pixels & usable).sum())
            output.append({'cell_id':feature['id'],'pass_id':pass_id,
                'timestamp':min(stamps).isoformat(),'period':min(stamps).strftime('%Y-%m'),
                'land_pixels':denominator,'land_mask_complete':land_mask_complete,
                'observed_pixels':int(observed.sum()),'usable_pixels':usable_count,
                'usable_land_fraction':usable_count/denominator if denominator and land_mask_complete else None,
                'qualifying_fire_pixels':int((land_pixels & fire).sum()),
                'cloud_pixels':int((land_pixels & (states==4)).sum()),
                'low_confidence_fire_pixels':int((land_pixels & (states==7)).sum()),
                'nominal_fire_pixels':int((land_pixels & (states==8)).sum()),
                'high_confidence_fire_pixels':int((land_pixels & (states==9)).sum()),
                'unclassified_pixels':int((land_pixels & (states==6)).sum()),
                'unprocessed_pixels':int((land_pixels & (states==0)).sum()),
                'bowtie_or_glint_pixels':int((land_pixels & np.isin(states,[1,2])).sum()),
                'water_class_on_land_pixels':int((land_pixels & (states==3)).sum()),
                'missing_pixels':int((land_pixels & (states<0)).sum()),
                'interpretation':'No qualifying hotspot recorded during this pass' if usable_count and not (land_pixels & fire).any() else 'Qualifying hotspot recorded during this pass' if (land_pixels & fire).any() else 'Coverage unknown',
                'status':'observed_pass' if observed.any() else 'no_usable_swath'})
    return {'schema_version':1,'method':'375 m target pixel centres, nearest valid source within 375 m; unique target pixels per pass',
            'limitations':'Raster area approximation; off-nadir footprint uncertainty; retrieved passes do not establish complete monthly coverage',
            'land_mask_source':manifest['land_mask_source'], 'land_mask_sha256':hashlib.sha256(Path(land_mask_path).read_bytes()).hexdigest(),
            'sources':sources,'passes':output}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest',type=Path,required=True)
    parser.add_argument('--land-mask',type=Path,required=True)
    args=parser.parse_args();manifest=json.loads(args.manifest.read_text())
    if not manifest.get('land_mask_source'):raise SystemExit('Document land_mask_source in the manifest')
    result=aggregate(manifest,args.land_mask,json.loads((DATA/'grid.geojson').read_text()))
    save_json(DATA/'evidence/coverage.json',result)
    pilot=json.loads((DATA/'evidence/pilot.json').read_text())
    for sample in pilot['samples']:
        passes=[row for row in result['passes'] if row['cell_id']==sample['cell_id'] and row['period']==sample['period']]
        sample['coverage']={'status':'partial' if passes else 'unavailable','passes':passes,
                            'method':result['method'],'limitations':result['limitations']}
    save_json(DATA/'evidence/pilot.json',pilot)
    print(json.dumps({'granules':len(result['sources']),'cell_passes':len(result['passes'])}))

if __name__=='__main__':main()
