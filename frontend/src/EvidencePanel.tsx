import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { Download, EyeOff, FileCheck, Images, LockKeyhole, ScanLine, ChevronDown, X, Play, Pause, RotateCcw, Flame, Maximize2 } from 'lucide-react';
import { booleanWithin } from '@turf/turf';
import { Pilot, Sample, EvidenceLabel, agreement, validateReview } from './evidence';
import { download, csv } from './data';
import { getForestName, getRegionName } from './reserves-i18n';

interface Props {
  pilot: Pilot;
  sample: Sample | undefined;
  forestSamples: Sample[];
  periodSamples: Sample[];
  periodLabel: string;
  selectedForestId?: string;
  lang?: string;
  t: (key: string) => string;
  onSelect: (sample: Sample) => void;
  onReview: (sample: Sample) => void;
  onClose: () => void;
}

function Burn3DDroneView({
  center,
  burnPolygon,
  caption,
  lang,
}: {
  center: [number, number];
  burnPolygon: any;
  caption: string;
  lang: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const expandRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const [enlarged, setEnlarged] = useState(false);
  const expandLabel = lang === 'mm' ? '3D မြင်ကွင်း ချဲ့ရန်' : 'Expand 3D view';
  const closeLabel = lang === 'mm' ? '3D မြင်ကွင်း ပိတ်ရန်' : 'Close expanded 3D view';
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const rafRef = useRef<number | null>(null);
  const [orbiting, setOrbiting] = useState(true);
  const orbitingRef = useRef(true);
  orbitingRef.current = orbiting;

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      center,
      zoom: 13.4,
      pitch: 62,
      bearing: -20,
      attributionControl: false,
      style: {
        version: 8,
        sources: {
          satellite: {
            type: 'raster',
            tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
            tileSize: 256,
          },
          terrainDem: {
            type: 'raster-dem',
            tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
            tileSize: 256,
            encoding: 'terrarium',
          },
        },
        layers: [{ id: 'satellite', type: 'raster', source: 'satellite' }],
        terrain: { source: 'terrainDem', exaggeration: 1.75 },
      },
    });
    mapRef.current = map;

    map.on('load', () => {
      const geoData = burnPolygon
        ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: burnPolygon, properties: {} }] }
        : { type: 'FeatureCollection', features: [] };

      map.addSource('burn-scar', { type: 'geojson', data: geoData as any });
      map.addLayer({
        id: 'burn-scar-fill',
        type: 'fill',
        source: 'burn-scar',
        paint: { 'fill-color': '#fb7185', 'fill-opacity': 0.42 },
      });
      map.addLayer({
        id: 'burn-scar-line',
        type: 'line',
        source: 'burn-scar',
        paint: { 'line-color': '#fde047', 'line-width': 2.5 },
      });

      const loopOrbit = () => {
        if (orbitingRef.current && mapRef.current) {
          mapRef.current.setBearing((mapRef.current.getBearing() + 0.14) % 360);
        }
        rafRef.current = requestAnimationFrame(loopOrbit);
      };
      rafRef.current = requestAnimationFrame(loopOrbit);
    });

    map.on('dragstart', () => setOrbiting(false));

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      map.remove();
    };
  }, [center[0], center[1], burnPolygon]);

  useEffect(() => {
    mapRef.current?.resize();
    if (enlarged && dialogRef.current?.open) closeRef.current?.focus();
    if (!enlarged && dialogRef.current && !dialogRef.current.open && restoreFocus.current) {
      restoreFocus.current = false;
      expandRef.current?.focus();
    }
  }, [enlarged]);

  return (
    <dialog
      ref={dialogRef}
      className="drone-3d-card"
      aria-label={caption}
      onClose={() => {
        setEnlarged(false);
        restoreFocus.current = true;
      }}
    >
      <div ref={containerRef} className="drone-3d-canvas" aria-label="3D Drone Burn Area View" />
      <span className="drone-3d-badge">3D DRONE LOOP</span>
      <div className="drone-3d-controls">
        <button type="button" onClick={() => setOrbiting((v) => !v)} title={orbiting ? 'Pause Orbit' : 'Resume Orbit'}>
          {orbiting ? <Pause size={13} /> : <Play size={13} />}
          <span>{orbiting ? 'Pause' : 'Orbit'}</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setOrbiting(true);
            mapRef.current?.easeTo({ center, pitch: 62, zoom: 13.4, bearing: -20, duration: 700 });
          }}
          title="Reset Camera"
        >
          <RotateCcw size={13} />
        </button>
        {enlarged ? (
          <button
            ref={closeRef}
            type="button"
            title={closeLabel}
            aria-label={closeLabel}
            onClick={() => dialogRef.current?.close()}
          >
            <X size={16} aria-hidden="true" />
          </button>
        ) : (
          <button
            ref={expandRef}
            type="button"
            title={expandLabel}
            aria-label={expandLabel}
            aria-haspopup="dialog"
            onClick={() => {
              dialogRef.current?.showModal();
              setEnlarged(true);
            }}
          >
            <Maximize2 size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="drone-3d-caption">{caption}</div>
    </dialog>
  );
}

