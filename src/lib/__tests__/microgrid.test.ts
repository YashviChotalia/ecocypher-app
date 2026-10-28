import { describe, expect, it } from 'vitest';
import { clean, evaluate, gridMode, isOverload, parseTs, predictLocal, rowsFromCsv, type RawRow } from '../microgrid/engine';
import { SAMPLE_CSV } from '../microgrid/forecast';
import fx from './microgrid_py_fixture.json';

describe('transition controller rules (HackSphere §6)', () => {
  it('renewable when demand > 160 or hour 18–22 inclusive, else main grid', () => {
    expect(gridMode(160, 12)).toBe('MAIN_GRID');
    expect(gridMode(160.01, 12)).toBe('RENEWABLE_STORAGE');
    expect(gridMode(50, 17)).toBe('MAIN_GRID');
    expect(gridMode(50, 18)).toBe('RENEWABLE_STORAGE');
    expect(gridMode(50, 22)).toBe('RENEWABLE_STORAGE');
    expect(gridMode(50, 23)).toBe('MAIN_GRID');
  });
  it('overload at >= 200 kW regardless of mode', () => {
    expect(isOverload(199.99)).toBe(false);
    expect(isOverload(200)).toBe(true);
  });
  it('emits a signal only on mode change', () => {
    const rows = ['2024-01-01 16:00:00', '2024-01-01 17:00:00', '2024-01-01 18:00:00', '2024-01-01 23:00:00']
      .map((t) => ({ timestamp: t, ambient_temp_c: 20, humidity_pct: 50, solar_irradiance_wm2: 0, imputed: false }));
    const ev = evaluate(rows, [100, 120, 130, 210]);
    expect(ev.signals.map((s) => s.signal)).toEqual(['SWITCH_TO_MAIN_GRID', 'SWITCH_TO_BATTERY']);
    expect(ev.hours[3].grid_mode).toBe('RENEWABLE_STORAGE');
    expect(ev.alerts.filter((a) => a.type === 'CRITICAL_OVERLOAD')).toHaveLength(1);
  });
});

describe('parity with the Python AppSail engine', () => {
  const raw: RawRow[] = rowsFromCsv(SAMPLE_CSV);
  raw.push({ timestamp: 'bad', ambient_temp_c: '1', humidity_pct: '2', solar_irradiance_wm2: '3' });
  raw.push({ timestamp: '2015-06-16 15:00:00', ambient_temp_c: '', humidity_pct: '101', solar_irradiance_wm2: '-5' });
  raw[5].ambient_temp_c = 'nan';
  raw[7].humidity_pct = '130';
  raw.splice(10, 2);
  const { rows, report } = clean(raw);

  it('cleaning report matches', () => {
    expect(report).toEqual(fx.report);
  });
  it('cleaned rows match', () => {
    expect(rows.slice(0, 40)).toEqual(fx.rows);
  });
  it('local model predictions match', () => {
    const p = predictLocal(rows);
    p.forEach((v, i) => expect(Math.abs(v - fx.preds[i])).toBeLessThanOrEqual(0.011));
  });
  it('24h evaluation matches', () => {
    const ev = evaluate(rows.slice(0, 24), fx.preds.slice(0, 24));
    expect(ev.summary).toEqual(fx.ev24);
    expect(ev.signals.map((s) => [s.timestamp, s.signal])).toEqual(fx.signals.map((s) => [s.timestamp, s.signal]));
    expect(ev.hours.map((h) => h.soc_pct)).toEqual(fx.socs);
  });
  it('parses common timestamp formats', () => {
    for (const s of ['2024-03-05 07:00:00', '2024-03-05T07:00', '05-03-2024 07:00', '05/03/2024 07:00:00', '2024/03/05 07:00', '2024-03-05 07:00:00+05:30'])
      expect(parseTs(s)?.toISOString()).toBe('2024-03-05T07:00:00.000Z');
    expect(parseTs('03/25/2024 07:00')?.toISOString()).toBe('2024-03-25T07:00:00.000Z');
    expect(parseTs('nope')).toBeNull();
  });
});
