import { AlertTriangle, CheckCircle2, X, XCircle } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CheckLevel } from '../lib/claims';
import type { AnchorStatus, ClaimChannel, ClaimStatus, EvidenceKind, Verdict } from '../lib/types';

export function PageHeader({ eyebrow, title, children, actions }: { eyebrow?: string; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="stack" style={{ gap: 6, minWidth: 0 }}>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1 className="page-title">{title}</h1>
        {children && <p className="lede">{children}</p>}
      </div>
      {actions && <div className="row header-actions">{actions}</div>}
    </header>
  );
}

export const STATUS_LABEL: Record<ClaimStatus, string> = {
  draft: 'Draft', in_review: 'In review', approved: 'Approved', rejected: 'Rejected', published: 'Published',
};
const STATUS_TONE: Record<ClaimStatus, string> = { draft: 'neutral', in_review: 'info', approved: 'pass', rejected: 'fail', published: 'pass' };
export function StatusChip({ status }: { status: ClaimStatus }) {
  return <span className={`tag ${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span>;
}

export const VERDICT_LABEL: Record<Verdict, string> = { SUPPORTED: 'Supported', QUESTIONABLE: 'Questionable', UNSUPPORTED: 'Not supported' };
export const VERDICT_TONE: Record<Verdict, 'pass' | 'warn' | 'fail'> = { SUPPORTED: 'pass', QUESTIONABLE: 'warn', UNSUPPORTED: 'fail' };
export function VerdictChip({ verdict }: { verdict?: Verdict | null }) {
  if (!verdict) return <span className="tag neutral">Not checked</span>;
  return <span className={`tag ${VERDICT_TONE[verdict]}`}>{VERDICT_LABEL[verdict]}</span>;
}

export const CHANNEL_LABEL: Record<ClaimChannel, string> = {
  annual_report: 'Annual report', brsr: 'BRSR disclosure', website: 'Website', advertising: 'Advertising',
  social: 'Social media', press: 'Press release', product: 'Product label', other: 'Other',
};
export const KIND_LABEL: Record<EvidenceKind, string> = {
  mrv: 'MRV record', meter: 'Meter data', invoice: 'Bills & invoices', audit: 'Audit report', certificate: 'Certificate', other: 'Other document',
};
export function AnchorChip({ status }: { status: AnchorStatus }) {
  const map: Record<AnchorStatus, [string, string]> = {
    ANCHORED: ['pass', 'Anchored on-chain'], SIMULATED: ['warn', 'Not anchored'], PENDING: ['neutral', 'Anchor pending'], NONE: ['neutral', 'Fingerprinted'],
  };
  const [tone, label] = map[status] ?? ['neutral', status];
  return <span className={`tag ${tone}`}>{label}</span>;
}

export function LevelIcon({ level }: { level: CheckLevel }) {
  if (level === 'pass') return <CheckCircle2 aria-hidden />;
  if (level === 'warn') return <AlertTriangle aria-hidden />;
  return <XCircle aria-hidden />;
}

/* Toasts */
let toastSetter: ((m: string | null) => void) | null = null;
export const toast = (message: string) => toastSetter?.(message);
export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { toastSetter = setMsg; return () => { toastSetter = null; }; }, []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2800);
    return () => clearTimeout(t);
  }, [msg]);
  return msg ? <div className="toast fade-in" role="status" aria-live="polite">{msg}</div> : null;
}

/** Bottom sheet on phones, centred dialog on larger screens. */
export function Sheet({ title, open, onClose, children, footer }: { title: string; open: boolean; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="sheet" onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }} aria-label={title}>
      <div className="sheet-inner">
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X aria-hidden /></button>
        </div>
        <div className="sheet-body">{open && children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </dialog>
  );
}

export function Empty({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <b>{title}</b>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" style={{ height: i === 0 ? 96 : 64 }} />)}
    </div>
  );
}

export function ErrorNote({ error }: { error?: Error }) {
  if (!error) return null;
  return <div className="note fail" role="alert">{error.message}</div>;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function download(name: string, content: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const toCsv = (rows: (string | number | null | undefined)[][]) =>
  rows.map((r) => r.map((v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
