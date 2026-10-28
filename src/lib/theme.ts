import { useEffect, useState } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'ecocypher-theme';
const listeners = new Set<(p: ThemePref) => void>();
let pref: ThemePref = (() => { try { return (localStorage.getItem(KEY) as ThemePref) || 'system'; } catch { return 'system'; } })();

function apply() {
  const dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = dark ? '#0F1A15' : '#FAF6EA';
  document.head.appendChild(meta);
}
apply();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', apply);

export function useTheme(): [ThemePref, (p: ThemePref) => void] {
  const [p, setP] = useState(pref);
  useEffect(() => { listeners.add(setP); return () => { listeners.delete(setP); }; }, []);
  return [p, (next) => {
    pref = next;
    try { localStorage.setItem(KEY, next); } catch { /* ignore */ }
    apply();
    listeners.forEach((l) => l(next));
  }];
}
