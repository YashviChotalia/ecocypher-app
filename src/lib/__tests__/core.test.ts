import { describe, expect, it } from 'vitest';
import { checkClaim, extractFigures } from '../claims';
import { canonicalize, sha256Hex, verifyRecord } from '../hash';
import { extractEvidenceId } from '../qr';
import { SEED_RECORDS } from '../seed';

describe('hashing', () => {
  it('canonicalises with sorted keys and compact JSON', () => {
    expect(canonicalize({ b: 1, a: 'x' })).toBe('{"a":"x","b":1}');
  });
  it('produces known SHA-256 digests', async () => {
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
  it('verifies the seed records as expected', async () => {
    const [a, b, c] = await Promise.all(SEED_RECORDS.map(verifyRecord));
    expect(a.integrity).toBe('INTACT');
    expect(a.chain).toBe('NOT_ANCHORED');
    expect(b.integrity).toBe('INTACT');
    expect(b.chain).toBe('MATCHED');
    expect(c.integrity).toBe('TAMPERED');
  });
});

describe('QR parsing', () => {
  it.each([
    ['EVD-88A9F34C2B10', 'EVD-88A9F34C2B10'],
    ['https://impact.example.com/verify/EVD-88A9F34C2B10', 'EVD-88A9F34C2B10'],
    ['https://x.app/?verify=evd-3c71d0a4e95b', 'EVD-3C71D0A4E95B'],
    ['hello world', null],
  ])('%s', (input, expected) => expect(extractEvidenceId(input)).toBe(expected));
});

describe('claim rules', () => {
  it('extracts figures with units', () => {
    const f = extractFigures('Saved 1.2 MWh and 7.5 tCO2e, a 20% cut worth ₹2 lakh');
    expect(f.find((x) => x.kind === 'energy_kwh')?.value).toBe(1200);
    expect(f.find((x) => x.kind === 'co2e_kg')?.value).toBe(7500);
    expect(f.find((x) => x.kind === 'percent')?.value).toBe(20);
    expect(f.find((x) => x.kind === 'money_inr')?.value).toBe(200000);
  });
  it('supports a specific claim that matches intact evidence', async () => {
    const v = await verifyRecord(SEED_RECORDS[1]);
    const r = checkClaim('The Mumbai campus LED retrofit saved 7,450 kWh between April and May 2026.', v);
    expect(r.verdict).not.toBe('UNSUPPORTED');
    expect(r.checks.find((c) => c.id === 'fig-Energy saved')?.level).toBe('pass');
  });
  it('rejects over-claiming', async () => {
    const v = await verifyRecord(SEED_RECORDS[0]);
    const r = checkClaim('We saved 15,000 kWh in March 2026.', v);
    expect(r.verdict).toBe('UNSUPPORTED');
  });
  it('rejects vague absolute claims without evidence', () => {
    const r = checkClaim('Our HQ is carbon neutral and eco-friendly.', null);
    expect(r.verdict).toBe('UNSUPPORTED');
    expect(r.checks.map((c) => c.id)).toEqual(expect.arrayContaining(['vague', 'absolute', 'evidence']));
  });
  it('fails claims built on altered evidence', async () => {
    const v = await verifyRecord(SEED_RECORDS[2]);
    expect(checkClaim('Night purge saved 9,100 kWh in May 2026.', v).verdict).toBe('UNSUPPORTED');
  });
});
