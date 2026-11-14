"""Validate shipped evidence assets and write the blinded QGIS review package."""
import csv
import hashlib
import io
import json
import sys
from pathlib import Path
from datetime import datetime, timezone

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from backend.evidence import DATA, evaluate, save_json

def main():
    pilot=json.loads((DATA/'evidence/pilot.json').read_text())
    grid_ids={f['id'] for f in json.loads((DATA/'grid.geojson').read_text())['features']}
    assert len(pilot['samples'])==60
    hashes={};rows=[];features=[]
    for sample in pilot['samples']:
        assert sample['cell_id'] in grid_ids
        image=sample.get('imagery') or {}
        if image:
            folder=DATA/'evidence/assets'/sample['sample_id']
            for filename in ('before.png','after.png','before-nbr.tif','after-nbr.tif','dnbr.tif','metadata.json','candidates.geojson','crosscheck.json'):
                path=folder/filename
                assert path.is_file(),str(path)
                hashes[str(path.relative_to(DATA))]=hashlib.sha256(path.read_bytes()).hexdigest()
            assert image['before_date']<image['after_date']
        properties={'sample_id':sample['sample_id'],'cell_id':sample['cell_id'],'period':sample['period'],
            'season':sample['season'],'label':sample['label'],'review_status':'locked' if sample['locked'] else 'pending',
            'reviewer':sample['reviewer'],'review_confidence':sample.get('review_confidence',''),
            'reason':sample['reason'],'before_scene':image.get('before_id',''),'after_scene':image.get('after_id',''),
            'before_date':image.get('before_date',''),'after_date':image.get('after_date',''),
            'clear_overlap':image.get('clear_overlap_fraction',''),'resolution_m':image.get('resolution_m',''),
            'imagery_directory':image.get('asset_base','').lstrip('/'),
            'coverage_status':sample['coverage']['status'],'qualifying_viirs_count':sample['viirs_count'] if sample['locked'] else 'blinded',
            'inclusion_probability':sample['inclusion_probability'],'schema_version':pilot['schema_version'],
            'aoi':'approximate_bago_yoma_v1','geometry_crs':'EPSG:4326','area_crs':'EPSG:32647',
            'attribution':'NASA FIRMS; Copernicus Sentinel-2 / Earth Search'}
        rows.append(properties);features.append({'type':'Feature','geometry':sample['geometry'],'properties':properties})
    output=io.StringIO(newline='');writer=csv.DictWriter(output,fieldnames=rows[0].keys());writer.writeheader();writer.writerows(rows)
    (DATA/'evidence/review-table.csv').write_text(output.getvalue(),encoding='utf-8')
    save_json(DATA/'evidence/review-cells.geojson',{'type':'FeatureCollection','features':features})
    report={'schema_version':2,'validated_at':datetime.now(timezone.utc).isoformat(),
        'pilot_samples':len(rows),'processed_pairs':sum(bool(s['imagery']) for s in pilot['samples']),
        'pairs_with_at_least_90_percent_clear_overlap':sum(s['imagery'] is not None and s['imagery']['clear_overlap_fraction']>=.9 for s in pilot['samples']),
        'evaluation':evaluate(pilot['samples']),'asset_sha256':hashes,
        'not_claimed':['Human-reviewed wildfire ground truth','Complete VIIRS overpass coverage','AOI-wide agreement','New burn-evidence model'],
        'sources':{'sentinel2':'Copernicus Sentinel-2 C1 L2A via Earth Search',
                   'mcd64a1':'NASA ORNL DAAC MCD64A1 Collection 6.1 subsets, cross-check only',
                   'viirs_science_swaths':'Not acquired; Earthdata authorization required',
                   'landsat':'Local importer and authenticated GEE export route implemented; no Landsat scenes acquired'}}
    save_json(DATA/'evidence/validation-report.json',report)
    print(json.dumps({k:v for k,v in report.items() if k!='asset_sha256'},indent=2))

if __name__=='__main__':main()

