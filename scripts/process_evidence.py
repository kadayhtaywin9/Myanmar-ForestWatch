"""Turn acquired Sentinel-2 pairs and ORNL MCD64A1 subsets into review assets.

Run after scripts/acquire_evidence.py. Raw input locations can be moved; the
adapter resolves files relative to each sample manifest. No automatic labels.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from pyproj import Transformer
from rasterio.features import geometry_mask
from rasterio.transform import from_origin
from shapely.geometry import shape, mapping
from shapely.ops import transform

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.evidence import DATA, evaluate, save_json
from backend.optical import process_pair


def adapt_scene(scene, folder):
    bands = {}
    for name, source in [('nir', 'B8A'), ('swir', 'B12'), ('red', 'B04'), ('qa', 'SCL')]:
        raw = scene['assets'][source]
        path = folder / scene['id'] / (source + '.tif')
        if hashlib.sha256(path.read_bytes()).hexdigest() != raw['sha256']:
            raise ValueError(f'Raw asset checksum mismatch: {path}')
        bands[name] = {'path': str(path), 'scale': raw['scale'], 'offset': raw['offset'],
                       'source_url': raw['href'], 'source_band': source}
    return {'id': scene['id'], 'date': scene['datetime'], 'product': 'sentinel-2',
            'collection': 'sentinel-2-c1-l2a', 'bands': bands}


def mcd_crosscheck(raw, sample, provenance):
    """Centre-mask 500 m sinusoidal pixels; never use as independent truth."""
    height, width = int(raw['nrows']), int(raw['ncols'])
    size = float(raw['cellsize'])
    affine = from_origin(float(raw['xllcorner']), float(raw['yllcorner']) + height*size, size, size)
    crs = '+proj=sinu +R=6371007.181 +nadgrids=@null +wktext'
    project = Transformer.from_crs(4326, crs, always_xy=True).transform
    cell = transform(project, shape(sample['geometry']))
    inside = geometry_mask([mapping(cell)], (height, width), affine, invert=True)
    bands = {r['band']: np.asarray(r['data']).reshape(height, width) for r in raw['subset']}
    qa = bands['QA'].astype('uint32')
    valid = inside & ((qa & 1) != 0) & ((qa & 2) != 0) & (bands['Burn_Date'] >= 0)
    # Shortened mapping periods are reported and excluded from the cross-check denominator.
    shortened = valid & ((qa & 4) != 0)
    valid &= ~shortened
    burned = valid & (bands['Burn_Date'] > 0) & (bands['Burn_Date'] <= 366)
    return {'sample_id': sample['sample_id'], 'product': 'MCD64A1', 'collection':'6.1',
            'collection_basis':'ORNL provider citation: doi:10.5067/MODIS/MCD64A1.061; REST response retains tile and processing date, not original HDF filename',
            'provider': 'NASA ORNL DAAC MODIS/VIIRS Global Subsets REST service',
            'role': 'cross_check_only', 'independent_truth': False,
            'period': sample['period'], 'nominal_resolution_m': 500,
            'pixel_size_m': size, 'cell_pixels': int(inside.sum()),
            'valid_pixels': int(valid.sum()), 'burned_pixels': int(burned.sum()),
            'shortened_mapping_pixels': int(shortened.sum()),
            'burned_area_approx_m2': round(float(burned.sum()*size*size)),
            'burn_day_of_year': sorted(set(bands['Burn_Date'][burned].astype(int).tolist())),
            'burn_date_uncertainty_days': {'min':int(bands['Burn_Date_Uncertainty'][burned].min()),'max':int(bands['Burn_Date_Uncertainty'][burned].max())} if burned.any() else None,
            'first_day_range': [int(bands['First_Day'][valid].min()),int(bands['First_Day'][valid].max())] if valid.any() else None,
            'last_day_range': [int(bands['Last_Day'][valid].min()),int(bands['Last_Day'][valid].max())] if valid.any() else None,
            'qa': 'Land bit 0, valid-data bit 1; exclude shortened mapping bit 2. Pixel-centre clipping.',
            'limitation': 'Coarse burned-area cross-check; active-fire information enters the MCD64A1 algorithm. Not an independent validation label.',
            'source_url': provenance['url'], 'raw_sha256': provenance['sha256'],
            'source_metadata': [{k:v for k,v in row.items() if k != 'data'} for row in raw['subset']]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=ROOT/'data/raw/evidence/optical')
    args = parser.parse_args()
    pilot = json.loads((DATA/'evidence/pilot.json').read_text())
    summaries = []
    for sample in pilot['samples']:
        folder = args.input / sample['sample_id']
        path = folder / 'manifest.json'
        if not path.exists():
            continue
        raw = json.loads(path.read_text())
        if raw.get('status') != 'acquired':
            continue
        if sample.get('locked'):
            raise ValueError('Do not replace imagery behind a locked review')
        manifest = {role: adapt_scene(raw[role], folder) for role in ['before', 'after']}
        output = DATA/'evidence/assets'/sample['sample_id']
        sample['imagery'] = process_pair(manifest, sample, output)
        sample['imagery']['asset_base'] = f"/data/evidence/assets/{sample['sample_id']}"
        sample['imagery']['selection_rule'] = raw['selection_rule']
        sample['imagery']['scene_selection'] = raw['scene_selection']
        if raw.get('mcd64a1', {}).get('status') == 'acquired':
            mcd_bytes = (folder/'MCD64A1.json').read_bytes()
            if hashlib.sha256(mcd_bytes).hexdigest() != raw['mcd64a1']['sha256']:
                raise ValueError('MCD64A1 raw checksum mismatch')
            save_json(output/'crosscheck.json', mcd_crosscheck(json.loads(mcd_bytes), sample, raw['mcd64a1']))
        summaries.append({'sample_id': sample['sample_id'], 'period': sample['period'],
                          'before_id': raw['before']['id'], 'after_id': raw['after']['id'],
                          'clear_overlap_fraction': sample['imagery']['clear_overlap_fraction'],
                          'candidate_count': sample['imagery']['candidate_count'],
                          'label': sample['label'], 'locked': sample['locked']})
    pilot['evaluation'] = evaluate(pilot['samples'])
    save_json(DATA/'evidence/pilot.json', pilot)
    acquisition = {'generated_at': datetime.now(timezone.utc).isoformat(),
        'real_pairs_processed': len(summaries), 'pilot_samples': len(pilot['samples']),
        'optical_collection': 'Sentinel-2 C1 L2A / Earth Search',
        'viirs_swaths': {'status': 'unavailable', 'reason': 'Earthdata authorization required; no authenticated swaths downloaded'},
        'incident_records': {'status': 'not_supplied'},
        'review_status': 'All source pairs await independent human review; candidates are not wildfire labels',
        'selection_limit': 'Initial imagery subset: 12 dry-season cell-months, two per year and latitude third; not representative validation.',
        'samples': summaries}
    save_json(DATA/'evidence/acquisition.json', acquisition)
    print(json.dumps(acquisition, indent=2))

if __name__ == '__main__':
    main()
