import type { VerificationResult } from './types';

export type CheckLevel = 'pass' | 'warn' | 'fail';
export interface ClaimCheck {
  id: string;
  title: string;
  level: CheckLevel;
  detail: string;
}
export type Verdict = 'SUPPORTED' | 'QUESTIONABLE' | 'UNSUPPORTED';
export interface ClaimReport {
  verdict: Verdict;
  score: number;
  summary: string;
  checks: ClaimCheck[];
  figures: ExtractedFigure[];
}
export interface ExtractedFigure {
  kind: 'energy_kwh' | 'co2e_kg' | 'percent' | 'money_inr';
  value: number;
  text: string;
}

const VAGUE = ['eco-friendly', 'eco friendly', 'environmentally friendly', 'green', 'sustainable', 'planet-friendly', 'planet friendly', 'natural', 'clean energy', 'conscious', 'earth-friendly', 'responsible'];
const ABSOLUTE = ['carbon neutral', 'carbon-neutral', 'net zero', 'net-zero', 'zero emissions', 'zero-emission', 'climate positive', 'climate neutral', 'carbon negative', '100% renewable', '100% green', 'fully sustainable', 'emission-free', 'emission free'];
const OFFSET = ['offset', 'offsets', 'carbon credit', 'carbon credits', 'compensated'];
const PLEDGE = /\b(will|aim(s|ing)? to|plan(s|ning)? to|commit(s|ted)? to|by 20\d\d|target(s|ing)?|pledge)\b/i;
const TIMEFRAME = /\b(20\d\d|q[1-4]|quarter|month|year|annual(ly)?|fy\s?\d{2}|since|between|from\s+\w+\s+to)\b/i;

const num = (s: string) => Number(s.replace(/,/g, ''));

/** Find measurable figures in free text: kWh/MWh/GWh, kg/t CO2e, percentages, rupee amounts. */
export function extractFigures(text: string): ExtractedFigure[] {
  const out: ExtractedFigure[] = [];
  const t = text.replace(/ /g, ' ');
  for (const m of t.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(k|m|g)wh\b/gi)) {
    const mult = { k: 1, m: 1e3, g: 1e6 }[m[2].toLowerCase() as 'k' | 'm' | 'g'];
    out.push({ kind: 'energy_kwh', value: num(m[1]) * mult, text: m[0] });
  }
  for (const m of t.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(kg|kilograms?|t|tonnes?|tons?|mt)\s*(?:of\s*)?(?:co2e?|co₂e?|carbon|emissions)/gi)) {
    const unit = m[2].toLowerCase();
    const kg = unit.startsWith('k') ? num(m[1]) : num(m[1]) * 1000;
    out.push({ kind: 'co2e_kg', value: kg, text: m[0] });
  }
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*%/g)) out.push({ kind: 'percent', value: num(m[1]), text: m[0] });
  for (const m of t.matchAll(/(?:₹|rs\.?|inr)\s*(\d[\d,]*(?:\.\d+)?)\s*(lakh|crore|k)?/gi)) {
    const mult = { lakh: 1e5, crore: 1e7, k: 1e3 }[(m[2] || '').toLowerCase() as 'lakh'] ?? 1;
    out.push({ kind: 'money_inr', value: num(m[1]) * mult, text: m[0] });
  }
  return out;
}

const found = (text: string, words: string[]) => {
  const lower = text.toLowerCase();
  return words.filter((w) => new RegExp(`(^|[^a-z])${w.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}([^a-z]|$)`).test(lower));
};

/** Compare a claimed figure with the verified one. Over-claiming by more than 2% fails. */
function compare(claimed: number, verified: number, label: string): ClaimCheck {
  const diff = (claimed - verified) / verified;
  const pct = Math.abs(diff * 100).toFixed(1);
  if (diff > 0.02) return { id: `fig-${label}`, title: `${label} is higher than the evidence`, level: 'fail', detail: `The claim states ${fmt(claimed)}, but the verified evidence supports ${fmt(verified)} (${pct}% over-claimed).` };
  if (diff < -0.25) return { id: `fig-${label}`, title: `${label} is well below the evidence`, level: 'warn', detail: `The claim states ${fmt(claimed)}; the evidence shows ${fmt(verified)}. Under-claiming is safe, but check the figure refers to the same project.` };
  return { id: `fig-${label}`, title: `${label} matches the evidence`, level: 'pass', detail: `Claimed ${fmt(claimed)} vs verified ${fmt(verified)}.` };
}
const fmt = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(n);

