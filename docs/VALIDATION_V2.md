# Rebuild v2 validation — 12 November 2026

This report separates implementation checks from scientific validation. The delivered application is a static map workspace with a reproducible local Python pipeline. Passing software checks does not establish wildfire truth or operational forecasting skill.

## Delivered evidence

| Item | Verified state |
|---|---|
| Frozen pilot | 60 cell-months in 2024–2025, preserving original 5 km grid IDs; 30 dry-season and 30 wet-season samples. |
| Optical imagery | 12 real Sentinel-2 before/after pairs, with source IDs, dates, scale/offset, QA and checksums. All are dry-season samples. |
| Clear overlap | 11 pairs have at least 90% usable overlap; sample 31_411_2024-04 has approximately 59.16%. |
| Derived assets | Matched false-color previews, NBR and dNBR GeoTIFFs, provisional candidate polygons and processing metadata for each pair. |
| Burned-area cross-check | 12 real MCD64A1 Collection 6.1 monthly subsets, retained as a cross-check after review locking. |
| Independent labels | Zero locked human reviews. All 60 samples remain unknown / review pending; no unknown is counted as a negative. |
| VIIRS observation coverage | No authenticated VNP14IMG/VNP03IMG science swaths acquired. Coverage remains unknown. Public discovery and a paired-swath importer are implemented. |
| Other evidence | No Landsat scenes or authoritative incident inventory acquired. Local Landsat processing and authenticated GEE export commands are supplied. |

The image subset is not representative of the full AOI or all seasons. The pilot manifest records inclusion probabilities. Current precision, recall, F1 and accuracy against independently reviewed imagery are undefined, with zero known-label denominators. Existing model metrics remain evaluations of recorded VIIRS detections, not this new evidence pilot. No model was retrained on unreviewed imagery.

Machine-readable evidence and asset hashes: `public/data/evidence/validation-report.json`. Blinded GIS templates: `review-table.csv` and `review-cells.geojson` in the same directory. The source ZIP also contains `PACKAGE-MANIFEST.json`, covering every packaged source/data/model file.

## Automated checks

**20 Python tests and 12 TypeScript tests passed during the rebuild.** The original API, data processing and model inference checks remain included. New checks cover:

- Reproducible stratified selection and preservation of original grid IDs.
- Unknown-label exclusion, review prerequisites, monthly image intervals and minimum burn-polygon area.
- Atomic review imports and refusal to overwrite locked reviews.
- Confusion-matrix denominators and disagreements between imagery and recorded detections.
- Reflectance scaling, cloud/invalid masking, source provenance and processed-asset contracts.
- VIIRS filename pairing, dimensions, quality flags, target-grid clipping and within-pass deduplication.

Synthetic arrays and fixture polygons are confined to tests; they are not scientific observations. Python compilation and TypeScript/Vite production builds passed. The final release build is also required by the publication workflow after packaging the source download. Dependency deprecation notices and the MapLibre bundle-size warning are non-blocking.

Reproduce the checks from the project root after installing the pinned dependencies:

```text
python -m unittest discover -s tests -v
npm test
python scripts/validate_release.py
python scripts/package_source.py
npm run build
```

## Browser checks completed

| Area | Observed result |
|---|---|
| Map workspace | Desktop layout, real satellite basemap and Leaflet fallback rendered. Task tabs preserve the selected month and support cell selection. |
| Evidence | Real before/after previews, comparison control and clear-overlap metadata rendered. An empty review was rejected without saving a label. |
| Mobile and tablet | 390 × 844 and 820 × 844 embedded viewports reviewed. English/Myanmar layouts fit without horizontal overflow after label fixes. |
| Mobile sheet | Evidence details start collapsed and expand through the accessible handle/button. |
| Appearance | Light/dark and solid-panel controls worked. The solid mobile panel computed to an opaque fill with no backdrop blur. |
| Language | Explicit Myanmar month labels and digits rendered, including where browser locale formatting fell back to English. |
| Planning | Selecting 48 months and the final lead displayed October 2030 with the relative-planning/scenario explanation. |
| Analysis dialog | Focus moved inside, background map became inert, and Escape dismissed the dialog. |
| Validation export | Downloaded CSV contained 60 rows, provenance/version columns and blinded detection counts for every unreviewed sample. |

The original release's successful browser import of authentic NASA rows is recorded in `ACCEPTANCE.md`. An additional import regression check in the rebuilt interface was **not completed**: automatic approval review rejected the browser action because the automation usage limit was reached. That action was not executed; it is not counted as a pass. Completed checks above remain separate from that limit.

## Remaining verification limits

- The MapLibre/WebGL path compiled but was not exercised in this browser; runtime checks used its Leaflet fallback.
- Embedded viewport checks do not certify physical iOS touch gestures, Safari rendering or safe-area behavior on hardware.
- No formal screen-reader, WCAG or color-vision simulation audit was completed. Contrast calculations and solid-panel alternatives are documented in `DESIGN.md`.
- No authenticated GEE exports or Earthdata science downloads were executed. Real-swath processing still needs validation against acquired products and their collection metadata.
- New browser review persistence/import was not validated with a real human-reviewed scientific record. Software tests use fixtures; the shipped pilot remains untouched by test labels.
- The static site has no hosted Python training service or shared review database. Browser reviews remain local until exported and imported into the local pipeline.

Complete independent imagery review and establish valid observation coverage before interpreting agreement or making operational claims. The remaining 48 cell-months also need suitable imagery or a documented unknown outcome. Acquisition, QGIS review, export and evaluation commands are in `EVIDENCE_WORKFLOW.md`.
