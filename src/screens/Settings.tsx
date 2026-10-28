import { Download, Laptop, LogOut, Moon, RotateCcw, Sun, Trash2, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ErrorNote, PageHeader, toast } from '../components/ui';
import { repo } from '../lib/data';
import { resetDemo } from '../lib/data/local';
import { DEFAULT_FACTORS, FACTOR_SOURCES, currentFy, prevFy } from '../lib/emissions';
import { refresh } from '../lib/hooks';
import { getImpactApi, setImpactApi } from '../lib/mrv';
import { invalidate, useQuery } from '../lib/query';
import { useCompany, useSession } from '../lib/session';
import { useTheme, type ThemePref } from '../lib/theme';
import type { Role } from '../lib/types';

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: InstallEvent | null = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as InstallEvent; });

export function Settings() {
  const m = useCompany();
  const { user, can, memberships, setActive, reload } = useSession();
  const admin = can('admin');
  return (
    <>
      <PageHeader title="Settings" />
      <CompanyCard key={m.company_id} admin={admin} />
      <TeamCard admin={admin} />
      <section className="card stack">
        <div className="section-title"><h2>Your account</h2></div>
        <p className="small"><b>{user?.name}</b> · {user?.email} · <span className="chip neutral">{m.role}</span></p>
        {memberships.length > 1 && (
          <label className="field">Company
            <select className="select" value={m.company_id} onChange={(e) => { setActive(e.target.value); invalidate(''); }}>
              {memberships.map((x) => <option key={x.company_id} value={x.company_id}>{x.company.name}</option>)}
            </select>
          </label>
        )}
        {repo.mode === 'supabase' && <button className="btn btn-ghost" onClick={async () => { await repo.signOut(); invalidate(''); await reload(); }}><LogOut aria-hidden /> Sign out</button>}
      </section>
      <AppCard />
      <IntegrationsCard />
      {repo.mode === 'demo' && (
        <section className="card stack">
          <div className="section-title"><h2>Demo workspace</h2></div>
          <p className="muted small">You are using a sample company stored only in this browser. Deploy with Supabase settings to use it with your team (see the README).</p>
          <button className="btn btn-danger" onClick={() => { resetDemo(); location.reload(); }}><RotateCcw aria-hidden /> Reset demo data</button>
        </section>
      )}
    </>
  );
}

