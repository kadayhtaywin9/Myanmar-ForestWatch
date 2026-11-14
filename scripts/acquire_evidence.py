"""Acquire real optical chips and NASA MODIS reference inputs for a frozen pilot.

Run with the local FireWatch Python environment.
Raw outputs are immutable cached inputs in data/raw/evidence/optical. Review labels are recorded separately.
"""

from __future__ import annotations

import calendar
import concurrent.futures
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
from pathlib import Path
import time

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.features import geometry_mask
from rasterio.transform import from_origin
from rasterio.vrt import WarpedVRT
from shapely.geometry import mapping, shape
from shapely.ops import transform as transform_geometry
from pyproj import Transformer
import requests


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data/raw/evidence/optical"
PILOT = ROOT / "public/data/evidence/pilot.json"
OUT.mkdir(exist_ok=True, parents=True)
PROJECT = Transformer.from_crs(4326, 32647, always_xy=True).transform
GDAL_OPTIONS = {
    "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
    "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tif",
    "GDAL_HTTP_TIMEOUT": 45,
    "GDAL_HTTP_MAX_RETRY": 2,
}


def fetch_json(url, params=None):
    for attempt in range(3):
        try:
            response = requests.get(url, params=params, timeout=50)
            response.raise_for_status()
            return response.json(), response.url
        except requests.RequestException:
            if attempt == 2:
                raise
            time.sleep(2)


def target_grid(sample):
    polygon = transform_geometry(PROJECT, shape(sample["geometry"]))
    left, bottom, right, top = polygon.bounds
    left, bottom = math.floor(left / 20) * 20, math.floor(bottom / 20) * 20
    right, top = math.ceil(right / 20) * 20, math.ceil(top / 20) * 20
    width, height = max(1, round((right-left)/20)), max(1, round((top-bottom)/20))
    affine = from_origin(left, top, 20, 20)
    inside = geometry_mask([mapping(polygon)], out_shape=(height, width), transform=affine, invert=True)
    return {"crs": "EPSG:32647", "transform": affine, "width": width, "height": height}, inside


def read_chip(item, asset_name, grid, inside, destination):
    asset = item["assets"][asset_name]
    with rasterio.Env(**GDAL_OPTIONS):
        with rasterio.open(asset["href"]) as source:
            scale, offset = source.scales[0], source.offsets[0]
            with WarpedVRT(source, **grid, resampling=Resampling.nearest, nodata=0) as warped:
                data = warped.read()
            data[:, ~inside] = 0
            profile = {**grid, "driver": "GTiff", "count": data.shape[0], "dtype": str(data.dtype),
                       "nodata": 0, "compress": "deflate", "tiled": True, "blockxsize": 256, "blockysize": 256}
            with rasterio.open(destination, "w", **profile) as target:
                target.write(data)
                target.scales = source.scales
                target.offsets = source.offsets
                target.update_tags(source_url=asset["href"], scene_id=item["id"],
                                   acquisition_time=item["properties"]["datetime"],
                                   resampling="nearest", source_collection=item["collection"])
    return data, {"path": str(destination), "href": asset["href"], "scale": scale, "offset": offset,
                  "sha256": hashlib.sha256(destination.read_bytes()).hexdigest()}


def select_scenes(sample, folder, grid, inside):
    year, month = map(int, sample["period"].split("-"))
    start = datetime(year, month, 1, tzinfo=timezone.utc)
    end = start + timedelta(days=calendar.monthrange(year, month)[1])
    period = f"{(start-timedelta(days=30)).isoformat()}/{(end+timedelta(days=30)).isoformat()}"
    bbox = shape(sample["geometry"]).bounds
    response, request_url = fetch_json("https://earth-search.aws.element84.com/v1/search", {
        "collections": "sentinel-2-c1-l2a", "bbox": ",".join(map(str, bbox)),
        "datetime": period, "limit": 250,
    })
    (folder / "stac-search.json").write_text(json.dumps(response))
    geographic_polygon = shape(sample["geometry"])
    candidates = [item for item in response["features"]
                  if item["properties"].get("eo:cloud_cover", 100) <= 30
                  and shape(item["geometry"]).intersection(geographic_polygon).area / geographic_polygon.area >= 0.99]
    candidates.sort(key=lambda item: (item["properties"]["datetime"], item["id"]))
    within = [item for item in candidates if start.isoformat()[:10] <= item["properties"]["datetime"][:10] < end.isoformat()[:10]]
    tried = []
    cache = {}

    def clear(item):
        if item["id"] not in cache:
            scene_dir = folder / item["id"]
            scene_dir.mkdir(exist_ok=True)
            data, metadata = read_chip(item, "scl", grid, inside, scene_dir / "SCL.tif")
            fraction = float((np.isin(data[0], [4, 5, 6]) & inside).sum() / max(1, inside.sum()))
            cache[item["id"]] = (fraction, metadata)
            tried.append({"scene_id": item["id"], "clear_fraction": fraction})
        return cache[item["id"]][0] >= 0.9

    before = next((item for item in within[:8] if clear(item)), None)
    after = next((item for item in reversed(within[-8:]) if clear(item)
                  and (before is None or item["properties"]["datetime"][:10] != before["properties"]["datetime"][:10])), None)
    interval_within_month = before is not None and after is not None
    if before is None:
        before = next((item for item in reversed(candidates) if item["properties"]["datetime"][:10] < start.isoformat()[:10] and clear(item)), None)
    if after is None:
        after = next((item for item in candidates if item["properties"]["datetime"][:10] >= end.isoformat()[:10] and clear(item)), None)
    return before, after, interval_within_month, request_url, tried, cache


