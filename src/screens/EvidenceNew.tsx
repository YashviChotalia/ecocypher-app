import { ArrowLeft, FileUp, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { QrScanner } from '../components/QrScanner';
import { KIND_LABEL, toast } from '../components/ui';
import { repo } from '../lib/data';
import { fmtBytes, fmtINR, fmtNum } from '../lib/format';
import { refresh, useWorkspaceData } from '../lib/hooks';
import { fetchMrv, inspectMrv, type MrvRecord } from '../lib/mrv';
import { extractEvidenceId } from '../lib/qr';
import { href, navigate } from '../lib/router';
import { useCompany, useSession } from '../lib/session';
import type { EvidenceKind } from '../lib/types';

export function EvidenceNew({ tab }: { tab?: string }) {
  const presetId = tab?.startsWith('id:') ? tab.slice(3) : undefined;
  const [mode, setMode] = useState<'upload' | 'mrv'>(tab === 'scan' || presetId ? 'mrv' : 'upload');
  const { can } = useSession();
  return (
    <div className="stack" style={{ gap: 18 }}>
      <a className="link row" href={href({ name: 'evidence' })} style={{ gap: 6 }}><ArrowLeft size={18} aria-hidden /> Evidence</a>
      <header className="stack" style={{ gap: 6 }}>
        <h1 className="page-title">Add evidence</h1>
        <p className="muted">It is fingerprinted the moment you add it, so any later change shows up.</p>
      </header>
      {!can('write') && <div className="note warn">You have view-only access. Ask an admin for manager access to add evidence.</div>}
      <div className="tabs" role="tablist" aria-label="How to add">
        <button role="tab" aria-pressed={mode === 'upload'} aria-selected={mode === 'upload'} onClick={() => setMode('upload')}>Document</button>
        <button role="tab" aria-pressed={mode === 'mrv'} aria-selected={mode === 'mrv'} onClick={() => setMode('mrv')}>Scan MRV receipt</button>
      </div>
      {mode === 'upload' ? <UploadForm /> : <MrvImport presetId={presetId} />}
    </div>
  );
}

function UploadForm() {
  const m = useCompany();
  const { can } = useSession();
  const { facilities } = useWorkspaceData();
  const [file, setFile] = useState<File | null>(null);
  const [f, setF] = useState({ title: '', kind: 'invoice' as EvidenceKind, facility_id: '', period_start: '', period_end: '', savings_kwh: '', baseline_kwh: '', renewable_kwh: '', co2e_kg: '', money_inr: '', audited: false, auditor: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));
  const num = (v: string) => (v.trim() === '' ? undefined : Number(v.replace(/,/g, '')));
  const suggestedCo2 = num(f.savings_kwh) ? Math.round((num(f.savings_kwh)! * m.company.grid_ef) * 10) / 10 : undefined;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.title.trim()) return;
    setBusy(true);
    try {
      const metrics = Object.fromEntries(Object.entries({
        savings_kwh: num(f.savings_kwh), baseline_kwh: num(f.baseline_kwh), renewable_kwh: num(f.renewable_kwh),
        co2e_kg: num(f.co2e_kg) ?? suggestedCo2, money_inr: num(f.money_inr),
      }).filter(([, v]) => v != null && !Number.isNaN(v)));
      const rec = await repo.addEvidence({
        company_id: m.company_id, kind: f.kind, title: f.title.trim(), facility_id: f.facility_id || null,
        period_start: f.period_start || null, period_end: f.period_end || null, metrics, anchor_status: 'NONE',
        audited: f.audited, auditor: f.audited ? f.auditor || null : null, notes: f.notes || null, file,
      });
      await repo.log({ company_id: m.company_id, action: 'added evidence', entity: 'evidence', entity_id: rec.id, detail: rec.title });
      refresh(m.company_id, 'evidence'); refresh(m.company_id, 'activity');
      toast('Evidence added and fingerprinted');
      navigate({ name: 'evidence-item', id: rec.id });
    } catch (err) { toast((err as Error).message); } finally { setBusy(false); }
  };

  return (
    <form className="card stack" onSubmit={(e) => void submit(e)}>
      <label className="dropzone">
        <FileUp aria-hidden />
        {file ? <span><b>{file.name}</b> · {fmtBytes(file.size)}</span> : <span><b>Choose a file</b> (PDF, spreadsheet, CSV, image). Optional.</span>}
        <input type="file" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <div className="form-grid">
        <label className="field wide">Title<input className="input" required value={f.title} onChange={set('title')} placeholder="e.g. Electricity bills Apr–Sep 2026, Surat" /></label>
        <label className="field">Type<select className="select" value={f.kind} onChange={set('kind')}>{Object.entries(KIND_LABEL).filter(([k]) => k !== 'mrv').map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="field">Facility<select className="select" value={f.facility_id} onChange={set('facility_id')}><option value="">Company-wide</option>{facilities.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label className="field">Period from<input type="date" className="input" value={f.period_start} onChange={set('period_start')} /></label>
        <label className="field">Period to<input type="date" className="input" value={f.period_end} onChange={set('period_end')} /></label>
      </div>
      <details className="disclosure">
        <summary>Figures this evidence proves <span className="muted">(used to test claims)</span></summary>
        <div className="form-grid">
          <label className="field">Energy saved (kWh)<input className="input" inputMode="decimal" value={f.savings_kwh} onChange={set('savings_kwh')} /></label>
          <label className="field">Baseline use (kWh)<input className="input" inputMode="decimal" value={f.baseline_kwh} onChange={set('baseline_kwh')} /></label>
          <label className="field">Renewable generated (kWh)<input className="input" inputMode="decimal" value={f.renewable_kwh} onChange={set('renewable_kwh')} /></label>
          <label className="field">CO₂e avoided (kg)<input className="input" inputMode="decimal" value={f.co2e_kg} onChange={set('co2e_kg')} placeholder={suggestedCo2 ? `${fmtNum(suggestedCo2)} at grid factor` : ''} /></label>
          <label className="field">Money saved (₹)<input className="input" inputMode="decimal" value={f.money_inr} onChange={set('money_inr')} /></label>
        </div>
      </details>
      <label className="check-row"><input type="checkbox" checked={f.audited} onChange={set('audited')} /> Reviewed by an independent third party</label>
      {f.audited && <label className="field">Verifier<input className="input" value={f.auditor} onChange={set('auditor')} placeholder="Firm or accreditation" /></label>}
      <label className="field">Notes<textarea className="textarea" style={{ minHeight: 80 }} value={f.notes} onChange={set('notes')} /></label>
      <button className="btn btn-primary" type="submit" disabled={busy || !f.title.trim() || !can('write')}>{busy ? 'Fingerprinting…' : 'Add and fingerprint'}</button>
    </form>
  );
}

function MrvImport({ presetId }: { presetId?: string }) {
  const m = useCompany();
  const { can } = useSession();
  const { evidence, facilities } = useWorkspaceData();
  const [id, setId] = useState(presetId ?? '');
  const [rec, setRec] = useState<MrvRecord | null>(null);
  const [check, setCheck] = useState<Awaited<ReturnType<typeof inspectMrv>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [facility, setFacility] = useState('');
  const [busy, setBusy] = useState(false);

  const lookup = useCallback(async (ref: string) => {
    setError(null); setRec(null); setCheck(null);
    const existing = evidence.data?.find((e) => e.ref === ref.toUpperCase());
    if (existing) { navigate({ name: 'evidence-item', id: existing.id }); return; }
    try {
      const r = await fetchMrv(ref);
      setRec(r);
      setCheck(await inspectMrv(r));
    } catch (e) { setError((e as Error).message); }
  }, [evidence.data]);

  useEffect(() => { if (presetId && evidence.data) void lookup(presetId); }, [presetId, evidence.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const onText = useCallback((text: string) => {
    const ref = extractEvidenceId(text);
    if (!ref) return false;
    setId(ref);
    void lookup(ref);
    return true;
  }, [lookup]);

  const add = async () => {
    if (!rec || !check) return;
    setBusy(true);
    try {
      const metrics = Object.fromEntries(Object.entries(check.metrics).filter(([, v]) => v != null));
      const ev = await repo.addEvidence({
        company_id: m.company_id, ref: rec.evidence_id, kind: 'mrv', title: rec.title, facility_id: facility || null,
        metrics, canonical_json: rec.canonical_json, sha256: rec.sha256, anchor_status: rec.anchor_status,
        onchain_hash: rec.onchain_hash ?? null, tx_hash: rec.tx_hash ?? null, audited: rec.audited, auditor: rec.audited ? 'EcoCypher MRV verifier' : null,
      });
      await repo.log({ company_id: m.company_id, action: 'imported an MRV record', entity: 'evidence', entity_id: ev.id, detail: `${rec.evidence_id} ${rec.title}` });
      refresh(m.company_id, 'evidence'); refresh(m.company_id, 'activity');
      toast('MRV record imported');
      navigate({ name: 'evidence-item', id: ev.id });
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="grid-2">
      <section className="card stack">
        <h2 className="h2">Scan the QR receipt</h2>
        <QrScanner onText={onText} />
        <div className="divider">or enter the evidence ID</div>
        <form className="row" onSubmit={(e) => { e.preventDefault(); const r = extractEvidenceId(id) ?? id.trim().toUpperCase(); if (r) void lookup(r); }}>
          <label className="sr-only" htmlFor="mrv-id">Evidence ID</label>
          <input id="mrv-id" className="input mono" style={{ flex: 1, minWidth: 0 }} value={id} onChange={(e) => setId(e.target.value)} placeholder="EVD-…" autoCapitalize="characters" spellCheck={false} />
          <button className="btn btn-primary" type="submit" disabled={!id.trim()}>Look up</button>
        </form>
        <button type="button" className="link-btn" style={{ justifySelf: 'start' }} onClick={() => { setId('EVD-88A9F34C2B10'); void lookup('EVD-88A9F34C2B10'); }}>Try a sample record</button>
      </section>

      <section className="card stack" aria-live="polite">
        {error && <div className="note fail">{error}</div>}
        {!rec && !error && <p className="muted">The record’s fingerprint is checked here before you add it.</p>}
        {rec && check && (
          <>
            <div className={`verdict ${check.intact ? 'pass' : 'fail'}`}>
              <div className="head">
                <span className="badge">{check.intact ? <ShieldCheck aria-hidden /> : <ShieldAlert aria-hidden />}</span>
                <div><span className="eyebrow">{rec.evidence_id}</span><h1>{check.intact ? 'Fingerprint matches' : 'Fingerprint does not match'}</h1></div>
              </div>
              <p>{rec.title}{rec.source === 'sample' ? ' · sample record' : ''}</p>
            </div>
            <div className="metrics">
              <div className="metric"><small>Energy saved</small><b>{fmtNum(check.metrics.savings_kwh, 0)} kWh</b></div>
              <div className="metric"><small>CO₂e avoided</small><b>{fmtNum((check.metrics.co2e_kg ?? 0) / 1000, 2)} t</b></div>
              <div className="metric"><small>Money saved</small><b>{fmtINR(check.metrics.money_inr)}</b></div>
              <div className="metric"><small>Anchor</small><b>{rec.anchor_status === 'ANCHORED' ? 'On-chain' : 'Not anchored'}</b></div>
            </div>
            <label className="field">Facility<select className="select" value={facility} onChange={(e) => setFacility(e.target.value)}><option value="">Company-wide</option>{facilities.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            {!check.intact && <div className="note fail">This record was changed after it was issued. You can still add it, but it will be marked as altered and won’t support claims.</div>}
            <button className="btn btn-primary" onClick={() => void add()} disabled={busy || !can('write')}>Add to evidence library</button>
          </>
        )}
      </section>
    </div>
  );
}
