import { evidenceCanonical, sha256Hex } from '../hash';
import type { Activity, Claim, Company, EnergyRecord, Evidence, Facility, Member } from '../types';

export const DEMO_USER = { id: 'demo-user', email: 'esg.manager@aster-demo.in', name: 'Demo ESG Manager' };
const CID = 'demo-aster';

export interface DemoDB {
  company: Company;
  members: Member[];
  facilities: Facility[];
  energy: EnergyRecord[];
  evidence: Evidence[];
  claims: Claim[];
  activity: Activity[];
  invites: { id: string; company_id: string; email: string; role: Member['role']; created_at: string }[];
}

const F = { surat: 'fac-surat', tiruppur: 'fac-tiruppur', mumbai: 'fac-mumbai' };

function months(from: string, to: string) {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

/** Deterministic, plausible monthly activity data (FY 2024-25 to mid FY 2026-27). */
function energyData(): EnergyRecord[] {
  const out: EnergyRecord[] = [];
  const base = { [F.surat]: 410000, [F.tiruppur]: 285000, [F.mumbai]: 62000 };
  months('2024-04', '2026-09').forEach((month, i) => {
    const mo = Number(month.slice(5));
    const summer = [4, 5, 6].includes(mo) ? 1.12 : [12, 1, 2].includes(mo) ? 0.93 : 1;
    const efficiency = month >= '2025-04' ? 0.94 : 1; // FY25-26 efficiency programme
    const wobble = 1 + Math.sin(i * 1.7) * 0.025;
    for (const [fid, b] of Object.entries(base)) {
      let total = b * summer * efficiency * wobble;
      let renewable = 0;
      if (fid === F.surat && month >= '2025-10') renewable = Math.round(60300 * (mo >= 3 && mo <= 5 ? 1.12 : [7, 8].includes(mo) ? 0.82 : 1));
      if (fid === F.surat && month >= '2025-10' && month <= '2026-03') renewable = [59800, 58400, 57600, 60100, 61900, 64200][months('2025-10', '2026-03').indexOf(month)];
      total = Math.round(total);
      out.push({
        id: `en-${fid}-${month}`,
        company_id: CID,
        facility_id: fid,
        month,
        grid_kwh: Math.max(0, total - renewable),
        renewable_kwh: renewable,
        diesel_l: fid === F.mumbai ? 180 : Math.round((fid === F.surat ? 2400 : 1600) * wobble),
        lpg_kg: fid === F.tiruppur ? Math.round(9800 * (month >= '2025-04' ? 0.95 : 1) * wobble) : fid === F.mumbai ? 120 : 0,
        evidence_id: fid === F.surat && month >= '2025-10' && month <= '2026-03' ? 'ev-solar' : month < '2026-04' && fid !== F.mumbai ? 'ev-bills' : null,
        created_at: `${month}-28T10:00:00Z`,
      });
    }
  });
  return out;
}

async function mrv(id: string, ref: string, title: string, facility: string, period: [string, string], m: { baseline: number; savings: number; tariff: number }, extra: Partial<Evidence>, displayed?: Partial<Evidence['metrics']>): Promise<Evidence> {
  const co2 = Math.round(m.savings * 0.71 * 10) / 10;
  const canonical = JSON.stringify(Object.fromEntries(Object.entries({
    baseline_kwh: m.baseline, building_id: facility.toUpperCase(), co2e_reduction_kg: co2, economic_saving: m.savings * m.tariff,
    intervention_id: id.toUpperCase(), post_intervention_kwh: m.baseline - m.savings, savings_kwh: m.savings, schema_version: '1.0.0',
  }).sort(([a], [b]) => a.localeCompare(b))));
  return {
    id, company_id: CID, ref, kind: 'mrv', title, facility_id: facility, period_start: period[0], period_end: period[1],
    metrics: { baseline_kwh: m.baseline, savings_kwh: m.savings, co2e_kg: co2, money_inr: m.savings * m.tariff, ...displayed },
    canonical_json: canonical, sha256: await sha256Hex(canonical), anchor_status: 'SIMULATED', audited: false,
    created_by: DEMO_USER.name, created_at: `${period[1]}T12:00:00Z`, ...extra,
  };
}

async function doc(id: string, ref: string, kind: Evidence['kind'], title: string, facility: string | null, period: [string, string], metrics: Evidence['metrics'], file: [string, number], extra: Partial<Evidence> = {}): Promise<Evidence> {
  const file_sha256 = await sha256Hex(`${file[0]}:${file[1]}:${ref}`);
  const base = { company_id: CID, ref, kind, title, facility_id: facility, period_start: period[0], period_end: period[1], metrics, file_sha256 };
  const canonical = evidenceCanonical(base);
  return {
    id, ...base, canonical_json: canonical, sha256: await sha256Hex(canonical), anchor_status: 'NONE', audited: false,
    file_name: file[0], file_size: file[1], created_by: DEMO_USER.name, created_at: `${period[1]}T15:00:00Z`, ...extra,
  };
}

export async function buildDemo(): Promise<DemoDB> {
  const company: Company = {
    id: CID, name: 'Aster Textiles Ltd (demo)', industry: 'Textiles & apparel', cin: 'U17110GJ2009PLC000000',
    grid_ef: 0.71, diesel_ef: 2.68, lpg_ef: 2.98, turnover_cr: { '2024-25': 386, '2025-26': 412, '2026-27': 205 }, created_at: '2024-04-01T00:00:00Z',
  };
  const facilities: Facility[] = [
    { id: F.surat, company_id: CID, name: 'Surat weaving unit', city: 'Surat, Gujarat', kind: 'Manufacturing' },
    { id: F.tiruppur, company_id: CID, name: 'Tiruppur processing unit', city: 'Tiruppur, Tamil Nadu', kind: 'Dyeing & finishing' },
    { id: F.mumbai, company_id: CID, name: 'Mumbai head office', city: 'Mumbai, Maharashtra', kind: 'Office' },
  ];
  const anchoredMrv = await mrv('ev-air', 'EVD-7A21C9E04B3D', 'Compressed-air leak repair programme', F.surat, ['2025-04-01', '2026-03-31'],
    { baseline: 612000, savings: 48200, tariff: 8.5 }, { anchor_status: 'ANCHORED', audited: true, auditor: 'Independent M&V auditor (demo)', tx_hash: '0x4be1f0c27d93a8e5c6b10f2e7a94d3b85c0e61f7a2d49b3c8e05f71a6d2c9b40e' });
  anchoredMrv.onchain_hash = `0x${anchoredMrv.sha256}`;
  const evidence: Evidence[] = [
    anchoredMrv,
    await doc('ev-solar', 'EVD-5C0E83B19F42', 'meter', 'Rooftop solar generation, Surat (Oct 2025 – Mar 2026)', F.surat, ['2025-10-01', '2026-03-31'],
      { renewable_kwh: 362000 }, ['surat_solar_inverter_export.csv', 48211], { audited: true, auditor: 'Net-meter readings certified by DGVCL (demo)' }),
    await doc('ev-bills', 'EVD-B19D44A0E7C6', 'invoice', 'Electricity bills FY 2025-26 (DGVCL, TANGEDCO)', null, ['2025-04-01', '2026-03-31'],
      {}, ['electricity_bills_fy2025-26.pdf', 3184022]),
    await doc('ev-audit', 'EVD-E3F2109CA7B5', 'audit', 'Detailed energy audit, Tiruppur (BEE-accredited auditor)', F.tiruppur, ['2025-06-01', '2025-07-15'],
      {}, ['tiruppur_energy_audit_2025.pdf', 2209117], { audited: true, auditor: 'BEE-accredited energy auditor (demo)' }),
    await mrv('ev-led', 'EVD-3C71D0A4E95B', 'LED retrofit with daylight sensors, Mumbai HQ', F.mumbai, ['2025-07-01', '2026-03-31'],
      { baseline: 214000, savings: 21400, tariff: 9.5 }, {}),
    // Altered after it was fingerprinted: the savings were raised from 61,000 to 96,000 kWh.
    await mrv('ev-boiler', 'EVD-B5E2904F17AC', 'Boiler economiser retrofit, Tiruppur', F.tiruppur, ['2025-08-01', '2026-03-31'],
      { baseline: 540000, savings: 61000, tariff: 8 }, {}, { savings_kwh: 96000, co2e_kg: 68160, money_inr: 768000 }),
  ];
  const now = new Date();
  const ago = (d: number) => new Date(now.getTime() - d * 86400000).toISOString();
  const claims: Claim[] = [
    { id: 'cl-1', company_id: CID, text: 'Our Surat unit generated 3,62,000 kWh of rooftop solar electricity between October 2025 and March 2026.', channel: 'annual_report', status: 'published', evidence_ids: ['ev-solar'], owner_name: 'Demo ESG Manager', publish_on: '2026-08-14', decided_by: 'Demo ESG Manager', decided_at: ago(80), created_by: 'Demo ESG Manager', created_at: ago(95), updated_at: ago(75) },
    { id: 'cl-2', company_id: CID, text: 'We cut Scope 2 emissions by 9% in FY 2025-26 compared with FY 2024-25.', channel: 'brsr', status: 'approved', evidence_ids: ['ev-bills', 'ev-solar'], owner_name: 'Demo ESG Manager', publish_on: '2026-11-30', decided_by: 'Demo ESG Manager', decided_at: ago(6), created_by: 'Demo ESG Manager', created_at: ago(12), updated_at: ago(6) },
    { id: 'cl-3', company_id: CID, text: 'Aster Textiles is a carbon neutral, eco-friendly manufacturer.', channel: 'advertising', status: 'in_review', evidence_ids: [], owner_name: 'Marketing team', publish_on: '2026-11-10', created_by: 'Marketing team', created_at: ago(3), updated_at: ago(3) },
    { id: 'cl-4', company_id: CID, text: 'The compressed-air programme at Surat saved 52,000 kWh in FY 2025-26.', channel: 'website', status: 'draft', evidence_ids: ['ev-air'], owner_name: 'Demo ESG Manager', created_by: 'Demo ESG Manager', created_at: ago(2), updated_at: ago(2) },
    { id: 'cl-5', company_id: CID, text: 'Boiler upgrades in Tiruppur saved 96,000 kWh between August 2025 and March 2026.', channel: 'press', status: 'rejected', evidence_ids: ['ev-boiler'], owner_name: 'Plant head, Tiruppur', decision_note: 'Evidence fingerprint does not match. Ask the plant team for the original M&V record.', decided_by: 'Demo ESG Manager', decided_at: ago(9), created_by: 'Plant head, Tiruppur', created_at: ago(14), updated_at: ago(9) },
    { id: 'cl-6', company_id: CID, text: 'We will source 50% of our electricity from renewables by 2030.', channel: 'social', status: 'draft', evidence_ids: [], owner_name: 'Marketing team', created_by: 'Marketing team', created_at: ago(1), updated_at: ago(1) },
  ];
  const activity: Activity[] = [
    { id: 'a1', company_id: CID, actor: 'Marketing team', action: 'submitted a claim for review', entity: 'claim', entity_id: 'cl-3', detail: claims[2].text, at: ago(3) },
    { id: 'a2', company_id: CID, actor: 'Demo ESG Manager', action: 'approved a claim', entity: 'claim', entity_id: 'cl-2', detail: claims[1].text, at: ago(6) },
    { id: 'a3', company_id: CID, actor: 'Demo ESG Manager', action: 'rejected a claim', entity: 'claim', entity_id: 'cl-5', detail: claims[4].decision_note, at: ago(9) },
    { id: 'a4', company_id: CID, actor: 'Demo ESG Manager', action: 'added evidence', entity: 'evidence', entity_id: 'ev-air', detail: anchoredMrv.title, at: ago(20) },
  ];
  return {
    company,
    members: [
      { user_id: DEMO_USER.id, company_id: CID, role: 'admin', name: DEMO_USER.name, email: DEMO_USER.email },
      { user_id: 'demo-2', company_id: CID, role: 'manager', name: 'Plant head, Tiruppur', email: 'plant.tiruppur@aster-demo.in' },
      { user_id: 'demo-3', company_id: CID, role: 'viewer', name: 'Marketing team', email: 'marketing@aster-demo.in' },
    ],
    facilities, energy: energyData(), evidence, claims, activity,
    invites: [{ id: 'inv-1', company_id: CID, email: 'cfo@aster-demo.in', role: 'viewer', created_at: ago(4) }],
  };
}
