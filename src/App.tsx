import { BarChart3, Database, Zap, FileCheck2, FileText, FolderLock, Settings as SettingsIcon } from 'lucide-react';
import { useEffect } from 'react';
import { ToastHost } from './components/ui';
import { repo } from './lib/data';
import { href, useRoute, type Route } from './lib/router';
import { SessionProvider, useSession } from './lib/session';
import { useTheme } from './lib/theme';
import { Auth } from './screens/Auth';
import { ClaimDetail } from './screens/ClaimDetail';
import { Claims } from './screens/Claims';
import { Dashboard } from './screens/Dashboard';
import { Data } from './screens/Data';
import { EvidenceList } from './screens/Evidence';
import { EvidenceItem } from './screens/EvidenceItem';
import { EvidenceNew } from './screens/EvidenceNew';
import { Microgrid } from './screens/Microgrid';
import { Onboarding } from './screens/Onboarding';
import { Reports } from './screens/Reports';
import { Settings } from './screens/Settings';

const NAV: { route: Route; label: string; Icon: typeof BarChart3; match: Route['name'][] }[] = [
  { route: { name: 'dashboard' }, label: 'Overview', Icon: BarChart3, match: ['dashboard'] },
  { route: { name: 'claims' }, label: 'Claims', Icon: FileCheck2, match: ['claims', 'claim'] },
  { route: { name: 'evidence' }, label: 'Evidence', Icon: FolderLock, match: ['evidence', 'evidence-new', 'evidence-item'] },
  { route: { name: 'data' }, label: 'Energy', Icon: Database, match: ['data'] },
  { route: { name: 'grid' }, label: 'Grid', Icon: Zap, match: ['grid'] },
  { route: { name: 'reports' }, label: 'Reports', Icon: FileText, match: ['reports'] },
];

const TITLE: Record<Route['name'], string> = {
  dashboard: 'Overview', claims: 'Claims', claim: 'Claim', evidence: 'Evidence', 'evidence-new': 'Add evidence',
  'evidence-item': 'Evidence', data: 'Data', grid: 'Microgrid', reports: 'Reports', settings: 'Settings',
};

function Shell() {
  const route = useRoute();
  const { active } = useSession();
  useEffect(() => { document.title = `${TITLE[route.name]} · EcoCypher ESG`; }, [route.name]);
  const current = (r: { match: Route['name'][] }) => (r.match.includes(route.name) ? 'page' : undefined);

  let screen;
  switch (route.name) {
    case 'claims': screen = <Claims />; break;
    case 'claim': screen = <ClaimDetail key={route.id} id={route.id} />; break;
    case 'evidence': screen = <EvidenceList />; break;
    case 'evidence-new': screen = <EvidenceNew key={route.tab ?? ''} tab={route.tab} />; break;
    case 'evidence-item': screen = <EvidenceItem key={route.id} id={route.id} />; break;
    case 'data': screen = <Data />; break;
    case 'grid': screen = <Microgrid />; break;
    case 'reports': screen = <Reports />; break;
    case 'settings': screen = <Settings />; break;
    default: screen = <Dashboard />;
  }

  return (
    <div className="app">
      <aside className="sidebar" aria-label="Main">
        <a className="brand" href={href({ name: 'dashboard' })}>
          <img src="/logo.svg" alt="" width={36} height={36} />
          <span><b>EcoCypher</b><small>{active?.company.name}</small></span>
        </a>
        {NAV.map((n) => <a key={n.label} className="side-link" href={href(n.route)} aria-current={current(n)}><n.Icon aria-hidden /> {n.label}</a>)}
        <div className="spacer" />
        {repo.mode === 'demo' && <p className="demo-note">Demo workspace</p>}
        <a className="side-link" href={href({ name: 'settings' })} aria-current={route.name === 'settings' ? 'page' : undefined}><SettingsIcon aria-hidden /> Settings</a>
      </aside>

      <header className="topbar">
        <a className="brand" href={href({ name: 'dashboard' })}>
          <img src="/logo.svg" alt="" width={32} height={32} />
          <span><b>EcoCypher</b><small>{active?.company.name}</small></span>
        </a>
        <a className="icon-btn" href={href({ name: 'settings' })} aria-label="Settings" aria-current={route.name === 'settings' ? 'page' : undefined}><SettingsIcon aria-hidden /></a>
      </header>

      <main className="content" id="main">{screen}</main>

      <nav className="tabbar" aria-label="Main">
        {NAV.map((n) => (
          <a key={n.label} className="tab" href={href(n.route)} aria-current={current(n)}>
            <span className="tab-ico"><n.Icon aria-hidden /></span>{n.label}
          </a>
        ))}
      </nav>
    </div>
  );
}

declare global { interface Window { __hideSplash?: () => void } }

function Gate() {
  const { ready, user, memberships } = useSession();
  useTheme();
  useEffect(() => { if (ready) window.__hideSplash?.(); }, [ready]);
  if (!ready) return null;
  if (!user) return <Auth />;
  if (!memberships.length) return <Onboarding />;
  return <Shell />;
}

export function App() {
  return (
    <SessionProvider>
      <Gate />
      <ToastHost />
    </SessionProvider>
  );
}
