import type { Evidence, EvidenceMetrics, IntegrityState } from './types';

/** Canonical JSON: keys sorted at every level, compact separators. */
export function canonicalize(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as object).sort()) {
        const x = (v as Record<string, unknown>)[k];
        if (x !== undefined && x !== null && x !== '') out[k] = norm(x);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(norm(value));
}

export async function sha256Hex(data: string | ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Secure hashing needs HTTPS (or localhost).');
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const buf = await subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The fields of an evidence item that are fingerprinted (EcoCypher evidence schema 1.0). */
export function evidenceCanonical(e: {
  company_id: string; ref: string; kind: string; title: string; facility_id?: string | null;
  period_start?: string | null; period_end?: string | null; metrics: EvidenceMetrics; file_sha256?: string | null;
}): string {
  return canonicalize({
    schema_version: '1.0.0',
    company_id: e.company_id,
    ref: e.ref,
    kind: e.kind,
    title: e.title,
    facility_id: e.facility_id,
    period_start: e.period_start,
    period_end: e.period_end,
    metrics: e.metrics,
    file_sha256: e.file_sha256,
  });
}

export interface IntegrityResult {
  state: IntegrityState;
  computed: string;
  chain: 'MATCHED' | 'MISMATCHED' | 'NOT_ANCHORED';
  /** HASH: the fingerprint differs. FIGURES: the MRV record is intact but the figures stored with it were changed. */
  reason?: 'HASH' | 'FIGURES';
  signed?: { savings_kwh?: number; co2e_kg?: number };
}

/**
 * Recompute the fingerprint. For records created in this app the canonical JSON is rebuilt from
 * the stored fields, so editing any field in the database is detected. Imported MRV records are
 * checked against the canonical JSON they were issued with.
 */
export async function checkIntegrity(e: Evidence): Promise<IntegrityResult> {
  const source = e.kind === 'mrv' ? e.canonical_json : evidenceCanonical(e);
  const computed = await sha256Hex(source);
  let state: IntegrityState = computed === e.sha256 ? 'INTACT' : 'TAMPERED';
  let reason: IntegrityResult['reason'] = state === 'TAMPERED' ? 'HASH' : undefined;
  let signed: IntegrityResult['signed'];
  if (e.kind === 'mrv' && state === 'INTACT') {
    // The figures stored alongside must also agree with the signed MRV record.
    try {
      const m = JSON.parse(e.canonical_json) as { savings_kwh?: number; co2e_reduction_kg?: number };
      signed = { savings_kwh: m.savings_kwh, co2e_kg: m.co2e_reduction_kg };
      const off = (a?: number, b?: number) => a != null && b != null && Math.abs(a - b) > 0.01;
      if (off(m.savings_kwh, e.metrics.savings_kwh) || off(m.co2e_reduction_kg, e.metrics.co2e_kg)) { state = 'TAMPERED'; reason = 'FIGURES'; }
    } catch {
      state = 'TAMPERED';
      reason = 'HASH';
    }
  }
  const chain = !e.onchain_hash ? 'NOT_ANCHORED' : e.onchain_hash.replace(/^0x/, '').toLowerCase() === computed ? 'MATCHED' : 'MISMATCHED';
  return { state, computed, chain, reason, signed };
}

export const shortHash = (h?: string | null, n = 10) => (h ? `${h.slice(0, n)}…${h.slice(-6)}` : '—');

export function newRef(): string {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return `EVD-${Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}
