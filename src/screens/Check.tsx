import { Eraser, FileSearch } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { LevelIcon, PageHeader, copyText, toast } from '../components/ui';
import { checkClaim, type ClaimReport } from '../lib/claims';
import { verifyRecord } from '../lib/hash';
import { useStore } from '../lib/store';
import type { VerificationResult } from '../lib/types';

const EXAMPLES = [
  'Our Bangalore HQ cut electricity use by 10,600 kWh in March 2026, avoiding 7.5 tCO2e.',
  'Our Bangalore HQ is now carbon neutral and 100% eco-friendly.',
  'The Mumbai campus LED retrofit saved 7,450 kWh between April and May 2026.',
  'We saved 15,000 kWh and will reach net zero by 2030.',
];

const VERDICT_TEXT: Record<ClaimReport['verdict'], { label: string; tone: 'pass' | 'warn' | 'fail' }> = {
  SUPPORTED: { label: 'Supported by evidence', tone: 'pass' },
  QUESTIONABLE: { label: 'Questionable', tone: 'warn' },
  UNSUPPORTED: { label: 'Not supported', tone: 'fail' },
};

export function Check({ evidenceId }: { evidenceId?: string }) {
  const wallet = useStore((s) => s.wallet);
  const [claim, setClaim] = useState('');
  const [selected, setSelected] = useState<string>(evidenceId ?? wallet[0]?.evidence_id ?? '');
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [report, setReport] = useState<ClaimReport | null>(null);

  useEffect(() => { if (evidenceId) setSelected(evidenceId); }, [evidenceId]);

  const record = useMemo(() => wallet.find((r) => r.evidence_id === selected), [wallet, selected]);
  useEffect(() => {
    let alive = true;
    setVerification(null);
    if (record) void verifyRecord(record).then((v) => alive && setVerification(v));
    return () => { alive = false; };
  }, [record]);

  // Re-run automatically when the evidence changes after a check.
  useEffect(() => { if (report && claim.trim()) setReport(checkClaim(claim, verification)); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verification]);

  const run = () => {
    if (!claim.trim()) return;
    setReport(checkClaim(claim, record ? verification : null));
    requestAnimationFrame(() => document.getElementById('report')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const verdict = report ? VERDICT_TEXT[report.verdict] : null;
  const ringColor = verdict ? `var(--${verdict.tone})` : undefined;

  return (
    <>
      <PageHeader eyebrow="Claim check" title="Is this green claim backed up?">
        Paste a sustainability claim and choose the evidence it relies on. The check is rule-based and runs on your device, so every result comes with its reason.
      </PageHeader>

      <form className="card stack" onSubmit={(e) => { e.preventDefault(); run(); }}>
        <label className="field" htmlFor="claim">
          The claim
          <span className="hint">As written in the report, ad or press release.</span>
        </label>
        <textarea id="claim" className="textarea" value={claim} onChange={(e) => setClaim(e.target.value)}
          placeholder="e.g. Our office cut energy use by 10,600 kWh in March 2026." />
        <div className="examples" aria-label="Example claims">
          {EXAMPLES.map((ex) => (
            <button type="button" key={ex} onClick={() => setClaim(ex)}>{ex.length > 46 ? `${ex.slice(0, 44)}…` : ex}</button>
          ))}
        </div>

        <label className="field" htmlFor="evidence">
          Evidence
          <span className="hint">From your wallet. Scan a receipt to add more.</span>
        </label>
        <select id="evidence" className="select" value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">No evidence</option>
          {wallet.map((r) => <option key={r.evidence_id} value={r.evidence_id}>{r.title} · {r.evidence_id}</option>)}
        </select>

        <div className="row">
          <button className="btn btn-primary" type="submit" disabled={!claim.trim()} style={{ flex: 1 }}>
            <FileSearch aria-hidden /> Check claim
          </button>
          {report && (
            <button type="button" className="btn btn-ghost" onClick={() => { setClaim(''); setReport(null); }}>
              <Eraser aria-hidden /> Clear
            </button>
          )}
        </div>
      </form>

      {report && verdict && (
        <section id="report" className="card stack fade-in" aria-live="polite" style={{ scrollMarginTop: 90 }}>
          <div className="score">
            <div className="ring" style={{ ['--p' as string]: report.score, ['--ring-color' as string]: ringColor }}>
              <span>{report.score}</span>
            </div>
            <div className="stack" style={{ gap: 4 }}>
              <span className={`chip ${verdict.tone}`} style={{ justifySelf: 'start' }}>{verdict.label}</span>
              <p style={{ color: 'var(--text-2)' }}>{report.summary}</p>
            </div>
          </div>
          <div>
            {report.checks.map((c) => (
              <div key={c.id} className={`check ${c.level}`}>
                <span className="ico"><LevelIcon level={c.level} /></span>
                <div><b>{c.title}</b><p>{c.detail}</p></div>
              </div>
            ))}
          </div>
          <button className="btn btn-ghost" onClick={async () => {
            const text = [`Claim: ${claim.trim()}`, `Verdict: ${verdict.label} (${report.score}/100)`,
              record ? `Evidence: ${record.evidence_id}` : 'Evidence: none',
              ...report.checks.map((c) => `${c.level === 'pass' ? '✓' : c.level === 'warn' ? '!' : '✗'} ${c.title}: ${c.detail}`),
              '— EcoCypher claim check'].join('\n');
            toast((await copyText(text)) ? 'Report copied' : 'Copy failed');
          }}>Copy report</button>
        </section>
      )}
    </>
  );
}
