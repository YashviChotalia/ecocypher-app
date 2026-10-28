"""Demand forecasting: QuickML published endpoint first, local linear model as fallback."""
import json
import os
import time
import urllib.parse
import urllib.request

from .features import QUICKML_FEATURES, engineer, local_vector, parse_ts

_HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(_HERE, "local_model.json")) as _f:
    LOCAL = json.load(_f)

_token_cache = {"token": None, "exp": 0}


def quickml_config():
    return {
        "url": os.getenv("QUICKML_ENDPOINT_URL", "").strip(),
        "key": os.getenv("QUICKML_ENDPOINT_KEY", "").strip(),
        "org": (os.getenv("QUICKML_ORG_ID") or os.getenv("CATALYST_ORG", "")).strip(),
        "env": os.getenv("QUICKML_ENVIRONMENT", "Development").strip(),
        "token": os.getenv("QUICKML_ACCESS_TOKEN", "").strip(),
        "refresh": os.getenv("ZOHO_REFRESH_TOKEN", "").strip(),
        "client_id": os.getenv("ZOHO_CLIENT_ID", "").strip(),
        "client_secret": os.getenv("ZOHO_CLIENT_SECRET", "").strip(),
        "accounts": os.getenv("ZOHO_ACCOUNTS_URL", "https://accounts.zoho.in").strip().rstrip("/"),
    }


def quickml_enabled():
    c = quickml_config()
    return bool(c["url"] and (c["token"] or c["refresh"]))


def _access_token(c):
    if c["refresh"] and c["client_id"] and c["client_secret"]:
        if _token_cache["token"] and time.time() < _token_cache["exp"]:
            return _token_cache["token"]
        data = urllib.parse.urlencode({
            "refresh_token": c["refresh"], "client_id": c["client_id"],
            "client_secret": c["client_secret"], "grant_type": "refresh_token"}).encode()
        with urllib.request.urlopen(urllib.request.Request(c["accounts"] + "/oauth/v2/token", data=data), timeout=10) as r:
            j = json.loads(r.read().decode())
        _token_cache.update(token=j["access_token"], exp=time.time() + int(j.get("expires_in", 3600)) - 120)
        return _token_cache["token"]
    return c["token"]


def _extract_numbers(obj, n):
    """Find a list of n predictions anywhere in a QuickML JSON response."""
    keys = ("predictions", "prediction", "result", "results", "data", "output", "target_demand_kw", "predicted_value", "value")
    if isinstance(obj, (int, float)) and n == 1:
        return [float(obj)]
    if isinstance(obj, str):
        try:
            return _extract_numbers(json.loads(obj), n)
        except ValueError:
            try:
                return [float(obj)] if n == 1 else None
            except ValueError:
                return None
    if isinstance(obj, list):
        if len(obj) == n and all(isinstance(v, (int, float)) or (isinstance(v, str) and _isnum(v)) for v in obj):
            return [float(v) for v in obj]
        if len(obj) == n and all(isinstance(v, dict) for v in obj):
            vals = [_extract_numbers(v, 1) for v in obj]
            if all(v for v in vals):
                return [v[0] for v in vals]
        for v in obj:
            got = _extract_numbers(v, n)
            if got:
                return got
    if isinstance(obj, dict):
        for k in keys:
            if k in obj:
                got = _extract_numbers(obj[k], n)
                if got:
                    return got
        for v in obj.values():
            got = _extract_numbers(v, n)
            if got:
                return got
    return None


def _isnum(s):
    try:
        float(s)
        return True
    except ValueError:
        return False


def _post(c, body):
    headers = {"Content-Type": "application/json", "Authorization": "Zoho-oauthtoken " + _access_token(c)}
    if c["key"]:
        headers["X-QUICKML-ENDPOINT-KEY"] = c["key"]
    if c["org"]:
        headers["CATALYST-ORG"] = c["org"]
    if c["env"]:
        headers["Environment"] = c["env"]
    req = urllib.request.Request(c["url"], data=json.dumps(body).encode(), headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode() or "null")


def predict_quickml(feature_rows):
    """feature_rows: list of dicts with QUICKML_FEATURES. Tries batch then per-row payloads."""
    c = quickml_config()
    n = len(feature_rows)
    records = [{k: fr[k] for k in QUICKML_FEATURES} for fr in feature_rows]
    errors = []
    for body in ({"data": records}, records):
        try:
            got = _extract_numbers(_post(c, body), n)
            if got:
                return got
            errors.append("batch response had no %d predictions" % n)
        except Exception as e:  # noqa: BLE001
            errors.append("batch: %s" % e)
    out = []
    for rec in records:  # one row per call
        last = None
        for body in ({"data": rec}, {"data": [rec]}, rec):
            try:
                got = _extract_numbers(_post(c, body), 1)
                if got:
                    out.append(got[0])
                    break
            except Exception as e:  # noqa: BLE001
                last = e
        else:
            raise RuntimeError("QuickML call failed: %s | %s" % ("; ".join(errors), last))
    return out


def predict_local(rows):
    lo, hi = LOCAL["clip"]
    preds = []
    for r in rows:
        v = local_vector(parse_ts(r["timestamp"]), r["ambient_temp_c"], r["humidity_pct"], r["solar_irradiance_wm2"])
        y = LOCAL["intercept"] + sum(a * b for a, b in zip(LOCAL["coef"], v))
        preds.append(min(hi, max(lo, y)))
    return preds


def forecast(rows):
    """rows: cleaned rows. Returns (predictions_kw, source, info)."""
    feats = [engineer(parse_ts(r["timestamp"]), r["ambient_temp_c"], r["humidity_pct"], r["solar_irradiance_wm2"]) for r in rows]
    if quickml_enabled():
        try:
            t0 = time.time()
            p = predict_quickml(feats)
            return [round(x, 2) for x in p], "quickml", {"latency_ms": int((time.time() - t0) * 1000)}
        except Exception as e:  # noqa: BLE001
            return [round(x, 2) for x in predict_local(rows)], "local-fallback", {"quickml_error": str(e)[:400]}
    return [round(x, 2) for x in predict_local(rows)], "local", {"note": "QuickML endpoint not configured"}