export function EvidencePanel({ pilot, sample, forestSamples, periodSamples, periodLabel, selectedForestId, lang = 'en', t, onSelect, onReview, onClose }: Props) {
  const [position, setPosition] = useState(50);
  const [imageMode, setImageMode] = useState('compare');
  const [reviewer, setReviewer] = useState('');
  const [reason, setReason] = useState('');
  const [label, setLabel] = useState<EvidenceLabel>('unknown');
  const [confidence, setConfidence] = useState('low');
  const [checked, setChecked] = useState(false);
  const [temporal, setTemporal] = useState(false);
  const [polygon, setPolygon] = useState<any>(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(!window.matchMedia('(max-width:760px)').matches);
  const [crosscheck, setCrosscheck] = useState<any>(null);
  const touchStart = useRef(0);

  const activeSample: any = sample;

  useEffect(() => {
    setPosition(50);
    setReviewer(activeSample?.reviewer || '');
    setReason(activeSample?.locked ? activeSample.reason : '');
    setLabel(activeSample?.label || 'unknown');
    setConfidence(activeSample?.review_confidence || 'low');
    setChecked(false);
    setTemporal(false);
    setPolygon(null);
    setError('');
    setCrosscheck(null);
    if (activeSample?.locked && activeSample.imagery) {
      fetch(activeSample.imagery.asset_base + '/crosscheck.json')
        .then((r) => (r.ok ? r.json() : null))
        .then(setCrosscheck)
        .catch(() => {});
    }
  }, [activeSample?.sample_id, activeSample?.locked]);

  const result = agreement(forestSamples);
  const score = (value: number | null) => (value == null ? '—' : (value * 100).toFixed(1) + '%');

  const save = () => {
    if (!activeSample) return;
    const problem = validateReview(activeSample, label, reviewer, reason, checked, temporal, polygon, pilot);
    if (problem) {
      setError(t(problem));
      return;
    }
    onReview({
      ...activeSample,
      label,
      reviewer,
      reason,
      locked: true,
      polygon,
      review_confidence: confidence,
      reviewed_at: new Date().toISOString(),
      confounders_checked: checked,
      temporal_adequacy_confirmed: temporal,
    });
    setError(t('reviewSaved'));
  };

  const uploadPolygon = async (file?: File) => {
    if (!file || !activeSample) return;
    try {
      const data = JSON.parse(await file.text());
      const feature = data.type === 'Feature' ? data : { type: 'Feature', geometry: data, properties: {} };
      if (!['Polygon', 'MultiPolygon'].includes(feature.geometry.type) || !booleanWithin(feature, { type: 'Feature', geometry: activeSample.geometry, properties: {} }))
        throw Error();
      setPolygon(feature);
      setError('');
    } catch {
      setError(t('polygonRequired'));
    }
  };

  const exportReviews = () =>
    download(
      'myanmar-forestwatch-reviews.json',
      JSON.stringify(
        forestSamples
          .filter((s) => s.locked)
          .map((s: any) => ({
            sample_id: s.sample_id,
            forest_name: s.forest_name,
            label: s.label,
            reviewer: s.reviewer,
            reason: s.reason,
            polygon: s.polygon,
            reviewed_at: s.reviewed_at,
          })),
        null,
        2
      )
    );

  const exportTable = () =>
    download(
      'myanmar-forestwatch-validation.csv',
      csv(
        forestSamples.map((s: any) => ({
          sample_id: s.sample_id,
          forest_name: s.forest_name,
          region: s.region_en,
          cell_id: s.cell_id,
          period: s.period,
          burned_area_ha: s.burned_area_ha,
          severity: s.severity,
          label: s.label,
          viirs_count: s.viirs_count,
          aoi: 'myanmar_10_reserved_forests_v2',
        }))
      ),
      'text/csv'
    );

  const exportPolygons = () =>
    download(
      'myanmar-forestwatch-burn-polygons.geojson',
      JSON.stringify(
        {
          type: 'FeatureCollection',
          features: forestSamples
            .filter((s: any) => s.polygon)
            .map((s: any) => ({
              type: 'Feature',
              geometry: s.polygon.geometry || s.polygon,
              properties: {
                sample_id: s.sample_id,
                forest_name: s.forest_name,
                region: s.region_en,
                period: s.period,
                burned_area_ha: s.burned_area_ha,
                severity: s.severity,
              },
            })),
        },
        null,
        2
      )
    );

  const center: [number, number] = activeSample?.centroid || [activeSample?.lon ?? 96.12, activeSample?.lat ?? 18.92];
  const localizedForest = getForestName(activeSample, lang);
  const localizedRegion = getRegionName(activeSample, lang);
  const simpleCaption =
    (lang === 'mm' ? activeSample?.caption_mm : activeSample?.caption) ||
    `${localizedForest || activeSample?.cell_id} • ${activeSample?.period} • ${activeSample?.burned_area_ha || 220} ${lang === 'mm' ? 'ဟက်တာ' : 'ha'}`;

  return (
    <aside className={`glass evidence-panel ${expanded ? 'expanded' : 'collapsed'}`} aria-label={t('evidence')}>
      <div
        className="sheet-handle"
        onTouchStart={(e) => {
          touchStart.current = e.touches[0].clientY;
        }}
        onTouchEnd={(e) => setExpanded(e.changedTouches[0].clientY < touchStart.current)}
      >
        <button onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-label={t('evidence')}>
          <span />
        </button>
      </div>

      <div className="drawer-heading">
        <div>
          <span className="eyebrow">{t('pilot')}</span>
          <h2>{t('evidence')}</h2>
        </div>
        <button className="round-button" onClick={onClose} aria-label={t('close')}>
          <X size={18} />
        </button>
      </div>

      {!expanded && activeSample && <p className="collapsed-selection">{simpleCaption}</p>}

      <div className="evidence-scroll">
        {periodSamples.length === 0 ? (
          <div className="empty-evidence" role="status">
            <Images size={32} aria-hidden="true" />
            <p>{periodLabel} · {t('noEvidenceForMonth')}</p>
          </div>
        ) : (
          <label className="field-label">
            {lang === 'mm' ? `မီးလောင်မှု အထောက်အထား (${periodSamples.length} ခု)` : `Burnt Evidence (${periodSamples.length} curated)`}
            <select
              value={activeSample?.sample_id || ''}
              onChange={(e) => {
                const found = periodSamples.find((s) => s.sample_id === e.target.value);
                if (found) onSelect(found);
              }}
            >
              <option value="" disabled>
                {t('noSample')}
              </option>
              {periodSamples.map((s: any) => (
                <option value={s.sample_id} key={s.sample_id}>
                  {getForestName(s, lang)} · {s.date_label || s.period} ({s.burned_area_ha} {lang === 'mm' ? 'ဟက်တာ' : 'ha'})
                </option>
              ))}
            </select>
          </label>
        )}

        {selectedForestId && selectedForestId !== 'all' && periodSamples.length > 1 && (
          <div style={{ display: 'grid', gridTemplateColumns: periodSamples.length > 2 ? 'repeat(3, 1fr)' : '1fr 1fr', gap: 8, margin: '6px 0' }}>
            {periodSamples.map((item: any, idx: number) => (
              <button
                key={item.sample_id}
                type="button"
                className={`outline-button ${item.sample_id === activeSample?.sample_id ? 'active' : ''}`}
                onClick={() => onSelect(item)}
                style={{
                  justifyContent: 'center',
                  borderColor: item.sample_id === activeSample?.sample_id ? 'var(--mint)' : undefined,
                }}
              >
                <Flame size={14} />
                <span>
                  #{idx + 1} · {item.date_label}
                </span>
              </button>
            ))}
          </div>
        )}

        {activeSample && (
          <>
            {/* 3D Drone Orbit View with Simple Caption */}
            <Burn3DDroneView center={center} burnPolygon={activeSample.polygon} caption={simpleCaption} lang={lang} />

            <div className="review-status">
              <span className={`status-label ${activeSample.locked ? 'locked' : ''}`}>
                {activeSample.locked ? <FileCheck size={14} /> : <EyeOff size={14} />}{' '}
                {activeSample.locked ? `${activeSample.burned_area_ha} ha · ${activeSample.severity}` : t('reviewPending')}
              </span>
              <span>{localizedRegion}</span>
            </div>

            {activeSample.imagery ? (
              <>
                <div className="image-switch" role="group" aria-label={t('compare')}>
                  {['before', 'compare', 'after'].map((m) => (
                    <button key={m} className={imageMode === m ? 'active' : ''} onClick={() => setImageMode(m)}>
                      {t(m)}
                    </button>
                  ))}
                </div>
                <div className="image-comparison">
                  <img src={activeSample.imagery.asset_base + '/after.png'} alt={`${t('after')} ${activeSample.imagery.after_date.slice(0, 10)}`} />
                  <img
                    className="before-image"
                    src={activeSample.imagery.asset_base + '/before.png'}
                    alt={`${t('before')} ${activeSample.imagery.before_date.slice(0, 10)}`}
                    style={{ clipPath: `inset(0 ${imageMode === 'before' ? 0 : imageMode === 'after' ? 100 : 100 - position}% 0 0)` }}
                  />
                  {imageMode === 'compare' && (
                    <>
                      <div className="compare-line" style={{ left: position + '%' }}>
                        <ScanLine size={18} />
                      </div>
                      <input type="range" min="0" max="100" value={position} onChange={(e) => setPosition(Number(e.target.value))} aria-label={t('swipe')} />
                    </>
                  )}
                  {imageMode !== 'after' && <span className="image-caption left">{t('before')}</span>}
                  {imageMode !== 'before' && <span className="image-caption right">{t('after')}</span>}
                </div>
                <div className="image-dates">
                  <span>{activeSample.imagery.before_date.slice(0, 10)}</span>
                  <span>{activeSample.imagery.after_date.slice(0, 10)}</span>
                </div>
                <div className="evidence-stat">
                  <span>{lang === 'mm' ? 'လောင်ကျွမ်းဧရိယာ' : 'Burned Area'}</span>
                  <strong>{activeSample.burned_area_ha} {lang === 'mm' ? 'ဟက်တာ' : 'ha'}</strong>
                </div>
                <div className="evidence-stat">
                  <span>VIIRS Hotspots</span>
                  <strong>{activeSample.viirs_count}</strong>
                </div>
                <details className="evidence-details">
                  <summary>{t('viewSources')}</summary>
                  <p>{simpleCaption}</p>
                  <a href={activeSample.imagery.asset_base + '/metadata.json'} target="_blank" rel="noreferrer">
                    {t('dataset')} ↗
                  </a>
                  <a href={activeSample.imagery.asset_base + '/dnbr.tif'} download>
                    dNBR GeoTIFF ↓
                  </a>
                </details>
              </>
            ) : (
              <div className="empty-evidence">
                <Images size={32} />
                <p>{t('awaitingImages')}</p>
              </div>
            )}

            {!activeSample.locked && (
              <details className="review-form">
                <summary>
                  <FileCheck size={16} />
                  {t('review')}
                  <ChevronDown size={16} />
                </summary>
                <label>
                  {t('labels')}
                  <select value={label} onChange={(e) => setLabel(e.target.value as EvidenceLabel)}>
                    {['unknown', 'burn_scar', 'no_burn_evidence'].map((value) => (
                      <option key={value} value={value}>
                        {t(value)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t('reviewer')}
                  <input value={reviewer} onChange={(e) => setReviewer(e.target.value)} maxLength={100} />
                </label>
                <label>
                  {t('rationale')}
                  <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
                </label>
                {label === 'burn_scar' && (
                  <label>
                    {t('polygonRequired')}
                    <input type="file" accept=".json,.geojson" onChange={(e) => uploadPolygon(e.target.files?.[0])} />
                  </label>
                )}
                {label !== 'unknown' && (
                  <label className="check-label">
                    <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
                    {t('confounders')}
                  </label>
                )}
                <button className="action-button" onClick={save}>
                  <LockKeyhole size={15} />
                  {t('lockReview')}
                </button>
              </details>
            )}
            {error && (
              <p className="form-message" role="status">
                {error}
              </p>
            )}
          </>
        )}

        <section className="pilot-summary">
          <h3>{lang === 'mm' ? 'ရွေးချယ်ထားသော မီးလောင်မှုအနှစ်ချုပ်' : 'Curated Burn Summary'}</h3>
          <div className="metric-grid">
            <div>
              <strong>
                {result.known}/{forestSamples.length}
              </strong>
              <span>Verified</span>
            </div>
            <div>
              <strong>{score(result.f1)}</strong>
              <span>F1</span>
            </div>
            <div>
              <strong>10+1</strong>
              <span>{lang === 'mm' ? 'သစ်တောနှင့် ပဲခူးရိုးမ' : 'Reserves + Bago'}</span>
            </div>
          </div>
          <div className="evidence-exports">
            <button className="outline-button" onClick={exportReviews}>
              <Download size={15} />
              {t('exportReviews')}
            </button>
            <button className="outline-button" onClick={exportTable}>
              {t('validationCsv')}
            </button>
            <button className="outline-button" onClick={exportPolygons}>
              {t('polygonExport')}
            </button>
          </div>
        </section>
      </div>
    </aside>
  );
}
