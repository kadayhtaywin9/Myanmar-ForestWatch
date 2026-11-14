"""Versioned independent imagery review, sampling, and sample-level agreement."""
from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from shapely.geometry import shape, mapping
from shapely.ops import transform
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'public/data'
LABELS = {'burn_scar', 'no_burn_evidence', 'unknown'}


def save_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(content, encoding='utf-8')
    temporary.replace(path)


def make_sample(seed=42):
    cells = json.loads((DATA / 'grid.geojson').read_text())['features']
    strata = defaultdict(list)
    for year in (2024, 2025):
        detections = Counter((row['cell_id'], row['date'][:7]) for row in json.loads(
            (DATA / f'hotspots-{year}.json').read_text()) if row['qualified'] and row['sensor'] == 'VIIRS')
        for feature in cells:
            for month in range(1, 13):
                period = f'{year}-{month:02d}'
                count = detections[(feature['id'], period)]
                season = 'dry_Nov_Apr' if month in (11, 12, 1, 2, 3, 4) else 'wet_May_Oct'
                key = f'{year}_{season}_{int(count > 0)}'
                strata[key].append({
                    'sample_id': f"{feature['id']}_{period}", 'cell_id': feature['id'],
                    'period': period, 'season': season, 'stratum': key,
                    'lat': feature['properties']['lat'], 'lon': feature['properties']['lon'],
                    'geometry': feature['geometry'], 'viirs_count': count,
                    'label': 'unknown', 'locked': False, 'reviewer': '',
                    'reason': 'Awaiting independent imagery review', 'imagery': None,
                    'coverage': {'status': 'unavailable', 'passes': []},
                })
    rng = np.random.default_rng(seed)
    selected = []
    for index, key in enumerate(sorted(strata)):
        candidates = sorted(strata[key], key=lambda x: (x['lat'], x['cell_id'], x['period']))
        quota = 8 if index % 2 == 0 else 7
        # Latitude bands spread the pilot geographically. Preserve each inclusion probability.
        bands = np.array_split(np.arange(len(candidates)), 3)
        for band_index, band in enumerate(bands):
            n = quota // 3 + int(band_index < quota % 3)
            for choice in rng.choice(band, n, replace=False):
                row = candidates[int(choice)]
                row.update({'geographic_band': band_index, 'population_in_band': len(band),
                            'sampled_in_band': n, 'inclusion_probability': n / len(band)})
                selected.append(row)
    selected.sort(key=lambda x: x['sample_id'])
    return {'schema_version': 2, 'seed': seed, 'sample_count': len(selected),
            'created_at': datetime.now(timezone.utc).isoformat(),
            'sampling': 'Stratified by year, season, VIIRS recorded presence and latitude third. Fixed random seed.',
            'grid': '5 km EPSG:32647, AOI-clipped', 'aoi_version': 'approximate_bago_yoma_v1',
            'review_protocol': {'min_clear_overlap': .9, 'max_bracket_days': 45,
                                'minimum_mappable_area_m2': 10000,
                                'status': 'Pilot thresholds requiring local expert review'},
            'samples': selected}


def validate_review(review, sample, protocol):
    label = review.get('label')
    if label not in LABELS:
        raise ValueError('Unsupported review label')
    if not review.get('reviewer', '').strip() or not review.get('reason', '').strip():
        raise ValueError('Reviewer and evidence rationale are required')
    imagery = sample.get('imagery')
    if label != 'unknown':
        if review.get('review_confidence') not in ('low', 'medium', 'high'):
            raise ValueError('Record low, medium or high review confidence')
        if not imagery or imagery.get('status') != 'processed':
            raise ValueError('Processed before/after imagery is required')
        before = datetime.fromisoformat(imagery['before_date'][:10])
        after = datetime.fromisoformat(imagery['after_date'][:10])
        if before >= after:
            raise ValueError('Image dates must be chronological')
        # A monthly event label requires the observed interval to be contained in the month.
        if before.strftime('%Y-%m') != sample['period'] or after.strftime('%Y-%m') != sample['period']:
            raise ValueError('The burn interval crosses the target month. Keep the monthly label unknown.')
        if not review.get('confounders_checked'):
            raise ValueError('Review seasonal changes, harvest and other confounders')
        if label == 'no_burn_evidence':
            if imagery['clear_overlap_fraction'] < protocol['min_clear_overlap']:
                raise ValueError('Insufficient clear overlap for this negative-evidence label')
            if (after-before).days > protocol['max_bracket_days']:
                raise ValueError('Image gap exceeds review protocol')
            # Sparse snapshots within the month cannot establish its entire review interval.
            if not review.get('temporal_adequacy_confirmed'):
                raise ValueError('Document why the imagery adequately represents the target month')
        if label == 'burn_scar':
            polygon = review.get('polygon')
            if not polygon:
                raise ValueError('A reviewed burn polygon is required')
            geometry = shape(polygon.get('geometry', polygon))
            cell = shape(sample['geometry'])
            if geometry.is_empty or not geometry.is_valid or geometry.geom_type not in ('Polygon', 'MultiPolygon'):
                raise ValueError('Invalid burn polygon')
            if not cell.buffer(1e-8).covers(geometry):
                raise ValueError('Burn polygon must be clipped to the sampled cell')
            area = transform(Transformer.from_crs(4326, 32647, always_xy=True).transform, geometry).area
            if area < protocol['minimum_mappable_area_m2']:
                raise ValueError('Burn polygon is smaller than the pilot minimum mappable area')
    return {**sample, 'label': label, 'locked': True, 'reviewer': review['reviewer'].strip(),
            'reason': review['reason'].strip(), 'reviewed_at': datetime.now(timezone.utc).isoformat(),
            'confounders_checked': bool(review.get('confounders_checked')),
            'temporal_adequacy_confirmed': bool(review.get('temporal_adequacy_confirmed')),
            'review_confidence': review.get('review_confidence', 'low'),
            'polygon': review.get('polygon'), 'review_origin': review.get('review_origin', 'human')}


