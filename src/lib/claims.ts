
export type CheckLevel = 'pass' | 'warn' | 'fail';
export interface ClaimCheck {
  id: string;
  title: string;
  level: CheckLevel;
  detail: string;
}
import type { Verdict } from './types';
export type { Verdict };
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
function compare(claimed: number, verified: number, label: string, unit = '', fy?: string): ClaimCheck {
  const id = `fig-${label}`;
  const where = fy ? ` for FY ${fy}` : '';
  if (verified <= 0) return { id, title: `${label}: nothing to support it`, level: 'fail', detail: `The data${where} shows ${fmt(verified)}${unit}, so the claimed ${fmt(claimed)}${unit} is not supported.` };
  const diff = (claimed - verified) / verified;
  const pct = Math.abs(diff * 100).toFixed(1);
  if (diff > 0.02) return { id, title: `${label} is higher than the data`, level: 'fail', detail: `The claim states ${fmt(claimed)}${unit}, but the data${where} supports ${fmt(verified)}${unit} (${pct}% over-claimed).` };
  if (diff < -0.25) return { id, title: `${label} is well below the data`, level: 'warn', detail: `The claim states ${fmt(claimed)}${unit}; the data${where} shows ${fmt(verified)}${unit}. Check the figure refers to the same scope.` };
  return { id, title: `${label} matches the data`, level: 'pass', detail: `Claimed ${fmt(claimed)}${unit} vs ${fmt(verified)}${unit}${where}.` };
}
const fmt = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(n);

/** What the attached evidence adds up to (only intact items count towards totals). */
export interface EvidenceSummary {
  count: number;
  tampered: number;
  anchored: number;
  audited: number;
  savings_kwh: number;
  co2e_kg: number;
  money_inr: number;
  baseline_kwh: number;
  renewable_kwh: number;
}
/** Company-level results for the financial year the claim is about. */
export interface CompanyContext {
  fy: string;
  scope1_change_pct: number | null;
  scope2_change_pct: number | null;
  total_change_pct: number | null;
  renewable_share_pct: number | null;
}
export interface ClaimContext {
  evidence?: EvidenceSummary | null;
  company?: CompanyContext | null;
}

