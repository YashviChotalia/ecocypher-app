# EcoCypher

**Evidence-based sustainability for companies: the green claims they make, and the energy they run on.**

EcoCypher helps a company's ESG team prove its sustainability claims before publishing them. Its **Grid** module also forecasts the site's
electricity demand and decides, hour by hour, whether the load runs on the main grid or on renewable battery storage.
It is one app for phones, tablets and desktops, and also comes as an installable PWA and an Android APK.

| | |
| --- | --- |
| **Live app (Zoho Catalyst)** | `https://<your-appsail-url>` ← add after `catalyst deploy` |
| **Web (Vercel)** | https://ecocypher-app.vercel.app |
| **Android** | `EcoCypher.apk` (v2.1.1). Works offline. Build steps are in [`android/README.md`](android/README.md) |

---

## Why EcoCypher

- **Claims backed by evidence, not adjectives.** Every green claim is checked against fingerprinted evidence and the company's own
  energy data before it can be published.
- **Forecast first, then act.** The Grid module turns weather telemetry into a 24-hour demand forecast and an hour-by-hour
  power-source plan, with a reason recorded for every switch.
- **Always works.** If the QuickML endpoint can't be reached, the same model runs locally on the same features, and the app always shows
  which one produced the forecast.
- **Built for data that isn't clean.** Uploads in 12 timestamp formats are accepted. Gaps, duplicates and out-of-range readings are
  repaired, and every fix is counted.
- **Explainable by design.** Rule-based claim checks, a linear demand model and transparent switching rules. Nothing is a black box.
- **Tamper-evident records.** Evidence is SHA-256 fingerprinted. Any later change shows as *altered* and stops supporting claims.

---

## HackSphere 3.0: Smart Energy Microgrid & Demand Forecasting

The **Grid** tab (web app and APK) and the [`microgrid/`](microgrid) folder (Catalyst backend, QuickML data, scoring scripts)
implement the brief end to end on Zoho Catalyst.

### Try it in one minute

1. Open the live app and go to **Grid**. The starter-kit test telemetry is already forecast.
2. The top of the screen shows the **power source now** (Battery storage / Main grid), any overload hours ahead, peak and average
   demand, the number of source switches and the battery charge at the end of the window.
3. The **Demand** chart shows 24 hourly predictions against the 160 kW and 200 kW thresholds. The 18:00–22:00 window is shaded,
   red rings mark overload hours, and the strip under the axis shows the source for each hour. **Table** switches the chart to a table.
4. The **Timeline** lists every control signal (`SWITCH_TO_BATTERY`, `SWITCH_TO_MAIN_GRID`) and each `CRITICAL_OVERLOAD` range, with the rule that
   triggered it.
5. Tap **New forecast** and upload `microgrid/sample_test_input.csv` (or any CSV), or type a day into the 24-row form.
   Then choose the start hour and run the forecast.
6. Download the **dispatch plan** or the **predictions** (`timestamp,target_demand_kw`) as CSV.

### How it meets the evaluation criteria

| Criterion (weight) | What we did |
| --- | --- |
| **Model accuracy, 35 %** | Engineered features that match how demand behaves in `train_telemetry.csv` (time-of-day profile + cooling load above 24 °C). A **Linear Regression** QuickML pipeline on them scores **RMSE 8.30 kW** on a time-ordered holdout, close to the ≈ 8.5 kW noise in the data and well ahead of the tree models we compared (11–15 kW). `predict.py` passes `test_eval.py` (**SUCCESS**). |
| **Deployment & functionality, 35 %** | One Catalyst **AppSail** service serves the full web app and the forecasting API. The whole workflow runs from one public URL: ingest → clean → QuickML forecast → controller → dashboard → Data Store / Stratus. |
| **Transition controller, 20 %** | The rules are implemented exactly as specified (table below). Python and TypeScript versions are checked against each other in tests. Each hour gets a mode, a dispatch signal, an overload flag and a written reason. A signal is emitted only when the source changes. |
| **UI & UX, 10 %** | A calm, minimal dashboard: power-source status, demand chart with thresholds, battery state-of-charge chart, alert line, event timeline, hourly plan, CSV export and run history. It works from phone to desktop, in light and dark mode, and offline in the APK. |

### Requirements coverage

