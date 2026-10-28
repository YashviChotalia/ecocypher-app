import { FilePlus2, FolderOpen, Search, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AnchorChip, Empty, ErrorNote, KIND_LABEL, Loading, PageHeader } from '../components/ui';
import { fmtDate, fmtNum } from '../lib/format';
import { useIntegrity, useWorkspaceData } from '../lib/hooks';
import { href } from '../lib/router';
import { useSession } from '../lib/session';
import type { EvidenceKind } from '../lib/types';

export function EvidenceList() {
  const { can } = useSession();
  const { evidence, facilities, claims } = useWorkspaceData();
  const integrity = useIntegrity(evidence.data);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'all' | EvidenceKind | 'altered'>('all');

  const fac = (id?: string | null) => facilities.data?.find((f) => f.id === id)?.name;
  const usedBy = (id: string) => (claims.data ?? []).filter((c) => c.evidence_ids.includes(id)).length;
  const list = useMemo(() => (evidence.data ?? []).filter((e) => {
    if (q && !`${e.title} ${e.ref} ${e.file_name ?? ''}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (kind === 'altered') return integrity[e.id]?.state === 'TAMPERED';
    return kind === 'all' || e.kind === kind;
  }), [evidence.data, q, kind, integrity]);

  return (
    <>
      <PageHeader eyebrow="Evidence library" title="Evidence" actions={can('write') && (
        <a className="btn btn-primary" href={href({ name: 'evidence-new' })}><FilePlus2 aria-hidden /> Add evidence</a>
      )}>
        Every document and MRV record gets a SHA-256 fingerprint when it is added. If anything changes later, it shows here as altered.
      </PageHeader>
      <ErrorNote error={evidence.error} />

      <div className="toolbar">
        <div className="search">
          <Search size={18} aria-hidden />
          <label className="sr-only" htmlFor="ev-search">Search evidence</label>
          <input id="ev-search" className="input" placeholder="Search by title, ID or file" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <label className="select-inline">
          <span className="sr-only">Type</span>
          <select className="select" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="all">All types</option>
            {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            <option value="altered">Altered only</option>
          </select>
        </label>
      </div>

      {evidence.loading ? <Loading /> : list.length ? (
        <div className="list">
          {list.map((e) => {
            const st = integrity[e.id];
            const bad = st?.state === 'TAMPERED';
            const fig = e.metrics.savings_kwh ? `${fmtNum(e.metrics.savings_kwh, 0)} kWh saved` : e.metrics.renewable_kwh ? `${fmtNum(e.metrics.renewable_kwh, 0)} kWh renewable` : null;
            return (
              <a key={e.id} className="record" href={href({ name: 'evidence-item', id: e.id })}>
                <span className={`dot ${bad ? 'fail' : st?.chain === 'MATCHED' ? 'pass' : st ? 'neutral' : ''}`}>{bad ? <ShieldAlert aria-label="Altered" /> : <ShieldCheck aria-label={st ? 'Intact' : 'Checking'} />}</span>
                <span className="meta">
                  <b>{e.title}</b>
                  <small>{KIND_LABEL[e.kind]}{fac(e.facility_id) ? ` · ${fac(e.facility_id)}` : ''} · {e.period_end ? fmtDate(e.period_end) : fmtDate(e.created_at)}</small>
                </span>
                <span className="num">
                  {bad ? <span className="chip fail">Altered</span> : <AnchorChip status={e.anchor_status} />}
                  <small>{fig ?? `${usedBy(e.id)} claim${usedBy(e.id) === 1 ? '' : 's'}`}</small>
                </span>
              </a>
            );
          })}
        </div>
      ) : (
        <Empty icon={<FolderOpen aria-hidden />} title={evidence.data?.length ? 'Nothing matches' : 'No evidence yet'}
          action={can('write') ? <a className="btn btn-primary" href={href({ name: 'evidence-new' })}>Add evidence</a> : undefined}>
          {evidence.data?.length ? 'Try another search or type.' : 'Upload bills, meter exports and audit reports, or import EcoCypher MRV records by QR code.'}
        </Empty>
      )}
    </>
  );
}
