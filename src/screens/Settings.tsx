import { Download, Laptop, Moon, RotateCcw, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PageHeader, toast } from '../components/ui';
import { testConnection } from '../lib/api';
import { store, useStore, type ThemePref } from '../lib/store';

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferredInstall: InstallEvent | null = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e as InstallEvent; });

export function Settings() {
  const settings = useStore((s) => s.settings);
  const [url, setUrl] = useState(settings.apiUrl);
  const [status, setStatus] = useState<{ tone: 'pass' | 'fail' | 'neutral'; text: string } | null>(null);
  const [canInstall, setCanInstall] = useState(!!deferredInstall);
  const standalone = window.matchMedia('(display-mode: standalone)').matches;

  useEffect(() => {
    const on = () => setCanInstall(true);
    window.addEventListener('beforeinstallprompt', on);
    return () => window.removeEventListener('beforeinstallprompt', on);
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = url.trim();
    if (!value) {
      store.updateSettings({ apiUrl: '' });
      setStatus({ tone: 'neutral', text: 'Disconnected. The app is in demo mode.' });
      return;
    }
    if (!/^https?:\/\//i.test(value)) {
      setStatus({ tone: 'fail', text: 'Enter a full address starting with https://' });
      return;
    }
    setStatus({ tone: 'neutral', text: 'Connecting…' });
    try {
      const service = await testConnection(value);
      store.updateSettings({ apiUrl: value });
      setStatus({ tone: 'pass', text: `Connected: ${service}` });
    } catch (err) {
      setStatus({ tone: 'fail', text: `Couldn’t connect (${(err as Error).message}). Check the address and that the server allows this app (CORS).` });
    }
  };

  const themes: [ThemePref, string, typeof Sun][] = [['system', 'System', Laptop], ['light', 'Light', Sun], ['dark', 'Dark', Moon]];

  return (
    <>
      <PageHeader eyebrow="Settings" title="Settings" />

      <form className="card stack" onSubmit={(e) => void save(e)}>
        <div className="section-title"><h2>EcoCypher server</h2></div>
        <p className="muted" style={{ fontSize: '0.9rem' }}>
          Connect your impact API to look up live evidence. Leave it empty to use the sample records.
        </p>
        <label className="field" htmlFor="api-url">Server address</label>
        <input id="api-url" className="input" inputMode="url" placeholder="https://impact-api.example.com" value={url} onChange={(e) => setUrl(e.target.value)} autoComplete="url" spellCheck={false} />
        {status && <span className={`chip ${status.tone}`} role="status" style={{ justifySelf: 'start', whiteSpace: 'normal' }}>{status.text}</span>}
        <div className="row">
          <button className="btn btn-primary" type="submit">Save and test</button>
          {settings.apiUrl && <button type="button" className="btn btn-ghost" onClick={() => { setUrl(''); store.updateSettings({ apiUrl: '' }); setStatus({ tone: 'neutral', text: 'Disconnected. The app is in demo mode.' }); }}>Disconnect</button>}
        </div>
      </form>

      <section className="card stack">
        <div className="section-title"><h2>Appearance</h2></div>
        <div className="segmented" role="group" aria-label="Theme">
          {themes.map(([t, label, Icon]) => (
            <button key={t} aria-pressed={settings.theme === t} onClick={() => store.updateSettings({ theme: t })} className="row" style={{ gap: 6 }}>
              <Icon size={16} aria-hidden /> {label}
            </button>
          ))}
        </div>
      </section>

      <section className="card stack">
        <div className="section-title"><h2>Install the app</h2></div>
        {standalone ? (
          <p className="muted">EcoCypher is installed on this device.</p>
        ) : canInstall ? (
          <button className="btn btn-primary" onClick={async () => {
            if (!deferredInstall) return;
            await deferredInstall.prompt();
            const choice = await deferredInstall.userChoice;
            if (choice.outcome === 'accepted') toast('Installing EcoCypher');
            deferredInstall = null;
            setCanInstall(false);
          }}><Download aria-hidden /> Install EcoCypher</button>
        ) : (
          <p className="muted" style={{ fontSize: '0.9rem' }}>
            On iPhone or iPad: tap Share, then “Add to Home Screen”. On Android or desktop Chrome/Edge: use “Install app” in the browser menu.
            It works offline once installed.
          </p>
        )}
      </section>

      <section className="card stack">
        <div className="section-title"><h2>How verification works</h2></div>
        <p className="muted" style={{ fontSize: '0.9rem' }}>
          Each evidence record is stored as canonical JSON (keys sorted, no spaces). Its SHA-256 fingerprint is taken when it is created and,
          when anchored, written to the EvidenceRegistry smart contract. This app recomputes that fingerprint on your device: if even one digit
          changed, the fingerprints no longer match.
        </p>
        <p className="muted" style={{ fontSize: '0.9rem' }}>
          Claim checks are transparent rules: specific figures, time period, vague or absolute wording, offsets, future pledges, evidence integrity,
          anchoring, independent audit, and whether the claimed numbers exceed the verified ones.
        </p>
      </section>

      <section className="card stack">
        <div className="section-title"><h2>Data</h2></div>
        <p className="muted" style={{ fontSize: '0.9rem' }}>Your wallet is stored only on this device.</p>
        <button className="btn btn-danger" onClick={() => { store.resetDemo(); toast('Wallet reset to sample records'); }}>
          <RotateCcw aria-hidden /> Reset wallet to sample records
        </button>
      </section>

      <p className="muted" style={{ textAlign: 'center', fontSize: '0.8rem' }}>EcoCypher Companion v1.0 · Evidence, not advertising.</p>
    </>
  );
}
