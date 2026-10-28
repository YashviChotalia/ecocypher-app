import { clean, evaluate, predictLocal, rowsFromCsv, sliceWindow, type BatteryConfig, type CleanReport, type CleanRow, type Evaluation, type RawRow } from './engine';
import sampleCsv from './sample_test_input.csv?raw';

export const SAMPLE_CSV = sampleCsv;

/* Settings: the Catalyst AppSail URL that proxies the published QuickML endpoint. */
const KEY_URL = 'ecocypher-microgrid-service';
const KEY_RUNS = 'ecocypher-microgrid-runs-v1';
const KEY_BATT = 'ecocypher-microgrid-battery-v1';
const DEFAULT_URL = (import.meta.env.VITE_MICROGRID_API_URL as string | undefined) ?? '';

const read = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } };

/** When the app itself is served by the Catalyst AppSail service, its own origin is the forecast service. */
function sameOrigin(): string {
  try {
    const h = location.hostname;
    if (!/^https?:$/.test(location.protocol) || h === 'localhost' || h === '127.0.0.1' || h.endsWith('.local') || h.endsWith('vercel.app')) return '';
    return location.origin;
  } catch { return ''; }
}
export const getServiceUrl = (): string => (read<string>(KEY_URL, '') || DEFAULT_URL || sameOrigin()).trim().replace(/\/+$/, '');
export const setServiceUrl = (u: string) => write(KEY_URL, u.trim());
export const getBattery = (): Partial<BatteryConfig> => read(KEY_BATT, {});
export const setBattery = (b: Partial<BatteryConfig>) => write(KEY_BATT, b);

export type Source = 'quickml' | 'local' | 'local-fallback';
export interface PredictResult { preds: number[]; source: Source; note?: string; latencyMs?: number }

/**
 * QuickML via the AppSail /api/forecast endpoint (which also stores the run in Data Store and the raw CSV
 * in Stratus); falls back to the on-device model (same features) if the service can't be used.
 */
export async function predict(rows: CleanRow[], extra: { csv?: string; filename?: string; battery?: Partial<BatteryConfig> } = {}): Promise<PredictResult> {
  const url = getServiceUrl();
  if (!url) return { preds: predictLocal(rows), source: 'local', note: 'On-device model (no forecast service set)' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  const t0 = performance.now();
  try {
    const body = extra.csv
      ? { csv: extra.csv, window_start: rows[0].timestamp, filename: extra.filename, battery: extra.battery }
      : { rows: rows.map(({ imputed: _i, ...r }) => r), battery: extra.battery, filename: extra.filename };
    const res = await fetch(`${url}/api/forecast`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`service returned ${res.status}`);
    const j = (await res.json()) as { source?: string; model_info?: { quickml_error?: string; note?: string }; hours?: { timestamp: string; predicted_kw: number }[] };
    const byTs = new Map((j.hours ?? []).map((p) => [p.timestamp, Number(p.predicted_kw)]));
    const preds = rows.map((r) => byTs.get(r.timestamp));
    if (preds.some((p) => p == null || !Number.isFinite(p))) throw new Error('service response missing predictions');
    const src: Source = j.source === 'quickml' ? 'quickml' : 'local-fallback';
    return {
      preds: preds as number[], source: src, latencyMs: Math.round(performance.now() - t0),
      note: src === 'quickml' ? 'Catalyst QuickML endpoint' : `Service used its local model: ${j.model_info?.quickml_error ?? j.model_info?.note ?? 'QuickML not configured'}`,
    };
  } catch (e) {
    return { preds: predictLocal(rows), source: 'local-fallback', note: `Forecast service unreachable (${(e as Error).name === 'AbortError' ? 'timeout' : (e as Error).message}); used on-device model` };
  } finally {
    clearTimeout(timer);
  }
}

export interface Run {
  id: string; created_at: string; input: 'sample' | 'csv' | 'form'; file?: string; window_start: string;
  source: Source; note?: string; latencyMs?: number; cleaning: CleanReport; result: Evaluation;
}

export function prepare(input: { csv?: string; rows?: RawRow[] }) {
  const raw = input.csv != null ? rowsFromCsv(input.csv) : input.rows ?? [];
  return clean(raw);
}

export async function runForecast(opts: { rows: CleanRow[]; cleaning: CleanReport; windowStart?: string; input: Run['input']; file?: string; csv?: string; battery?: Partial<BatteryConfig> }): Promise<Run> {
  const win = sliceWindow(opts.rows, opts.windowStart);
  if (!win.length) throw new Error('No valid telemetry rows to forecast.');
  const p = await predict(win, { csv: opts.csv, filename: opts.file, battery: opts.battery });
  const result = evaluate(win, p.preds, opts.battery);
  const run: Run = {
    id: `RUN-${Date.now().toString(36).toUpperCase()}`, created_at: new Date().toISOString(), input: opts.input, file: opts.file,
    window_start: win[0].timestamp, source: p.source, note: p.note, latencyMs: p.latencyMs, cleaning: opts.cleaning, result,
  };
  write(KEY_RUNS, [run, ...listRuns()].slice(0, 12));
  return run;
}

export const listRuns = (): Run[] => read<Run[]>(KEY_RUNS, []);
export const clearRuns = () => write(KEY_RUNS, []);

export async function checkService(url: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/api/health`, { signal: AbortSignal.timeout?.(10000) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, message: `Service returned ${res.status}` };
    const q = (j as { quickml_configured?: boolean; quickml?: boolean }).quickml_configured ?? (j as { quickml?: boolean }).quickml;
    return { ok: true, message: q === false ? 'Connected — QuickML not configured on the service yet' : 'Connected' };
  } catch (e) {
    return { ok: false, message: `Can't reach the service (${(e as Error).message})` };
  }
}
