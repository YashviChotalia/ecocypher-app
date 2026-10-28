import { AlertTriangle, CheckCircle2, ShieldAlert, ShieldCheck, ShieldQuestion, XCircle } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { href } from '../lib/router';
import { parseEvidence } from '../lib/hash';
import { fmtNum } from '../lib/format';
import type { AnchorStatus, EvidenceRecord, IntegrityState } from '../lib/types';

export function AnchorChip({ status }: { status: AnchorStatus }) {
  const map: Record<AnchorStatus, [string, string]> = {
    ANCHORED: ['pass', 'Anchored'],
    SIMULATED: ['warn', 'Not anchored'],
    PENDING: ['neutral', 'Pending'],
    FAILED: ['fail', 'Anchor failed'],
  };
  const [cls, label] = map[status] ?? ['neutral', status];
  return <span className={`chip ${cls}`}>{label}</span>;
}

export function IntegrityIcon({ state, size = 20 }: { state: IntegrityState | 'UNKNOWN'; size?: number }) {
  if (state === 'INTACT') return <ShieldCheck size={size} aria-label="Intact" />;
  if (state === 'TAMPERED') return <ShieldAlert size={size} aria-label="Altered" />;
  return <ShieldQuestion size={size} aria-label="Unknown" />;
}

export function LevelIcon({ level }: { level: 'pass' | 'warn' | 'fail' }) {
  if (level === 'pass') return <CheckCircle2 aria-hidden />;
  if (level === 'warn') return <AlertTriangle aria-hidden />;
  return <XCircle aria-hidden />;
}

export function RecordRow({ record, integrity }: { record: EvidenceRecord; integrity?: IntegrityState }) {
  const ev = parseEvidence(record);
  const tone = integrity === 'TAMPERED' ? 'fail' : record.anchor_status === 'ANCHORED' ? 'pass' : 'warn';
  const bg = { pass: 'var(--pass-bg)', warn: 'var(--warn-bg)', fail: 'var(--fail-bg)' }[tone];
  const fg = { pass: 'var(--pass)', warn: 'var(--warn)', fail: 'var(--fail)' }[tone];
  return (
    <a className="record" href={href({ name: 'verify', id: record.evidence_id })}>
      <span className="dot" style={{ background: bg, color: fg }}>
        <IntegrityIcon state={integrity ?? 'UNKNOWN'} />
      </span>
      <span className="meta">
        <b>{record.title}</b>
        <small>{record.evidence_id}</small>
      </span>
      <span className="num">
        {fmtNum(ev?.savings_kwh)} kWh
        <small>{integrity === 'TAMPERED' ? 'Altered' : record.anchor_status === 'ANCHORED' ? 'Anchored' : 'Not anchored'}</small>
      </span>
    </a>
  );
}

let toastSetter: ((m: string | null) => void) | null = null;
export const toast = (message: string) => toastSetter?.(message);

export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    toastSetter = setMsg;
    return () => { toastSetter = null; };
  }, []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2600);
    return () => clearTimeout(t);
  }, [msg]);
  return msg ? <div className="toast fade-in" role="status" aria-live="polite">{msg}</div> : null;
}

export function PageHeader({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return (
    <header className="stack" style={{ gap: 6 }}>
      {eyebrow && <span className="eyebrow">{eyebrow}</span>}
      <h1 className="page-title">{title}</h1>
      {children && <p className="lede">{children}</p>}
    </header>
  );
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
