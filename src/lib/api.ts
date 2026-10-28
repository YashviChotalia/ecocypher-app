import { store } from './store';
import type { AnchorStatus, EvidenceRecord } from './types';

export class LookupError extends Error {}

interface ApiMRV {
  evidence_id: string;
  intervention_id: string;
  canonical_json?: string;
  hash?: string;
  evidence_hash?: string;
  blockchain?: { anchor_status?: string; tx_hash?: string; block_number?: number };
  external_verification?: string;
  created_at?: string;
}
interface ApiVerify {
  onchain_hash?: string;
  anchor_status?: string;
  blockchain_tx?: string;
}

const clean = (url: string) => url.trim().replace(/\/+$/, '');

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (res.status === 404) throw new LookupError('No evidence record with that ID on the connected server.');
  if (!res.ok) throw new Error(`Server answered ${res.status}`);
  return res.json() as Promise<T>;
}

/** Fetch a record from the impact API, mapping it to the companion's record shape. */
async function fetchFromApi(base: string, id: string): Promise<EvidenceRecord> {
  const mrv = await getJSON<ApiMRV>(`${base}/api/mrv/${encodeURIComponent(id)}`);
  let verify: ApiVerify = {};
  try {
    verify = await getJSON<ApiVerify>(`${base}/api/verify/${encodeURIComponent(id)}`);
  } catch {
    /* on-chain lookup is optional */
  }
  if (!mrv.canonical_json) throw new Error('Server record has no canonical JSON to verify.');
  const status = (verify.anchor_status || mrv.blockchain?.anchor_status || 'PENDING').toUpperCase() as AnchorStatus;
  return {
    evidence_id: mrv.evidence_id,
    title: mrv.intervention_id,
    canonical_json: mrv.canonical_json,
    evidence_hash: mrv.evidence_hash || mrv.hash || '',
    onchain_hash: verify.onchain_hash || undefined,
    anchor_status: status,
    tx_hash: verify.blockchain_tx || mrv.blockchain?.tx_hash,
    block_number: mrv.blockchain?.block_number,
    method: 'IPMVP Option C',
    external_verification: mrv.external_verification === 'PERFORMED' ? 'PERFORMED' : 'NOT_PERFORMED',
    source: 'api',
    created_at: mrv.created_at || new Date().toISOString(),
  };
}

export type LookupOutcome = { record: EvidenceRecord; from: 'api' | 'wallet' } | { error: string };

export async function lookupEvidence(id: string): Promise<LookupOutcome> {
  const { apiUrl } = store.get().settings;
  const local = store.findLocal(id);
  if (apiUrl) {
    try {
      return { record: await fetchFromApi(clean(apiUrl), id), from: 'api' };
    } catch (err) {
      if (local) return { record: local, from: 'wallet' };
      const msg = err instanceof LookupError ? err.message
        : location.protocol === 'https:' && clean(apiUrl).startsWith('http:')
          ? 'This app runs on HTTPS, so the browser blocks an http:// server. Use an https:// API address.'
          : `Couldn't reach the server (${(err as Error).message}).`;
      return { error: msg };
    }
  }
  if (local) return { record: local, from: 'wallet' };
  return { error: `No record called ${id} in your wallet. Connect your EcoCypher server in Settings to look up live records.` };
}

export async function testConnection(url: string): Promise<string> {
  const res = await fetch(`${clean(url)}/api/health`, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`Server answered ${res.status}`);
  const body = (await res.json().catch(() => ({}))) as { service?: string; status?: string };
  return body.service || body.status || 'Connected';
}
