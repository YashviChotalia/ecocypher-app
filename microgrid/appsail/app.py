"""EcoCypher — HackSphere 3.0 microgrid backend for Zoho Catalyst AppSail.

Serves the built EcoCypher web app (static/, created by ../build_catalyst.sh) and the /api/* endpoints.

Zero third-party dependencies (Python standard library only), so AppSail deploys it as-is.
Listens on X_ZOHO_CATALYST_LISTEN_PORT (set by AppSail), else PORT, else 9000.
"""
import csv
import json
import mimetypes
import os
import sys
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from microgrid import cleaning, controller, forecast, store  # noqa: E402

STATIC = os.path.join(HERE, "static")
SAMPLE = os.path.join(HERE, "data", "sample_test_input.csv")
MAX_BODY = 5 * 1024 * 1024
WINDOW = 24
STARTED = time.time()
# The Catalyst deployment is the HackSphere submission: open straight on the Grid (microgrid) screen.
OPEN_ON_GRID = b"<script>if(!location.hash)history.replaceState(null,'','#/grid')</script>"
mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("text/javascript", ".js")


def load_sample():
    with open(SAMPLE, newline="") as f:
        return list(csv.DictReader(f))


def run_pipeline(payload, headers=None):
    csv_text = payload.get("csv")
    if csv_text:
        raw = cleaning.rows_from_csv(csv_text)
    else:
        raw = payload.get("rows") or []
    if not raw:
        raise ValueError("Send telemetry rows (form) or a CSV file")
    rows, report = cleaning.clean(raw)
    if not rows:
        raise ValueError("No valid rows after cleaning: check timestamps")
    start = payload.get("window_start")
    i0 = 0
    if start:
        for i, r in enumerate(rows):
            if r["timestamp"] >= str(start).replace("T", " ")[:19]:
                i0 = i
                break
    window = rows[i0:i0 + WINDOW]
    report["window_rows"] = len(window)
    if len(window) < WINDOW:
        report["notes"].append("Forecast window has %d hourly rows (24 recommended)." % len(window))
    preds, source, info = forecast.forecast(window)
    result = controller.evaluate(window, preds, payload.get("battery"))
    result["source"] = source
    result["model_info"] = dict(info, local_model_holdout_rmse_kw=round(forecast.LOCAL["holdout_rmse_kw"], 2))
    result["cleaning"] = report
    result["available_starts"] = [r["timestamp"] for r in rows[:: max(1, len(rows) // 60)]][:60] if len(rows) > WINDOW else []
    result["total_clean_rows"] = len(rows)
    result["run"] = store.save_run(result, headers, csv_text, payload.get("filename"))
    return result


class Handler(BaseHTTPRequestHandler):
    server_version = "EcoCypherMicrogrid/1.0"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))

    def _send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-store" if ctype == "application/json" else "public, max-age=300")
        self.end_headers()
        self.wfile.write(data)

    def do_HEAD(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()

    def do_OPTIONS(self):
        self._send(204, b"", "text/plain")

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/health":
            return self._send(200, {"status": "ok", "uptime_s": int(time.time() - STARTED),
                                    "quickml_configured": forecast.quickml_enabled(),
                                    "local_model_rmse_kw": round(forecast.LOCAL["holdout_rmse_kw"], 2)})
        if path == "/api/sample":
            rows = load_sample()
            return self._send(200, {"rows": rows[:WINDOW], "total": len(rows)})
        if path == "/api/sample.csv":
            with open(SAMPLE, "rb") as f:
                return self._send(200, f.read(), "text/csv")
        if path == "/api/runs":
            return self._send(200, {"runs": store.recent_runs()})
        if path == "/api/rules":
            return self._send(200, {"demand_threshold_kw": controller.DEMAND_THRESHOLD_KW, "overload_kw": controller.OVERLOAD_KW,
                                    "peak_window": [controller.PEAK_START, controller.PEAK_END], "battery": controller.DEFAULT_BATTERY})
        if path in ("/", ""):
            path = "/index.html"
        fp = os.path.normpath(os.path.join(STATIC, path.lstrip("/")))
        if not fp.startswith(STATIC) or not os.path.isfile(fp):
            fp = os.path.join(STATIC, "index.html")
        if not os.path.isfile(fp):
            return self._send(503, b"Web app not bundled: run microgrid/build_catalyst.sh before deploying.", "text/plain; charset=utf-8")
        with open(fp, "rb") as f:
            body = f.read()
        if fp.endswith("index.html"):
            body = body.replace(b"<head>", b"<head>" + OPEN_ON_GRID, 1)
        ctype = mimetypes.guess_type(fp)[0] or "application/octet-stream"
        return self._send(200, body, ctype + ("; charset=utf-8" if ctype.startswith("text") or ctype.endswith("javascript") else ""))

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n > MAX_BODY:
                return self._send(413, {"error": "Payload too large (max 5 MB)"})
            payload = json.loads(self.rfile.read(n).decode("utf-8") or "{}")
            if path == "/api/forecast":
                return self._send(200, run_pipeline(payload, self.headers))
            if path == "/api/predict":  # raw contract: any number of rows -> predictions
                raw = cleaning.rows_from_csv(payload["csv"]) if payload.get("csv") else payload.get("rows", [])
                rows, report = cleaning.clean(raw)
                preds, source, info = forecast.forecast(rows)
                return self._send(200, {"source": source, "info": info, "cleaning": report,
                                        "predictions": [{"timestamp": r["timestamp"], "target_demand_kw": p} for r, p in zip(rows, preds)]})
            if path == "/api/control":  # evaluate rules on externally supplied predictions
                items = payload.get("items") or []
                rows = [{"timestamp": it["timestamp"], "ambient_temp_c": float(it.get("ambient_temp_c", 25)),
                         "humidity_pct": float(it.get("humidity_pct", 60)), "solar_irradiance_wm2": float(it.get("solar_irradiance_wm2", 0))} for it in items]
                return self._send(200, controller.evaluate(rows, [float(it["predicted_kw"]) for it in items], payload.get("battery")))
            return self._send(404, {"error": "Unknown endpoint"})
        except ValueError as e:
            return self._send(400, {"error": str(e)})
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            return self._send(500, {"error": "Server error: %s" % e})


def main():
    port = int(os.getenv("X_ZOHO_CATALYST_LISTEN_PORT") or os.getenv("PORT") or 9000)
    srv = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print("EcoCypher Microgrid listening on :%d (QuickML configured: %s)" % (port, forecast.quickml_enabled()), flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
