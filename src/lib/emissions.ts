import type { Company, EnergyRecord } from './types';

/** Energy content used for BRSR energy totals (GJ). */
export const GJ_PER_KWH = 0.0036;
export const GJ_PER_L_DIESEL = 0.0358; // IPCC 2006 NCV 43.0 TJ/Gg × 0.832 kg/L
export const GJ_PER_KG_LPG = 0.0473; // IPCC 2006 NCV 47.3 TJ/Gg

export const DEFAULT_FACTORS = {
  grid_ef: 0.71, // kg CO₂e/kWh, CEA CO₂ Baseline Database (India grid)
  diesel_ef: 2.68, // kg CO₂e/L
  lpg_ef: 2.98, // kg CO₂e/kg
};
export const FACTOR_SOURCES = {
  grid_ef: 'CEA CO₂ Baseline Database (India national grid)',
  diesel_ef: 'IPCC 2006 default, diesel combustion',
  lpg_ef: 'IPCC 2006 default, LPG combustion',
};

/** Indian financial year label for a YYYY-MM month: April starts the year. */
export function fyOf(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
export function fyMonths(fy: string): string[] {
  const start = Number(fy.slice(0, 4));
  return Array.from({ length: 12 }, (_, i) => {
    const m = ((3 + i) % 12) + 1;
    const y = m >= 4 ? start : start + 1;
    return `${y}-${String(m).padStart(2, '0')}`;
  });
}
export function prevFy(fy: string): string {
  const s = Number(fy.slice(0, 4)) - 1;
  return `${s}-${String((s + 1) % 100).padStart(2, '0')}`;
}
export const currentFy = () => {
  const d = new Date();
  return fyOf(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
};

export interface Totals {
  grid_kwh: number;
  renewable_kwh: number;
  diesel_l: number;
  lpg_kg: number;
  electricity_gj: number;
  renewable_gj: number;
  fuel_gj: number;
  total_gj: number;
  scope1_t: number;
  scope2_t: number;
  records: number;
  evidenced: number;
}

export function totals(records: EnergyRecord[], c: Pick<Company, 'grid_ef' | 'diesel_ef' | 'lpg_ef'>): Totals {
  const t = records.reduce(
    (a, r) => ({
      grid_kwh: a.grid_kwh + r.grid_kwh,
      renewable_kwh: a.renewable_kwh + r.renewable_kwh,
      diesel_l: a.diesel_l + r.diesel_l,
      lpg_kg: a.lpg_kg + r.lpg_kg,
      evidenced: a.evidenced + (r.evidence_id ? 1 : 0),
    }),
    { grid_kwh: 0, renewable_kwh: 0, diesel_l: 0, lpg_kg: 0, evidenced: 0 },
  );
  const electricity_gj = (t.grid_kwh + t.renewable_kwh) * GJ_PER_KWH;
  const renewable_gj = t.renewable_kwh * GJ_PER_KWH;
  const fuel_gj = t.diesel_l * GJ_PER_L_DIESEL + t.lpg_kg * GJ_PER_KG_LPG;
  return {
    ...t,
    electricity_gj,
    renewable_gj,
    fuel_gj,
    total_gj: electricity_gj + fuel_gj,
    scope1_t: (t.diesel_l * c.diesel_ef + t.lpg_kg * c.lpg_ef) / 1000,
    scope2_t: (t.grid_kwh * c.grid_ef) / 1000,
    records: records.length,
  };
}

export const pctChange = (now: number, before: number) => (before ? ((now - before) / before) * 100 : null);