| Requirement | Implementation |
| --- | --- |
| 1. Model building | [`microgrid/quickml/train_quickml.csv`](microgrid/quickml) is `train_telemetry.csv` plus engineered features. It is trained and published as a QuickML regression pipeline (target `target_demand_kw`). |
| 2. Ingestion & cleanup | CSV upload or a live 24-row form. Cleaning ([`cleaning.py`](microgrid/appsail/microgrid/cleaning.py), mirrored in [`engine.ts`](src/lib/microgrid/engine.ts)) accepts 12 timestamp formats and column aliases. It drops bad timestamps, merges duplicates, repairs out-of-range values, fills gaps of up to 6 hours, interpolates linearly and uses hour-aware solar defaults. Raw CSVs go to **Stratus** when a bucket is configured. |
| 3. Demand forecasting | `POST /api/forecast` builds the QuickML feature vectors for each row of the 24-hour window and calls the published endpoint (`Zoho-oauthtoken`, `X-QUICKML-ENDPOINT-KEY`, `CATALYST-ORG`). The result is one kW prediction per hour. |
| 4. Smart grid switching | [`controller.py`](microgrid/appsail/microgrid/controller.py) / `engine.ts`: transition rules, a battery state-of-charge simulation, control signals and alerts. |
| 5. Dashboard | The Grid tab served by AppSail. Runs are saved to **Data Store** (`forecast_runs`) when configured. |

### Transition controller

Evaluated for every forecast hour (the 18:00–22:00 window is inclusive):

| Condition | Output |
| --- | --- |
| Demand **> 160 kW** OR hour **18–22** | `RENEWABLE_STORAGE` · signal `SWITCH_TO_BATTERY` when the source changes |
| Otherwise (≤ 160 kW and outside 18–22) | `MAIN_GRID` · signal `SWITCH_TO_MAIN_GRID` when the source changes |
| Demand **≥ 200 kW** | `CRITICAL_OVERLOAD` alert, independent of mode |

**Battery simulation:** defaults are editable under *New forecast → Battery and solar*: 2,000 kWh capacity, 80 % starting charge, 10 % reserve floor,
400 kW PV, 150 kW charge and 320 kW discharge limits, 95 % efficiency.

Solar output covers load first. The battery covers the rest down to the reserve floor. If the battery reaches the reserve during a storage hour,
the rule's decision is kept and a `BATTERY_RESERVE` warning schedules backup import, so the operator sees the shortfall.

### Model

Demand in the training data follows a daily profile (night ≈ 92 kW, morning peak ≈ 180 kW, evening peak ≈ 215 kW) plus a cooling load of
≈ 8.7 kW for every °C above 24 °C. The features describe that directly:

`hour, day_of_week, is_weekend, ambient_temp_c, humidity_pct, solar_irradiance_wm2, cooling_degree_c = max(0, T − 24),
heating_degree_c = max(0, 10 − T), is_night (0–5h), is_morning_ramp (6h), is_morning_peak (7–9h), is_evening_peak (18–22h),
is_late_evening (23h), hour_sin, hour_cos`

| Model on these features (train first 80 %, test last 20 %) | RMSE (kW) |
| --- | --- |
| **Linear Regression** | **8.30** |
| Gradient Boosting | 11.33 |
| Random Forest | 14.24 |
| LightGBM | 15.10 |

The test period (June–July) is hotter than most of the training data. Tree models can't extrapolate beyond the temperatures they saw;
the linear cooling term can. Training, inference, `predict.py` and the in-app model all use the same feature definitions.

### Architecture

```
Browser / Android app ── EcoCypher web app (Grid tab)
        │  POST /api/forecast  (same origin on Catalyst, or the URL saved in Grid → Forecast service)
        ▼
Catalyst AppSail · microgrid/appsail/app.py (Python standard library, no dependencies)
  ├─ cleaning.py     validate + repair telemetry
  ├─ features.py     QuickML feature vectors (same as the training CSV)
  ├─ forecast.py  ─► Catalyst QuickML published endpoint (local fallback, same features)
  ├─ controller.py   transition rules, battery SoC, signals, alerts
  └─ store.py     ─► Catalyst Data Store (forecast_runs) + Stratus (raw CSVs)
```

| Module | Catalyst service |
| --- | --- |
| Telemetry ingestion | AppSail-hosted UI (CSV upload + form) · Stratus for raw files |
| Preprocessing & API | AppSail (Python) |
| Forecasting engine | QuickML published endpoint |
| Transition controller | AppSail |
| Live dashboard & logs | AppSail-hosted UI · Data Store |

