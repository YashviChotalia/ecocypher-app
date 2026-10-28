const inNum = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

export const fmtNum = (n?: number) => (n == null || Number.isNaN(n) ? '—' : inNum.format(n));
export const fmtINR = (n?: number) => (n == null || Number.isNaN(n) ? '—' : inr.format(n));
export const fmtTonnes = (kg?: number) =>
  kg == null ? '—' : kg >= 1000 ? `${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(kg / 1000)} t` : `${inNum.format(kg)} kg`;
export const fmtDate = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
export const fmtDateTime = (iso?: string) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

/** Short Indian-style money for tight spaces: ₹1.59 L, ₹2.4 Cr. */
export const fmtINRCompact = (n?: number) => {
  if (n == null || Number.isNaN(n)) return '—';
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2).replace(/\.?0+$/, '')} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2).replace(/\.?0+$/, '')} L`;
  return inr.format(n);
};
