"""Transition controller rule tests (HackSphere 3.0 §6). Run: python -m pytest tests -q"""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "appsail"))
from microgrid.controller import grid_mode, is_overload, evaluate, RENEWABLE, GRID


def test_threshold_and_window():
    assert grid_mode(160.0, 12) == GRID          # exactly 160 is NOT > 160
    assert grid_mode(160.01, 12) == RENEWABLE
    assert grid_mode(50, 17) == GRID
    for h in range(18, 23):                     # 18..22 inclusive
        assert grid_mode(50, h) == RENEWABLE
    assert grid_mode(50, 23) == GRID
    assert grid_mode(300, 3) == RENEWABLE


def test_overload_independent_of_mode():
    assert is_overload(200.0) and not is_overload(199.99)
    assert grid_mode(250, 2) == RENEWABLE and is_overload(250)


def test_evaluate_signals_and_soc():
    rows = [{"timestamp": "2024-01-01 %02d:00:00" % h, "ambient_temp_c": 25, "humidity_pct": 60,
             "solar_irradiance_wm2": 0 if h < 6 or h > 18 else 400} for h in range(24)]
    preds = [100] * 7 + [210] * 3 + [150] * 8 + [190] * 5 + [120]
    r = evaluate(rows, preds)
    modes = [h["grid_mode"] for h in r["hours"]]
    assert modes[:7] == [GRID] * 7 and modes[7:10] == [RENEWABLE] * 3
    assert modes[10:18] == [GRID] * 8 and modes[18:23] == [RENEWABLE] * 5 and modes[23] == GRID
    assert [s["signal"] for s in r["signals"]] == ["SWITCH_TO_MAIN_GRID", "SWITCH_TO_BATTERY", "SWITCH_TO_MAIN_GRID", "SWITCH_TO_BATTERY", "SWITCH_TO_MAIN_GRID"]
    assert r["summary"]["overload_hours"] == 3
    assert all(0 <= h["soc_pct"] <= 100 for h in r["hours"])
    assert r["hours"][9]["soc_pct"] < r["hours"][6]["soc_pct"]   # discharges on battery
