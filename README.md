# EcoCypher ESG

A workspace for **company ESG teams** that turns sustainability from claims-based trust into evidence-based accountability.
Every green claim is checked against fingerprinted evidence and real energy data *before* it is published.
Works on phones, tablets and desktops, and installs as an app (PWA).

| Area | What ESG managers do there |
| --- | --- |
| **Overview** | Scope 1 + 2 emissions, energy (GJ), renewable share and year-on-year change; claims pipeline; greenwashing-risk score; alerts for altered evidence and risky approved claims |
| **Claims register** | Log every claim for reports, BRSR, website, ads, social and press. A rule-based check runs as you type (vague or absolute wording, offsets, pledges, time period, evidence integrity, anchoring, audit, and claimed figures vs evidence and company data). Draft → in review → approved / rejected → published, with an audit trail. Approving an unsupported claim needs a written justification. |
| **Evidence library** | Upload bills, meter exports, audit reports and certificates, or import EcoCypher MRV records by QR code. Each item gets a SHA-256 fingerprint; any later change shows as **altered** and stops supporting claims. |
| **Facilities & energy** | Monthly grid and renewable electricity, diesel and LPG per facility (form or CSV import), linked to evidence. |
| **Reports** | BRSR Section C, Principle 6 (energy and Scope 1/2 emissions, intensity per ₹ crore turnover), approved claims and an evidence index with fingerprints. Export CSV / JSON or print to PDF. |
| **Grid (Microgrid)** | HackSphere 3.0 module: 24-hour hourly demand forecast from a CSV upload or a manual 24-row form, data cleaning, QuickML forecasting, automatic Main Grid ⇄ Renewable Battery Storage switching signals, battery state of charge, critical overload alerts, load curve, dispatch plan export and a system log. See [HackSphere 3.0 microgrid](#hacksphere-30-smart-energy-microgrid) below. |
| **Settings** | Company profile, turnover, emission factors, team roles (admin / manager / viewer) and invites. |

## Run it

```bash
npm install
npm run dev     # http://localhost:5173 (demo workspace with a sample company)
npm test
npm run build
```

Without Supabase settings the app runs a **demo workspace** (sample textile company, stored only in your browser),
so you can try every feature immediately.

## Use it with your team (Supabase)

1. Create a free project at [supabase.com](https://supabase.com).
2. In **SQL editor**, run `supabase/migrations/001_esg_workspace.sql`. It creates the tables, row-level security
   (each company sees only its own data; evidence and the audit trail are append-only), invite functions and a private
   `evidence` storage bucket.
3. In **Authentication → URL configuration**, add your site URL (e.g. your Vercel domain) to the redirect URLs.
4. Copy **Project URL** and **anon public key** from Settings → API into `.env` (or Vercel environment variables):

   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```
5. Deploy. The first person to sign up creates the company and becomes its admin, then invites managers by email
   from Settings. Invited people join when they sign in with that email.

## Deploy on Vercel

Import the repo, framework **Vite**, build `npm run build`, output `dist`, and add the two environment variables.
`vercel.json` handles SPA routing, and `/verify/EVD-…` links from EcoCypher QR receipts open the matching evidence.

## HackSphere 3.0: Smart Energy Microgrid

The **Grid** tab and the `microgrid/` folder implement the HackSphere 3.0 brief end to end on Zoho Catalyst.

| Requirement | Implementation |
| --- | --- |
| 1. Model building (QuickML) | `microgrid/quickml/train_quickml.csv`: `train_telemetry.csv` + engineered features (hour, weekday, cooling/heating degrees above 24 °C / below 10 °C, night / morning-ramp / morning-peak / evening-peak / late-evening flags, hour sin/cos). Train a **Linear Regression** pipeline on it in QuickML (drop `timestamp`) and publish the endpoint. Time-ordered holdout RMSE **8.30 kW** vs 11–15 kW for tree models (`microgrid/quickml/holdout_report.json`). |
| 2. Data ingestion & cleanup | CSV upload or live 24-row form in the Grid tab. Cleaning (`microgrid/appsail/microgrid/cleaning.py`, mirrored in `src/lib/microgrid/engine.ts`): 12 timestamp formats, bad timestamps dropped, duplicates merged, out-of-range readings repaired, missing hours (≤ 6h gaps) added, values linearly interpolated, hour-aware solar defaults; every fix is counted in the cleaning report. Uploaded CSVs go to **Stratus** and runs to **Data Store** when configured. |
| 3. Demand forecasting | The Grid tab sends the cleaned 24-hour window (or the uploaded CSV) to `POST /api/forecast` on **AppSail**, which builds the QuickML feature vectors, calls the published QuickML endpoint and stores the run (OAuth `Zoho-oauthtoken`, `X-QUICKML-ENDPOINT-KEY`, `CATALYST-ORG`). If the endpoint fails, the identical model runs as a fallback, and the app shows which source was used. |
| 4. Smart grid switching | Demand **> 160 kW** or hour **18:00–22:00 inclusive** → `RENEWABLE_STORAGE` (`SWITCH_TO_BATTERY`); otherwise `MAIN_GRID` (`SWITCH_TO_MAIN_GRID`); demand **≥ 200 kW** → `CRITICAL_OVERLOAD` alert, independent of mode. Battery simulation: capacity, starting charge, reserve floor, PV array, charge/discharge limits (editable in Grid → Battery & solar settings). Tested in `microgrid/tests` and `src/lib/__tests__/microgrid.test.ts`. |
| 5. Interactive dashboard | Grid tab: active power-source badge, battery charge gauge, overload alert banner, load curve with 160/200 kW thresholds and the 18–22h band, per-hour source strip, battery/solar chart, hourly dispatch plan + predictions CSV export, control signals, grouped alerts, cleaning report, system log. Opens with the starter-kit sample already forecast. Responsive from phone to desktop. |
| `predict.py` / `test_eval.py` | `microgrid/predict.py` follows the starter contract (`predict(input_df)` → one prediction per row, `--input/--output` CLI) and calls the QuickML endpoint; `python test_eval.py` prints **SUCCESS**. |

### Architecture on Catalyst

```
Browser / Android app ── EcoCypher web app (Grid tab)
        │ POST /api/forecast  (same origin when served by AppSail, or the URL saved in Grid → Forecast service)
        ▼
Catalyst AppSail  microgrid/appsail/app.py  (Python standard library, no dependencies)
  ├─ cleaning.py    validate + repair telemetry
  ├─ features.py    QuickML feature vectors (same as training CSV)
  ├─ forecast.py ─► Catalyst QuickML published endpoint
  ├─ controller.py  transition rules, battery SoC, signals, alerts
  └─ store.py    ─► Catalyst Data Store (forecast_runs) + Stratus (raw CSVs)
```

Without a backend (Vercel site, offline Android app) the Grid tab runs the same cleaning, model and rules on the device.

### Deploy to Catalyst

```bash
npm install -g zcatalyst-cli
catalyst login
bash microgrid/build_catalyst.sh      # builds the web app into microgrid/appsail/static
cd microgrid && catalyst deploy      # AppSail: source appsail, Python, command "python3 app.py"
```

In the AppSail console set these environment variables (see `microgrid/.env.example`; never commit secrets):

| Variable | Purpose |
| --- | --- |
| `QUICKML_ENDPOINT_URL` | Published endpoint deployment URL |
| `QUICKML_ENDPOINT_KEY` | `X-QUICKML-ENDPOINT-KEY` header |
| `CATALYST_ORG` | `CATALYST-ORG` header |
| `QUICKML_ENVIRONMENT` | `Production` or `Development` |
| `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN` | Self Client OAuth with scope `QuickML.deployment.READ` (auto-refreshing); or a short-lived `QUICKML_ACCESS_TOKEN` |
| `ZOHO_ACCOUNTS_URL` | `https://accounts.zoho.in` for the India data centre |
| `DATASTORE_TABLE`, `STRATUS_BUCKET` | Optional persistence (install `zcatalyst-sdk` into `microgrid/appsail`) |

The AppSail URL then serves the whole EcoCypher app plus the API. To use QuickML from the Vercel site or the Android app,
set `VITE_MICROGRID_API` to the AppSail URL at build time, or paste it in Grid → Settings.

### Model and scoring

```bash
cd microgrid
python model/train.py                                   # rebuilds quickml/train_quickml.csv + holdout report
python predict.py --input sample_test_input.csv --output predictions.csv
python test_eval.py                                     # SUCCESS
python -m pytest tests -q
```

## Method notes

- Financial years run April–March (Indian FY).
- Energy content: electricity 0.0036 GJ/kWh; diesel 0.0358 GJ/L; LPG 0.0473 GJ/kg (IPCC 2006 net calorific values).
- Default emission factors (editable per company): grid 0.71 kg CO₂e/kWh (CEA CO₂ Baseline Database), diesel 2.68 kg/L,
  LPG 2.98 kg/kg (IPCC 2006). Check the latest CEA database version for your reporting year.
- Evidence fingerprints use canonical JSON (sorted keys, compact) hashed with SHA-256 in the browser (Web Crypto).
  Imported MRV records keep the canonical JSON and hash issued by the EcoCypher impact platform.
- The claim check is deterministic and explainable (`src/lib/claims.ts`); it supports, not replaces, legal review.

## Brand

Deep Forest Green `#14583F` · Guru Gold `#E4B347` · Mangal Vermilion `#C74736` · Warm Ivory `#FAF6EA` · Forest Charcoal `#24352D`
