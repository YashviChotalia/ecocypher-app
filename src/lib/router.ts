import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'scan' }
  | { name: 'check'; evidenceId?: string }
  | { name: 'wallet' }
  | { name: 'settings' }
  | { name: 'verify'; id: string };

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  switch (parts[0]) {
    case 'scan': return { name: 'scan' };
    case 'check': return { name: 'check', evidenceId: parts[1] };
    case 'wallet': return { name: 'wallet' };
    case 'settings': return { name: 'settings' };
    case 'verify': return parts[1] ? { name: 'verify', id: parts[1] } : { name: 'scan' };
    default: return { name: 'home' };
  }
}

export function href(route: Route): string {
  switch (route.name) {
    case 'home': return '#/';
    case 'verify': return `#/verify/${encodeURIComponent(route.id)}`;
    case 'check': return route.evidenceId ? `#/check/${encodeURIComponent(route.evidenceId)}` : '#/check';
    default: return `#/${route.name}`;
  }
}

export const navigate = (route: Route) => {
  location.hash = href(route);
};

/** Deep links like /verify/EVD-123 or ?verify=EVD-123 (from platform QR codes) become hash routes. */
function initialHash(): string {
  const path = location.pathname.match(/\/verify\/([^/]+)/);
  const q = new URLSearchParams(location.search).get('verify');
  const id = path?.[1] || q;
  if (id) {
    history.replaceState(null, '', `/${href({ name: 'verify', id: decodeURIComponent(id) })}`);
  }
  return location.hash;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(initialHash()));
  useEffect(() => {
    const on = () => {
      setRoute(parseHash(location.hash));
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
