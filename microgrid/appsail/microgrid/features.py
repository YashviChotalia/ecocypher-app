"""Feature engineering shared by training, QuickML inference and the local fallback model.

Pure Python (no numpy/pandas) so it runs unchanged on Catalyst AppSail with zero dependencies.
The SAME definitions are used to build quickml/train_quickml.csv, so training and inference match.
"""
from datetime import datetime

TS_FORMATS = (
    "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M",
    "%d-%m-%Y %H:%M:%S", "%d-%m-%Y %H:%M", "%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M",
    "%m/%d/%Y %H:%M:%S", "%m/%d/%Y %H:%M", "%Y/%m/%d %H:%M:%S", "%Y/%m/%d %H:%M",
)

COOLING_BASE_C = 24.0   # demand rises ~9.6 kW per °C above this (fitted on train_telemetry.csv)
HEATING_BASE_C = 10.0

# Features sent to QuickML (column order of quickml/train_quickml.csv, minus the target)
QUICKML_FEATURES = [
    "hour", "day_of_week", "is_weekend",
    "ambient_temp_c", "humidity_pct", "solar_irradiance_wm2",
    "cooling_degree_c", "heating_degree_c",
    "is_night", "is_morning_ramp", "is_morning_peak", "is_evening_peak", "is_late_evening",
    "hour_sin", "hour_cos",
]


def parse_ts(value):
    """Parse a timestamp string in any common format; returns datetime or None."""
    if isinstance(value, datetime):
        return value.replace(tzinfo=None, microsecond=0)
    s = str(value or "").strip().replace("Z", "")
    if not s:
        return None
    if "+" in s[10:]:
        s = s[: 10 + s[10:].index("+")]
    for fmt in TS_FORMATS:
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(s).replace(tzinfo=None, microsecond=0)
    except ValueError:
        return None


def engineer(ts, temp, hum, solar):
    """Return the QuickML feature dict for one hourly row."""
    import math
    h = ts.hour
    return {
        "hour": h,
        "day_of_week": ts.weekday(),
        "is_weekend": int(ts.weekday() >= 5),
        "ambient_temp_c": round(float(temp), 3),
        "humidity_pct": round(float(hum), 3),
        "solar_irradiance_wm2": round(float(solar), 3),
        "cooling_degree_c": round(max(0.0, float(temp) - COOLING_BASE_C), 3),
        "heating_degree_c": round(max(0.0, HEATING_BASE_C - float(temp)), 3),
        "is_night": int(h <= 5),
        "is_morning_ramp": int(h == 6),
        "is_morning_peak": int(7 <= h <= 9),
        "is_evening_peak": int(18 <= h <= 22),
        "is_late_evening": int(h == 23),
        "hour_sin": round(math.sin(2 * math.pi * h / 24), 6),
        "hour_cos": round(math.cos(2 * math.pi * h / 24), 6),
    }


# ---- Local fallback model: linear regression on the same QuickML features ----
def local_vector(ts, temp, hum, solar):
    f = engineer(ts, temp, hum, solar)
    return [float(f[k]) for k in QUICKML_FEATURES]
