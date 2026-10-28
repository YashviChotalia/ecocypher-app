import type { CanonicalEvidence, EvidenceRecord, VerificationResult } from './types';

/** Canonical JSON: keys sorted, compact separators — matches the backend's sort_keys canonicalisation. */
export function canonicalize(obj: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) sorted[key] = obj[key];
  return JSON.stringify(sorted);
}

export async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Secure hashing needs HTTPS (or localhost).');
  const buf = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function parseEvidence(record: EvidenceRecord): CanonicalEvidence | null {
  try {
    const v = JSON.parse(record.canonical_json) as CanonicalEvidence;
    return typeof v.savings_kwh === 'number' ? v : null;
  } catch {
    return null;
  }
}

/** Re-hash the canonical record and compare with the recorded and on-chain hashes. */
export async function verifyRecord(record: EvidenceRecord): Promise<VerificationResult> {
  const evidence = parseEvidence(record);
  const computed = await sha256Hex(record.canonical_json);
  const integrity = !evidence ? 'UNREADABLE' : computed === record.evidence_hash ? 'INTACT' : 'TAMPERED';
  const chain = !record.onchain_hash
    ? 'NOT_ANCHORED'
    : record.onchain_hash.replace(/^0x/, '').toLowerCase() === computed
      ? 'MATCHED'
      : 'MISMATCHED';
  return { record, evidence, computed_hash: computed, integrity, chain, checked_at: new Date().toISOString() };
}

export const shortHash = (h?: string, n = 10) => (h ? `${h.slice(0, n)}…${h.slice(-6)}` : '—');
