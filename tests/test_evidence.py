"""Scientific-contract regressions. Synthetic arrays here are test fixtures only."""
import copy
import json
import tempfile
import unittest
from pathlib import Path

import h5py
import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.transform import from_origin, xy
from shapely.geometry import box, mapping
from shapely.ops import transform

from backend.evidence import DATA, apply_reviews, evaluate, make_sample, validate_review
from backend.optical import scene_arrays
from backend.coverage import aggregate, decode_flags, load_swath, paired_metadata
from scripts.process_evidence import mcd_crosscheck


class EvidenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pilot=json.loads((DATA/'evidence/pilot.json').read_text())
        cls.sample=next(s for s in cls.pilot['samples'] if s['imagery'] and s['imagery']['clear_overlap_fraction']>.95)

    def test_frozen_sample_reproduces_and_spans_strata(self):
        selected=make_sample(42)['samples']
        self.assertEqual([s['sample_id'] for s in selected],[s['sample_id'] for s in self.pilot['samples']])
        self.assertEqual(len({s['sample_id'] for s in selected}),60)
        self.assertEqual(len({s['stratum'] for s in selected}),8)
        self.assertEqual(sum(s['season']=='wet_May_Oct' for s in selected),30)
        self.assertTrue(all(0<s['inclusion_probability']<=1 for s in selected))

    def test_pending_is_never_a_true_negative(self):
        result=evaluate(self.pilot['samples'])
        self.assertEqual(result['known_samples'],0)
        self.assertIsNone(result['metrics'])
        self.assertEqual(result['confusion_matrix'],dict(tp=0,fp=0,tn=0,fn=0))
        self.assertEqual(result['by_season']['wet_May_Oct']['unknown_samples'],30)

    def review(self,**changes):
        return dict(label='no_burn_evidence',reviewer='Test fixture',reason='Synthetic validation fixture, not a delivered review',confounders_checked=True,temporal_adequacy_confirmed=True,review_confidence='medium')|changes

    def test_review_requires_imagery_dates_coverage_and_rationale(self):
        sample=copy.deepcopy(self.sample);protocol=self.pilot['review_protocol']
        self.assertTrue(validate_review(self.review(),sample,protocol)['locked'])
        for field,value in [('reviewer',''),('reason',''),('confounders_checked',False),('temporal_adequacy_confirmed',False),('review_confidence','invented')]:
            with self.subTest(field=field),self.assertRaises(ValueError):validate_review(self.review(**{field:value}),sample,protocol)
        sample['imagery']['clear_overlap_fraction']=.89
        with self.assertRaises(ValueError):validate_review(self.review(),sample,protocol)
        sample['imagery']['before_date']='2023-12-01'
        with self.assertRaises(ValueError):validate_review(self.review(label='burn_scar'),sample,protocol)
        sample['imagery']=None
        with self.assertRaises(ValueError):validate_review(self.review(),sample,protocol)
        self.assertEqual(validate_review(self.review(label='unknown'),sample,protocol)['label'],'unknown')

    def test_burn_polygon_must_be_in_cell_and_at_least_one_hectare(self):
        from shapely.geometry import shape
        polygon=shape(self.sample['geometry']);small=polygon.centroid.buffer(.00001)
        with self.assertRaises(ValueError):validate_review(self.review(label='burn_scar',polygon=mapping(small)),self.sample,self.pilot['review_protocol'])
        with self.assertRaises(ValueError):validate_review(self.review(label='burn_scar',polygon=mapping(box(0,0,1,1))),self.sample,self.pilot['review_protocol'])
        reviewed=validate_review(self.review(label='burn_scar',polygon=self.sample['geometry']),self.sample,self.pilot['review_protocol'])
        self.assertEqual(reviewed['label'],'burn_scar')

    def test_review_batch_is_atomic_and_locked_labels_are_immutable(self):
        original=copy.deepcopy(self.pilot)
        with self.assertRaises(ValueError):apply_reviews(original,[self.review(sample_id=self.sample['sample_id']),self.review(sample_id='unknown')])
        self.assertEqual(original,self.pilot)
        updated=apply_reviews(original,[self.review(sample_id=self.sample['sample_id'])])
        with self.assertRaises(ValueError):apply_reviews(updated,[self.review(sample_id=self.sample['sample_id'])])

    def test_confusion_counts_exclude_unknown_and_unlocked(self):
        samples=[dict(self.sample,label=label,locked=locked,viirs_count=count) for label,locked,count in [
            ('burn_scar',True,2),('burn_scar',True,0),('no_burn_evidence',True,0),('no_burn_evidence',True,4),('unknown',True,0),('no_burn_evidence',False,0)]]
        result=evaluate(samples)
        self.assertEqual(result['confusion_matrix'],dict(tp=1,fp=1,tn=1,fn=1))
        self.assertEqual(result['metrics']['f1'],.5)
        self.assertEqual(result['denominators']['accuracy'],4)
        self.assertEqual(result['unknown_samples'],2)

    def test_optical_scale_offset_and_cloud_mask(self):
        with tempfile.TemporaryDirectory() as temporary:
            profile=dict(driver='GTiff',crs='EPSG:32647',transform=from_origin(0,40,20,20),width=2,height=2,count=1,dtype='uint16',nodata=0)
            bands={}
            for name,data in [('nir',[[6000,6000],[6000,0]]),('swir',[[3000,3000],[3000,0]]),('red',[[2000]*2]*2),('qa',[[4,8],[5,0]])]:
                path=Path(temporary)/(name+'.tif')
                with rasterio.open(path,'w',**profile) as dst:dst.write(np.array(data,dtype='uint16'),1)
                bands[name]=dict(path=str(path),scale=.0001,offset=-.1)
            nbr,valid,_,_=scene_arrays(dict(product='sentinel-2',bands=bands),profile)
            self.assertAlmostEqual(float(nbr[0,0]),3/7,6)
            self.assertEqual(valid.tolist(),[[True,False],[True,False]])
            self.assertTrue(np.isnan(nbr[0,1]))
            del bands['nir']['offset']
            with self.assertRaises(ValueError):scene_arrays(dict(product='sentinel-2',bands=bands),profile)

    def test_swath_pairing_and_qa_classes(self):
        good=paired_metadata('VNP14IMG.A2024061.0548.002.a.nc','VNP03IMG.A2024061.0548.002.b.nc')
        self.assertEqual(good['platform'],'S-NPP')
        with self.assertRaises(ValueError):paired_metadata('VNP14IMG.A2024061.0548.002.a.nc','VNP03IMG.A2024061.0554.002.b.nc')
        flags=decode_flags(np.arange(10),np.zeros(10,dtype='uint32'),np.zeros(10,dtype='uint8'))
        self.assertEqual(np.flatnonzero(flags['usable']).tolist(),[5,7,8,9])
        self.assertEqual(np.flatnonzero(flags['qualifying_fire']).tolist(),[8,9])
        flags=decode_flags(np.array([9,9,9]),np.array([1<<5,1<<22,0]),np.array([0,0,1]))
        self.assertFalse(flags['usable'].any())
        with self.assertRaises(ValueError):decode_flags(np.ones(2),np.ones(3),np.ones(2))

    def test_real_pair_manifests_have_provenance_and_no_automatic_labels(self):
        processed=[s for s in self.pilot['samples'] if s['imagery']]
        self.assertEqual(len(processed),12)
        for sample in processed:
            self.assertFalse(sample['locked'])
            self.assertEqual(sample['label'],'unknown')
            self.assertEqual(sample['imagery']['crs'],'EPSG:32647')
            folder=DATA/'evidence/assets'/sample['sample_id']
            with rasterio.open(folder/'dnbr.tif') as data:self.assertTrue(data.crs.to_epsg()==32647)
            self.assertEqual(len(sample['imagery']['provenance']),2)
            self.assertTrue(all(b['sha256'] and b['source_url'] for s in sample['imagery']['provenance'] for b in s['bands']))
            check=json.loads((folder/'crosscheck.json').read_text())
            self.assertFalse(check['independent_truth'])
            self.assertLessEqual(check['burned_pixels'],check['valid_pixels'])

    def test_coverage_deduplicates_and_clips_a_realistic_swath_fixture(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);affine=from_origin(150000,2000250,375,375)
            profile=dict(driver='GTiff',crs='EPSG:32647',transform=affine,width=2,height=2,count=1,dtype='uint8',nodata=255)
            land=root/'land.tif'
            with rasterio.open(land,'w',**profile) as dst:dst.write(np.ones((2,2),dtype='uint8'),1)
            inverse=Transformer.from_crs(32647,4326,always_xy=True).transform
            polygon=transform(inverse,box(150000,1999500,150750,2000250))
            grid={'type':'FeatureCollection','features':[{'type':'Feature','id':'fixture','geometry':mapping(polygon),'properties':{}}]}
            rr,cc=np.indices((2,2));x,y=xy(affine,rr.ravel(),cc.ravel());lon,lat=inverse(x,y)
            fire=root/'VNP14IMG.A2024061.0548.002.a.nc';geo=root/'VNP03IMG.A2024061.0548.002.b.nc'
            with h5py.File(fire,'w') as f:f['fire mask']=np.array([[5,8],[4,6]],dtype='uint8');f['algorithm QA']=np.zeros((2,2),dtype='uint32')
            with h5py.File(geo,'w') as f:
                g=f.create_group('geolocation_data');g['latitude']=np.array(lat).reshape(2,2);g['longitude']=np.array(lon).reshape(2,2);g['quality_flag']=np.zeros((2,2),dtype='uint8')
            pair=dict(fire=str(fire),geolocation=str(geo),pass_id='fixture-pass')
            result=aggregate(dict(pairs=[pair,pair],land_mask_source='Synthetic test fixture only'),land,grid)
            self.assertEqual(len(result['sources']),1)
            row=result['passes'][0]
            self.assertEqual(row['land_pixels'],4)
            self.assertEqual(row['usable_pixels'],2)
            self.assertEqual(row['usable_land_fraction'],.5)
            self.assertEqual(row['qualifying_fire_pixels'],1)
            self.assertEqual(row['cloud_pixels'],1)
            self.assertEqual(row['unclassified_pixels'],1)
            with h5py.File(geo,'a') as f:del f['geolocation_data/latitude'];f['geolocation_data/latitude']=np.ones((3,3))
            with self.assertRaises(ValueError):load_swath(pair)

if __name__=='__main__':unittest.main()
