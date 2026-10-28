import { useSyncExternalStore } from 'react';
import { SEED_RECORDS } from './seed';
import type { EvidenceRecord } from './types';

export type ThemePref = 'system' | 'light' | 'dark';
export interface Settings {
  apiUrl: string;
  theme: ThemePref;
  onboarded: boolean;
}

interface State {
  wallet: EvidenceRecord[];
  settings: Settings;
}

const KEY = 'ecocypher-companion-v1';
const DEFAULT_SETTINGS: Settings = {
  apiUrl: (import.meta.env.VITE_DEFAULT_API_URL as string | undefined) ?? '',
  theme: 'system',
  onboarded: false,
};

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<State>;
      return {
        wallet: Array.isArray(parsed.wallet) ? parsed.wallet : SEED_RECORDS,
        settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
      };
    }
  } catch {
    /* storage blocked or corrupt: start fresh */
  }
  return { wallet: SEED_RECORDS.map((r) => ({ ...r, saved_at: r.created_at })), settings: DEFAULT_SETTINGS };
}

let state: State = load();
const listeners = new Set<() => void>();

function commit(next: State) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* private mode: keep in memory */
  }
  listeners.forEach((l) => l());
}

export const store = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  saveRecord(record: EvidenceRecord) {
    const rest = state.wallet.filter((r) => r.evidence_id !== record.evidence_id);
    commit({ ...state, wallet: [{ ...record, saved_at: new Date().toISOString() }, ...rest] });
  },
  removeRecord(id: string) {
    commit({ ...state, wallet: state.wallet.filter((r) => r.evidence_id !== id) });
  },
  updateSettings(patch: Partial<Settings>) {
    commit({ ...state, settings: { ...state.settings, ...patch } });
  },
  resetDemo() {
    commit({ wallet: SEED_RECORDS.map((r) => ({ ...r, saved_at: r.created_at })), settings: { ...state.settings } });
  },
  findLocal(id: string) {
    const norm = id.trim().toUpperCase();
    return state.wallet.find((r) => r.evidence_id.toUpperCase() === norm) ?? SEED_RECORDS.find((r) => r.evidence_id === norm);
  },
};

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(state), () => select(state));
}
