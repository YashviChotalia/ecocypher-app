import { ArrowLeft, Download, ShieldAlert, ShieldCheck, ShieldQuestion, Trash2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';
import { AnchorChip, KIND_LABEL, Loading, StatusChip, copyText, toast } from '../components/ui';
import { repo } from '../lib/data';
import { fmtBytes, fmtDate, fmtINR, fmtNum } from '../lib/format';
import { refresh, useIntegrity, useWorkspaceData } from '../lib/hooks';
import { shortHash } from '../lib/hash';
import { href, navigate } from '../lib/router';
import { useCompany, useSession } from '../lib/session';

export function EvidenceItem({ id }: { id: string }) {
  const m = useCompany();
  const { can } = useSession();
  const { evidence, facilities, claims } = useWorkspaceData();
  const e = evidence.data?.find((x) => x.id === id || x.ref === id);
  const integrity = useIntegrity(e ? [e] : undefined);
  const [busy, setBusy] = useState(false);

  if (evidence.loading) return <Loading />;
  if (!e) return <div className="note warn">Evidence not found. <a href={href({ name: 'evidence' })}>Back to evidence</a></div>;
  const r = integrity[e.id];
  const tone = !r ? 'neutral' : r.state === 'TAMPERED' || r.chain === 'MISMATCHED' ? 'fail' : r.chain === 'MATCHED' ? 'pass' : 'pass';
  const Icon = !r ? ShieldQuestion : tone === 'fail' ? ShieldAlert : ShieldCheck;
  const headline = !r ? 'Checking…' : r.state === 'TAMPERED' ? 'Altered after it was added' : r.chain === 'MISMATCHED' ? 'On-chain proof doesn’t match'
    : r.chain === 'MATCHED' ? 'Intact and anchored on-chain' : 'Intact';
  const explain = !r ? '' : r.reason === 'FIGURES'
    ? 'The signed MRV record is intact, but the figures stored with it here were changed afterwards. Treat these figures as unverified.'
    : r.state === 'TAMPERED'
    ? 'The stored details no longer produce the fingerprint taken when this evidence was added. Treat its figures as unverified and find the original.'
    : r.chain === 'MATCHED' ? 'The fingerprint matches the original and the copy anchored in EvidenceRegistry.sol.'
      : 'The fingerprint matches the one taken when this evidence was added. It is not anchored on a blockchain, so it is self-reported.';
  const usedBy = (claims.data ?? []).filter((c) => c.evidence_ids.includes(e.id));
  const fac = facilities.data?.find((f) => f.id === e.facility_id);

  const open = async () => {
    if (!e.file_path) return;
    const url = await repo.fileUrl(e.file_path);
    if (url) window.open(url, '_blank', 'noopener');
    else toast('The file is only stored as a fingerprint in the demo workspace.');
  };
  const remove = async () => {
    setBusy(true);
    try {
      await repo.deleteEvidence(e.id);
      await repo.log({ company_id: m.company_id, action: 'deleted evidence', entity: 'evidence', entity_id: e.id, detail: e.title });
      refresh(m.company_id, 'evidence'); refresh(m.company_id, 'claims');
      navigate({ name: 'evidence' });
      toast('Evidence deleted');
    } catch (err) { toast((err as Error).message); setBusy(false); }
  };

  return (
    <div className="stack" style={{ gap: 18 }}>
      <a className="link row" href={href({ name: 'evidence' })} style={{ gap: 6 }}><ArrowLeft size={18} aria-hidden /> Evidence</a>
      <section className={`verdict ${tone}`}>
        <div className="head">
          <span className="badge"><Icon aria-hidden /></span>
          <div><span className="eyebrow">{e.ref} · {KIND_LABEL[e.kind]}</span><h1>{headline}</h1></div>
        </div>
        <p>{explain}</p>
        <div className="row"><AnchorChip status={e.anchor_status} /><span className={`chip ${e.audited ? 'pass' : 'neutral'}`}>{e.audited ? 'Independently verified' : 'Not audited'}</span></div>
      </section>

      <section className="stack">
        <h2 className="h2">{e.title}</h2>
        {(e.metrics.savings_kwh != null || e.metrics.renewable_kwh != null) && (
          <div className="metrics">
            {e.metrics.savings_kwh != null && <div className="metric"><small>Energy saved</small><b>{fmtNum(e.metrics.savings_kwh, 0)} kWh</b></div>}
            {e.metrics.renewable_kwh != null && <div className="metric"><small>Renewable generated</small><b>{fmtNum(e.metrics.renewable_kwh, 0)} kWh</b></div>}
            {e.metrics.co2e_kg != null && <div className="metric"><small>CO₂e avoided</small><b>{fmtNum(e.metrics.co2e_kg / 1000, 2)} t</b></div>}
            {e.metrics.money_inr != null && <div className="metric"><small>Money saved</small><b>{fmtINR(e.metrics.money_inr)}</b></div>}
            {e.metrics.baseline_kwh != null && e.metrics.savings_kwh != null && <div className="metric"><small>Reduction</small><b>{fmtNum((e.metrics.savings_kwh / e.metrics.baseline_kwh) * 100)}%</b></div>}
          </div>
        )}
        {r?.state === 'TAMPERED' && <p className="muted small">These are the figures stored now. They are not verified.</p>}
      </section>

      <section className="card stack">
        <div className="section-title"><h2>Fingerprint check</h2><span className="eyebrow">SHA-256</span></div>
        <div className={`hashbox ${r && r.computed === e.sha256 ? 'match' : r ? 'mismatch' : ''}`}>
          <span className="label"><span>Recomputed now</span><span>{r ? (r.computed === e.sha256 ? 'Match' : 'No match') : '…'}</span></span>
          <span className="mono">{r?.computed ?? '…'}</span>
        </div>
        <div className="hashbox"><span className="label"><span>Taken when added</span></span><span className="mono">{e.sha256}</span></div>
        {r?.reason === 'FIGURES' && (
          <div className="hashbox mismatch">
            <span className="label"><span>Figures stored here vs the signed record</span><span>No match</span></span>
            <span className="small">Energy saved: {fmtNum(e.metrics.savings_kwh, 0)} kWh here, {fmtNum(r.signed?.savings_kwh, 0)} kWh in the signed record.{r.signed?.co2e_kg != null ? ` CO₂e: ${fmtNum((e.metrics.co2e_kg ?? 0) / 1000, 2)} t here, ${fmtNum(r.signed.co2e_kg / 1000, 2)} t signed.` : ''}</span>
          </div>
        )}
        {e.onchain_hash && <div className={`hashbox ${r?.chain === 'MATCHED' ? 'match' : 'mismatch'}`}><span className="label"><span>On-chain (EvidenceRegistry.sol)</span><span>{r?.chain === 'MATCHED' ? 'Match' : 'No match'}</span></span><span className="mono">{e.onchain_hash}</span></div>}
        {e.file_sha256 && <div className="hashbox"><span className="label"><span>File fingerprint{e.file_name ? ` · ${e.file_name}` : ''}</span><span>{fmtBytes(e.file_size)}</span></span><span className="mono">{e.file_sha256}</span></div>}
      </section>

      <section className="card">
        <dl className="details">
          <dt>Facility</dt><dd>{fac ? `${fac.name}, ${fac.city}` : 'Company-wide'}</dd>
          <dt>Period</dt><dd>{e.period_start ? `${fmtDate(e.period_start)} – ${fmtDate(e.period_end)}` : '—'}</dd>
          {e.auditor && <><dt>Verified by</dt><dd>{e.auditor}</dd></>}
          {e.tx_hash && <><dt>Transaction</dt><dd className="mono">{shortHash(e.tx_hash, 12)}</dd></>}
          {e.notes && <><dt>Notes</dt><dd>{e.notes}</dd></>}
          <dt>Added</dt><dd>{fmtDate(e.created_at)}{e.created_by ? ` by ${e.created_by}` : ''}</dd>
        </dl>
      </section>

      <section className="card stack">
        <div className="section-title"><h2>Used by {usedBy.length} claim{usedBy.length === 1 ? '' : 's'}</h2></div>
        {usedBy.length ? usedBy.map((c) => (
          <a key={c.id} className="list-row" href={href({ name: 'claim', id: c.id })}><span className="clamp-2">{c.text}</span><StatusChip status={c.status} /></a>
        )) : <p className="muted small">Not attached to any claim yet.</p>}
      </section>

      <div className="row">
        {e.file_path && <button className="btn btn-ghost" onClick={() => void open()}><Download aria-hidden /> Open file</button>}
        <button className="btn btn-ghost" onClick={async () => toast((await copyText(`${e.ref} sha256:${e.sha256}`)) ? 'Fingerprint copied' : 'Copy failed')}>Copy fingerprint</button>
        {can('admin') && <button className="btn btn-ghost danger-text" disabled={busy} onClick={() => void remove()}><Trash2 aria-hidden /> Delete</button>}
      </div>

      <section className="card row" style={{ justifyContent: 'center', gap: 20 }}>
        <div className="qr"><QRCodeSVG value={`${location.origin}/verify/${e.ref}`} size={128} fgColor="#24352D" level="M" /></div>
        <p className="muted small" style={{ maxWidth: '34ch' }}>Print this code on reports or site boards. Scanning it in EcoCypher opens this evidence and re-runs the fingerprint check.</p>
      </section>
    </div>
  );
}
