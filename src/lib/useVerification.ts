import { useCallback, useEffect, useState } from 'react';
import { lookupEvidence } from './api';
import { verifyRecord } from './hash';
import type { VerificationResult } from './types';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'done'; result: VerificationResult; from: 'api' | 'wallet' };

export function useVerification(id: string | undefined) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const run = useCallback(async () => {
    if (!id) return;
    setState({ status: 'loading' });
    const outcome = await lookupEvidence(id);
    if ('error' in outcome) {
      setState({ status: 'error', message: outcome.error });
      return;
    }
    try {
      setState({ status: 'done', result: await verifyRecord(outcome.record), from: outcome.from });
    } catch (err) {
      setState({ status: 'error', message: (err as Error).message });
    }
  }, [id]);
  useEffect(() => { void run(); }, [run]);
  return { state, rerun: run };
}

/** Verify every record in a list (used for wallet/home integrity badges). */
export function useIntegrityMap(records: { evidence_id: string; canonical_json: string; evidence_hash: string }[]) {
  const [map, setMap] = useState<Record<string, VerificationResult['integrity']>>({});
  const key = records.map((r) => r.evidence_id + r.evidence_hash).join('|');
  useEffect(() => {
    let alive = true;
    Promise.all(records.map(async (r) => [r.evidence_id, (await verifyRecord(r as never)).integrity] as const))
      .then((pairs) => { if (alive) setMap(Object.fromEntries(pairs)); })
      .catch(() => undefined);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return map;
}