def acquire_one(sample):
    folder = OUT / sample["sample_id"]
    folder.mkdir(exist_ok=True)
    metadata_path = folder / "manifest.json"
    if metadata_path.exists():
        return json.loads(metadata_path.read_text())
    grid, inside = target_grid(sample)
    result = {"sample_id": sample["sample_id"], "cell_id": sample["cell_id"], "period": sample["period"],
              "geometry": sample["geometry"], "geographic_band": sample["geographic_band"],
              "selection_rule": "First two dry-season sample IDs within each year and latitude-third, without consulting detection counts",
              "crs": "EPSG:32647", "resolution_m": 20, "label": "unknown", "review_status": "pending"}
    try:
        before, after, interval_valid, query_url, tried, cache = select_scenes(sample, folder, grid, inside)
        result.update(stac_query=query_url, qa_trials=tried, interval_within_month=interval_valid,
                      scene_selection="Earliest and latest distinct date inside month with >=90% SCL classes 4/5/6 over cell. Fallback to bracketing scenes within 30 days.")
        for role, item in [("before", before), ("after", after)]:
            if item is None:
                result[role] = None
                continue
            scene_dir = folder / item["id"]
            scene_dir.mkdir(exist_ok=True)
            item_path = scene_dir / "stac-item.json"
            item_path.write_text(json.dumps(item, indent=2))
            assets = {"SCL": cache[item["id"]][1]}
            for asset_name, filename in [("nir08", "B8A"), ("swir22", "B12"), ("red", "B04"), ("visual", "TCI")]:
                _, metadata = read_chip(item, asset_name, grid, inside, scene_dir / f"{filename}.tif")
                assets[filename] = metadata
            result[role] = {"id": item["id"], "datetime": item["properties"]["datetime"],
                            "clear_fraction": cache[item["id"]][0], "item_path": str(item_path), "assets": assets}
            print(json.dumps({"sample":sample["sample_id"],"role":role,"scene":item["id"],"clear_fraction":cache[item["id"]][0]}), flush=True)
        result["status"] = "acquired" if before and after else "partial"
    except Exception as error:
        result.update(status="error", error=str(error))
    try:
        month_start = datetime.strptime(sample["period"], "%Y-%m")
        date = month_start.strftime("A%Y%j")
        document, url = fetch_json("https://modis.ornl.gov/rst/api/v1/MCD64A1/subset", {
            "latitude": sample["lat"], "longitude": sample["lon"], "startDate": date, "endDate": date,
            "kmAboveBelow": 4, "kmLeftRight": 4,
        })
        path = folder / "MCD64A1.json"
        path.write_text(json.dumps(document))
        result["mcd64a1"] = {"path": str(path), "url": url, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                              "status": "acquired", "role": "cross_check_only", "bands": [v["band"] for v in document["subset"]]}
    except Exception as error:
        result["mcd64a1"] = {"status": "unavailable", "error": str(error)}
    metadata_path.write_text(json.dumps(result, indent=2))
    print(json.dumps({"sample":sample["sample_id"],"status":result["status"],"mcd64a1":result["mcd64a1"]["status"]}), flush=True)
    return result


def main():
    samples = json.loads(PILOT.read_text())["samples"]
    selected = []
    for year in (2024, 2025):
        for geographic_band in range(3):
            eligible = [sample for sample in samples if sample["period"].startswith(str(year))
                        and sample["season"].startswith("dry") and sample["geographic_band"] == geographic_band]
            selected.extend(sorted(eligible, key=lambda sample: sample["sample_id"])[:2])
    (OUT / "selection.json").write_text(json.dumps({"pilot_sha256": hashlib.sha256(PILOT.read_bytes()).hexdigest(),
        "selected_sample_ids": [sample["sample_id"] for sample in selected], "selection_uses_detection_counts": False}, indent=2))
    results = list(concurrent.futures.ThreadPoolExecutor(max_workers=3).map(acquire_one, selected))
    manifest = {"created_at": datetime.now(timezone.utc).isoformat(), "collection": "sentinel-2-c1-l2a", "samples": results}
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(json.dumps({"complete":len(results),"pairs":sum(row["status"]=="acquired" for row in results),"manifest":str(OUT/'manifest.json')}), flush=True)


if __name__ == "__main__":
    main()
