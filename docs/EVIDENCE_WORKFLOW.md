# Independent burn-evidence workflow

## Delivered snapshot

The frozen pilot contains 60 cell-months in 2024–2025 on the original 589-cell, 5 km grid. Seed 42 selects across year, dry/wet season, qualifying recorded VIIRS presence/absence and latitude thirds. Selection precedes imagery review. Each row retains its inclusion probability; the initial imagery subset is not representative of the full AOI.

Twelve genuine Sentinel-2 pairs (24 scene uses) and 12 NASA MCD64A1 monthly subsets were acquired. Eleven pairs have at least 90% clear overlap; one has 59.16% after water, clouds and invalid reflectance are excluded. All 60 labels remain **unknown / review pending**. No independent agreement score or wildfire truth is claimed. The remaining 48 cell-months need imagery. No Landsat scenes, authenticated VIIRS science swaths or incident inventory were obtained.

The screen hides hotspot points and MCD64A1 results until a review is locked. Timeline bars also hide hotspot counts during review. This is workflow blinding, not access control: analysts can access the public FIRMS archive and underlying pilot JSON. Assign independent reviewers and keep their review session separate from hotspot/model analysis.

## Public acquisition

Activate the Python 3.12 environment from README:

~~~bat
python -m pip install -r requirements-evidence.lock.txt
python scripts/acquire_evidence.py
python scripts/process_evidence.py
python scripts/validate_release.py
~~~

The acquisition script chooses the first two dry-season sample IDs per year and latitude third without consulting detection counts. It queries the public Earth Search collection sentinel-2-c1-l2a, checks scene overlap and QA, and retrieves AOI-sized COG windows. Earliest/latest suitable in-month dates are preferred; fallback brackets are marked. Raw downloads and STAC records stay in data/raw/evidence/optical. Source URLs and raw SHA-256 values accompany processed assets. Cached sample manifests are reused; archive a failed sample directory explicitly before retrying. Extend the frozen acquisition selection to wet-season cases before reporting representative performance.

B8A/B12 are native 20 m bands; B04 is native 10 m and is aligned to 20 m. Earth Search C1 TIFF scale/offset metadata are read explicitly (delivered bands use 0.0001 and −0.1). Do not apply the harmonized Earth Engine offset to these files. Acquisition uses nearest-neighbor reprojection to preserve source DN and SCL. Processing aligns continuous bands with bilinear resampling and QA with nearest-neighbor, clipped to the original cell in EPSG:32647. SCL 4/5 are usable land; water and cloud/shadow/uncertain classes are excluded. Acquisition uses SCL 4/5/6 only to find clear scenes, so final usable-land overlap can be lower.

NBR=(NIR−SWIR2)/(NIR+SWIR2); dNBR=NBR_before−NBR_after. Nonfinite values, negative NIR/SWIR and nonpositive denominators are excluded. Candidates require dNBR ≥0.2 and connected area ≥10,000 m². These provisional thresholds are not a calibrated burn-severity scale. Senescence, harvest and other changes can produce candidates. Candidates never become labels automatically. False-color previews use SWIR2/NIR/red with the same 0–0.5 reflectance stretch on both dates; transparent pixels are invalid.

## Earth Engine and local optical imports

Authenticate locally; keep credentials out of the browser, source and ZIP:

~~~bat
python -m pip install -r requirements-gee.txt
earthengine authenticate
python scripts/export_gee.py --project YOUR_PROJECT --sample-id 25_400_2024-03 --sensor sentinel-2 --list-scenes
python scripts/export_gee.py --project YOUR_PROJECT --sample-id 25_400_2024-03 --sensor sentinel-2 --before-id FULL_EE_BEFORE_ID --after-id FULL_EE_AFTER_ID
~~~

Replace IDs with full collection-prefixed IDs from the listing. For Landsat, use --sensor landsat. Supported collections are LANDSAT/LC08/C02/T1_L2 and LANDSAT/LC09/C02/T1_L2: SR_B5, SR_B7 and SR_B4 use scale 0.0000275 and offset −0.2. QA_PIXEL bits 0–5 and 7 are excluded and QA_RADSAT must be zero. Harmonized S2 uses COPERNICUS/S2_SR_HARMONIZED, scale 0.0001 and zero offset. Exports are separate GeoTIFF bands at 20 m S2 or 30 m Landsat. Download completed Drive tasks into the printed folder and run the printed processing command. **GEE tasks were not executed for this release.**

For local files, create a JSON pair manifest with before and after objects. Each requires id, ISO date, product (sentinel-2 or landsat), and bands. Required band keys are nir, swir, red, qa, and Landsat radsat. Each band object needs path, scale, offset and source_url or source_id. Use the actual product scale/offset. Paths are absolute or relative to the current working directory.

~~~json
{
  "before": {
    "id":"REAL_SCENE_ID", "date":"2024-03-01T04:00:00Z", "product":"sentinel-2",
    "bands":{
      "nir":{"path":"data/raw/pre-B8A.tif","scale":0.0001,"offset":0,"source_url":"SOURCE_URL"},
      "swir":{"path":"data/raw/pre-B12.tif","scale":0.0001,"offset":0,"source_url":"SOURCE_URL"},
      "red":{"path":"data/raw/pre-B4.tif","scale":0.0001,"offset":0,"source_url":"SOURCE_URL"},
      "qa":{"path":"data/raw/pre-SCL.tif","scale":1,"offset":0,"source_url":"SOURCE_URL"}
    }
  },
  "after":{"id":"REAL_AFTER_ID","date":"2024-03-30T04:00:00Z","product":"sentinel-2","bands":{}}
}
~~~

Complete all after.bands and replace every example value before running:

~~~bat
python -m backend.optical --sample-id 25_400_2024-03 --manifest data/raw/pair.json
~~~

