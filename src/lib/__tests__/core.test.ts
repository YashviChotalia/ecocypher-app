import { describe, expect, it } from 'vitest';
import { checkClaim, extractFigures } from '../claims';
import { buildDemo } from '../data/seed';
import { fyMonths, fyOf, totals } from '../emissions';
import { canonicalize, checkIntegrity, sha256Hex } from '../hash';
import { companyContext, summarizeEvidence } from '../hooks';
import { extractEvidenceId } from '../qr';

describe('hashing', () => {
  it('canonicalises recursively with sorted keys', () => {
    expect(canonicalize({ b: 1, a: { d: 2, c: 'x' } })).toBe('{"a":{"c":"x","d":2},"b":1}');
  });
  it('produces known SHA-256 digests', async () => {
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('financial years', () => {
  it('starts in April', () => {
    expect(fyOf('2026-03')).toBe('2025-26');
    expect(fyOf('2026-04')).toBe('2026-27');
    expect(fyMonths('2025-26')[0]).toBe('2025-04');
    expect(fyMonths('2025-26')[11]).toBe('2026-03');
  });
});

describe('QR parsing', () => {
  it.each([
    ['EVD-88A9F34C2B10', 'EVD-88A9F34C2B10'],
    ['https://impact.example.com/verify/EVD-88A9F34C2B10', 'EVD-88A9F34C2B10'],
    ['hello world', null],
  ])('%s', (input, expected) => expect(extractEvidenceId(input)).toBe(expected));
});

describe('claim rules', () => {
  it('extracts figures with units', () => {
    const f = extractFigures('Saved 1.2 MWh and 7.5 tCO2e, a 20% cut worth ₹2 lakh');
    expect(f.find((x) => x.kind === 'energy_kwh')?.value).toBe(1200);
    expect(f.find((x) => x.kind === 'co2e_kg')?.value).toBe(7500);
    expect(f.find((x) => x.kind === 'money_inr')?.value).toBe(200000);
  });
  it('rejects vague absolute claims without evidence', () => {
    const r = checkClaim('Our HQ is carbon neutral and eco-friendly.');
    expect(r.verdict).toBe('UNSUPPORTED');
  });
});

describe('demo workspace', async () => {
  const db = await buildDemo();
  const integrity = Object.fromEntries(await Promise.all(db.evidence.map(async (e) => [e.id, await checkIntegrity(e)] as const)));
  const verdict = (id: string) => {
    const c = db.claims.find((x) => x.id === id)!;
    return checkClaim(c.text, {
      evidence: summarizeEvidence(c.evidence_ids, db.evidence, integrity),
      company: companyContext('2025-26', db.energy, db.company),
    });
  };

  it('detects the altered boiler record and nothing else', () => {
    const altered = Object.entries(integrity).filter(([, r]) => r.state === 'TAMPERED').map(([id]) => id);
    expect(altered).toEqual(['ev-boiler']);
    expect(integrity['ev-air'].chain).toBe('MATCHED');
  });
  it('has 12 months of data per facility in FY 2025-26', () => {
    const t = totals(db.energy.filter((r) => fyMonths('2025-26').includes(r.month)), db.company);
    expect(t.records).toBe(36);
    expect(t.renewable_kwh).toBe(362000);
  });
  it('gives the sample claims the intended verdicts', () => {
    const ctx = companyContext('2025-26', db.energy, db.company)!;
    console.log('Scope 2 change FY25-26:', ctx.scope2_change_pct?.toFixed(2), '% · renewable share', ctx.renewable_share_pct?.toFixed(2));
    expect(verdict('cl-1').verdict).toBe('SUPPORTED');
    expect(verdict('cl-2').verdict).toBe('SUPPORTED');
    expect(verdict('cl-3').verdict).toBe('UNSUPPORTED');
    expect(verdict('cl-4').verdict).toBe('UNSUPPORTED');
    expect(verdict('cl-5').verdict).toBe('UNSUPPORTED');
    expect(verdict('cl-6').verdict).toBe('QUESTIONABLE');
  });
});