function CompanyCard({ admin }: { admin: boolean }) {
  const m = useCompany();
  const { reload } = useSession();
  const c = m.company;
  const fy = currentFy();
  const fys = [prevFy(prevFy(fy)), prevFy(fy), fy];
  const [f, setF] = useState({ name: c.name, industry: c.industry, cin: c.cin ?? '', grid_ef: String(c.grid_ef), diesel_ef: String(c.diesel_ef), lpg_ef: String(c.lpg_ef), turnover: Object.fromEntries(fys.map((y) => [y, String(c.turnover_cr?.[y] ?? '')])) as Record<string, string> });
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const turnover_cr = { ...c.turnover_cr };
      for (const [y, v] of Object.entries(f.turnover)) { if (v.trim()) turnover_cr[y] = Number(v); else delete turnover_cr[y]; }
      await repo.updateCompany(c.id, { name: f.name.trim(), industry: f.industry.trim(), cin: f.cin.trim() || undefined, grid_ef: Number(f.grid_ef) || DEFAULT_FACTORS.grid_ef, diesel_ef: Number(f.diesel_ef) || DEFAULT_FACTORS.diesel_ef, lpg_ef: Number(f.lpg_ef) || DEFAULT_FACTORS.lpg_ef, turnover_cr });
      await repo.log({ company_id: c.id, action: 'updated company settings', entity: 'company' });
      await reload();
      invalidate(c.id);
      toast('Company settings saved');
    } catch (err) { toast((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <form className="card stack" onSubmit={(e) => void save(e)}>
      <div className="section-title"><h2>Company</h2>{!admin && <span className="muted small">Admins can edit</span>}</div>
      <fieldset disabled={!admin} className="form-grid">
        <label className="field wide">Name<input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></label>
        <label className="field">Industry<input className="input" value={f.industry} onChange={(e) => setF({ ...f, industry: e.target.value })} /></label>
        <label className="field">CIN<input className="input" value={f.cin} onChange={(e) => setF({ ...f, cin: e.target.value })} /></label>
        {fys.map((y) => (
          <label key={y} className="field">Turnover FY {y} (₹ crore)<input className="input" inputMode="decimal" value={f.turnover[y]} onChange={(e) => setF({ ...f, turnover: { ...f.turnover, [y]: e.target.value } })} /></label>
        ))}
        <label className="field">Grid factor (kg CO₂e/kWh)<input className="input" inputMode="decimal" value={f.grid_ef} onChange={(e) => setF({ ...f, grid_ef: e.target.value })} /><span className="hint">{FACTOR_SOURCES.grid_ef}</span></label>
        <label className="field">Diesel (kg CO₂e/L)<input className="input" inputMode="decimal" value={f.diesel_ef} onChange={(e) => setF({ ...f, diesel_ef: e.target.value })} /><span className="hint">{FACTOR_SOURCES.diesel_ef}</span></label>
        <label className="field">LPG (kg CO₂e/kg)<input className="input" inputMode="decimal" value={f.lpg_ef} onChange={(e) => setF({ ...f, lpg_ef: e.target.value })} /><span className="hint">{FACTOR_SOURCES.lpg_ef}</span></label>
      </fieldset>
      {admin && <button className="btn btn-primary" type="submit" disabled={busy}>Save company settings</button>}
    </form>
  );
}

function TeamCard({ admin }: { admin: boolean }) {
  const m = useCompany();
  const { user } = useSession();
  const members = useQuery(`${m.company_id}/members`, () => repo.members(m.company_id));
  const invites = useQuery(admin ? `${m.company_id}/members-invites` : null, () => repo.invites(m.company_id));
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('manager');
  const act = async (fn: () => Promise<void>, msg: string) => {
    try { await fn(); refresh(m.company_id, 'members'); toast(msg); } catch (e) { toast((e as Error).message); }
  };
  return (
    <section className="card stack">
      <div className="section-title"><h2>Team</h2><span className="muted small">{members.data?.length ?? 0} members</span></div>
      <ErrorNote error={members.error} />
      <ul className="people">
        {members.data?.map((p) => (
          <li key={p.user_id}>
            <span className="avatar" aria-hidden>{p.name.slice(0, 1).toUpperCase()}</span>
            <span className="who"><b>{p.name}{p.user_id === user?.id ? ' (you)' : ''}</b><small>{p.email}</small></span>
            {admin && p.user_id !== user?.id ? (
              <span className="row" style={{ gap: 6 }}>
                <select className="select sm" value={p.role} aria-label={`Role for ${p.name}`} onChange={(e) => void act(() => repo.setRole(m.company_id, p.user_id, e.target.value as Role), 'Role updated')}>
                  <option value="admin">Admin</option><option value="manager">Manager</option><option value="viewer">Viewer</option>
                </select>
                <button className="icon-btn sm" aria-label={`Remove ${p.name}`} onClick={() => void act(() => repo.removeMember(m.company_id, p.user_id), 'Member removed')}><Trash2 aria-hidden /></button>
              </span>
            ) : <span className="chip neutral">{p.role}</span>}
          </li>
        ))}
      </ul>
      {admin && (
        <>
          {invites.data && invites.data.length > 0 && (
            <ul className="people">
              {invites.data.map((i) => (
                <li key={i.id}>
                  <span className="avatar pending" aria-hidden>@</span>
                  <span className="who"><b>{i.email}</b><small>Invited as {i.role}</small></span>
                  <button className="link-btn" onClick={() => void act(() => repo.revokeInvite(i.id), 'Invite cancelled')}>Cancel</button>
                </li>
              ))}
            </ul>
          )}
          <form className="invite-row" onSubmit={(e) => { e.preventDefault(); if (email.includes('@')) void act(() => repo.invite(m.company_id, email.trim(), role), `Invite saved. ${repo.mode === 'supabase' ? 'They join when they sign in with that email.' : ''}`).then(() => setEmail('')); }}>
            <label className="sr-only" htmlFor="invite-email">Email</label>
            <input id="invite-email" className="input" type="email" placeholder="colleague@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <select className="select" value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Role"><option value="manager">Manager</option><option value="viewer">Viewer</option><option value="admin">Admin</option></select>
            <button className="btn btn-primary" type="submit" disabled={!email.includes('@')}><UserPlus aria-hidden /> Invite</button>
          </form>
          <p className="muted small">Managers can add evidence, data and claims and approve claims. Viewers can read everything. Admins also manage the company and team.</p>
        </>
      )}
    </section>
  );
}

function AppCard() {
  const [pref, setPref] = useTheme();
  const [canInstall, setCanInstall] = useState(!!deferred);
  const standalone = window.matchMedia('(display-mode: standalone)').matches;
  useEffect(() => {
    const on = () => setCanInstall(true);
    window.addEventListener('beforeinstallprompt', on);
    return () => window.removeEventListener('beforeinstallprompt', on);
  }, []);
  const themes: [ThemePref, string, typeof Sun][] = [['system', 'System', Laptop], ['light', 'Light', Sun], ['dark', 'Dark', Moon]];
  return (
    <section className="card stack">
      <div className="section-title"><h2>App</h2></div>
      <div className="segmented" role="group" aria-label="Theme">
        {themes.map(([t, label, Icon]) => <button key={t} aria-pressed={pref === t} onClick={() => setPref(t)}><Icon size={16} aria-hidden /> {label}</button>)}
      </div>
      {standalone ? <p className="muted small">Installed on this device.</p> : canInstall ? (
        <button className="btn btn-ghost" onClick={async () => { if (!deferred) return; await deferred.prompt(); await deferred.userChoice; deferred = null; setCanInstall(false); }}><Download aria-hidden /> Install EcoCypher</button>
      ) : <p className="muted small">Install it like an app: on iPhone/iPad tap Share → Add to Home Screen; on Android, Windows or Mac use “Install app” in the browser menu.</p>}
    </section>
  );
}

function IntegrationsCard() {
  const [url, setUrl] = useState(getImpactApi());
  return (
    <form className="card stack" onSubmit={(e) => { e.preventDefault(); setImpactApi(url); toast(url ? 'Impact API saved' : 'Impact API removed'); }}>
      <div className="section-title"><h2>EcoCypher impact platform</h2></div>
      <p className="muted small">To import live MRV records by QR code, enter your impact API address (https). Without it, sample records are available.</p>
      <label className="field" htmlFor="impact-api">Impact API address<input id="impact-api" className="input" inputMode="url" placeholder="https://impact-api.example.com" value={url} onChange={(e) => setUrl(e.target.value)} /></label>
      <button className="btn btn-ghost" type="submit">Save</button>
    </form>
  );
}
