import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { evidenceCanonical, newRef, sha256Hex } from '../hash';
import type { Activity, Claim, Company, EnergyRecord, Evidence, Facility, Invite, Member } from '../types';
import type { Membership, NewEvidence, Repo, User } from './repo';

function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export function createSupabaseRepo(url: string, anonKey: string): Repo {
  const sb: SupabaseClient = createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  let cachedUser: User | null = null;

  const userName = async () => (await repo.currentUser())?.name ?? 'Someone';

  const repo: Repo = {
    mode: 'supabase',
    async currentUser() {
      const { data } = await sb.auth.getUser();
      const u = data.user;
      cachedUser = u ? { id: u.id, email: u.email ?? '', name: (u.user_metadata?.name as string) || (u.email ?? '').split('@')[0] } : null;
      return cachedUser;
    },
    onAuthChange(cb) {
      const { data } = sb.auth.onAuthStateChange(() => cb());
      return () => data.subscription.unsubscribe();
    },
    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
    },
    async signUp(email, password, name) {
      const { data, error } = await sb.auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: location.origin } });
      if (error) throw new Error(error.message);
      return { needsConfirmation: !data.session };
    },
    async sendMagicLink(email) {
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin } });
      if (error) throw new Error(error.message);
    },
    async signOut() { await sb.auth.signOut(); },

    async memberships(): Promise<Membership[]> {
      const rows = must(await sb.from('members').select('user_id, company_id, role, name, email, company:companies(*)'));
      return (rows as unknown as Membership[]).filter((r) => r.company);
    },
    async myInvites(): Promise<Invite[]> {
      return must(await sb.rpc('my_invites')) as Invite[];
    },
    async acceptInvite(id) { must(await sb.rpc('accept_invite', { invite_id: id })); },
    async createCompany(input): Promise<Company> {
      const u = await repo.currentUser();
      return must(await sb.rpc('create_company', { p_name: input.name, p_industry: input.industry, p_cin: input.cin ?? null, p_member_name: u?.name ?? '' })) as Company;
    },
    async updateCompany(id, patch) { must(await sb.from('companies').update(patch).eq('id', id)); },
    async members(companyId): Promise<Member[]> { return must(await sb.from('members').select('*').eq('company_id', companyId).order('name')); },
    async invites(companyId): Promise<Invite[]> { return must(await sb.from('invites').select('*').eq('company_id', companyId).order('created_at', { ascending: false })); },
    async invite(company_id, email, role) { must(await sb.from('invites').insert({ company_id, email: email.toLowerCase(), role })); },
    async revokeInvite(id) { must(await sb.from('invites').delete().eq('id', id)); },
    async setRole(company_id, user_id, role) { must(await sb.from('members').update({ role }).match({ company_id, user_id })); },
    async removeMember(company_id, user_id) { must(await sb.from('members').delete().match({ company_id, user_id })); },

    async facilities(companyId): Promise<Facility[]> { return must(await sb.from('facilities').select('*').eq('company_id', companyId).order('name')); },
    async saveFacility(f) { return must(await sb.from('facilities').upsert(f).select().single()) as Facility; },
    async deleteFacility(id) { must(await sb.from('facilities').delete().eq('id', id)); },
    async energy(companyId): Promise<EnergyRecord[]> {
      return must(await sb.from('energy_records').select('*').eq('company_id', companyId).order('month').limit(5000));
    },
    async saveEnergy(r) {
      return must(await sb.from('energy_records').upsert(r, { onConflict: 'facility_id,month' }).select().single()) as EnergyRecord;
    },
    async deleteEnergy(id) { must(await sb.from('energy_records').delete().eq('id', id)); },

    async evidence(companyId): Promise<Evidence[]> {
      return must(await sb.from('evidence').select('*').eq('company_id', companyId).order('created_at', { ascending: false }));
    },
    async addEvidence(input: NewEvidence) {
      const { file, ...rest } = input;
      let { file_sha256 = null, file_name = null, file_size = null } = rest;
      let file_path: string | null = null;
      if (file) {
        file_sha256 = await sha256Hex(await file.arrayBuffer());
        file_name = file.name;
        file_size = file.size;
        file_path = `${rest.company_id}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, '_')}`;
        const up = await sb.storage.from('evidence').upload(file_path, file, { upsert: false, contentType: file.type || undefined });
        if (up.error) throw new Error(`Upload failed: ${up.error.message}`);
      }
      const ref = rest.ref ?? newRef();
      const base = { ...rest, ref, file_sha256, file_name, file_size };
      const canonical_json = rest.canonical_json ?? evidenceCanonical(base);
      const row = { ...base, canonical_json, sha256: rest.sha256 ?? (await sha256Hex(canonical_json)), file_path, created_by: await userName() };
      return must(await sb.from('evidence').insert(row).select().single()) as Evidence;
    },
    async deleteEvidence(id) { must(await sb.from('evidence').delete().eq('id', id)); },
    async fileUrl(path) {
      const { data } = await sb.storage.from('evidence').createSignedUrl(path, 600);
      return data?.signedUrl ?? null;
    },

    async claims(companyId): Promise<Claim[]> {
      return must(await sb.from('claims').select('*').eq('company_id', companyId).order('updated_at', { ascending: false }));
    },
    async saveClaim(c) {
      const row = { ...c, updated_at: new Date().toISOString(), ...(c.id ? {} : { created_by: await userName() }) };
      return must(await sb.from('claims').upsert(row).select().single()) as Claim;
    },
    async deleteClaim(id) { must(await sb.from('claims').delete().eq('id', id)); },

    async activity(companyId, limit = 30): Promise<Activity[]> {
      return must(await sb.from('activity').select('*').eq('company_id', companyId).order('at', { ascending: false }).limit(limit));
    },
    async log(a) { await sb.from('activity').insert({ ...a, actor: await userName() }); },
  };
  return repo;
}
