import { createLocalRepo } from './local';
import type { Repo } from './repo';
import { createSupabaseRepo } from './supabase';

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || '';
export const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || '';

/** Supabase when configured at build time; otherwise the in-browser demo workspace. */
export const repo: Repo = SUPABASE_URL && SUPABASE_ANON_KEY ? createSupabaseRepo(SUPABASE_URL, SUPABASE_ANON_KEY) : createLocalRepo();
export type { Repo, Membership, NewEvidence, User } from './repo';
