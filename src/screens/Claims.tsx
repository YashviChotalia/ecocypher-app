import { FileSearch, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CHANNEL_LABEL, Empty, ErrorNote, Loading, StatusChip, VerdictChip, download, toCsv } from '../components/ui';
import { useLiveReports, useWorkspaceData } from '../lib/hooks';
import { href } from '../lib/router';
import { useCompany, useSession } from '../lib/session';
import type { Claim } from '../lib/types';

type Filter = 'open' | 'approved' | 'risk' | 'all';

export function Claims() {
  const m = useCompany();
  const { can } = useSession();
  const { claims } = useWorkspaceData();
  const { reports } = useLiveReports();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const match = (c: Claim, f: Filter) =>
    f === 'all' ? true
      : f === 'open' ? c.status === 'draft' || c.status === 'in_review'
        : f === 'approved' ? c.status === 'approved' || c.status === 'published'
          : reports[c.id]?.verdict === 'UNSUPPORTED' && c.status !== 'rejected';

  const list = useMemo(() => (claims.data ?? [])
    .filter((c) => match(c, filter) && (!q || c.text.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at)), [claims.data, q, filter, reports]); // eslint-disable-line react-hooks/exhaustive-deps

  const filters: [Filter, string][] = [['all', 'All'], ['open', 'To review'], ['approved', 'Approved'], ['risk', 'At risk']];
  const exportCsv = () => {
    const rows = [['Claim', 'Channel', 'Status', 'Evidence check', 'Score', 'Evidence items', 'Owner', 'Publish on', 'Decision note', 'Updated']];
    for (const c of list) rows.push([c.text, CHANNEL_LABEL[c.channel], c.status, reports[c.id]?.verdict ?? '', String(reports[c.id]?.score ?? ''), String(c.evidence_ids.length), c.owner_name ?? '', c.publish_on ?? '', c.decision_note ?? '', c.updated_at]);
    download(`${m.company.name.replace(/\W+/g, '-')}-claims.csv`, toCsv(rows));
  };

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">Claims</h1>
        {can('write') && <a className="btn btn-primary" href={href({ name: 'claim', id: 'new' })}><Plus aria-hidden /> New claim</a>}
      </header>
      <ErrorNote error={claims.error} />

      <div className="toolbar">
        <div className="search">
          <Search size={18} aria-hidden />
          <input className="input" aria-label="Search claims" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="tabs" role="group" aria-label="Filter">
          {filters.map(([f, label]) => <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{label}</button>)}
        </div>
      </div>

      {claims.loading ? <Loading /> : list.length ? (
        <div className="rows">
          {list.map((c) => (
            <a key={c.id} className="claim-row" href={href({ name: 'claim', id: c.id })}>
              <span className="claim-text">{c.text}</span>
              <span className="claim-meta"><StatusChip status={c.status} /><VerdictChip verdict={reports[c.id]?.verdict} /><span className="muted">{CHANNEL_LABEL[c.channel]}</span></span>
            </a>
          ))}
        </div>
      ) : (
        <Empty icon={<FileSearch aria-hidden />} title={claims.data?.length ? 'Nothing here' : 'No claims yet'}
          action={can('write') && !claims.data?.length ? <a className="btn btn-primary" href={href({ name: 'claim', id: 'new' })}>Check your first claim</a> : undefined}>
          {claims.data?.length ? 'Try another filter.' : 'Paste a claim from a report, ad or web page to test it against your evidence.'}
        </Empty>
      )}
      {list.length > 0 && <button className="link-btn quiet-link" onClick={exportCsv}>Download as CSV</button>}
    </>
  );
}
