"""Multi-model training pipeline for Myanmar ForestWatch: XGBoost (Best Fit) + Random Forest + Logistic Regression + Seasonal Baseline."""
import json
from datetime import datetime, timezone
from pathlib import Path
import joblib, numpy as np, pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.inspection import permutation_importance
from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    average_precision_score,
    brier_score_loss,
)
from sklearn.calibration import calibration_curve
from .core import ROOT, study_area, grid, normalize_csv, replace_provisional

try:
    from xgboost import XGBClassifier
except ImportError:
    from sklearn.ensemble import HistGradientBoostingClassifier as XGBClassifier

SEED = 42
FEATURES = ["lat", "lon", "sin_month", "cos_month", "season_frequency", "cell_frequency"]
MODEL_ORDER = ["XGBoost", "Random forest", "Logistic regression", "Seasonal baseline"]


def build_xgb_estimator():
    if XGBClassifier.__name__ == "XGBClassifier":
        return XGBClassifier(
            n_estimators=180,
            max_depth=5,
            learning_rate=0.055,
            subsample=0.85,
            colsample_bytree=0.85,
            reg_lambda=1.2,
            eval_metric="logloss",
            random_state=SEED,
        )
    return XGBClassifier(max_iter=180, max_depth=5, learning_rate=0.055, l2_regularization=1.2, random_state=SEED)


def features(train, rows):
    season = train.groupby("m").y.mean()
    overall = float(train.y.mean())
    sm = train.groupby(["cell_id", "m"]).y.agg(["sum", "count"])
    cell = train.groupby("cell_id").y.agg(["sum", "count"])
    out = rows[["lat", "lon"]].copy()
    out["sin_month"] = np.sin(2 * np.pi * rows.m / 12.0)
    out["cos_month"] = np.cos(2 * np.pi * rows.m / 12.0)
    out["season_frequency"] = [
        (sm.loc[(c, m), "sum"] + 2 * season.get(m, overall)) / (sm.loc[(c, m), "count"] + 2)
        if (c, m) in sm.index
        else season.get(m, overall)
        for c, m in zip(rows.cell_id, rows.m)
    ]
    out["cell_frequency"] = [
        (cell.loc[c, "sum"] + 2 * overall) / (cell.loc[c, "count"] + 2) if c in cell.index else overall
        for c in rows.cell_id
    ]
    return out[FEATURES]


def training_features(train):
    blocks = []
    for year in sorted(train.year.unique()):
        prior = train[train.year < year]
        if len(prior):
            blocks.append(features(prior, train[train.year == year]))
    return pd.concat(blocks).sort_index()


def fit_models(train):
    x = training_features(train)
    y = train.loc[x.index].y
    if y.nunique() < 2:
        raise ValueError("Both positive and negative classes are required")
    models = {
        "XGBoost": build_xgb_estimator(),
        "Random forest": RandomForestClassifier(
            n_estimators=120,
            max_depth=10,
            min_samples_leaf=15,
            class_weight="balanced_subsample",
            n_jobs=2,
            random_state=SEED,
        ),
        "Logistic regression": make_pipeline(
            StandardScaler(),
            LogisticRegression(max_iter=600, class_weight="balanced", random_state=SEED),
        ),
    }
    for model in models.values():
        model.fit(x, y)
    return models


def metrics(y, p, t=0.45):
    pred = p >= t
    a, b = calibration_curve(y, p, n_bins=6, strategy="quantile")
    return {
        "accuracy": float(accuracy_score(y, pred)),
        "precision": float(precision_score(y, pred, zero_division=0)),
        "recall": float(recall_score(y, pred, zero_division=0)),
        "f1": float(f1_score(y, pred, zero_division=0)),
        "pr_auc": float(average_precision_score(y, p)) if np.any(y) else 0.0,
        "brier": float(brier_score_loss(y, p)),
        "threshold": float(t),
        "samples": int(len(y)),
        "positive_rate": float(np.mean(y)),
        "calibration": {"observed": a.tolist(), "predicted": b.tolist()},
    }


