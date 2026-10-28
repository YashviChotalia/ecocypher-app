import { Search, Wallet as WalletIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PageHeader, RecordRow } from '../components/ui';
import { href } from '../lib/router';
import { useStore } from '../lib/store';
import { useIntegrityMap } from '../lib/useVerification';

type Filter = 'all' | 'anchored' | 'pending' | 'altered';

export function Wallet() {
  const wallet = useStore((s) => s.wallet);
  const integrity = useIntegrityMap(wallet);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const items = useMemo(() => wallet.filter((r) => {
    const text = `${r.title} ${r.evidence_id} ${r.canonical_json}`.toLowerCase();
    if (q && !text.includes(q.toLowerCase())) return false;
    if (filter === 'anchored') return r.anchor_status === 'ANCHORED' && integrity[r.evidence_id] === 'INTACT';
    if (filter === 'pending') return r.anchor_status !== 'ANCHORED' && integrity[r.evidence_id] !== 'TAMPERED';
    if (filter === 'altered') return integrity[r.evidence_id] === 'TAMPERED';
    return true;
  }), [wallet, q, filter, integrity]);

  const filters: [Filter, string][] = [['all', 'All'], ['anchored', 'Anchored'], ['pending', 'Not anchored'], ['altered', 'Altered']];

  return (
    <>
      <PageHeader eyebrow="Wallet" title="Your evidence">
        Records you’ve scanned or saved. Each one is re-checked every time you open the app.
      </PageHeader>
      <div className="stack">
        <label className="sr-only" htmlFor="wallet-search">Search evidence</label>
        <div style={{ position: 'relative' }}>
          <Search size={18} aria-hidden style={{ position: 'absolute', left: 14, top: 15, color: 'var(--text-3)' }} />
          <input id="wallet-search" className="input" style={{ paddingLeft: 42 }} placeholder="Search by name, ID or building" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div style={{ overflowX: 'auto' }}>
          <div className="segmented" role="group" aria-label="Filter records">
            {filters.map(([f, label]) => (
              <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{label}</button>
            ))}
          </div>
        </div>
      </div>
      {items.length ? (
        <div className="list">{items.map((r) => <RecordRow key={r.evidence_id} record={r} integrity={integrity[r.evidence_id]} />)}</div>
      ) : (
        <div className="card flat empty">
          <WalletIcon aria-hidden />
          <p>{wallet.length ? 'No records match.' : 'Your wallet is empty.'}</p>
          <a className="btn btn-primary" href={href({ name: 'scan' })}>Scan a receipt</a>
        </div>
      )}
    </>
  );
}
