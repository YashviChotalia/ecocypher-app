"""Transition controller (HackSphere 3.0 §6) + battery state-of-charge simulation.

Rules per forecast hour (18:00-22:00 inclusive):
  RENEWABLE_STORAGE  if demand > 160 kW OR 18 <= hour <= 22
  MAIN_GRID          otherwise (demand <= 160 kW AND outside 18-22)
  CRITICAL_OVERLOAD  alert if demand >= 200 kW (independent of mode)
"""
from .features import parse_ts

DEMAND_THRESHOLD_KW = 160.0
OVERLOAD_KW = 200.0
PEAK_START, PEAK_END = 18, 22

RENEWABLE = "RENEWABLE_STORAGE"
GRID = "MAIN_GRID"

DEFAULT_BATTERY = {
    "capacity_kwh": 2000.0,     # usable battery energy
    "initial_soc_pct": 80.0,
    "min_soc_pct": 10.0,        # reserve floor
    "max_charge_kw": 150.0,
    "max_discharge_kw": 320.0,
    "pv_capacity_kw": 400.0,    # PV array rating at 1000 W/m2
    "grid_charge_kw": 40.0,     # trickle charge from grid during off-peak main-grid hours
    "efficiency": 0.95,
}


def grid_mode(demand_kw, hour):
    if demand_kw > DEMAND_THRESHOLD_KW or PEAK_START <= hour <= PEAK_END:
        return RENEWABLE
    return GRID


def is_overload(demand_kw):
    return demand_kw >= OVERLOAD_KW


def reason(demand_kw, hour):
    parts = []
    if demand_kw > DEMAND_THRESHOLD_KW:
        parts.append("demand %.1f kW > %.0f kW" % (demand_kw, DEMAND_THRESHOLD_KW))
    if PEAK_START <= hour <= PEAK_END:
        parts.append("evening peak window %02d:00-%02d:00" % (PEAK_START, PEAK_END))
    if not parts:
        parts.append("demand %.1f kW <= %.0f kW and outside 18-22h" % (demand_kw, DEMAND_THRESHOLD_KW))
    return "; ".join(parts)


def evaluate(rows, preds, battery=None):
    """Apply rules hour by hour, simulate battery SoC, emit dispatch signals + alerts."""
    b = dict(DEFAULT_BATTERY)
    b.update({k: float(v) for k, v in (battery or {}).items() if k in DEFAULT_BATTERY and v not in (None, "")})
    cap = b["capacity_kwh"]
    energy = cap * b["initial_soc_pct"] / 100.0
    floor = cap * b["min_soc_pct"] / 100.0
    eff = b["efficiency"]

    hours, signals, alerts = [], [], []
    prev_mode = None
    for r, p in zip(rows, preds):
        ts = parse_ts(r["timestamp"])
        h = ts.hour
        mode = grid_mode(p, h)
        overload = is_overload(p)
        pv_kw = max(0.0, r["solar_irradiance_wm2"]) / 1000.0 * b["pv_capacity_kw"]
        soc_start = energy / cap * 100.0
        battery_kw = 0.0   # + discharge to load, - charging
        grid_kw = 0.0
        shortfall = 0.0
        if mode == RENEWABLE:
            net = max(0.0, p - pv_kw)             # load not covered by solar
            surplus = max(0.0, pv_kw - p)
            available = max(0.0, (energy - floor)) * eff
            discharge = min(net, b["max_discharge_kw"], available)
            energy -= discharge / eff
            battery_kw = discharge
            shortfall = net - discharge           # backup import if battery can't cover
            grid_kw = shortfall
            if surplus > 0:
                ch = min(surplus, b["max_charge_kw"], (cap - energy) / eff)
                energy += ch * eff
                battery_kw -= ch
        else:
            grid_kw = max(0.0, p - pv_kw)
            charge_src = max(0.0, pv_kw - p) + b["grid_charge_kw"]
            ch = min(charge_src, b["max_charge_kw"], max(0.0, cap - energy) / eff)
            energy += ch * eff
            battery_kw = -ch
            grid_kw += max(0.0, ch - max(0.0, pv_kw - p))
        soc_end = energy / cap * 100.0

        if mode != prev_mode:
            signals.append({
                "timestamp": r["timestamp"], "hour": h,
                "signal": "SWITCH_TO_BATTERY" if mode == RENEWABLE else "SWITCH_TO_MAIN_GRID",
                "from": prev_mode or "INIT", "to": mode, "reason": reason(p, h),
            })
        if overload:
            alerts.append({"timestamp": r["timestamp"], "level": "CRITICAL", "type": "CRITICAL_OVERLOAD",
                           "message": "Predicted demand %.1f kW >= %.0f kW" % (p, OVERLOAD_KW)})
        if mode == RENEWABLE and shortfall > 0.5:
            alerts.append({"timestamp": r["timestamp"], "level": "WARNING", "type": "BATTERY_RESERVE",
                           "message": "Battery at reserve floor; %.1f kW backup import needed" % shortfall})
        prev_mode = mode
        hours.append({
            "timestamp": r["timestamp"], "hour": h, "predicted_kw": round(p, 2),
            "grid_mode": mode, "overload_alert": overload,
            "dispatch_signal": "BATTERY" if mode == RENEWABLE else "GRID",
            "reason": reason(p, h),
            "pv_kw": round(pv_kw, 1), "battery_kw": round(battery_kw, 1), "grid_import_kw": round(grid_kw, 1),
            "soc_start_pct": round(soc_start, 1), "soc_pct": round(soc_end, 1),
            "ambient_temp_c": r["ambient_temp_c"], "humidity_pct": r["humidity_pct"],
            "solar_irradiance_wm2": r["solar_irradiance_wm2"], "imputed": r.get("imputed", False),
        })

    n = len(hours) or 1
    summary = {
        "hours": len(hours),
        "peak_kw": max((x["predicted_kw"] for x in hours), default=0),
        "peak_at": max(hours, key=lambda x: x["predicted_kw"])["timestamp"] if hours else None,
        "avg_kw": round(sum(x["predicted_kw"] for x in hours) / n, 2),
        "energy_kwh": round(sum(x["predicted_kw"] for x in hours), 1),
        "renewable_hours": sum(1 for x in hours if x["grid_mode"] == RENEWABLE),
        "grid_hours": sum(1 for x in hours if x["grid_mode"] == GRID),
        "overload_hours": sum(1 for x in hours if x["overload_alert"]),
        "transitions": len(signals),
        "final_soc_pct": hours[-1]["soc_pct"] if hours else None,
        "min_soc_pct": min((x["soc_pct"] for x in hours), default=None),
        "current_mode": hours[0]["grid_mode"] if hours else None,
    }
    return {"hours": hours, "signals": signals, "alerts": alerts, "summary": summary, "battery": b,
            "rules": {"demand_threshold_kw": DEMAND_THRESHOLD_KW, "overload_kw": OVERLOAD_KW,
                      "peak_window": "%02d:00-%02d:00 inclusive" % (PEAK_START, PEAK_END)}}