API: `GET /api/health`, `/api/rules`, `/api/runs`, `/api/sample`, `/api/sample.csv` ·
`POST /api/forecast` (`{csv}` or `{rows}`, optional `window_start`, `battery`) · `POST /api/predict` (any number of rows) ·
`POST /api/control` (rules applied to your own predictions).

Without a backend (the Vercel site, or the offline APK), the Grid tab runs the same cleaning, model and rules on the device and labels the
forecast *On-device*.

### Setup

**1. Train and publish the model in QuickML**

1. Catalyst console → your project → **QuickML** → *Datasets* → upload `microgrid/quickml/train_quickml.csv`.
2. *Pipelines* → **Create ML pipeline** → Regression, target `target_demand_kw`. Drop `timestamp` and keep every other column.
3. Algorithm **Linear Regression** → run → **Publish**. From *Endpoints*, copy the deployment URL and endpoint key, and note your org id.
   The endpoint takes `POST /quickml/v1/project/{project_id}/endpoints/predict` with `{"data": {feature: value}}` and returns `{"result": [prediction]}`.
   Feature names must match the training columns exactly.

**2. OAuth for the endpoint.** At https://api-console.zoho.in create a **Self Client**, generate a code with scope
`QuickML.deployment.READ`, and exchange it for a refresh token:

```bash
curl -X POST "https://accounts.zoho.in/oauth/v2/token" \
  -d "grant_type=authorization_code&client_id=ID&client_secret=SECRET&code=CODE"
```

**3. Run locally**

```bash
npm install && npm run dev                 # web app, http://localhost:5173
cd microgrid/appsail && python app.py      # API + built app, http://localhost:9000
```

**4. Deploy to Catalyst**

On Windows, one script does it all: it installs the CLI, signs you in, picks the project and deploys.

```powershell
cd microgrid
powershell -ExecutionPolicy Bypass -File .\deploy-catalyst.ps1          # add -Rebuild to rebuild the web app first
```

Or step by step:

```bash
npm install -g zcatalyst-cli
catalyst login
bash microgrid/build_catalyst.sh           # builds the web app into microgrid/appsail/static
cd microgrid && catalyst project:use && catalyst deploy --only appsail:microgrid   # Python 3.12 · "python3 app.py"
```

The deployed app opens on the Grid screen. Make the AppSail URL public (no authentication) for judging. For persistence, create the Data Store table `forecast_runs`
(`run_id, created_at, source, window_start` text · `peak_kw, final_soc_pct` double · `overload_hours, transitions` int · `payload` text)
and a Stratus bucket. Then `pip install zcatalyst-sdk -t microgrid/appsail` before deploying. Without them, runs are kept in a local log.

**5. Environment variables.** Copy [`microgrid/.env.example`](microgrid/.env.example) to `microgrid/.env` (git-ignored) and fill it in.
A CLI deploy replaces AppSail's environment variables with the `env_variables` in `app-config.json`, and values set in the Console are wiped.
So `deploy-catalyst.ps1` merges `.env` into the config just for the deploy and then restores the committed file. Secrets never enter git.

| Variable | Purpose |
| --- | --- |
| `QUICKML_ENDPOINT_URL` | Published endpoint deployment URL |
| `QUICKML_ENDPOINT_KEY` | `X-QUICKML-ENDPOINT-KEY` header |
| `QUICKML_ORG_ID` | Your Catalyst org id, sent as the `CATALYST-ORG` header. User variable names must not contain `CATALYST`, because AppSail reserves them. |
| `QUICKML_ENVIRONMENT` | `Development` (default) or `Production` |
| `ZOHO_CLIENT_ID` · `ZOHO_CLIENT_SECRET` · `ZOHO_REFRESH_TOKEN` | Auto-refreshing OAuth (recommended), or a short-lived `QUICKML_ACCESS_TOKEN` |
| `ZOHO_ACCOUNTS_URL` | `https://accounts.zoho.in` (India data centre) |
| `DATASTORE_TABLE` · `STRATUS_BUCKET` | Optional persistence |
| `VITE_MICROGRID_API_URL` | *Web build only.* Points the Vercel site or the APK at the AppSail URL. You can also paste the URL in Grid → Forecast service. |

**6. Scoring contract**

