import { sha256Hex } from './hash';

/** An MRV evidence record as issued by the EcoCypher impact platform. */
export interface MrvRecord {
  evidence_id: string;
  title: string;
  canonical_json: string;
  sha256: string;
  anchor_status: 'ANCHORED' | 'SIMULATED' | 'PENDING';
  onchain_hash?: string;
  tx_hash?: string;
  audited: boolean;
  source: 'platform' | 'sample';
}

const SAMPLES: MrvRecord[] = [
  {
    evidence_id: 'EVD-88A9F34C2B10', title: 'Chiller setpoint reset + VFD scheduling',
    canonical_json: '{"baseline_kwh":52400.0,"building_id":"BLD-HQ-BANGALORE-01","co2e_reduction_kg":7526.0,"economic_saving":95400.0,"intervention_id":"INT-2026-BLD01-HVAC-01","post_intervention_kwh":41800.0,"savings_kwh":10600.0,"schema_version":"1.0.0"}',
    sha256: 'ae9bba0c1acfd74fe8b1689dadb655eec7318def9dd9ccdad34d89aa3a205b3b', anchor_status: 'SIMULATED', audited: false, source: 'sample',
  },
  {
    evidence_id: 'EVD-9D04B7E2C15A', title: 'High-bay LED retrofit with daylight sensors',
    canonical_json: '{"baseline_kwh":31800,"building_id":"BLD-CAMPUS-MUMBAI-02","co2e_reduction_kg":5289.5,"economic_saving":63325,"intervention_id":"INT-2026-BLD02-LED-02","post_intervention_kwh":24350,"savings_kwh":7450,"schema_version":"1.0.0"}',
    sha256: '5fdc0a4916b1d7f76865ac5abf3003fabde3a11968915c1cebcea2a2538e8eb4',
    onchain_hash: '0x5fdc0a4916b1d7f76865ac5abf3003fabde3a11968915c1cebcea2a2538e8eb4', anchor_status: 'ANCHORED', audited: true, source: 'sample',
  },
];

const API_KEY = 'ecocypher-impact-api';
export const getImpactApi = () => { try { return localStorage.getItem(API_KEY) ?? ''; } catch { return ''; } };
export const setImpactApi = (v: string) => { try { localStorage.setItem(API_KEY, v.trim().replace(/\/+$/, '')); } catch { /* ignore */ } };

export async function fetchMrv(id: string): Promise<MrvRecord> {
  const ref = id.trim().toUpperCase();
  const base = getImpactApi();
  if (base) {
    try {
      const res = await fetch(`${base}/api/mrv/${encodeURIComponent(ref)}`, { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const m = await res.json() as { evidence_id: string; intervention_id: string; canonical_json: string; hash?: string; evidence_hash?: string; blockchain?: { anchor_status?: string; tx_hash?: string }; external_verification?: string };
        let onchain: string | undefined;
        try {
          const v = await (await fetch(`${base}/api/verify/${encodeURIComponent(ref)}`, { signal: AbortSignal.timeout(8000) })).json() as { onchain_hash?: string };
          onchain = v.onchain_hash || undefined;
        } catch { /* optional */ }
        return {
          evidence_id: m.evidence_id, title: m.intervention_id, canonical_json: m.canonical_json, sha256: m.evidence_hash || m.hash || '',
          anchor_status: (m.blockchain?.anchor_status as MrvRecord['anchor_status']) || 'PENDING', onchain_hash: onchain,
          tx_hash: m.blockchain?.tx_hash, audited: m.external_verification === 'PERFORMED', source: 'platform',
        };
      }
      if (res.status !== 404) throw new Error(`Impact API answered ${res.status}`);
    } catch (e) {
      if (!SAMPLES.some((s) => s.evidence_id === ref)) throw new Error(`Couldn't reach the impact API (${(e as Error).message}).`);
    }
  }
  const s = SAMPLES.find((x) => x.evidence_id === ref);
  if (!s) throw new Error(base ? `No MRV record ${ref} on the impact API.` : `No MRV record ${ref}. Add your impact API address in Settings to import live records, or try EVD-88A9F34C2B10.`);
  return s;
}

/** Re-hash an MRV record and pull out its metrics. */
export async function inspectMrv(r: MrvRecord) {
  const computed = await sha256Hex(r.canonical_json);
  const m = JSON.parse(r.canonical_json) as { baseline_kwh?: number; savings_kwh?: number; co2e_reduction_kg?: number; economic_saving?: number };
  return {
    intact: computed === r.sha256,
    computed,
    metrics: { baseline_kwh: m.baseline_kwh, savings_kwh: m.savings_kwh, co2e_kg: m.co2e_reduction_kg, money_inr: m.economic_saving },
  };
}