Do not replace imagery behind a locked review. Archive and adjudicate corrections separately.

## VIIRS usable-view coverage

~~~bat
python scripts/acquire_viirs.py --start 2024-03-01 --end 2024-03-02
~~~

This performs public CMR discovery. To download, set EARTHDATA_TOKEN in the local process and add --download. An authorized Earthdata account and product access are required. No token is written or embedded. Discovery and successful retrieval are distinct; HTTP 401/login responses never create coverage.

Pair VNP14IMG and VNP03IMG with the same S-NPP day/time and collection 002. Full-resolution fire mask, algorithm QA, geolocation_data/latitude, longitude and quality_flag must share dimensions. Fill geolocations are excluded. Classes remain distinguishable: 0 unprocessed, 1 bow-tie, 2 glint, 3 water, 4 cloud, 5 nonfire land, 6 unclassified, 7 low-confidence fire, 8 nominal, 9 high. Exclude algorithm QA bit 5 non-nominal geolocation, bit 22 residual bow-tie and nonzero geolocation quality. Usable land is 5/7/8/9; qualifying fire is 8/9.

In pairs.json, assign pass_id to contiguous granules from the same overpass, not one ID per granule. Groups must span ≤20 minutes and one calendar month. Pair records need fire, geolocation and pass_id. Supply a dated land_mask_source and a complete binary GeoTIFF: 1 land, 0 water, nodata such as 255 (zero must not be nodata).

~~~bat
python -m backend.coverage --manifest data/raw/evidence/viirs/2024-03-01_2024-03-02/pairs.json --land-mask data/raw/land-mask.tif
~~~

The importer uses a 375 m UTM target grid and nearest valid swath pixel centre within 375 m. Each target pixel counts once per pass; repeated granules are removed. This is an area approximation, especially off nadir, not an exact footprint union. Fractions use AOI-clipped land pixels and remain null if the land-mask denominator is incomplete. Missing, cloud, unclassified and unprocessed pixels are separate from usable pixels.

A usable pass with zero qualifying fire reads **No qualifying hotspot recorded during this pass**. Retrieved passes never prove full monthly coverage. Preserve unmatched granules, retrieved dates and archive gaps. Delivered coverage is unknown because authenticated swaths were unavailable.

## Review, QGIS and evaluation

1. Open Burn evidence, choose a cell-month, inspect dates, both images, clear-area gaps and candidates. Source metadata and dNBR GeoTIFF are downloadable.
2. Choose burn_scar, no_burn_evidence or unknown. A known monthly label requires chronological images contained in that month and an explicit confounder check. A negative-evidence label requires ≥90% clear overlap, ≤45-day gap and documented temporal adequacy. Small/subpixel or short-lived burns may be missed. A burn label requires a valid clipped polygon ≥1 ha. These are provisional review rules, not externally validated detection limits.
3. Enter reviewer, confidence and rationale. Lock before viewing VIIRS/MCD64A1. A scar alone does not establish wildfire type. If incident records become available, preserve authoritative source, date, location precision and documented fire type in a separate corroborating layer.
4. Export reviews JSON, validation CSV and reviewed polygon GeoJSON. The review table provides keyboard selection. Static review-table.csv and review-cells.geojson are blinded QGIS templates. Browser reviews remain device-local until exported and imported.

~~~bat
python -m backend.evidence import-reviews --reviews firewatch-reviews.json
python -m backend.evidence evaluate
python scripts/validate_release.py
~~~

Import validation is atomic and locked labels cannot be overwritten. Keep reviewed versions in the team's version history. Never import browser test reviews into the published scientific dataset.

Positive reference = independently reviewed imagery scar. Positive comparison = qualifying recorded VIIRS presence in the same cell/month. TP/FP/FN/TN, known/unknown counts, precision, recall, F1 and accuracy include denominators; zero denominators remain null. Dry/wet summaries include review and coverage counts. Report **unweighted pilot-sample agreement** only. AOI-wide estimates require design weights and uncertainty that handle spatial/temporal clustering and missing reviews.

MCD64A1 Collection 6.1 is a cross-check only. ORNL subsets retain Burn_Date, uncertainty, First_Day, Last_Day and QA. Processing clips sinusoidal pixel centres, requires land/valid bits and excludes shortened mapping periods. Nominal 500 m pixels measure 463.3127 m on this grid. Source tile/processing dates, uncertainty and reliable mapping ranges are retained. The REST response omits original HDF filenames; collection attribution follows the provider citation. Active-fire information enters the MCD64A1 algorithm, so it is excluded from independent labels.

Existing models are unchanged and do not read the evidence directory. Their scores concern recorded VIIRS detections on 14,136 held-out cell-months. No burn-evidence model is trained from this pilot.

## Source references

- Earth Search STAC: https://earth-search.aws.element84.com/v1
- S2 harmonized: https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S2_SR_HARMONIZED
- Landsat C2: https://developers.google.com/earth-engine/datasets/catalog/LANDSAT_LC08_C02_T1_L2
- Landsat scaling: https://www.usgs.gov/landsat-missions/landsat-collection-2-surface-reflectance
- NASA VIIRS C2 guide: https://ladsweb.modaps.eosdis.nasa.gov/archive/Document%20Archive/Science%20Data%20Product%20Documentation/VIIRS_C2_AF-375m_User_Guide_1.2.pdf
- VNP03IMG: https://ladsweb.modaps.eosdis.nasa.gov/filespec/VIIRS/1/VNP03IMG
- ORNL REST: https://modis.ornl.gov/data/modis_webservice.html
- MCD64A1.061: https://doi.org/10.5067/MODIS/MCD64A1.061
- GEE authentication: https://developers.google.com/earth-engine/guides/auth