```bash
cd microgrid
python predict.py --input sample_test_input.csv --output predictions.csv   # timestamp,target_demand_kw
python test_eval.py                                                        # SUCCESS
python model/train.py                    # rebuilds the QuickML CSV, fallback model and holdout report
python -m pytest tests -q                # controller + pipeline tests
```

`predict.py` reads the same environment variables. It returns exactly one prediction per input row, in input order, with timestamps preserved.

### Submission checklist

- [ ] Public Catalyst AppSail URL (add it at the top of this README)
- [x] Full source: web app (`src/`), backend (`microgrid/appsail/`), Android wrapper (`android/`)
- [x] `predict.py` wired to the QuickML endpoint through environment variables · `test_eval.py` → SUCCESS
- [x] README: setup, architecture, environment variables (credentials stay out of the repo)

---

## ESG workspace

| Area | What ESG teams do there |
| --- | --- |
| **Overview** | Scope 1 + 2 emissions, energy (GJ), renewable share and year-on-year change; claims pipeline; greenwashing-risk score; alerts for altered evidence and risky approved claims; shortcut to the Grid forecast. |
| **Claims register** | Log every claim made in reports, BRSR, the website, ads, social media and press. A rule-based check runs as you type: vague or absolute wording, offsets, pledges, time period, evidence integrity, anchoring, audit, and claimed figures against the evidence and company data. Claims move draft → in review → approved / rejected → published, with an audit trail. Approving an unsupported claim needs a written justification. |
| **Evidence library** | Upload bills, meter exports, audit reports and certificates, or import EcoCypher MRV records by QR code. Each item gets a SHA-256 fingerprint; any later change shows as **altered**. |
| **Energy** | Monthly grid and renewable electricity, diesel and LPG per facility (form or CSV import), linked to evidence. |
| **Grid** | 24-hour demand forecast and grid ⇄ battery dispatch (above). |
| **Reports** | BRSR Section C, Principle 6 (energy, Scope 1/2 emissions, intensity per ₹ crore turnover), approved claims and an evidence index with fingerprints. Export CSV / JSON or print to PDF. |
| **Settings** | Company profile, turnover, emission factors, team roles (admin / manager / viewer) and invites. |

### Run it

```bash
npm install
npm run dev     # demo workspace with a sample company, stored in your browser
npm test
npm run build
```

### Team mode (Supabase)

1. Create a project at [supabase.com](https://supabase.com) and run `supabase/migrations/001_esg_workspace.sql` in the SQL editor.
   It sets up row-level security (each company sees only its own data; evidence and the audit trail are append-only), invite functions and a
   private `evidence` storage bucket.
2. Add your site URL under **Authentication → URL configuration**.
3. Put **Project URL** and **anon key** in `.env` (or the Vercel environment):
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```
4. The first person to sign up creates the company and becomes admin, then invites managers by email.

### Deploy on Vercel

Framework **Vite**, build `npm run build`, output `dist`. `vercel.json` handles SPA routing, and `/verify/EVD-…` links from QR receipts open the
matching evidence.

## Repository layout

```
src/                     React + TypeScript app (screens, charts, microgrid engine in src/lib/microgrid)
microgrid/appsail/       Catalyst AppSail service: API + hosting for the built app
microgrid/quickml/       QuickML training CSV + holdout report
microgrid/predict.py     Scoring contract (QuickML endpoint, local fallback)
microgrid/test_eval.py   Organiser self-test
microgrid/model/         Feature + model training script
microgrid/tests/         Controller and pipeline tests
android/                 Android wrapper for the APK
supabase/                Database schema for team mode
```

## Method notes

- Financial years run April–March (Indian FY).
- Energy content: electricity 0.0036 GJ/kWh; diesel 0.0358 GJ/L; LPG 0.0473 GJ/kg (IPCC 2006 net calorific values).
- Default emission factors (editable per company): grid 0.71 kg CO₂e/kWh (CEA CO₂ Baseline Database), diesel 2.68 kg/L, LPG 2.98 kg/kg
  (IPCC 2006). Check the latest CEA version for your reporting year.
- Evidence fingerprints use canonical JSON (sorted keys, compact) hashed with SHA-256 in the browser (Web Crypto).
- The claim check is deterministic and explainable (`src/lib/claims.ts`); it supports legal review but does not replace it.

## Brand

Deep Forest Green `#14583F` · Gold `#E4B347` · Vermilion `#C74736` · Warm Ivory `#FAF6EA` · Forest Charcoal `#24352D`
