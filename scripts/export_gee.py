"""Authenticated GEE environmental tables or explicit pilot optical scene pairs.

No authenticated Earth Engine export was executed in the delivered release.
"""
import argparse,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def export_pilot(ee,a):
 sample=next(s for s in json.loads((ROOT/'public/data/evidence/pilot.json').read_text())['samples'] if s['sample_id']==a.sample_id)
 region=ee.Geometry(sample['geometry']);start=ee.Date(sample['period']+'-01');end=start.advance(1,'month')
 collections=['COPERNICUS/S2_SR_HARMONIZED'] if a.sensor=='sentinel-2' else ['LANDSAT/LC08/C02/T1_L2','LANDSAT/LC09/C02/T1_L2']
 if a.list_scenes:
  for name in collections:
   scenes=ee.ImageCollection(name).filterBounds(region).filterDate(start.advance(-30,'day'),end.advance(30,'day')).sort('system:time_start')
   print(json.dumps({'collection':name,'scene_ids':scenes.aggregate_array('system:index').getInfo(),'time_utc_ms':scenes.aggregate_array('system:time_start').getInfo()},indent=2))
  return
 if not a.before_id or not a.after_id:raise SystemExit('Provide --before-id and --after-id from --list-scenes, including the collection prefix')
 names={'nir':'B8A','swir':'B12','red':'B4','qa':'SCL'} if a.sensor=='sentinel-2' else {'nir':'SR_B5','swir':'SR_B7','red':'SR_B4','qa':'QA_PIXEL','radsat':'QA_RADSAT'}
 scale,offset=(.0001,0) if a.sensor=='sentinel-2' else (.0000275,-.2)
 out=ROOT/'data/raw/evidence/gee'/a.sample_id;out.mkdir(parents=True,exist_ok=True)
 manifest={}
 for role,scene_id in [('before',a.before_id),('after',a.after_id)]:
  if not any(scene_id.startswith(c+'/') for c in collections):raise ValueError('Scene ID must belong to the selected surface-reflectance collection')
  scene=ee.Image(scene_id);date=scene.date().format("YYYY-MM-dd'T'HH:mm:ss").getInfo()+'Z';bands={}
  for name,source in names.items():
   filename=f'{a.sample_id}_{role}_{source}';task=ee.batch.Export.image.toDrive(image=scene.select(source).clip(region),description=filename,folder='FireWatch',fileNamePrefix=filename,region=region,scale=20 if a.sensor=='sentinel-2' else 30,crs='EPSG:32647',maxPixels=1e8,fileFormat='GeoTIFF',formatOptions={'cloudOptimized':True});task.start()
   bands[name]={'path':str(out/(filename+'.tif')),'scale':scale if name in ('nir','swir','red') else 1,'offset':offset if name in ('nir','swir','red') else 0,'source_id':scene_id,'source_band':source}
   print(json.dumps({'export':filename,'task_id':task.id,'status':'submitted_not_downloaded'}))
  manifest[role]={'id':scene_id,'date':date,'product':a.sensor,'bands':bands}
 (out/'pair.json').write_text(json.dumps(manifest,indent=2))
 print('Download the completed Drive GeoTIFFs into',out,'then run python -m backend.optical --sample-id',a.sample_id,'--manifest',out/'pair.json')

def main():
 import ee
 p=argparse.ArgumentParser();p.add_argument('--project',required=True);p.add_argument('--year',type=int);p.add_argument('--sample-id');p.add_argument('--sensor',choices=['sentinel-2','landsat'],default='sentinel-2');p.add_argument('--list-scenes',action='store_true');p.add_argument('--before-id');p.add_argument('--after-id');a=p.parse_args();ee.Initialize(project=a.project)
 if a.sample_id:return export_pilot(ee,a)
 if not a.year:p.error('--year is required for environmental exports, or use --sample-id')
 cells=ee.FeatureCollection(json.loads((ROOT/'public/data/grid.geojson').read_text()))
 def export(fc,name):
  task=ee.batch.Export.table.toDrive(collection=fc,description=name,folder='FireWatch',fileFormat='CSV');task.start();print(name,task.id)
 dem=ee.Image('USGS/SRTMGL1_003').select('elevation');terrain=ee.Terrain.products(dem).select(['elevation','slope','aspect']);export(terrain.reduceRegions(collection=cells,reducer=ee.Reducer.mean(),scale=30,crs='EPSG:32647',tileScale=4),f'firewatch_terrain_{a.year}')
 lc=ee.Image(ee.ImageCollection('MODIS/061/MCD12Q1').filterDate(f'{a.year}-01-01',f'{a.year+1}-01-01').first()).select('LC_Type1');forest=lc.gte(1).And(lc.lte(5)).rename('forest_fraction');export(forest.reduceRegions(collection=cells,reducer=ee.Reducer.mean(),scale=500,crs='EPSG:32647',tileScale=4),f'firewatch_forest_{a.year}')
 for month in range(1,13):
  start=ee.Date.fromYMD(a.year,month,1);end=start.advance(1,'month')
  def masks(im):
   mask=im.select('FireMask').bitwiseAnd(15);valid=mask.eq(5).Or(mask.eq(7)).Or(mask.eq(8)).Or(mask.eq(9));fire=mask.gte(8).And(mask.lte(9));return valid.rename('valid_land_observations').addBands(fire.rename('nominal_high_fire_observations')).unmask(0)
  fire=ee.ImageCollection('MODIS/061/MOD14A1').filterDate(start,end).map(masks).sum();table=fire.reduceRegions(collection=cells,reducer=ee.Reducer.sum(),scale=1000,crs='EPSG:32647',tileScale=4).map(lambda f:f.set({'month':start.format('YYYY-MM'),'sensor':'MODIS_Terra','coverage_units':'valid pixel-days; not complete month coverage'}));export(table,f'firewatch_coverage_{a.year}_{month:02d}')
  def ndvi(im):return im.select('NDVI').multiply(.0001).updateMask(im.select('SummaryQA').lte(1))
  vegetation=ee.ImageCollection('MODIS/061/MOD13Q1').filterDate(start,end).map(ndvi).mean().rename('ndvi');table=vegetation.reduceRegions(collection=cells,reducer=ee.Reducer.mean(),scale=250,crs='EPSG:32647',tileScale=4).map(lambda f:f.set('month',start.format('YYYY-MM')));export(table,f'firewatch_ndvi_{a.year}_{month:02d}')
 print('Inspect Earth Engine Tasks and Google Drive. Validate coverage before changing labels. Never use target-month observed vegetation for a multiyear forecast.')
if __name__=='__main__':main()
