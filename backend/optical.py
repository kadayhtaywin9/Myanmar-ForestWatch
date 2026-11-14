"""Process local surface-reflectance pairs with explicit product QA and provenance."""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from pyproj import Transformer
from rasterio.features import geometry_mask, shapes
from rasterio.transform import from_origin
from rasterio.warp import reproject, Resampling
from shapely.geometry import shape, mapping
from shapely.ops import transform

from .evidence import DATA, save_json


def read_aligned(path, profile, categorical=False):
    with rasterio.open(path) as source:
        if source.crs is None:
            raise ValueError(f'Missing CRS in {path}')
        result = np.full((profile['height'], profile['width']), np.nan, dtype='float32')
        reproject(source=rasterio.band(source, 1), destination=result,
                  src_transform=source.transform, src_crs=source.crs, src_nodata=source.nodata,
                  dst_transform=profile['transform'], dst_crs=profile['crs'], dst_nodata=np.nan,
                  resampling=Resampling.nearest if categorical else Resampling.bilinear)
    return result


def scene_arrays(scene, profile):
    product = scene['product']
    bands = scene['bands']
    arrays = {}
    for name in ('nir', 'swir', 'red'):
        band = bands[name]
        raw = read_aligned(band['path'], profile)
        if 'scale' not in band or 'offset' not in band:
            raise ValueError('Explicit product reflectance scale and offset required')
        arrays[name] = raw * float(band['scale']) + float(band['offset'])
    qa = read_aligned(bands['qa']['path'], profile, categorical=True)
    if product == 'sentinel-2':
        valid = np.isin(qa, [4, 5])
        qa_method = 'SCL 4 vegetation and 5 bare land; cloud/shadow/water/uncertain classes excluded'
    elif product == 'landsat':
        finite = np.isfinite(qa)
        flags = np.nan_to_num(qa).astype('uint32')
        valid = finite & ((flags & 191) == 0)  # bits 0-5 and 7
        saturated = read_aligned(bands['radsat']['path'], profile, categorical=True)
        valid &= saturated == 0
        qa_method = 'QA_PIXEL bits 0-5 and 7 clear, QA_RADSAT zero'
    else:
        raise ValueError('Supported products are sentinel-2 and landsat')
    denominator = arrays['nir'] + arrays['swir']
    valid &= np.isfinite(denominator) & (denominator > 1e-6)
    valid &= np.isfinite(arrays['red']) & (arrays['nir'] >= 0) & (arrays['swir'] >= 0)
    nbr = np.divide(arrays['nir'] - arrays['swir'], denominator,
                    out=np.full_like(denominator, np.nan), where=valid)
    rgb = np.stack([arrays['swir'], arrays['nir'], arrays['red']], axis=-1)
    return nbr, valid, rgb, qa_method


