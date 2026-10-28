import { useEffect, useMemo, useState } from 'react';
import { checkClaim, type ClaimReport, type CompanyContext, type EvidenceSummary } from './claims';
import { repo } from './data';
import { fyMonths, pctChange, prevFy, totals } from './emissions';
import { checkIntegrity, type IntegrityResult } from './hash';
import { invalidate, useQuery } from './query';
import { useCompany } from './session';
import type { Company, EnergyRecord, Evidence } from './types';

export function useWorkspaceData() {
  const { company_id: cid } = useCompany();
  return {
    facilities: useQuery(`${cid}/facilities`, () => repo.facilities(cid)),
    energy: useQuery(`${cid}/energy`, () => repo.energy(cid)),
    evidence: useQuery(`${cid}/evidence`, () => repo.evidence(cid)),
    claims: useQuery(`${cid}/claims`, () => repo.claims(cid)),
  };
}
export const refresh = (cid: string, what: 'facilities' | 'energy' | 'evidence' | 'claims' | 'activity' | 'members' | '') => invalidate(`${cid}/${what}`);

/** Recompute fingerprints for a list of evidence (cached by id + hash). */
const integrityCache = new Map<string, IntegrityResult>();
export function useIntegrity(items: Evidence[] | undefined) {
  const [map, setMap] = useState<Record<string, IntegrityResult>>({});
  const key = (items ?? []).map((e) => `${e.id}:${e.sha256}:${JSON.stringify(e.metrics)}`).join('|');
  useEffect(() => {
    let alive = true;
    if (!items) return;
    Promise.all(items.map(async (e) => {
      const k = `${e.id}:${e.sha256}:${JSON.stringify(e.metrics)}:${e.title}`;
      const r = integrityCache.get(k) ?? (await checkIntegrity(e));
      integrityCache.set(k, r);
      return [e.id, r] as const;
    })).then((pairs) => { if (alive) setMap(Object.fromEntries(pairs)); }).catch(() => undefined);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return map;
}

export function summarizeEvidence(ids: string[], all: Evidence[], integrity: Record<string, IntegrityResult>): EvidenceSummary | null {
  const items = all.filter((e) => ids.includes(e.id));
  if (!items.length) return null;
  const intact = items.filter((e) => integrity[e.id]?.state !== 'TAMPERED');
  const sum = (k: keyof Evidence['metrics']) => intact.reduce((a, e) => a + (e.metrics[k] ?? 0), 0);
  return {
    count: items.length,
    tampered: items.length - intact.length,
    anchored: items.filter((e) => integrity[e.id]?.chain === 'MATCHED').length,
    audited: items.filter((e) => e.audited).length,
    savings_kwh: sum('savings_kwh'), co2e_kg: sum('co2e_kg'), money_inr: sum('money_inr'),
    baseline_kwh: sum('baseline_kwh'), renewable_kwh: sum('renewable_kwh'),
  };
}

/** Pick the financial year a claim refers to (e.g. "FY 2025-26"), else the latest complete one. */
export function fyFromText(text: string, available: string[]): string | undefined {
  const m = text.match(/(?:fy\s*)?(20\d\d)\s*[-–/]\s*(\d\d)\b/i) || text.match(/\bfy\s*(\d\d)\b/i);
  if (m && (!m[2] || Number(m[2]) === (Number(m[1]) + 1) % 100)) {
    const start = m[2] ? Number(m[1]) : 2000 + Number(m[1]) - 1;
    const fy = `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
    if (available.includes(fy)) return fy;
  }
  return available[0];
}

export function companyContext(fy: string | undefined, energy: EnergyRecord[], c: Company): CompanyContext | null {
  if (!fy) return null;
  const inFy = (f: string) => { const ms = new Set(fyMonths(f)); return energy.filter((r) => ms.has(r.month)); };
  const now = totals(inFy(fy), c);
  const before = totals(inFy(prevFy(fy)), c);
  const has = now.records > 0;
  const hasBefore = before.records > 0;
  return {
    fy,
    scope1_change_pct: has && hasBefore ? pctChange(now.scope1_t, before.scope1_t) : null,
    scope2_change_pct: has && hasBefore ? pctChange(now.scope2_t, before.scope2_t) : null,
    total_change_pct: has && hasBefore ? pctChange(now.scope1_t + now.scope2_t, before.scope1_t + before.scope2_t) : null,
    renewable_share_pct: has ? (now.renewable_kwh / (now.renewable_kwh + now.grid_kwh)) * 100 : null,
  };
}

/** Financial years that have energy data, newest complete year first. */
export function useFinancialYears(energy: EnergyRecord[] | undefined) {
  return useMemo(() => {
    const counts = new Map<string, Set<string>>();
    for (const r of energy ?? []) {
      const fy = fyOfMonth(r.month);
      if (!counts.has(fy)) counts.set(fy, new Set());
      counts.get(fy)!.add(r.month);
    }
    const all = [...counts.keys()].sort().reverse();
    const complete = all.filter((f) => (counts.get(f)?.size ?? 0) >= 12);
    return { all, complete, defaultFy: complete[0] ?? all[0] };
  }, [energy]);
}
function fyOfMonth(m: string) {
  const [y, mo] = m.split('-').map(Number);
  const s = mo >= 4 ? y : y - 1;
  return `${s}-${String((s + 1) % 100).padStart(2, '0')}`;
}

/** Re-run the claim check for every claim against the current evidence and energy data. */
export function useLiveReports(): { reports: Record<string, ClaimReport>; ready: boolean } {
  const m = useCompany();
  const { energy, evidence, claims } = useWorkspaceData();
  const integrity = useIntegrity(evidence.data);
  const years = useFinancialYears(energy.data);
  const ready = !!claims.data && !!evidence.data && !!energy.data && Object.keys(integrity).length === (evidence.data?.length ?? 0);
  const reports = useMemo(() => {
    if (!ready) return {};
    const out: Record<string, ClaimReport> = {};
    for (const c of claims.data!) {
      const fy = fyFromText(c.text, years.all.filter((y) => years.complete.includes(y)).concat(years.all.filter((y) => !years.complete.includes(y))));
      out[c.id] = checkClaim(c.text, {
        evidence: summarizeEvidence(c.evidence_ids, evidence.data!, integrity),
        company: companyContext(fy, energy.data!, m.company),
      });
    }
    return out;
  }, [ready, claims.data, evidence.data, energy.data, integrity, years, m.company]);
  return { reports, ready };
}
