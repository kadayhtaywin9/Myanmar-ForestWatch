"""Myanmar ForestWatch FastAPI Service (Local & Vercel Serverless)."""
import os, json, secrets
from pathlib import Path
from functools import lru_cache
import joblib, numpy as np, pandas as pd
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from .core import ROOT, reserved_forests
from .train import features

app = FastAPI(title="Myanmar ForestWatch API", version="2.1")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-API-Key"],
)

runtime = ROOT / "data/runtime"
runtime.mkdir(exist_ok=True, parents=True)


@lru_cache(maxsize=16)
def read_json(path: str, mtime: int):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def cached_json(path: Path):
    return read_json(str(path), path.stat().st_mtime_ns)


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "app": "Myanmar ForestWatch",
        "reserves": 10,
        "selected_model": "XGBoost",
        "available_models": ["XGBoost", "Random forest", "Logistic regression", "Seasonal baseline"],
        "forecast_horizon_months": 12,
        "model_exists": (runtime / "model.joblib").exists(),
    }


@app.get("/api/reserves")
def reserves():
    return reserved_forests()


@app.get("/api/model")
def model():
    p = ROOT / "public/data/model-report.json"
    if not p.exists():
        raise HTTPException(503, "No model evaluation available")
    return cached_json(p)


@app.get("/api/hotspots")
def hotspots(year: int = 2025, month: int | None = None, forest_id: str | None = None, sensor: str = "both", offset: int = 0, limit: int = 500):
    if not 2012 <= year <= 2026 or (month is not None and not 1 <= month <= 12) or sensor not in ["MODIS", "VIIRS", "both"]:
        raise HTTPException(422, "Invalid filter")
    p = ROOT / f"public/data/hotspots-{year}.json"
    if not p.exists():
        raise HTTPException(404, "No records for this year")
    rows = [
        r
        for r in cached_json(p)
        if (sensor == "both" or r["sensor"] == sensor)
        and (month is None or int(r["date"][5:7]) == month)
        and (forest_id is None or forest_id == "all" or r.get("forest_id") == forest_id)
    ]
    return {"total": len(rows), "items": rows[max(0, offset) : max(0, offset) + min(max(1, limit), 5000)]}


class Predict(BaseModel):
    months: int = Field(default=12, ge=1, le=12)
    scenario: str = "baseline"
    model_name: str = "XGBoost"
    forest_id: str | None = None


@app.post("/api/predict")
def predict(req: Predict):
    if req.scenario not in ["baseline", "dry", "wet"]:
        raise HTTPException(422, "Unknown scenario")
    valid_models = ["XGBoost", "Random forest", "Logistic regression", "Seasonal baseline"]
    if req.model_name not in valid_models:
        raise HTTPException(422, f"Unknown model: {req.model_name}")
    p = runtime / "model.joblib"
    if not p.exists():
        raise HTTPException(503, "No trained models found")
    bundle = joblib.load(p)
    history = bundle["history"]
    report = bundle["report"]
    cells = history[["cell_id", "forest_id", "lat", "lon"]].drop_duplicates()
    if req.forest_id and req.forest_id != "all":
        cells = cells[cells.forest_id == req.forest_id]
    if cells.empty:
        raise HTTPException(422, "No cells found for selected Reserved Forest")

    dates = pd.date_range(report.get("forecast_origin", "2026-12"), periods=req.months, freq="MS")
    future = pd.concat([cells.assign(m=d.month, period=d.strftime("%Y-%m")) for d in dates], ignore_index=True)
    x = features(history, future)
    if req.model_name == "Seasonal baseline":
        pred = x.season_frequency.values
    else:
        pred = bundle["models"][req.model_name].predict_proba(x)[:, 1]
    k = {"baseline": 1.0, "dry": 1.25, "wet": 0.8}[req.scenario]
    pred = pred * k / (1 - pred + pred * k)

    risk_path = ROOT / "public/data/seasonal-risk.json"
    all_risks = cached_json(risk_path)
    ref = np.sort([r.get("by_model", {}).get(req.model_name, r)["raw_proxy"] for r in all_risks])
    future["index"] = np.searchsorted(ref, pred, side="right") / len(ref) * 100.0
    return {
        "model": req.model_name,
        "horizon_months": req.months,
        "scenario": req.scenario,
        "items": future[["cell_id", "forest_id", "period", "index"]].round(3).to_dict("records"),
    }


if (ROOT / "public/data").exists():
    app.mount("/data", StaticFiles(directory=ROOT / "public/data"), name="data")
if (ROOT / "dist/index.html").exists():
    app.mount("/", StaticFiles(directory=ROOT / "dist", html=True), name="frontend")
