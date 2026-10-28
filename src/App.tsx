import { FileSearch, Home as HomeIcon, ScanLine, Settings as SettingsIcon, Wallet as WalletIcon } from 'lucide-react';
import { useEffect } from 'react';
import { ToastHost } from './components/ui';
import { href, useRoute, type Route } from './lib/router';
import { useStore } from './lib/store';
import { Check } from './screens/Check';
import { Home } from './screens/Home';
import { Scan } from './screens/Scan';
import { Settings } from './screens/Settings';
import { Verify } from './screens/Verify';
import { Wallet } from './screens/Wallet';

const NAV: { route: Route; label: string; Icon: typeof HomeIcon }[] = [
  { route: { name: 'home' }, label: 'Home', Icon: HomeIcon },
  { route: { name: 'scan' }, label: 'Scan', Icon: ScanLine },
  { route: { name: 'check' }, label: 'Check', Icon: FileSearch },
  { route: { name: 'wallet' }, label: 'Wallet', Icon: WalletIcon },
];

const TITLES: Record<Route['name'], string> = {
  home: 'EcoCypher', scan: 'Scan · EcoCypher', check: 'Claim check · EcoCypher',
  wallet: 'Wallet · EcoCypher', settings: 'Settings · EcoCypher', verify: 'Verification · EcoCypher',
};

function useTheme() {
  const pref = useStore((s) => s.settings.theme);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = pref === 'dark' || (pref === 'system' && mq.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
      const meta = document.createElement('meta');
      meta.name = 'theme-color';
      meta.content = dark ? '#0F1A15' : '#FAF6EA';
      document.head.appendChild(meta);
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [pref]);
}

export function App() {
  const route = useRoute();
  useTheme();
  useEffect(() => { document.title = TITLES[route.name]; }, [route.name]);

  const active = (r: Route) =>
    r.name === route.name || (r.name === 'scan' && route.name === 'verify') ? 'page' : undefined;

  let screen;
  switch (route.name) {
    case 'scan': screen = <Scan />; break;
    case 'check': screen = <Check evidenceId={route.evidenceId} />; break;
    case 'wallet': screen = <Wallet />; break;
    case 'settings': screen = <Settings />; break;
    case 'verify': screen = <Verify key={route.id} id={route.id} />; break;
    default: screen = <Home />;
  }

  const brand = (
    <a className="brand" href={href({ name: 'home' })} aria-label="EcoCypher home">
      <img src="/logo.svg" alt="" width={34} height={34} />
      <span><b>EcoCypher</b><small>Evidence companion</small></span>
    </a>
  );

  return (
    <div className="app">
      <aside className="sidebar" aria-label="Main">
        {brand}
        {NAV.map(({ route: r, label, Icon }) => (
          <a key={r.name} className="side-link" href={href(r)} aria-current={active(r)}><Icon aria-hidden /> {label}</a>
        ))}
        <div className="spacer" />
        <a className="side-link" href={href({ name: 'settings' })} aria-current={active({ name: 'settings' })}><SettingsIcon aria-hidden /> Settings</a>
      </aside>

      <header className="topbar">
        {brand}
        <span />
        <a className="icon-btn settings-mobile" href={href({ name: 'settings' })} aria-label="Settings" aria-current={active({ name: 'settings' })}>
          <SettingsIcon aria-hidden />
        </a>
      </header>

      <main className="content" id="main" key={route.name === 'verify' ? `v-${route.id}` : route.name}>
        {screen}
      </main>

      <nav className="tabbar" aria-label="Main">
        {NAV.map(({ route: r, label, Icon }) => (
          <a key={r.name} className="tab" href={href(r)} aria-current={active(r)}>
            <span className="tab-ico"><Icon aria-hidden /></span>
            {label}
          </a>
        ))}
      </nav>
      <ToastHost />
    </div>
  );
}
