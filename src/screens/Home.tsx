import { FileSearch, ScanLine, WifiOff, Wifi } from 'lucide-react';
import { RecordRow } from '../components/ui';
import { parseEvidence } from '../lib/hash';
import { fmtINRCompact, fmtNum, fmtTonnes } from '../lib/format';
import { href } from '../lib/router';
import { useStore } from '../lib/store';
import { useIntegrityMap } from '../lib/useVerification';

export function Home() {
  const wallet = useStore((s) => s.wallet);
  const apiUrl = useStore((s) => s.settings.apiUrl);
  const integrity = useIntegrityMap(wallet);

  // Only count evidence that still matches its hash.
  const intact = wallet.filter((r) => integrity[r.evidence_id] === 'INTACT');
  const totals = intact.reduce(
    (acc, r) => {
      const e = parseEvidence(r);
      if (!e) return acc;
      return { kwh: acc.kwh + e.savings_kwh, inr: acc.inr + e.economic_saving, co2: acc.co2 + e.co2e_reduction_kg };
    },
    { kwh: 0, inr: 0, co2: 0 },
  );
  const altered = wallet.filter((r) => integrity[r.evidence_id] === 'TAMPERED').length;
  const checked = Object.keys(integrity).length === wallet.length;

  return (
    <>
      <section className="hero fade-in" aria-labelledby="hero-title">
        <span className="eyebrow" id="hero-title">Verified energy saved</span>
        <div className="hero-figure">
          {checked ? fmtNum(totals.kwh) : '…'}
          <span>kWh</span>
        </div>
        <p className="hero-sub">
          From {intact.length} intact evidence record{intact.length === 1 ? '' : 's'} in your wallet
          {altered ? ` · ${altered} altered record${altered === 1 ? '' : 's'} excluded` : ''}.
        </p>
        <div className="hero-stats">
          <div className="hero-stat"><small>CO₂e</small><b>{fmtTonnes(totals.co2)}</b></div>
          <div className="hero-stat"><small>Saved</small><b>{fmtINRCompact(totals.inr)}</b></div>
          <div className="hero-stat"><small>Records</small><b>{wallet.length}</b></div>
        </div>
      </section>

      <div className="actions">
        <a className="action" href={href({ name: 'scan' })}>
          <span className="ico"><ScanLine aria-hidden /></span>
          <b>Scan a receipt</b>
          <small>Point your camera at an EcoCypher QR code to verify it.</small>
        </a>
        <a className="action" href={href({ name: 'check' })}>
          <span className="ico gold"><FileSearch aria-hidden /></span>
          <b>Check a claim</b>
          <small>Test a green claim against the evidence behind it.</small>
        </a>
      </div>

      <a className="card flat row" href={href({ name: 'settings' })} style={{ textDecoration: 'none', justifyContent: 'space-between' }}>
        <span className="row" style={{ gap: 12 }}>
          {apiUrl ? <Wifi size={20} color="var(--forest)" aria-hidden /> : <WifiOff size={20} color="var(--gold-ink)" aria-hidden />}
          <span>
            <b style={{ display: 'block', fontSize: '0.95rem' }}>{apiUrl ? 'Connected to your EcoCypher server' : 'Demo mode'}</b>
            <small className="muted">{apiUrl ? apiUrl.replace(/^https?:\/\//, '') : 'Using sample records. Connect a server for live evidence.'}</small>
          </span>
        </span>
        <span className="link">{apiUrl ? 'Change' : 'Connect'}</span>
      </a>

      <section className="stack">
        <div className="section-title">
          <h2>Recent evidence</h2>
          <a href={href({ name: 'wallet' })}>See all</a>
        </div>
        <div className="list">
          {wallet.slice(0, 4).map((r) => <RecordRow key={r.evidence_id} record={r} integrity={integrity[r.evidence_id]} />)}
        </div>
      </section>
    </>
  );
}
