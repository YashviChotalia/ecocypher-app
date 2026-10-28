import { useCallback, useEffect, useRef, useState } from 'react';

type Entry = { data?: unknown; error?: Error; promise?: Promise<unknown>; at: number };
const cache = new Map<string, Entry>();
const subs = new Map<string, Set<() => void>>();

function notify(key: string) { subs.get(key)?.forEach((f) => f()); }

/** Mark every cached query whose key starts with `prefix` as stale and refetch it. */
export function invalidate(prefix: string) {
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
      notify(key);
    }
  }
}

/** Minimal stale-while-revalidate data hook shared across components. */
export function useQuery<T>(key: string | null, fn: () => Promise<T>) {
  const [, force] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(() => {
    if (!key) return;
    const prev = cache.get(key);
    const promise = fnRef.current()
      .then((data) => { cache.set(key, { data, at: Date.now() }); notify(key); })
      .catch((error: Error) => { cache.set(key, { ...cache.get(key), error, promise: undefined, at: Date.now() }); notify(key); });
    cache.set(key, { ...prev, promise, at: prev?.at ?? 0 });
  }, [key]);

  useEffect(() => {
    if (!key) return;
    const f = () => {
      if (!cache.has(key)) run();
      force((n) => n + 1);
    };
    if (!subs.has(key)) subs.set(key, new Set());
    subs.get(key)!.add(f);
    const e = cache.get(key);
    if (!e || (!e.promise && !e.data && !e.error)) run();
    return () => { subs.get(key)?.delete(f); };
  }, [key, run]);

  const e = key ? cache.get(key) : undefined;
  return {
    data: e?.data as T | undefined,
    error: e?.error,
    loading: !!key && e?.data === undefined && !e?.error,
    refetch: () => { if (key) { cache.delete(key); run(); } },
  };
}
