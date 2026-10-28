import { useState } from 'react';
import { repo } from '../lib/data';
import { useQuery } from '../lib/query';
import { useSession } from '../lib/session';

export function Onboarding() {
  const { user, reload } = useSession();
  const invites = useQuery(`me/invites/${user?.id}`, () => repo.myInvites());
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [cin, setCin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr(null);
    try { await fn(); await reload(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="auth">
      <div className="auth-card wide">
        <img src="/logo.svg" alt="" width={56} height={56} />
        <h1>Set up your workspace</h1>
        <p className="muted">Signed in as {user?.email}.</p>
        {invites.data && invites.data.length > 0 && (
          <section className="stack">
            <h2 className="h2">You’ve been invited</h2>
            {invites.data.map((i) => (
              <div key={i.id} className="list-row">
                <span><b>{i.company_name}</b><small className="muted"> as {i.role}</small></span>
                <button className="btn btn-primary" disabled={busy} onClick={() => void run(() => repo.acceptInvite(i.id))}>Join</button>
              </div>
            ))}
            <div className="divider">or</div>
          </section>
        )}
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void run(() => repo.createCompany({ name: name.trim(), industry: industry.trim(), cin: cin.trim() || undefined })); }}>
          <h2 className="h2">Create your company</h2>
          <label className="field">Company name<input className="input" value={name} onChange={(e) => setName(e.target.value)} required /></label>
          <label className="field">Industry<input className="input" value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. Textiles, IT services, Cement" /></label>
          <label className="field">CIN (optional)<input className="input" value={cin} onChange={(e) => setCin(e.target.value)} /></label>
          {err && <div className="note fail">{err}</div>}
          <button className="btn btn-primary btn-block" type="submit" disabled={busy || !name.trim()}>Create workspace</button>
          <p className="muted small">You become the admin and can invite your ESG team from Settings.</p>
        </form>
        <button className="link-btn" onClick={() => void repo.signOut().then(reload)}>Sign out</button>
      </div>
    </div>
  );
}
