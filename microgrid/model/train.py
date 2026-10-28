"""Train the local fallback model and build the QuickML training CSV.

    python model/train.py

Outputs:
  appsail/microgrid/local_model.json   ridge coefficients used by the app + predict.py fallback
  quickml/train_quickml.csv            engineered features + target_demand_kw -> upload to QuickML
  quickml/holdout_report.json          time-ordered holdout RMSE of candidate models
"""
import json, os, sys
import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_squared_error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "appsail"))
from microgrid.features import engineer, local_vector, parse_ts, QUICKML_FEATURES  # noqa: E402

df = pd.read_csv(os.path.join(ROOT, "train_telemetry.csv"))
ts = [parse_ts(t) for t in df.timestamp]
X = np.array([local_vector(t, a, b, c) for t, a, b, c in zip(ts, df.ambient_temp_c, df.humidity_pct, df.solar_irradiance_wm2)])
y = df.target_demand_kw.values

# time-ordered holdout: train on first 80%, score on last 20%
n = int(len(df) * 0.8)
report = {}
m = LinearRegression().fit(X[:n], y[:n])
report["linear_regression_on_quickml_features"] = float(mean_squared_error(y[n:], m.predict(X[n:])) ** 0.5)

eng = pd.DataFrame([engineer(t, a, b, c) for t, a, b, c in zip(ts, df.ambient_temp_c, df.humidity_pct, df.solar_irradiance_wm2)])
try:
    import lightgbm as lgb
    g = lgb.LGBMRegressor(n_estimators=500, learning_rate=0.03, num_leaves=15, verbose=-1).fit(eng[QUICKML_FEATURES].iloc[:n], y[:n])
    report["lightgbm_on_quickml_features"] = float(mean_squared_error(y[n:], g.predict(eng[QUICKML_FEATURES].iloc[n:])) ** 0.5)
except ImportError:
    pass
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
rf = RandomForestRegressor(n_estimators=300, min_samples_leaf=5, n_jobs=-1, random_state=0).fit(eng[QUICKML_FEATURES].iloc[:n], y[:n])
report["random_forest_on_quickml_features"] = float(mean_squared_error(y[n:], rf.predict(eng[QUICKML_FEATURES].iloc[n:])) ** 0.5)
gb = GradientBoostingRegressor(n_estimators=400, max_depth=3, learning_rate=0.05, random_state=0).fit(eng[QUICKML_FEATURES].iloc[:n], y[:n])
report["gradient_boosting_on_quickml_features"] = float(mean_squared_error(y[n:], gb.predict(eng[QUICKML_FEATURES].iloc[n:])) ** 0.5)
from sklearn.linear_model import LinearRegression
print(json.dumps(report, indent=2))

# final local model on all data
final = LinearRegression().fit(X, y)
resid = y - final.predict(X)
model = {
    "type": "linear_regression",
    "features": QUICKML_FEATURES,
    "intercept": float(final.intercept_),
    "coef": [float(c) for c in final.coef_],
    "train_rows": int(len(df)),
    "holdout_rmse_kw": report["linear_regression_on_quickml_features"],
    "residual_std_kw": float(resid.std()),
    "clip": [float(y.min()) * 0.5, float(y.max()) * 1.5],
}
with open(os.path.join(ROOT, "appsail", "microgrid", "local_model.json"), "w") as f:
    json.dump(model, f, indent=1)

os.makedirs(os.path.join(ROOT, "quickml"), exist_ok=True)
out = eng[QUICKML_FEATURES].copy()
out.insert(0, "timestamp", df.timestamp)
out["target_demand_kw"] = y
out.to_csv(os.path.join(ROOT, "quickml", "train_quickml.csv"), index=False)
with open(os.path.join(ROOT, "quickml", "holdout_report.json"), "w") as f:
    json.dump(report, f, indent=2)
print("wrote local_model.json and quickml/train_quickml.csv", out.shape)
