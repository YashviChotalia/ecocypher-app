import { ArrowLeft, Check, Copy, Send, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CHANNEL_LABEL, ErrorNote, KIND_LABEL, LevelIcon, Loading, Sheet, StatusChip, VERDICT_LABEL, VERDICT_TONE, copyText, toast } from '../components/ui';
import { checkClaim } from '../lib/claims';
import { repo } from '../lib/data';
import { fmtDate, fmtDateTime } from '../lib/format';
import { companyContext, fyFromText, refresh, summarizeEvidence, useFinancialYears, useIntegrity, useWorkspaceData } from '../lib/hooks';
import { href, navigate } from '../lib/router';
import { useCompany, useSession } from '../lib/session';
import type { Claim, ClaimChannel, ClaimStatus } from '../lib/types';

const EXAMPLES = [
  'We cut Scope 2 emissions by 10% in FY 2025-26 compared with FY 2024-25.',
  'Our factories are 100% green and eco-friendly.',
  'The compressed-air programme at Surat saved 48,200 kWh in FY 2025-26.',
];

export function ClaimDetail({ id }: { id: string }) {
  const m = useCompany();
  const { user, can } = useSession();
  const { claims, evidence, energy } = useWorkspaceData();
  const integrity = useIntegrity(evidence.data);
  const years = useFinancialYears(energy.data);
  const isNew = id === 'new';
  const existing = claims.data?.find((c) => c.id === id);

  const [text, setText] = useState('');
  const [channel, setChannel] = useState<ClaimChannel>('annual_report');
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [publishOn, setPublishOn] = useState('');
  const [owner, setOwner] = useState('');
  const [busy, setBusy] = useState(false);
  const [decision, setDecision] = useState<null | 'approve' | 'reject'>(null);
  const [note, setNote] = useState('');
  const [pickOpen, setPickOpen] = useState(false);

  useEffect(() => {
    if (existing) {
      setText(existing.text); setChannel(existing.channel); setEvidenceIds(existing.evidence_ids);
      setPublishOn(existing.publish_on ?? ''); setOwner(existing.owner_name ?? '');
    } else if (isNew) {
      setOwner(user?.name ?? '');
    }
  }, [existing?.id, isNew]); // eslint-disable-line react-hooks/exhaustive-deps

  const fyOptions = years.complete.concat(years.all.filter((y) => !years.complete.includes(y)));
  const report = useMemo(() => {
    if (!text.trim() || !evidence.data || !energy.data) return null;
    return checkClaim(text, {
      evidence: summarizeEvidence(evidenceIds, evidence.data, integrity),
      company: companyContext(fyFromText(text, fyOptions), energy.data, m.company),
    });
  }, [text, evidenceIds, evidence.data, energy.data, integrity, m.company, fyOptions.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  if (claims.loading || evidence.loading) return <Loading />;
  if (!isNew && !existing) return <div className="note warn">This claim no longer exists. <a href={href({ name: 'claims' })}>Back to the register</a></div>;

  const editable = can('write') && (isNew || existing!.status === 'draft' || existing!.status === 'rejected' || existing!.status === 'in_review');
  const dirty = !existing || text !== existing.text || channel !== existing.channel || evidenceIds.join() !== existing.evidence_ids.join() || (publishOn || '') !== (existing.publish_on ?? '') || owner !== (existing.owner_name ?? '');

  const save = async (status?: ClaimStatus, extra: Partial<Claim> = {}) => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const rec = await repo.saveClaim({
        ...(existing ?? {}), id: existing?.id, company_id: m.company_id, text: text.trim(), channel, evidence_ids: evidenceIds,
        status: status ?? existing?.status ?? 'draft', verdict: report?.verdict ?? null, score: report?.score ?? null,
        owner_name: owner || null, publish_on: publishOn || null, ...extra,
      } as Claim);
      const action = !existing ? 'added a claim' : status === 'in_review' ? 'submitted a claim for review' : status === 'approved' ? 'approved a claim'
        : status === 'rejected' ? 'rejected a claim' : status === 'published' ? 'marked a claim as published' : 'edited a claim';
      await repo.log({ company_id: m.company_id, action, entity: 'claim', entity_id: rec.id, detail: extra.decision_note || rec.text });
      refresh(m.company_id, 'claims'); refresh(m.company_id, 'activity');
      toast(status === 'approved' ? 'Claim approved' : status === 'rejected' ? 'Claim rejected' : status === 'in_review' ? 'Sent for review' : status === 'published' ? 'Marked as published' : 'Saved');
      if (!existing) navigate({ name: 'claim', id: rec.id });
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
      setDecision(null);
      setNote('');
    }
  };

  const remove = async () => {
    if (!existing) return;
    setBusy(true);
    try {
      await repo.deleteClaim(existing.id);
      await repo.log({ company_id: m.company_id, action: 'deleted a claim', entity: 'claim', entity_id: existing.id, detail: existing.text });
      refresh(m.company_id, 'claims');
      navigate({ name: 'claims' });
      toast('Claim deleted');
    } catch (e) { toast((e as Error).message); setBusy(false); }
  };

  const attached = (evidence.data ?? []).filter((e) => evidenceIds.includes(e.id));
  const verdict = report?.verdict;
  const tone = verdict ? VERDICT_TONE[verdict] : 'neutral';

  return (
    <div className="stack" style={{ gap: 18 }}>
      <a className="link row" href={href({ name: 'claims' })} style={{ gap: 6 }}><ArrowLeft size={18} aria-hidden /> Claims register</a>
      <header className="page-header">
        <div className="stack" style={{ gap: 6 }}>
          <span className="eyebrow">{isNew ? 'New claim' : `Claim · ${CHANNEL_LABEL[existing!.channel]}`}</span>
          <h1 className="page-title">{isNew ? 'Check a claim before it goes out' : 'Claim review'}</h1>
        </div>
        {existing && <StatusChip status={existing.status} />}
      </header>
      <ErrorNote error={evidence.error} />

      <div className="claim-layout">
        <section className="card stack">
          <label className="field" htmlFor="claim-text">
            Claim wording
            <span className="hint">Exactly as it will appear. Changing the wording re-runs the check.</span>
          </label>
          <textarea id="claim-text" className="textarea" value={text} onChange={(e) => setText(e.target.value)} readOnly={!editable}
            placeholder="e.g. We cut Scope 2 emissions by 10% in FY 2025-26 compared with FY 2024-25." />
          {isNew && !text && (
            <div className="examples" aria-label="Example claims">
              {EXAMPLES.map((ex) => <button type="button" key={ex} onClick={() => setText(ex)}>{ex.length > 52 ? `${ex.slice(0, 50)}…` : ex}</button>)}
            </div>
          )}

          <div className="form-grid">
            <label className="field">Where it appears
              <select className="select" value={channel} onChange={(e) => setChannel(e.target.value as ClaimChannel)} disabled={!editable}>
                {Object.entries(CHANNEL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="field">Goes out on
              <input type="date" className="input" value={publishOn} onChange={(e) => setPublishOn(e.target.value)} disabled={!editable} />
            </label>
            <label className="field">Owner
              <input className="input" value={owner} onChange={(e) => setOwner(e.target.value)} disabled={!editable} placeholder="Team or person" />
            </label>
          </div>

          <div className="section-title"><h2>Evidence</h2>{editable && <button className="link-btn" onClick={() => setPickOpen(true)}>{attached.length ? 'Change' : 'Attach evidence'}</button>}</div>
          {attached.length ? (
            <ul className="evidence-chips">
              {attached.map((e) => (
                <li key={e.id}>
                  <a href={href({ name: 'evidence-item', id: e.id })}>{e.title}</a>
                  <span className={`chip ${integrity[e.id]?.state === 'TAMPERED' ? 'fail' : 'neutral'}`}>{integrity[e.id]?.state === 'TAMPERED' ? 'Altered' : KIND_LABEL[e.kind]}</span>
                </li>
              ))}
            </ul>
          ) : <p className="muted small">No evidence attached. Company-wide figures (emissions trend, renewable share) are still checked against your energy data.</p>}

          {editable && (
            <div className="row">
              <button className="btn btn-primary" disabled={!text.trim() || busy || (!!existing && !dirty)} onClick={() => void save()}>{isNew ? 'Save as draft' : 'Save changes'}</button>
              {(isNew || existing?.status === 'draft' || existing?.status === 'rejected') && (
                <button className="btn btn-ghost" disabled={!text.trim() || busy} onClick={() => void save('in_review')}><Send aria-hidden /> Submit for review</button>
              )}
            </div>
          )}
        </section>

        <section className={`card stack report ${tone}`} aria-live="polite">
          {!report ? (
            <p className="muted">Type the claim to see the check.</p>
          ) : (
            <>
              <div className="score">
                <div className="ring" style={{ ['--p' as string]: report.score, ['--ring-color' as string]: `var(--${tone})` }}><span>{report.score}</span></div>
                <div className="stack" style={{ gap: 4 }}>
                  <span className={`chip ${tone}`} style={{ justifySelf: 'start' }}><LevelIcon level={tone as 'pass'} /> {VERDICT_LABEL[report.verdict]}</span>
                  <p className="small" style={{ color: 'var(--text-2)' }}>{report.summary}</p>
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
                const t = [`Claim: ${text.trim()}`, `Verdict: ${VERDICT_LABEL[report.verdict]} (${report.score}/100)`,
                  `Evidence: ${attached.map((e) => `${e.ref} ${e.title}`).join('; ') || 'none'}`,
                  ...report.checks.map((c) => `${c.level === 'pass' ? '✓' : c.level === 'warn' ? '!' : '✗'} ${c.title}: ${c.detail}`),
                  `— EcoCypher ESG, ${m.company.name}`].join('\n');
                toast((await copyText(t)) ? 'Report copied' : 'Copy failed');
              }}><Copy aria-hidden /> Copy report</button>
            </>
          )}
        </section>
      </div>

      {existing && (
        <section className="card stack">
          <div className="section-title"><h2>Decision</h2></div>
          {existing.decided_at && (
            <p className="small"><b>{STATUS_WORD[existing.status] ?? 'Decided'}</b> by {existing.decided_by ?? '—'} on {fmtDateTime(existing.decided_at)}{existing.decision_note ? `: “${existing.decision_note}”` : ''}</p>
          )}
          <p className="muted small">Created by {existing.created_by ?? '—'} · {fmtDate(existing.created_at)}{existing.publish_on ? ` · goes out ${fmtDate(existing.publish_on)}` : ''}</p>
          {can('write') && (
            <div className="row">
              {existing.status === 'in_review' && <>
                <button className="btn btn-primary" disabled={busy} onClick={() => setDecision('approve')}><Check aria-hidden /> Approve</button>
                <button className="btn btn-danger" disabled={busy} onClick={() => setDecision('reject')}><X aria-hidden /> Reject</button>
              </>}
              {existing.status === 'approved' && <button className="btn btn-primary" disabled={busy} onClick={() => void save('published')}>Mark as published</button>}
              {(existing.status === 'approved' || existing.status === 'published' || existing.status === 'rejected') && (
                <button className="btn btn-ghost" disabled={busy} onClick={() => void save('draft', { decided_at: null, decided_by: null, decision_note: null })}>Reopen as draft</button>
              )}
              {existing.status !== 'published' && <button className="btn btn-ghost danger-text" disabled={busy} onClick={() => void remove()}><Trash2 aria-hidden /> Delete</button>}
            </div>
          )}
        </section>
      )}

      <Sheet title={decision === 'approve' ? 'Approve this claim' : 'Reject this claim'} open={!!decision} onClose={() => setDecision(null)}
        footer={<>
          <button className="btn btn-ghost" onClick={() => setDecision(null)}>Cancel</button>
          <button className={`btn ${decision === 'approve' ? 'btn-primary' : 'btn-danger'}`}
            disabled={busy || (decision === 'reject' && !note.trim()) || (decision === 'approve' && verdict === 'UNSUPPORTED' && !note.trim())}
            onClick={() => void save(decision === 'approve' ? 'approved' : 'rejected', { decision_note: note.trim() || null, decided_by: user?.name ?? null, decided_at: new Date().toISOString() })}>
            {decision === 'approve' ? 'Approve' : 'Reject'}
          </button>
        </>}>
        {decision === 'approve' && verdict === 'UNSUPPORTED' && (
          <div className="note fail">The evidence check does not support this claim. Approving it anyway needs a written justification, which is kept in the audit trail.</div>
        )}
        <label className="field" htmlFor="decision-note">
          {decision === 'reject' ? 'What needs to change?' : 'Note (optional)'}
          <textarea id="decision-note" className="textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder={decision === 'reject' ? 'e.g. Replace “eco-friendly” with the measured saving and attach the M&V record.' : ''} />
        </label>
      </Sheet>

      <Sheet title="Attach evidence" open={pickOpen} onClose={() => setPickOpen(false)} footer={<button className="btn btn-primary" onClick={() => setPickOpen(false)}>Done</button>}>
        <div className="stack">
          {(evidence.data ?? []).map((e) => (
            <label key={e.id} className="pick-row">
              <input type="checkbox" checked={evidenceIds.includes(e.id)} onChange={(ev) => setEvidenceIds((ids) => ev.target.checked ? [...ids, e.id] : ids.filter((x) => x !== e.id))} />
              <span><b>{e.title}</b><small>{KIND_LABEL[e.kind]} · {e.ref}{integrity[e.id]?.state === 'TAMPERED' ? ' · altered' : ''}</small></span>
            </label>
          ))}
          {!evidence.data?.length && <p className="muted">No evidence yet. <a href={href({ name: 'evidence-new' })}>Add evidence</a></p>}
        </div>
      </Sheet>
    </div>
  );
}

const STATUS_WORD: Partial<Record<ClaimStatus, string>> = { approved: 'Approved', rejected: 'Rejected', published: 'Approved, then published' };
