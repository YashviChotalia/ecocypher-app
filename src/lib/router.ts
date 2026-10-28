import { useEffect, useState } from 'react';

export type Route =
  | { name: 'dashboard' }
  | { name: 'claims' }
  | { name: 'claim'; id: string } // id may be 'new'
  | { name: 'evidence' }
  | { name: 'evidence-new'; tab?: string }
  | { name: 'evidence-item'; id: string }
  | { name: 'data' }
  | { name: 'reports' }
  | { name: 'settings' };

export function parseHash(hash: string): Route {
  const p = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  switch (p[0]) {
    case 'claims': return p[1] ? { name: 'claim', id: p[1] } : { name: 'claims' };
    case 'evidence':
      if (p[1] === 'new') return { name: 'evidence-new', tab: p[2] };
      return p[1] ? { name: 'evidence-item', id: p[1] } : { name: 'evidence' };
    case 'verify': return p[1] ? { name: 'evidence-new', tab: `id:${p[1]}` } : { name: 'evidence-new', tab: 'scan' };
    case 'data': return { name: 'data' };
    case 'reports': return { name: 'reports' };
    case 'settings': return { name: 'settings' };
    default: return { name: 'dashboard' };
  }
}

export function href(r: Route): string {
  switch (r.name) {
    case 'dashboard': return '#/';
    case 'claim': return `#/claims/${encodeURIComponent(r.id)}`;
    case 'evidence-new': return r.tab ? `#/evidence/new/${encodeURIComponent(r.tab)}` : '#/evidence/new';
    case 'evidence-item': return `#/evidence/${encodeURIComponent(r.id)}`;
    default: return `#/${r.name}`;
  }
}

export const navigate = (r: Route) => { location.hash = href(r); };

/** Deep links like /verify/EVD-123 or ?verify=EVD-123 (from EcoCypher QR receipts). */
function initialHash(): string {
  const path = location.pathname.match(/\/verify\/([^/]+)/);
  const q = new URLSearchParams(location.search).get('verify');
  const id = path?.[1] || q;
  if (id) history.replaceState(null, '', `/#/verify/${encodeURIComponent(decodeURIComponent(id))}`);
  return location.hash;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(initialHash()));
  useEffect(() => {
    const on = () => { setRoute(parseHash(location.hash)); window.scrollTo({ top: 0 }); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
