import { useEffect, useRef, useState } from 'react';
import maplibregl, { type ExpressionSpecification } from 'maplibre-gl';
import L from 'leaflet';
import 'maplibre-gl/dist/maplibre-gl.css';
import 'leaflet/dist/leaflet.css';
import { Layers, LocateFixed, Plus, Minus, Maximize2 } from 'lucide-react';
import { getForestName, getRegionName } from './reserves-i18n';

const empty: any = { type: 'FeatureCollection', features: [] };
const palette = ['#f3e6b3', '#e6c579', '#d99b58', '#bd6a45', '#8f3d36'];

const BASEMAP_TILES: Record<string, string[]> = {
  satellite: [
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  ],
  satelliteFallback: [
    'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
    'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  ],
  terrain: [
    'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
    'https://b.tile.opentopomap.org/{z}/{x}/{y}.png',
  ],
  simple: [
    'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  ],
};

export function MapView(props: any) {
  const {
    rows,
    aoi,
    reserves,
    selectedForestId,
    onSelectForest,
    admin,
    grid,
    risk,
    basemap,
    setBasemap,
    t,
    lang = 'en',
    onPick,
    onCell,
    draw,
    onDraw,
    drawCorners,
    drawPreview,
    showGrid,
    showDensity,
    activity,
    evidenceCells,
    candidates,
    focusGeometry,
    focusPoint,
    showCoverage = false,
    cuts = [20, 40, 60, 80],
  } = props;

  const el = useRef<HTMLDivElement>(null);
  const gl = useRef<maplibregl.Map | null>(null);
  const leaf = useRef<L.Map | null>(null);
  const group = useRef<L.LayerGroup | null>(null);
  const base = useRef<L.TileLayer | null>(null);
  const pulseRaf = useRef<number | null>(null);

  const [ready, setReady] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [error, setError] = useState(false);
  const [menu, setMenu] = useState(false);
  const [labelsOn, setLabelsOn] = useState(true);
  const [zoom, setZoom] = useState(6);
  const [localPulse, setLocalPulse] = useState<{ lat: number; lon: number; seq: number } | null>(null);

  const latest = useRef(props);
  latest.current = props;

  const activePulse = focusPoint || localPulse;

  useEffect(() => {
    if (!el.current) return;
    let resize: ResizeObserver | undefined;
    try {
      const m = new maplibregl.Map({
        container: el.current,
        center: [96.05, 20.45],
        zoom: 6.1,
        maxZoom: 16,
        minZoom: 4.5,
        style: {
          version: 8,
          sources: {},
          layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#132820' } }],
        },
      });
      gl.current = m;
      m.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

      m.on('load', () => {
        m.addSource('base', {
          type: 'raster',
          tiles: BASEMAP_TILES.satellite,
          tileSize: 256,
          attribution: '© Esri / Maxar · OpenStreetMap · Myanmar Biodiversity Protected Areas',
        });
        m.addLayer({
          id: 'base',
          type: 'raster',
          source: 'base',
          paint: { 'raster-saturation': -0.22, 'raster-brightness-max': 0.84 },
        });

        for (const id of ['aoi', 'reserves', 'admin', 'grid', 'risk', 'evidence', 'candidates', 'focus', 'coverage', 'click-pulse']) {
          m.addSource(id, { type: 'geojson', data: empty });
        }

        m.addLayer({
          id: 'admin',
          type: 'line',
          source: 'admin',
          paint: { 'line-color': '#d1dbc8', 'line-width': 1, 'line-dasharray': [3, 3] },
        });

        m.addLayer({
          id: 'reserves-fill',
          type: 'fill',
          source: 'reserves',
          paint: {
            'fill-color': ['case', ['==', ['get', 'forest_id'], 'bago_yoma'], '#f59e0b', '#6ee7b7'],
            'fill-opacity': ['case', ['==', ['get', 'forest_id'], 'bago_yoma'], 0.06, 0.16],
          },
        });
        m.addLayer({
          id: 'reserves-line',
          type: 'line',
          source: 'reserves',
          paint: {
            'line-color': ['case', ['==', ['get', 'forest_id'], 'bago_yoma'], '#fbbf24', '#d7e7a0'],
            'line-width': ['case', ['==', ['get', 'forest_id'], 'bago_yoma'], 2.0, 2.2],
          },
        });
        m.addLayer({
          id: 'aoi-line',
          type: 'line',
          source: 'aoi',
          paint: { 'line-color': '#9daa65', 'line-width': 1.8, 'line-dasharray': [4, 2] },
        });

        m.addLayer({
          id: 'grid-fill',
          type: 'fill',
          source: 'grid',
          paint: {
            'fill-color': '#dc9c53',
            'fill-opacity': ['interpolate', ['linear'], ['get', 'count'], 0, 0, 1, 0.14, 25, 0.62],
          },
        });
        m.addLayer({
          id: 'grid',
          type: 'line',
          source: 'grid',
          paint: { 'line-color': '#d9dfc3', 'line-width': 0.5, 'line-opacity': 0.32 },
        });
        m.addLayer({
          id: 'risk',
          type: 'fill',
          source: 'risk',
          paint: {
            'fill-color': ['step', ['get', 'index'], palette[0], 20, palette[1], 40, palette[2], 60, palette[3], 80, palette[4]],
            'fill-opacity': 0.72,
          },
        });

        m.addSource('draw-preview', { type: 'geojson', data: empty });
        const hatch = new Uint8Array(8 * 8 * 4);
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            const i = (y * 8 + x) * 4;
            hatch[i] = 168;
            hatch[i + 1] = 179;
            hatch[i + 2] = 175;
            hatch[i + 3] = (x + y) % 8 < 2 ? 120 : 12;
          }
        }
        m.addImage('unknown-hatch', { width: 8, height: 8, data: hatch });
        m.addLayer({ id: 'coverage', type: 'fill', source: 'coverage', paint: { 'fill-pattern': 'unknown-hatch' } });

        m.addLayer({
          id: 'evidence-fill',
          type: 'fill',
          source: 'evidence',
          paint: { 'fill-color': '#fb7185', 'fill-opacity': 0.34 },
        });
        m.addLayer({
          id: 'evidence-line',
          type: 'line',
          source: 'evidence',
          paint: { 'line-color': '#fde047', 'line-width': 2.2 },
        });
        m.addLayer({
          id: 'candidate-line',
          type: 'line',
          source: 'candidates',
          paint: { 'line-color': '#fde047', 'line-width': 2.5 },
        });
        m.addLayer({
          id: 'focus',
          type: 'line',
          source: 'focus',
          paint: { 'line-color': '#6ee7b7', 'line-width': 3 },
        });

        m.addSource('points', { type: 'geojson', data: empty, cluster: true, clusterMaxZoom: 8, clusterRadius: 28 });
        m.addLayer({
          id: 'clusters',
          type: 'circle',
          source: 'points',
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': '#e5a755',
            'circle-opacity': 0.85,
            'circle-radius': ['step', ['get', 'point_count'], 8, 20, 12, 100, 17],
            'circle-stroke-width': 1,
            'circle-stroke-color': '#f4ca89',
          },
        });

        const b = new Uint8Array(22 * 22 * 4);
        for (let y = 0; y < 22; y++) {
          for (let x = 0; x < 22; x++) {
            if (Math.abs(x - 10.5) + Math.abs(y - 10.5) < 9) {
              const i = (y * 22 + x) * 4;
              b[i] = 226;
              b[i + 1] = 124;
              b[i + 2] = 171;
              b[i + 3] = 235;
            }
          }
        }
        m.addImage('diamond', { width: 22, height: 22, data: b });
        m.addLayer({
          id: 'modis',
          type: 'circle',
          source: 'points',
          filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'sensor'], 'MODIS']],
          paint: { 'circle-color': '#ffa956', 'circle-radius': 3.5, 'circle-stroke-color': '#ffd9a4', 'circle-stroke-width': 0.6 },
        });
        m.addLayer({
          id: 'viirs',
          type: 'symbol',
          source: 'points',
          filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'sensor'], 'VIIRS']],
          layout: { 'icon-image': 'diamond', 'icon-size': 0.55, 'icon-allow-overlap': true },
        });

        m.addLayer({
          id: 'click-pulse-outer',
          type: 'circle',
          source: 'click-pulse',
          paint: {
            'circle-radius': 24,
            'circle-color': '#6ee7b7',
            'circle-opacity': 0.16,
            'circle-stroke-width': 2.2,
            'circle-stroke-color': '#6ee7b7',
            'circle-stroke-opacity': 0.78,
          },
        });
        m.addLayer({
          id: 'click-pulse-core',
          type: 'circle',
          source: 'click-pulse',
          paint: {
            'circle-radius': 6.5,
            'circle-color': '#fde047',
            'circle-stroke-width': 2,
            'circle-stroke-color': '#0b1e17',
          },
        });

        const initLang = latest.current.lang || 'en';
        const nameExpr: ExpressionSpecification = initLang === 'mm' ? ['coalesce', ['get', 'name_mm'], ['get', 'name_en']] : ['get', 'name_en'];
        const regionExpr: ExpressionSpecification = initLang === 'mm' ? ['coalesce', ['get', 'region_mm'], ['get', 'region_en']] : ['get', 'region_en'];

        m.addLayer({
          id: 'reserves-labels',
          type: 'symbol',
          source: 'reserves',
          layout: {
            'text-field': [
              'format',
              nameExpr,
              { 'font-scale': 1.0 },
              '\n',
              {},
              regionExpr,
              { 'font-scale': 0.78 },
            ],
            'text-size': ['interpolate', ['linear'], ['zoom'], 5, 10, 8, 12.5, 12, 14.5],
            'text-anchor': 'center',
            'text-allow-overlap': false,
            'text-padding': 6,
          },
          paint: {
            'text-color': '#f3fbf7',
            'text-halo-color': '#081410',
            'text-halo-width': 1.8,
          },
        });

        m.addLayer({
          id: 'draw-preview-fill',
          type: 'fill',
          source: 'draw-preview',
          paint: { 'fill-color': '#6ee7b7', 'fill-opacity': 0.15 },
        });
        m.addLayer({
          id: 'draw-preview-line',
          type: 'line',
          source: 'draw-preview',
          paint: { 'line-color': '#6ee7b7', 'line-width': 3 },
        });

        setReady(true);
      });

      m.on('click', (e) => {
        const p = latest.current;
        if (p.draw) {
          p.onDraw([e.lngLat.lng, e.lngLat.lat]);
          return;
        }
        const f = m.queryRenderedFeatures(e.point, {
          layers: ['modis', 'viirs', 'clusters', 'evidence-fill', 'risk', 'reserves-fill'],
        })[0];
        if (!f) return;
        if (f.layer.id === 'clusters') {
          setLocalPulse({ lat: e.lngLat.lat, lon: e.lngLat.lng, seq: Date.now() });
          m.easeTo({ center: e.lngLat, zoom: m.getZoom() + 2, duration: 650 });
        } else if (f.layer.id === 'evidence-fill') {
          p.onEvidencePick?.(f.properties);
        } else if (f.layer.id === 'risk') {
          p.onCell(f.properties);
        } else if (f.layer.id === 'reserves-fill') {
          const allHits = m.queryRenderedFeatures(e.point, { layers: ['reserves-fill'] });
          const specific = allHits.find((hit) => hit.properties?.forest_id && hit.properties.forest_id !== 'bago_yoma');
          const chosen = specific || f;
          p.onSelectForest?.(chosen.properties?.forest_id);
        } else {
          const coords = (f.geometry as any)?.coordinates;
          const lon = coords ? coords[0] : e.lngLat.lng;
          const lat = coords ? coords[1] : e.lngLat.lat;
          setLocalPulse({ lat, lon, seq: Date.now() });
          m.easeTo({ center: [lon, lat], zoom: Math.max(m.getZoom(), 9.5), duration: 650 });
          p.onPick(f.properties);
        }
      });

      let tileFailCount = 0;
      m.on('sourcedata', (e: any) => {
        if (e.sourceId === 'base' && e.isSourceLoaded) {
          tileFailCount = 0;
          setError(false);
        }
      });

      m.on('error', (e: any) => {
        const msg = String(e?.error?.message || '');
        if (msg.includes('AbortError') || msg.includes('aborted')) return;

        if (e?.sourceId === 'base') {
          tileFailCount += 1;
          const baseSrc = m.getSource('base') as maplibregl.RasterTileSource | undefined;
          if (tileFailCount >= 3 && latest.current.basemap === 'satellite' && baseSrc) {
            baseSrc.setTiles(BASEMAP_TILES.satelliteFallback);
            setError(false);
            return;
          }
          if (tileFailCount >= 4) {
            setError(true);
          }
        }
      });

      m.on('webglcontextlost', () => setFallback(true));
    } catch {
      el.current.innerHTML = '';
      const m = L.map(el.current, { zoomControl: false, preferCanvas: false, minZoom: 4, maxZoom: 16 }).setView([20.45, 96.05], 6);
      leaf.current = m;
      group.current = L.layerGroup().addTo(m);
      L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(m);
      m.on('click', (e) => {
        if (latest.current.draw) latest.current.onDraw([e.latlng.lng, e.latlng.lat]);
      });
      m.on('zoomend', () => setZoom(m.getZoom()));
      resize = new ResizeObserver(() => m.invalidateSize());
      resize.observe(el.current);
      setFallback(true);
      setReady(true);
    }
    return () => {
      if (pulseRaf.current) cancelAnimationFrame(pulseRaf.current);
      resize?.disconnect();
      gl.current?.remove();
      leaf.current?.remove();
    };
  }, []);

  useEffect(() => {
    if (!ready || fallback || !gl.current) return;
    const m = gl.current;
    if (!m.getLayer('reserves-labels')) return;
    const nameExpr: ExpressionSpecification = lang === 'mm' ? ['coalesce', ['get', 'name_mm'], ['get', 'name_en']] : ['get', 'name_en'];
    const regionExpr: ExpressionSpecification = lang === 'mm' ? ['coalesce', ['get', 'region_mm'], ['get', 'region_en']] : ['get', 'region_en'];
    m.setLayoutProperty('reserves-labels', 'text-field', [
      'format',
      nameExpr,
      { 'font-scale': 1.0 },
      '\n',
      {},
      regionExpr,
      { 'font-scale': 0.78 },
    ]);
  }, [ready, fallback, lang]);

  useEffect(() => {
    if (!ready) return;
    if (pulseRaf.current) {
      cancelAnimationFrame(pulseRaf.current);
      pulseRaf.current = null;
    }
    if (!activePulse) {
      if (!fallback && gl.current) {
        (gl.current.getSource('click-pulse') as maplibregl.GeoJSONSource | undefined)?.setData(empty);
      }
      return;
    }

    const { lat, lon } = activePulse;
    if (fallback && leaf.current) {
      leaf.current.flyTo([lat, lon], Math.max(leaf.current.getZoom(), 10), { duration: 0.7 });
      return;
    }

    if (gl.current) {
      const m = gl.current;
      const src = m.getSource('click-pulse') as maplibregl.GeoJSONSource | undefined;
      src?.setData({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: {} }],
      });
      if (focusPoint) {
        m.flyTo({ center: [lon, lat], zoom: Math.max(m.getZoom(), 10.5), duration: 750 });
      }
      const start = performance.now();
      const animate = (now: number) => {
        if (!gl.current || !gl.current.getLayer('click-pulse-outer')) return;
        const elapsed = (now - start) % 1400;
        const phase = elapsed / 1400;
        const radius = 8 + phase * 26;
        const opacity = Math.max(0.05, 0.85 * (1 - phase));
        gl.current.setPaintProperty('click-pulse-outer', 'circle-radius', radius);
        gl.current.setPaintProperty('click-pulse-outer', 'circle-stroke-opacity', opacity);
        gl.current.setPaintProperty('click-pulse-outer', 'circle-opacity', opacity * 0.25);
        pulseRaf.current = requestAnimationFrame(animate);
      };
      pulseRaf.current = requestAnimationFrame(animate);
    }

    return () => {
      if (pulseRaf.current) {
        cancelAnimationFrame(pulseRaf.current);
        pulseRaf.current = null;
      }
    };
  }, [ready, fallback, activePulse?.lat, activePulse?.lon, activePulse?.seq]);

  useEffect(() => {
    if (!ready) return;
    setError(false);
    const tiles = BASEMAP_TILES[basemap] || BASEMAP_TILES.simple;
    if (fallback && leaf.current) {
      if (base.current) leaf.current.removeLayer(base.current);
      let leafErrors = 0;
      const layer = L.tileLayer(tiles[0], { maxZoom: 16 }).addTo(leaf.current);
      layer.on('load', () => {
        leafErrors = 0;
        setError(false);
      });
      layer.on('tileerror', () => {
        leafErrors += 1;
        if (leafErrors >= 3 && basemap === 'satellite' && leaf.current) {
          leaf.current.removeLayer(layer);
          base.current = L.tileLayer(BASEMAP_TILES.satelliteFallback[0], { maxZoom: 16 }).addTo(leaf.current);
          setError(false);
        } else if (leafErrors >= 4) {
          setError(true);
        }
      });
      base.current = layer;
    } else if (gl.current) {
      (gl.current.getSource('base') as maplibregl.RasterTileSource | undefined)?.setTiles(tiles);
    }
  }, [ready, fallback, basemap]);

  useEffect(() => {
    if (!ready) return;
    const counts = new Map<string, number>();
    rows.forEach((r: any) => counts.set(r.cell_id, (counts.get(r.cell_id) || 0) + 1));
    if (activity) {
      counts.clear();
      activity.features.forEach((f: any) => counts.set(f.properties.cell_id, f.properties.count));
    }

    if (fallback && leaf.current && group.current) {
      const g = group.current;
      g.clearLayers();
      if (aoi && !reserves) {
        L.geoJSON(aoi, {
          style: { color: '#9daa65', weight: 1.8, dashArray: '4 3', fillOpacity: 0.04 },
          interactive: false,
        }).addTo(g);
      }
      if (reserves) {
        L.geoJSON(reserves, {
          style: (f: any) => {
            const isBago = f?.properties?.forest_id === 'bago_yoma';
            const isSel = f?.properties?.forest_id === selectedForestId;
            return {
              color: isSel ? '#6ee7b7' : isBago ? '#fbbf24' : '#d7e7a0',
              weight: isSel ? 3 : 2,
              dashArray: isBago && !isSel ? '5 4' : undefined,
              fillColor: isBago ? '#f59e0b' : '#6ee7b7',
              fillOpacity: isBago ? 0.06 : 0.14,
            };
          },
          onEachFeature: (f, l) => {
            if (labelsOn) {
              l.bindTooltip(`${getForestName(f.properties, lang)} (${getRegionName(f.properties, lang)})`, {
                permanent: false,
                direction: 'center',
              });
            }
            l.on('click', () => latest.current.onSelectForest?.(f.properties.forest_id));
          },
        }).addTo(g);
      }
      if (grid && (showGrid || showDensity)) {
        L.geoJSON(grid, {
          style: (f: any) => ({
            color: '#c9dbbc',
            weight: 0.5,
            opacity: showGrid ? 0.5 : 0,
            fill: showDensity,
            fillColor: '#df9a4a',
            fillOpacity: showDensity ? Math.min(0.65, (counts.get(f.properties.cell_id) || 0) / 30) : 0,
          }),
          interactive: false,
        }).addTo(g);
      }
      if (risk) {
        L.geoJSON(risk, {
          style: (f: any) => ({
            color: '#f5ecd9',
            weight: 0.4,
            fillColor: palette[cuts.filter((c: number) => f.properties.index >= c).length],
            fillOpacity: 0.72,
          }),
          onEachFeature: (f, l) => l.on('click', () => !latest.current.draw && latest.current.onCell(f.properties)),
        }).addTo(g);
      }
      if (evidenceCells) {
        L.geoJSON(evidenceCells, {
          style: { color: '#fde047', weight: 2, fillColor: '#fb7185', fillOpacity: 0.35 },
          onEachFeature: (f, l) => l.on('click', () => latest.current.onEvidencePick?.(f.properties)),
        }).addTo(g);
      }
      if (candidates) {
        L.geoJSON(candidates, { style: { color: '#fde047', weight: 2.5, fillOpacity: 0.3 }, interactive: false }).addTo(g);
      }
      if (focusGeometry) {
        L.geoJSON(focusGeometry, { style: { color: '#6ee7b7', weight: 3, fillOpacity: 0 }, interactive: false }).addTo(g);
      }
      for (const r of rows) {
        const marker = L.circleMarker([r.lat, r.lon], {
          radius: r.sensor === 'VIIRS' ? 4 : 3.2,
          color: r.sensor === 'VIIRS' ? '#ffd2e5' : '#ffd9a4',
          weight: 0.7,
          fillColor: r.sensor === 'VIIRS' ? '#df81ae' : '#ffa956',
          fillOpacity: 0.88,
        });
        marker
          .on('click', () => {
            if (!latest.current.draw) {
              setLocalPulse({ lat: r.lat, lon: r.lon, seq: Date.now() });
              latest.current.onPick(r);
            }
          })
          .addTo(g);
      }
      if (activePulse) {
        const pulseIcon = L.divIcon({
          className: 'leaflet-pulse-beacon',
          html: '<span class="pulse-ring"></span><span class="pulse-dot"></span>',
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        });
        L.marker([activePulse.lat, activePulse.lon], { icon: pulseIcon, interactive: false }).addTo(g);
      }
    } else if (gl.current) {
      const m = gl.current;
      m.setPaintProperty('risk', 'fill-color', ['step', ['get', 'index'], palette[0], cuts[0], palette[1], cuts[1], palette[2], cuts[2], palette[3], cuts[3], palette[4]]);
      for (const [id, data] of Object.entries({
        evidence: evidenceCells || empty,
        candidates: candidates || empty,
        focus: focusGeometry || empty,
        coverage: showCoverage ? grid || empty : empty,
        aoi: aoi || empty,
        reserves: reserves || empty,
        admin: admin || empty,
        risk: risk || empty,
        grid: grid
          ? {
              ...grid,
              features: grid.features.map((f: any) => ({
                ...f,
                properties: { ...f.properties, count: counts.get(f.properties.cell_id) || 0 },
              })),
            }
          : empty,
      })) {
        (m.getSource(id) as maplibregl.GeoJSONSource)?.setData(data);
      }
      (m.getSource('points') as maplibregl.GeoJSONSource)?.setData({
        type: 'FeatureCollection',
        features: rows.map((r: any) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
          properties: r,
        })),
      });
      m.setLayoutProperty('grid', 'visibility', showGrid ? 'visible' : 'none');
      m.setLayoutProperty('grid-fill', 'visibility', showDensity ? 'visible' : 'none');
      m.setLayoutProperty('reserves-labels', 'visibility', labelsOn ? 'visible' : 'none');
      if (selectedForestId && selectedForestId !== 'all') {
        m.setPaintProperty('reserves-line', 'line-color', [
          'case',
          ['==', ['get', 'forest_id'], selectedForestId],
          '#6ee7b7',
          ['==', ['get', 'forest_id'], 'bago_yoma'],
          '#fbbf24',
          '#d7e7a0',
        ]);
        m.setPaintProperty('reserves-line', 'line-width', [
          'case',
          ['==', ['get', 'forest_id'], selectedForestId],
          3.4,
          1.8,
        ]);
      } else {
        m.setPaintProperty('reserves-line', 'line-color', [
          'case',
          ['==', ['get', 'forest_id'], 'bago_yoma'],
          '#fbbf24',
          '#d7e7a0',
        ]);
        m.setPaintProperty('reserves-line', 'line-width', 2.1);
      }
    }
  }, [ready, fallback, rows, aoi, reserves, selectedForestId, admin, grid, risk, showGrid, showDensity, zoom, labelsOn, draw, activity, cuts, evidenceCells, candidates, focusGeometry, showCoverage, lang, activePulse?.seq]);

  useEffect(() => {
    if (!ready || !reserves) return;
    if (!selectedForestId || selectedForestId === 'all') {
      const b = L.geoJSON(reserves).getBounds();
      if (!b.isValid()) return;
      if (leaf.current) leaf.current.fitBounds(b, { padding: [50, 50], maxZoom: 6.5 });
      else gl.current?.fitBounds([[b.getWest(), b.getSouth()], [b.getEast(), b.getNorth()]], { padding: 70, maxZoom: 6.5, duration: 900 });
      return;
    }
    const target = reserves.features?.find((f: any) => f.properties?.forest_id === selectedForestId);
    if (!target) return;
    const b = L.geoJSON(target).getBounds();
    if (!b.isValid()) return;
    const maxZ = selectedForestId === 'bago_yoma' ? 8.6 : 11.5;
    if (leaf.current) leaf.current.fitBounds(b, { padding: [80, 80], maxZoom: maxZ });
    else gl.current?.fitBounds([[b.getWest(), b.getSouth()], [b.getEast(), b.getNorth()]], { padding: { top: 120, bottom: 160, left: 380, right: 120 }, maxZoom: maxZ, duration: 1000 });
  }, [ready, selectedForestId, reserves]);

  useEffect(() => {
    if (!ready || !focusGeometry) return;
    const bounds = L.geoJSON(focusGeometry).getBounds();
    if (!bounds.isValid()) return;
    const mobile = window.innerWidth <= 760;
    const padding = {
      top: mobile ? 245 : 130,
      bottom: mobile ? Math.min(window.innerHeight * 0.55, 480) : 185,
      left: mobile ? 20 : 440,
      right: mobile ? 65 : 110,
    };
    if (leaf.current) leaf.current.fitBounds(bounds, { paddingTopLeft: [padding.left, padding.top], paddingBottomRight: [padding.right, padding.bottom], maxZoom: 12 });
    else gl.current?.fitBounds([[bounds.getWest(), bounds.getSouth()], [bounds.getEast(), bounds.getNorth()]], { padding, maxZoom: 12 });
  }, [ready, focusGeometry]);

  const initiallyFitted = useRef(false);
  useEffect(() => {
    if (!ready || !(reserves || aoi) || initiallyFitted.current) return;
    initiallyFitted.current = true;
    const bounds = L.geoJSON(reserves || aoi).getBounds();
    if (!bounds.isValid()) return;
    if (leaf.current) leaf.current.fitBounds(bounds, { padding: [50, 50], maxZoom: 6.5 });
    else gl.current?.fitBounds([[bounds.getWest(), bounds.getSouth()], [bounds.getEast(), bounds.getNorth()]], { padding: 70, maxZoom: 6.5 });
  }, [ready, reserves, aoi]);

  const fit = () => {
    const target = reserves || aoi;
    if (!target) return;
    const b = L.geoJSON(target).getBounds();
    if (leaf.current) leaf.current.fitBounds(b, { padding: [40, 40] });
    else gl.current?.fitBounds([[b.getWest(), b.getSouth()], [b.getEast(), b.getNorth()]], { padding: 60, maxZoom: 6.5 });
  };

  return (
    <div className={`map-wrap ${draw ? 'is-drawing' : ''} ${fallback ? 'fallback' : ''}`}>
      <div ref={el} className="map-canvas" aria-label={t('mapTitle')} />
      <div className="map-top">
        <span className="map-chip">
          <i className="live-dot" />
          {t(risk ? 'projected' : activity ? 'harmonized' : 'observed')}
        </span>
        <div className="basemap-tabs">
          {['satellite', 'terrain', 'simple'].map((s) => (
            <button key={s} className={basemap === s ? 'selected' : ''} onClick={() => setBasemap(s)}>
              {t(s)}
            </button>
          ))}
        </div>
      </div>
      <div className="map-tools">
        <button title={t('layers')} onClick={() => setMenu(!menu)}>
          <Layers size={17} />
        </button>
        <button title={t('reset')} onClick={fit}>
          <LocateFixed size={17} />
        </button>
        <button title={t('zoomIn')} onClick={() => (leaf.current ? leaf.current.zoomIn() : gl.current?.zoomIn())}>
          <Plus size={18} />
        </button>
        <button title={t('zoomOut')} onClick={() => (leaf.current ? leaf.current.zoomOut() : gl.current?.zoomOut())}>
          <Minus size={18} />
        </button>
        <button title={t('map')} onClick={() => el.current?.parentElement?.requestFullscreen()}>
          <Maximize2 size={16} />
        </button>
      </div>
      {menu && (
        <div className="map-layer-menu">
          <label>
            <input type="checkbox" checked={labelsOn} onChange={(e) => setLabelsOn(e.target.checked)} />
            {lang === 'mm' ? 'ဒေသနှင့် သစ်တောအမည်များ' : 'Region & Forest Labels'}
          </label>
        </div>
      )}
      <div className="map-legend">
        <small>{t('legend')}</small>
        {evidenceCells ? (
          <>
            <span>
              <i className="evidence-square" />
              {lang === 'mm' ? 'ရွေးချယ်ထားသော မီးလောင်ရာများ' : 'Curated Burn Scar (2 / Reserve · 5 Bago Yoma)'}
            </span>
            <span className="legend-note">{lang === 'mm' ? '3D ဒရုန်းမြင်ကွင်း ဖွင့်ထားသည်' : '3D drone orbit enabled in panel'}</span>
          </>
        ) : risk ? (
          <>
            <div className="risk-ramp" />
            <div className="legend-between">
              <span>{t('veryLow')}</span>
              <span>{t('veryHigh')}</span>
            </div>
          </>
        ) : (
          <>
            <span>
              <i className="orange-circle" />
              MODIS · 1 km
            </span>
            <span>
              <i className="pink-diamond" />
              VIIRS · 375 m
            </span>
            <span>
              <i className="boundary-line" />
              {lang === 'mm' ? 'ကြိုးဝိုင်းသစ်တော ၁၀ ခု + ပဲခူးရိုးမ' : '10 Reserved Forests + Bago Yoma'}
            </span>
          </>
        )}
      </div>
      {error && <div className="map-error">{t('basemapError')}</div>}
    </div>
  );
}