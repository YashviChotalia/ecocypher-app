"""HackSphere 3.0 — predict.py (EcoCypher Microgrid)

Contract: predict(input_df) -> numpy array, one demand prediction (kW) per input row.
CLI:      python predict.py --input sample_test_input.csv --output predictions.csv

Flow:
  1. Clean inputs (parse timestamps, coerce numbers, interpolate missing values, clip ranges).
  2. Build the SAME engineered features used to train the QuickML pipeline (quickml/train_quickml.csv).
  3. Call the published Zoho Catalyst QuickML endpoint (OAuth2 Zoho-oauthtoken).
  4. If QuickML is not configured or fails, fall back to the embedded linear model
     (identical feature set; time-ordered holdout RMSE 8.3 kW) so output is always valid.

Configuration (environment variables override the constants below; never commit secrets):
  QUICKML_ENDPOINT_URL   published endpoint "Deployment URL"
  QUICKML_ENDPOINT_KEY   X-QUICKML-ENDPOINT-KEY
  CATALYST_ORG           CATALYST-ORG header (org id)
  QUICKML_ENVIRONMENT    Development | Production (default Production)
  QUICKML_ACCESS_TOKEN   OAuth access token (scope QuickML.deployment.READ), or for auto-refresh:
  ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN / ZOHO_ACCOUNTS_URL (default https://accounts.zoho.in)
"""
import argparse
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request

import numpy as np
import pandas as pd

QUICKML_ENDPOINT_URL = os.getenv("QUICKML_ENDPOINT_URL", "YOUR_PUBLISHED_QUICKML_ENDPOINT_URL_HERE")
QUICKML_ENDPOINT_KEY = os.getenv("QUICKML_ENDPOINT_KEY", "")
CATALYST_ORG = os.getenv("CATALYST_ORG", "")
QUICKML_ENVIRONMENT = os.getenv("QUICKML_ENVIRONMENT", "Production")
QUICKML_ACCESS_TOKEN = os.getenv("QUICKML_ACCESS_TOKEN", "")
ZOHO_CLIENT_ID = os.getenv("ZOHO_CLIENT_ID", "")
ZOHO_CLIENT_SECRET = os.getenv("ZOHO_CLIENT_SECRET", "")
ZOHO_REFRESH_TOKEN = os.getenv("ZOHO_REFRESH_TOKEN", "")
ZOHO_ACCOUNTS_URL = os.getenv("ZOHO_ACCOUNTS_URL", "https://accounts.zoho.in").rstrip("/")
VERBOSE = os.getenv("PREDICT_VERBOSE", "1") != "0"

FEATURES = [
    "hour", "day_of_week", "is_weekend",
    "ambient_temp_c", "humidity_pct", "solar_irradiance_wm2",
    "cooling_degree_c", "heating_degree_c",
    "is_night", "is_morning_ramp", "is_morning_peak", "is_evening_peak", "is_late_evening",
    "hour_sin", "hour_cos",
]
# Embedded fallback model (fitted by model/train.py on train_telemetry.csv, same FEATURES order)
LOCAL_INTERCEPT = 145.42623657571153
LOCAL_COEF = [0.04750726948323672, 0.009730182613826077, -0.30414760763922444, -0.08019112092008658,
              -0.01866047609019495, 0.0020973400374436207, 8.674841040645866, -0.20094445307294068,
              -52.402145854532826, -9.910326327351788, 30.481064741633027, 54.460793493438494,
              -33.508848459999555, -0.21719111176555378, -0.22147472341365723]
LOCAL_CLIP = (25.55, 459.495)
DEFAULTS = {"ambient_temp_c": 18.5, "humidity_pct": 70.7, "solar_irradiance_wm2": 0.0}
LIMITS = {"ambient_temp_c": (-30, 60), "humidity_pct": (0, 100), "solar_irradiance_wm2": (0, 1400)}


def _log(msg):
    if VERBOSE:
        print(msg, file=sys.stderr)


