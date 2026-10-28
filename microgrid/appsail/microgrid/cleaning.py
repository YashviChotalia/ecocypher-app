"""Telemetry ingestion: parse CSV / form rows, validate, repair, and report every fix."""
import csv
import io
from datetime import timedelta

from .features import parse_ts

FIELDS = ("ambient_temp_c", "humidity_pct", "solar_irradiance_wm2")
ALIASES = {
    "timestamp": ("timestamp", "time", "datetime", "date_time", "ts"),
    "ambient_temp_c": ("ambient_temp_c", "temp", "temperature", "ambient_temp", "temp_c", "outdoor_temp_c"),
    "humidity_pct": ("humidity_pct", "humidity", "rh", "relative_humidity"),
    "solar_irradiance_wm2": ("solar_irradiance_wm2", "solar", "irradiance", "solar_irradiance", "ghi", "solar_radiation_w_m2"),
}
LIMITS = {"ambient_temp_c": (-30.0, 60.0), "humidity_pct": (0.0, 100.0), "solar_irradiance_wm2": (0.0, 1400.0)}
# training-set fallbacks when a value cannot be interpolated
DEFAULTS = {"ambient_temp_c": 18.5, "humidity_pct": 70.7}
SOLAR_BY_HOUR = [0, 0, 0, 0, 0, 13, 70, 156, 221, 260, 288, 294, 281, 241, 186, 115, 51, 15, 0, 0, 0, 0, 0, 0]


def _num(v):
    if v is None:
        return None
    s = str(v).strip().replace(",", ".")
    if s == "" or s.lower() in ("nan", "na", "null", "none", "-", "?"):
        return None
    try:
        x = float(s)
    except ValueError:
        return None
    return x if x == x and abs(x) != float("inf") else None


def _map_header(header):
    norm = {h.strip().lower().replace(" ", "_"): h for h in header}
    out = {}
    for key, names in ALIASES.items():
        for n in names:
            if n in norm:
                out[key] = norm[n]
                break
    return out


def rows_from_csv(text):
    text = text.lstrip("﻿")
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise ValueError("CSV has no header row")
    cols = _map_header(reader.fieldnames)
    if "timestamp" not in cols:
        raise ValueError("CSV needs a 'timestamp' column")
    rows = []
    for r in reader:
        rows.append({k: r.get(cols[k]) if k in cols else None for k in ("timestamp",) + FIELDS})
    return rows


def clean(rows):
    """Validate + repair raw rows. Returns (clean_rows, report)."""
    report = {"input_rows": len(rows), "dropped_bad_timestamp": 0, "duplicates_removed": 0,
              "out_of_range_fixed": 0, "missing_filled": 0, "gaps_filled": 0, "notes": []}
    parsed = []
    for r in rows:
        ts = parse_ts(r.get("timestamp"))
        if ts is None:
            report["dropped_bad_timestamp"] += 1
            continue
        ts = ts.replace(minute=0, second=0)
        rec = {"ts": ts}
        for f in FIELDS:
            v = _num(r.get(f))
            lo, hi = LIMITS[f]
            if v is not None and not (lo <= v <= hi):
                if f == "solar_irradiance_wm2" and v < 0:
                    v = 0.0
                elif f == "humidity_pct" and 100 < v <= 105:
                    v = 100.0
                else:
                    v = None
                report["out_of_range_fixed"] += 1
            rec[f] = v
        parsed.append(rec)

    parsed.sort(key=lambda x: x["ts"])
    uniq = []
    for rec in parsed:
        if uniq and uniq[-1]["ts"] == rec["ts"]:
            report["duplicates_removed"] += 1
            for f in FIELDS:  # keep first non-missing value
                if uniq[-1][f] is None:
                    uniq[-1][f] = rec[f]
            continue
        uniq.append(rec)

    # fill missing hours inside the window (small gaps only, up to 6h)
    filled = []
    for rec in uniq:
        if filled:
            gap = int((rec["ts"] - filled[-1]["ts"]).total_seconds() // 3600)
            if 1 < gap <= 6:
                for k in range(1, gap):
                    filled.append({"ts": filled[-1]["ts"] + timedelta(hours=1), **{f: None for f in FIELDS}, "synthetic": True})
                    report["gaps_filled"] += 1
        filled.append(rec)

    # interpolate missing values linearly, then edge-fill, then defaults
    for f in FIELDS:
        idx = [i for i, r in enumerate(filled) if r[f] is not None]
        for i, r in enumerate(filled):
            if r[f] is not None:
                continue
            report["missing_filled"] += 1
            prev = max((j for j in idx if j < i), default=None)
            nxt = min((j for j in idx if j > i), default=None)
            if f == "solar_irradiance_wm2" and (prev is None or nxt is None or nxt - prev > 3):
                r[f] = float(SOLAR_BY_HOUR[r["ts"].hour])
            elif prev is not None and nxt is not None:
                w = (i - prev) / (nxt - prev)
                r[f] = filled[prev][f] + w * (filled[nxt][f] - filled[prev][f])
            elif prev is not None or nxt is not None:
                r[f] = filled[prev if prev is not None else nxt][f]
            else:
                r[f] = float(SOLAR_BY_HOUR[r["ts"].hour]) if f == "solar_irradiance_wm2" else DEFAULTS[f]
            r["imputed"] = True

    out = [{
        "timestamp": r["ts"].strftime("%Y-%m-%d %H:%M:%S"),
        "ambient_temp_c": round(r["ambient_temp_c"], 2),
        "humidity_pct": round(r["humidity_pct"], 2),
        "solar_irradiance_wm2": round(r["solar_irradiance_wm2"], 1),
        "imputed": bool(r.get("imputed") or r.get("synthetic")),
    } for r in filled]
    report["clean_rows"] = len(out)
    if not out:
        report["notes"].append("No valid rows after cleaning.")
    return out, report
