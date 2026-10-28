import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { repo, type Membership, type User } from './data';
import type { Role } from './types';

interface SessionState {
  ready: boolean;
  user: User | null;
  memberships: Membership[];
  active: Membership | null;
  setActive: (companyId: string) => void;
  reload: () => Promise<void>;
  can: (action: 'write' | 'admin') => boolean;
}

const Ctx = createContext<SessionState | null>(null);
const ACTIVE_KEY = 'ecocypher-active-company';

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [activeId, setActiveId] = useState<string | null>(() => {
    try { return localStorage.getItem(ACTIVE_KEY); } catch { return null; }
  });

  const reload = useCallback(async () => {
    try {
      const u = await repo.currentUser();
      setUser(u);
      setMemberships(u ? await repo.memberships() : []);
    } catch {
      setUser(null);
      setMemberships([]);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void reload();
    return repo.onAuthChange(() => void reload());
  }, [reload]);

  const active = memberships.find((m) => m.company_id === activeId) ?? memberships[0] ?? null;
  const value = useMemo<SessionState>(() => ({
    ready, user, memberships, active,
    setActive: (id) => { setActiveId(id); try { localStorage.setItem(ACTIVE_KEY, id); } catch { /* ignore */ } },
    reload,
    can: (action) => {
      const r: Role | undefined = active?.role;
      return action === 'admin' ? r === 'admin' : r === 'admin' || r === 'manager';
    },
  }), [ready, user, memberships, active, reload]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside provider');
  return v;
}

/** The active company; screens below the workspace gate can rely on it. */
export function useCompany() {
  const { active } = useSession();
  if (!active) throw new Error('No active company');
  return active;
}
