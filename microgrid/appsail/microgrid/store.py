"""Persistence: Catalyst Data Store + Stratus when the Catalyst SDK is available, local JSON otherwise.

Data Store table expected (create in Catalyst console > Data Store):
  forecast_runs: run_id (text), created_at (text), source (text), window_start (text),
                 peak_kw (double), overload_hours (int), transitions (int), final_soc_pct (double), payload (text)
Stratus bucket (optional): name in STRATUS_BUCKET env var; uploaded CSVs are stored under telemetry/<run_id>.csv
"""
import json
import os
import threading
import time
import uuid

_LOCK = threading.Lock()
_LOCAL_FILE = os.getenv("LOCAL_STORE_FILE", os.path.join("/tmp", "microgrid_runs.json"))
_MEM = []
TABLE = os.getenv("DATASTORE_TABLE", "forecast_runs")
BUCKET = os.getenv("STRATUS_BUCKET", "").strip()


def _catalyst(headers):
    try:
        import zcatalyst_sdk  # type: ignore
    except ImportError:
        return None
    try:
        return zcatalyst_sdk.initialize(req=headers)
    except Exception:  # noqa: BLE001
        try:
            return zcatalyst_sdk.initialize()
        except Exception:  # noqa: BLE001
            return None


def _load_local():
    global _MEM
    if _MEM:
        return _MEM
    try:
        with open(_LOCAL_FILE) as f:
            _MEM = json.load(f)
    except Exception:  # noqa: BLE001
        _MEM = []
    return _MEM


def save_run(result, headers=None, csv_text=None, filename=None):
    run_id = uuid.uuid4().hex[:12]
    s = result["summary"]
    rec = {
        "run_id": run_id,
        "created_at": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime()),
        "source": result.get("source"),
        "window_start": result["hours"][0]["timestamp"] if result["hours"] else None,
        "peak_kw": s["peak_kw"], "overload_hours": s["overload_hours"], "transitions": s["transitions"],
        "final_soc_pct": s["final_soc_pct"], "filename": filename,
    }
    storage = {"datastore": False, "stratus": False}
    app = _catalyst(headers) if headers is not None else None
    if app is not None:
        try:
            row = dict(rec)
            row.pop("filename", None)
            row["payload"] = json.dumps({"signals": result["signals"], "alerts": result["alerts"]})[:9000]
            app.datastore().table(TABLE).insert_row(row)
            storage["datastore"] = True
        except Exception as e:  # noqa: BLE001
            storage["datastore_error"] = str(e)[:200]
        if csv_text and BUCKET:
            try:
                app.stratus().bucket(BUCKET).put_object("telemetry/%s.csv" % run_id, csv_text.encode())
                storage["stratus"] = True
            except Exception as e:  # noqa: BLE001
                storage["stratus_error"] = str(e)[:200]
    with _LOCK:
        runs = _load_local()
        runs.insert(0, rec)
        del runs[50:]
        try:
            with open(_LOCAL_FILE, "w") as f:
                json.dump(runs, f)
        except Exception:  # noqa: BLE001
            pass
    rec["storage"] = storage
    return rec


def recent_runs(limit=20):
    with _LOCK:
        return list(_load_local()[:limit])