def process_pair(manifest, sample, output):
    before, after = manifest['before'], manifest['after']
    if datetime.fromisoformat(before['date'][:10]) >= datetime.fromisoformat(after['date'][:10]):
        raise ValueError('Before image must precede after image')
    if before['product'] != after['product']:
        raise ValueError('Use the same sensor family within a comparison pair')
    resolution = 20 if before['product'] == 'sentinel-2' else 30
    project = Transformer.from_crs(4326, 32647, always_xy=True).transform
    inverse = Transformer.from_crs(32647, 4326, always_xy=True).transform
    polygon = transform(project, shape(sample['geometry']))
    left, bottom, right, top = polygon.bounds
    left, bottom = np.floor([left, bottom] / np.array([resolution, resolution])) * resolution
    top = np.ceil(top / resolution) * resolution
    width, height = int(np.ceil((right-left)/resolution)), int(np.ceil((top-bottom)/resolution))
    profile = {'crs': 'EPSG:32647', 'transform': from_origin(left, top, resolution, resolution),
               'width': width, 'height': height, 'driver': 'GTiff', 'dtype': 'float32',
               'count': 1, 'nodata': -9999.0, 'compress': 'deflate'}
    inside = geometry_mask([mapping(polygon)], (height, width), profile['transform'], invert=True)
    pre, pre_valid, pre_rgb, qa_method = scene_arrays(before, profile)
    post, post_valid, post_rgb, _ = scene_arrays(after, profile)
    valid = pre_valid & post_valid & inside
    difference = np.where(valid, pre-post, np.nan)
    threshold = float(manifest.get('candidate_threshold', .2))
    minimum_area = float(manifest.get('minimum_candidate_area_m2', 10000))
    candidates = (valid & (difference >= threshold)).astype('uint8')
    features = []
    for geometry, value in shapes(candidates, mask=candidates.astype(bool), transform=profile['transform']):
        candidate = shape(geometry).intersection(polygon)
        if value == 1 and candidate.area >= minimum_area:
            features.append({'type':'Feature','geometry':mapping(transform(inverse,candidate)),
                'properties':{'sample_id':sample['sample_id'], 'cell_id':sample['cell_id'],
                              'period':sample['period'], 'status':'unreviewed_candidate',
                              'area_m2':round(candidate.area), 'threshold':threshold}})
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    for name, data in [('before-nbr', pre), ('after-nbr', post), ('dnbr', difference)]:
        with rasterio.open(output/f'{name}.tif', 'w', **profile) as destination:
            destination.write(np.where(inside & np.isfinite(data), data, -9999).astype('float32'), 1)
    for name, rgb, clear in [('before',pre_rgb,pre_valid), ('after',post_rgb,post_valid)]:
        rgb = np.nan_to_num(np.clip(rgb / .5, 0, 1))
        rgba = np.dstack([(rgb*255).astype('uint8'), ((inside & clear)*255).astype('uint8')])
        Image.fromarray(rgba).save(output/f'{name}.png')
    provenance = []
    for scene in (before, after):
        files = [{k:v for k,v in band.items() if k!='path'} | {'band':name,
                  'sha256':hashlib.sha256(Path(band['path']).read_bytes()).hexdigest()}
                 for name,band in scene['bands'].items()]
        provenance.append({k:v for k,v in scene.items() if k!='bands'} | {'bands':files})
    metadata = {'status':'processed', 'before_date':before['date'], 'after_date':after['date'],
                'before_id':before['id'], 'after_id':after['id'], 'product':before['product'],
                'clear_overlap_fraction':round(float(valid.sum()/inside.sum()),4),
                'before_clear_fraction':round(float((pre_valid & inside).sum()/inside.sum()),4),
                'after_clear_fraction':round(float((post_valid & inside).sum()/inside.sum()),4),
                'valid_pixels':int(valid.sum()), 'cell_pixels':int(inside.sum()),
                'resolution_m':resolution, 'crs':'EPSG:32647',
                'qa_method':qa_method, 'display':'SWIR2 / NIR / red, fixed reflectance stretch 0–0.5',
                'candidate_threshold':threshold, 'minimum_candidate_area_m2':minimum_area,
                'candidate_count':len(features), 'candidate_area_m2':sum(f['properties']['area_m2'] for f in features),
                'burn_interval':[before['date'][:10],after['date'][:10]],
                'monthly_interval_contained':before['date'][:7]==after['date'][:7]==sample['period'],
                'provenance':provenance, 'bounds_wgs84':list(shape(sample['geometry']).bounds)}
    save_json(output/'metadata.json', metadata)
    save_json(output/'candidates.geojson', {'type':'FeatureCollection','features':features})
    return metadata


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest',type=Path,required=True)
    parser.add_argument('--sample-id',required=True)
    args=parser.parse_args()
    dataset=json.loads((DATA/'evidence/pilot.json').read_text())
    sample=next(s for s in dataset['samples'] if s['sample_id']==args.sample_id)
    if sample.get('locked'):raise SystemExit('Cannot replace imagery behind a locked review')
    manifest=json.loads(args.manifest.read_text())
    folder=DATA/'evidence/assets'/args.sample_id
    sample['imagery']=process_pair(manifest,sample,folder)
    sample['imagery']['asset_base']=f'/data/evidence/assets/{args.sample_id}'
    save_json(DATA/'evidence/pilot.json', dataset)
    print(json.dumps({'sample_id':sample['sample_id'], 'imagery':sample['imagery']}))

if __name__=='__main__':
    main()