export function checkClaim(claim: string, ctx: ClaimContext = {}): ClaimReport {
  const text = claim.trim();
  const checks: ClaimCheck[] = [];
  // "100% renewable" and similar are absolute slogans, not measurements.
  const figures = extractFigures(text).filter((f) => !(f.kind === 'percent' && f.value === 100 && /100\s*%\s*(renewable|green|clean|sustainable|eco)/i.test(text)));
  const ev = ctx.evidence && ctx.evidence.count ? ctx.evidence : null;

  // 1. Specific, measurable language
  const vague = found(text, VAGUE);
  const absolute = found(text, ABSOLUTE);
  checks.push(figures.length
    ? { id: 'measurable', title: 'States a measurable result', level: 'pass', detail: `Found ${figures.map((f) => f.text).join(', ')}.` }
    : { id: 'measurable', title: 'No measurable figure', level: 'warn', detail: 'The claim gives no number with a unit (kWh, tCO₂e, %), so it cannot be checked against data.' });
  if (vague.length) {
    checks.push({ id: 'vague', title: 'Uses vague green wording', level: figures.length ? 'warn' : 'fail', detail: `“${vague.join('”, “')}” has no agreed meaning. Name the actual result instead.` });
  }
  if (absolute.length) {
    const scoped = /\bscope\s?[123]\b/i.test(text);
    checks.push({ id: 'absolute', title: 'Makes an absolute claim', level: ev && scoped ? 'warn' : 'fail', detail: `“${absolute.join('”, “')}” needs full-scope emissions accounting${scoped ? '' : ' and a stated scope (Scope 1, 2 or 3)'}. Project savings alone cannot prove it.` });
  }
  if (found(text, OFFSET).length) {
    checks.push({ id: 'offsets', title: 'Relies on offsets', level: 'warn', detail: 'Offset-based claims should cite the registry, project and retired credit serial numbers.' });
  }
  const pledge = PLEDGE.test(text);
  if (pledge) {
    checks.push({ id: 'pledge', title: 'Describes a future target', level: 'warn', detail: 'A target is not an achievement. Label it as a target and state the baseline year and the plan.' });
  }
  checks.push(TIMEFRAME.test(text)
    ? { id: 'timeframe', title: 'Gives a time period', level: 'pass', detail: 'The claim says when the result happened.' }
    : { id: 'timeframe', title: 'No time period', level: 'warn', detail: 'Say when the result was achieved (for example “in FY 2025-26”).' });

  // 2. Company-level figures (emissions trend, renewable share)
  const pct = figures.filter((f) => f.kind === 'percent');
  const co = ctx.company;
  const companyChecked = new Set<string>();
  if (co && pct.length && !pledge) {
    const claimed = Math.max(...pct.map((f) => f.value));
    const lower = text.toLowerCase();
    const reduction = /(cut|reduc|lower|decreas|drop|fell|down)/.test(lower);
    const pick = /scope\s?1/.test(lower) ? ['Scope 1 emissions', co.scope1_change_pct] as const
      : /scope\s?2/.test(lower) ? ['Scope 2 emissions', co.scope2_change_pct] as const
        : /(emission|carbon|co2|co₂|ghg)/.test(lower) ? ['Scope 1+2 emissions', co.total_change_pct] as const : null;
    if (pick && reduction) {
      companyChecked.add('percent');
      const [label, change] = pick;
      if (change == null) {
        checks.push({ id: 'company-trend', title: `No data to test the ${label} trend`, level: 'warn', detail: `Add energy records for FY ${co.fy} and the year before to check this percentage.` });
      } else {
        const actual = -change;
        checks.push(compare(claimed, actual, `${label} reduction`, '%', co.fy));
      }
    } else if (/renewable/.test(lower) && !absolute.length) {
      companyChecked.add('percent');
      if (co.renewable_share_pct == null) checks.push({ id: 'company-re', title: 'No data to test the renewable share', level: 'warn', detail: `Add energy records for FY ${co.fy}.` });
      else checks.push(compare(claimed, co.renewable_share_pct, 'Renewable share', '%', co.fy));
    }
  }

  // 3. Evidence
  if (!ev) {
    checks.push({ id: 'evidence', title: 'No evidence attached', level: companyChecked.size || pledge ? 'warn' : 'fail', detail: pledge ? 'Targets need a baseline year and a published plan; attach them when available.' : 'Attach evidence (MRV records, meter data, invoices, audit reports) so the claim can be traced.' });
  } else {
    checks.push(ev.tampered
      ? { id: 'integrity', title: `${ev.tampered} evidence item${ev.tampered > 1 ? 's were' : ' was'} altered`, level: 'fail', detail: 'Their fingerprints no longer match. Altered items are excluded from the totals below.' }
      : { id: 'integrity', title: 'All evidence is intact', level: 'pass', detail: `${ev.count} item${ev.count > 1 ? 's' : ''}; every SHA-256 fingerprint matches.` });
    checks.push(ev.anchored === ev.count
      ? { id: 'anchor', title: 'Anchored on-chain', level: 'pass', detail: 'Every item’s fingerprint is anchored in EvidenceRegistry.sol.' }
      : { id: 'anchor', title: `${ev.count - ev.anchored} of ${ev.count} not anchored on-chain`, level: 'warn', detail: 'Unanchored evidence is fingerprinted but self-reported.' });
    checks.push(ev.audited
      ? { id: 'audit', title: 'Independently verified', level: 'pass', detail: `${ev.audited} of ${ev.count} items reviewed by a third party.` }
      : { id: 'audit', title: 'No independent verification', level: 'warn', detail: 'No third-party auditor has reviewed this evidence.' });

    const fig = pledge ? [] : figures;
    const energy = fig.filter((f) => f.kind === 'energy_kwh');
    const co2 = fig.filter((f) => f.kind === 'co2e_kg');
    const money = fig.filter((f) => f.kind === 'money_inr');
    const total = (fs: ExtractedFigure[]) => Math.max(...fs.map((f) => f.value));
    if (energy.length) {
      const isRenewable = /renewable|solar|wind/i.test(text) && ev.renewable_kwh > 0 && !ev.savings_kwh;
      const verified = isRenewable ? ev.renewable_kwh : ev.savings_kwh;
      checks.push(verified ? compare(total(energy), verified, isRenewable ? 'Renewable energy' : 'Energy saved', ' kWh')
        : { id: 'fig-energy', title: 'Evidence has no energy figure', level: 'fail', detail: 'None of the attached evidence reports energy savings.' });
    }
    if (co2.length) {
      checks.push(ev.co2e_kg ? compare(total(co2), ev.co2e_kg, 'CO₂e avoided', ' kg')
        : { id: 'fig-co2', title: 'Evidence has no CO₂e figure', level: 'fail', detail: 'None of the attached evidence reports avoided emissions.' });
    }
    if (!pledge && pct.length && !absolute.length && !companyChecked.size && ev.baseline_kwh) {
      checks.push(compare(total(pct), (ev.savings_kwh / ev.baseline_kwh) * 100, 'Percentage reduction', '%'));
    }
    if (money.length && ev.money_inr) checks.push(compare(total(money), ev.money_inr, 'Money saved', ''));
  }

  const fails = checks.filter((c) => c.level === 'fail').length;
  const warns = checks.filter((c) => c.level === 'warn').length;
  const passes = checks.length - fails - warns;
  const score = Math.max(0, Math.round((passes / checks.length) * 100 - fails * 10));
  const verdict: Verdict = fails ? 'UNSUPPORTED' : warns > 1 ? 'QUESTIONABLE' : 'SUPPORTED';
  const summary = verdict === 'SUPPORTED'
    ? 'Specific, time-bound and backed by intact evidence. Safe to publish.'
    : verdict === 'QUESTIONABLE'
      ? 'Not wrong, but parts are vague or weakly evidenced. Tighten the wording or add evidence before publishing.'
      : 'Goes beyond what the evidence shows, or has no usable evidence. Publishing this risks a greenwashing finding.';
  const order: Record<CheckLevel, number> = { fail: 0, warn: 1, pass: 2 };
  checks.sort((a, b) => order[a.level] - order[b.level]);
  return { verdict, score, summary, checks, figures };
}