export function checkClaim(claim: string, verification?: VerificationResult | null): ClaimReport {
  const text = claim.trim();
  const checks: ClaimCheck[] = [];
  // "100% renewable" and similar are absolute slogans, not measurements.
  const figures = extractFigures(text).filter((f) => !(f.kind === 'percent' && f.value === 100 && /100\s*%\s*(renewable|green|clean|sustainable|eco)/i.test(text)));

  // 1. Specific, measurable language
  const vague = found(text, VAGUE);
  const absolute = found(text, ABSOLUTE);
  if (figures.length) {
    checks.push({ id: 'measurable', title: 'States a measurable result', level: 'pass', detail: `Found ${figures.map((f) => f.text).join(', ')}.` });
  } else {
    checks.push({ id: 'measurable', title: 'No measurable figure', level: 'warn', detail: 'The claim gives no number with a unit (kWh, tCO₂e, %), so it cannot be checked against data.' });
  }
  if (vague.length) {
    checks.push({ id: 'vague', title: 'Uses vague green wording', level: figures.length ? 'warn' : 'fail', detail: `“${vague.join('”, “')}” has no agreed meaning. Name the actual result instead.` });
  }
  if (absolute.length) {
    const scoped = /\bscope\s?[123]\b/i.test(text);
    checks.push({ id: 'absolute', title: 'Makes an absolute claim', level: verification && scoped ? 'warn' : 'fail', detail: `“${absolute.join('”, “')}” needs full-scope emissions accounting${scoped ? '' : ' and a stated scope (Scope 1, 2 or 3)'}. A single project’s savings cannot prove it.` });
  }
  if (found(text, OFFSET).length) {
    checks.push({ id: 'offsets', title: 'Relies on offsets', level: 'warn', detail: 'Offset-based claims should cite the registry, project and retired credit serial numbers.' });
  }
  if (PLEDGE.test(text)) {
    checks.push({ id: 'pledge', title: 'Describes a future target', level: 'warn', detail: 'A target is not an achievement. Evidence can only support results that already happened.' });
  }
  checks.push(TIMEFRAME.test(text)
    ? { id: 'timeframe', title: 'Gives a time period', level: 'pass', detail: 'The claim says when the result happened.' }
    : { id: 'timeframe', title: 'No time period', level: 'warn', detail: 'Say when the result was achieved (for example “in March 2026”).' });

  // 2. Evidence
  if (!verification) {
    checks.push({ id: 'evidence', title: 'No evidence attached', level: 'fail', detail: 'Attach an EcoCypher evidence record (scan its QR code or pick one from your wallet) to test the numbers.' });
  } else {
    const { integrity, chain, evidence, record } = verification;
    checks.push(integrity === 'INTACT'
      ? { id: 'integrity', title: 'Evidence is intact', level: 'pass', detail: 'The recomputed SHA-256 matches the hash recorded when the evidence was created.' }
      : { id: 'integrity', title: 'Evidence was altered', level: 'fail', detail: 'The record no longer matches its original hash. Its numbers cannot be trusted.' });
    checks.push(chain === 'MATCHED'
      ? { id: 'anchor', title: 'Anchored on-chain', level: 'pass', detail: 'The on-chain hash in EvidenceRegistry.sol matches.' }
      : chain === 'MISMATCHED'
        ? { id: 'anchor', title: 'On-chain hash differs', level: 'fail', detail: 'The anchored hash does not match this record.' }
        : { id: 'anchor', title: 'Not anchored on-chain', level: 'warn', detail: `Anchor status is ${record.anchor_status.toLowerCase()}. The record can still be checked for internal consistency.` });
    checks.push(record.external_verification === 'PERFORMED'
      ? { id: 'audit', title: 'Independently verified', level: 'pass', detail: record.verifier ? `Verified by ${record.verifier}.` : 'A third party has reviewed this evidence.' }
      : { id: 'audit', title: 'No independent verification', level: 'warn', detail: 'No third-party auditor has reviewed this evidence yet.' });

    if (evidence && integrity === 'INTACT') {
      const energy = figures.filter((f) => f.kind === 'energy_kwh');
      const co2 = figures.filter((f) => f.kind === 'co2e_kg');
      const pct = figures.filter((f) => f.kind === 'percent');
      const money = figures.filter((f) => f.kind === 'money_inr');
      if (energy.length) checks.push(compare(Math.max(...energy.map((f) => f.value)), evidence.savings_kwh, 'Energy saved'));
      if (co2.length) checks.push(compare(Math.max(...co2.map((f) => f.value)), evidence.co2e_reduction_kg, 'CO₂e avoided'));
      if (pct.length && !absolute.length) {
        const verifiedPct = (evidence.savings_kwh / evidence.baseline_kwh) * 100;
        checks.push(compare(Math.max(...pct.map((f) => f.value)), verifiedPct, 'Percentage reduction'));
      }
      if (money.length) checks.push(compare(Math.max(...money.map((f) => f.value)), evidence.economic_saving, 'Money saved'));
      if (evidence.baseline_kwh > 0 && record.method) {
        checks.push({ id: 'baseline', title: 'Has a baseline and method', level: 'pass', detail: `${record.method}; baseline ${fmt(evidence.baseline_kwh)} kWh${record.baseline_period ? ` (${record.baseline_period})` : ''}.` });
      }
    }
  }

  const fails = checks.filter((c) => c.level === 'fail').length;
  const warns = checks.filter((c) => c.level === 'warn').length;
  const passes = checks.length - fails - warns;
  const score = Math.max(0, Math.round((passes / checks.length) * 100 - fails * 10));
  const verdict: Verdict = fails ? 'UNSUPPORTED' : warns > 1 ? 'QUESTIONABLE' : 'SUPPORTED';
  const summary = verdict === 'SUPPORTED'
    ? 'The claim is specific and matches intact evidence.'
    : verdict === 'QUESTIONABLE'
      ? 'Parts of the claim are not backed by the evidence or are too vague to check.'
      : 'The claim goes beyond what the evidence shows, or has no usable evidence.';
  const order: Record<CheckLevel, number> = { fail: 0, warn: 1, pass: 2 };
  checks.sort((a, b) => order[a.level] - order[b.level]);
  return { verdict, score, summary, checks, figures };
}
