import { FileSearch, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CHANNEL_LABEL, Empty, ErrorNote, Loading, PageHeader, StatusChip, VerdictChip, download, toCsv } from '../components/ui';
import { fmtDate } from '../lib/format';
import { useLiveReports, useWorkspaceData } from '../lib/hooks';
import { href } from '../lib/router';
import { useCompany, useSession } from '../lib/session';
import type { ClaimStatus } from '../lib/types';

type Filter = 'all' | ClaimStatus | 'risk';

export function Claims() {
  const m = useCompany();
  const { can } = useSession();
  const { claims } = useWorkspaceData();
  const { reports } = useLiveReports();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>(() => {
    const f = sessionStorage.getItem('claims-filter') as Filter | null;
    sessionStorage.removeItem('claims-filter');
    return f ?? 'all';
  });

  const list = useMemo(() => (claims.data ?? [])
    .filter((c) => !q || c.text.toLowerCase().includes(q.toLowerCase()))
    .filter((c) => filter === 'all' ? true : filter === 'risk' ? reports[c.id]?.verdict === 'UNSUPPORTED' && c.status !== 'rejected' : c.status === filter)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at)), [claims.data, q, filter, reports]);

  const count = (f: Filter) => (claims.data ?? []).filter((c) => f === 'all' ? true : f === 'risk' ? reports[c.id]?.verdict === 'UNSUPPORTED' && c.status !== 'rejected' : c.status === f).length;
  const filters: [Filter, string][] = [['all', 'All'], ['in_review', 'In review'], ['draft', 'Drafts'], ['approved', 'Approved'], ['published', 'Published'], ['rejected', 'Rejected'], ['risk', 'At risk']];

  const exportCsv = () => {
    const rows = [['Claim', 'Channel', 'Status', 'Verdict', 'Score', 'Evidence items', 'Owner', 'Publish on', 'Decision note', 'Updated']];
    for (const c of list) {
      const r = reports[c.id];
      rows.push([c.text, CHANNEL_LABEL[c.channel], c.status, r?.verdict ?? '', String(r?.score ?? ''), String(c.evidence_ids.length), c.owner_name ?? '', c.publish_on ?? '', c.decision_note ?? '', c.updated_at]);
    }
    download(`${m.company.name.replace(/\W+/g, '-')}-claims-register.csv`, toCsv(rows));
  };

  return (
    <>
      <PageHeader eyebrow="Claims register" title="Green claims" actions={
        <>
          <button className="btn btn-ghost" onClick={exportCsv} disabled={!list.length}>Export CSV</button>
          {can('write') && <a className="btn btn-primary" href={href({ name: 'claim', id: 'new' })}><Plus aria-hidden /> New claim</a>}
        </>
      }>
        Every environmental claim the company plans to make, checked against evidence before it goes out.
      </PageHeader>
      <ErrorNote error={claims.error} />

      <div className="toolbar">
        <div className="search">
          <Search size={18} aria-hidden />
          <label className="sr-only" htmlFor="claim-search">Search claims</label>
          <input id="claim-search" className="input" placeholder="Search claims" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="scroll-x">
          <div className="segmented" role="group" aria-label="Filter by status">
            {filters.map(([f, label]) => (
              <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{label} <span className="count">{count(f)}</span></button>
            ))}
          </div>
        </div>
      </div>

      {claims.loading ? <Loading /> : list.length ? (
        <div className="list">
          {list.map((c) => {
            const r = reports[c.id];
            return (
              <a key={c.id} className="claim-row" href={href({ name: 'claim', id: c.id })}>
                <span className="claim-text">{c.text}</span>
                <span className="claim-meta">
                  <StatusChip status={c.status} />
                  <VerdictChip verdict={r?.verdict} />
                  <span className="muted small">{CHANNEL_LABEL[c.channel]}</span>
                  <span className="muted small">{c.evidence_ids.length} evidence</span>
                  {c.publish_on && <span className="muted small">Goes out {fmtDate(c.publish_on)}</span>}
                </span>
              </a>
            );
          })}
        </div>
      ) : (
        <Empty icon={<FileSearch aria-hidden />} title={claims.data?.length ? 'No claims match' : 'No claims yet'}
          action={can('write') ? <a className="btn btn-primary" href={href({ name: 'claim', id: 'new' })}>Check your first claim</a> : undefined}>
          {claims.data?.length ? 'Try another filter.' : 'Add a claim from a report, ad or web page to test it against your evidence.'}
        </Empty>
      )}
    </>
  );
}
