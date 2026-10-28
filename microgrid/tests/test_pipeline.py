import os, sys
ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, os.path.join(ROOT, "appsail")); sys.path.insert(0, ROOT)
import numpy as np, pandas as pd


def test_cleaning_repairs():
    from microgrid.cleaning import clean
    rows, rep = clean([
        {"timestamp": "2015-06-16 15:00", "ambient_temp_c": "", "humidity_pct": "120", "solar_irradiance_wm2": "-5"},
        {"timestamp": "garbage"},
        {"timestamp": "2015-06-16 18:00:00", "ambient_temp_c": "31", "humidity_pct": "50", "solar_irradiance_wm2": "0"},
        {"timestamp": "2015-06-16 18:00:00", "ambient_temp_c": "99", "humidity_pct": "50", "solar_irradiance_wm2": "0"},
    ])
    assert rep["dropped_bad_timestamp"] == 1 and rep["duplicates_removed"] == 1 and rep["gaps_filled"] == 2
    assert len(rows) == 4 and all(r["humidity_pct"] <= 100 and r["solar_irradiance_wm2"] >= 0 for r in rows)


def test_predict_contract_matches_app_model():
    from predict import predict
    from microgrid.forecast import predict_local
    from microgrid.cleaning import clean
    df = pd.read_csv(os.path.join(ROOT, "sample_test_input.csv"))
    a = predict(df)
    assert len(a) == len(df) and np.isfinite(a).all()
    rows, _ = clean(df.to_dict("records"))
    assert np.abs(a - np.array(predict_local(rows))).max() < 1e-6
