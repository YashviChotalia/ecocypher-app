import { AlertOctagon, BatteryCharging, Download, FileUp, Play, PlugZap, RotateCcw, Server, Zap } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { LoadCurve, MODE_LABEL, SocChart } from '../components/gridCharts';
import { PageHeader, download, toCsv, toast } from '../components/ui';
import { fmtDateTime, fmtNum } from '../lib/format';
import {
  DEFAULT_BATTERY, SOLAR_BY_HOUR, windowStarts,
  type BatteryConfig, type CleanReport, type CleanRow, type RawRow,
} from '../lib/microgrid/engine';
import {
  SAMPLE_CSV, checkService, clearRuns, getBattery, getServiceUrl, listRuns, prepare, runForecast,
  setBattery as saveBattery, setServiceUrl, type Run,
} from '../lib/microgrid/forecast';

type InputMode = 'sample' | 'csv' | 'form';
interface FormRow { t: string; h: string; s: string }

const BATTERY_FIELDS: { key: keyof BatteryConfig; label: string; unit: string }[] = [
  { key: 'capacity_kwh', label: 'Battery capacity', unit: 'kWh' },
  { key: 'initial_soc_pct', label: 'Starting charge', unit: '%' },
  { key: 'min_soc_pct', label: 'Reserve floor', unit: '%' },
  { key: 'max_discharge_kw', label: 'Max discharge', unit: 'kW' },
  { key: 'max_charge_kw', label: 'Max charge', unit: 'kW' },
  { key: 'pv_capacity_kw', label: 'Solar PV rating', unit: 'kW' },
];

/** Merge consecutive hourly alerts of the same type into one range. */
function groupAlerts(run: Run) {
  const byTs = new Map(run.result.hours.map((h, i) => [h.timestamp, i]));
  const out: { type: string; from: string; to: string; count: number; min: number; max: number; last: number }[] = [];
  for (const a of [...run.result.alerts].sort((x, y) => (x.type === y.type ? 0 : x.type === 'CRITICAL_OVERLOAD' ? -1 : 1))) {
    const i = byTs.get(a.timestamp) ?? 0;
    const h = run.result.hours[i];
    const v = a.type === 'CRITICAL_OVERLOAD' ? h.predicted_kw : h.grid_import_kw;
    const g = out[out.length - 1];
    if (g && g.type === a.type && g.last === i - 1) { g.to = a.timestamp.slice(11, 16); g.count++; g.min = Math.min(g.min, v); g.max = Math.max(g.max, v); g.last = i; }
    else out.push({ type: a.type, from: a.timestamp.slice(11, 16), to: a.timestamp.slice(11, 16), count: 1, min: v, max: v, last: i });
  }
  return out;
}

function typicalDay(): FormRow[] {
  return Array.from({ length: 24 }, (_, h) => ({
    t: (27 + 6 * Math.sin(((h - 9) / 24) * 2 * Math.PI)).toFixed(1),
    h: (68 - 14 * Math.sin(((h - 9) / 24) * 2 * Math.PI)).toFixed(0),
    s: String(SOLAR_BY_HOUR[h] * 2.6 > 0 ? Math.round(SOLAR_BY_HOUR[h] * 2.6) : 0),
  }));
}
const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); };

