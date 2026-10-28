# EcoCypher Microgrid (HackSphere 3.0)

Catalyst backend, QuickML training data and scoring script for the **Grid** tab of the EcoCypher app.
Full documentation: see the "HackSphere 3.0: Smart Energy Microgrid" section of the main [README](../README.md).

| Path | Purpose |
| --- | --- |
| `appsail/` | Catalyst AppSail service: serves the built EcoCypher app + `/api/forecast`, `/api/predict`, `/api/control`, `/api/health`, `/api/runs` |
| `quickml/train_quickml.csv` | Upload to QuickML, target `target_demand_kw`, drop `timestamp`, Linear Regression |
| `predict.py`, `test_eval.py` | Evaluation contract; `python test_eval.py` → SUCCESS |
| `model/train.py` | Rebuilds the QuickML CSV, the fallback model and the holdout report |
| `tests/` | Transition-controller and pipeline tests (`python -m pytest tests -q`) |
| `build_catalyst.sh` | Builds the web app into `appsail/static` before `catalyst deploy` |