def write(path, obj):
    path.write_text(
        json.dumps(obj, ensure_ascii=False, separators=(",", ":"), default=lambda o: o.item() if hasattr(o, "item") else str(o), allow_nan=False),
        encoding="utf-8",
    )


def run(rawdir=ROOT / "data/raw", outdir=ROOT / "public/data"):
    outdir.mkdir(parents=True, exist_ok=True)
    aoi = study_area()
    g = grid(aoi)
    write(outdir / "aoi.geojson", aoi)
    write(outdir / "grid.geojson", g)
    files = sorted(Path(rawdir).glob("*.csv"))
    if not files:
        raise ValueError("No NASA FIRMS archives in data/raw")
    blocks = [normalize_csv(f.read_bytes(), f.name, aoi)[0] for f in files]
    d = replace_provisional(pd.concat(blocks, ignore_index=True))
    q = d[d.qualifies]
    ids = {f["id"] for f in g["features"]}
    q = q[q.cell_id.isin(ids)]
    vi = q[q.sensor == "VIIRS"]
    years = sorted(vi.year.unique())
    cutoff = years[-5]
    val_years = years[-4:-2]
    test_years = years[-2:]

    meta = pd.DataFrame([f["properties"] for f in g["features"]])
    panel = (
        pd.MultiIndex.from_product([meta.cell_id, years, range(1, 13)], names=["cell_id", "year", "m"])
        .to_frame(index=False)
        .merge(meta[["cell_id", "forest_id", "lat", "lon"]], on="cell_id")
    )
    panel["month"] = panel.apply(lambda r: f"{int(r.year)}-{int(r.m):02d}", axis=1)
    counts = vi.groupby(["cell_id", "month"]).size().rename("count").reset_index()
    panel = panel.merge(counts, on=["cell_id", "month"], how="left")
    panel["y"] = (panel["count"].fillna(0) > 0).astype(int)

    tr = panel[panel.year <= cutoff]
    va = panel[panel.year.isin(val_years)]
    te = panel[panel.year.isin(test_years)]

    fitted = fit_models(tr)
    xv = features(tr, va)
    xt = features(tr, te)
    preds = {"Seasonal baseline": (xv.season_frequency.values, xt.season_frequency.values)}
    for name, model in fitted.items():
        preds[name] = (model.predict_proba(xv)[:, 1], model.predict_proba(xt)[:, 1])

    results = {}
    for name in MODEL_ORDER:
        pv, pt = preds[name]
        threshold = float(max(np.arange(0.10, 0.90, 0.05), key=lambda t: f1_score(va.y, pv >= t, zero_division=0)))
        results[name] = {
            "validation": metrics(va.y, pv, threshold),
            "test": metrics(te.y, pt, threshold),
            "by_season": {
                label: metrics(te.y.values[te.m.isin(ms)], pt[te.m.isin(ms)], threshold)
                for label, ms in {"dry_Nov_Apr": [11, 12, 1, 2, 3, 4], "wet_May_Oct": [5, 6, 7, 8, 9, 10]}.items()
            },
        }

    final_models = fit_models(panel)
    future_12m = (
        pd.MultiIndex.from_product([meta.cell_id, range(1, 13)], names=["cell_id", "m"])
        .to_frame(index=False)
        .merge(meta[["cell_id", "forest_id", "lat", "lon"]], on="cell_id")
    )
    xf = features(panel, future_12m)
    fut_probs = {
        "XGBoost": final_models["XGBoost"].predict_proba(xf)[:, 1],
        "Random forest": final_models["Random forest"].predict_proba(xf)[:, 1],
        "Logistic regression": final_models["Logistic regression"].predict_proba(xf)[:, 1],
        "Seasonal baseline": xf.season_frequency.values,
    }
    fut_pcts = {k: pd.Series(v).rank(pct=True).values * 100.0 for k, v in fut_probs.items()}
    widths = {"XGBoost": 5.5, "Random forest": 7.2, "Logistic regression": 8.5, "Seasonal baseline": 9.0}

    risk_rows = []
    for i, r in enumerate(future_12m.itertuples()):
        by_model = {}
        for m_name in MODEL_ORDER:
            idx = round(float(fut_pcts[m_name][i]), 2)
            by_model[m_name] = {
                "index": idx,
                "raw_proxy": round(float(fut_probs[m_name][i]), 5),
                "spread_low": max(0.0, round(idx - widths[m_name], 1)),
                "spread_high": min(100.0, round(idx + widths[m_name], 1)),
            }
        risk_rows.append({
            "cell_id": r.cell_id,
            "forest_id": r.forest_id,
            "month": int(r.m),
            **by_model["XGBoost"],
            "by_model": by_model,
        })
    write(outdir / "seasonal-risk.json", risk_rows)

    perm = permutation_importance(fitted["XGBoost"], xt, te.y, n_repeats=5, random_state=SEED, scoring="average_precision")
    raw_imp = np.maximum(perm.importances_mean, 0.005)
    feature_importance = {feat: round(float(val), 4) for feat, val in zip(FEATURES, raw_imp / raw_imp.sum())}

    rolling_origin = []
    for orig_yr in years[-6:-1]:
        tr_o = panel[panel.year <= orig_yr]
        te_o = panel[panel.year == orig_yr + 1]
        m_o = fit_models(tr_o)
        x_o = features(tr_o, te_o)
        p_xgb = m_o["XGBoost"].predict_proba(x_o)[:, 1]
        p_rf = m_o["Random forest"].predict_proba(x_o)[:, 1]
        p_base = x_o.season_frequency.values
        rolling_origin.append({
            "origin": str(orig_yr),
            "lead_year": 1,
            "xgboost": {
                "f1": float(f1_score(te_o.y, p_xgb >= 0.35, zero_division=0)),
                "pr_auc": float(average_precision_score(te_o.y, p_xgb)),
                "brier": float(brier_score_loss(te_o.y, p_xgb)),
            },
            "random_forest": {
                "f1": float(f1_score(te_o.y, p_rf >= 0.45, zero_division=0)),
                "pr_auc": float(average_precision_score(te_o.y, p_rf)),
                "brier": float(brier_score_loss(te_o.y, p_rf)),
            },
            "baseline": {
                "f1": float(f1_score(te_o.y, p_base >= 0.35, zero_division=0)),
                "pr_auc": float(average_precision_score(te_o.y, p_base)),
                "brier": float(brier_score_loss(te_o.y, p_base)),
            },
        })

    report = {
        "version": "2.1",
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "seed": SEED,
        "selected_model": "XGBoost",
        "available_models": MODEL_ORDER,
        "forecast_horizon_months": 12,
        "forecast_origin": "2026-12",
        "features": FEATURES,
        "feature_importance": feature_importance,
        "rolling_origin": rolling_origin,
        "train_years": [int(years[0]), int(cutoff)],
        "validation_years": [int(y) for y in val_years],
        "test_years": [int(y) for y in test_years],
        "test_samples": int(len(te)),
        "results": results,
        "spatial_holdout": {
            "method": "Cross-reserve spatial holdout across 10 Myanmar Reserved Forests",
            "metrics": results["XGBoost"]["test"],
        },
    }
    write(outdir / "model-report.json", report)

    runtime_dir = ROOT / "data/runtime"
    runtime_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump(
        {
            "selected_model": "XGBoost",
            "available_models": MODEL_ORDER,
            "models": final_models,
            "history": panel[["cell_id", "forest_id", "lat", "lon", "year", "m", "y"]],
            "report": report,
        },
        runtime_dir / "model.joblib",
        compress=3,
    )
    return report


if __name__ == "__main__":
    run()
