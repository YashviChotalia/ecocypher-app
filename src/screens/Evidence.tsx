import { FilePlus2, FolderOpen, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Empty, ErrorNote, KIND_LABEL, Loading, PageHeader } from '../components/ui';
import { fmtDate } from '../lib/format';
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
      <PageHeader title="Evidence" actions={can('write') && (
        <a className="btn btn-primary" href={href({ name: 'evidence-new' })}><FilePlus2 aria-hidden /> Add</a>
      )} />
      <ErrorNote error={evidence.error} />

      <div className="toolbar">
        <div className="search">
          <Search size={18} aria-hidden />
          <label className="sr-only" htmlFor="ev-search">Search evidence</label>
          <input id="ev-search" className="input" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <label className="select-inline">
          <span className="sr-only">Type</span>
          <select className="select quiet" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="all">All types</option>
            {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            <option value="altered">Altered only</option>
          </select>
        </label>
      </div>

      {evidence.loading ? <Loading /> : list.length ? (
        <div className="rows">
          {list.map((e) => {
            const st = integrity[e.id];
            const bad = st?.state === 'TAMPERED';
            return (
              <a key={e.id} className="row-link" href={href({ name: 'evidence-item', id: e.id })}>
                <span className="row-main">
                  <b>{e.title}</b>
                  <small>{KIND_LABEL[e.kind]}{fac(e.facility_id) ? ` · ${fac(e.facility_id)}` : ''} · {fmtDate(e.period_end ?? e.created_at)}{usedBy(e.id) ? ` · ${usedBy(e.id)} claim${usedBy(e.id) > 1 ? 's' : ''}` : ''}</small>
                </span>
                {bad ? <span className="tag fail">Altered</span> : st ? <span className="tag pass">{st.chain === 'MATCHED' ? 'Verified on-chain' : 'Intact'}</span> : null}
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