export function Microgrid() {
  const [mode, setMode] = useState<InputMode>('sample');
  const [csv, setCsv] = useState<{ name: string; text: string } | null>(null);
  const [day, setDay] = useState(tomorrow());
  const [form, setForm] = useState<FormRow[]>(typicalDay);
  const [battery, setBatteryState] = useState<Partial<BatteryConfig>>(getBattery);
  const [windowStart, setWindowStart] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(() => listRuns()[0] ?? null);
  const [runs, setRuns] = useState<Run[]>(listRuns);
  const [url, setUrl] = useState(getServiceUrl());
  const [svc, setSvc] = useState<{ ok: boolean; message: string } | null>(null);

  // Clean the current input as soon as it changes (validation preview + window list).
  const prepared = useMemo<{ rows: CleanRow[]; report: CleanReport } | { error: string } | null>(() => {
    try {
      if (mode === 'sample') return prepare({ csv: SAMPLE_CSV });
      if (mode === 'csv') return csv ? prepare({ csv: csv.text }) : null;
      const raw: RawRow[] = form.map((r, h) => ({ timestamp: `${day} ${String(h).padStart(2, '0')}:00:00`, ambient_temp_c: r.t, humidity_pct: r.h, solar_irradiance_wm2: r.s }));
      return prepare({ rows: raw });
    } catch (e) { return { error: (e as Error).message }; }
  }, [mode, csv, form, day]);
  const ok = prepared && 'rows' in prepared ? prepared : null;
  const starts = useMemo(() => (ok ? windowStarts(ok.rows) : []), [ok]);
  useEffect(() => { setWindowStart(starts[0] ?? ''); }, [starts]);

  // First visit: forecast the starter-kit sample straight away so the dashboard is never empty.
  useEffect(() => {
    if (!run && mode === 'sample' && ok && windowStart) void go(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowStart]);

  const go = async (quiet = false) => {
    if (!ok || !ok.rows.length) { setError('Add some valid telemetry first.'); return; }
    setBusy(true); setError(null);
    try {
      saveBattery(battery);
      const r = await runForecast({ rows: ok.rows, cleaning: ok.report, windowStart, input: mode, file: mode === 'csv' ? csv?.name : undefined, csv: mode === 'csv' ? csv?.text : undefined, battery });
      setRun(r); setRuns(listRuns());
      if (quiet) return;
      toast(`Forecast ready · ${r.source === 'quickml' ? 'QuickML' : 'on-device model'}`);
      requestAnimationFrame(() => document.getElementById('grid-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const onFile = async (f?: File | null) => {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { setError('CSV is larger than 5 MB.'); return; }
    setCsv({ name: f.name, text: await f.text() }); setError(null);
  };

  const exportPlan = () => {
    if (!run) return;
    const h = run.result.hours;
    download(`dispatch-plan-${run.window_start.slice(0, 10)}.csv`, toCsv([
      ['timestamp', 'predicted_kw', 'grid_mode', 'dispatch_signal', 'overload_alert', 'battery_soc_pct', 'battery_kw', 'grid_import_kw', 'pv_kw', 'reason'],
      ...h.map((x) => [x.timestamp, x.predicted_kw, x.grid_mode, x.dispatch_signal, x.overload_alert ? 'CRITICAL' : '', x.soc_pct, x.battery_kw, x.grid_import_kw, x.pv_kw, x.reason]),
    ]));
  };
  const exportPredictions = () => {
    if (!run) return;
    download(`predictions-${run.window_start.slice(0, 10)}.csv`, toCsv([['timestamp', 'target_demand_kw'], ...run.result.hours.map((x) => [x.timestamp, x.predicted_kw.toFixed(2)])]));
  };

  const s = run?.result.summary;
  const now = run?.result.hours[0];
  const overloads = run?.result.alerts.filter((a) => a.type === 'CRITICAL_OVERLOAD') ?? [];
  const reserveWarn = run?.result.alerts.filter((a) => a.type === 'BATTERY_RESERVE') ?? [];

  return (
    <>
      <PageHeader eyebrow="Smart microgrid · HackSphere 3.0" title="Microgrid">
        Forecast hourly demand for the next 24 hours, then switch between the main grid and battery storage automatically.
      </PageHeader>

      <section className="card stack">
        <div className="section-title"><h2>1 · Telemetry</h2></div>
        <div className="segmented seg-full" role="group" aria-label="Input">
          {(['sample', 'csv', 'form'] as InputMode[]).map((m) => (
            <button key={m} aria-pressed={mode === m} onClick={() => { setMode(m); setError(null); }}>
              {m === 'sample' ? 'Sample' : m === 'csv' ? 'Upload CSV' : 'Manual'}
            </button>
          ))}
        </div>

        {mode === 'sample' && <p className="muted">Starter-kit test telemetry: 1,000 hourly rows of temperature, humidity and solar irradiance.</p>}
        {mode === 'csv' && (
          <label className="dropzone">
            <FileUp aria-hidden />
            <span><b>{csv ? csv.name : 'Choose a CSV file'}</b><br /><small className="muted">Columns: timestamp, ambient_temp_c, humidity_pct, solar_irradiance_wm2. Gaps and bad values are repaired.</small></span>
            <input type="file" accept=".csv,text/csv" hidden onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
        )}
        {mode === 'form' && (
          <div className="stack">
            <div className="row">
              <label className="field-inline">Forecast day <input className="input" type="date" value={day} onChange={(e) => setDay(e.target.value)} /></label>
              <button className="btn btn-ghost" onClick={() => setForm(typicalDay())}><RotateCcw aria-hidden /> Typical summer day</button>
            </div>
            <div className="table-wrap form-grid">
              <table className="table">
                <thead><tr><th>Hour</th><th className="num">Temp °C</th><th className="num">Humidity %</th><th className="num">Solar W/m²</th></tr></thead>
                <tbody>{form.map((r, h) => (
                  <tr key={h}>
                    <td className="mono">{String(h).padStart(2, '0')}:00</td>
                    {(['t', 'h', 's'] as const).map((k) => (
                      <td key={k} className="num"><input className="cell" inputMode="decimal" aria-label={`${k === 't' ? 'Temperature' : k === 'h' ? 'Humidity' : 'Solar'} at ${h}:00`} value={r[k]}
                        onChange={(e) => setForm((f) => f.map((x, i) => (i === h ? { ...x, [k]: e.target.value } : x)))} /></td>
                    ))}
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <p className="muted small">Leave a cell blank and it is filled from neighbouring hours.</p>
          </div>
        )}

        {prepared && 'error' in prepared && <div className="note fail" role="alert">{prepared.error}</div>}
        {ok && (
          <div className="summary-strip">
            <span><small>Clean rows</small><b>{fmtNum(ok.report.clean_rows, 0)}</b></span>
            <span><small>Values repaired</small><b>{ok.report.missing_filled + ok.report.out_of_range_fixed}</b></span>
            <span><small>Hours gap-filled</small><b>{ok.report.gaps_filled}</b></span>
            <span><small>Rows dropped</small><b>{ok.report.dropped_bad_timestamp + ok.report.duplicates_removed}</b></span>
          </div>
        )}
        {starts.length > 1 && (
          <label className="field-inline">Forecast window starts
            <select className="select" value={windowStart} onChange={(e) => setWindowStart(e.target.value)}>
              {starts.map((t) => <option key={t} value={t}>{t.slice(0, 16)}</option>)}
            </select>
          </label>
        )}

        <details className="disclosure">
          <summary>Battery &amp; solar settings</summary>
          <div className="batt-grid">
            {BATTERY_FIELDS.map((f) => (
              <label key={f.key} className="field">
                <span>{f.label} <small className="muted">{f.unit}</small></span>
                <input className="input" inputMode="decimal" value={battery[f.key] ?? DEFAULT_BATTERY[f.key]}
                  onChange={(e) => setBatteryState((b) => ({ ...b, [f.key]: e.target.value === '' ? undefined : Number(e.target.value) }))} />
              </label>
            ))}
          </div>
        </details>

        {error && <div className="note fail" role="alert">{error}</div>}
        <button className="btn btn-primary btn-block" onClick={() => go()} disabled={busy || !ok?.rows.length}>
          <Play aria-hidden /> {busy ? 'Forecasting…' : 'Run 24-hour forecast'}
        </button>
      </section>

      {run && s && now && (
        <div className="stack" id="grid-results" style={{ gap: 20 }}>
          {overloads.length > 0 && (
            <div className="banner critical" role="alert">
              <AlertOctagon size={20} aria-hidden />
              <span><b>Critical overload:</b> {overloads.length} hour{overloads.length > 1 ? 's' : ''} at or above 200 kW, peaking at {fmtNum(s.peak_kw, 1)} kW ({s.peak_at?.slice(11, 16)}). Shed or defer flexible loads.</span>
            </div>
          )}

          <section className="grid-status">
            <div className={`source-badge ${now.grid_mode === 'RENEWABLE_STORAGE' ? 'batt' : 'gridm'}`}>
              {now.grid_mode === 'RENEWABLE_STORAGE' ? <BatteryCharging aria-hidden /> : <PlugZap aria-hidden />}
              <span><small>Active source · {now.timestamp.slice(11, 16)}</small><b>{MODE_LABEL[now.grid_mode]}</b></span>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <span className={`chip ${run.source === 'quickml' ? 'pass' : 'neutral'}`}><Zap aria-hidden />{run.source === 'quickml' ? 'QuickML' : 'On-device model'}</span>
              <span className="chip neutral">{run.window_start.slice(0, 16)} · {s.hours} h</span>
            </div>
          </section>

          <div className="kpis grid-kpis">
            <div className="kpi"><small>Peak demand</small><b>{fmtNum(s.peak_kw, 1)} <span>kW</span></b><em>at {s.peak_at?.slice(11, 16)}</em></div>
            <div className="kpi"><small>Overload hours</small><b className={s.overload_hours ? 'bad' : ''}>{s.overload_hours}</b><em>≥ 200 kW</em></div>
            <div className="kpi"><small>Source switches</small><b>{s.transitions}</b><em>{s.renewable_hours} h battery · {s.grid_hours} h grid</em></div>
            <div className="kpi"><small>Battery at end</small><b>{fmtNum(s.final_soc_pct, 0)} <span>%</span></b><em>low {fmtNum(s.min_soc_pct, 0)}%</em></div>
          </div>

          <section className="card"><LoadCurve hours={run.result.hours} /></section>
          <section className="card"><SocChart hours={run.result.hours} reserve={run.result.battery.min_soc_pct} /></section>

          <section className="stack">
            <div className="section-title"><h2>Control signals</h2><span className="muted small">{run.result.signals.length} dispatched</span></div>
            <div className="rows">
              {run.result.signals.map((g) => (
                <div key={g.timestamp} className="signal-row">
                  <span className={`sig ${g.to === 'RENEWABLE_STORAGE' ? 'batt' : 'gridm'}`}>{g.timestamp.slice(11, 16)}</span>
                  <span className="sig-body"><b>{g.signal}</b><small>{g.reason}</small></span>
                </div>
              ))}
            </div>
          </section>

          {(overloads.length > 0 || reserveWarn.length > 0) && (
            <section className="stack">
              <div className="section-title"><h2>Alerts</h2></div>
              <div className="rows">
                {groupAlerts(run).map((g) => (
                  <div key={g.type + g.from} className="signal-row">
                    <span className={`tag ${g.type === 'CRITICAL_OVERLOAD' ? 'fail' : 'warn'}`}>{g.from}{g.count > 1 ? `–${g.to}` : ''}</span>
                    <span className="sig-body">
                      <b>{g.type === 'CRITICAL_OVERLOAD' ? 'Critical overload' : 'Battery at reserve'} · {g.count} h</b>
                      <small>{g.type === 'CRITICAL_OVERLOAD' ? `Predicted ${fmtNum(g.min, 1)}–${fmtNum(g.max, 1)} kW (≥ 200 kW)` : `Up to ${fmtNum(g.max, 1)} kW backup import from the grid`}</small>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <details className="disclosure">
            <summary>Hourly dispatch plan</summary>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Hour</th><th className="num">kW</th><th>Source</th><th className="num">SoC</th><th className="num">Battery kW</th><th className="num">Grid kW</th><th className="num">PV kW</th></tr></thead>
                <tbody>{run.result.hours.map((h) => (
                  <tr key={h.timestamp} className={h.overload_alert ? 'over-row' : ''}>
                    <td className="mono">{h.timestamp.slice(5, 16)}</td><td className="num">{fmtNum(h.predicted_kw, 1)}</td>
                    <td><span className={`tag ${h.grid_mode === 'RENEWABLE_STORAGE' ? 'pass' : 'info'}`}>{h.dispatch_signal}</span></td>
                    <td className="num">{fmtNum(h.soc_pct, 0)}%</td><td className="num">{fmtNum(h.battery_kw, 0)}</td>
                    <td className="num">{fmtNum(h.grid_import_kw, 0)}</td><td className="num">{fmtNum(h.pv_kw, 0)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </details>

          <div className="row">
            <button className="btn btn-ghost" onClick={exportPlan}><Download aria-hidden /> Dispatch plan CSV</button>
            <button className="btn btn-ghost" onClick={exportPredictions}><Download aria-hidden /> Predictions CSV</button>
          </div>
          {run.note && <p className="muted small">Model: {run.note}{run.latencyMs ? ` · ${run.latencyMs} ms` : ''}</p>}
        </div>
      )}

      <section className="stack">
        <div className="section-title"><h2>System log</h2>{runs.length > 0 && <button className="link-btn" onClick={() => { clearRuns(); setRuns([]); }}>Clear</button>}</div>
        {runs.length ? (
          <div className="rows">
            {runs.map((r) => (
              <button key={r.id} className="row-link log-row" onClick={() => { setRun(r); document.getElementById('grid-results')?.scrollIntoView({ behavior: 'smooth' }); }} aria-current={run?.id === r.id ? 'true' : undefined}>
                <span className="sig-body">
                  <b>{fmtDateTime(r.created_at)} · {r.input === 'csv' ? r.file ?? 'CSV' : r.input === 'form' ? 'Manual entry' : 'Sample'}</b>
                  <small>Peak {fmtNum(r.result.summary.peak_kw, 0)} kW · {r.result.summary.overload_hours} overload h · {r.result.summary.transitions} switches · {r.source === 'quickml' ? 'QuickML' : 'on-device'}</small>
                </span>
                {r.result.summary.overload_hours > 0 ? <span className="tag fail">Overload</span> : <span className="tag pass">Normal</span>}
              </button>
            ))}
          </div>
        ) : <p className="muted">No forecasts yet.</p>}
      </section>

      <details className="disclosure">
        <summary><Server size={16} aria-hidden style={{ verticalAlign: '-3px' }} /> Forecast service (Zoho Catalyst)</summary>
        <div className="stack">
          <p className="muted small">Paste your Catalyst AppSail URL to forecast with the published QuickML model. Leave blank to use the on-device model (same features, holdout RMSE ≈ 8.3 kW). If the service can't be reached, the app falls back automatically.</p>
          <input className="input" type="url" placeholder="https://microgrid-xxxxxxxx.development.catalystappsail.in" value={url} onChange={(e) => setUrl(e.target.value)} />
          <div className="row">
            <button className="btn btn-primary" onClick={async () => { setServiceUrl(url); setSvc(url ? await checkService(url) : { ok: true, message: 'Using on-device model' }); toast('Forecast service saved'); }}>Save &amp; test</button>
            {svc && <span className={`tag ${svc.ok ? 'pass' : 'fail'}`}>{svc.message}</span>}
          </div>
        </div>
      </details>
      <p className="muted small">Rules: battery storage when demand &gt; 160 kW or between 18:00 and 22:00 (inclusive); otherwise main grid. Critical overload alert at ≥ 200 kW in either mode.</p>
    </>
  );
}
