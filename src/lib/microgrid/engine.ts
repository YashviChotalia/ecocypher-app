/**
 * EcoCypher Microgrid engine (HackSphere 3.0) — TypeScript port of the Catalyst AppSail
 * Python modules (cleaning.py, features.py, forecast.py local model, controller.py).
 * Runs fully on-device so the APK works offline; QuickML is reached through the AppSail
 * service (see forecast.ts) because the QuickML OAuth secret must never ship in an app.
 */

/* ── Timestamps (naive local hours, handled in UTC to avoid device-timezone shifts) ── */
export type Ts = Date;

const PATTERNS: { re: RegExp; order: 'ymd' | 'dmy' | 'mdy' }[] = [
  { re: /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/, order: 'ymd' },
  { re: /^(\d{1,2})-(\d{1,2})-(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/, order: 'dmy' },
  { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/, order: 'dmy' },
];

export function parseTs(value: unknown): Ts | null {
  if (value instanceof Date) return isNaN(+value) ? null : value;
  let s = String(value ?? '').trim().replace('Z', '');
  if (!s) return null;
  const plus = s.slice(10).search(/[+]/);
  if (plus >= 0) s = s.slice(0, 10 + plus);
  for (const p of PATTERNS) {
    const m = s.match(p.re);
    if (!m) continue;
    let y: number, mo: number, d: number;
    if (p.order === 'ymd') [y, mo, d] = [+m[1], +m[2], +m[3]];
    else {
      [d, mo, y] = [+m[1], +m[2], +m[3]];
      if (p.order === 'dmy' && mo > 12 && d <= 12) [d, mo] = [mo, d]; // mm/dd/yyyy fallback
    }
    const h = +(m[4] ?? 0), mi = +(m[5] ?? 0), se = +(m[6] ?? 0);
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) return null;
    const t = new Date(Date.UTC(y, mo - 1, d, h, mi, se));
    if (t.getUTCDate() !== d) return null; // e.g. 31 Feb
    return t;
  }
  return null;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const fmtTs = (t: Ts) =>
  `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}`;
export const hourOf = (ts: string) => parseTs(ts)!.getUTCHours();
const round = (x: number, d: number) => { const f = 10 ** d; return Math.round(x * f) / f; };

/* ── Features (identical to features.py / quickml/train_quickml.csv) ── */
export const COOLING_BASE_C = 24;
export const HEATING_BASE_C = 10;
export const QUICKML_FEATURES = [
  'hour', 'day_of_week', 'is_weekend', 'ambient_temp_c', 'humidity_pct', 'solar_irradiance_wm2',
  'cooling_degree_c', 'heating_degree_c', 'is_night', 'is_morning_ramp', 'is_morning_peak',
  'is_evening_peak', 'is_late_evening', 'hour_sin', 'hour_cos',
] as const;
export type FeatureRow = Record<(typeof QUICKML_FEATURES)[number], number>;

export function engineer(ts: Ts, temp: number, hum: number, solar: number): FeatureRow {
  const h = ts.getUTCHours();
  const dow = (ts.getUTCDay() + 6) % 7; // Monday = 0, like Python weekday()
  return {
    hour: h, day_of_week: dow, is_weekend: dow >= 5 ? 1 : 0,
    ambient_temp_c: round(temp, 3), humidity_pct: round(hum, 3), solar_irradiance_wm2: round(solar, 3),
    cooling_degree_c: round(Math.max(0, temp - COOLING_BASE_C), 3),
    heating_degree_c: round(Math.max(0, HEATING_BASE_C - temp), 3),
    is_night: h <= 5 ? 1 : 0, is_morning_ramp: h === 6 ? 1 : 0, is_morning_peak: h >= 7 && h <= 9 ? 1 : 0,
    is_evening_peak: h >= 18 && h <= 22 ? 1 : 0, is_late_evening: h === 23 ? 1 : 0,
    hour_sin: round(Math.sin((2 * Math.PI * h) / 24), 6), hour_cos: round(Math.cos((2 * Math.PI * h) / 24), 6),
  };
}

/* ── Local model: linear regression on the QuickML features (appsail/microgrid/local_model.json) ── */
export const LOCAL_MODEL = {
  intercept: 145.42623657571153,
  coef: [0.04750726948323672, 0.009730182613826077, -0.30414760763922444, -0.08019112092008658, -0.01866047609019495,
    0.0020973400374436207, 8.674841040645866, -0.20094445307294068, -52.402145854532826, -9.910326327351788,
    30.481064741633027, 54.460793493438494, -33.508848459999555, -0.21719111176555378, -0.22147472341365723],
  clip: [25.55, 459.495] as [number, number],
  holdoutRmse: 8.3,
};

export function predictLocal(rows: CleanRow[]): number[] {
  const [lo, hi] = LOCAL_MODEL.clip;
  return rows.map((r) => {
    const f = engineer(parseTs(r.timestamp)!, r.ambient_temp_c, r.humidity_pct, r.solar_irradiance_wm2);
    const y = QUICKML_FEATURES.reduce((acc, k, i) => acc + LOCAL_MODEL.coef[i] * f[k], LOCAL_MODEL.intercept);
    return round(Math.min(hi, Math.max(lo, y)), 2);
  });
}

/* ── Ingestion & cleaning (cleaning.py) ── */
export const FIELDS = ['ambient_temp_c', 'humidity_pct', 'solar_irradiance_wm2'] as const;
type Field = (typeof FIELDS)[number];
const ALIASES: Record<'timestamp' | Field, string[]> = {
  timestamp: ['timestamp', 'time', 'datetime', 'date_time', 'ts'],
  ambient_temp_c: ['ambient_temp_c', 'temp', 'temperature', 'ambient_temp', 'temp_c', 'outdoor_temp_c'],
  humidity_pct: ['humidity_pct', 'humidity', 'rh', 'relative_humidity'],
  solar_irradiance_wm2: ['solar_irradiance_wm2', 'solar', 'irradiance', 'solar_irradiance', 'ghi', 'solar_radiation_w_m2'],
};
export const LIMITS: Record<Field, [number, number]> = {
  ambient_temp_c: [-30, 60], humidity_pct: [0, 100], solar_irradiance_wm2: [0, 1400],
};
const DEFAULTS = { ambient_temp_c: 18.5, humidity_pct: 70.7 };
export const SOLAR_BY_HOUR = [0, 0, 0, 0, 0, 13, 70, 156, 221, 260, 288, 294, 281, 241, 186, 115, 51, 15, 0, 0, 0, 0, 0, 0];

export interface RawRow { timestamp?: unknown; ambient_temp_c?: unknown; humidity_pct?: unknown; solar_irradiance_wm2?: unknown }
export interface CleanRow { timestamp: string; ambient_temp_c: number; humidity_pct: number; solar_irradiance_wm2: number; imputed: boolean }
export interface CleanReport {
  input_rows: number; dropped_bad_timestamp: number; duplicates_removed: number; out_of_range_fixed: number;
  missing_filled: number; gaps_filled: number; clean_rows: number; notes: string[];
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const s = String(v).trim().replace(',', '.');
  if (!s || ['nan', 'na', 'null', 'none', '-', '?'].includes(s.toLowerCase())) return null;
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null;
  const x = Number(s);
  return Number.isFinite(x) ? x : null;
}

/** Minimal RFC 4180 CSV parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  const t = text.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim() !== '')) out.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) out.push(row);
  return out;
}

export function rowsFromCsv(text: string): RawRow[] {
  const table = parseCsv(text);
  if (!table.length) throw new Error('CSV has no header row');
  const norm = table[0].map((h) => h.trim().toLowerCase().replace(/ /g, '_'));
  const col: Partial<Record<keyof typeof ALIASES, number>> = {};
  (Object.keys(ALIASES) as (keyof typeof ALIASES)[]).forEach((k) => {
    for (const n of ALIASES[k]) { const i = norm.indexOf(n); if (i >= 0) { col[k] = i; break; } }
  });
  if (col.timestamp == null) throw new Error("CSV needs a 'timestamp' column");
  return table.slice(1).map((r) => {
    const o: RawRow = {};
    (Object.keys(col) as (keyof typeof ALIASES)[]).forEach((k) => { (o as Record<string, unknown>)[k] = r[col[k]!]; });
    return o;
  });
}

export function clean(rows: RawRow[]): { rows: CleanRow[]; report: CleanReport } {
  const report: CleanReport = { input_rows: rows.length, dropped_bad_timestamp: 0, duplicates_removed: 0, out_of_range_fixed: 0, missing_filled: 0, gaps_filled: 0, clean_rows: 0, notes: [] };
  type Rec = { ts: Ts; imputed?: boolean } & Record<Field, number | null>;
  const parsed: Rec[] = [];
  for (const r of rows) {
    const t0 = parseTs(r.timestamp);
    if (!t0) { report.dropped_bad_timestamp++; continue; }
    const ts = new Date(t0); ts.setUTCMinutes(0, 0, 0);
    const rec = { ts } as Rec;
    for (const f of FIELDS) {
      let v = num(r[f]);
      const [lo, hi] = LIMITS[f];
      if (v != null && !(v >= lo && v <= hi)) {
        if (f === 'solar_irradiance_wm2' && v < 0) v = 0;
        else if (f === 'humidity_pct' && v > 100 && v <= 105) v = 100;
        else v = null;
        report.out_of_range_fixed++;
      }
      rec[f] = v;
    }
    parsed.push(rec);
  }
  parsed.sort((a, b) => +a.ts - +b.ts);
  const uniq: Rec[] = [];
  for (const rec of parsed) {
    const last = uniq[uniq.length - 1];
    if (last && +last.ts === +rec.ts) {
      report.duplicates_removed++;
      for (const f of FIELDS) if (last[f] == null) last[f] = rec[f];
      continue;
    }
    uniq.push(rec);
  }
  const filled: Rec[] = [];
  for (const rec of uniq) {
    const last = filled[filled.length - 1];
    if (last) {
      const gap = Math.floor((+rec.ts - +last.ts) / 3_600_000);
      if (gap > 1 && gap <= 6) {
        for (let k = 1; k < gap; k++) {
          filled.push({ ts: new Date(+filled[filled.length - 1].ts + 3_600_000), ambient_temp_c: null, humidity_pct: null, solar_irradiance_wm2: null, imputed: true });
          report.gaps_filled++;
        }
      }
    }
    filled.push(rec);
  }
  for (const f of FIELDS) {
    const idx = filled.map((r, i) => (r[f] != null ? i : -1)).filter((i) => i >= 0);
    filled.forEach((r, i) => {
      if (r[f] != null) return;
      report.missing_filled++;
      let prev: number | null = null, nxt: number | null = null;
      for (const j of idx) { if (j < i) prev = j; else if (j > i) { nxt = j; break; } }
      const hr = r.ts.getUTCHours();
      if (f === 'solar_irradiance_wm2' && (prev == null || nxt == null || nxt - prev > 3)) r[f] = SOLAR_BY_HOUR[hr];
      else if (prev != null && nxt != null) {
        const w = (i - prev) / (nxt - prev);
        r[f] = filled[prev][f]! + w * (filled[nxt][f]! - filled[prev][f]!);
      } else if (prev != null || nxt != null) r[f] = filled[(prev ?? nxt)!][f];
      else r[f] = f === 'solar_irradiance_wm2' ? SOLAR_BY_HOUR[hr] : DEFAULTS[f];
      r.imputed = true;
    });
  }
  const out: CleanRow[] = filled.map((r) => ({
    timestamp: fmtTs(r.ts),
    ambient_temp_c: round(r.ambient_temp_c!, 2), humidity_pct: round(r.humidity_pct!, 2),
    solar_irradiance_wm2: round(r.solar_irradiance_wm2!, 1), imputed: !!r.imputed,
  }));
  report.clean_rows = out.length;
  if (!out.length) report.notes.push('No valid rows after cleaning.');
  return { rows: out, report };
}

/* ── Transition controller + battery SoC (controller.py, HackSphere §6) ── */
export const DEMAND_THRESHOLD_KW = 160;
export const OVERLOAD_KW = 200;
export const PEAK_START = 18;
export const PEAK_END = 22;
export type GridMode = 'RENEWABLE_STORAGE' | 'MAIN_GRID';

export interface BatteryConfig {
  capacity_kwh: number; initial_soc_pct: number; min_soc_pct: number; max_charge_kw: number;
  max_discharge_kw: number; pv_capacity_kw: number; grid_charge_kw: number; efficiency: number;
}
export const DEFAULT_BATTERY: BatteryConfig = {
  capacity_kwh: 2000, initial_soc_pct: 80, min_soc_pct: 10, max_charge_kw: 150,
  max_discharge_kw: 320, pv_capacity_kw: 400, grid_charge_kw: 40, efficiency: 0.95,
};

export const gridMode = (kw: number, hour: number): GridMode =>
  kw > DEMAND_THRESHOLD_KW || (hour >= PEAK_START && hour <= PEAK_END) ? 'RENEWABLE_STORAGE' : 'MAIN_GRID';
export const isOverload = (kw: number) => kw >= OVERLOAD_KW;

export function reason(kw: number, hour: number): string {
  const parts: string[] = [];
  if (kw > DEMAND_THRESHOLD_KW) parts.push(`demand ${kw.toFixed(1)} kW > ${DEMAND_THRESHOLD_KW} kW`);
  if (hour >= PEAK_START && hour <= PEAK_END) parts.push(`evening peak window ${pad(PEAK_START)}:00–${pad(PEAK_END)}:00`);
  if (!parts.length) parts.push(`demand ${kw.toFixed(1)} kW ≤ ${DEMAND_THRESHOLD_KW} kW and outside 18–22h`);
  return parts.join('; ');
}

export interface HourResult {
  timestamp: string; hour: number; predicted_kw: number; grid_mode: GridMode; overload_alert: boolean;
  dispatch_signal: 'BATTERY' | 'GRID'; reason: string; pv_kw: number; battery_kw: number; grid_import_kw: number;
  soc_start_pct: number; soc_pct: number; ambient_temp_c: number; humidity_pct: number; solar_irradiance_wm2: number; imputed: boolean;
}
export interface Signal { timestamp: string; hour: number; signal: 'SWITCH_TO_BATTERY' | 'SWITCH_TO_MAIN_GRID'; from: GridMode | 'INIT'; to: GridMode; reason: string }
export interface Alert { timestamp: string; level: 'CRITICAL' | 'WARNING'; type: 'CRITICAL_OVERLOAD' | 'BATTERY_RESERVE'; message: string }
export interface Summary {
  hours: number; peak_kw: number; peak_at: string | null; avg_kw: number; energy_kwh: number; renewable_hours: number;
  grid_hours: number; overload_hours: number; transitions: number; final_soc_pct: number | null; min_soc_pct: number | null; current_mode: GridMode | null;
}
export interface Evaluation { hours: HourResult[]; signals: Signal[]; alerts: Alert[]; summary: Summary; battery: BatteryConfig }

export function evaluate(rows: CleanRow[], preds: number[], battery: Partial<BatteryConfig> = {}): Evaluation {
  const b: BatteryConfig = { ...DEFAULT_BATTERY };
  (Object.keys(battery) as (keyof BatteryConfig)[]).forEach((k) => {
    const v = Number(battery[k]);
    if (k in DEFAULT_BATTERY && battery[k] != null && Number.isFinite(v)) b[k] = v;
  });
  const cap = Math.max(1, b.capacity_kwh), eff = Math.min(1, Math.max(0.01, b.efficiency));
  let energy = (cap * b.initial_soc_pct) / 100;
  const floor = (cap * b.min_soc_pct) / 100;
  const hours: HourResult[] = [], signals: Signal[] = [], alerts: Alert[] = [];
  let prev: GridMode | null = null;
  rows.forEach((r, i) => {
    const p = preds[i];
    const h = hourOf(r.timestamp);
    const mode = gridMode(p, h);
    const overload = isOverload(p);
    const pv = (Math.max(0, r.solar_irradiance_wm2) / 1000) * b.pv_capacity_kw;
    const socStart = (energy / cap) * 100;
    let batteryKw = 0, gridKw = 0, shortfall = 0;
    if (mode === 'RENEWABLE_STORAGE') {
      const net = Math.max(0, p - pv), surplus = Math.max(0, pv - p);
      const available = Math.max(0, energy - floor) * eff;
      const discharge = Math.min(net, b.max_discharge_kw, available);
      energy -= discharge / eff;
      batteryKw = discharge;
      shortfall = net - discharge;
      gridKw = shortfall;
      if (surplus > 0) {
        const ch = Math.min(surplus, b.max_charge_kw, (cap - energy) / eff);
        energy += ch * eff;
        batteryKw -= ch;
      }
    } else {
      gridKw = Math.max(0, p - pv);
      const src = Math.max(0, pv - p) + b.grid_charge_kw;
      const ch = Math.min(src, b.max_charge_kw, Math.max(0, cap - energy) / eff);
      energy += ch * eff;
      batteryKw = -ch;
      gridKw += Math.max(0, ch - Math.max(0, pv - p));
    }
    const socEnd = (energy / cap) * 100;
    if (mode !== prev) {
      signals.push({ timestamp: r.timestamp, hour: h, signal: mode === 'RENEWABLE_STORAGE' ? 'SWITCH_TO_BATTERY' : 'SWITCH_TO_MAIN_GRID', from: prev ?? 'INIT', to: mode, reason: reason(p, h) });
    }
    if (overload) alerts.push({ timestamp: r.timestamp, level: 'CRITICAL', type: 'CRITICAL_OVERLOAD', message: `Predicted demand ${p.toFixed(1)} kW ≥ ${OVERLOAD_KW} kW` });
    if (mode === 'RENEWABLE_STORAGE' && shortfall > 0.5) alerts.push({ timestamp: r.timestamp, level: 'WARNING', type: 'BATTERY_RESERVE', message: `Battery at reserve floor; ${shortfall.toFixed(1)} kW backup import needed` });
    prev = mode;
    hours.push({
      timestamp: r.timestamp, hour: h, predicted_kw: round(p, 2), grid_mode: mode, overload_alert: overload,
      dispatch_signal: mode === 'RENEWABLE_STORAGE' ? 'BATTERY' : 'GRID', reason: reason(p, h),
      pv_kw: round(pv, 1), battery_kw: round(batteryKw, 1), grid_import_kw: round(gridKw, 1),
      soc_start_pct: round(socStart, 1), soc_pct: round(socEnd, 1),
      ambient_temp_c: r.ambient_temp_c, humidity_pct: r.humidity_pct, solar_irradiance_wm2: r.solar_irradiance_wm2, imputed: r.imputed,
    });
  });
  const n = hours.length || 1;
  const peak = hours.reduce<HourResult | null>((a, x) => (!a || x.predicted_kw > a.predicted_kw ? x : a), null);
  const summary: Summary = {
    hours: hours.length, peak_kw: peak?.predicted_kw ?? 0, peak_at: peak?.timestamp ?? null,
    avg_kw: round(hours.reduce((a, x) => a + x.predicted_kw, 0) / n, 2),
    energy_kwh: round(hours.reduce((a, x) => a + x.predicted_kw, 0), 1),
    renewable_hours: hours.filter((x) => x.grid_mode === 'RENEWABLE_STORAGE').length,
    grid_hours: hours.filter((x) => x.grid_mode === 'MAIN_GRID').length,
    overload_hours: hours.filter((x) => x.overload_alert).length,
    transitions: signals.length,
    final_soc_pct: hours.length ? hours[hours.length - 1].soc_pct : null,
    min_soc_pct: hours.length ? Math.min(...hours.map((x) => x.soc_pct)) : null,
    current_mode: hours[0]?.grid_mode ?? null,
  };
  return { hours, signals, alerts, summary, battery: b };
}

/** 24-hour forecast windows available in a cleaned series (start indices on hour boundaries). */
export function windowStarts(rows: CleanRow[]): string[] {
  const out = rows.filter((r, i) => i === 0 || r.timestamp.endsWith(' 00:00:00')).map((r) => r.timestamp);
  return out.filter((t, i) => rows.length - rows.findIndex((r) => r.timestamp === t) >= 24 || i === 0);
}
export function sliceWindow(rows: CleanRow[], start?: string, hours = 24): CleanRow[] {
  const i = Math.max(0, start ? rows.findIndex((r) => r.timestamp === start) : 0);
  return rows.slice(i, i + hours);
}
