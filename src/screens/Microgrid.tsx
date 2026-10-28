import { FileUp, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { LoadCurve, MODE_LABEL, SocChart } from '../components/gridCharts';
import { Sheet, download, toCsv, toast } from '../components/ui';
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
  { key: 'capacity_kwh', label: 'Capacity', unit: 'kWh' },
  { key: 'initial_soc_pct', label: 'Starting charge', unit: '%' },
  { key: 'min_soc_pct', label: 'Reserve floor', unit: '%' },
  { key: 'max_discharge_kw', label: 'Max discharge', unit: 'kW' },
  { key: 'max_charge_kw', label: 'Max charge', unit: 'kW' },
  { key: 'pv_capacity_kw', label: 'Solar PV', unit: 'kW' },
];

const hm = (ts: string) => ts.slice(11, 16);
const dayLabel = (ts: string) =>
  new Date(`${ts.slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const range = (a: string, b: string, n: number) => (n > 1 ? `${hm(a)}–${hm(b)}` : hm(a));

interface Event { at: string; sortIdx: number; tone: 'batt' | 'gridm' | 'fail' | 'warn'; title: string; detail: string; code?: string }

/** One chronological timeline: source switches plus merged overload / reserve ranges. */
function timeline(run: Run): Event[] {
  const hours = run.result.hours;
  const idx = new Map(hours.map((h, i) => [h.timestamp, i]));
  const events: Event[] = run.result.signals.map((g) => ({
    at: hm(g.timestamp), sortIdx: idx.get(g.timestamp) ?? 0, tone: g.to === 'RENEWABLE_STORAGE' ? 'batt' : 'gridm',
    title: g.to === 'RENEWABLE_STORAGE' ? 'Switch to battery storage' : 'Switch to main grid', detail: g.reason, code: g.signal,
  }));
  for (const type of ['CRITICAL_OVERLOAD', 'BATTERY_RESERVE'] as const) {
    const at = run.result.alerts.filter((a) => a.type === type).map((a) => idx.get(a.timestamp) ?? 0);
    let i = 0;
    while (i < at.length) {
      let j = i;
      while (j + 1 < at.length && at[j + 1] === at[j] + 1) j++;
      const slice = hours.slice(at[i], at[j] + 1);
      const n = slice.length;
      if (type === 'CRITICAL_OVERLOAD') {
        const peak = Math.max(...slice.map((h) => h.predicted_kw));
        events.push({ at: range(slice[0].timestamp, slice[n - 1].timestamp, n), sortIdx: at[i] + 0.1, tone: 'fail', title: `Critical overload · ${n} h`, detail: `Up to ${fmtNum(peak, 1)} kW, at or above 200 kW`, code: 'CRITICAL_OVERLOAD' });
      } else {
        const imp = Math.max(...slice.map((h) => h.grid_import_kw));
        events.push({ at: range(slice[0].timestamp, slice[n - 1].timestamp, n), sortIdx: at[i] + 0.2, tone: 'warn', title: `Battery at reserve · ${n} h`, detail: `Backup import from the grid, up to ${fmtNum(imp, 0)} kW` });
      }
      i = j + 1;
    }
  }
  return events.sort((a, b) => a.sortIdx - b.sortIdx);
}

function typicalDay(): FormRow[] {
  return Array.from({ length: 24 }, (_, h) => ({
    t: (27 + 6 * Math.sin(((h - 9) / 24) * 2 * Math.PI)).toFixed(1),
    h: (68 - 14 * Math.sin(((h - 9) / 24) * 2 * Math.PI)).toFixed(0),
    s: String(Math.round(SOLAR_BY_HOUR[h] * 2.6)),
  }));
}
const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); };

export function Microgrid() {
  const [open, setOpen] = useState(false);
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

  // First visit: forecast the starter-kit sample straight away so the page is never empty.
  useEffect(() => {
    if (!run && mode === 'sample' && ok && windowStart) void go(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowStart]);

  async function go(quiet = false) {
    if (!ok || !ok.rows.length) { setError('Add some valid telemetry first.'); return; }
    setBusy(true); setError(null);
    try {
      saveBattery(battery);
      const r = await runForecast({ rows: ok.rows, cleaning: ok.report, windowStart, input: mode, file: mode === 'csv' ? csv?.name : undefined, csv: mode === 'csv' ? csv?.text : undefined, battery });
      setRun(r); setRuns(listRuns());
      if (quiet) return;
      setOpen(false);
      toast(r.source === 'quickml' ? 'Forecast ready · QuickML' : 'Forecast ready');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const onFile = async (f?: File | null) => {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { setError('CSV is larger than 5 MB.'); return; }
    setCsv({ name: f.name, text: await f.text() }); setError(null);
  };

  const exportPlan = () => {
    if (!run) return;
    download(`dispatch-plan-${run.window_start.slice(0, 10)}.csv`, toCsv([
      ['timestamp', 'predicted_kw', 'grid_mode', 'dispatch_signal', 'overload_alert', 'battery_soc_pct', 'battery_kw', 'grid_import_kw', 'pv_kw', 'reason'],
      ...run.result.hours.map((x) => [x.timestamp, x.predicted_kw, x.grid_mode, x.dispatch_signal, x.overload_alert ? 'CRITICAL' : '', x.soc_pct, x.battery_kw, x.grid_import_kw, x.pv_kw, x.reason]),
    ]));
  };
  const exportPredictions = () => {
    if (!run) return;
    download(`predictions-${run.window_start.slice(0, 10)}.csv`, toCsv([['timestamp', 'target_demand_kw'], ...run.result.hours.map((x) => [x.timestamp, x.predicted_kw.toFixed(2)])]));
  };

  const s = run?.result.summary;
  const hours = run?.result.hours ?? [];
  const now = hours[0];
  const last = hours[hours.length - 1];
  const events = useMemo(() => (run ? timeline(run) : []), [run]);
  const rep = ok?.report;
  const repaired = rep ? rep.missing_filled + rep.out_of_range_fixed + rep.gaps_filled : 0;
  const dropped = rep ? rep.dropped_bad_timestamp + rep.duplicates_removed : 0;

  return (
    <>
      <header className="page-header mg-head">
        <div className="stack" style={{ gap: 4, minWidth: 0 }}>
          <h1 className="page-title">Microgrid</h1>
          {run && now && last ? (
            <p className="muted mg-sub">
              {dayLabel(now.timestamp)} {hm(now.timestamp)} – {dayLabel(last.timestamp)} {hm(last.timestamp)}
              <span aria-hidden> · </span>{run.source === 'quickml' ? 'QuickML' : 'On-device'}
            </p>
          ) : <p className="muted mg-sub">24-hour demand forecast and power-source switching</p>}
        </div>
        <button className="btn btn-primary mg-new" onClick={() => { setError(null); setOpen(true); }} aria-label="New forecast"><Plus aria-hidden /><span>New forecast</span></button>
      </header>

      {!run || !s || !now ? (
        <section className="empty">{busy ? <p className="muted">Forecasting…</p> : <p className="muted">No forecast yet.</p>}</section>
      ) : (
        <>
          <section className="overview">
            <div className="headline">
              <span className="label">Power source at {hm(now.timestamp)}</span>
              <span className={`mg-now ${now.grid_mode === 'RENEWABLE_STORAGE' ? 'batt' : 'gridm'}`}><i aria-hidden />{MODE_LABEL[now.grid_mode]}</span>
              {s.overload_hours > 0
                ? <span className="delta bad">{s.overload_hours} overload hour{s.overload_hours > 1 ? 's' : ''} ahead · peak {fmtNum(s.peak_kw, 0)} kW at {hm(s.peak_at!)}</span>
                : <span className="delta good">No overload in the next {s.hours} hours</span>}
            </div>
            <dl className="stats four">
              <div><dt>Peak demand</dt><dd>{fmtNum(s.peak_kw, 1)} <small>kW</small></dd></div>
              <div><dt>Average</dt><dd>{fmtNum(s.avg_kw, 0)} <small>kW</small></dd></div>
              <div><dt>Switches</dt><dd>{s.transitions} <small>· {s.renewable_hours}h battery</small></dd></div>
              <div><dt>Battery at end</dt><dd>{fmtNum(s.final_soc_pct, 0)}<small>%</small></dd></div>
            </dl>
          </section>

          <section className="card mg-card"><LoadCurve hours={hours} /></section>
          <section className="card mg-card"><SocChart hours={hours} reserve={run.result.battery.min_soc_pct} /></section>

          <section className="stack">
            <div className="section-title"><h2>Timeline</h2><span className="muted small">{events.length} events</span></div>
            <ol className="mg-timeline">
              {events.map((e, i) => (
                <li key={i} className={e.tone}>
                  <time>{e.at}</time>
                  <div>
                    <b>{e.title}</b>
                    <small>{e.detail}{e.code && <span className="mg-code"> · {e.code}</span>}</small>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <details className="mg-fold">
            <summary>Hourly dispatch plan</summary>
            <div className="table-wrap">
              <table className="table mg-table">
                <thead><tr><th>Hour</th><th className="num">Demand</th><th>Source</th><th className="num">Battery</th><th className="num">Grid</th></tr></thead>
                <tbody>{hours.map((h) => (
                  <tr key={h.timestamp} className={h.overload_alert ? 'over-row' : ''}>
                    <td className="mg-hour">{hm(h.timestamp)}</td>
                    <td className="num">{fmtNum(h.predicted_kw, 1)}</td>
                    <td><span className={`mg-dot ${h.grid_mode === 'RENEWABLE_STORAGE' ? 'batt' : 'gridm'}`} />{h.dispatch_signal === 'BATTERY' ? 'Battery' : 'Grid'}</td>
                    <td className="num">{fmtNum(h.soc_pct, 0)}%</td>
                    <td className="num">{fmtNum(h.grid_import_kw, 0)} kW</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </details>

          <div className="mg-links">
            <button className="link-btn" onClick={exportPlan}>Download dispatch plan</button>
            <button className="link-btn" onClick={exportPredictions}>Download predictions</button>
          </div>
          {run.source === 'local-fallback' && run.note && <p className="muted small">{run.note}</p>}
        </>
      )}

      {runs.length > 1 && (
        <details className="mg-fold">
          <summary>History <span className="muted">· {runs.length}</span></summary>
          <ul className="mg-history">
            {runs.map((r) => (
              <li key={r.id}>
                <button onClick={() => { setRun(r); window.scrollTo({ top: 0, behavior: 'smooth' }); }} aria-current={run?.id === r.id ? 'true' : undefined}>
                  <span>{fmtDateTime(r.created_at)}<small>{r.input === 'csv' ? r.file ?? 'CSV' : r.input === 'form' ? 'Manual' : 'Sample'}</small></span>
                  <span className={r.result.summary.overload_hours ? 'bad' : ''}>{fmtNum(r.result.summary.peak_kw, 0)} kW</span>
                </button>
              </li>
            ))}
          </ul>
          <button className="link-btn quiet-link" onClick={() => { clearRuns(); setRuns(run ? [run] : []); }}>Clear history</button>
        </details>
      )}

      <details className="mg-fold">
        <summary>Forecast service</summary>
        <div className="stack">
          <p className="muted small">Your Zoho Catalyst AppSail URL. Forecasts then come from the published QuickML model. Leave empty to forecast on this device.</p>
          <div className="mg-svc">
            <input className="input" type="url" inputMode="url" placeholder="https://…catalystappsail.in" value={url} onChange={(e) => setUrl(e.target.value)} />
            <button className="btn btn-ghost" onClick={async () => { setServiceUrl(url); setSvc(url ? await checkService(url) : { ok: true, message: 'On-device model' }); }}>Save</button>
          </div>
          {svc && <span className={`tag ${svc.ok ? 'pass' : 'fail'}`}>{svc.message}</span>}
        </div>
      </details>

      <p className="muted small mg-rules">
        Battery storage when demand is above 160 kW or between 18:00 and 22:00. Main grid otherwise. Critical overload at 200 kW or more.
      </p>

      <Sheet title="New forecast" open={open} onClose={() => setOpen(false)}
        footer={<button className="btn btn-primary btn-block" onClick={() => go()} disabled={busy || !ok?.rows.length}>{busy ? 'Forecasting…' : 'Run forecast'}</button>}>
        <div className="segmented seg-full" role="group" aria-label="Telemetry source">
          {(['sample', 'csv', 'form'] as InputMode[]).map((m) => (
            <button key={m} aria-pressed={mode === m} onClick={() => { setMode(m); setError(null); }}>
              {m === 'sample' ? 'Sample' : m === 'csv' ? 'CSV' : 'Manual'}
            </button>
          ))}
        </div>

        {mode === 'sample' && <p className="muted small">Starter-kit test telemetry, 1,000 hourly rows.</p>}
        {mode === 'csv' && (
          <label className="dropzone">
            <FileUp aria-hidden />
            <span><b>{csv ? csv.name : 'Choose a CSV file'}</b><br /><small className="muted">timestamp, ambient_temp_c, humidity_pct, solar_irradiance_wm2</small></span>
            <input type="file" accept=".csv,text/csv" hidden onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
        )}
        {mode === 'form' && (
          <div className="stack" style={{ gap: 10 }}>
            <div className="mg-formhead">
              <input className="input" type="date" aria-label="Forecast day" value={day} onChange={(e) => setDay(e.target.value)} />
              <button className="link-btn" onClick={() => setForm(typicalDay())}>Reset</button>
            </div>
            <div className="mg-grid" role="table" aria-label="Hourly weather">
              <div className="mg-grid-row head" role="row"><span>Hour</span><span>°C</span><span>RH %</span><span>W/m²</span></div>
              {form.map((r, h) => (
                <div key={h} className="mg-grid-row" role="row">
                  <span className="mg-hour">{String(h).padStart(2, '0')}:00</span>
                  {(['t', 'h', 's'] as const).map((k) => (
                    <input key={k} className="cell" inputMode="decimal" aria-label={`${k === 't' ? 'Temperature' : k === 'h' ? 'Humidity' : 'Solar'} at ${h}:00`} value={r[k]}
                      onChange={(e) => setForm((f) => f.map((x, i) => (i === h ? { ...x, [k]: e.target.value } : x)))} />
                  ))}
                </div>
              ))}
            </div>
            <p className="muted small">Blank cells are filled from neighbouring hours.</p>
          </div>
        )}

        {prepared && 'error' in prepared && <div className="note fail" role="alert">{prepared.error}</div>}
        {rep && (
          <p className="muted small">
            {fmtNum(rep.clean_rows, 0)} rows ready{repaired ? ` · ${repaired} values repaired` : ''}{dropped ? ` · ${dropped} rows dropped` : ''}
          </p>
        )}
        {starts.length > 1 && (
          <label className="field">
            <span>Starts at</span>
            <select className="select" value={windowStart} onChange={(e) => setWindowStart(e.target.value)}>
              {starts.map((t) => <option key={t} value={t}>{dayLabel(t)} {t.slice(0, 4)}, {hm(t)}</option>)}
            </select>
          </label>
        )}

        <details className="mg-fold inner">
          <summary>Battery and solar</summary>
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
      </Sheet>
    </>
  );
}