def clean_inputs(input_df: pd.DataFrame) -> pd.DataFrame:
    df = input_df.copy()
    ts = pd.to_datetime(df["timestamp"], errors="coerce")
    if ts.isna().any():  # keep row count: fill bad timestamps from neighbours (hourly cadence)
        secs = (ts - pd.Timestamp("1970-01-01")) / pd.Timedelta(seconds=1)  # float seconds, NaN for bad
        if secs.notna().any():
            secs = secs.interpolate(limit_direction="both")
        else:
            secs = pd.Series(range(len(df)), dtype=float, index=df.index) * 3600.0
        ts = pd.to_datetime((secs / 3600.0).round() * 3600.0, unit="s")
    df["_ts"] = ts
    for c, (lo, hi) in LIMITS.items():
        v = pd.to_numeric(df[c], errors="coerce") if c in df else pd.Series(np.nan, index=df.index)
        v = v.where((v >= lo - 5) & (v <= hi + 5))
        v = v.interpolate(limit_direction="both").fillna(DEFAULTS[c]).clip(lo, hi)
        df[c] = v
    return df


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    h = df["_ts"].dt.hour
    dow = df["_ts"].dt.dayofweek
    t = df["ambient_temp_c"]
    f = pd.DataFrame({
        "hour": h,
        "day_of_week": dow,
        "is_weekend": (dow >= 5).astype(int),
        "ambient_temp_c": t.round(3),
        "humidity_pct": df["humidity_pct"].round(3),
        "solar_irradiance_wm2": df["solar_irradiance_wm2"].round(3),
        "cooling_degree_c": (t - 24.0).clip(lower=0).round(3),
        "heating_degree_c": (10.0 - t).clip(lower=0).round(3),
        "is_night": (h <= 5).astype(int),
        "is_morning_ramp": (h == 6).astype(int),
        "is_morning_peak": ((h >= 7) & (h <= 9)).astype(int),
        "is_evening_peak": ((h >= 18) & (h <= 22)).astype(int),
        "is_late_evening": (h == 23).astype(int),
        "hour_sin": np.round(np.sin(2 * math.pi * h / 24), 6),
        "hour_cos": np.round(np.cos(2 * math.pi * h / 24), 6),
    })
    return f[FEATURES]


def predict_local(feats: pd.DataFrame) -> np.ndarray:
    y = LOCAL_INTERCEPT + feats.values.astype(float) @ np.array(LOCAL_COEF)
    return np.clip(y, *LOCAL_CLIP)


# ------------------------- QuickML -------------------------
_TOKEN = {"v": None, "exp": 0.0}


def _token():
    if ZOHO_REFRESH_TOKEN and ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET:
        if _TOKEN["v"] and time.time() < _TOKEN["exp"]:
            return _TOKEN["v"]
        data = urllib.parse.urlencode({"refresh_token": ZOHO_REFRESH_TOKEN, "client_id": ZOHO_CLIENT_ID,
                                       "client_secret": ZOHO_CLIENT_SECRET, "grant_type": "refresh_token"}).encode()
        with urllib.request.urlopen(urllib.request.Request(ZOHO_ACCOUNTS_URL + "/oauth/v2/token", data=data), timeout=15) as r:
            j = json.loads(r.read().decode())
        _TOKEN.update(v=j["access_token"], exp=time.time() + int(j.get("expires_in", 3600)) - 120)
        return _TOKEN["v"]
    return QUICKML_ACCESS_TOKEN


def _post(body):
    headers = {"Content-Type": "application/json"}
    tok = _token()
    if tok:
        headers["Authorization"] = "Zoho-oauthtoken " + tok
    if QUICKML_ENDPOINT_KEY:
        headers["X-QUICKML-ENDPOINT-KEY"] = QUICKML_ENDPOINT_KEY
    if CATALYST_ORG:
        headers["CATALYST-ORG"] = CATALYST_ORG
    if QUICKML_ENVIRONMENT:
        headers["Environment"] = QUICKML_ENVIRONMENT
    req = urllib.request.Request(QUICKML_ENDPOINT_URL, data=json.dumps(body).encode(), headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode() or "null")


