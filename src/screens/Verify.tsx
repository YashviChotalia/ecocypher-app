import { ArrowLeft, BookmarkCheck, BookmarkPlus, FileSearch, RefreshCw, Share2, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { AnchorChip, copyText, toast } from '../components/ui';
import { fmtDate, fmtDateTime, fmtINR, fmtNum, fmtTonnes } from '../lib/format';
import { shortHash } from '../lib/hash';
import { href } from '../lib/router';
import { store, useStore } from '../lib/store';
import { useVerification } from '../lib/useVerification';

export function Verify({ id }: { id: string }) {
  const { state, rerun } = useVerification(id);
  const saved = useStore((s) => s.wallet.some((r) => r.evidence_id === id.toUpperCase()));

  if (state.status === 'loading') {
    return (
      <div className="stack" aria-busy="true" aria-label="Verifying">
        <div className="skeleton" style={{ height: 120 }} />
        <div className="skeleton" style={{ height: 84 }} />
        <div className="skeleton" style={{ height: 200 }} />
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="stack fade-in">
        <a className="link row" href={href({ name: 'scan' })}><ArrowLeft size={18} aria-hidden /> Back to scan</a>
        <div className="verdict warn">
          <div className="head">
            <span className="badge"><ShieldQuestion aria-hidden /></span>
            <h1>Record not found</h1>
          </div>
          <p>{state.message}</p>
          <p className="mono" style={{ color: 'var(--text-3)' }}>{id}</p>
        </div>
        <div className="row">
          <a className="btn btn-primary" href={href({ name: 'settings' })}>Connect a server</a>
          <a className="btn btn-ghost" href={href({ name: 'wallet' })}>Open wallet</a>
        </div>
      </div>
    );
  }

  const { result, from } = state;
  const { record, evidence, integrity, chain, computed_hash } = result;
  const tone = integrity !== 'INTACT' || chain === 'MISMATCHED' ? 'fail' : chain === 'MATCHED' ? 'pass' : 'warn';
  const headline = integrity === 'TAMPERED' ? 'Evidence was altered'
    : integrity === 'UNREADABLE' ? 'Evidence can’t be read'
      : chain === 'MISMATCHED' ? 'On-chain proof doesn’t match'
        : chain === 'MATCHED' ? 'Verified and anchored'
          : 'Intact, not yet anchored';
  const explain = integrity === 'TAMPERED'
    ? 'The numbers in this record no longer produce the fingerprint it was created with. Something was changed after the evidence was hashed, so do not rely on it.'
    : integrity === 'UNREADABLE'
      ? 'The record’s canonical data is missing or malformed.'
      : chain === 'MISMATCHED'
        ? 'The record matches its own hash, but the hash stored on the blockchain is different.'
        : chain === 'MATCHED'
          ? 'The record matches its original SHA-256 fingerprint and the copy stored on the blockchain.'
          : 'The record matches its original SHA-256 fingerprint. It has not been written to the blockchain yet, so treat it as self-reported.';
  const Icon = tone === 'pass' ? ShieldCheck : tone === 'fail' ? ShieldAlert : ShieldQuestion;
  const shareUrl = `${location.origin}/${href({ name: 'verify', id: record.evidence_id })}`;

  const share = async () => {
    const data = { title: `EcoCypher evidence ${record.evidence_id}`, text: `${headline}: ${record.title}`, url: shareUrl };
    if (navigator.share) {
      try { await navigator.share(data); return; } catch { /* cancelled */ return; }
    }
    toast((await copyText(shareUrl)) ? 'Link copied' : 'Copy failed. Long-press the QR code instead.');
  };

  return (
    <div className="stack fade-in" style={{ gap: 18 }}>
      <a className="link row" href={href({ name: 'home' })} style={{ gap: 6 }}><ArrowLeft size={18} aria-hidden /> Home</a>

      <section className={`verdict ${tone}`} aria-live="polite">
        <div className="head">
          <span className="badge"><Icon aria-hidden /></span>
          <div>
            <span className="eyebrow">{record.evidence_id}</span>
            <h1>{headline}</h1>
          </div>
        </div>
        <p>{explain}</p>
        <div className="row" style={{ marginTop: 4 }}>
          <AnchorChip status={record.anchor_status} />
          <span className={`chip ${record.external_verification === 'PERFORMED' ? 'pass' : 'neutral'}`}>
            {record.external_verification === 'PERFORMED' ? 'Independently audited' : 'Not audited'}
          </span>
          <span className="chip neutral">{from === 'api' ? 'Live from server' : record.source === 'demo' ? 'Sample record' : 'From wallet'}</span>
        </div>
        {record.demo_note && <p className="muted" style={{ fontSize: '0.85rem' }}>{record.demo_note}</p>}
      </section>

      <section className="stack" aria-label="Claimed impact">
        <div className="section-title"><h2>{record.title}</h2></div>
        <div className="metrics">
          <div className="metric"><small>Energy saved</small><b>{fmtNum(evidence?.savings_kwh)} kWh</b></div>
          <div className="metric"><small>CO₂e avoided</small><b>{fmtTonnes(evidence?.co2e_reduction_kg)}</b></div>
          <div className="metric"><small>Money saved</small><b>{fmtINR(evidence?.economic_saving)}</b></div>
          <div className="metric"><small>Reduction</small><b>{evidence ? `${fmtNum((evidence.savings_kwh / evidence.baseline_kwh) * 100)}%` : '—'}</b></div>
        </div>
        {integrity === 'TAMPERED' && <p className="muted" style={{ fontSize: '0.85rem' }}>These are the numbers the record shows now. They are not verified.</p>}
      </section>

      <section className="card stack" aria-label="Fingerprints">
        <div className="section-title"><h2>Fingerprint check</h2><span className="eyebrow">SHA-256</span></div>
        <div className="hashes">
          <div className={`hashbox ${integrity === 'INTACT' ? 'match' : 'mismatch'}`}>
            <span className="label"><span>Recomputed on this device</span><span>{integrity === 'INTACT' ? 'Match' : 'No match'}</span></span>
            <span className="mono">{computed_hash}</span>
          </div>
          <div className="hashbox">
            <span className="label"><span>Recorded at creation</span></span>
            <span className="mono">{record.evidence_hash || '—'}</span>
          </div>
          <div className={`hashbox ${chain === 'MATCHED' ? 'match' : chain === 'MISMATCHED' ? 'mismatch' : ''}`}>
            <span className="label"><span>On-chain (EvidenceRegistry.sol)</span><span>{chain === 'MATCHED' ? 'Match' : chain === 'MISMATCHED' ? 'No match' : 'Not anchored'}</span></span>
            <span className="mono">{record.onchain_hash ?? 'Not written to the blockchain yet'}</span>
          </div>
        </div>
      </section>

      <section className="card" aria-label="Details">
        <dl className="details">
          <dt>Building</dt><dd>{evidence?.building_id ?? '—'}</dd>
          <dt>Intervention</dt><dd>{evidence?.intervention_id ?? '—'}</dd>
          <dt>Method</dt><dd>{record.method}</dd>
          {record.baseline_period && <><dt>Baseline period</dt><dd>{record.baseline_period}</dd></>}
          {record.reporting_period && <><dt>Reporting period</dt><dd>{record.reporting_period}</dd></>}
          <dt>Baseline use</dt><dd>{fmtNum(evidence?.baseline_kwh)} kWh</dd>
          <dt>After intervention</dt><dd>{fmtNum(evidence?.post_intervention_kwh)} kWh</dd>
          {record.tariff_inr_per_kwh != null && <><dt>Tariff</dt><dd>₹{record.tariff_inr_per_kwh}/kWh</dd></>}
          {record.emission_factor != null && <><dt>Emission factor</dt><dd>{record.emission_factor} kg CO₂e/kWh{record.emission_factor_source ? ` · ${record.emission_factor_source}` : ''}</dd></>}
          {record.tx_hash && <><dt>Transaction</dt><dd className="mono">{shortHash(record.tx_hash, 12)}</dd></>}
          <dt>Created</dt><dd>{fmtDate(record.created_at)}</dd>
          <dt>Checked</dt><dd>{fmtDateTime(result.checked_at)}</dd>
        </dl>
      </section>

      <div className="sticky-actions">
        <button className={`btn ${saved ? 'btn-ghost' : 'btn-primary'}`} onClick={() => {
          if (saved) { store.removeRecord(record.evidence_id); toast('Removed from wallet'); }
          else { store.saveRecord(record); toast('Saved to wallet'); }
        }}>
          {saved ? <BookmarkCheck aria-hidden /> : <BookmarkPlus aria-hidden />} {saved ? 'Saved' : 'Save to wallet'}
        </button>
        <a className="btn btn-ghost" href={href({ name: 'check', evidenceId: record.evidence_id })}><FileSearch aria-hidden /> Check a claim</a>
        <button className="btn btn-ghost" onClick={() => void share()}><Share2 aria-hidden /> Share</button>
        <button className="btn btn-ghost" onClick={() => { void rerun(); toast('Re-verified'); }}><RefreshCw aria-hidden /> Re-verify</button>
      </div>

      <section className="card row" style={{ justifyContent: 'center', gap: 20 }} aria-label="Share as QR code">
        <div style={{ background: '#fff', padding: 12, borderRadius: 14 }}>
          <QRCodeSVG value={shareUrl} size={132} fgColor="#24352D" level="M" />
        </div>
        <p className="muted" style={{ maxWidth: '32ch', fontSize: '0.88rem' }}>
          Anyone can scan this code to run the same check on their own device.
        </p>
      </section>
    </div>
  );
}
