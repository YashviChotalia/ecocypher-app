const inNum = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });
const inNum0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

export const fmtNum = (n?: number | null, digits = 1) =>
  n == null || Number.isNaN(n) ? '—' : digits === 0 ? inNum0.format(n) : digits === 1 ? inNum.format(n) : new Intl.NumberFormat('en-IN', { maximumFractionDigits: digits }).format(n);
export const fmtINR = (n?: number | null) => (n == null || Number.isNaN(n) ? '—' : inr.format(n));
export const fmtINRCompact = (n?: number | null) => {
  if (n == null || Number.isNaN(n)) return '—';
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2).replace(/\.?0+$/, '')} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2).replace(/\.?0+$/, '')} L`;
  return inr.format(n);
};
export const fmtCompact = (n: number) =>
  Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : Math.abs(n) >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K` : String(Math.round(n));
export const fmtTonnes = (t?: number | null) => (t == null ? '—' : `${fmtNum(t, t < 10 ? 2 : 1)} tCO₂e`);
export const fmtPct = (p?: number | null, signed = false) =>
  p == null || Number.isNaN(p) ? '—' : `${signed && p > 0 ? '+' : ''}${p.toFixed(1)}%`;
export const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
export const fmtDateTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
export const fmtMonth = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
};
export const fmtBytes = (b?: number | null) => (b == null ? '—' : b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`);
export const relTime = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return fmtDate(iso);
};