def _numbers(obj, n):
    """Find n numeric predictions anywhere in a QuickML JSON response."""
    if isinstance(obj, (int, float)) and not isinstance(obj, bool):
        return [float(obj)] if n == 1 else None
    if isinstance(obj, str):
        try:
            return _numbers(json.loads(obj), n)
        except ValueError:
            try:
                return [float(obj)] if n == 1 else None
            except ValueError:
                return None
    if isinstance(obj, list):
        if len(obj) == n:
            vals = [_numbers(v, 1) for v in obj]
            if all(vals):
                return [v[0] for v in vals]
        for v in obj:
            got = _numbers(v, n)
            if got:
                return got
    if isinstance(obj, dict):
        for k in ("predictions", "prediction", "result", "results", "data", "output", "target_demand_kw", "predicted_value", "value"):
            if k in obj:
                got = _numbers(obj[k], n)
                if got:
                    return got
        for v in obj.values():
            got = _numbers(v, n)
            if got:
                return got
    return None


def predict_quickml(feats: pd.DataFrame) -> np.ndarray:
    records = json.loads(feats.to_json(orient="records"))
    n = len(records)
    for body in ({"data": records}, records):  # batch call
        try:
            got = _numbers(_post(body), n)
            if got:
                return np.array(got, dtype=float)
        except Exception as e:  # noqa: BLE001
            _log(f"QuickML batch attempt failed: {e}")
    out = []
    for rec in records:  # row-by-row call
        val, last = None, None
        for body in ({"data": rec}, {"data": [rec]}, rec):
            try:
                got = _numbers(_post(body), 1)
                if got:
                    val = got[0]
                    break
            except Exception as e:  # noqa: BLE001
                last = e
        if val is None:
            raise RuntimeError(f"QuickML returned no prediction ({last})")
        out.append(val)
    return np.array(out, dtype=float)


def predict(input_df: pd.DataFrame):
    """Parameters:
        input_df (pandas.DataFrame): columns ['timestamp', 'ambient_temp_c', 'humidity_pct', 'solar_irradiance_wm2']
    Returns:
        numpy.ndarray: predicted demand (kW), one per input row, in input order.
    """
    if len(input_df) == 0:
        return np.array([], dtype=float)
    feats = build_features(clean_inputs(input_df))
    local = predict_local(feats)
    if QUICKML_ENDPOINT_URL and QUICKML_ENDPOINT_URL != "YOUR_PUBLISHED_QUICKML_ENDPOINT_URL_HERE":
        try:
            preds = predict_quickml(feats)
            if len(preds) == len(input_df) and np.isfinite(preds).all():
                _log(f"QuickML endpoint returned {len(preds)} predictions.")
                return preds
            _log("QuickML output invalid; using embedded fallback model.")
        except Exception as e:  # noqa: BLE001
            _log(f"Warning: QuickML endpoint call failed ({e}); using embedded fallback model.")
    else:
        _log("QuickML endpoint not configured; using embedded fallback model.")
    return np.asarray(local, dtype=float)


def main():
    ap = argparse.ArgumentParser(description="HackSphere 3.0 demand forecast")
    ap.add_argument("--input", default="sample_test_input.csv")
    ap.add_argument("--output", default="predictions.csv")
    a = ap.parse_args()
    df = pd.read_csv(a.input)
    preds = predict(df)
    out = pd.DataFrame({"timestamp": df["timestamp"], "target_demand_kw": np.round(preds, 2)})
    out.to_csv(a.output, index=False)
    print(f"Wrote {len(out)} predictions to {a.output}")
    print(out.head().to_string(index=False))


if __name__ == "__main__":
    main()
