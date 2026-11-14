import {area, booleanWithin, booleanValid} from '@turf/turf';
export type EvidenceLabel = 'burn_scar' | 'no_burn_evidence' | 'unknown';
export interface Imagery {
  status: string; before_date: string; after_date: string; before_id: string; after_id: string;
  asset_base: string; clear_overlap_fraction: number; monthly_interval_contained: boolean;
  candidate_count: number; candidate_area_m2: number; resolution_m: number; qa_method: string;
  display: string; provenance: any[];
}
export interface Sample {
  sample_id: string; cell_id: string; period: string; lat: number; lon: number; geometry: any;
  season: string; viirs_count: number; label: EvidenceLabel; locked: boolean; reviewer: string;
  reason: string; imagery: Imagery | null; coverage: {status: string; passes: any[]};
  polygon?: any; confounders_checked?: boolean; temporal_adequacy_confirmed?: boolean;
  review_confidence?: string; reviewed_at?: string;
}
export interface Pilot { schema_version: number; samples: Sample[]; evaluation: any;
  review_protocol: {min_clear_overlap: number; max_bracket_days: number; minimum_mappable_area_m2: number}; }
export function validateReview(sample: Sample, label: EvidenceLabel, reviewer: string, reason: string, checked: boolean, temporal: boolean, polygon: any, pilot: Pilot) {
  if (!reviewer.trim() || !reason.trim()) return 'reviewRequired';
  if (label === 'unknown') return null;
  if (!sample.imagery || sample.imagery.status !== 'processed') return 'imageryRequired';
  const before = new Date(sample.imagery.before_date), after = new Date(sample.imagery.after_date);
  if (!(after > before) || sample.imagery.before_date.slice(0,7)!==sample.period || sample.imagery.after_date.slice(0,7)!==sample.period) return 'intervalUnknown';
  if (!checked) return 'checkConfounders';
  if (label === 'no_burn_evidence' && (sample.imagery.clear_overlap_fraction < pilot.review_protocol.min_clear_overlap || !temporal || (+after-+before)/86400000 > pilot.review_protocol.max_bracket_days)) return 'adequacyRequired';
  if (label === 'burn_scar') {
    try {const feature=polygon?.type==='Feature'?polygon:{type:'Feature',geometry:polygon,properties:{}};
      if (!['Polygon','MultiPolygon'].includes(feature.geometry?.type) || !booleanValid(feature) || area(feature)<pilot.review_protocol.minimum_mappable_area_m2 || !booleanWithin(feature,{type:'Feature',geometry:sample.geometry,properties:{}})) return 'polygonRequired';
    } catch {return 'polygonRequired';}
  }
  return null;
}
export function agreement(samples: Sample[]) {
  const known = samples.filter(s => s.locked && s.label !== 'unknown');
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (const s of known) {
    if (s.label === 'burn_scar') s.viirs_count > 0 ? tp++ : fn++;
    else s.viirs_count > 0 ? fp++ : tn++;
  }
  const ratio = (a: number, b: number) => b ? a / b : null;
  return {known: known.length, unknown: samples.length - known.length, tp, fp, tn, fn,
    accuracy: ratio(tp+tn, known.length), precision: ratio(tp,tp+fp), recall: ratio(tp,tp+fn), f1: ratio(2*tp,2*tp+fp+fn)};
}
