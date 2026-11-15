import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Flame,
  Layers,
  CalendarDays,
  Download,
  X,
  Moon,
  Sun,
  ArrowUpRight,
  Satellite,
  ScanLine,
  TrendingUp,
  SlidersHorizontal,
  ChevronLeft,
  Info,
  Maximize2,
  Menu,
  Upload,
  FileJson,
  Check,
  Search,
} from 'lucide-react';
import './workspace.css';
import { MapView } from './MapView';
import LegacyAnalysis from './LegacyAnalysis';
import { EvidencePanel } from './EvidencePanel';
import { Pilot, Sample, samplesForForest } from './evidence';
import { Hotspot, Risk, csv, download, getModelSlice, scenarioIndex } from './data';
import { getForestName, getRegionName, getForestTypeName } from './reserves-i18n';
import { tr } from './workspace-i18n';
import { Key } from './i18n';

const read = async (name: string) => {
  const response = await fetch('/data/' + name);
  if (!response.ok) throw new Error(name);
  return response.json();
};

type Mode = 'hotspots' | 'evidence' | 'planning';

class AnalysisErrorBoundary extends React.Component<
  { children: React.ReactNode; onClose: () => void },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '80px 32px', color: '#edf8f2', maxWidth: 680, margin: '0 auto' }}>
          <h2>Analysis View Error</h2>
          <p style={{ opacity: 0.85, marginTop: 8 }}>{this.state.error.message}</p>
          <button className="action-button" style={{ maxWidth: 200, marginTop: 16 }} onClick={this.props.onClose}>
            Back to Map
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const [lang, setLang] = useState(localStorage.getItem('fw-lang') || 'en');
  const [theme, setTheme] = useState(localStorage.getItem('fw-theme') || 'dark');
  const [solid, setSolid] = useState(localStorage.getItem('fw-solid') === 'true');
  const [mode, setMode] = useState<Mode>('hotspots');
  const [year, setYear] = useState('2025');
  const [month, setMonth] = useState('03');
  const [sensor, setSensor] = useState('both');
  const [quality, setQuality] = useState(true);
  const [basemap, setBasemap] = useState('satellite');
  const [gridOn, setGridOn] = useState(false);
  const [coverageOn, setCoverageOn] = useState(false);
  const [density, setDensity] = useState(false);
  const [adjusted, setAdjusted] = useState(false);
  const [filters, setFilters] = useState(false);
  const [calendar, setCalendar] = useState(false);
  const [menu, setMenu] = useState(false);
  const [analysis, setAnalysis] = useState<Key | null>(null);

  const [aoi, setAoi] = useState<any>(null);
  const [reserves, setReserves] = useState<any>(null);
  const [selectedForestId, setSelectedForestId] = useState<string>('all');
  const [forestQuery, setForestQuery] = useState('');
  const [forestSuggestionsOpen, setForestSuggestionsOpen] = useState(false);
  const [activeForestSuggestion, setActiveForestSuggestion] = useState(-1);
  const [grid, setGrid] = useState<any>(null);
  const [summary, setSummary] = useState<any>(null);
  const [report, setReport] = useState<any>(null);
  const [harm, setHarm] = useState<any>(null);
  const [risks, setRisks] = useState<Risk[]>([]);
  const [rows, setRows] = useState<Hotspot[]>([]);
  const [pilot, setPilot] = useState<Pilot | null>(null);
  const [sampleId, setSampleId] = useState('');
  const [candidates, setCandidates] = useState<any>(null);
  const [point, setPoint] = useState<Hotspot | null>(null);
  const [focusPoint, setFocusPoint] = useState<{ lat: number; lon: number; seq: number } | null>(null);
  const [riskCell, setRiskCell] = useState<any>(null);
  const [showEvidence, setShowEvidence] = useState(true);

  // Next 12 Months forecast only (10-year / 2030 removed)
  const [selectedModel, setSelectedModel] = useState<string>('XGBoost');
  const [scenario, setScenario] = useState('baseline');
  const horizon = 12;
  const [lead, setLead] = useState(2);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const cache = useRef<Record<string, Hotspot[]>>({});
  const dialog = useRef<HTMLDivElement>(null);

  const t = (key: string) => tr(lang, key);
  const monthText = (number: number, short = false) =>
    lang === 'mm'
      ? (short
          ? ['ဇန်', 'ဖေ', 'မတ်', 'ဧ', 'မေ', 'ဇွန်', 'ဇူ', 'ဩ', 'စက်', 'အောက်', 'နို', 'ဒီ']
          : ['ဇန်နဝါရီ', 'ဖေဖော်ဝါရီ', 'မတ်', 'ဧပြီ', 'မေ', 'ဇွန်', 'ဇူလိုင်', 'ဩဂုတ်', 'စက်တင်ဘာ', 'အောက်တိုဘာ', 'နိုဝင်ဘာ', 'ဒီဇင်ဘာ'])[
          number - 1
        ]
      : new Intl.DateTimeFormat('en-GB', { month: short ? 'short' : 'long', timeZone: 'UTC' }).format(
          new Date(Date.UTC(2025, number - 1, 1))
        );
  const fmt = (number: number) =>
    new Intl.NumberFormat('en-US').format(number).replace(/\d/g, (d) => (lang === 'mm' ? '၀၁၂၃၄၅၆၇၈၉'[Number(d)] : d));

  useEffect(() => {
    localStorage.setItem('fw-lang', lang);
    localStorage.setItem('fw-theme', theme);
    localStorage.setItem('fw-solid', String(solid));
    document.documentElement.lang = lang === 'mm' ? 'my' : 'en';
    document.documentElement.dataset.theme = theme;
  }, [lang, theme, solid]);

  useEffect(() => {
    let active = true;
    Promise.all([
      'aoi.geojson',
      'reserved-forests.geojson',
      'grid.geojson',
      'summary.json',
      'model-report.json',
      'seasonal-risk.json',
      'harmonization.json',
      'evidence/pilot.json',
    ].map(read))
      .then((values) => {
        if (!active) return;
        setAoi(values[0]);
        setReserves(values[1]);
        setGrid(values[2]);
        setSummary(values[3]);
        setReport(values[4]);
        setRisks(values[5]);
        setHarm(values[6]);
        const current = values[7] as Pilot;
        try {
          const saved = JSON.parse(localStorage.getItem('fw-reviews-v2') || '{}');
          current.samples = current.samples.map((s) => (saved[s.sample_id] ? { ...s, ...saved[s.sample_id] } : s));
        } catch {}
        setPilot(current);
        setError(false);
      })
      .catch(() => active && setError(true));
    return () => {
      active = false;
    };
  }, [retry]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    if (cache.current[year]) {
      setRows(cache.current[year]);
      setLoading(false);
      return;
    }
    read(`hotspots-${year}.json`)
      .then((data) => {
        cache.current[year] = data;
        if (active) {
          setRows(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setError(true);
          setLoading(false);
          setRows([]);
        }
      });
    return () => {
      active = false;
    };
  }, [year, retry]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (document.querySelector('.analysis-overlay .modal')) return;
        setMenu(false);
        setCalendar(false);
        setFilters(false);
        setAnalysis(null);
        setPoint(null);
        setRiskCell(null);
      }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, []);

  const searchTerms = forestQuery.normalize('NFKC').trim().toLowerCase().split(/\s+/u).filter(Boolean);
  const isSearchingForests = searchTerms.length > 0;
  const filteredReserves = (reserves?.features || []).filter(({ properties }: any) => {
    const searchableText = [
      getForestName(properties, 'en'),
      getForestName(properties, 'mm'),
      getRegionName(properties, 'en'),
      getRegionName(properties, 'mm'),
      properties.township,
      properties.township_mm,
    ].join(' ').normalize('NFKC').toLowerCase();
    return searchTerms.every((term) => searchableText.includes(term));
  });
  const forestDropdownValue = !isSearchingForests || filteredReserves.some(
    (forest: any) => forest.properties.forest_id === selectedForestId
  ) ? selectedForestId : '';

  const showForestSuggestions = forestSuggestionsOpen && isSearchingForests;
  const activeForestOption = showForestSuggestions ? filteredReserves[activeForestSuggestion] : undefined;
  useEffect(() => {
    if (activeForestOption) {
      document.getElementById(`forest-suggestion-${activeForestOption.properties.forest_id}`)
        ?.scrollIntoView({ block: 'nearest' });
    }
  }, [showForestSuggestions, activeForestSuggestion]);

  const forestSamples = useMemo(
    () => samplesForForest(pilot?.samples || [], selectedForestId),
    [pilot, selectedForestId]
  );
  const evidencePeriod = `${year}-${month}`;
  const periodSamples = useMemo(
    () => forestSamples.filter((sample) => sample.period === evidencePeriod),
    [forestSamples, evidencePeriod]
  );
  const sample = periodSamples.find((sample) => sample.sample_id === sampleId) || periodSamples[0];
  const evidenceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of forestSamples) {
      if (item.imagery) counts.set(item.period, (counts.get(item.period) || 0) + 1);
    }
    return counts;
  }, [forestSamples]);

  useEffect(() => {
    let active = true;
    setCandidates(null);
    if (sample?.imagery?.asset_base) {
      fetch(sample.imagery.asset_base + '/candidates.geojson')
        .then((r) => r.json())
        .then((data) => active && setCandidates(data))
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [sample?.imagery?.asset_base]);

  const matchesSelectedAoi = (fid?: string) => {
    if (selectedForestId === 'all') return true;
    if (selectedForestId === 'bago_yoma') {
      return fid === 'bago_yoma' || fid === 'rf_02_kabaung' || fid === 'rf_04_yenwe' || fid === 'rf_05_south_zamaye';
    }
    return fid === selectedForestId;
  };

  const available = useMemo(
    () =>
      rows.filter(
        (r: any) =>
          (!quality || r.qualified) &&
          (sensor === 'both' || r.sensor === sensor) &&
          matchesSelectedAoi(r.forest_id)
      ),
    [rows, quality, sensor, selectedForestId]
  );
  const filtered = useMemo(() => available.filter((r) => r.date.slice(5, 7) === month), [available, month]);
  const monthly = useMemo(
    () => Array.from({ length: 12 }, (_, i) => available.filter((r) => Number(r.date.slice(5, 7)) === i + 1).length),
    [available]
  );
  const timelineCounts = mode === 'evidence'
    ? monthly.map((_, index) => evidenceCounts.get(`${year}-${String(index + 1).padStart(2, '0')}`) || 0)
    : monthly;
  const maximum = Math.max(1, ...timelineCounts);
  const evidenceCountLabel = (count: number) => `${fmt(count)} ${t('imagePairCount')}`;

  const evidenceCells = useMemo(() => {
    if (mode !== 'evidence') return null;
    return {
      type: 'FeatureCollection',
      features: periodSamples.map((s: any) => ({
        type: 'Feature',
        geometry: s.polygon || s.geometry,
        properties: { sample_id: s.sample_id, cell_id: s.cell_id, forest_name: s.forest_name },
      })),
    };
  }, [mode, periodSamples]);

  const focusGeometry = useMemo(
    () => (mode === 'evidence' && sample ? { type: 'Feature', geometry: sample.polygon || sample.geometry, properties: {} } : null),
    [mode, sample]
  );

  const targetDate = new Date(
    Date.UTC(
      Number(report?.forecast_origin?.slice(0, 4) || 2026),
      Number(report?.forecast_origin?.slice(5, 7) || 12) - 1 + lead - 1,
      1
    )
  );
  const reference = useMemo(
    () => risks.map((r) => getModelSlice(r, selectedModel).raw_proxy).sort((a, b) => a - b),
    [risks, selectedModel]
  );

  const riskGeo = useMemo(() => {
    if (mode !== 'planning' || !grid) return null;
    const lookup = new Map(risks.filter((r) => r.month === targetDate.getUTCMonth() + 1).map((r) => [r.cell_id, r]));
    const filteredFeatures =
      selectedForestId === 'all'
        ? grid.features
        : grid.features.filter((f: any) => matchesSelectedAoi(f.properties?.forest_id));
    return {
      ...grid,
      features: filteredFeatures.map((f: any) => {
        const rec = lookup.get(f.id);
        const slice = rec ? getModelSlice(rec, selectedModel) : undefined;
        return {
          ...f,
          properties: {
            ...f.properties,
            ...rec,
            ...(slice || {}),
            active_model: selectedModel,
            index: rec ? scenarioIndex(rec, scenario, reference, selectedModel) : 0,
          },
        };
      }),
    };
  }, [mode, grid, risks, lead, scenario, report, reference, selectedForestId, selectedModel]);

  const activity = useMemo(() => {
    if (!adjusted || !grid || !harm || mode !== 'hotspots') return null;
    const counts = new Map<string, { modis: number; viirs: number }>();
    for (const row of rows.filter((r) => r.qualified && r.date.slice(5, 7) === month)) {
      const count = counts.get(row.cell_id) || { modis: 0, viirs: 0 };
      row.sensor === 'MODIS' ? count.modis++ : count.viirs++;
      counts.set(row.cell_id, count);
    }
    return {
      ...grid,
      features: grid.features.map((f: any) => ({
        ...f,
        properties: {
          ...f.properties,
          count: ((counts.get(f.id)?.modis || 0) * harm.ratios[String(Number(month))] + (counts.get(f.id)?.viirs || 0)) / 2,
        },
      })),
    };
  }, [adjusted, grid, harm, rows, month, mode]);

  const chooseSample = (selected: Sample) => {
    setSampleId(selected.sample_id);
    setShowEvidence(true);
    setPoint(null);
  };

  const chooseMode = (next: Mode) => {
    setMode(next);
    setPoint(null);
    setRiskCell(null);
    setFilters(false);
    if (next === 'evidence') {
      setShowEvidence(true);
    }
  };

  const handleForestSelect = (fid: string) => {
    setSelectedForestId(fid);
    setForestQuery('');
    setForestSuggestionsOpen(false);
    setActiveForestSuggestion(-1);
    setSampleId('');
  };

  const recordReview = (updated: Sample) => {
    if (!pilot) return;
    const next = { ...pilot, samples: pilot.samples.map((s) => (s.sample_id === updated.sample_id ? updated : s)) };
    const persisted = Object.fromEntries(
      next.samples
        .filter((s) => s.locked)
        .map((s) => [
          s.sample_id,
          {
            label: s.label,
            locked: true,
            reviewer: s.reviewer,
            reason: s.reason,
            polygon: s.polygon,
            confounders_checked: s.confounders_checked,
            temporal_adequacy_confirmed: s.temporal_adequacy_confirmed,
            review_confidence: s.review_confidence,
            reviewed_at: s.reviewed_at,
          },
        ])
    );
    try {
      localStorage.setItem('fw-reviews-v2', JSON.stringify(persisted));
      setPilot(next);
    } catch {
      setError(true);
    }
  };

  const exportHotspots = () =>
    download(
      'myanmar-forestwatch-hotspots.csv',
      csv(
        filtered.map((row) => ({
          ...row,
          aoi: 'myanmar_10_reserved_forests_v2',
          source_version: summary?.updated_at,
          exported_at: new Date().toISOString(),
        }))
      ),
      'text/csv'
    );

  const exportPilot = () =>
    download(
      'myanmar-forestwatch-burn-evidence.geojson',
      JSON.stringify(
        {
          type: 'FeatureCollection',
          features: pilot?.samples.map(({ geometry, polygon, ...properties }: any) => ({
            type: 'Feature',
            geometry: polygon || geometry,
            properties,
          })),
        },
        null,
        2
      )
    );

  const selectedForestObj = reserves?.features?.find((f: any) => f.properties.forest_id === selectedForestId);

  return (
    <div className={`workspace ${solid ? 'solid' : ''} ${lang === 'mm' ? 'myanmar' : ''} mode-${mode}`}>
      {!analysis && (
      <div className="map-stage">
        <MapView
          rows={mode === 'hotspots' ? filtered : []}
          aoi={aoi}
          reserves={reserves}
          selectedForestId={selectedForestId}
          onSelectForest={handleForestSelect}
          admin={null}
          grid={grid}
          risk={riskGeo}
          activity={activity}
          basemap={basemap}
          setBasemap={setBasemap}
          t={t}
          lang={lang}
          onPick={(picked: Hotspot) => {
            setPoint(picked);
            setFocusPoint({ lat: picked.lat, lon: picked.lon, seq: Date.now() });
          }}
          onCell={setRiskCell}
          draw={false}
          showGrid={gridOn}
          showDensity={density || adjusted}
          evidenceCells={evidenceCells}
          candidates={mode === 'evidence' ? candidates : null}
          focusGeometry={focusGeometry}
          focusPoint={focusPoint}
          showCoverage={coverageOn}
          onEvidencePick={(properties: any) => {
            const match = pilot?.samples.find((s) => s.sample_id === properties.sample_id);
            if (match) chooseSample(match);
          }}
        />
      </div>
      )}

      <header className="glass workspace-header">
        <a
          href="#"
          className="workspace-brand"
          onClick={(e) => {
            e.preventDefault();
            chooseMode('hotspots');
          }}
        >
          <span className="brand-mark">
            <Flame size={25} />
          </span>
          <span>
            <strong>
              {lang === 'mm' ? 'မြန်မာ့သစ်တောစောင့်ကြည့်ရေး' : <>Myanmar ForestWatch<span className="brand-dot">.</span></>}
            </strong>
            <small>{t('subtitle')}</small>
          </span>
        </a>
        <nav className="workspace-modes" aria-label={t('workspace')}>
          {(['hotspots', 'evidence', 'planning'] as Mode[]).map((item, i) => {
            const Icon = [Satellite, ScanLine, TrendingUp][i];
            return (
              <button key={item} className={mode === item ? 'active' : ''} onClick={() => chooseMode(item)} aria-pressed={mode === item}>
                <Icon size={16} />
                <span>{t(item)}</span>
              </button>
            );
          })}
        </nav>
        <div className="workspace-actions">
          <div className="workspace-language">
            <button className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')}>
              EN
            </button>
            <button className={lang === 'mm' ? 'active' : ''} onClick={() => setLang('mm')}>
              မြန်မာ
            </button>
          </div>
          <button
            className="round-button theme-button"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label={t(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button className="round-button" onClick={() => setMenu(!menu)} aria-label={t('workspace')} aria-expanded={menu}>
            <Menu size={20} />
          </button>
        </div>
      </header>

      {menu && (
        <div className="glass workspace-menu">
          <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />} {t(theme === 'dark' ? 'light' : 'dark')}
          </button>
          <button
            onClick={() => {
              setAnalysis('overview');
              setMenu(false);
            }}
          >
            <Info size={16} />
            {t('overview')}
          </button>
          <button
            onClick={() => {
              setAnalysis('quality');
              setMenu(false);
            }}
          >
            <TrendingUp size={16} />
            ML Models & Comparison (4 Models)
          </button>
          <button
            onClick={() => {
              setAnalysis('map');
              setMenu(false);
            }}
          >
            <Upload size={16} />
            {t('import')} / {t('draw')}
          </button>
          <button onClick={() => setSolid(!solid)}>
            <Layers size={16} />
            {t(solid ? 'glass' : 'solid')}
            {solid && <Check size={15} />}
          </button>
          <button onClick={exportHotspots}>
            <Download size={16} />
            {t('csv')}
          </button>
          <button onClick={exportPilot}>
            <FileJson size={16} />
            {t('exportPilot')}
          </button>
        </div>
      )}

      <div className="map-context">
        <span className="context-pill">
          <span className="status-dot" />
          {lang === 'mm' ? 'ကြိုးဝိုင်းသစ်တော ၁၀ ခု + ပဲခူးရိုးမ' : '10 Reserved Forests + Bago Yoma'}
        </span>
        <span className="context-range">{mode === 'planning' ? 'Next 12 Months' : '2012–2026'}</span>
      </div>

      <button className={`glass filter-trigger ${filters ? 'active' : ''}`} onClick={() => setFilters(!filters)} aria-expanded={filters}>
        <SlidersHorizontal size={16} />
        {t('filters')}
      </button>

      {filters && (
        <section className="glass filter-popover">
          <div className="drawer-heading">
            <h3>{t('filters')}</h3>
            <button className="round-button" onClick={() => setFilters(false)} aria-label={t('close')}>
              <X size={17} />
            </button>
          </div>
          <label>
            {t('sensor')}
            <select value={sensor} onChange={(e) => setSensor(e.target.value)} disabled={mode !== 'hotspots'}>
              <option value="both">MODIS + VIIRS</option>
              <option>MODIS</option>
              <option>VIIRS</option>
            </select>
          </label>
          <label className="check-label">
            <input type="checkbox" checked={quality} onChange={(e) => setQuality(e.target.checked)} />
            {t('qualityOnly')}
          </label>
          <label className="check-label">
            <input type="checkbox" checked={gridOn} onChange={(e) => setGridOn(e.target.checked)} />
            {t('grid')}
          </label>
          <label className="check-label">
            <input type="checkbox" checked={coverageOn} onChange={(e) => setCoverageOn(e.target.checked)} />
            {t('viirsCoverage')}
          </label>
          <label className="check-label">
            <input type="checkbox" checked={density} onChange={(e) => setDensity(e.target.checked)} disabled={mode !== 'hotspots'} />
            {t('density')}
          </label>
          <label className="check-label">
            <input type="checkbox" checked={adjusted} onChange={(e) => setAdjusted(e.target.checked)} disabled={mode !== 'hotspots'} />
            {t('adjustedLayer')}
          </label>
        </section>
      )}

      {!online && (
        <div className="workspace-notice" role="status">
          {t('offline')}
        </div>
      )}
      {error && (
        <div className="workspace-notice" role="alert">
          {t('error')}
          <button onClick={() => setRetry((value) => value + 1)}>{t('reset')}</button>
        </div>
      )}

      {/* EXPLORE MAP SECTION WITH SEARCH BAR DIRECTLY ABOVE "Explore satellite fire activity" */}
      {mode === 'hotspots' && !point && (
        <section className="glass map-summary">
          <div className="reserve-search-box">
            <div className="reserve-search-input-wrap">
              <Search size={14} />
              <input
                type="search"
                className="reserve-search-input"
                value={forestQuery}
                onChange={(e) => {
                  setForestQuery(e.target.value);
                  setForestSuggestionsOpen(true);
                  setActiveForestSuggestion(-1);
                }}
                onFocus={() => setForestSuggestionsOpen(true)}
                onBlur={() => {
                  setForestSuggestionsOpen(false);
                  setActiveForestSuggestion(-1);
                }}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing || !isSearchingForests) return;
                  if (e.key === 'Escape' && showForestSuggestions) {
                    e.preventDefault();
                    setForestSuggestionsOpen(false);
                    setActiveForestSuggestion(-1);
                  } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && filteredReserves.length) {
                    e.preventDefault();
                    setForestSuggestionsOpen(true);
                    const last = filteredReserves.length - 1;
                    setActiveForestSuggestion((index) => e.key === 'ArrowDown'
                      ? (index >= last ? 0 : index + 1)
                      : (index <= 0 ? last : index - 1));
                  } else if (e.key === 'Enter' && showForestSuggestions) {
                    const match = activeForestOption || (filteredReserves.length === 1 ? filteredReserves[0] : undefined);
                    if (match) {
                      e.preventDefault();
                      handleForestSelect(match.properties.forest_id);
                    }
                  }
                }}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={showForestSuggestions}
                aria-controls="forest-suggestions"
                aria-activedescendant={activeForestOption && `forest-suggestion-${activeForestOption.properties.forest_id}`}
                placeholder={
                  lang === 'mm'
                    ? 'ကြိုးဝိုင်းသစ်တော ၁၀ ခုနှင့် ပဲခူးရိုးမ ရှာဖွေရန်...'
                    : 'Search 10 Reserved Forests & Bago Yoma...'
                }
                aria-label={lang === 'mm' ? 'ကြိုးဝိုင်းသစ်တောများ ရှာရန်' : 'Search Reserved Forests'}
              />
              {showForestSuggestions && (
                <ul id="forest-suggestions" className="forest-suggestions" role="listbox" aria-label={lang === 'mm' ? 'ရှာဖွေမှုရလဒ်များ' : 'Forest search results'}>
                  {filteredReserves.length ? filteredReserves.map(({ properties }: any, index: number) => (
                    <li
                      id={`forest-suggestion-${properties.forest_id}`}
                      key={properties.forest_id}
                      role="option"
                      aria-selected={index === activeForestSuggestion}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleForestSelect(properties.forest_id)}
                    >
                      {getForestName(properties, lang)}
                      <small>{getRegionName(properties, lang)}</small>
                    </li>
                  )) : (
                    <li role="option" aria-disabled="true">
                      {lang === 'mm' ? 'ကိုက်ညီသော သစ်တော မတွေ့ပါ' : 'No matching forests'}
                    </li>
                  )}
                </ul>
              )}
            </div>
            <select
              id="reserve-search-results"
              className="reserve-select"
              value={forestDropdownValue}
              onChange={(e) => handleForestSelect(e.target.value)}
              aria-label={lang === 'mm' ? 'ကြိုးဝိုင်းသစ်တော ရွေးရန်' : 'Select Reserved Forest'}
            >
              {isSearchingForests && (
                <option value="" disabled>
                  {filteredReserves.length
                    ? (lang === 'mm' ? 'ရှာဖွေမှုရလဒ်မှ ရွေးပါ' : 'Select a search result')
                    : (lang === 'mm' ? 'ကိုက်ညီသော သစ်တော မတွေ့ပါ' : 'No matching forests')}
                </option>
              )}
              <option value="all">
                {lang === 'mm'
                  ? 'သစ်တောအားလုံး (ကြိုးဝိုင်းသစ်တော ၁၀ ခု + ပဲခူးရိုးမ)'
                  : 'All Study AOIs (10 Reserved Forests + Bago Yoma)'}
              </option>
              {filteredReserves.map((f: any) => (
                <option key={f.properties.forest_id} value={f.properties.forest_id}>
                  #{f.properties.rank} {getForestName(f.properties, lang)} ({getRegionName(f.properties, lang)})
                </option>
              ))}
            </select>
          </div>

          <span className="eyebrow">
            {selectedForestObj ? getRegionName(selectedForestObj.properties, lang) : t('subtitle')}
          </span>
          <h1>{t('mapIntro')}</h1>
          <p>
            {selectedForestObj
              ? `${getForestName(selectedForestObj.properties, lang)} · ${getForestTypeName(selectedForestObj.properties, lang)} (${fmt(selectedForestObj.properties.area_ha)} ${lang === 'mm' ? 'ဟက်တာ' : 'ha'})`
              : t('mapDescription')}
          </p>
          <div className="summary-count">
            <strong>{loading ? '—' : fmt(filtered.length)}</strong>
            <span>
              {t('monthlyCount')}
              <small>
                {monthText(Number(month))} {year} · UTC
              </small>
            </span>
          </div>
          <div className="summary-foot">
            <span>
              {selectedForestObj
                ? (lang === 'mm'
                    ? selectedForestObj.properties.selection_reference_mm || selectedForestObj.properties.selection_reference
                    : selectedForestObj.properties.selection_reference)
                : lang === 'mm'
                  ? 'ကြိုးဝိုင်းသစ်တော ၁၀ ခု + ပဲခူးရိုးမ AOI'
                  : '10 Reserved Forests + Bago Yoma AOI'}
            </span>
            <button onClick={() => chooseMode('evidence')}>
              3D Burn Evidence
              <ArrowUpRight size={16} />
            </button>
          </div>
        </section>
      )}

      {/* FUTURE RISK SECTION: NEXT 12 MONTHS ONLY WITH MODEL SELECTOR */}
      {mode === 'planning' && (
        <section className="glass planning-card">
          <span className="eyebrow">NEXT 12 MONTHS FORECAST · {selectedModel.toUpperCase()}</span>
          <h2>12-Month Wildfire Risk Outlook</h2>
          <p>Compare 4 trained models across the 10 Myanmar Reserved Forests. XGBoost is recommended as best fit.</p>
          <label>
            Prediction Model
            <select
              value={selectedModel}
              onChange={(e) => {
                setSelectedModel(e.target.value);
                setRiskCell(null);
              }}
              aria-label="Choose Machine Learning Model"
            >
              {(report?.available_models || ['XGBoost', 'Random forest', 'Logistic regression', 'Seasonal baseline']).map((m: string) => (
                <option key={m} value={m}>
                  {m === 'XGBoost' ? 'XGBoost (Best Fit · Recommended)' : m}
                </option>
              ))}
            </select>
          </label>
          {report?.results?.[selectedModel]?.test && (
            <div className="evidence-stat" style={{ margin: '4px 0 8px' }}>
              <span>Test Brier / PR-AUC / F1</span>
              <strong>
                {report.results[selectedModel].test.brier.toFixed(4)} ·{' '}
                {report.results[selectedModel].test.pr_auc.toFixed(3)} ·{' '}
                {report.results[selectedModel].test.f1.toFixed(3)}
              </strong>
            </div>
          )}
          <label>
            {lang === 'mm' ? 'ကြိုးဝိုင်းသစ်တော / ဒေသ' : 'Reserved Forest / AOI'}
            <select value={selectedForestId} onChange={(e) => handleForestSelect(e.target.value)}>
              <option value="all">{lang === 'mm' ? 'သစ်တောအားလုံး (၁၀ ခု + ပဲခူးရိုးမ)' : 'All 10 Reserved Forests + Bago Yoma'}</option>
              {(reserves?.features || []).map((f: any) => (
                <option key={f.properties.forest_id} value={f.properties.forest_id}>
                  {getForestName(f.properties, lang)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('scenario')}
            <select value={scenario} onChange={(e) => setScenario(e.target.value)}>
              {['baseline', 'dry', 'wet'].map((s) => (
                <option key={s} value={s}>
                  {t(s)}
                </option>
              ))}
            </select>
          </label>
          <p className="quiet-note">Forecast Horizon: Next 12 Months (Month +{lead} of 12)</p>
          <button className="outline-button" onClick={() => setAnalysis('future')}>
            Compare All 4 Models & Details
            <ArrowUpRight size={16} />
          </button>
        </section>
      )}

      {mode === 'evidence' &&
        pilot &&
        (showEvidence ? (
          <EvidencePanel
            pilot={pilot}
            sample={sample}
            forestSamples={forestSamples}
            periodSamples={periodSamples}
            periodLabel={`${monthText(Number(month))} ${year}`}
            selectedForestId={selectedForestId}
            lang={lang}
            t={t}
            onSelect={chooseSample}
            onReview={recordReview}
            onClose={() => setShowEvidence(false)}
          />
        ) : (
          <button className="glass reopen-evidence" onClick={() => setShowEvidence(true)}>
            <ScanLine size={18} />
            {t('evidence')}
          </button>
        ))}

      {point && (
        <aside className="glass observation-card">
          <div className="drawer-heading">
            <div>
              <span className="eyebrow">{getForestName(point, lang) || t('observed')}</span>
              <h2>{point.sensor}</h2>
            </div>
            <button
              className="round-button"
              onClick={() => {
                setPoint(null);
                setFocusPoint(null);
              }}
              aria-label={t('close')}
            >
              <X size={18} />
            </button>
          </div>
          <dl>
            {[
              [lang === 'mm' ? 'ကြိုးဝိုင်းသစ်တော / ဒေသ' : 'Reserved Forest / AOI', getForestName(point, lang) || '—'],
              [lang === 'mm' ? 'တိုင်းဒေသကြီး / ပြည်နယ်' : 'Region', getRegionName(point, lang) || '—'],
              [t('date'), point.date + ' ' + point.time],
              [t('location'), point.lat + ', ' + point.lon],
              [t('confidence'), point.confidence],
              [t('frp'), (point.frp ?? '—') + ' MW'],
              [t('source'), point.source],
            ].map(([key, value]) => (
              <React.Fragment key={key}>
                <dt>{key}</dt>
                <dd>{value}</dd>
              </React.Fragment>
            ))}
          </dl>
        </aside>
      )}

      {riskCell && (
        <aside className="glass observation-card">
          <div className="drawer-heading">
            <div>
              <span className="eyebrow">{getForestName(riskCell, lang) || (lang === 'mm' ? 'ကြိုးဝိုင်းသစ်တော' : 'Reserved Forest')}</span>
              <h2>12-Month Risk Index</h2>
            </div>
            <button className="round-button" onClick={() => setRiskCell(null)} aria-label={t('close')}>
              <X size={18} />
            </button>
          </div>
          <strong className="risk-number">
            {Number(riskCell.index).toFixed(1)}
            <small>/100</small>
          </strong>
          <p>
            Spread: {riskCell.spread_low}–{riskCell.spread_high} ({riskCell.active_model || selectedModel} · 12m)
          </p>
        </aside>
      )}

      <section className="glass timeline">
        <div className="timeline-heading">
          <button className="timeline-date" onClick={() => setCalendar(!calendar)}>
            <CalendarDays size={18} />
            <span>
              {mode === 'planning' ? monthText(targetDate.getUTCMonth() + 1) : monthText(Number(month))}{' '}
              <strong>{mode === 'planning' ? targetDate.getUTCFullYear() : year}</strong>
            </span>
          </button>
          <span className="timeline-mode">
            {mode === 'planning' ? `NEXT 12 MONTHS (+${lead}M)` : mode === 'evidence' ? '3D BURN EVIDENCE' : '2012–2026 OBSERVED'} · UTC
          </span>
          <button className="round-button" aria-label={t('calendar')} onClick={() => setCalendar(!calendar)}>
            <Maximize2 size={15} />
          </button>
        </div>

        {mode === 'planning' ? (
          <input
            className="planning-range"
            type="range"
            min={1}
            max={horizon}
            value={lead}
            onChange={(e) => setLead(Number(e.target.value))}
            aria-label="Next 12 Months Slider"
          />
        ) : (
          <div className="month-track">
            {timelineCounts.map((count, index) => (
              <button
                key={index}
                className={Number(month) === index + 1 ? 'active' : ''}
                onClick={() => {
                  setMonth(String(index + 1).padStart(2, '0'));
                  if (mode === 'evidence') setShowEvidence(true);
                }}
                aria-label={`${monthText(index + 1)} ${year}${mode === 'evidence' ? ', ' + evidenceCountLabel(count) : ''}`}
                aria-pressed={Number(month) === index + 1}
              >
                <span
                  className="month-bar"
                  style={{ height: Math.max(3, Math.sqrt(count / maximum) * 23) + 'px' }}
                />
                <small>{monthText(index + 1, true)}</small>
              </button>
            ))}
          </div>
        )}
      </section>

      {calendar && (
        <div className="glass calendar-popover">
          <div className="drawer-heading">
            <h3>{mode === 'planning' ? 'Next 12 Months' : 'Select Year (2012–2026)'}</h3>
            <button className="round-button" onClick={() => setCalendar(false)} aria-label={t('close')}>
              <X size={17} />
            </button>
          </div>
          {mode === 'planning' ? (
            <label>
              Forecast Month (1–12)
              <select
                value={lead}
                onChange={(e) => {
                  setLead(Number(e.target.value));
                  setCalendar(false);
                }}
              >
                {Array.from({ length: 12 }, (_, i) => {
                  const date = new Date(
                    Date.UTC(
                      Number(report?.forecast_origin?.slice(0, 4) || 2026),
                      Number(report?.forecast_origin?.slice(5, 7) || 12) - 1 + i,
                      1
                    )
                  );
                  return (
                    <option key={i} value={i + 1}>
                      Month +{i + 1}: {monthText(date.getUTCMonth() + 1)} {date.getUTCFullYear()}
                    </option>
                  );
                })}
              </select>
            </label>
          ) : (
            <>
              <select value={year} onChange={(e) => setYear(e.target.value)} aria-label={t('year')}>
                {(summary?.years || [2024, 2025, 2026]).map((y: number) => (
                  <option key={y}>{y}</option>
                ))}
              </select>
              <div className="calendar-months">
                {timelineCounts.map((count, index) => (
                  <button
                    className={Number(month) === index + 1 ? 'active' : ''}
                    key={index}
                    onClick={() => {
                      setMonth(String(index + 1).padStart(2, '0'));
                      if (mode === 'evidence') setShowEvidence(true);
                      setCalendar(false);
                    }}
                  >
                    <span>{monthText(index + 1, true)}</span>
                    <small>{mode === 'evidence' ? evidenceCountLabel(count) : fmt(count)}</small>
                  </button>
                ))}
              </div>
              <button
                className="outline-button"
                onClick={() => {
                  setCalendar(false);
                  setAnalysis('calendar');
                }}
              >
                {t('analysis')}
                <ArrowUpRight size={15} />
              </button>
            </>
          )}
        </div>
      )}

      {analysis && (
        <div ref={dialog} className="analysis-overlay" role="dialog" aria-modal="true" aria-label={t('analysis')}>
          <button className="glass analysis-close" onClick={() => setAnalysis(null)}>
            <ChevronLeft size={18} />
            {t('map')}
          </button>
          <AnalysisErrorBoundary onClose={() => setAnalysis(null)}>
            <LegacyAnalysis
              evidenceStatus="Curated 20 Burn Scars (2 per Reserved Forest · 3D Drone Orbit)"
              initialView={analysis}
              initialLanguage={lang}
              initialTheme={theme}
              onReturnToMap={() => setAnalysis(null)}
            />
          </AnalysisErrorBoundary>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