def agreement_counts(samples):
    known = [s for s in samples if s.get('locked') and s['label'] in ('burn_scar', 'no_burn_evidence')]
    counts = {'tp': 0, 'fp': 0, 'tn': 0, 'fn': 0}
    for row in known:
        positive = row['label'] == 'burn_scar'
        detected = row['viirs_count'] > 0
        counts['tp' if positive and detected else 'fn' if positive else 'fp' if detected else 'tn'] += 1
    tp, fp, tn, fn = (counts[k] for k in ('tp', 'fp', 'tn', 'fn'))
    divide = lambda numerator, denominator: numerator / denominator if denominator else None
    metrics = {'accuracy': divide(tp+tn, len(known)), 'precision': divide(tp, tp+fp),
               'recall': divide(tp, tp+fn), 'f1': divide(2*tp, 2*tp+fp+fn)} if known else None
    return {'known_samples': len(known), 'unknown_samples': len(samples)-len(known),
            'pending_reviews': sum(not s.get('locked') for s in samples), 'confusion_matrix': counts,
            'metrics': metrics, 'denominators': {'accuracy':len(known), 'precision':tp+fp, 'recall':tp+fn, 'f1':2*tp+fp+fn},
            'samples_with_retrieved_passes':sum(bool(s.get('coverage',{}).get('passes')) for s in samples)}


def evaluate(samples):
    return {'target': 'Qualifying VIIRS presence versus independent image-based burn evidence',
            'scope': 'Unweighted pilot sample agreement; source sampling is disproportionate',
            **agreement_counts(samples),
            'by_season': {season: agreement_counts([s for s in samples if s['season']==season])
                          for season in ('dry_Nov_Apr', 'wet_May_Oct')}}


def apply_reviews(dataset, reviews):
    lookup = {r['sample_id']: r for r in reviews}
    if len(lookup) != len(reviews) or set(lookup) - {s['sample_id'] for s in dataset['samples']}:
        raise ValueError('Duplicate or unknown sample IDs')
    for sample in dataset['samples']:
        if sample.get('locked') and sample['sample_id'] in lookup:
            raise ValueError('A locked review cannot be overwritten. Archive and adjudicate corrections separately.')
    updated = [validate_review(lookup[s['sample_id']], s, dataset['review_protocol'])
               if s['sample_id'] in lookup else s for s in dataset['samples']]
    return {**dataset, 'samples': updated, 'evaluation': evaluate(updated)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['sample', 'evaluate', 'import-reviews'])
    parser.add_argument('--reviews', type=Path)
    parser.add_argument('--seed', type=int, default=42)
    args = parser.parse_args()
    path = DATA / 'evidence/pilot.json'
    if args.action == 'sample':
        if path.exists():
            raise SystemExit('Pilot already exists. Archive it explicitly before selecting a new sample.')
        dataset = make_sample(args.seed)
    else:
        dataset = json.loads(path.read_text())
        if args.action == 'import-reviews':
            dataset = apply_reviews(dataset, json.loads(args.reviews.read_text()))
    dataset['evaluation'] = evaluate(dataset['samples'])
    save_json(path, dataset)
    print(json.dumps({'samples': len(dataset['samples']), **dataset['evaluation']}))

if __name__ == '__main__':
    main()
